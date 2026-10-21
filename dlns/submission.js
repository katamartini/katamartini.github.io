(function () {
  'use strict';

  const db = window.DLNSDatabase, model = window.DLNSModel, app = window.DLNSApp;
  const STORE = 'dlns.matchEntry.v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blank = () => ({week:'',region:'EU',round:'Challenger',game:'1',winner:'',players:{},editing:null,revision:null,selected:''});
  let entry = blank(), saving = false, message = '', messageKind = '', loginBusy = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') entry = {...blank(),...saved,players:saved.players || {}};
  } catch (_) {}

  function persist() {
    try { localStorage.setItem(STORE,JSON.stringify(entry)); } catch (_) {}
  }

  function setMessage(value,kind = '') {
    message = value;
    messageKind = kind;
    const status = $('simMatchStatus');
    if (status) { status.textContent = message; status.className = 'matchEntryStatus ' + kind; }
  }

  function suggestedWeek() {
    return String(Math.max(0,...db.matches.map(match=>match.week)) + 1);
  }

  function playerList() {
    return [...new Set(app.getRecords().map(row=>row.player).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  }

  function statusText() {
    if (message) return message;
    const sim = app.getSim();
    if (saving) return 'Saving match...';
    if (entry.editing) return `Editing ${entry.editing} (revision ${entry.revision})`;
    return sim.events.length === 16 ? 'Draft complete' : `${sim.events.length} / 16 draft actions`;
  }

  function render() {
    const root = $('simMatchEntry'), playersRoot = $('simPlayerAssignments');
    if (!root || !playersRoot) return;
    const auth = db.auth, sim = app.getSim();
    if (!entry.week && db.matches.length) { entry.week = suggestedWeek(); persist(); }
    const identity = auth.user?.user_metadata?.user_name || auth.user?.user_metadata?.preferred_username || auth.user?.email || '';
    const authButtons = auth.user ? `<span class="small">${esc(identity)}</span>${auth.ready && !auth.admin ? '<span class="small">Read-only</span>' : ''}<button id="simSignOut" ${loginBusy?'disabled':''}>Sign out</button>`
      : `<button id="simSignIn" ${loginBusy || !auth.ready?'disabled':''}>${auth.ready?'Sign in with GitHub':'Checking sign-in...'}</button>`;
    const header = `<div class="matchEntryBar"><div class="matchEntryTitle">Match entry</div><div class="matchAuth">${authButtons}</div></div>`;
    root.className = 'matchEntry';
    if (!auth.admin) {
      root.innerHTML = header + ((auth.error || message) ? `<div class="matchEntryStatus errorText" role="status">${esc(auth.error || message)}</div>` : '');
      playersRoot.innerHTML = '';
      bindAuth();
      return;
    }
    const matches = db.matches.slice().reverse();
    const option = (value,label,current) => `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
    root.innerHTML = header + `
      <div class="matchManagement">
        <select id="simLoadMatch" aria-label="Saved match">${option('','Select a saved match',entry.selected)}${matches.map(match=>option(match.match_id,`${match.match_id} | ${match.left_team} vs ${match.right_team}`,entry.selected)).join('')}</select>
        <button id="simLoadMatchBtn" ${saving?'disabled':''}>Load match</button>
        <button id="simNewMatch" ${saving?'disabled':''}>New match</button>
      </div>
      <div class="matchEntryFields">
        <label><div class="label">Week</div><input id="simMatchWeek" type="number" min="1" max="9999" step="1" value="${esc(entry.week)}" ${saving?'disabled':''}></label>
        <label><div class="label">Region</div><select id="simMatchRegion" ${saving?'disabled':''}>${['EU','NA'].map(value=>option(value,value,entry.region)).join('')}</select></label>
        <label><div class="label">Round</div><select id="simMatchRound" ${saving?'disabled':''}>${['Challenger','Finals'].map(value=>option(value,value,entry.round)).join('')}</select></label>
        <label><div class="label">Game</div><input id="simMatchGame" type="number" min="1" max="99" step="1" value="${esc(entry.game)}" ${saving?'disabled':''}></label>
        <label><div class="label">Winner</div><select id="simMatchWinner" ${saving?'disabled':''}>${option('','Result pending',entry.winner)}${option('left',sim.left,entry.winner)}${option('right',sim.right,entry.winner)}</select></label>
      </div>
      <div class="matchEntryActions"><span class="matchId" id="simMatchId">${esc(model.matchId(entry))}</span><span class="matchEntryStatus ${messageKind}" id="simMatchStatus" role="status">${esc(statusText())}</span><button id="simSubmitMatch" ${saving || sim.events.length!==16?'disabled':''}>${saving?'Saving...':entry.editing?'Save changes':'Submit match'}</button></div>`;
    playersRoot.innerHTML = `<div class="matchPlayers">${['left','right'].map(side=>{
      const picked = sim.slots[side].picks.filter(Boolean);
      return `<section class="matchPlayerTeam"><h3>${esc(sim[side])} players</h3>${picked.map(hero=>`<label class="matchPlayerRow">${app.heroIcon(hero,'mIcon')}<input data-match-player="${esc(hero)}" aria-label="Player for ${esc(hero)} (${esc(sim[side])})" list="simPlayerNames" placeholder="Player (optional)" maxlength="100" value="${esc(entry.players[hero] || '')}" ${saving?'disabled':''}></label>`).join('')}</section>`;
    }).join('')}</div><datalist id="simPlayerNames">${playerList().map(player=>`<option value="${esc(player)}"></option>`).join('')}</datalist>`;
    bindAuth();
    const fields = {simMatchWeek:'week',simMatchRegion:'region',simMatchRound:'round',simMatchGame:'game',simMatchWinner:'winner'};
    Object.entries(fields).forEach(([id,key]) => {
      $(id).oninput = event => { entry[key] = event.target.value; persist(); $('simMatchId').textContent = model.matchId(entry); };
    });
    $('simLoadMatch').onchange = event => { entry.selected = event.target.value; persist(); };
    $('simLoadMatchBtn').onclick = loadSelected;
    $('simNewMatch').onclick = () => { entry = {...blank(),week:suggestedWeek()}; persist(); setMessage(''); app.setSim(model.matchToSim({left_team:'Team 1',right_team:'Team 2',first_pick:'left',actions:[]})); };
    $('simSubmitMatch').onclick = submit;
    playersRoot.querySelectorAll('[data-match-player]').forEach(input => {
      input.oninput = () => { entry.players[input.dataset.matchPlayer] = input.value; persist(); };
    });
  }

  function bindAuth() {
    if ($('simSignIn')) $('simSignIn').onclick = async () => {
      loginBusy = true; render();
      try { await db.signIn(); } catch (error) { loginBusy = false; setMessage(error.message,'errorText'); render(); }
    };
    if ($('simSignOut')) $('simSignOut').onclick = async () => {
      loginBusy = true;
      try { await db.signOut(); setMessage(''); } catch (error) { setMessage(error.message,'errorText'); }
      finally { loginBusy = false; render(); }
    };
  }

  function loadSelected() {
    const match = db.matches.find(item=>item.match_id === entry.selected);
    if (!match) { setMessage('Select a saved match first.','errorText'); return; }
    entry = {week:String(match.week),region:match.region,round:match.round,game:String(match.game),winner:match.winner || '',
      players:Object.fromEntries(match.actions.filter(action=>action.type==='pick').map(action=>[action.hero,action.player || ''])),
      editing:match.match_id,revision:match.revision,selected:match.match_id};
    persist();
    setMessage('');
    app.setSim(model.matchToSim(match));
  }

  async function submit() {
    if (saving || !db.auth.admin) return;
    const match = model.simToMatch(app.getSim(),entry,entry.players);
    const errors = model.validateMatch(match);
    if (errors.length) { setMessage(errors.join(' '),'errorText'); return; }
    saving = true; setMessage(''); render();
    try {
      const saved = await db.saveMatch(match,entry.revision,entry.editing);
      entry.editing = saved.match_id; entry.selected = saved.match_id; entry.revision = saved.revision;
      persist();
      app.applyMatches(db.matches);
      setMessage(`Saved ${saved.match_id} (revision ${saved.revision})`,'success');
    } catch (error) { setMessage(error.message,'errorText'); }
    finally { saving = false; render(); }
  }

  db.subscribe(render);
  window.addEventListener('dlns:sim-render',render);
  window.addEventListener('dlns:data',render);
  render();
  db.initAuth();
})();
