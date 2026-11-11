/* Browser-only persistence. No network access or writes to the former live cache. */
(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory;
  else root.createDLNSLocalStore=factory;
})(typeof window==='object'?window:globalThis,function(model,indexedDB){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  function validate(input){
    if(!input || !Array.isArray(input.matches) || input.matches.length>20000)throw Error('Expected DLNS JSON with a matches array (at most 20,000 matches).');
    if(input.format && input.format!=='dlns-local-v1')throw Error('Unsupported backup format.');
    const data=clone(input), ids=new Set();
    for(const match of data.matches){
      if(!match || typeof match!=='object')throw Error('Invalid match.');
      const errors=model.validateMatch(match,{allowHistoricalPlayers:true});
      if(errors.length)throw Error(`${match.match_id || 'Match'}: ${errors.join(' ')}`);
      if(ids.has(match.match_id))throw Error(`Duplicate match: ${match.match_id}`);
      ids.add(match.match_id);
      if(match.revision==null)match.revision=1;
      if(!Number.isSafeInteger(match.revision)||match.revision<1)throw Error('Invalid match revision.');
    }
    data.teams ??= [];
    if(!Array.isArray(data.teams))throw Error('Invalid teams.');
    const teams=new Set();
    for(const team of data.teams){
      if(!team || model.validateTeam(team.name,team.region).length)throw Error('Invalid team.');
      const key=team.region+':'+team.name.trim().toLowerCase();
      if(teams.has(key))throw Error('Duplicate team.');
      teams.add(key);
    }
    return data;
  }
  let connection;
  function open(){
    if(!connection)connection=new Promise((resolve,reject)=>{
      if(!indexedDB)return reject(Error('Browser storage is unavailable. Use a supported browser with storage enabled.'));
      const request=indexedDB.open('dlns.local.workspace.v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('Close other local workspace tabs and retry.'));
    });
    return connection;
  }
  const empty=()=>({format:'dlns-local-v1',version:0,matches:[],teams:[],provenance:null,changes:[]});
  async function transact(expected,change){
    const database=await open();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('workspace',change?'readwrite':'readonly'), store=tx.objectStore('workspace');
      let result, failure;
      tx.onerror=()=>{};
      tx.onabort=()=>reject(failure || tx.error || Error('Storage failed; nothing was saved.'));
      tx.oncomplete=()=>resolve(clone(result));
      const request=store.get('current');
      request.onsuccess=()=>{
        try{
          result=request.result || empty();
          if(change){
            if(result.version!==expected)throw Error('Workspace changed. Reload data and load the match again before saving.');
            change(result);result.version++;store.put(result,'current');
          }
        }catch(error){failure=error;tx.abort();}
      };
    });
  }
  return {
    validate,read:()=>transact(),
    async importData(input,label,expected){
      const next=validate(input);
      return transact(expected,data=>{
        data.changes.push({at:new Date().toISOString(),kind:'import',before:clone({matches:data.matches,teams:data.teams,provenance:data.provenance}),importedBackup:next.format?next:null});
        data.matches=next.matches;data.teams=next.teams;
        data.provenance={label,source:next.source || next.provenance || null,exported_at:next.exported_at || null,cache_at:next.at || null,imported_at:new Date().toISOString()};
      });
    },
    saveMatch(match,revision,originalId,expected){
      const errors=model.validateMatch(match);
      if(errors.length)return Promise.reject(Error(errors.join(' ')));
      return transact(expected,data=>{
        const previous=data.matches.find(item=>item.match_id===(originalId || match.match_id));
        if(originalId ? !previous || previous.revision!==revision : previous)throw Error('Match changed or already exists. Reload data and load the match again.');
        if(data.matches.some(item=>item.match_id===match.match_id && item!==previous))throw Error('Match ID already exists.');
        data.changes.push({at:new Date().toISOString(),kind:'save',before:previous || null,match_id:match.match_id});
        const saved={...clone(match),revision:(previous?.revision || 0)+1,source:'local',updated_at:new Date().toISOString()};
        data.matches=data.matches.filter(item=>item!==previous).concat(saved);
      });
    },
    addTeam(name,region,expected){
      const errors=model.validateTeam(name,region);
      if(errors.length)return Promise.reject(Error(errors.join(' ')));
      return transact(expected,data=>{
        if(!data.teams.some(t=>t.region===region && t.name.trim().toLowerCase()===name.trim().toLowerCase()))data.teams.push({name:name.trim(),region});
      });
    }
  };
});
