/* Public GitHub-backed history; legacy browser data is export-only. */
(function(){
  'use strict';
  const SNAPSHOT='dlns/published-history.json'; // Change only to a separately reviewed public export.
  const store=createDLNSLocalStore(DLNSModel,window.indexedDB);
  const github=createDLNSGitHubStore(DLNSModel,store.validate);
  let state={version:0,matches:[],teams:[]}, ready=false, restoreBrowser, restoreChecked=false, authMessage='', remembered=false, disconnectPending=false;
  const BROWSER_KEY='dlns.github.remembered-token.v1';
  function browserToken(value){
    try{
      if(value===undefined)return localStorage.getItem(BROWSER_KEY);
      if(value)localStorage.setItem(BROWSER_KEY,value);
      else localStorage.removeItem(BROWSER_KEY);
      return true;
    }catch(_){return value===undefined ? null : false;}
  }
  const listeners=new Set();
  const notify=()=>listeners.forEach(fn=>fn(db.auth));
  function forget(expected){
    if(expected===undefined || browserToken()===expected)browserToken(null);
    remembered=false;
  }
  function finishExternalSignOut(){
    if(!disconnectPending || github.busy)return false;
    disconnectPending=false;remembered=false;github.disconnect();notify();
    db.reload().catch(()=>{});return true;
  }
  window.addEventListener('storage',event=>{
    if((event.key!==BROWSER_KEY && event.key!==null) || (event.key===BROWSER_KEY && event.oldValue===event.newValue) || !remembered)return;
    disconnectPending=true;
    if(!finishExternalSignOut())notify();
  });
  function accept(next){state=next;ready=true;listeners.forEach(fn=>fn(db.auth));return db.matches;}
  async function operation(action){
    const promise=action();listeners.forEach(fn=>fn(db.auth));
    try{return await promise;}finally{
      if(!github.user && remembered && !disconnectPending)forget();
      if(!finishExternalSignOut())notify();
    }
  }
  async function readSnapshot(){
    const response=await fetch(SNAPSHOT,{cache:'no-store'});
    if(!response.ok)throw Error(`Published history could not be loaded (${response.status}).`);
    return store.validate(await response.json());
  }
  const db=window.DLNSDatabase={
    local:false,
    get auth(){return {user:github.user,admin:ready&&!!github.user&&!disconnectPending,ready:true,busy:github.busy,error:authMessage};},
    get version(){return state.version;},
    get matches(){return state.matches.slice().sort((a,b)=>DLNSModel.chronology(a)-DLNSModel.chronology(b));},
    get teams(){return state.teams || [];},
    get sourceNote(){
      const last=db.matches.at(-1)?.match_id || 'none';
      if(github.user)return `GitHub history: ${state.matches.length} matches; last match ${last}. Connected as ${github.user.login}. Saves create public commits; Pages may take a few minutes to update.`;
      return `Match history: ${state.matches.length} matches; last match ${last}.`;
    },
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},initAuth(){},
    signIn(){if(github.busy)return;const dialog=document.getElementById('githubAuthDialog');dialog.showModal();document.getElementById('githubToken').focus();},
    async signOut(){github.disconnect();forget();restoreChecked=true;authMessage='';notify();await db.reload();},
    async reload(){await db.loadMatches();window.DLNSApp.applyMatches(db.matches);},
    async loadMatches(){
      if(!restoreChecked){
        restoreChecked=true;
        const saved=browserToken();
        if(saved){
          const pending=github.connect(saved);
          restoreBrowser=pending.then(result=>{
            if(browserToken()!==saved){ github.disconnect(); return null; }
            remembered=true; return result;
          }).catch(error=>{
            if(error.invalidCredential)forget(saved);
            authMessage=error.invalidCredential?'The saved GitHub token is no longer valid. Sign in again.':'Could not restore GitHub sign-in. Your saved token was not removed.';
            return null;
          }).finally(()=>{restoreBrowser=null;});
          notify();
        }
      }
      if(restoreBrowser){
        const restored=await restoreBrowser;
        if(restored)return accept(restored);
      }
      try{return accept(github.user ? await github.read() : await readSnapshot());}
      finally{if(!github.user && remembered && !disconnectPending)forget();}
    },
    async saveMatch(match,revision,originalId,workspaceVersion){
      if(!db.auth.admin)throw Error('Sign in with your GitHub token to edit.');
      accept(await operation(()=>github.saveMatch(match,revision,originalId,originalId ? workspaceVersion : state.version)));
      return state.matches.find(item=>item.match_id===match.match_id);
    },
    async addTeam(name,region){
      if(!db.auth.admin)throw Error('Sign in with your GitHub token to edit.');
      accept(await operation(()=>github.addTeam(name,region,state.version)));
      return state.teams.find(t=>t.region===region && t.name.trim().toLowerCase()===name.trim().toLowerCase());
    }
  };
  function download(content,name){
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.addEventListener('DOMContentLoaded',()=>{
    const $=id=>document.getElementById(id);
    const dialog=document.createElement('dialog');dialog.id='githubAuthDialog';dialog.className='matchTeamDialog';
    dialog.setAttribute('aria-labelledby','githubAuthTitle');
    dialog.innerHTML='<form><h2 id="githubAuthTitle">Sign in with GitHub</h2><p>Use your fine-grained GitHub token to publish matches as katamartini. This is a token connection, not OAuth.</p><label>Token <input id="githubToken" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required></label><label class="githubRememberBrowser"><input id="githubRememberBrowser" type="checkbox" autocomplete="off"> Remember this browser</label><details><summary>Token setup &amp; security</summary><p>Create a fine-grained token in <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">GitHub settings</a>: owner katamartini, only katamartini.github.io, Contents: Read and write, short expiration. Metadata read is automatic. This grants contents access across the repository, not only DLNS.</p><p>The token is sent only to api.github.com. By default it is kept in page memory and refresh clears it. The checkbox saves it in this site’s browser storage so it survives refreshes and browser restarts. Site scripts and extensions may be able to read it. Use this option only on a trusted device. Sign out or clear site data to remove it. Never paste a token into chat.</p></details><p id="githubStatus" role="status"></p><div class="matchEntryActions"><button type="button" id="githubCancel">Cancel</button><button type="submit" id="githubConnect">Sign in</button></div></form>';
    document.body.append(dialog);
    let connecting=false;
    const dismiss=()=>{if(connecting)return; $('githubToken').value='';$('githubRememberBrowser').checked=false;$('githubStatus').textContent='';dialog.close();};
    $('githubCancel').onclick=dismiss;
    dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(connecting)return;
      let value=$('githubToken').value;$('githubToken').value='';connecting=true;
      const remember=$('githubRememberBrowser');
      $('githubConnect').disabled=true;$('githubCancel').disabled=true;$('githubToken').disabled=true;remember.disabled=true;$('githubStatus').textContent='Connecting…';
      try{
        const next=await github.connect(value);
        restoreChecked=true;authMessage='';
        remembered=remember.checked && browserToken(value.trim());
        if(!remember.checked)forget();
        if(remember.checked&&!remembered)authMessage='Signed in for this page, but browser storage is unavailable.';
        accept(next);window.DLNSApp.applyMatches(db.matches);$('githubStatus').textContent='';remember.checked=false;dialog.close();
      }
      catch(error){$('githubStatus').textContent=error.message;}
      finally{value='';connecting=false;$('githubConnect').disabled=false;$('githubCancel').disabled=false;$('githubToken').disabled=false;remember.disabled=false;listeners.forEach(fn=>fn(db.auth));}
    };
    // Recovery is intentionally export-only. Never import, delete, or mutate old browser records.
    const panel=document.createElement('details');panel.className='panel';panel.id='legacyRecovery';
    panel.innerHTML='<summary>Recover older browser-only data</summary><p>Older local matches and drafts are still stored in this browser, but new submissions now publish through GitHub. Download these backups before clearing site data. Nothing here publishes or changes your saved data.</p><button id="localExport">Download older local matches</button> <button id="localCacheExport">Download original database cache</button> <button id="legacyDraftExport">Download older draft forms</button><p id="localStatus" role="status"></p>';
    (document.querySelector('main') || document.body).append(panel);
    async function recover(action){try{await action();$('localStatus').textContent='Backup downloaded. Existing browser data is unchanged.';}catch(error){$('localStatus').textContent=error.message;}}
    $('localExport').onclick=()=>recover(async()=>download(JSON.stringify({...await store.read(),exported_at:new Date().toISOString()},null,2),`dlns-local-${Date.now()}.json`));
    $('localCacheExport').onclick=()=>recover(async()=>{const raw=localStorage.getItem('dlns.database.matches.v1');if(!raw)throw Error('No original cache in this browser. Try the device and browser used previously.');download(raw,`dlns-original-cache-${Date.now()}.json`);});
    $('legacyDraftExport').onclick=()=>recover(async()=>{
      const keys=['dlns.local.sim.v1','dlns.local.matchEntry.v1','dlns.matchEntry.v1','draftSimulator.v1'];
      const drafts=Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]).filter(([,value])=>value!==null));
      if(!Object.keys(drafts).length)throw Error('No older draft forms in this browser.');
      download(JSON.stringify({format:'dlns-legacy-drafts-v1',drafts},null,2),`dlns-older-drafts-${Date.now()}.json`);
    });
  });
})();
