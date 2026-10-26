import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script, createContext } from 'node:vm';

const require = createRequire(import.meta.url);
const model = require('../dlns/model.js');
const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
const submission = await fs.readFile(new URL('../dlns/submission.js',import.meta.url),'utf8');
const history = JSON.parse(await fs.readFile(new URL('../dlns/history.json',import.meta.url),'utf8'));
const fixtures = ['EU','NA'].map(region=>({...history.matches.find(match=>match.region === region),revision:7}));

// Loading a public match must preserve its editing metadata without writing it.
for (const admin of [false,true]) {
  let persisted, sim, writes = 0;
  const window = {
    DLNSDatabase:{matches:fixtures,teams:[],auth:{admin},subscribe(){},initAuth(){},saveMatch(){ writes++; }},
    DLNSModel:model,
    DLNSApp:{getRecords:()=>[],getSim:()=>sim,setSim:value=>{ sim = value; }},
    addEventListener(){},renderDraftSim(){}
  };
  new Script(submission).runInContext(createContext({window,
    document:{getElementById:()=>null,querySelectorAll:()=>[]},
    localStorage:{getItem:()=>null,setItem:(_key,value)=>{ persisted = JSON.parse(value); }}
  }));
  for (const match of fixtures) {
    assert.equal(window.DLNSMatchEntry.loadMatch(match.match_id),true);
    assert.deepEqual(sim,model.matchToSim(match));
    assert.equal(persisted.editing,match.match_id);
    assert.equal(persisted.selected,match.match_id);
    assert.equal(persisted.revision,7);
    assert.equal(persisted.week,String(match.week));
    assert.equal(persisted.region,match.region);
    assert.equal(persisted.round,match.round);
    assert.equal(persisted.game,String(match.game));
    assert.equal(persisted.winner,match.winner || '');
    assert.deepEqual(persisted.players,Object.fromEntries(match.actions.filter(action=>action.type === 'pick').map(action=>[action.hero,action.player || ''])));
    assert.equal(window.DLNSMatchEntry.editingMatchId,match.match_id);
  }
  const previous = sim, previousEntry = JSON.stringify(persisted);
  for (const id of ['',null,'missing-match']) assert.equal(window.DLNSMatchEntry.loadMatch(id),false);
  assert.equal(sim,previous,'unknown IDs leave the current draft intact');
  assert.equal(JSON.stringify(persisted),previousEntry);
  assert.equal(writes,0,'opening a validation flag never submits a match');
}

const ids = ['44-NA-F-1','44-NA-F-1','44-NA-C-1'];
let links = ids.map(id=>({dataset:{validationMatch:id}})), allowLoad = true, focused = false, scrolled = false;
const loaded = [], tabs = [], count = {textContent:''};
const root = {innerHTML:'',querySelectorAll:selector=>{
  assert.equal(selector,'[data-validation-match]');
  return links;
}};
const validation = createContext({
  records:[1,2].map(()=>({matchid:ids[0],type:'Pick',hero:'Abrams',player:'Same player'})),
  playerOf:row=>row.player,num:String,keyOf:heroes=>heroes.slice().sort().join('|'),
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  $:id=>({validationResults:root,validationCount:count,
    'tabBtn-draftsim':{focus(){ focused = true; }},'tab-draftsim':{scrollIntoView(){ scrolled = true; }}
  })[id],
  setTab:tab=>tabs.push(tab),
  window:{DLNSMatchEntry:{loadMatch:id=>{ loaded.push(id); return allowLoad; }}}
});
new Script(html.slice(html.indexOf('function renderValidation('),html.indexOf('function renderRosterMoves('))).runInContext(validation);
validation.renderValidation([{week:44,region:'NA',round:'Challenger',result:'Win',matchID:ids[2],team:'Alpha & Team',players:['Winner']}]);
assert.equal(count.textContent,'3');
assert.equal((root.innerHTML.match(/<a class="r match validationFlag" href="#draftsim"/g) || []).length,3);
for (const id of new Set(ids)) assert.ok(root.innerHTML.includes(`data-validation-match="${id}" title="Load ${id} in Draft Simulator"`));
assert.ok(root.innerHTML.includes('Alpha &amp; Team'));
for (const link of links) {
  let prevented = false;
  link.onclick({preventDefault(){ prevented = true; }});
  assert.equal(prevented,true);
}
assert.deepEqual(loaded,ids,'each flag opens its own match');
assert.deepEqual(tabs,['draftsim','draftsim','draftsim']);
assert.ok(focused && scrolled,'navigation brings the simulator into view');
allowLoad = false;
links[0].onclick({preventDefault(){}});
assert.equal(tabs.length,3,'an unsuccessful load does not navigate away');
validation.records = [];
links = [];
validation.renderValidation([]);
assert.ok(root.innerHTML.includes('No validation issues found.'));
console.log('DLNS validation: all flag types link to saved drafts, player/region/revision restoration, read-only access and missing-match handling passed.');
