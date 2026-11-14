'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const node = (tag, text, className) => { const n=document.createElement(tag); if(text)n.textContent=text; if(className)n.className=className; return n; };
  let matches=[];
  function render(){
    const selected=matches.filter(m=>(!byId('week').value||String(m.week)===byId('week').value)&&(!byId('region').value||m.region===byId('region').value));
    byId('status').textContent=`${selected.length} of ${matches.length} recovered maps shown. Complete history is unchanged.`;
    byId('matches').replaceChildren(...selected.map(m=>{
      const card=node('article');card.append(node('h2',`Week ${m.week} · ${m.region} · ${m.round} · Game ${m.game}`));
      card.append(node('p',`Winner: ${m.winner||'Unknown'} · Game ID: ${m.game_match_id||'not verified'}`,'muted'));
      const teams=node('div',null,'teams');
      for(const t of m.teams){const col=node('section');col.append(node('h3',t.name));const picks=node('div',null,'chips');for(const h of t.picks)picks.append(node('span',h,'chip'));col.append(picks,node('p',t.bans?`Bans (unordered): ${t.bans.join(', ')}`:'Bans: not verified','muted'));teams.append(col);}
      card.append(teams,node('p',m.note,'muted'));
      const sources=node('p','Sources: ');m.sources.forEach((url,i)=>{const a=node('a',new URL(url).hostname);a.href=url;a.rel='noopener noreferrer';if(i)sources.append(' · ');sources.append(a);});card.append(sources);return card;
    }));
  }
  byId('week').addEventListener('change',render);byId('region').addEventListener('change',render);
  fetch('recovery/verified-sets.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Could not load recovered records.');return r.json();}).then(data=>{
    matches=data.matches;for(const week of [...new Set(matches.map(m=>m.week))].sort((a,b)=>a-b)){const option=node('option',String(week));option.value=String(week);byId('week').append(option);}render();
  }).catch(()=>{byId('status').textContent='Recovered records could not be loaded. Reload this page to try again; complete history is unaffected.';});
})();
