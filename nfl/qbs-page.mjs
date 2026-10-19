import { TEAMS } from './divstreaks-data.mjs';
import { rankRows } from './qbs-data.mjs';
const byId = id => document.getElementById(id);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const dateText = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
const statuses = { ACT: 'Active roster', INA: 'Inactive', DEV: 'Practice squad', EXE: 'Exempt', PUP: 'PUP', RES: 'Reserve', RSN: 'Reserve', SUS: 'Suspended', E14: 'Exempt' };
let data, view, sortKey, descending;
const sorts = { starts: { key: 'length', descending: true }, tenure: { key: 'seasons', descending: true } };
for (const [code, team] of Object.entries(TEAMS).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const option = make('option', team.name); option.value = code; byId('team-filter').append(option);
}
function render() {
  if (!data) return;
  const starts = view === 'starts';
  const columns = [{ key: 'rank', label: 'Rank', number: true }, { key: 'name', label: 'Quarterback' }, { key: 'team', label: 'Team' },
    ...(starts ? [{ key: 'length', label: 'Consecutive starts', number: true }, { key: 'startDate', label: 'Streak began' }, { key: 'lastDate', label: 'Most recent start' }] :
      [{ key: 'seasons', label: 'Seasons', number: true }, { key: 'since', label: 'Since', number: true }, { key: 'statusText', label: 'Roster status' }])];
  const all = (starts ? data.starts : data.tenures).map((row, i) => ({ ...row, rank: i + 1, startDate: row.start?.date, lastDate: row.last?.date, statusText: statuses[row.status] || row.status }));
  const query = byId('player-search').value.trim().toLowerCase();
  const rows = rankRows(all.filter(row => (byId('team-filter').value === 'all' || row.team === byId('team-filter').value) && row.name.toLowerCase().includes(query)), sortKey, descending);
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
    const tr = make('tr'); tr.append(make('td', row.rank, 'number'));
    const name = make('th', row.name); name.scope = 'row'; tr.append(name);
    const cell = make('td'), team = make('span', null, 'team'), logo = make('img');
    logo.src = `https://a.espncdn.com/i/teamlogos/nfl/500/${({ LA: 'lar', WAS: 'wsh' })[row.team] || row.team.toLowerCase()}.png`;
    logo.alt = ''; logo.width = 25; logo.height = 25; logo.loading = 'lazy';
    team.append(logo, make('span', TEAMS[row.team].name)); cell.append(team); tr.append(cell);
    if (starts) {
      tr.append(make('td', row.length, 'number'));
      for (const game of [row.start, row.last]) { const date = make('td', dateText(game.date)); date.append(make('span', `${game.season} · Week ${game.week} vs ${TEAMS[game.opponent].name}`, 'detail')); tr.append(date); }
    } else tr.append(make('td', row.seasons, 'number'), make('td', row.since, 'number'), make('td', row.statusText));
    body.append(tr);
  }
  byId('empty').hidden = rows.length > 0;
  byId('row-count').textContent = `${rows.length} of ${all.length} quarterbacks. Ranks stay fixed when filtering.`;
}
function setView() {
  view = location.hash === '#tenure' ? 'tenure' : 'starts';
  ({ key: sortKey, descending } = sorts[view]);
  for (const key of ['starts', 'tenure']) { const link = byId(`${key}-link`); if (key === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  const title = view === 'starts' ? 'Active starting streaks' : 'Longest-tenured QBs with their current teams';
  byId('view-heading').textContent = title; byId('caption').textContent = title;
  byId('description').textContent = view === 'starts' ? 'Consecutive regular-season starts with the current team, through each team’s latest completed game.' : 'Every current roster quarterback, including backups. Tenure is measured in consecutive roster seasons with the franchise.';
  render();
}
window.addEventListener('hashchange', setView);
byId('team-filter').addEventListener('change', render); byId('player-search').addEventListener('input', render);
setView();
try {
  const response = await fetch('../data/qbs.json'); if (!response.ok) throw new Error('Data unavailable');
  const saved = await response.json();
  if (saved.schemaVersion !== 1 || !Array.isArray(saved.starts) || !Array.isArray(saved.tenures) || !Array.isArray(saved.unavailable) || saved.starts.length + saved.unavailable.length !== 32 ||
      saved.tenures.some(row => !TEAMS[row.team] || !row.name || !Number.isInteger(row.seasons) || row.seasons < 1) ||
      saved.starts.some(row => !TEAMS[row.team] || !row.name || !Number.isInteger(row.length) || row.length < 1 || !row.start?.date || !row.last?.date || !TEAMS[row.start.opponent] || !TEAMS[row.last.opponent]) || !Number.isFinite(Date.parse(saved.checkedAt))) throw new Error('Incomplete data');
  data = saved;
  const checked = new Date(data.checkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
  const weeks = Object.values(data.rosterWeeks), min = Math.min(...weeks), max = Math.max(...weeks);
  byId('status').textContent = `Games through ${dateText(data.through)} · ${data.season} rosters: Week ${min === max ? max : `${min}–${max}`} · Last checked ${checked} Eastern`;
  byId('availability').textContent = data.unavailable.length ? `Not ranked in starting streaks: ${data.unavailable.map(row => `${TEAMS[row.team].name} (${row.reason})`).join('; ')}` : '';
  render();
} catch { byId('status').textContent = 'Quarterback data could not be loaded. Please refresh to try again.'; }
