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
  // Old OAuth and local-workspace links now show the same public, read-only view.
  await page.goto(origin+'/DLNS.html?code=obsolete#draftsim');
  await page.waitForFunction(()=>window.DLNSDatabase?.matches.length===363);
  assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
  assert.equal(await page.locator('#simSignIn').count(),1);
  assert.equal(await page.locator('#simSubmitMatch').count(),0);
  const cache='{"at":123,"matches":[],"teams":[]}';
  const original=JSON.parse(await fs.readFile(path.join(root,'dlns/published-history.json'),'utf8'));
  const preserved=await page.evaluate(async({raw,snapshot})=>{
    localStorage.setItem('dlns.database.matches.v1',raw);
    localStorage.setItem('dlns.matchEntry.v1','original entry');
    localStorage.setItem('dlns.local.matchEntry.v1','original local entry');
    localStorage.setItem('dlns.local.sim.v1','original local simulator');
    localStorage.setItem('draftSimulator.v1','original draft');
    localStorage.setItem('dlns.auth.v1','original auth');
    const store=createDLNSLocalStore(DLNSModel,indexedDB);
    await store.importData(snapshot,'pre-existing browser workspace',0);
    return store.read();
  },{raw:cache,snapshot:original});
  await page.goto(origin+'/DLNS.html?storage=local#draftsim');
  await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
  assert.equal(await page.locator('#simSubmitMatch, #localImport, #localSeed').count(),0);
  assert.equal(await page.locator('a[href*="storage=local"]').count(),0);
  const recovery=page.locator('details').filter({has:page.locator('#localExport')});
  assert.equal(await recovery.evaluate(node=>node.open),false);
  await recovery.locator('summary').click();
  const download=page.waitForEvent('download');await page.locator('#localCacheExport').click();
  assert.equal(await fs.readFile(await (await download).path(),'utf8'),cache);
  const exportEvent=page.waitForEvent('download');await page.locator('#localExport').click();
  const exported=JSON.parse(await fs.readFile(await (await exportEvent).path(),'utf8'));
  delete exported.exported_at;
  assert.deepEqual(exported,preserved);
  const draftsEvent=page.waitForEvent('download');await page.locator('#legacyDraftExport').click();
  const drafts=JSON.parse(await fs.readFile(await (await draftsEvent).path(),'utf8'));
  assert.deepEqual(drafts,{format:'dlns-legacy-drafts-v1',drafts:{'dlns.local.sim.v1':'original local simulator','dlns.local.matchEntry.v1':'original local entry','dlns.matchEntry.v1':'original entry','draftSimulator.v1':'original draft'}});
  await page.reload();await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  assert.deepEqual(await page.evaluate(()=>createDLNSLocalStore(DLNSModel,indexedDB).read()),preserved);
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.database.matches.v1')),cache);
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.matchEntry.v1')),'original entry');
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.local.matchEntry.v1')),'original local entry');
  assert.equal(await page.evaluate(()=>localStorage.getItem('draftSimulator.v1')),'original draft');
  assert.equal(await page.evaluate(()=>localStorage.getItem('dlns.auth.v1')),'original auth');
  // Public viewing and the original-cache export do not depend on IndexedDB.
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:null}));
  await page.reload();await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
  await page.locator('details').filter({has:page.locator('#localExport')}).locator('summary').click();
  await page.locator('#localExport').click();
  await page.waitForFunction(()=>document.getElementById('localStatus').textContent.includes('storage is unavailable'));
  assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
  assert.equal(await page.evaluate(()=>DLNSDatabase.matches.length),363);
  assert.equal(requests.filter(url=>url.includes('supabase')).length,0);
  assert.deepEqual(errors,[]);
  console.log('PASS Chromium recovery: public and legacy URLs read-only, no local submission/import, collapsed recovery, exact cache and IndexedDB exports, originals unchanged, storage failure isolated, zero Supabase requests or page errors.');
}finally{await browser.close();server.close();}
