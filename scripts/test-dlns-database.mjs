import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

const require = createRequire(import.meta.url);
const { PGlite } = require('../.cache/dlns-tools/node_modules/@electric-sql/pglite');
const model = require('../dlns/model.js');
const history = JSON.parse(await fs.readFile(new URL('../dlns/history.json',import.meta.url),'utf8'));
const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
for (const [,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const external = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  new Script(external ? await fs.readFile(new URL('../'+external,import.meta.url),'utf8') : source);
}
for (const hero of history.heroes) {
  assert.equal(model.availability[hero.name],hero.first_available,`${hero.name} availability`);
}
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.identities (user_id uuid,provider text,provider_id text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
`);
await db.exec(await fs.readFile(new URL('../supabase/migrations/202610210001_dlns.sql',import.meta.url),'utf8'));
await db.query(`insert into public.dlns_matches
  (match_id,week,region,round,game,left_team,right_team,first_pick,winner,actions,source)
  select match_id,week,region,round,game,left_team,right_team,first_pick,winner,actions,'google-sheet'
  from jsonb_to_recordset($1::jsonb) as imported(
    match_id text,week integer,region text,round text,game integer,
    left_team text,right_team text,first_pick text,winner text,actions jsonb
  )`,[JSON.stringify(history.matches)]);
assert.equal((await db.query('select count(*)::integer as count from public.dlns_matches')).rows[0].count,history.matches.length);
for (const match of history.matches) {
  assert.deepEqual(model.validateMatch(match,{allowHistoricalPlayers:true}),[],match.match_id);
  const players = Object.fromEntries(match.actions.filter(a=>a.type==='pick').map(a=>[a.hero,a.player]));
  const roundtrip = model.simToMatch(model.matchToSim(match),match,players);
  assert.deepEqual(roundtrip.actions,match.actions,`${match.match_id} draft order and player assignments`);
  assert.equal(model.matchToRecords(match).length,16);
}
assert.deepEqual(model.sequence('right').filter(a=>a.type==='ban').map(a=>a.side),['right','left','left','right']);
const records = history.matches.flatMap(model.matchToRecords);
assert.ok(model.teamsForRegion(records,'EU').includes('Abrahams'));
assert.ok(!model.teamsForRegion(records,'EU').includes('Melee Creeps'));
assert.ok(model.teamsForRegion(records,'NA').includes('Melee Creeps'));
assert.ok(!model.teamsForRegion(records,'NA').includes('Abrahams'));
assert.deepEqual(model.teamsForRegion([
  {region:'EU',team:'Zulu'}, {region:'EU',team:'Alpha'}, {region:'EU',team:'Alpha'},
  {region:'NA',team:'Other'}, {region:'EU',team:''}
],'EU'),['Alpha','Zulu']);
for (const match of history.matches.slice(0,6)) {
  const sim = model.matchToSim(match), flipped = model.withFirstPick(sim,sim.first === 'left' ? 'right' : 'left');
  assert.deepEqual(flipped.events.map(event=>event.hero),sim.events.map(event=>event.hero));
  assert.deepEqual(flipped.events.map(event=>event.side),model.sequence(flipped.first).map(action=>action.side));
  assert.deepEqual(model.withFirstPick(flipped,sim.first),sim);
  const partial = model.matchToSim({...match,actions:match.actions.slice(0,7)});
  const switched = model.withFirstPick(partial,'right');
  assert.equal(switched.events.length,7);
  assert.deepEqual(switched.events.map(event=>event.hero),partial.events.map(event=>event.hero));
  assert.equal(model.simToMatch(sim,{...match,winner:''}).winner,null);
}

const owner = '00000000-0000-4000-8000-000000000001';
const outsider = '00000000-0000-4000-8000-000000000002';
await db.query("insert into auth.identities values ($1,'github','66887569'),($2,'github','1234')",[owner,outsider]);
async function asUser(role,uid = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec(`set role ${role}`);
}
async function save(match,revision = null,original = null) {
  return (await db.query('select * from public.dlns_save_match($1::jsonb,$2,$3)',[JSON.stringify(match),revision,original])).rows[0];
}
const fixture = structuredClone(history.matches[0]);
Object.assign(fixture,{week:55,match_id:'55-EU-C-1',left_team:'DLNS Test Left',right_team:'DLNS Test Right'});
await asUser('anon');
assert.equal((await db.query('select count(*)::integer as count from public.dlns_matches')).rows[0].count,363);
assert.equal((await db.query('select public.dlns_is_admin() as allowed')).rows[0].allowed,false);
await assert.rejects(save(fixture),/permission denied/);
await assert.rejects(db.query('select * from public.dlns_match_revisions'),/permission denied/);
await asUser('authenticated',outsider);
assert.equal((await db.query('select public.dlns_is_admin() as allowed')).rows[0].allowed,false);
await assert.rejects(save(fixture),/Only the DLNS owner/);
await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:outsider,user_metadata:{provider_id:'66887569',user_name:'katamartini'}})]);
await assert.rejects(save(fixture),/Only the DLNS owner/);
await assert.rejects(db.query("update public.dlns_matches set left_team='Tampered' where match_id='1-EU-C-1'"),/permission denied/);
assert.equal((await db.query('select * from public.dlns_match_revisions')).rows.length,0);
await asUser('authenticated',owner);
assert.equal((await db.query('select public.dlns_is_admin() as allowed')).rows[0].allowed,true);
await assert.rejects(db.query("update public.dlns_matches set left_team='Bypass' where match_id='1-EU-C-1'"),/permission denied/);
const created = await save(fixture);
assert.equal(created.revision,1);
await assert.rejects(save(fixture),/already exists/);
const duplicate = structuredClone(fixture);
duplicate.actions[1].hero = duplicate.actions[0].hero;
await assert.rejects(save(duplicate,1),/hero cannot appear twice/);
const wrongOrder = structuredClone(fixture);
wrongOrder.actions[8].side = 'left';
await assert.rejects(save(wrongOrder,1),/Invalid action/);
const duplicatePlayer = structuredClone(fixture);
duplicatePlayer.actions.filter(a=>a.type==='pick').slice(0,2).forEach(a=>{a.player='Same Player';});
duplicatePlayer.source = 'google-sheet';
await assert.rejects(save(duplicatePlayer,1),/player cannot be assigned to two heroes/);
const earlyBilly = structuredClone(fixture);
Object.assign(earlyBilly,{week:2,match_id:'2-EU-C-1'});
earlyBilly.actions[2].hero = 'Billy';
await assert.rejects(save(earlyBilly),/Billy was not available/);
assert.equal((await db.query("select revision from public.dlns_matches where match_id='55-EU-C-1'")).rows[0].revision,1);
const updated = await save({...fixture,winner:'right'},1);
assert.equal(updated.revision,2);
await assert.rejects(save(fixture,1),/changed in another tab/);
const renamed = await save({...fixture,round:'Finals',match_id:'55-EU-F-1'},2,'55-EU-C-1');
assert.equal(renamed.revision,3);
assert.equal((await db.query("select * from public.dlns_match_revisions where match_id='55-EU-F-1'")).rows.length,3);
await asUser('anon');
assert.equal((await db.query("select revision from public.dlns_matches where match_id='55-EU-F-1'")).rows[0].revision,3);
await db.close();
console.log('DLNS: 363 historical matches round-trip correctly; owner-only writes, spoofed metadata, anonymous reads, draft validation, edit conflicts and revision history passed.');
