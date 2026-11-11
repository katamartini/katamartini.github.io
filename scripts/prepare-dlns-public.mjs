// Prepare a new reviewable public file; never publish or overwrite existing files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const model=require('../dlns/model.js');
const {validate}=require('../dlns/local-store.js')(model,null);
const [input,output]=process.argv.slice(2);
if(!input || !output)throw Error('Usage: node scripts/prepare-dlns-public.mjs backup.json NEW-output.json');
const source=validate(JSON.parse(await fs.readFile(input,'utf8')));
const fields=['match_id','week','region','round','game','left_team','right_team','first_pick','winner','revision','source'];
const data={format:'dlns-local-v1',exported_at:new Date().toISOString(),source:'Reviewed fallback export; not a recovered database',matches:source.matches.map(match=>({...Object.fromEntries(fields.filter(key=>Object.hasOwn(match,key)).map(key=>[key,match[key]])),actions:match.actions.map(action=>Object.fromEntries(['type','order','side','hero','player'].filter(key=>Object.hasOwn(action,key)).map(key=>[key,action[key]])))})),teams:source.teams.map(({name,region})=>({name,region}))};
validate(data);
await fs.writeFile(path.resolve(output),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(`Prepared ${data.matches.length} matches and ${data.teams.length} teams. Audit history and cache metadata excluded. Review before publishing.`);
