(function () {
  'use strict';

  const db = window.DLNSDatabase, model = window.DLNSModel, app = window.DLNSApp;
  const STORE = 'dlns.matchEntry.v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blank = () => ({week:'',region:'EU',round:'Challenger',game:'1',winner:'',players:{},editing:null,revision:null,selected:''});
  let entry = blank(), saving = false, autofilling = false, addingTeam = false, message = '', messageKind = '', loginBusy = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') entry = {...blank(),...saved,players:saved.players || {}};
  } catch (_) {}
  entry.region = entry.region === 'NA' ? 'NA' : 'EU';
  entry.winner = ['left','right'].includes(entry.winner) ? entry.winner : '';

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

  function teamNames(region = entry.region) {
    return model.teamsForRegion(app.getRecords(),region,db.teams);
  }

  function refreshTeams() {
    if (!app.getRecords().length) return;
    const sim = app.getSim(), teams = teamNames();
    const next = {...sim};
    for (const [side,fallback] of [['left','Team 1'],['right','Team 2']]) {
      if (!teams.includes(sim[side])) next[side] = fallback;
    }
    if (next.left === sim.left && next.right === sim.right) return;
    entry.winner = '';
    persist(); app.setSim(next);
  }

  function statusText() {
    if (message) return message;
    const sim = app.getSim();
    if (saving) return 'Saving match...';
    if (autofilling) return 'Checking the latest match...';
    if (entry.editing) return `Editing ${entry.editing} (revision ${entry.revision})`;
    return sim.events.length === 16 ? 'Draft complete' : `${sim.events.length} / 16 draft actions`;
  }

  function render() {
    const root = $('simMatchEntry'), playersRoot = $('simPlayerAssignments');
    if (!root || !playersRoot) return;
    const auth = db.auth, sim = app.getSim(), busy = saving || autofilling;
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
        <select id="simLoadMatch" aria-label="Saved match" ${busy?'disabled':''}>${option('','Select a saved match',entry.selected)}${matches.map(match=>option(match.match_id,`${match.match_id} | ${match.left_team} vs ${match.right_team}`,entry.selected)).join('')}</select>
        <button id="simLoadMatchBtn" ${busy?'disabled':''}>Load match</button>
        <button id="simNewMatch" ${busy?'disabled':''}>New match</button>
        <button id="simAutofillMatch" class="matchAutofill" ${busy?'disabled':''}>${autofilling?'Checking...':'Autofill'}</button>
      </div>
      <div class="matchEntryFields">
        <label><div class="label">Week</div><input id="simMatchWeek" type="number" min="1" max="9999" step="1" value="${esc(entry.week)}" ${busy?'disabled':''}></label>
        <label><div class="label">Round</div><select id="simMatchRound" ${busy?'disabled':''}>${['Challenger','Finals'].map(value=>option(value,value,entry.round)).join('')}</select></label>
        <label><div class="label">Game</div><input id="simMatchGame" type="number" min="1" max="99" step="1" value="${esc(entry.game)}" ${busy?'disabled':''}></label>
      </div>
      <div class="matchEntryActions"><span class="matchId" id="simMatchId">${esc(model.matchId(entry))}</span><span class="matchEntryStatus ${messageKind}" id="simMatchStatus" role="status">${esc(statusText())}</span><button id="simSubmitMatch" ${busy || sim.events.length!==16?'disabled':''}>${saving?'Saving...':entry.editing?'Save changes':'Submit match'}</button></div>`;
    playersRoot.innerHTML = `<div class="matchPlayers">${['left','right'].map(side=>{
      const picked = sim.slots[side].picks.filter(Boolean);
      return `<section class="matchPlayerTeam"><h3>${esc(sim[side])} players</h3>${picked.map(hero=>`<label class="matchPlayerRow">${app.heroIcon(hero,'mIcon')}<input data-match-player="${esc(hero)}" aria-label="Player for ${esc(hero)} (${esc(sim[side])})" list="simPlayerNames" placeholder="Player (optional)" maxlength="100" value="${esc(entry.players[hero] || '')}" ${busy?'disabled':''}></label>`).join('')}</section>`;
    }).join('')}</div><datalist id="simPlayerNames">${playerList().map(player=>`<option value="${esc(player)}"></option>`).join('')}</datalist>`;
    bindAuth();
    const fields = {simMatchWeek:'week',simMatchRound:'round',simMatchGame:'game'};
    Object.entries(fields).forEach(([id,key]) => {
      $(id).oninput = event => {
        entry[key] = event.target.value; persist(); $('simMatchId').textContent = model.matchId(entry);
        window.updateDraftSeriesScore?.();
      };
    });
    $('simLoadMatch').onchange = event => { entry.selected = event.target.value; persist(); };
    $('simLoadMatchBtn').onclick = loadSelected;
    $('simNewMatch').onclick = () => { entry = {...blank(),week:suggestedWeek()}; persist(); setMessage(''); app.setSim(model.matchToSim({left_team:'Team 1',right_team:'Team 2',first_pick:'left',actions:[]})); };
    $('simAutofillMatch').onclick = autofill;
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

  function openAddTeam(side) {
    if (saving || autofilling || addingTeam || !db.auth.admin || !['left','right'].includes(side)) return;
    const selectId = side === 'left' ? 'simLeftTeam' : 'simRightTeam';
    $(selectId).value = app.getSim()[side];
    if ($('simAddTeamDialog')) return;
    const region = entry.region, dialog = document.createElement('dialog');
    dialog.id = 'simAddTeamDialog';
    dialog.className = 'matchTeamDialog';
    dialog.setAttribute('aria-labelledby','simAddTeamTitle');
    dialog.innerHTML = `<form>
      <h2 id="simAddTeamTitle">Add ${esc(region)} team</h2>
      <label><span class="label">Team name</span><input id="simNewTeamName" name="teamName" required maxlength="100" autocomplete="off" autofocus></label>
      <div class="matchTeamError" id="simNewTeamError" role="status"></div>
      <div class="matchTeamActions"><button type="button" id="simCancelTeam">Cancel</button><button type="submit" id="simSaveTeam">Add team</button></div>
    </form>`;
    document.body.appendChild(dialog);
    const input = $('simNewTeamName'), errorText = $('simNewTeamError'), submitButton = $('simSaveTeam'), cancelButton = $('simCancelTeam');
    dialog.oncancel = event => { if (addingTeam) event.preventDefault(); };
    dialog.onclose = () => { dialog.remove(); $(selectId)?.focus({preventScroll:true}); };
    cancelButton.onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (addingTeam || !db.auth.admin) return;
      const name = input.value.trim(), errors = model.validateTeam(name,region);
      const otherSide = side === 'left' ? 'right' : 'left';
      if (name.toLowerCase() === app.getSim()[otherSide].toLowerCase()) errors.push('This team is already selected on the other side.');
      if (errors.length) { errorText.textContent = errors.join(' '); input.focus(); return; }
      addingTeam = true;
      input.disabled = submitButton.disabled = cancelButton.disabled = true;
      submitButton.textContent = 'Adding...'; errorText.textContent = '';
      let saved;
      try { saved = await db.addTeam(name,region); }
      catch (error) { errorText.textContent = error.message; }
      finally {
        addingTeam = false;
        input.disabled = submitButton.disabled = cancelButton.disabled = false;
        submitButton.textContent = 'Add team';
      }
      if (!saved) { input.focus(); return; }
      entry.winner = '';
      persist(); setMessage(`Added ${saved.name} to ${region}.`,'success');
      app.setSim({...app.getSim(),[side]:saved.name});
      dialog.close();
    };
    dialog.showModal();
  }

  async function submit() {
    if (saving || autofilling || !db.auth.admin) return;
    const match = model.simToMatch(app.getSim(),entry,entry.players);
    const errors = model.validateMatch(match);
    if (errors.length) { setMessage(errors.join(' '),'errorText'); return; }
    saving = true; setMessage(''); window.renderDraftSim();
    try {
      const saved = await db.saveMatch(match,entry.revision,entry.editing);
      entry.editing = saved.match_id; entry.selected = saved.match_id; entry.revision = saved.revision;
      persist();
      app.applyMatches(db.matches);
      setMessage(`Saved ${saved.match_id} (revision ${saved.revision})`,'success');
    } catch (error) { setMessage(error.message,'errorText'); }
    finally { saving = false; window.renderDraftSim(); }
  }

  async function autofill() {
    if (saving || autofilling || !db.auth.admin) return;
    autofilling = true; setMessage(''); window.renderDraftSim();
    try {
      const matches = await db.loadMatches();
      app.applyMatches(matches);
      const next = model.nextMatch(matches);
      entry = {...entry,...next,week:String(next.week),game:String(next.game),winner:'',editing:null,revision:null,selected:''};
      persist(); refreshTeams();
      setMessage(`Autofilled ${model.matchId(next)}.`,'success');
    } catch (error) { setMessage(error.message,'errorText'); }
    finally { autofilling = false; window.renderDraftSim(); }
  }

  window.DLNSMatchEntry = {
    get region() { return entry.region; },
    get winner() { return entry.winner; },
    get saving() { return saving || autofilling || addingTeam; },
    get seriesWins() { return model.seriesWins(db.matches,entry,app.getSim()); },
    openAddTeam,
    setRegion(region) {
      if (saving || autofilling || !['EU','NA'].includes(region) || region === entry.region) return;
      entry.region = region;
      const sim = app.getSim(), teams = teamNames(region);
      const next = {...sim};
      for (const [side,fallback] of [['left','Team 1'],['right','Team 2']]) {
        if (!teams.includes(sim[side])) next[side] = fallback;
      }
      if (next.left !== sim.left || next.right !== sim.right) entry.winner = '';
      persist(); setMessage(''); app.setSim(next);
    },
    setTeam(side,team) {
      if (saving || autofilling || !['left','right'].includes(side)) return;
      const sim = app.getSim(), other = side === 'left' ? 'right' : 'left';
      if (team === sim[other] || !teamNames().includes(team)) return;
      if (sim[side] === team) return;
      entry.winner = '';
      persist(); setMessage(''); app.setSim({...sim,[side]:team});
    },
    setWinner(side) {
      if (saving || autofilling || !['','left','right'].includes(side)) return;
      entry.winner = side;
      persist(); setMessage(''); window.renderDraftSim();
    }
  };
  db.subscribe(() => window.renderDraftSim());
  window.addEventListener('dlns:sim-render',render);
  window.addEventListener('dlns:data',() => { refreshTeams(); window.renderDraftSim(); });
  refreshTeams();
  window.renderDraftSim();
  db.initAuth();
})();
