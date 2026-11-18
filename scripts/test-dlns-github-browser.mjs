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
 const context=await browser.newContext(),errors=[];
 const original=JSON.parse(await fs.readFile(path.join(root,'dlns/published-history.json'),'utf8'));
 let data=structuredClone(original),sha='sha1',writes=0,owner=66887569,failure=0;
 await context.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(url.startsWith(origin))return route.continue();
  if(!url.startsWith('https://api.github.com/'))return route.abort();
  let body;
  if(url.endsWith('/user'))body={id:owner,login:'katamartini'};
  else if(url.endsWith('/katamartini.github.io'))body={owner:{id:66887569},full_name:'katamartini/katamartini.github.io',permissions:{push:true}};
  else if(request.method()==='PUT'){
    writes++; if(failure)return route.fulfill({status:failure,contentType:'application/json',body:'{}'});
    const update=request.postDataJSON();assert.equal(update.sha,sha);
    data=JSON.parse(Buffer.from(update.content,'base64').toString());sha='sha'+(writes+1);
    body={content:{sha},commit:{sha:'commit'+writes}};
  }else body={type:'file',sha,encoding:'base64',content:Buffer.from(JSON.stringify(data)).toString('base64')};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/DLNS.html#draftsim');await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
 assert.equal(await page.locator('#simSubmitMatch').count(),0);
 await page.locator('summary').filter({hasText:'Owner: connect'}).click();
 await page.locator('#githubToken').fill('github_pat_TEST');await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>!!DLNSDatabase.auth.user);assert.equal(await page.locator('#githubToken').inputValue(),'');
 assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes('github_pat_TEST'));
 await page.locator('#simLoadMatch').selectOption('54-NA-F-2');await page.locator('#simLoadMatchBtn').click();
 await page.locator('#simSubmitMatch').click();await page.waitForFunction(()=>DLNSDatabase.matches.find(m=>m.match_id==='54-NA-F-2').revision===2);
 assert.equal(writes,1);assert.match(await page.locator('#simMatchStatus').innerText(),/GitHub/);
 assert.deepEqual(data.matches.filter(m=>m.match_id!=='54-NA-F-2'),original.matches.filter(m=>m.match_id!=='54-NA-F-2'));
 sha='external-change';await page.locator('#simSubmitMatch').click();
 await page.waitForFunction(()=>document.getElementById('simMatchStatus').textContent.includes('History changed'));
 assert.equal(writes,1);
 await page.locator('#githubReload').click();await page.waitForFunction(()=>DLNSDatabase.version==='external-change');
 await page.locator('#simLoadMatchBtn').click();failure=403;await page.locator('#simSubmitMatch').click();
 await page.waitForFunction(()=>document.getElementById('simMatchStatus').textContent.includes('denied'));
 assert.equal(writes,2);failure=0;
 await page.locator('#githubDisconnect').click();await page.waitForFunction(()=>!DLNSDatabase.auth.user && !document.getElementById('simSubmitMatch')); 
 assert.equal(await page.locator('#simSubmitMatch').count(),0);
 owner=123;await page.locator('#githubToken').fill('github_pat_OTHER');await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>document.getElementById('githubStatus').textContent.includes('Only'));
 assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
 owner=66887569;await page.locator('#githubToken').fill('github_pat_TEST');await page.locator('#githubConnect').click();await page.waitForFunction(()=>!!DLNSDatabase.auth.user);
 await page.reload();await page.waitForFunction(()=>DLNSDatabase.matches.length===363);
 assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);assert.equal(await page.locator('#githubToken').inputValue(),'');
 assert.deepEqual(errors,[]);
 console.log('PASS token Chromium: public anonymous view, connect/save, data preservation, stale conflict, denied write, disconnect, wrong owner, reload clears credentials, no page errors. All GitHub requests mocked.');
}finally{await browser.close();server.close();}
