import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script, createContext } from 'node:vm';

const require = createRequire(import.meta.url);
const model = require('../dlns/model.js');
const html = await fs.readFile(new URL('../DLNS.html',import.meta.url),'utf8');
const source = await fs.readFile(new URL('../dlns/submission.js',import.meta.url),'utf8');
const record = (hero,player,week,team = 'Alpha',region = 'EU',type = 'Pick') => ({hero,player,team,region,type,matchid:`${week}-${region}-C-1`});
const records = [
  record('Haze','Earlier',10),record('Haze','Latest',11),record('Haze','',12),
  record('Haze','Wrong region',20,'Alpha','NA'),record('Haze','Wrong team',20,'Other'),
  record('Haze','Ban',20,'Alpha','EU','Ban'),record('Ivy','Ivy player',17),
  record('Abrams','Do not overwrite',18),record('Pocket','Wrong team',19,'Other'),
  record('Shiv','Right player',16,'Bravo'),record('Shiv','Wrong side',22)
];
const sim = {left:'Alpha',right:'Bravo',slots:{
  left:{picks:['Abrams','Haze','Ivy','Pocket','',''],bans:['Yamato','Kelvin']},
  right:{picks:['Shiv','Dynamo','','','',''],bans:['Warden','Wraith']}
}};
const saved = {region:'EU',players:{Abrams:'Manual player',Haze:''},editing:'70-EU-C-1',revision:5,selected:'70-EU-C-1'};

for (const admin of [false,true]) {
  let persisted = structuredClone(saved), saves = 0, writes = 0;
  const window = {
    DLNSModel:model,
    DLNSDatabase:{matches:[],teams:[],auth:{admin},subscribe(){},initAuth(){},saveMatch(){ writes++; }},
    DLNSApp:{getRecords:()=>records,getSim:()=>sim,setSim(){ assert.fail('filling players must not replace the draft'); }},
    renderDraftSim(){},addEventListener(){}
  };
  const context = createContext({window,document:{getElementById:()=>null,querySelectorAll:()=>[]},
    localStorage:{getItem:()=>JSON.stringify(saved),setItem:(_key,value)=>{ persisted = JSON.parse(value); saves++; }}
  });
  new Script(source).runInContext(context);
  assert.equal(saves,0,'rendering does not automatically assign players');
  window.DLNSMatchEntry.fillPlayers();
  if (!admin) {
    assert.deepEqual(persisted,saved,'read-only users cannot fill assignments');
    assert.equal(saves,0);
    continue;
  }
  assert.deepEqual(persisted.players,{Abrams:'Manual player',Haze:'Latest',Ivy:'Ivy player',Shiv:'Right player'});
  assert.equal(saves,1);
  assert.equal(persisted.editing,saved.editing);
  assert.equal(persisted.revision,5);
  assert.equal(persisted.selected,saved.selected);
  assert.ok(!Object.hasOwn(persisted,'autoPlayers'),'explicitly filled players survive refresh');
  window.DLNSMatchEntry.fillPlayers();
  assert.equal(saves,1,'repeating the action leaves filled slots unchanged');
  records.push(record('Haze','Newer player',30),record('Pocket','Pocket player',30));
  window.DLNSMatchEntry.fillPlayers();
  assert.equal(persisted.players.Haze,'Latest','existing assignments are preserved');
  assert.equal(persisted.players.Pocket,'Pocket player','newly available matches can fill remaining empty slots');
  assert.equal(saves,2);
  assert.equal(writes,0,'filling assignments does not submit the match');
}

const center = createContext({window:{DLNSDatabase:{auth:{admin:true}},DLNSMatchEntry:{}},
  sim:{first:'left',step:1,events:[{type:'pick'}]},seq:()=>Array(16),
  simSeriesScore:()=>'',simSideToggle:kind=>`<fieldset>${kind}</fieldset>`
});
new Script(html.slice(html.indexOf('function simCenterHTML('),html.indexOf('function sideHTML('))).runInContext(center);
let markup = center.simCenterHTML(null);
assert.ok(markup.includes('id="simFillPlayers"'));
assert.ok(markup.includes('>Fill players</button>'));
assert.ok(!markup.includes('disabled'));
assert.ok(markup.indexOf('Winner</fieldset>') < markup.indexOf('id="simFillPlayers"'),'the button follows the winner toggle');
center.window.DLNSMatchEntry.saving = true;
assert.ok(center.simCenterHTML(null).includes('disabled'));
center.window.DLNSMatchEntry.saving = false;
center.sim.events = [{type:'ban'}];
assert.ok(center.simCenterHTML(null).includes('disabled'),'at least one pick is required');
center.window.DLNSDatabase.auth.admin = false;
assert.ok(!center.simCenterHTML(null).includes('simFillPlayers'),'read-only visitors do not see the assignment button');
console.log('DLNS fill players: latest team/hero/region lookup, empty slots, existing assignments, persistence, owner-only access and button states passed.');
