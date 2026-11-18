/* Static public history plus an explicitly selected local editing workspace. */
(function(){
  'use strict';
  const editable=new URLSearchParams(location.search).get('storage')==='local';
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
    local:editable,
    get auth(){return {user:github.user,admin:ready&&(editable||!!github.user),ready:true,error:''};},
    get version(){return state.version;},
    get matches(){return state.matches.slice().sort((a,b)=>DLNSModel.chronology(a.match_id)-DLNSModel.chronology(b.match_id));},
    get teams(){return state.teams || [];},
    get sourceNote(){
      const last=db.matches.at(-1)?.match_id || 'none';
      if(github.user)return `GitHub history: ${state.matches.length} matches; last match ${last}. Connected as ${github.user.login}. Saves create public commits; Pages may take a few minutes to update.`;
      return editable ? `Local workspace: ${state.matches.length} matches; last match ${last}. Source: ${state.provenance?.label || 'empty'}. Saved only in this browser — export backups.` : `Published snapshot: ${state.matches.length} matches; last match ${last}. This is not a live database or proof of complete history.`;
    },
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},initAuth(){},
    async loadMatches(){return accept(editable ? await store.read() : github.user ? await github.read() : await readSnapshot());},
    async saveMatch(match,revision,originalId,workspaceVersion){
      if(!db.auth.admin)throw Error('Connect GitHub or open the local workspace to edit.');
      accept(await operation(()=>(editable?store:github).saveMatch(match,revision,originalId,originalId ? workspaceVersion : state.version)));
      return state.matches.find(item=>item.match_id===match.match_id);
    },
    async addTeam(name,region){
      if(!db.auth.admin)throw Error('Connect GitHub or open the local workspace to edit.');
      accept(await operation(()=>(editable?store:github).addTeam(name,region,state.version)));
      return state.teams.find(t=>t.region===region && t.name.trim().toLowerCase()===name.trim().toLowerCase());
    }
  };
  function download(content,name){
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.addEventListener('DOMContentLoaded',()=>{
    const panel=document.createElement('details');panel.className='panel';panel.open=editable;
    panel.innerHTML='<summary>History, local editing &amp; backups</summary><p>Everyone can view the published history. Local edits stay in this browser and require no login. To share changes, export and publish a reviewed history file through the repository.</p><p><a href="DLNS.html">View published history</a> · <a href="?storage=local#draftsim">Open local workspace</a></p><button id="localCacheExport">Download original database cache</button> <button id="localExport">Export local backup</button> <button id="localSeed">Import published history</button> <label>Import JSON <input id="localImport" type="file" accept="application/json,.json"></label><p>Keep downloaded backups outside this browser before clearing site data. Imports replace the local working copy; they never publish or change the original cache.</p><p id="localStatus" role="status"></p>';
    document.getElementById('sourceNote').after(panel);
    const $=id=>document.getElementById(id), status=text=>{$('localStatus').textContent=text;};
    let busy=false;
    const buttons=['localExport','localSeed','localImport'];
    function controls(){for(const id of buttons)$(id).disabled=!editable || busy;}
    async function run(fn){
      if(busy)return;busy=true;controls();
      try{await fn();}catch(error){status(error.message);}finally{busy=false;controls();}
    }
    async function importData(input,label){
      store.validate(input);
      if(!confirm(`Import ${input.matches.length} matches from ${label}? This replaces only the local working copy. Export your current backup first. The previous copy is also retained in local change history.`))return;
      accept(await store.importData(input,label,state.version));
      window.DLNSApp.applyMatches(db.matches);
      status('Imported locally. Load a match before editing; export a backup after saving. Nothing was published.');
    }
    $('localCacheExport').onclick=()=>run(async()=>{
      const raw=localStorage.getItem('dlns.database.matches.v1');
      if(!raw)throw Error('No original cache on this browser and site address. Try the device, profile and site address used previously.');
      download(raw,`dlns-original-cache-${Date.now()}.json`);
      status('Original cache downloaded verbatim, without changing or importing it. Preserve this file.');
    });
    $('localExport').onclick=()=>run(async()=>{
      download(JSON.stringify({...await store.read(),exported_at:new Date().toISOString()},null,2),`dlns-local-${Date.now()}.json`);
      status('Local backup downloaded, including source details and local change history.');
    });
    $('localSeed').onclick=()=>run(async()=>{await importData(await readSnapshot(),'published file: '+SNAPSHOT);});
    $('localImport').onchange=event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      run(async()=>{
        if(file.size>30*1024*1024)throw Error('Import is larger than 30 MB.');
        await importData(JSON.parse(await file.text()),file.name);
      });
    };
    if(!editable){
      const authPanel=document.createElement('details');authPanel.className='panel';
      authPanel.innerHTML='<summary>Owner: connect GitHub token</summary><p>Anyone can view. Only katamartini can submit public matches. This uses a fine-grained personal access token, not GitHub OAuth login. The token goes only to api.github.com and is kept in this tab’s memory, never saved. Refreshing or disconnecting clears it. Only use this on a trusted browser without untrusted extensions.</p><p>Create a fine-grained token in <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">GitHub settings</a>: resource owner katamartini, only katamartini.github.io, Contents: Read and write (Metadata read is automatic), with a short expiration. It grants repository contents access, not just DLNS. Do not paste a token into chat.</p><label>Token <input id="githubToken" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"></label> <button id="githubConnect">Connect</button> <button id="githubDisconnect" disabled>Disconnect</button> <button id="githubReload" disabled>Reload GitHub history</button><p id="githubStatus" role="status"></p>';
      panel.before(authPanel);
      let connecting=false;
      function authControls(){
        const blocked=connecting||github.busy;
        $('githubConnect').disabled=blocked||!!github.user;
        $('githubToken').disabled=blocked||!!github.user;
        $('githubDisconnect').disabled=blocked||!github.user;
        $('githubReload').disabled=blocked||!github.user;
      }
      async function authAction(action){
        if(connecting||github.busy)return;
        connecting=true;authControls();
        try{await action();window.DLNSApp.applyMatches(db.matches);}
        catch(error){$('githubStatus').textContent=error.message;}
        finally{connecting=false;authControls();listeners.forEach(fn=>fn(db.auth));}
      }
      $('githubConnect').onclick=()=>{
        let value=$('githubToken').value;$('githubToken').value='';
        authAction(async()=>{const pending=github.connect(value);value='';accept(await pending);$('githubStatus').textContent='Connected. Submit match saves directly to GitHub. Public Pages updates after deployment.';});
      };
      $('githubDisconnect').onclick=()=>authAction(async()=>{github.disconnect();accept(await readSnapshot());$('githubStatus').textContent='Disconnected. Token cleared from memory. Public view restored.';});
      $('githubReload').onclick=()=>authAction(async()=>{accept(await github.read());$('githubStatus').textContent='Latest GitHub history loaded. Load the match again before editing.';});
      db.subscribe(authControls);
    }
    controls();
  });
})();
