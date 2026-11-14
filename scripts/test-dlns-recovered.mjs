import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), model=require('../dlns/model.js');
const data=JSON.parse(await fs.readFile(new URL('../dlns/recovery/verified-sets.json',import.meta.url),'utf8'));
assert.equal(data.matches.length,18);const ids=new Set();let picks=0;
for(const m of data.matches){
 assert(!ids.has(m.match_id));ids.add(m.match_id);assert(['Challenger','Finals'].includes(m.round));assert.equal(m.draft_order,null);assert.equal(m.first_pick,null);assert.equal(m.teams.length,2);assert(m.winner===null||m.teams.some(t=>t.name===m.winner));assert(m.sources.length);
 const heroes=m.teams.flatMap(t=>t.picks);assert.equal(heroes.length,12);assert.equal(new Set(heroes).size,12);picks+=12;
 for(const t of m.teams){assert.equal(t.picks.length,6);for(const h of t.picks)assert(model.heroes.includes(h),h);if(t.bans){assert.equal(t.bans.length,2);for(const h of t.bans){assert(model.heroes.includes(h));assert(!heroes.includes(h));}}}
 for(const u of m.sources)assert.equal(new URL(u).protocol,'https:');
}
assert.equal(picks,216);
const history=JSON.parse(await fs.readFile(new URL('../dlns/history.json',import.meta.url),'utf8'));assert.equal(history.matches.length,363);assert(history.matches.every(m=>!ids.has(m.match_id)));
console.log('PASS recovered sets: 18 isolated maps, 216 unique-per-map picks, canonical heroes, valid winners, no conflicting bans, unknown chronology preserved.');
