import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script, createContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { PGlite } = require('../.cache/dlns-tools/node_modules/@electric-sql/pglite');
const model = require('../dlns/model.js');
const history = JSON.parse(await fs.readFile(new URL('../dlns/history.json',import.meta.url),'utf8'));
const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
for (const [,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const external = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  new Script(external ? await fs.readFile(new URL('../'+external,import.meta.url),'utf8') : source);
}
await import('./test-dlns-combinations.mjs');
await import('./test-dlns-validation.mjs');
await import('./test-dlns-pick-ranks.mjs');
// Exercise the inline coverage renderer without booting the rest of the page.
const coverageRoot = {innerHTML:''};
const coverage = createContext({
  window:{}, $:id=>id === 'coverageStats' ? coverageRoot : null,
  num:String, esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  ih:hero=>`<img alt="${hero}">`, keyOf:heroes=>heroes.slice().sort().join('|'),
  currentHeroUniverse:'ABCDEFGHIJKLMNOPQR'.split(''),
  currentCoverageMaps:Object.fromEntries(['duos','trios','quads','fives','sixes'].map(kind=>[kind,new Map()]))
});
const coverageStart = html.indexOf('function coveragePct('), coverageEnd = html.indexOf('function bigStats(');
assert.ok(coverageStart > 0 && coverageEnd > coverageStart);
new Script(html.slice(html.indexOf('function combos('),html.indexOf('function draftSimTab('))
  + html.slice(coverageStart,coverageEnd)).runInContext(coverage);
assert.equal(coverage.coveragePct(1,3),'33.333%');
assert.equal(coverage.coveragePct(1,1),'100.000%');
assert.equal(coverage.coveragePct(0,10),'0.000%');
assert.equal(coverage.coveragePct(0,0),'0.000%');
const coverageSizes = [['duos',2],['trios',3],['quads',4],['fives',5],['sixes',6]];
const projectionChanges = new Set();
const seenDrafts = ['ABCDEF','GHIJKQ','ABGHQR'].map(draft=>draft.split(''));
for (const [kind,size] of coverageSizes) {
  for (const draft of seenDrafts) coverage.combos(draft,size,heroes=>coverage.currentCoverageMaps[kind].set(coverage.keyOf(heroes),1));
}
for (const [left,right] of [['',''],['ABC','GH'],['ABCDE','GHIJ'],['ABCDEF','GHIJKL']]) {
  const state = {left:'Left <Team>',right:'Right & Team',slots:{
    left:{picks:left.split(''),bans:['M']},right:{picks:right.split(''),bans:['N']}
  }};
  for (const side of ['left','right']) {
    const mine = state.slots[side].picks;
    const blocked = new Set(['M','N',...state.slots[side === 'left' ? 'right' : 'left'].picks]);
    const available = coverage.currentHeroUniverse.filter(hero=>!blocked.has(hero) && !mine.includes(hero));
    const legal = Object.fromEntries(coverageSizes.map(([kind])=>[kind,new Set()]));
    coverage.combos(available,6-mine.length,remaining=>{
      for (const [kind,size] of coverageSizes) coverage.combos([...mine,...remaining],size,heroes=>legal[kind].add(coverage.keyOf(heroes)));
    });
    for (const [kind,size] of coverageSizes) {
      const actual = coverage.possibleSeenForSide(kind,size,side,state,coverage.currentCoverageMaps,coverage.currentHeroUniverse);
      assert.equal(actual.total,legal[kind].size,`${kind}: theoretical combinations for ${side}`);
      assert.equal(actual.seen,[...legal[kind]].filter(key=>coverage.currentCoverageMaps[kind].has(key)).length);
    }
  }
  coverage.renderCoverageStats(state);
  assert.equal((coverageRoot.innerHTML.match(/<tr id=/g) || []).length,5);
  assert.equal((coverageRoot.innerHTML.match(/class="coverageSide"/g) || []).length,10);
  assert.ok(coverageRoot.innerHTML.includes('Left &lt;Team&gt;'));
  assert.ok(coverageRoot.innerHTML.includes('Right &amp; Team'));
  for (const [kind,size] of coverageSizes) {
    const row = coverage.coverageRowHTML(kind,size,kind,state,coverage.currentCoverageMaps,coverage.currentHeroUniverse);
    const total = coverage.nCk(coverage.currentHeroUniverse.length,size), unseen = total-coverage.currentCoverageMaps[kind].size;
    const fresh = ['left','right'].flatMap(side=>coverage.newPickedCombosForSide(kind,size,side,state,coverage.currentCoverageMaps).items);
    const projected = unseen-new Set(fresh.map(coverage.keyOf)).size;
    const reduced = projected < unseen;
    projectionChanges.add(reduced);
    assert.ok(row.includes(`<span class="coverageNumerator">${unseen}</span><span class="coverageFractionSeparator"> / </span><span class="coverageDenominator">${total}</span>`));
    assert.ok(row.includes(`<span class="coverageNumerator coverageProjectedNumerator${reduced ? ' coverageCountReduced' : ''}">${projected}</span><span class="coverageFractionSeparator"> / </span><span class="coverageDenominator">${total}</span>`));
    assert.equal((row.match(/coverageCountReduced/g) || []).length,reduced ? 1 : 0);
    assert.equal((row.match(/coverageNumerator coverageProjectedNumerator/g) || []).length,1);
    assert.equal((row.match(/class="coverageCountArrow"/g) || []).length,2);
    assert.ok(row.includes(`${coverage.coveragePct(unseen,total)} &rarr; ${coverage.coveragePct(projected,total)}`));
    for (const percentage of row.match(/\d+(?:\.\d+)?%/g) || []) assert.match(percentage,/^\d+\.\d{3}%$/);
    assert.equal((row.match(/class="coverageCombo"/g) || []).length,fresh.length);
    for (const side of ['left','right']) {
      const possible = coverage.possibleSeenForSide(kind,size,side,state,coverage.currentCoverageMaps,coverage.currentHeroUniverse);
      const unseenPossible = possible.total-possible.seen;
      let pickedUnseen = 0;
      coverage.combos(state.slots[side].picks,size,heroes=>{
        if (!coverage.currentCoverageMaps[kind].has(coverage.keyOf(heroes))) pickedUnseen++;
      });
      const cell = row.match(new RegExp(`<td class="coverageSide" data-side="${side}">([\\s\\S]*?)</td>`))?.[1];
      assert.ok(cell,`${kind}: coverage cell for ${side}`);
      assert.ok(cell.includes(`<strong class="coverageCount">${pickedUnseen} / ${unseenPossible}</strong>`),`${kind}: picked / possible unseen for ${side}`);
      assert.ok(cell.includes(`${coverage.coveragePct(pickedUnseen,unseenPossible)} picked`));
      assert.ok(pickedUnseen <= unseenPossible);
      if (state.slots[side].picks.length === 6) {
        assert.equal(pickedUnseen,unseenPossible,`${kind}: all possible unseen combos picked for a completed team`);
        assert.ok(cell.includes(pickedUnseen ? '100.000% picked' : '0.000% picked'));
      }
    }
    assert.ok(!row.includes('coverageNewCount'));
  }
}
assert.deepEqual([...projectionChanges].sort(),[false,true],'coverage colors exercise unchanged and decreased counts');
coverage.renderCoverageStats();
assert.ok(coverageRoot.innerHTML.includes('<caption>Unseen combinations</caption>'));
assert.equal((coverageRoot.innerHTML.match(/&mdash;/g) || []).length,10);
console.log('DLNS coverage: picked / possible unseen ratios, complete and partial drafts, raw count/percentage projections, three-decimal precision and hero icons passed.');
for (const hero of history.heroes) {
  assert.equal(model.availability[hero.name],hero.first_available,`${hero.name} availability`);
}
const newHeroes = {
  'Rat King':'59-EU-C-1',Baba:'59-EU-C-1',Solomon:'60-EU-C-1',
  'Deadman Danny':'60-EU-C-1',Violet:'61-EU-C-1','Nurse Harrow':'61-EU-C-1'
};
assert.equal(model.heroes.length,44);
for (const [hero,first] of Object.entries(newHeroes)) assert.equal(model.availability[hero],first);
const catalog = createContext({DLNSModel:model});
new Script(html.slice(html.indexOf('const HERO_AVAIL='),html.indexOf('function ih('))).runInContext(catalog);
assert.deepEqual(Array.from(new Script('Object.keys(HERO_AVAIL)').runInContext(catalog)),model.heroes);
for (const hero of model.heroes) {
  const path = catalog.ip(hero);
  assert.ok(path,`${hero} icon mapping`);
  await fs.access(new URL('../'+path,import.meta.url));
}
assert.ok(html.includes('HEROES=DLNSModel.heroes;'));
const restoredSim = createContext({HEROES:model.heroes});
new Script(html.slice(html.indexOf('function blankSlots('),html.indexOf('function loadSim('))).runInContext(restoredSim);
for (const hero of Object.keys(newHeroes)) {
  const partial = model.matchToSim({...history.matches[0],actions:[{type:'ban',order:1,side:'left',hero}]});
  assert.equal(restoredSim.cleanSim(partial).events[0].hero,hero,`${hero} survives draft restoration`);
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
await db.exec(await fs.readFile(new URL('../supabase/migrations/202610210002_dlns_teams.sql',import.meta.url),'utf8'));
const heroMigration = await fs.readFile(new URL('../supabase/migrations/202610220001_dlns_heroes.sql',import.meta.url),'utf8');
await db.exec(heroMigration);
await db.exec(heroMigration);
assert.deepEqual((await db.query('select name, first_available from public.dlns_heroes order by name')).rows,
  model.heroes.map(name=>({name,first_available:model.chronology(model.availability[name])})).sort((a,b)=>a.name < b.name ? -1 : 1));
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
assert.deepEqual(model.teamsForRegion([{region:'EU',team:'Alpha'}],'EU',[
  {region:'EU',name:'alpha'}, {region:'EU',name:'  New Team  '}, {region:'NA',name:'Other'}
]),['Alpha','New Team']);
const heroPlayerHistory = [
  {matchid:'10-EU-F-2',region:'EU',team:'Alpha',type:'Pick',hero:'Abrams',player:'Latest'},
  {matchid:'9-EU-F-3',region:'EU',team:'Alpha',type:'Pick',hero:'Abrams',player:'Earlier'},
  {matchid:'11-EU-C-1',region:'EU',team:'Alpha',type:'Pick',hero:'Abrams',player:''},
  {matchid:'12-EU-C-1',region:'EU',team:'Alpha',type:'Ban',hero:'Abrams',player:'Ban'},
  {matchid:'12-EU-C-1',region:'EU',team:'Other',type:'Pick',hero:'Abrams',player:'Opponent'},
  {matchid:'12-NA-C-1',region:'NA',team:'Alpha',type:'Pick',hero:'Abrams',player:'NA Player'},
  {matchid:'12-EU-C-1',region:'EU',team:'Alpha',type:'Pick',hero:'Ivy',player:'Other Hero'}
];
assert.equal(model.latestHeroPlayer(heroPlayerHistory,' ALPHA ','Abrams','EU'),'Latest');
assert.equal(model.latestHeroPlayer(heroPlayerHistory.slice().reverse(),'Alpha','Abrams','EU'),'Latest');
assert.equal(model.latestHeroPlayer(heroPlayerHistory,'Alpha','Abrams','NA'),'NA Player');
assert.equal(model.latestHeroPlayer(heroPlayerHistory,'Other','Abrams','EU'),'Opponent');
assert.equal(model.latestHeroPlayer(heroPlayerHistory,'Alpha','Ivy','EU'),'Other Hero');
assert.equal(model.latestHeroPlayer(heroPlayerHistory,'Alpha','Haze','EU'),'');
assert.equal(model.latestHeroPlayer(heroPlayerHistory,'New Team','Abrams','EU'),'');
const playerEntrySource = await fs.readFile(new URL('../dlns/submission.js',import.meta.url),'utf8');
const restorePlayerEntry = saved => {
  const state = createContext({STORE:'dlns.matchEntry.v1',localStorage:{getItem:()=>JSON.stringify(saved)},persist:()=>{}});
  new Script(playerEntrySource.slice(playerEntrySource.indexOf('  const blank = '),playerEntrySource.indexOf('  entry.region ='))).runInContext(state);
  return new Script('entry').runInContext(state);
};
const restoredPlayers = restorePlayerEntry({players:{Abrams:'Automatic',Ivy:'Manual',Haze:''},autoPlayers:{Abrams:true}});
assert.ok(!Object.hasOwn(restoredPlayers.players,'Abrams'),'old automatic selections are cleared');
assert.equal(restoredPlayers.players.Ivy,'Manual');
assert.equal(restoredPlayers.players.Haze,'');
assert.ok(!Object.hasOwn(restoredPlayers,'autoPlayers'));
assert.equal(restorePlayerEntry({players:{Abrams:'Saved'},editing:'60-EU-C-1'}).players.Abrams,'Saved','saved assignments are preserved');
assert.equal(Object.keys(restorePlayerEntry(null).players).length,0,'new drafts start without assigned players');
assert.deepEqual(model.validateTeam(' First Timers ','EU'),[]);
for (const name of ['',null,'   ','Team 1','TEAM 2','x'.repeat(101)]) assert.ok(model.validateTeam(name,'EU').length);
assert.ok(model.validateTeam('First Timers','SA').length);
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
const seriesGame = {week:80,region:'EU',round:'Finals',game:1,left_team:'Alpha',right_team:'Bravo',winner:'left'};
const seriesHistory = [
  seriesGame,
  {...seriesGame,game:2,left_team:'Bravo',right_team:'Alpha'},
  {...seriesGame,game:3},
  {...seriesGame,game:4},
  {...seriesGame,week:79},
  {...seriesGame,region:'NA'},
  {...seriesGame,round:'Challenger'},
  {...seriesGame,right_team:'Other'}
];
const seriesTeams = {left:'Alpha',right:'Bravo'};
assert.deepEqual(model.seriesWins(seriesHistory,seriesGame,seriesTeams),{left:0,right:0});
assert.deepEqual(model.seriesWins(seriesHistory,{...seriesGame,game:2},seriesTeams),{left:1,right:0});
assert.deepEqual(model.seriesWins(seriesHistory,{...seriesGame,game:3},seriesTeams),{left:1,right:1});
assert.deepEqual(model.seriesWins([seriesGame,{...seriesGame,game:2}],{...seriesGame,game:3},seriesTeams),{left:2,right:0});
assert.deepEqual(model.seriesWins(seriesHistory,{...seriesGame,game:2},{left:'Bravo',right:'Alpha'}),{left:0,right:1});
assert.deepEqual(model.seriesWins([seriesGame,{...seriesGame,game:2,winner:null}],{...seriesGame,game:3},seriesTeams),{left:1,right:0});
assert.deepEqual(model.seriesWins(seriesHistory,{...seriesGame,game:''},seriesTeams),{left:0,right:0});
const gameThree = history.matches.find(match=>match.match_id === '2-NA-F-3');
assert.deepEqual(model.seriesWins(history.matches,gameThree,{left:gameThree.left_team,right:gameThree.right_team}),{left:1,right:1});

assert.deepEqual(model.nextMatch([]),{week:1,region:'EU',round:'Challenger',game:1});
const expectNext = (matches,id) => assert.equal(model.matchId(model.nextMatch(matches)),id);
for (const region of ['EU','NA']) {
  const first = {...seriesGame,region}, second = {...first,game:2};
  const afterFinals = region === 'EU' ? '80-NA-C-1' : '81-EU-C-1';
  expectNext([{...first,round:'Challenger'}],`80-${region}-F-1`);
  expectNext([first],`80-${region}-F-2`);
  expectNext([first,{...second,winner:'right'}],`80-${region}-F-3`);
  expectNext([first,second],afterFinals);
  expectNext([first,{...second,left_team:'Bravo',right_team:'Alpha',winner:'left'}],`80-${region}-F-3`);
  expectNext([first,{...second,left_team:'Bravo',right_team:'Alpha',winner:'right'}],afterFinals);
  expectNext([{...first,game:3}],afterFinals);
}
const sequenceHistory = [];
for (const id of ['1-EU-C-1','1-EU-F-1','1-EU-F-2','1-EU-F-3','1-NA-C-1','1-NA-F-1','1-NA-F-2','1-NA-F-3','2-EU-C-1']) {
  const next = model.nextMatch(sequenceHistory);
  assert.equal(model.matchId(next),id);
  sequenceHistory.push({...seriesGame,...next,winner:next.game === 2 ? 'right' : 'left'});
}
expectNext([{...seriesGame,region:'NA'}, {...seriesGame,updated_at:'2099-01-01'}],'80-NA-F-2');
expectNext(history.matches.slice().reverse(),'55-EU-C-1');
assert.throws(()=>model.nextMatch([{...seriesGame,game:2}]),/need winners/);
assert.throws(()=>model.nextMatch([{...seriesGame,winner:null},{...seriesGame,game:2}]),/need winners/);
assert.throws(()=>model.nextMatch([seriesGame,{...seriesGame,game:2,winner:null}]),/need winners/);
assert.throws(()=>model.nextMatch([seriesGame,{...seriesGame,game:2,right_team:'Other',winner:'right'}]),/teams.*do not match/);
assert.throws(()=>model.nextMatch([{...seriesGame,game:4}]),/outside.*sequence/);
assert.throws(()=>model.nextMatch([{...seriesGame,week:9999,region:'NA',game:3}]),/exceed week 9999/);

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
async function addTeam(name,region = 'EU') {
  return (await db.query('select * from public.dlns_add_team($1,$2)',[name,region])).rows[0];
}
const fixture = structuredClone(history.matches[0]);
Object.assign(fixture,{week:55,match_id:'55-EU-C-1',left_team:'DLNS Test Left',right_team:'DLNS Test Right'});
await asUser('anon');
assert.equal((await db.query('select count(*)::integer as count from public.dlns_matches')).rows[0].count,363);
assert.equal((await db.query('select public.dlns_is_admin() as allowed')).rows[0].allowed,false);
await assert.rejects(save(fixture),/permission denied/);
assert.equal((await db.query('select * from public.dlns_teams')).rows.length,0);
await assert.rejects(addTeam('First Timers'),/permission denied/);
await assert.rejects(db.query("insert into public.dlns_teams (region,name) values ('EU','Not Allowed')"),/permission denied/);
await assert.rejects(db.query('select * from public.dlns_match_revisions'),/permission denied/);
await asUser('authenticated',outsider);
assert.equal((await db.query('select public.dlns_is_admin() as allowed')).rows[0].allowed,false);
await assert.rejects(save(fixture),/Only the DLNS owner/);
await assert.rejects(addTeam('First Timers'),/Only the DLNS owner/);
await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:outsider,user_metadata:{provider_id:'66887569',user_name:'katamartini'}})]);
await assert.rejects(save(fixture),/Only the DLNS owner/);
await assert.rejects(addTeam('First Timers'),/Only the DLNS owner/);
await assert.rejects(db.query("update public.dlns_matches set left_team='Tampered' where match_id='1-EU-C-1'"),/permission denied/);
assert.equal((await db.query('select * from public.dlns_match_revisions')).rows.length,0);
await asUser('authenticated',owner);
assert.equal((await db.query('select public.dlns_is_admin() as allowed')).rows[0].allowed,true);
for (const [hero,first] of Object.entries(newHeroes)) {
  const firstWeek = Number(first.split('-')[0]), available = structuredClone(fixture);
  Object.assign(available,{week:firstWeek,match_id:first});
  available.actions[0].hero = hero;
  const early = {...available,week:firstWeek-1,region:'NA',round:'Finals',game:3,match_id:`${firstWeek-1}-NA-F-3`};
  assert.ok(model.validateMatch(early).some(error=>error.includes(`${hero} was not available`)));
  await assert.rejects(save(early),new RegExp(`${hero} was not available`));
  assert.deepEqual(model.validateMatch(available),[]);
  await db.exec('begin');
  try {
    assert.equal((await save(available)).actions[0].hero,hero,`${hero} accepted at first availability`);
  } finally {
    await db.exec('rollback');
  }
}
await assert.rejects(db.query("insert into public.dlns_teams (region,name) values ('EU','Bypass')"),/permission denied/);
const registered = await addTeam('  First Timers  ');
assert.equal(registered.name,'First Timers');
assert.equal(registered.region,'EU');
assert.deepEqual(await addTeam('first timers'),registered);
assert.equal((await addTeam('First Timers','NA')).region,'NA');
assert.equal((await addTeam('abrahams')).name,'Abrahams');
for (const name of ['',null,'   ','Team 1','TEAM 2','x'.repeat(101)]) await assert.rejects(addTeam(name),/actual team name/);
await assert.rejects(addTeam('First Timers','SA'),/Choose EU or NA/);
await assert.rejects(addTeam('First Timers',null),/Choose EU or NA/);
assert.equal((await db.query('select * from public.dlns_teams')).rows.length,3);
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
assert.equal((await db.query("select name from public.dlns_teams where region='EU' order by name")).rows.length,2);
assert.equal((await db.query("select revision from public.dlns_matches where match_id='55-EU-F-1'")).rows[0].revision,3);
await db.close();
console.log('DLNS: 44 catalog heroes and availability boundaries, 363 historical match round-trips, owner-only match/team writes, regional team names, spoofed metadata, anonymous reads, draft validation, edit conflicts and revision history passed.');
