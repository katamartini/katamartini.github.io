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
  current:{picks:2,rank:24,label:'24'},
  projected:{picks:3,rank:23,label:'23'},improved:true
});
assert.equal(model.heroPickRanks(records,[d,d]).get(d).projected.picks,3,'a hero receives one new pick per draft');
const together = model.heroPickRanks(records,[c,d]);
assert.equal(together.get(c).projected.label,'22');
assert.equal(together.get(d).projected.label,'24','other current picks affect the projected standings');
assert.equal(together.get(d).improved,false);

const tiedRecords = rows([...leaders,[a,5],[b,4],[c,3],[d,3]]);
const tied = model.heroPickRanks(tiedRecords,[c]);
assert.equal(tied.get(c).current.label,'23');
assert.equal(tied.get(c).projected.label,'22');
assert.equal(tied.get(c).improved,true);
const breakTie = model.heroPickRanks(rows([...leaders,[a,5],[b,5],[c,3],[d,3]]),[c]);
assert.equal(breakTie.get(c).current.label,'23');
assert.equal(breakTie.get(c).projected.label,'23');
assert.equal(breakTie.get(c).improved,false,'breaking a tie at the same number does not announce an improvement');
const stillTied = model.heroPickRanks(tiedRecords,[c,d]);
assert.equal(stillTied.get(c).projected.label,'22');
const unchanged = model.heroPickRanks(records,[a]);
assert.equal(unchanged.get(a).current.label,'21');
assert.equal(unchanged.get(a).projected.label,'21');
assert.equal(unchanged.get(a).improved,false);

const firstPick = model.heroes[24], firstEver = model.heroPickRanks(records,[firstPick]);
assert.equal(firstEver.get(firstPick).current.label,'25');
assert.equal(firstEver.get(firstPick).projected.label,'25');
assert.equal(firstEver.get(firstPick).improved,false);
const [rank26,rank27] = model.heroes.slice(25,27);
const intoTie = model.heroPickRanks(rows([...model.heroes.slice(0,25).map(hero=>[hero,20]),[rank26,3],[rank27,2]]),[rank27]).get(rank27);
assert.equal(intoTie.current.label,'27');
assert.equal(intoTie.projected.label,'26');
assert.equal(intoTie.improved,true,'moving into a tie at 26th announces 27 to 26');
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
assert.equal(edited.get(c).projected.label,'22');

const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
const badgeTiers = ['Eternus','Ascendant','Phantom','Oracle','Emissary','Ritualist','Mystic','Sentinel','Acolyte','Seeker','Initiate'];
for (const [band,name] of badgeTiers.entries()) {
  for (let rank = band*4+1; rank <= band*4+4; rank++) {
    assert.deepEqual(model.heroPickBadge(rank),{name,image:`images/deadlock/ranks/ranked-mode/${name.toLowerCase()}.png`,minRank:band*4+1,maxRank:band*4+4});
  }
  const png = await fs.readFile(new URL('../'+model.heroPickBadge(band*4+1).image,import.meta.url));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',`${name}: imported PNG`);
  assert.equal(png.readUInt32BE(16),300,`${name}: 300-pixel wiki PNG`);
}
assert.equal(model.heroPickBadge(0),null);
const renderer = createContext({DLNSModel:model,simPickRanks:single,records,esc:String});
new Script(html.slice(html.indexOf('function simPickRankHTML('),html.indexOf('function slotHTML('))).runInContext(renderer);
let badge = renderer.simPickRankHTML(d);
assert.ok(badge.includes('class="simPickRankCurrent">24</span>'));
assert.ok(badge.includes('&rarr;'));
assert.ok(badge.includes('class="simPickRankProjected">23</span>'));
assert.ok(badge.includes('all-time pick rank 24 (2 picks); after this draft 23 (3 picks)'));
assert.ok(badge.includes('data-rank-tier="Ritualist"'));
assert.ok(badge.includes('background-image:url(images/deadlock/ranks/ranked-mode/ritualist.png)'));
const crossingTier = model.heroPickRanks(rows([...model.heroes.slice(0,23).map(hero=>[hero,20]),[model.heroes[23],3],[model.heroes[24],2]]),[model.heroes[24]]);
renderer.simPickRanks = crossingTier;
badge = renderer.simPickRankHTML(model.heroes[24]);
assert.ok(badge.includes('class="simPickRankCurrent">25</span>'));
assert.ok(badge.includes('class="simPickRankProjected">24</span>'));
assert.ok(badge.includes('data-rank-tier="Ritualist"'),'the badge uses the projected rank when crossing a tier boundary');
renderer.simPickRanks = breakTie;
badge = renderer.simPickRankHTML(c);
assert.ok(badge.includes('>23</span>'));
assert.ok(!badge.includes('simPickRankProjected'));
assert.ok(!badge.includes('after this draft'));
renderer.simPickRanks = unchanged;
badge = renderer.simPickRankHTML(a);
assert.ok(badge.includes('>21</span>'));
assert.ok(!badge.includes('simPickRankProjected'));
renderer.records = [];
assert.equal(renderer.simPickRankHTML(a),'','no badge while history is unavailable');
console.log('DLNS hero pick ranks: numeric labels, tie handling, simultaneous picks, all-time counts, loaded/edited matches, eleven imported PNG tiers, four-place bands and projected badge backgrounds passed.');
