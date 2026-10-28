import { DIVISIONS, TEAMS } from './divstreaks-data.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const views = {
  active: { title: 'Top 100 active player-team tenures', description: 'The 100 longest current stays across all players and positions, including practice-squad and reserve players.' },
  'all-time': { title: 'Top 100 all-time player-team tenures', description: 'The 100 longest recorded stays with a single franchise, including completed and active tenures. Roster history begins in 1920.' },
  teams: { title: 'Current team leaders', description: 'Each franchise’s longest current stay, including ties.' },
};
let data, view, sort = 'longest';
const divisionIndex = team => DIVISIONS.findIndex(division => division.teams.includes(team));
function render() {
  if (!data) return;
  const all = view === 'teams' ? data.teams.map(row => ({ ...row, through: data.season, active: true })) :
    data[view === 'all-time' ? 'allTime' : 'active'].map(row => ({ ...row, players: [row] }));
  const names = Object.fromEntries(data.teams.map(row => [row.team, row.name]));
  const query = $('search').value.trim().toLocaleLowerCase();
  const rows = all.filter(row => `${names[row.team]} ${row.players.map(player => `${player.name} ${player.position}`).join(' ')}`.toLocaleLowerCase().includes(query));
  rows.sort(sort === 'division' ? (a, b) => divisionIndex(a.team) - divisionIndex(b.team) || names[a.team].localeCompare(names[b.team]) || b.seasons - a.seasons :
    (a, b) => b.seasons - a.seasons || a.since - b.since || a.players[0].name.localeCompare(b.players[0].name) || a.team.localeCompare(b.team));
  const longest = Math.max(...all.map(row => row.seasons));
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const article = make('article', null, `team-row${view === 'all-time' && row.active ? ' current' : ''}`);
    const team = make('div', null, 'team');
    team.append(make('strong', names[row.team], 'team-name'), make('span', `${DIVISIONS[divisionIndex(row.team)].name}${row.players.length > 1 ? ' · Tied' : ''}`, 'division'));
    const players = make('div', null, 'players');
    for (const player of row.players) {
      const name = make('span', null, 'player');
      if (row.rank) name.append(make('span', `${row.rank}.`, 'rank'));
      name.append(make('strong', player.name), make('span', player.position, 'position')); players.append(name);
    }
    const tenure = make('div', null, 'tenure'), label = make('div', null, 'tenure-label');
    label.append(make('strong', row.seasons), make('span', row.seasons === 1 ? 'season' : 'seasons'));
    const range = view === 'teams' ? `Since ${row.since}` : `${row.since}–${row.through}${view === 'all-time' ? row.active ? ' · Active' : ' · Ended' : ''}`;
    const track = make('div', null, 'track'), bar = make('span', null, 'bar'); track.setAttribute('aria-hidden', 'true');
    bar.style.setProperty('--width', `${row.seasons / longest * 100}%`); bar.style.setProperty('--team-color', TEAMS[row.team].color); track.append(bar);
    tenure.append(label, make('span', range, 'since'), track); article.append(team, players, tenure); fragment.append(article);
  }
  $('teams').replaceChildren(fragment); $('teams').setAttribute('aria-label', views[view].title);
  $('player-column-label').textContent = view === 'teams' ? 'Longest-tenured player · position' : 'Rank · player · position';
  $('empty').hidden = rows.length > 0;
  $('result-count').textContent = `Showing ${rows.length} of ${all.length} ${view === 'teams' ? 'teams' : 'player-team tenures'}.`;
}
function setView() {
  if (!data) return;
  view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'active';
  sort = 'longest';
  for (const button of document.querySelectorAll('[data-sort]')) button.setAttribute('aria-pressed', String(button.dataset.sort === sort));
  $('view-heading').textContent = views[view].title; $('view-description').textContent = views[view].description;
  for (const key of Object.keys(views)) {
    const link = $(`${key}-link`); if (key === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  render();
}
for (const button of document.querySelectorAll('[data-sort]')) button.addEventListener('click', () => {
  sort = button.dataset.sort;
  for (const item of document.querySelectorAll('[data-sort]')) item.setAttribute('aria-pressed', String(item === button));
  render();
});
$('search').addEventListener('input', render); window.addEventListener('hashchange', setView);
$('load-status').hidden = false; $('load-status').textContent = 'Loading player-team tenure lists…';
try {
  const response = await fetch('../data/longest-tenure.json?v=tenure-top100-1', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Tenure data unavailable');
  const saved = await response.json();
  const validRow = row => TEAMS[row.team] && row.id && row.name && Number.isInteger(row.since) && Number.isInteger(row.through) &&
    row.since >= 1920 && row.through <= saved.season && row.seasons === row.through - row.since + 1 && row.seasons > 0 && Number.isInteger(row.rank) && row.rank > 0 && typeof row.active === 'boolean';
  if (saved.schemaVersion !== 2 || saved.firstSeason !== 1920 || !Number.isInteger(saved.season) || !Number.isFinite(Date.parse(saved.updated)) || !Array.isArray(saved.teams) || saved.teams.length !== 32 ||
    new Set(saved.teams.map(row => row.team)).size !== 32 || saved.teams.some(row => !TEAMS[row.team] || !row.name || !row.players?.length) ||
    ['active', 'allTime'].some(key => !Array.isArray(saved[key]) || saved[key].length !== Math.min(100, saved[`${key}Count`]) || saved[key].some(row => !validRow(row))) ||
    saved.active.some(row => !row.active || row.through !== saved.season)) throw new Error('Incomplete tenure data');
  data = saved;
  const meta = document.querySelector('.meta'), teamCount = make('span'), rosterWeek = make('span'), updated = make('span', 'Updated ');
  teamCount.append(make('strong', data.teams.length), ' teams');
  rosterWeek.append(make('strong', data.season), ` season · roster data through Week ${data.week}`);
  const date = make('time', new Date(`${data.updated}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })); date.dateTime = data.updated;
  updated.append(date); meta.replaceChildren(teamCount, rosterWeek, updated);
  $('controls').hidden = false; $('result-count').hidden = false; $('load-status').hidden = true; setView();
} catch {
  $('load-status').textContent = 'The top 100 lists could not be loaded. The saved current team leaders are shown below; refresh to try again.';
}
