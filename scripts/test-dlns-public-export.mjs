import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dlns-export-'));
try{
  const source=JSON.parse(await fs.readFile(new URL('../dlns/history.json',import.meta.url),'utf8'));
  source.changes=[{private:'old revisions'}];source.at=123;
  source.matches[0].created_by='private-id';source.matches[0].actions[0].unexpected='private';
  const input=path.join(dir,'input.json'),output=path.join(dir,'public.json');
  await fs.writeFile(input,JSON.stringify(source));
  const script=new URL('./prepare-dlns-public.mjs',import.meta.url).pathname;
  execFileSync(process.execPath,[script,input,output]);
  const result=JSON.parse(await fs.readFile(output,'utf8'));
  assert.equal(result.matches.length,363);
  assert.equal(result.changes,undefined);assert.equal(result.at,undefined);
  assert.equal(result.matches[0].created_by,undefined);assert.equal(result.matches[0].actions[0].unexpected,undefined);
  assert.throws(()=>execFileSync(process.execPath,[script,input,output],{stdio:'pipe'}));
  assert.deepEqual(JSON.parse(await fs.readFile(input,'utf8')),source);
  console.log('PASS public export: validated matches, private/unknown fields stripped, input unchanged, existing output protected.');
}finally{await fs.rm(dir,{recursive:true,force:true});}
