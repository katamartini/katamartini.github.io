import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {githubWriteFixture} from './test-dlns-fixture.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('../.cache/dlns-tools/node_modules/playwright');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const original=githubWriteFixture();
const publishedCount=original.matches.length;
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/dlns/published-history.json'){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(original));return;
    }
    const file=path.resolve(root,'.'+pathname);
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
 const rememberKey='dlns.github.remembered-token.v1';
 let authStatus=0;
 let data=structuredClone(original),sha='sha1',writes=0,owner=66887569,failure=0,readGate=null;
 await context.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(url.startsWith(origin))return route.continue();
  if(!url.startsWith('https://api.github.com/'))return route.abort();
  let body;
  if(url.endsWith('/user')){if(authStatus)return route.fulfill({status:authStatus,json:{}});body={id:owner,login:'katamartini'};}
  else if(url.endsWith('/katamartini.github.io'))body={owner:{id:66887569},full_name:'katamartini/katamartini.github.io',permissions:{push:true}};
  else if(request.method()==='PUT'){
    writes++; if(failure)return route.fulfill({status:failure,contentType:'application/json',body:'{}'});
    const update=request.postDataJSON();assert.equal(update.sha,sha);
    data=JSON.parse(Buffer.from(update.content,'base64').toString());sha='sha'+(writes+1);
    body={content:{sha},commit:{sha:'commit'+writes}};
  }else {if(readGate)await readGate;body={type:'file',sha,encoding:'base64',content:Buffer.from(JSON.stringify(data)).toString('base64')};}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/DLNS.html#draftsim');await page.waitForFunction((count)=>DLNSDatabase.matches.length===count,publishedCount);
 assert.equal(await page.locator('#simSubmitMatch').count(),0);
 assert.equal(await page.locator('.simSide.left .simSlot.ban').count(),3);
 await page.locator('#simDraftFormat').selectOption('61');
 assert.equal(await page.locator('.simSide.right .simSlot.ban').count(),2);
 await page.locator('#simDraftFormat').selectOption('62');
 assert.equal(await page.locator('.simSide.right .simSlot.ban').count(),3);
 const activeBan=side=>page.locator('.simSide.'+side+' .simSlot.ban').evaluateAll(slots=>slots.findIndex(slot=>slot.classList.contains('active')));
 assert.equal(await activeBan('left'),0,'the first modern ban highlights the outer-left slot');
 await page.locator('.simHeroBtn[data-hero="Abrams"]').click();
 assert.equal(await activeBan('right'),2,'the second modern ban highlights the outer-right slot');
 await page.locator('.simHeroBtn[data-hero="Bebop"]').click();
 assert.equal(await activeBan('left'),1,'the next left ban moves inward');
 await page.reload();
 await page.waitForFunction((count)=>DLNSDatabase.matches.length===count,publishedCount);
 assert.deepEqual(await page.evaluate(()=>[draftSimState.slots.left.bans,draftSimState.slots.right.bans]),[['Abrams','',''],['','','Bebop']]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await activeBan('right'),2,'Undo reopens the outside slot');
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.locator('#simDraftFormat').selectOption('61');
 assert.equal(await activeBan('left'),1,'legacy bans still begin at the inside-left slot');
 await page.locator('#simDraftFormat').selectOption('62');

 assert.equal(await page.locator('a[href*="storage=local"]').count(),0);
 assert.match(await page.locator('#simSignIn').innerText(),/Sign in with GitHub/);
 await page.locator('#simSignIn').click();
 await page.locator('#githubToken').fill('github_pat_CANCEL');
 await page.locator('#githubCancel').click();
 await page.locator('#githubAuthDialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#githubAuthDialog').isVisible(),false);
 assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
 await page.locator('#simSignIn').click();
 assert.equal(await page.locator('#githubToken').inputValue(),'');
 await page.locator('#githubToken').fill('github_pat_ESCAPE');
 await page.keyboard.press('Escape');
 await page.locator('#githubAuthDialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#githubAuthDialog').isVisible(),false);
 await page.locator('#simSignIn').click();
 assert.equal(await page.locator('#githubToken').inputValue(),'');
 await page.locator('#githubToken').fill('github_pat_TEST');await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>!!DLNSDatabase.auth.user && !!document.getElementById('simSubmitMatch'));
 await page.locator('#githubAuthDialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#githubAuthDialog').isVisible(),false);
 assert.match(await page.locator('.matchAuth').innerText(),/katamartini/);
 assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes('github_pat_TEST'));
 await page.locator('#simLoadMatch').selectOption('54-NA-F-2');await page.locator('#simLoadMatchBtn').click();
 assert.equal(await page.locator('.simSide.left .simSlot.ban').count(),2);
 await page.locator('#simSubmitMatch').click();await page.waitForFunction(()=>DLNSDatabase.matches.find(m=>m.match_id==='54-NA-F-2').revision===2);
 assert.equal(writes,1);assert.match(await page.locator('#simMatchStatus').innerText(),/GitHub/);
 assert.deepEqual(data.matches.filter(m=>m.match_id!=='54-NA-F-2'),original.matches.filter(m=>m.match_id!=='54-NA-F-2'));
 sha='external-change';await page.locator('#simSubmitMatch').click();
 await page.waitForFunction(()=>document.getElementById('simMatchStatus').textContent.includes('History changed'));
 assert.equal(writes,1);
 let releaseRead;readGate=new Promise(resolve=>{releaseRead=resolve;});await page.locator('#githubReload').click();
 assert.equal(await page.locator('#simSubmitMatch').isDisabled(),true);
 releaseRead();readGate=null;await page.waitForFunction(()=>DLNSDatabase.version==='external-change');
 await page.locator('#simLoadMatchBtn').click();failure=403;await page.locator('#simSubmitMatch').click();
 await page.waitForFunction(()=>document.getElementById('simMatchStatus').textContent.includes('denied'));
 assert.equal(writes,2);failure=0;
 await page.locator('#simSignOut').click();await page.waitForFunction(()=>!DLNSDatabase.auth.user && !document.getElementById('simSubmitMatch'));
 assert.equal(await page.locator('#simSubmitMatch').count(),0);
 owner=123;await page.locator('#simSignIn').click();await page.locator('#githubToken').fill('github_pat_OTHER');await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>document.getElementById('githubStatus').textContent.includes('Only'));
 assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);
 owner=66887569;await page.locator('#githubToken').fill('github_pat_TEST');await page.locator('#githubConnect').click();await page.waitForFunction(()=>!!DLNSDatabase.auth.user);
 await page.reload();await page.waitForFunction((count)=>DLNSDatabase.matches.length===count,publishedCount);
 assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);await page.locator('#simSignIn').click();assert.equal(await page.locator('#githubToken').inputValue(),'');
 await page.locator('#githubCancel').click();
 await page.goto(origin+'/DLNS.html?storage=local#draftsim');await page.waitForFunction((count)=>DLNSDatabase.matches.length===count,publishedCount);
 assert.equal(await page.evaluate(()=>DLNSDatabase.auth.admin),false);assert.equal(await page.locator('#simSubmitMatch').count(),0);
 assert.equal(await page.locator('#localImport, #localSeed').count(),0);
 assert.equal(await page.locator('a[href*="storage=local"]').count(),0);
 // Persistent sign-in is opt-in, separate from Ballin, and revalidates owner/repo on every new page.
 const ballinKey='ballin.githubBackupToken.v1';
 await page.evaluate(key=>localStorage.setItem(key,'ballin-fixture-untouched'),ballinKey);
 await page.locator('#simSignIn').click();
 assert.equal(await page.locator('#githubRememberBrowser').isChecked(),false);
 await page.locator('#githubToken').fill('github_pat_REMEMBER');
 await page.locator('#githubRememberBrowser').check();
 await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>DLNSDatabase.auth.admin && !!document.getElementById('simNewMatch'));
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),rememberKey),'github_pat_REMEMBER');
 await page.reload();
 await page.waitForFunction(()=>DLNSDatabase.auth.admin && !!document.getElementById('simNewMatch'));
 const second=await context.newPage();
 await second.goto(origin+'/DLNS.html#draftsim');
 await second.waitForFunction(()=>DLNSDatabase.auth.admin && !!document.getElementById('simNewMatch'));
 await page.locator('#simSignOut').click();
 await second.waitForFunction(()=>!DLNSDatabase.auth.admin);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),rememberKey),null);
 assert.equal(await second.evaluate(key=>localStorage.getItem(key),ballinKey),'ballin-fixture-untouched');
 await second.close();

 // Temporary errors preserve the opt-in, expired tokens clear it.
 await page.evaluate(key=>localStorage.setItem(key,'github_pat_REMEMBER'),rememberKey);
 authStatus=502;
 await page.reload();
 await page.waitForFunction(()=>DLNSDatabase.auth.error.includes('not removed'));
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),rememberKey),'github_pat_REMEMBER');
 authStatus=401;
 await page.reload();
 await page.waitForFunction(()=>DLNSDatabase.auth.error.includes('no longer valid'));
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),rememberKey),null);
 authStatus=0;

 await page.locator('#simSignIn').click();
 await page.locator('#githubToken').fill('github_pat_TEST');
 await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>DLNSDatabase.auth.admin && !!document.getElementById('simNewMatch'));
 await page.locator('#simNewMatch').click();
 const setWeek=async week=>{const input=page.locator('#simMatchWeek');await input.fill(String(week));await input.press('Tab');};
 await setWeek(61);
 assert.equal(await page.locator('.simSide.left .simSlot.ban').count(),2);
 await setWeek(62);
 assert.equal(await page.locator('.simSide.left .simSlot.ban').count(),3);
 const left=original.matches.find(match=>match.match_id==='54-EU-F-1').left_team;
 const right=original.matches.find(match=>match.match_id==='54-EU-F-1').right_team;
 await page.locator('#simLeftTeam').selectOption(left);
 await page.locator('#simRightTeam').selectOption(right);
 const heroes=await page.evaluate(()=>DLNSModel.heroes.slice(0,18));
 const choose=hero=>page.locator('.simHeroBtn[data-hero='+JSON.stringify(hero)+']').click();
 await choose(heroes[0]);
 await setWeek(61);
 assert.match(await page.locator('#simMatchStatus').innerText(),/Reset to switch/);
 assert.equal(await page.locator('#simSubmitMatch').isDisabled(),true);
 assert.equal(await page.evaluate(()=>draftSimState.step),1);
 await setWeek(62);
 assert.equal(await page.evaluate(()=>draftSimState.step),1);
 for(const hero of heroes.slice(1,16))await choose(hero);
 assert.equal(await page.locator('#simSubmitMatch').isDisabled(),true);
 for(const hero of heroes.slice(16))await choose(hero);
 const seq=['bL','bR','bL','bR','pL','pR','pR','pL','pR','pL','bR','bL','pR','pL','pL','pR','pL','pR'];
 const actual=await page.evaluate(()=>draftSimState.events.map(e=>e.type[0]+e.side[0].toUpperCase()));
 assert.deepEqual(actual,seq);
 assert.deepEqual(await page.evaluate(()=>[draftSimState.slots.left.bans,draftSimState.slots.right.bans]),
   [[heroes[0],heroes[2],heroes[11]],[heroes[10],heroes[3],heroes[1]]]);
 await setWeek(9999); // Mocked publication, independent of the real Shift 62 history.
 assert.equal(await page.locator('#simSubmitMatch').isDisabled(),false);
 await page.locator('#simSubmitMatch').click();
 await page.waitForFunction(()=>DLNSDatabase.matches.find(match=>match.match_id==='9999-EU-C-1')?.revision===1);
 assert.equal(data.matches.find(match=>match.match_id==='9999-EU-C-1').actions.length,18);
 for(const [id,bans] of [['54-EU-F-1',2],['9999-EU-C-1',3]]){
   await page.locator('#simLoadMatch').selectOption(id);
   await page.locator('#simLoadMatchBtn').click();
   assert.equal(await page.locator('.simSide.right .simSlot.ban').count(),bans);
   assert.equal(await page.evaluate(()=>draftSimState.events.length),12+bans*2);
   if(bans===3)assert.deepEqual(await page.evaluate(()=>[draftSimState.slots.left.bans,draftSimState.slots.right.bans]),
     [[heroes[0],heroes[2],heroes[11]],[heroes[10],heroes[3],heroes[1]]]);
 }
 await page.setViewportSize({width:390,height:844});
 const side=await page.locator('.simSide.right .simBans').boundingBox();
 const third=await page.locator('.simSide.right .simSlot.ban').last().boundingBox();
 assert.ok(third.x+third.width<=side.x+side.width,'all three ban slots fit on mobile');
 // Recreate a current-window fixture; no APAC drafts are added to the real snapshot.
 const fixtureMatches=await page.evaluate(()=>{
  const game=(week,region,round,game,winner)=>{
   const meta={week,region,round,game,first_pick:'left',winner,left_team:region+' left',right_team:region+' right'};
   return {...meta,match_id:DLNSModel.matchId(meta),revision:1,source:'github',
    actions:DLNSModel.sequence('left',week,region).map((e,i)=>({...e,hero:DLNSModel.heroes[i]}))};
  };
  return ['EU','NA'].flatMap(region=>[game(63,region,'Challenger',1,'left'),game(63,region,'Finals',1,'left'),game(63,region,'Finals',2,'left')]);
 });
 data={...structuredClone(original),matches:[...original.matches,...fixtureMatches],
  teams:[...original.teams,{name:'APAC left',region:'APAC'},{name:'APAC right',region:'APAC'}]};
 sha='apac-baseline';
 await page.locator('#githubReload').click();
 await page.waitForFunction(()=>DLNSDatabase.matches.some(m=>m.match_id==='63-NA-F-2'));
 await page.locator('#simAutofillMatch').click();
 await page.waitForFunction(()=>document.getElementById('simMatchStatus').innerText.includes('Use New match'));
 await page.locator('#simNewMatch').click();
 assert.equal(await page.locator('#simMatchId').innerText(),'1-APAC-C-1');
 assert.equal(await page.locator('#simMatchDate').inputValue(),'2026-11-06');
 assert.equal(await page.locator('#simRegion').inputValue(),'APAC');
 assert.equal(await page.locator('.simSide.right .simSlot.ban').count(),3);
 await page.locator('#simRegion').selectOption('EU');
 assert.equal(await page.locator('#simMatchId').innerText(),'64-EU-C-1');
 await page.locator('#simAutofillMatch').click();
 await page.waitForFunction(()=>document.getElementById('simMatchId').innerText==='1-APAC-C-1');
 await page.locator('#simLeftTeam').selectOption('APAC left');
 await page.locator('#simRightTeam').selectOption('APAC right');
 for(const hero of heroes)await choose(hero);
 const beforeAPACWrites=writes;
 await page.locator('#simSubmitMatch').click();
 await page.waitForFunction(()=>DLNSDatabase.matches.some(m=>m.match_id==='1-APAC-C-1'));
 assert.equal(writes,beforeAPACWrites+1);
 assert.equal(data.matches.find(m=>m.match_id==='1-APAC-C-1').actions.length,18);
 assert.equal(data.matches.find(m=>m.match_id==='1-APAC-C-1').played_on,'2026-11-06');
 const template=data.matches.find(m=>m.match_id==='1-APAC-C-1');
 data.matches.push({...template,match_id:'1-APAC-F-1',round:'Finals',winner:'left'},
  {...template,match_id:'1-APAC-F-2',round:'Finals',game:2,winner:'right'});
 sha='apac-finals';
 await page.locator('#githubReload').click();
 await page.waitForFunction(()=>DLNSDatabase.matches.some(m=>m.match_id==='1-APAC-F-2'));
 await page.locator('#simNewMatch').click();
 assert.equal(await page.locator('#simMatchId').innerText(),'1-APAC-F-3');
 assert.equal(await page.locator('#simLeftTeam').inputValue(),'APAC left');
 assert.equal(await page.locator('#simRightTeam').inputValue(),'APAC right');
 await page.locator('#simLoadMatch').selectOption('1-APAC-C-1');
 await page.locator('#simLoadMatchBtn').click();
 await page.reload();
 await page.waitForFunction(()=>draftSimState.events.length===18);
 assert.equal(await page.locator('#simRegion').inputValue(),'APAC');
 await page.locator('#simSignIn').click();
 await page.locator('#githubToken').fill('github_pat_TEST');
 await page.locator('#githubConnect').click();
 await page.waitForFunction(()=>DLNSDatabase.auth.admin && DLNSDatabase.matches.some(m=>m.match_id==='1-APAC-F-2'));
 await page.locator('#tabBtn-search').click();
 assert.equal(await page.locator('#draftSearchResults .r.match').first().locator('b').first().innerText(),'1-APAC-F-2');
 await page.locator('#tabBtn-unseen').click();
 await page.locator('#region').selectOption('NA');
 await page.locator('#tabBtn-search').click();
 await page.waitForFunction(()=>document.querySelector('#draftSearchResults .r.match b')?.textContent==='63-NA-F-2');
 assert.deepEqual(errors,[]);
 console.log('PASS APAC Chromium: chronological suggestions, skip by region, mocked save/load/reload, three bans, same-series sides, search ordering, and region filtering.');
 assert.deepEqual(errors,[]);
 console.log('PASS token Chromium: public anonymous view, restored header, modal cancel/Escape/reopen, connect/save, data preservation, stale conflict, denied write, disconnect, wrong owner, reload clears credentials, old local URL read-only, two draft formats, reload and cross-tab token persistence, no page errors. All GitHub requests mocked.');
}finally{await browser.close();server.close();}
