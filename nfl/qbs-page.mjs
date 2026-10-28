import { TEAMS } from './divstreaks-data.mjs';
import { rankRows } from './qbs-data.mjs?v=qb-top100-logos-1';
import { franchiseStartingLeaders, HISTORICAL_OPPONENTS, rankedStartingStreaks, validStartingHistory } from './qbs-history.mjs?v=qb-top100-logos-1';
const byId = id => document.getElementById(id);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const dateText = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
const statuses = { ACT: 'Active roster', INA: 'Inactive', DEV: 'Practice squad', EXE: 'Exempt', PUP: 'PUP', RES: 'Reserve', RSN: 'Reserve', SUS: 'Suspended', E14: 'Exempt' };
let data, view, sortKey, descending;
const listLimit = 100;
const requestedTeam = new URLSearchParams(location.search).get('team');
let selectedTeam = TEAMS[requestedTeam] ? requestedTeam : 'all';
const logoPath = code => `../images/nfl/${({ LA: 'lar', WAS: 'wsh' })[code] || code.toLowerCase()}.png`;
const views = {
  starts: { title: 'Active starting streaks', description: 'Consecutive regular-season starts with the current team, through each team’s latest completed game.' },
  'all-time': { title: 'All-time starting streaks', description: 'Every recorded run from 1950 onward, including completed and current streaks. Runs stay within one franchise; earlier history is not included. ≥ marks an incomplete run at a coverage boundary.' },
  franchise: { title: 'Franchise starting-streak leaders', description: 'Each quarterback’s best recorded run for a franchise, ranked within that franchise. Select a team for its leaderboard. History covers 1950 onward; ≥ marks an incomplete run at that boundary.' },
  tenure: { title: 'Longest-tenured QBs with their current teams', description: 'Every current roster quarterback, including backups. Tenure is measured in consecutive roster seasons with the franchise.' },
};
const sorts = { starts: { key: 'length', descending: true }, 'all-time': { key: 'length', descending: true }, franchise: { key: 'length', descending: true }, tenure: { key: 'seasons', descending: true } };
for (const [code, team] of [['all', { name: 'All teams' }], ...Object.entries(TEAMS).sort((a, b) => a[1].name.localeCompare(b[1].name))]) {
  const button = make('button', code === 'all' ? team.name : null, code === 'all' ? 'all-teams' : '');
  button.type = 'button'; button.dataset.team = code; button.title = team.name;
  button.setAttribute('aria-label', team.name);
  if (code !== 'all') {
    const logo = make('img'); logo.src = logoPath(code); logo.alt = ''; logo.width = 30; logo.height = 30;
    button.append(logo);
  }
  button.addEventListener('click', () => {
    selectedTeam = selectedTeam === code ? 'all' : code;
    const url = new URL(location.href);
    if (selectedTeam === 'all') url.searchParams.delete('team'); else url.searchParams.set('team', selectedTeam);
    history.replaceState(null, '', url); updateTeamButtons(); render();
  });
  byId('team-filter').append(button);
}
function updateTeamButtons() {
  for (const button of byId('team-filter').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.team === selectedTeam));
  byId('selected-team').textContent = TEAMS[selectedTeam]?.name || 'All teams';
}
updateTeamButtons();
const opponentName = code => TEAMS[code]?.name || HISTORICAL_OPPONENTS[code];
function render() {
  if (!data) return;
  const starts = view !== 'tenure', historical = view === 'all-time' || view === 'franchise';
  const columns = [{ key: 'rank', label: view === 'franchise' ? 'Franchise rank' : 'Rank', number: true }, { key: 'name', label: 'Quarterback' }, { key: 'team', label: 'Team' },
    ...(starts ? [{ key: 'length', label: 'Consecutive starts', number: true }, { key: 'startDate', label: 'Streak began' }, { key: 'lastDate', label: historical ? 'Last start in run' : 'Most recent start' },
      ...(historical ? [{ key: 'active', label: 'Run status', number: false }] : [])] :
      [{ key: 'seasons', label: 'Seasons', number: true }, { key: 'since', label: 'Since', number: true }, { key: 'statusText', label: 'Roster status' }])];
  const source = view === 'all-time' ? data.history.streaks : view === 'franchise' ? data.franchiseLeaders : starts ? data.starts : data.tenures;
  const all = source.map((row, i) => ({ ...row, rank: row.rank ?? i + 1, startDate: row.start?.date, lastDate: row.last?.date, statusText: statuses[row.status] || row.status }));
  const query = byId('player-search').value.trim().toLowerCase();
  const matching = all.filter(row => (selectedTeam === 'all' || row.team === selectedTeam) && row.name.toLowerCase().includes(query));
  const longest = rankRows(matching, starts ? 'length' : 'seasons', true).slice(0, listLimit);
  const rows = rankRows(longest, sortKey, descending);
  const head = byId('table-head'); head.replaceChildren();
  for (const column of columns) {
    const th = make('th', null, column.number ? 'number' : ''); th.scope = 'col';
    th.setAttribute('aria-sort', column.key === sortKey ? descending ? 'descending' : 'ascending' : 'none');
    const button = make('button', column.label); button.type = 'button';
    if (column.key === sortKey) { const arrow = make('span', descending ? ' ↓' : ' ↑'); arrow.setAttribute('aria-hidden', 'true'); button.append(arrow); }
    button.addEventListener('click', () => { descending = sortKey === column.key ? !descending : !!column.number && column.key !== 'rank'; sortKey = column.key; sorts[view] = { key: sortKey, descending }; render(); head.querySelectorAll('button')[columns.indexOf(column)].focus(); });
    th.append(button); head.append(th);
  }
  const body = byId('table-body'); body.replaceChildren();
  for (const row of rows) {
    const tr = make('tr', null, historical && row.active ? 'current' : ''); tr.append(make('td', row.rank, 'number'));
    const name = make('th', row.name); name.scope = 'row'; tr.append(name);
    const cell = make('td'), team = make('span', null, 'team'), logo = make('img');
    logo.src = logoPath(row.team);
    logo.alt = ''; logo.width = 25; logo.height = 25; logo.loading = 'lazy';
    team.append(logo, make('span', TEAMS[row.team].name)); cell.append(team); tr.append(cell);
    if (starts) {
      tr.append(make('td', `${row.startKnown === false || row.endKnown === false ? '≥' : ''}${row.length}`, 'number'));
      for (const game of [row.start, row.last]) { const date = make('td', dateText(game.date)); date.append(make('span', `${game.season}${game.week ? ` · Week ${game.week}` : ''} vs ${opponentName(game.opponent)}`, 'detail')); tr.append(date); }
      if (historical) tr.append(make('td', row.active ? 'Current run' : row.endKnown ? 'Ended' : 'Later starts unavailable', row.active ? 'current-label' : ''));
    } else tr.append(make('td', row.seasons, 'number'), make('td', row.since, 'number'), make('td', row.statusText));
    body.append(tr);
  }
  byId('empty').hidden = rows.length > 0;
  byId('row-count').textContent = `Showing ${rows.length} of ${matching.length} matching ${historical ? 'streaks' : 'quarterbacks'}. ${view === 'franchise' ? 'Ranks are within each franchise' : 'Ranks stay fixed'} when filtering.`;
  byId('history-coverage').hidden = !historical;
  byId('history-coverage').textContent = data.history.recentComplete ? `Starter history: 1950 through ${dateText(data.history.through)}.` : `Available history: 1950–${data.history.lastCompleteSeason}, plus verified active streaks through ${dateText(data.history.through)}. Other runs from ${data.history.lastCompleteSeason + 1} onward are unavailable until the starter refresh succeeds. Records before 1950 are not included.`;
}
function setView() {
  view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'starts';
  ({ key: sortKey, descending } = sorts[view]);
  for (const key of Object.keys(views)) { const link = byId(`${key}-link`); if (key === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  const title = views[view].title;
  byId('view-heading').textContent = title; byId('caption').textContent = title;
  byId('description').textContent = views[view].description;
  render();
}
window.addEventListener('hashchange', setView);
byId('player-search').addEventListener('input', render);
setView();
try {
  const response = await fetch('../data/qbs.json?v=qb-top100-logos-1', { cache: 'no-cache' }); if (!response.ok) throw new Error('Data unavailable');
  const saved = await response.json();
  if (saved.schemaVersion !== 2 || !validStartingHistory(saved.history) || saved.history.through !== saved.through || !Array.isArray(saved.starts) || !Array.isArray(saved.tenures) || !Array.isArray(saved.unavailable) || saved.starts.length + saved.unavailable.length !== 32 ||
      saved.tenures.some(row => !TEAMS[row.team] || !row.name || !Number.isInteger(row.seasons) || row.seasons < 1) ||
      saved.starts.some(row => !TEAMS[row.team] || !row.name || !Number.isInteger(row.length) || row.length < 1 || !row.start?.date || !row.last?.date || !TEAMS[row.start.opponent] || !TEAMS[row.last.opponent]) || !Number.isFinite(Date.parse(saved.checkedAt))) throw new Error('Incomplete data');
  data = saved;
  data.franchiseLeaders = franchiseStartingLeaders(saved.history.streaks);
  data.history.streaks = rankedStartingStreaks(saved.history.streaks);
  const checked = new Date(data.checkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
  const weeks = Object.values(data.rosterWeeks), min = Math.min(...weeks), max = Math.max(...weeks);
  byId('status').textContent = `Games through ${dateText(data.through)} · ${data.season} rosters: Week ${min === max ? max : `${min}–${max}`} · Last checked ${checked} Eastern`;
  byId('availability').textContent = data.unavailable.length ? `Not ranked in starting streaks: ${data.unavailable.map(row => `${TEAMS[row.team].name} (${row.reason})`).join('; ')}` : '';
  render();
} catch { byId('status').textContent = 'Quarterback data could not be loaded. Please refresh to try again.'; }
