import { TEAMS } from './divstreaks-data.mjs';
import { currentComparisons, filterSeasons, recordText, summarize, validateRecord, validRecordData } from './record-finder-data.mjs';
const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const pct = value => value == null ? '—' : `${value.toFixed(1)}%`;
const fields = ['wins', 'losses', 'ties', 'era', 'format', 'team-filter', 'from', 'to'];
let data, state, view, page = 0, sortKey = 'season', descending = true;
const sorts = { finder: { key: 'season', descending: true }, current: { key: 'team', descending: false } };
const expandedTeams = new Set();
for (const [code, team] of Object.entries(TEAMS).sort((a, b) => a[1].name.localeCompare(b[1].name))) { const option = make('option', team.name); option.value = code; $('team-filter').append(option); }
function teamCell(code) {
  const cell = make('td'), wrap = make('span', null, 'team'), img = make('img'); img.alt = ''; img.width = 25; img.height = 25; img.loading = 'lazy';
  img.src = `https://a.espncdn.com/i/teamlogos/nfl/500/${({ LA: 'lar', WAS: 'wsh' })[code] || code.toLowerCase()}.png`;
  wrap.append(img, make('span', TEAMS[code].name)); cell.append(wrap); return cell;
}
function historyUrl(row) {
  const params = new URLSearchParams({ ...state, wins: row.wins, losses: row.losses, ties: row.ties, team: row.team, ongoing: 'false' });
  return `?${params}#finder`;
}
function rateCell(rate) { const cell = make('td', pct(rate.percent), 'number'); cell.append(make('span', `${rate.count} / ${rate.total}`, 'detail')); return cell; }
function seasonRow(row, includeTeam = true) {
  const tr = make('tr', null, !row.complete ? 'ongoing' : row.superBowlWin ? 'champion' : '');
  const season = make('th', row.season, 'number'); season.scope = 'row'; tr.append(season);
  if (includeTeam) tr.append(teamCell(row.team));
  const finish = make('td', recordText(row.wins, row.losses, row.ties), 'number');
  if (!row.complete) finish.append(make('span', 'Record so far', 'detail'));
  tr.append(finish, make('td', row.games ? pct((row.wins + row.ties / 2) / row.games * 100) : '—', 'number'), make('td', row.playoffWins ?? '—', 'number'), make('td', row.outcome));
  return tr;
}
function historyPanel(row) {
  const panel = make('div', null, 'history-panel');
  const title = `${TEAMS[row.team].name} past seasons starting ${recordText(row.wins, row.losses, row.ties)}`;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', title);
  if (!row.matches.length) {
    panel.append(make('p', 'No prior completed seasons match this team’s current record under the selected filters.', 'hint'));
    return panel;
  }
  const table = make('table', null, 'history-table');
  table.append(make('caption', `${title} · ${row.matches.length} matching season${row.matches.length === 1 ? '' : 's'}`));
  const head = make('thead'), header = make('tr');
  for (const [text, numeric] of [['Season', true], ['Final record', true], ['Final win %', true], ['Playoff wins', true], ['Season result', false]]) {
    const th = make('th', text, numeric ? 'number' : ''); th.scope = 'col'; header.append(th);
  }
  head.append(header); const body = make('tbody');
  for (const prior of [...row.matches].sort((a, b) => b.season - a.season)) body.append(seasonRow(prior, false));
  table.append(head, body); panel.append(table); return panel;
}
function attachHistory(row, tr, columnCount) {
  const details = make('tr', null, 'history-row'); details.id = `history-${row.team}`;
  const cell = make('td'); cell.colSpan = columnCount; details.append(cell);
  const toggle = make('button', null, 'history-toggle'); toggle.type = 'button';
  toggle.setAttribute('aria-controls', details.id);
  const refresh = () => {
    const open = expandedTeams.has(row.team);
    details.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} past seasons for ${TEAMS[row.team].name}`);
    toggle.textContent = open ? '▾' : '▸';
    if (open && !cell.firstChild) cell.append(historyPanel(row));
  };
  toggle.addEventListener('click', () => { if (expandedTeams.has(row.team)) expandedTeams.delete(row.team); else expandedTeams.add(row.team); refresh(); });
  tr.querySelector('.team').prepend(toggle); refresh();
  return details;
}
function setUrl() {
  const params = new URLSearchParams(Object.entries(state).map(([key, value]) => [key, String(value)]));
  history.pushState(null, '', `?${params}#${view}`);
}
function readUrl() {
  if (!data) return;
  const params = new URLSearchParams(location.search);
  const number = (key, fallback, min, max) => { const raw = params.get(key), n = raw === null || raw.trim() === '' ? fallback : Number(raw); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };
  state = { wins: number('wins', 3, 0, 17), losses: number('losses', 3, 0, 17), ties: number('ties', 0, 0, 17),
    era: ['all', 'sb', 'merger'].includes(params.get('era')) ? params.get('era') : 'sb',
    format: ['all', '17', '16', '14', '15', '9'].includes(params.get('format')) ? params.get('format') : 'all',
    team: TEAMS[params.get('team')] ? params.get('team') : 'all', from: number('from', 1920, 1920, data.activeSeason), to: number('to', data.activeSeason, 1920, data.activeSeason), ongoing: params.get('ongoing') === 'true' };
  try { validateRecord(state.wins, state.losses, state.ties); } catch { Object.assign(state, { wins: 3, losses: 3, ties: 0 }); }
  if (state.from > state.to) { state.from = 1920; state.to = data.activeSeason; }
  for (const key of fields) $(key).value = state[key === 'team-filter' ? 'team' : key];
  $('ongoing').checked = state.ongoing;
  view = location.hash === '#current' ? 'current' : 'finder';
  ({ key: sortKey, descending } = sorts[view]); page = 0; $('error').hidden = true; render();
}
function render() {
  const current = view === 'current';
  $('record-inputs').hidden = current; $('ongoing-label').hidden = current; $('current-filter-note').hidden = !current;
  for (const key of ['finder', 'current']) { if (key === view) $(`${key}-link`).setAttribute('aria-current', 'page'); else $(`${key}-link`).removeAttribute('aria-current'); }
  const title = current ? `${data.activeSeason} current records · same-franchise history` : `Seasons starting ${recordText(state.wins, state.losses, state.ties)}`;
  $('results-heading').textContent = title; $('caption').textContent = title;
  let rows;
  if (current) {
    rows = currentComparisons(data, state);
    $('stats').hidden = true;
    $('summary-note').textContent = `${rows.length} current team${rows.length === 1 ? '' : 's'}. Historical rates use the filters above and exclude ${data.activeSeason}. Expand a team to see its matching prior seasons here, or select its record to open the finder. Teams on byes may have played fewer games.`;
    $('table-note').textContent = 'Click a column to sort. Counts are prior completed seasons for that franchise, not league-wide samples. A dash means no eligible historical sample.';
  } else {
    rows = filterSeasons(data.seasons, state, state);
    const summary = summarize(rows); $('stats').hidden = false; $('stats').replaceChildren();
    const addStat = (label, value, detail) => { const item = make('div', null, 'stat'); item.append(make('strong', value), make('span', label)); if (detail) item.append(make('span', detail, 'detail')); $('stats').append(item); };
    addStat('Completed seasons', summary.count);
    for (const [key, label] of [['playoffs', 'Made playoffs'], ['playoffWin', 'Won a playoff game'], ['superBowl', 'Reached Super Bowl'], ['superBowlWin', 'Won Super Bowl']]) addStat(label, pct(summary[key].percent), `${summary[key].count} / ${summary[key].total} eligible seasons`);
    addStat('Average final record', summary.count ? `${summary.avgWins.toFixed(1)}–${summary.avgLosses.toFixed(1)}–${summary.avgTies.toFixed(1)}` : '—', 'Wins–losses–ties');
    $('summary-note').textContent = `${rows.length} matching franchise-season${rows.length === 1 ? '' : 's'}${summary.ongoing ? `, including ${summary.ongoing} unfinished (excluded from all percentages and averages)` : ''}. Rates describe historical results, not predictions.`;
    $('table-note').textContent = 'Click a column to sort. Green: Super Bowl winner. Yellow: unfinished season. Final records are regular season only.';
  }
  const columns = current ? [{ key: 'team', label: 'Team' }, { key: 'games', label: 'Games', numeric: true }, { key: 'record', label: 'Current record' }, { key: 'sample', label: 'Prior seasons', numeric: true }, { key: 'playoffs', label: 'Made playoffs', numeric: true }, { key: 'superBowl', label: 'Reached Super Bowl', numeric: true }, { key: 'superBowlWin', label: 'Won Super Bowl', numeric: true }, { key: 'avgWins', label: 'Avg final wins', numeric: true }] :
    [{ key: 'season', label: 'Season', numeric: true }, { key: 'team', label: 'Franchise' }, { key: 'wins', label: 'Final record', numeric: true }, { key: 'winPct', label: 'Final win %', numeric: true }, { key: 'playoffWins', label: 'Playoff wins', numeric: true }, { key: 'outcome', label: 'Season result' }];
  const value = (row, key) => key === 'team' ? TEAMS[row.team].name : key === 'record' ? row.wins : key === 'sample' ? row.summary.count : key === 'avgWins' ? row.summary.avgWins :
    current && ['playoffs', 'superBowl', 'superBowlWin'].includes(key) ? row.summary[key].percent : key === 'winPct' ? row.games ? (row.wins + row.ties / 2) / row.games : null : row[key];
  rows.sort((a, b) => { const x = value(a, sortKey), y = value(b, sortKey); if (x == null || y == null) return x == null && y == null ? a.team.localeCompare(b.team) : x == null ? 1 : -1;
    const order = typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); return (descending ? -order : order) || b.season - a.season || TEAMS[a.team].name.localeCompare(TEAMS[b.team].name); });
  $('table-head').replaceChildren();
  for (const col of columns) {
    const th = make('th', null, col.numeric ? 'number' : ''); th.scope = 'col'; th.setAttribute('aria-sort', col.key === sortKey ? descending ? 'descending' : 'ascending' : 'none');
    const button = make('button', col.label); button.type = 'button';
    if (sortKey === col.key) { const arrow = make('span', descending ? ' ↓' : ' ↑'); arrow.setAttribute('aria-hidden', 'true'); button.append(arrow); }
    button.addEventListener('click', () => { descending = sortKey === col.key ? !descending : !!col.numeric; sortKey = col.key; sorts[view] = { key: sortKey, descending }; page = 0; render(); $('table-head').querySelectorAll('button')[columns.indexOf(col)].focus(); });
    th.append(button); $('table-head').append(th);
  }
  const pages = Math.max(1, Math.ceil(rows.length / 50)); page = Math.min(page, pages - 1);
  $('table-body').replaceChildren();
  for (const row of rows.slice(page * 50, (page + 1) * 50)) {
    const tr = current ? make('tr') : seasonRow(row);
    if (current) {
      tr.append(teamCell(row.team), make('td', row.games, 'number'));
      const cell = make('td'), link = make('a', recordText(row.wins, row.losses, row.ties)); link.href = historyUrl(row);
      link.setAttribute('aria-label', `${TEAMS[row.team].name} ${recordText(row.wins, row.losses, row.ties)} history`); cell.append(link, make('span', 'View past seasons', 'detail')); tr.append(cell, make('td', row.summary.count, 'number'));
      for (const key of ['playoffs', 'superBowl', 'superBowlWin']) tr.append(rateCell(row.summary[key]));
      tr.append(make('td', row.summary.avgWins == null ? '—' : row.summary.avgWins.toFixed(1), 'number'));
    }
    $('table-body').append(tr);
    if (current) $('table-body').append(attachHistory(row, tr, columns.length));
  }
  $('empty').hidden = rows.length > 0; $('pagination').hidden = current || rows.length <= 50;
  $('page-label').textContent = `${page * 50 + 1}–${Math.min((page + 1) * 50, rows.length)} of ${rows.length}`;
  $('previous').disabled = page === 0; $('next').disabled = page >= pages - 1;
}
$('filters').addEventListener('submit', event => {
  event.preventDefault(); if (!data) return;
  const next = { ...state };
  for (const key of fields) next[key === 'team-filter' ? 'team' : key] = ['era', 'format', 'team-filter'].includes(key) ? $(key).value : Number($(key).value);
  next.ongoing = $('ongoing').checked;
  try { validateRecord(next.wins, next.losses, next.ties); if (next.from > next.to) throw new Error('The first season must not be after the last season.'); }
  catch (error) { $('error').textContent = error.message; $('error').hidden = false; return; }
  $('error').hidden = true; state = next; page = 0; setUrl(); render();
});
for (const [id, delta] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => { page += delta; render(); });
window.addEventListener('hashchange', readUrl); window.addEventListener('popstate', readUrl);
try {
  const response = await fetch('../../data/record-finder.json'); if (!response.ok) throw new Error('Data unavailable');
  data = await response.json(); if (!validRecordData(data)) throw new Error('Incomplete data');
  for (const id of ['from', 'to']) $(id).max = data.activeSeason;
  const checked = new Date(data.checkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
  $('status').textContent = `History: 1920–${data.throughSeason} completed · Active season: ${data.activeSeason} · Games through ${data.through} · Last checked ${checked} Eastern`;
  readUrl();
} catch { data = null; $('status').textContent = 'Season history could not be loaded. Please refresh to try again.'; $('filters').hidden = true; }
