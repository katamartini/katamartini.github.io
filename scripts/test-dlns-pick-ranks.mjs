import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Script,createContext} from 'node:vm';

const require = createRequire(import.meta.url), model = require('../dlns/model.js');
const [a,b,c,d] = model.heroes.slice(20,24);
const leaders = model.heroes.slice(0,20).map(hero=>[hero,20]);
const rows = counts=>counts.flatMap(([hero,count])=>Array.from({length:count},()=>({type:'Pick',hero,region:'EU',matchid:'history'})));
const records = rows([...leaders,[a,5],[b,4],[c,3],[d,2]]);
const single = model.heroPickRanks(records,[d]);
assert.deepEqual(single.get(d),{
  current:{picks:2,rank:24,tied:false,label:'24'},
  projected:{picks:3,rank:23,tied:true,label:'T23'},improved:true
});
assert.equal(model.heroPickRanks(records,[d,d]).get(d).projected.picks,3,'a hero receives one new pick per draft');
const together = model.heroPickRanks(records,[c,d]);
assert.equal(together.get(c).projected.label,'T22');
assert.equal(together.get(d).projected.label,'24','other current picks affect the projected standings');
assert.equal(together.get(d).improved,false);

const tiedRecords = rows([...leaders,[a,5],[b,4],[c,3],[d,3]]);
const tied = model.heroPickRanks(tiedRecords,[c]);
assert.equal(tied.get(c).current.label,'T23');
assert.equal(tied.get(c).projected.label,'T22');
assert.equal(tied.get(c).improved,true);
const breakTie = model.heroPickRanks(rows([...leaders,[a,5],[b,5],[c,3],[d,3]]),[c]);
assert.equal(breakTie.get(c).current.label,'T23');
assert.equal(breakTie.get(c).projected.label,'23');
assert.equal(breakTie.get(c).improved,true,'breaking a tie at the same rank improves the standing');
const stillTied = model.heroPickRanks(tiedRecords,[c,d]);
assert.equal(stillTied.get(c).projected.label,'T22');
const unchanged = model.heroPickRanks(records,[a]);
assert.equal(unchanged.get(a).current.label,'21');
assert.equal(unchanged.get(a).projected.label,'21');
assert.equal(unchanged.get(a).improved,false);

const firstPick = model.heroes[24], firstEver = model.heroPickRanks(records,[firstPick]);
assert.equal(firstEver.get(firstPick).current.label,'T25');
assert.equal(firstEver.get(firstPick).projected.label,'25');
assert.equal(firstEver.get(firstPick).improved,true);
const allTime = model.heroPickRanks([
  {type:'Pick',hero:a,region:'EU'}, {type:'pick',hero:a,region:'NA'},
  {type:'Pick',hero:b,region:'EU'}, {type:'Ban',hero:b,region:'NA'}
],[a]);
assert.equal(allTime.get(a).current.picks,2,'all regions count');
assert.equal(allTime.get(b).current.picks,1,'bans do not count');

const editingRecords = [...records,{type:'Pick',hero:d,matchid:'editing'}];
const loaded = model.heroPickRanks(editingRecords,[d],'editing');
for (const info of loaded.values()) {
  assert.deepEqual(info.current,info.projected,'loading a saved match keeps its existing totals');
  assert.equal(info.improved,false);
}
const edited = model.heroPickRanks(editingRecords,[c],'editing');
assert.equal(edited.get(d).current.picks,3);
assert.equal(edited.get(d).projected.picks,2);
assert.equal(edited.get(c).projected.picks,4);
assert.equal(edited.get(c).projected.label,'T22');

const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
const renderer = createContext({simPickRanks:single,records,esc:String});
new Script(html.slice(html.indexOf('function simPickRankHTML('),html.indexOf('function slotHTML('))).runInContext(renderer);
let badge = renderer.simPickRankHTML(d);
assert.ok(badge.includes('class="simPickRankCurrent">24</span>'));
assert.ok(badge.includes('&rarr;'));
assert.ok(badge.includes('class="simPickRankProjected">T23</span>'));
assert.ok(badge.includes('all-time pick rank 24 (2 picks); after this draft T23 (3 picks)'));
renderer.simPickRanks = unchanged;
badge = renderer.simPickRankHTML(a);
assert.ok(badge.includes('>21</span>'));
assert.ok(!badge.includes('simPickRankProjected'));
renderer.records = [];
assert.equal(renderer.simPickRankHTML(a),'','no badge while history is unavailable');
console.log('DLNS hero pick ranks: competition ties, 24 to T23, tie breaks, simultaneous picks, all-time counts, loaded/edited matches and badge text passed.');
