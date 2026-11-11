import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('../.cache/dlns-tools/node_modules/playwright');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const server=http.createServer(async(req,res)=>{
  try{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+'/'))throw Error();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({acceptDownloads:true});
  const requests=[],errors=[];
  await context.route('**/*',route=>{
    requests.push(route.request().url());
    if(!route.request().url().startsWith(origin))return route.abort();
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  // Default route is static and read-only, including old OAuth query strings.
  await page.goto(origin+'/DLNS.html?code=obsolete#draftsim');
  await page.waitForFunction(()=>window.DLNSDatabase?.matches.length===363);
  assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
  assert.equal(await page.locator('#simSignIn').count(),0);
  assert.equal(await page.locator('#simSubmitMatch').count(),0);
  const cache='{"at":123,"matches":[],"teams":[]}';
  await page.evaluate(raw=>{localStorage.setItem('dlns.database.matches.v1',raw);localStorage.setItem('dlns.matchEntry.v1','original entry');localStorage.setItem('draftSimulator.v1','original draft');localStorage.setItem('dlns.auth.v1','original auth');},cache);
  await page.goto(origin+'/DLNS.html?storage=local#draftsim');
  await page.waitForFunction(()=>window.DLNSDatabase.auth.admin);
  assert.equal(await page.evaluate(()=>DLNSDatabase.matches.length),0);
  const download=page.waitForEvent('download');await page.locator('#localCacheExport').click();
  assert.equal(await fs.readFile(await (await download).path(),'utf8'),cache);
  await page.locator('#localSeed').click();await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  await page.locator('#simLoadMatch').selectOption('54-NA-F-2');await page.locator('#simLoadMatchBtn').click();
  await page.locator('#simSubmitMatch').click();
  await page.waitForFunction(()=>DLNSDatabase.matches.find(m=>m.match_id==='54-NA-F-2').revision===2);
  assert.match(await page.locator('#simMatchStatus').innerText(),/locally/);
  const exportEvent=page.waitForEvent('download');await page.locator('#localExport').click();
  const exported=JSON.parse(await fs.readFile(await (await exportEvent).path(),'utf8'));
  assert.equal(exported.matches.length,363);assert.equal(exported.changes.at(-1).kind,'save');
  await page.reload();await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  assert.equal(await page.evaluate(()=>DLNSDatabase.matches.find(m=>m.match_id==='54-NA-F-2').revision),2);
  await page.locator('#localImport').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"matches":[{}]}')});
  await page.waitForFunction(()=>document.getElementById('localStatus').textContent.includes('Enter a week'));
  assert.equal(await page.evaluate(()=>DLNSDatabase.matches.length),363);
  await page.locator('#localImport').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.waitForFunction(()=>document.getElementById('localStatus').textContent.startsWith('Imported'));
  await page.locator('#simSubmitMatch').click();
  await page.waitForFunction(()=>document.getElementById('simMatchStatus').textContent.includes('Workspace changed'));
  await page.goto(origin+'/DLNS.html#draftsim');await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
  assert.equal(await page.evaluate(()=>DLNSDatabase.matches.find(m=>m.match_id==='54-NA-F-2').revision),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.database.matches.v1')),cache);
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.matchEntry.v1')),'original entry');
  assert.equal(await page.evaluate(()=>localStorage.getItem('draftSimulator.v1')),'original draft');
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.auth.v1')),'original auth');
  // Public viewing must work even if browser storage is unavailable.
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:null}));
  await page.reload();await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  await page.goto(origin+'/DLNS.html?storage=local');
  await page.waitForFunction(()=>document.getElementById('error').textContent.includes('storage is unavailable'));
  assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
  assert.equal(requests.filter(url=>url.includes('supabase')).length,0);
  assert.deepEqual(errors,[]);
  console.log('PASS Chromium: default public view, editor save, backup round trip, invalid import and stale edit rejection, persistence, original cache/auth/drafts preserved, storage failure, zero Supabase requests or page errors.');
}finally{await browser.close();server.close();}
