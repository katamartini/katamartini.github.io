/* Public GitHub-backed history; legacy browser data is export-only. */
(function(){
  'use strict';
  const SNAPSHOT='dlns/published-history.json'; // Change only to a separately reviewed public export.
  const store=createDLNSLocalStore(DLNSModel,window.indexedDB);
  const github=createDLNSGitHubStore(DLNSModel,store.validate);
  let state={version:0,matches:[],teams:[]}, ready=false;
  const listeners=new Set();
  function accept(next){state=next;ready=true;listeners.forEach(fn=>fn(db.auth));return db.matches;}
  async function operation(action){
    const promise=action();listeners.forEach(fn=>fn(db.auth));
    try{return await promise;}finally{listeners.forEach(fn=>fn(db.auth));}
  }
  async function readSnapshot(){
    const response=await fetch(SNAPSHOT,{cache:'no-store'});
    if(!response.ok)throw Error(`Published history could not be loaded (${response.status}).`);
    return store.validate(await response.json());
  }
  const db=window.DLNSDatabase={
    local:false,
    get auth(){return {user:github.user,admin:ready&&!!github.user,ready:true,busy:github.busy,error:''};},
    get version(){return state.version;},
    get matches(){return state.matches.slice().sort((a,b)=>DLNSModel.chronology(a.match_id)-DLNSModel.chronology(b.match_id));},
    get teams(){return state.teams || [];},
    get sourceNote(){
      const last=db.matches.at(-1)?.match_id || 'none';
      if(github.user)return `GitHub history: ${state.matches.length} matches; last match ${last}. Connected as ${github.user.login}. Saves create public commits; Pages may take a few minutes to update.`;
      return `Match history: ${state.matches.length} matches; last match ${last}.`;
    },
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},initAuth(){},
    signIn(){const dialog=document.getElementById('githubAuthDialog');dialog.showModal();document.getElementById('githubToken').focus();},
    async signOut(){github.disconnect();listeners.forEach(fn=>fn(db.auth));await db.loadMatches();window.DLNSApp.applyMatches(db.matches);},
    async reload(){await db.loadMatches();window.DLNSApp.applyMatches(db.matches);},
    async loadMatches(){return accept(github.user ? await github.read() : await readSnapshot());},
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
    dialog.innerHTML='<form><h2 id="githubAuthTitle">Sign in with GitHub</h2><p>Use your fine-grained GitHub token to publish matches as katamartini. This is a token connection, not OAuth.</p><label>Token <input id="githubToken" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required></label><details><summary>Token setup &amp; security</summary><p>Create a fine-grained token in <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">GitHub settings</a>: owner katamartini, only katamartini.github.io, Contents: Read and write, short expiration. Metadata read is automatic. This grants contents access across the repository, not only DLNS.</p><p>The token is sent only to api.github.com and kept only in this tab’s memory. Refresh, close the tab or sign out to clear it. Use a trusted browser. Never paste a token into chat.</p></details><p id="githubStatus" role="status"></p><div class="matchEntryActions"><button type="button" id="githubCancel">Cancel</button><button type="submit" id="githubConnect">Sign in</button></div></form>';
    document.body.append(dialog);
    let connecting=false;
    const dismiss=()=>{if(connecting)return; $('githubToken').value='';$('githubStatus').textContent='';dialog.close();};
    $('githubCancel').onclick=dismiss;
    dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(connecting)return;
      let value=$('githubToken').value;$('githubToken').value='';connecting=true;
      $('githubConnect').disabled=true;$('githubCancel').disabled=true;$('githubToken').disabled=true;$('githubStatus').textContent='Connecting…';
      try{const pending=github.connect(value);value='';accept(await pending);window.DLNSApp.applyMatches(db.matches);$('githubStatus').textContent='';dialog.close();}
      catch(error){$('githubStatus').textContent=error.message;}
      finally{connecting=false;$('githubConnect').disabled=false;$('githubCancel').disabled=false;$('githubToken').disabled=false;listeners.forEach(fn=>fn(db.auth));}
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
