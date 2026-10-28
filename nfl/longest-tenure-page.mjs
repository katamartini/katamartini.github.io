import { DIVISIONS, TEAMS } from './divstreaks-data.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const views = {
  active: { title: 'Top 100 active player-team tenures', description: 'The 100 longest current stays across all players and positions, including practice-squad and reserve players.' },
  'all-time': { title: 'Top 100 all-time player-team tenures', description: 'The 100 longest recorded stays with a single franchise, including completed and active tenures. Roster history begins in 1920.' },
  franchise: { title: 'Franchise tenure leaderboards', description: 'Each player’s longest stay with a franchise, ranked within that team. Select a team logo for its top 100. All teams shows the 100 longest franchise entries overall.' },
  teams: { title: 'Current team leaders', description: 'Each franchise’s longest current stay, including ties.' },
};
let data, view, sort = 'longest';
const logoPath = team => `../images/nfl/${({ LA: 'lar', WAS: 'wsh' })[team] || team.toLowerCase()}.png`;
const teamFromUrl = () => { const team = new URLSearchParams(location.search).get('team'); return Object.hasOwn(TEAMS, team) ? team : 'all'; };
let selectedTeam = teamFromUrl();
const divisionIndex = team => DIVISIONS.findIndex(division => division.teams.includes(team));
const longestFirst = (a, b) => b.seasons - a.seasons || a.since - b.since || a.players[0].name.localeCompare(b.players[0].name) || a.team.localeCompare(b.team);
function updateTeamButtons() {
  for (const button of $('team-filter').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.team === selectedTeam));
  $('selected-team').textContent = data.teams.find(row => row.team === selectedTeam)?.name || 'All teams';
}
function buildTeamButtons() {
  const names = Object.fromEntries(data.teams.map(row => [row.team, row.name]));
  for (const [team] of [['all'], ...Object.entries(TEAMS).sort((a, b) => a[1].name.localeCompare(b[1].name))]) {
    const label = names[team] || 'All teams', button = make('button', team === 'all' ? label : null, team === 'all' ? 'all-teams' : '');
    button.type = 'button'; button.dataset.team = team; button.title = label; button.setAttribute('aria-label', label);
    if (team !== 'all') {
      const logo = make('img'); logo.src = logoPath(team); logo.alt = ''; logo.width = 30; logo.height = 30; button.append(logo);
    }
    button.addEventListener('click', () => {
      selectedTeam = selectedTeam === team ? 'all' : team;
      const url = new URL(location.href);
      if (selectedTeam === 'all') url.searchParams.delete('team'); else url.searchParams.set('team', selectedTeam);
      history.replaceState(null, '', url); updateTeamButtons(); render();
    });
    $('team-filter').append(button);
  }
  updateTeamButtons(); $('team-picker').hidden = false;
}
function render() {
  if (!data) return;
  let all;
  if (view === 'teams') all = data.teams.map(row => ({ ...row, through: data.season, active: true }));
  else if (view === 'franchise') {
    const leaders = selectedTeam === 'all' ? Object.values(data.franchiseLeaders).flat() : data.franchiseLeaders[selectedTeam];
    all = leaders.map(row => ({ ...row, players: [row] })).sort(longestFirst).slice(0, 100);
  } else all = data[view === 'all-time' ? 'allTime' : 'active'].map(row => ({ ...row, players: [row] }));
  const historical = view === 'all-time' || view === 'franchise';
  const names = Object.fromEntries(data.teams.map(row => [row.team, row.name]));
  const query = $('search').value.trim().toLocaleLowerCase();
  const rows = all.filter(row => (selectedTeam === 'all' || row.team === selectedTeam) && `${names[row.team]} ${row.players.map(player => `${player.name} ${player.position}`).join(' ')}`.toLocaleLowerCase().includes(query));
  rows.sort(sort === 'division' ? (a, b) => divisionIndex(a.team) - divisionIndex(b.team) || names[a.team].localeCompare(names[b.team]) || b.seasons - a.seasons : longestFirst);
  const longest = Math.max(...all.map(row => row.seasons));
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const article = make('article', null, `team-row${historical && row.active ? ' current' : ''}`);
    const team = make('div', null, 'team');
    const teamName = make('strong', null, 'team-name'), logo = make('img', null, 'team-logo');
    logo.src = logoPath(row.team); logo.alt = ''; logo.width = 26; logo.height = 26; logo.loading = 'lazy';
    teamName.append(logo, make('span', names[row.team]));
    team.append(teamName, make('span', `${DIVISIONS[divisionIndex(row.team)].name}${row.players.length > 1 ? ' · Tied' : ''}`, 'division'));
    const players = make('div', null, 'players');
    for (const player of row.players) {
      const name = make('span', null, 'player');
      if (row.rank) name.append(make('span', `${row.rank}.`, 'rank'));
      name.append(make('strong', player.name), make('span', player.position, 'position')); players.append(name);
    }
    const tenure = make('div', null, 'tenure'), label = make('div', null, 'tenure-label');
    label.append(make('strong', row.seasons), make('span', row.seasons === 1 ? 'season' : 'seasons'));
    const range = view === 'teams' ? `Since ${row.since}` : `${row.since}–${row.through}${historical ? row.active ? ' · Active' : ' · Ended' : ''}`;
    const track = make('div', null, 'track'), bar = make('span', null, 'bar'); track.setAttribute('aria-hidden', 'true');
    bar.style.setProperty('--width', `${row.seasons / longest * 100}%`); bar.style.setProperty('--team-color', TEAMS[row.team].color); track.append(bar);
    tenure.append(label, make('span', range, 'since'), track); article.append(team, players, tenure); fragment.append(article);
  }
  $('teams').replaceChildren(fragment); $('teams').setAttribute('aria-label', views[view].title);
  $('player-column-label').textContent = view === 'teams' ? 'Longest-tenured player · position' : view === 'franchise' ? 'Franchise rank · player · position' : 'Rank · player · position';
  $('empty').hidden = rows.length > 0;
  $('result-count').textContent = `Showing ${rows.length} of ${all.length} ${view === 'teams' ? 'teams' : 'player-team tenures'}.${view === 'franchise' ? ' Ranks are within each franchise.' : ''}`;
}
function setView() {
  if (!data) return;
  view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'active';
  selectedTeam = teamFromUrl(); updateTeamButtons();
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
  const response = await fetch('../data/longest-tenure.json?v=tenure-franchise-logos-1', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Tenure data unavailable');
  const saved = await response.json();
  const validRow = row => TEAMS[row.team] && row.id && row.name && Number.isInteger(row.since) && Number.isInteger(row.through) &&
    row.since >= 1920 && row.through <= saved.season && row.seasons === row.through - row.since + 1 && row.seasons > 0 && Number.isInteger(row.rank) && row.rank > 0 && typeof row.active === 'boolean';
  if (saved.schemaVersion !== 2 || saved.firstSeason !== 1920 || !Number.isInteger(saved.season) || !Number.isFinite(Date.parse(saved.updated)) || !Array.isArray(saved.teams) || saved.teams.length !== 32 ||
    new Set(saved.teams.map(row => row.team)).size !== 32 || saved.teams.some(row => !TEAMS[row.team] || !row.name || !row.players?.length) ||
    ['active', 'allTime'].some(key => !Array.isArray(saved[key]) || saved[key].length !== Math.min(100, saved[`${key}Count`]) || saved[key].some(row => !validRow(row))) ||
    !saved.franchiseLeaders || Object.keys(saved.franchiseLeaders).length !== 32 || Object.keys(TEAMS).some(team =>
      !Array.isArray(saved.franchiseLeaders[team]) || !saved.franchiseLeaders[team].length || saved.franchiseLeaders[team].length > 100 ||
      new Set(saved.franchiseLeaders[team].map(row => row.id)).size !== saved.franchiseLeaders[team].length || saved.franchiseLeaders[team].some(row => !validRow(row) || row.team !== team)) ||
    saved.active.some(row => !row.active || row.through !== saved.season)) throw new Error('Incomplete tenure data');
  data = saved;
  buildTeamButtons();
  const meta = document.querySelector('.meta'), teamCount = make('span'), rosterWeek = make('span'), updated = make('span', 'Updated ');
  teamCount.append(make('strong', data.teams.length), ' teams');
  rosterWeek.append(make('strong', data.season), ` season · roster data through Week ${data.week}`);
  const date = make('time', new Date(`${data.updated}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })); date.dateTime = data.updated;
  updated.append(date); meta.replaceChildren(teamCount, rosterWeek, updated);
  $('controls').hidden = false; $('result-count').hidden = false; $('load-status').hidden = true; setView();
} catch {
  $('load-status').textContent = 'The top 100 lists could not be loaded. The saved current team leaders are shown below; refresh to try again.';
}
