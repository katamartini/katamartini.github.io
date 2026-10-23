import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script, createContext } from 'node:vm';

const require = createRequire(import.meta.url);
const combinations = require('../dlns/combinations.js');
const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
const keyOf = heroes=>heroes.slice().sort((a,b)=>a.localeCompare(b)).join('|');
const engine = createContext({DLNSCombinations:combinations,keyOf});
new Script(html.slice(html.indexOf('function combos('),html.indexOf('function draftSimTab('))
  + html.slice(html.indexOf('function countMaps('),html.indexOf('let rarityBuildToken='))).runInContext(engine);
const heroes = 'ABCDEFGHIJK'.split('');
const maps = engine.countMaps(['ABCDEF','ABCDGH','ABEGHI'].map(value=>({heroes:value.split('')})));
const weights = {heroes:.35,duos:1,trios:2,quads:4,fives:8};
const expectedBySize = new Map();
for (const [size,kind] of [[2,'duos'],[3,'trios'],[4,'quads'],[5,'fives'],[6,'sixes']]) {
  const expected = [];
  engine.combos(heroes,size,combo=>{
    const key = keyOf(Array.from(combo));
    if (!maps[kind].has(key)) expected.push({key,heroes:Array.from(combo),total:engine.score(combo,maps,weights).total});
  });
  expected.sort((a,b)=>b.total-a.total || a.key.localeCompare(b.key));
  assert.ok(expected.length >= 20,`${kind}: enough unseen combinations to exercise the limit`);
  expectedBySize.set(size,expected.slice(0,20));
  const builder = combinations.createBuilder(heroes,size,maps[kind],combo=>engine.score(combo,maps,weights).total);
  while (!builder.done) {
    const previous = builder.visited;
    builder.step(7);
    assert.ok(builder.visited > previous && builder.visited <= previous+7);
    assert.ok(builder.items.length <= 20);
  }
  assert.equal(builder.total,engine.nCk(heroes.length,size));
  assert.equal(builder.visited,builder.total);
  assert.deepEqual(builder.items,expected.slice(0,20),`${kind}: exact top twenty unseen combinations`);
}
const originalScore = engine.score;
let scoreCalls = 0;
engine.score = (...args)=>{scoreCalls++;return originalScore(...args);};
const index = engine.buildRarityIndex(heroes,maps,weights);
assert.equal(scoreCalls,engine.nCk(heroes.length,6),'Draft leaders reuse the existing rarity pass');
assert.deepEqual(index.topUnseen,expectedBySize.get(6));
assert.equal(index.scores.length,index.total);
const tied = combinations.createBuilder(['D','C','B','A'],2,new Set(),()=>0,5);
while (!tied.done) tied.step(2);
assert.deepEqual(tied.items.map(item=>item.key),['A|B','A|C','A|D','B|C','B|D']);
const empty = combinations.createBuilder([],6,new Set(),()=>0);
assert.equal(empty.done,true);
assert.equal(empty.total,0);
const seen = combinations.createBuilder(['A','B'],2,new Set(['A|B']),()=>1);
seen.step();
assert.deepEqual(seen.items,[]);
const duplicates = combinations.topList(new Set(),1);
duplicates.consider(['B','A'],1);
duplicates.consider(['A','B'],1);
assert.equal(duplicates.items.length,1);
assert.equal(duplicates.couldEnter(0),false);

const state = (left = '',right = '',banned = '')=>({slots:{
  left:{picks:left.split(''),bans:banned.split('')},right:{picks:right.split(''),bans:[]}
}});
const check = (combo,draft,expected)=>assert.deepEqual(combinations.possibility(combo.split(''),draft),expected);
check('AB',state(),{possible:true,leftPossible:true,rightPossible:true,selected:[]});
check('AB',state('A'),{possible:true,leftPossible:true,rightPossible:false,selected:['A']});
check('AB',state('','A'),{possible:true,leftPossible:false,rightPossible:true,selected:['A']});
check('AB',state('A','B'),{possible:false,leftPossible:false,rightPossible:false,selected:[]});
check('AB',state('','','A'),{possible:false,leftPossible:false,rightPossible:false,selected:[]});
check('BXY',state('ABCDE','Z'),{possible:false,leftPossible:false,rightPossible:false,selected:[]});
check('BCX',state('ABCDE','Z'),{possible:true,leftPossible:true,rightPossible:false,selected:['B','C']});
check('MN',state('ABCDEF','GHIJKL'),{possible:false,leftPossible:false,rightPossible:false,selected:[]});
check('ABCDEF',state('ABCDEF','GHIJKL'),{possible:true,leftPossible:true,rightPossible:false,selected:'ABCDEF'.split('')});

const renderer = createContext({
  DLNSCombinations:combinations,sim:state('A','B'),keyOf,
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;'),
  team:side=>side === 'left' ? 'Left Team' : 'Right Team',fmt:value=>value.toFixed(3),
  simComboHero:(hero,picked)=>`<img alt="${hero}" class="${picked?'selected':''}">`
});
new Script(html.slice(html.indexOf('function simLeaderBox('),html.indexOf('function renderSimLeaders('))).runInContext(renderer);
const entry = [{key:'A|B',heroes:['A','B'],total:1}];
let rendered = renderer.simLeaderBox(2,'Duos',entry,null);
assert.ok(rendered.includes('simLeaderImpossible'));
assert.ok(rendered.includes('data-possible="false"'));
assert.ok(!rendered.includes('class="selected"'));
renderer.sim = state('A');
rendered = renderer.simLeaderBox(2,'Duos',entry,25);
assert.ok(rendered.includes('data-possible="true"'));
assert.ok(rendered.includes('alt="A" class="selected"'));
assert.ok(rendered.includes('Calculating 25%'));
assert.ok(rendered.includes('Possible for Left Team'));
assert.equal((renderer.simLeaderBox(6,'Drafts',expectedBySize.get(6),null).match(/<li /g) || []).length,20);
console.log('DLNS combination leaders: exact top twenties, cached rarity reuse, ties, bans, split picks, team capacity, outlines and disabled rows passed.');
