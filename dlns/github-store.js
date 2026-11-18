/* Direct owner-only GitHub publishing. Token stays in this closure, never storage. */
(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory;
  else root.createDLNSGitHubStore=factory;
})(typeof window==='object'?window:globalThis,function(model,validate,fetcher){
  'use strict';
  fetcher=fetcher || fetch;
  const API='https://api.github.com', REPO='/repos/katamartini/katamartini.github.io';
  const FILE=REPO+'/contents/dlns/published-history.json', OWNER=66887569;
  let token='', user=null, busy=false, uncertain=false;
  function clear(){token='';user=null;}
  async function request(path,options={}){
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),30000);
    let response;
    try{response=await fetcher(API+path,{...options,cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token,...options.headers}});}
    catch(_){throw Error(options.method==='PUT'?'Save outcome is unknown. Check GitHub, then reconnect and reload before trying again.':'GitHub could not be reached. Check your connection and try again.');}
    finally{clearTimeout(timer);}
    if(!response.ok){
      if(options.method==='PUT' && response.status>=400 && response.status<500)uncertain=false;
      if(response.status===401){clear();throw Error('Token expired or invalid. Connect again with a valid token.');}
      if([409,422].includes(response.status))throw Error('GitHub rejected the update or the file changed. Reload history and the match before saving again.');
      if(response.status===403)throw Error('GitHub denied access. Check token expiry, selected repository, Contents write permission, rate limits and branch rules.');
      throw Error('GitHub request failed ('+response.status+'). Check the repository before retrying a save.');
    }
    return options.raw ? response.text() : response.json();
  }
  const decode=value=>new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0)));
  const encode=value=>{const bytes=new TextEncoder().encode(value);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);};
  async function read(){
    if(!user)throw Error('Connect your GitHub token first.');
    const file=await request(FILE+'?ref=main');
    if(file.type!=='file'||!file.sha)throw Error('Expected a GitHub history file.');
    const json=file.encoding==='base64'?decode(file.content):await request(REPO+'/git/blobs/'+file.sha,{raw:true,headers:{Accept:'application/vnd.github.raw+json'}});
    return {...validate(JSON.parse(json)),version:file.sha};
  }
  async function mutate(expected,change,message){
    if(!user)throw Error('Connect your GitHub token first.');
    if(busy)throw Error('Another GitHub operation is in progress.');
    if(uncertain)throw Error('Reconnect and reload history to resolve the previous save before submitting again.');
    busy=true;
    try{
      const data=await read();
      if(data.version!==expected)throw Error('History changed on GitHub. Reload history and load the match again; your entry has not been published.');
      change(data);validate(data);
      // Only public records are written. Never include local backups, audit history or tokens.
      const payload={format:'dlns-local-v1',source:'GitHub owner-maintained history; original recovery snapshot preserved separately',matches:data.matches,teams:data.teams};
      const content=JSON.stringify(payload,null,2)+'\n';
      if(new TextEncoder().encode(content).length>30*1024*1024)throw Error('History exceeds the 30 MB publishing limit.');
      uncertain=true; // A failed/aborted response can still have committed. No automatic write retries.
      const result=await request(FILE,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,content:encode(content),sha:data.version,branch:'main'})});
      if(!result.content?.sha || !result.commit?.sha)throw Error('Save response is incomplete. Check GitHub, then reconnect and reload.');
      uncertain=false;
      return {...payload,version:result.content.sha,commit:result.commit.sha};
    }finally{busy=false;}
  }
  return {
    get user(){return user;},get busy(){return busy;},get uncertain(){return uncertain;},
    async connect(value){
      if(busy)throw Error('Wait for the GitHub operation to finish.');
      clear();uncertain=false;token=String(value).trim();
      if(!/^github_pat_[A-Za-z0-9_]+$/.test(token)){clear();throw Error('Use a fine-grained GitHub personal access token.');}
      busy=true;
      try{
        const identity=await request('/user');
        if(identity.id!==OWNER)throw Error('Only the katamartini owner account can connect here.');
        const repo=await request(REPO);
        if(repo.owner?.id!==OWNER || repo.full_name!=='katamartini/katamartini.github.io' || !repo.permissions?.push)throw Error('This token does not have write access to the DLNS repository.');
        user={id:identity.id,login:identity.login};
        return await read();
      }catch(error){clear();throw error;}finally{busy=false;}
    },
    disconnect(){if(busy)throw Error('Wait for the GitHub operation to finish.');clear();uncertain=false;},read,
    saveMatch(match,revision,originalId,expected){
      const errors=model.validateMatch(match);if(errors.length)return Promise.reject(Error(errors.join(' ')));
      return mutate(expected,data=>{
        const previous=data.matches.find(m=>m.match_id===(originalId || match.match_id));
        if(originalId ? !previous || previous.revision!==revision : previous)throw Error('Match changed or already exists. Reload history and load the match again.');
        if(data.matches.some(m=>m.match_id===match.match_id && m!==previous))throw Error('Match ID already exists.');
        const saved={...structuredClone(match),revision:(previous?.revision || 0)+1,source:'github',updated_at:new Date().toISOString()};
        data.matches=data.matches.filter(m=>m!==previous).concat(saved);
      },'DLNS: save '+match.match_id);
    },
    addTeam(name,region,expected){
      const errors=model.validateTeam(name,region);if(errors.length)return Promise.reject(Error(errors.join(' ')));
      return mutate(expected,data=>{
        if(!data.teams.some(t=>t.region===region && t.name.trim().toLowerCase()===name.trim().toLowerCase()))data.teams.push({name:name.trim(),region});
      },'DLNS: register team');
    }
  };
});
