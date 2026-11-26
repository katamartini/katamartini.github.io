(function () {
  'use strict';

  const db = window.DLNSDatabase, model = window.DLNSModel, app = window.DLNSApp;
  const STORE = 'dlns.public.matchEntry.v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blank = () => ({week:'',region:'EU',round:'Challenger',game:'1',winner:'',players:{},editing:null,revision:null,selected:''});
  let entry = blank(), saving = false, autofilling = false, addingTeam = false, message = '', messageKind = '', loginBusy = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') {
      entry = {...blank(),...saved,players:{...saved.players}};
      if (Object.hasOwn(saved,'autoPlayers')) {
        for (const [hero,automatic] of Object.entries(saved.autoPlayers || {})) {
          if (automatic) delete entry.players[hero];
        }
        delete entry.autoPlayers;
        persist();
      }
    }
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

  function matchEntry(next) {
    return {...blank(),...next,week:String(next.week),game:String(next.game)};
  }

  function newMatch() {
    try {
      const next = model.nextOpenMatch(db.matches);
      const teams = model.gameOneTeams(db.matches,next);
      entry = matchEntry(next);
      persist(); setMessage('');
      app.setSim(model.matchToSim({week:next.week,left_team:teams?.left || 'Team 1',
        right_team:teams?.right || 'Team 2',first_pick:'left',actions:[]}));
    } catch (error) { setMessage(error.message,'errorText'); }
  }

  function applyGameOneTeams(sim) {
    const teams = model.gameOneTeams(db.matches,entry);
    if (!teams || (sim.left===teams.left && sim.right===teams.right)) return false;
    entry.winner = '';
    persist();
    app.setSim({...sim,...teams});
    return true;
  }

  function onMatchDetailsChanged(event) {
    const sim = app.getSim();
    if (!entry.editing && !sim.events.length && applyGameOneTeams(sim)) return;
    if(event.target.id==='simMatchWeek')window.renderDraftSim();
  }

  function draftWeek() {
    const week = Number(entry.week);
    return db.auth.admin && Number.isInteger(week) && week >= 1 && week <= 9999 ? week : null;
  }

  function formatMismatch(sim = app.getSim()) {
    const week = draftWeek();
    return week !== null && model.banCount(week) !== model.banCount(sim.week);
  }

  function syncEmptyDraft(sim) {
    if (!formatMismatch(sim) || sim.events.length) return false;
    app.setSim(model.matchToSim({week:draftWeek(),left_team:sim.left,right_team:sim.right,first_pick:sim.first,actions:[]}));
    return true;
  }

  function playerList(team) {
    const records = app.getRecords(), roster = new Set(), teamKey = team.trim().toLowerCase();
    let latest = -Infinity;
    for (const row of records) {
      if (row.region !== entry.region || (row.team || '').trim().toLowerCase() !== teamKey
          || (row.type || '').toLowerCase() !== 'pick' || !row.player || !row.matchid) continue;
      const order = model.chronology(row.matchid);
      if (order > latest) { latest = order; roster.clear(); }
      if (order === latest) roster.add(row.player);
    }
    return [...new Set([...records.map(row=>row.player),...Object.values(entry.players)].filter(Boolean))]
      .sort((a,b)=>Number(roster.has(b))-Number(roster.has(a)) || a.localeCompare(b));
  }

  function teamNames(region = entry.region) {
    return model.teamsForRegion(app.getRecords(),region,db.teams);
  }

  function fillPlayers() {
    if (saving || autofilling || loginBusy || addingTeam || !db.auth.admin) return;
    const sim = app.getSim(), records = app.getRecords();
    let filled = 0;
    for (const side of ['left','right']) {
      for (const hero of sim.slots[side].picks.filter(Boolean)) {
        if (entry.players[hero]) continue;
        const player = model.latestHeroPlayer(records,sim[side],hero,entry.region);
        if (!player) continue;
        entry.players[hero] = player;
        filled++;
      }
    }
    if (filled) persist();
    setMessage(filled ? `Filled ${filled} player assignment${filled === 1 ? '' : 's'}.` : 'No player assignments changed.',filled ? 'success' : '');
    render();
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
    const sim = app.getSim();
    if (formatMismatch(sim)) return `Week ${entry.week} uses ${model.banCount(entry.week)} bans per team. Reset to switch formats, or change the week back to keep this draft.`;
    if (message) return message;
    if (saving) return 'Saving match...';
    if (autofilling) return 'Checking the latest match...';
    if (entry.editing) return `Editing ${entry.editing} (revision ${entry.revision})`;
    const total = model.sequence(sim.first,sim.week).length;
    return sim.events.length === total ? 'Draft complete' : `${sim.events.length} / ${total} draft actions`;
  }

  function render() {
    const root = $('simMatchEntry'), playerSlots = document.querySelectorAll('[data-player-hero]');
    if (!root) return;
    const auth = db.auth, sim = app.getSim(), busy = saving || autofilling || loginBusy;
    if (auth.admin && !entry.week) {
      try { entry = matchEntry(model.nextOpenMatch(db.matches)); }
      catch (_) { entry.week = String(db.matches.at(-1)?.week || 1); }
      persist();
      if (!sim.events.length && applyGameOneTeams(sim)) return;
    }
    if (auth.admin && syncEmptyDraft(sim)) return;
    const authButtons = auth.user ? `<span class="small">${esc(auth.user.login)}</span><button id="githubReload" ${loginBusy || auth.busy?'disabled':''}>Reload history</button><button id="simSignOut" ${loginBusy || auth.busy?'disabled':''}>Sign out</button>` : `<button id="simSignIn" ${loginBusy || auth.busy?'disabled':''}>Sign in with GitHub</button>`;
    const header = `<div class="matchEntryBar"><div class="matchEntryTitle">Match entry</div><div class="matchAuth">${authButtons}</div></div>`;
    root.className = 'matchEntry';
    if (!auth.admin) {
      root.innerHTML = header + ((auth.error || message) ? `<div class="matchEntryStatus errorText" role="status">${esc(auth.error || message)}</div>` : '');
      playerSlots.forEach(slot=>{ slot.innerHTML = ''; });
      bindAuth();return;
    }
    const matches = db.matches.slice().reverse();
    const option = (value,label,current) => `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
    root.innerHTML = header + (auth.error ? `<div class="matchEntryStatus errorText" role="status">${esc(auth.error)}</div>` : '') + `
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
      <div class="matchEntryActions"><span class="matchId" id="simMatchId">${esc(model.matchId(entry))}</span><span class="matchEntryStatus ${messageKind}" id="simMatchStatus" role="status">${esc(statusText())}</span><button id="simSubmitMatch" ${busy || !draftWeek() || formatMismatch(sim) || sim.events.length!==model.sequence(sim.first,sim.week).length?'disabled':''}>${saving?'Saving...':entry.editing?'Save changes':'Submit match'}</button></div>`;
    const players = Object.fromEntries(['left','right'].map(side=>[side,playerList(sim[side])]));
    playerSlots.forEach(slot=>{
      const hero = slot.dataset.playerHero, side = slot.dataset.playerSide, selected = entry.players[hero] || '';
      const recent = model.latestHeroPlayer(app.getRecords(),sim[side],hero,entry.region);
      const choices = recent ? [recent,...players[side].filter(player=>player !== recent)] : players[side];
      slot.innerHTML = `<select data-match-player="${esc(hero)}" aria-label="Player for ${esc(hero)} (${esc(sim[side])})" title="${esc(selected || 'Player (optional)')}" ${busy?'disabled':''}>${option('','Player',selected)}${choices.map(player=>option(player,player,selected)).join('')}<option value="__new_player__" data-new-player>+ New player...</option></select>`;
      const select = slot.querySelector('select');
      select.onchange = () => {
        if (select.selectedOptions[0]?.hasAttribute('data-new-player')) {
          select.value = entry.players[hero] || '';
          openNewPlayer(hero);
          return;
        }
        entry.players[hero] = select.value;
        select.title = select.value || 'Player (optional)';
        persist();
      };
    });
    bindAuth();
    const fields = {simMatchWeek:'week',simMatchRound:'round',simMatchGame:'game'};
    Object.entries(fields).forEach(([id,key]) => {
      $(id).oninput = event => {
        entry[key] = event.target.value; persist(); $('simMatchId').textContent = model.matchId(entry);
        window.updateDraftSeriesScore?.();
      };
    });
    for(const id of Object.keys(fields)) $(id).onchange = onMatchDetailsChanged;
    $('simLoadMatch').onchange = event => { entry.selected = event.target.value; persist(); };
    $('simLoadMatchBtn').onclick = loadSelected;
    $('simNewMatch').onclick = newMatch;
    $('simAutofillMatch').onclick = autofill;
    $('simSubmitMatch').onclick = submit;
  }

  function openNewPlayer(hero) {
    if (saving || autofilling || loginBusy || !db.auth.admin || $('simNewPlayerDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'simNewPlayerDialog';
    dialog.className = 'matchTeamDialog';
    dialog.setAttribute('aria-labelledby','simNewPlayerTitle');
    dialog.innerHTML = `<form>
      <h2 id="simNewPlayerTitle">Player for ${esc(hero)}</h2>
      <label><span class="label">Player name</span><input id="simNewPlayerName" required maxlength="100" autocomplete="off" autofocus></label>
      <div class="matchTeamActions"><button type="button" id="simCancelPlayer">Cancel</button><button type="submit">Use player</button></div>
    </form>`;
    const focusPlayer = () => [...document.querySelectorAll('[data-match-player]')].find(select=>select.dataset.matchPlayer === hero)?.focus({preventScroll:true});
    dialog.onclose = () => { dialog.remove(); focusPlayer(); };
    document.body.appendChild(dialog);
    $('simCancelPlayer').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      if (saving || autofilling || loginBusy || !db.auth.admin) return;
      const input = $('simNewPlayerName'), name = input.value.trim();
      if (!name) { input.setCustomValidity('Enter a player name.'); input.reportValidity(); return; }
      entry.players[hero] = name;
      persist(); render(); dialog.close();
    };
    $('simNewPlayerName').oninput = event => event.target.setCustomValidity('');
    dialog.showModal();
  }

  function bindAuth() {
    if ($('simSignIn')) $('simSignIn').onclick = () => db.signIn();
    const run = async action => {
      if (loginBusy) return; loginBusy = true; render();
      try { await action(); setMessage(''); } catch(error) { setMessage(error.message,'errorText'); }
      finally { loginBusy = false; render(); }
    };
    if ($('simSignOut')) $('simSignOut').onclick = () => run(()=>db.signOut());
    if ($('githubReload')) $('githubReload').onclick = () => run(()=>db.reload());
  }

  function loadSelected() {
    return loadMatch(entry.selected);
  }

  function loadMatch(id) {
    if (saving || autofilling || loginBusy || addingTeam) return false;
    const match = db.matches.find(item=>item.match_id === id);
    if (!match) { setMessage('Select a saved match first.','errorText'); return false; }
    entry = {...blank(),week:String(match.week),region:match.region,round:match.round,game:String(match.game),winner:match.winner || '',
      players:Object.fromEntries(match.actions.filter(action=>action.type==='pick').map(action=>[action.hero,action.player || ''])),
      editing:match.match_id,revision:match.revision,workspaceVersion:db.version,selected:match.match_id};
    persist();
    setMessage('');
    app.setSim(model.matchToSim(match));
    return true;
  }

  function openAddTeam(side) {
    if (saving || autofilling || loginBusy || addingTeam || !db.auth.admin || !['left','right'].includes(side)) return;
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
    if (saving || autofilling || loginBusy || !draftWeek() || formatMismatch()) return;
    const match = model.simToMatch(app.getSim(),entry,entry.players);
    const errors = model.validateMatch(match);
    if (errors.length) { setMessage(errors.join(' '),'errorText'); return; }
    saving = true; setMessage(''); window.renderDraftSim();
    try {
      const saved = await db.saveMatch(match,entry.revision,entry.editing,entry.workspaceVersion);
      entry.editing = saved.match_id; entry.selected = saved.match_id; entry.revision = saved.revision; entry.workspaceVersion = db.version;
      persist();
      app.applyMatches(db.matches);
      setMessage(`Saved ${saved.match_id} to GitHub (revision ${saved.revision}). Public Pages updates after deployment, usually within a few minutes.`,'success');
    } catch (error) { setMessage(error.message,'errorText'); }
    finally { saving = false; window.renderDraftSim(); }
  }

  async function autofill() {
    if (saving || autofilling || loginBusy || !db.auth.admin) return;
    autofilling = true; setMessage(''); window.renderDraftSim();
    try {
      const matches = await db.loadMatches();
      app.applyMatches(matches);
      const next = model.nextOpenMatch(matches);
      entry = {...entry,...next,week:String(next.week),game:String(next.game),winner:'',editing:null,revision:null,selected:''};
      persist();
      if (!applyGameOneTeams(app.getSim())) refreshTeams();
      setMessage(`Autofilled ${model.matchId(next)}.`,'success');
    } catch (error) { setMessage(error.message,'errorText'); }
    finally { autofilling = false; window.renderDraftSim(); }
  }

  window.DLNSMatchEntry = {
    get region() { return entry.region; },
    get draftWeek() { return draftWeek(); },
    get formatMismatch() { return formatMismatch(); },
    get winner() { return entry.winner; },
    get editingMatchId() { return entry.editing; },
    get saving() { return saving || autofilling || loginBusy || addingTeam; },
    get seriesWins() { return model.seriesWins(db.matches,entry,app.getSim()); },
    fillPlayers,
    loadMatch,
    openAddTeam,
    setRegion(region) {
      if (saving || autofilling || loginBusy || !['EU','NA'].includes(region) || region === entry.region) return;
      entry.region = region;
      const sim = app.getSim();
      if (!entry.editing && !sim.events.length && applyGameOneTeams(sim)) return;
      const teams = teamNames(region);
      const next = {...sim};
      for (const [side,fallback] of [['left','Team 1'],['right','Team 2']]) {
        if (!teams.includes(sim[side])) next[side] = fallback;
      }
      if (next.left !== sim.left || next.right !== sim.right) entry.winner = '';
      persist(); setMessage(''); app.setSim(next);
    },
    setTeam(side,team) {
      if (saving || autofilling || loginBusy || !['left','right'].includes(side)) return;
      const sim = app.getSim(), other = side === 'left' ? 'right' : 'left';
      if (team === sim[other] || !teamNames().includes(team)) return;
      if (sim[side] === team) return;
      entry.winner = '';
      persist(); setMessage(''); app.setSim({...sim,[side]:team});
    },
    setWinner(side) {
      if (saving || autofilling || loginBusy || !['','left','right'].includes(side)) return;
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
