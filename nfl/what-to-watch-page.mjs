import { TEAMS } from './divstreaks-data.mjs';
import { WATCH_CATEGORIES, validWatchSnapshot } from './what-to-watch-data.mjs?v=watch-1';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
const logoPath = team => `../images/nfl/${({ LA: 'lar', WAS: 'wsh' })[team] || team.toLowerCase()}.png`;
const date = (value, options = { month: 'short', day: 'numeric' }) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
const round = game => ({ REG: `Week ${game.week}`, WC: 'Wild Card', DIV: 'Divisional round', CON: 'Conference championships', SB: 'Super Bowl' })[game.type];
const kickoff = game => {
  if (!/^\d{2}:\d{2}$/.test(game.kickoff || '')) return '';
  const [hour, minute] = game.kickoff.split(':').map(Number);
  return ` · ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'a.m.' : 'p.m.'} ET`;
};
const categoryOrder = ['postseason', 'matchup', 'team', 'qb', 'receiving', 'kicking'];
const teamFromUrl = () => { const team = new URLSearchParams(location.search).get('team'); return Object.hasOwn(TEAMS, team) ? team : 'all'; };
let data, view, selectedTeam = teamFromUrl(), category = 'all';
function logo(team, size = 30) {
  const img = make('img'); img.src = logoPath(team); img.alt = ''; img.width = size; img.height = size; return img;
}
function syncTeam() {
  for (const b of $('team-filter').children) b.setAttribute('aria-pressed', String(b.dataset.team === selectedTeam));
  $('selected-team').textContent = selectedTeam === 'all' ? 'All teams' : TEAMS[selectedTeam].name;
}
function buildFilters() {
  for (const [team, label] of [['all', 'All teams'], ...Object.entries(TEAMS).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([t, info]) => [t, info.name])]) {
    const button = make('button', team === 'all' ? label : null, `team-button${team === 'all' ? ' all-teams' : ''}`);
    button.type = 'button'; button.dataset.team = team; button.title = label; button.setAttribute('aria-label', label);
    if (team !== 'all') button.append(logo(team));
    button.addEventListener('click', () => {
      selectedTeam = selectedTeam === team ? 'all' : team;
      const url = new URL(location.href);
      if (selectedTeam === 'all') url.searchParams.delete('team'); else url.searchParams.set('team', selectedTeam);
      history.replaceState(null, '', url); syncTeam(); render();
    });
    $('team-filter').append(button);
  }
  for (const [key, label] of [['all', 'All streaks'], ...Object.entries(WATCH_CATEGORIES)]) {
    const button = make('button', label, 'category'); button.type = 'button'; button.setAttribute('aria-pressed', String(key === category));
    button.addEventListener('click', () => {
      category = key;
      for (const b of $('categories').children) b.setAttribute('aria-pressed', String(b === button));
      render();
    });
    $('categories').append(button);
  }
  syncTeam(); $('search').addEventListener('input', render);
}
function renderNote(event) {
  const li = make('li', null, `note ${event.kind}`), tags = make('div', null, 'tags');
  tags.append(make('span', WATCH_CATEGORIES[event.category], 'tag'), make('span', view === 'ended' ? 'Ended' : event.kind === 'drought' ? 'Drought in reach' : 'Streak on the line', 'tag'));
  li.append(tags, make('h4', event.title), make('p', event.action, 'action'));
  const context = make('details', null, 'context'); context.append(make('summary', 'Context & source'));
  if (event.detail) context.append(make('p', event.detail));
  if (event.sourceThrough) context.append(make('p', `Source results through ${date(event.sourceThrough, { month: 'short', day: 'numeric', year: 'numeric' })}.`));
  const link = make('a', event.href.endsWith('#method') ? 'How this is tracked' : 'Open tracker →'); link.href = event.href;
  context.append(link); li.append(context); return li;
}
function renderGame(game, events) {
  const article = make('article', null, 'game'), header = make('header', null, 'game-header'); article.dataset.game = game.id;
  header.append(make('p', `${round(game)} · ${date(game.date, { weekday: 'short', month: 'short', day: 'numeric' })}${game.completed ? ' · Final' : kickoff(game)}`, 'game-date'));
  const h3 = make('h3', null, 'matchup');
  for (const [i, team] of [game.away, game.home].entries()) {
    if (i) h3.append(make('span', game.location === 'Neutral' ? 'vs.' : 'at', 'versus'));
    const club = make('span', null, 'club'); club.append(logo(team, 27), make('span', TEAMS[team].name)); h3.append(club);
  }
  header.append(h3);
  if (game.completed) header.append(make('p', `${TEAMS[game.away].name} ${game.awayScore} — ${TEAMS[game.home].name} ${game.homeScore}`, 'final'));
  article.append(header);
  const list = make('ul', null, 'notes');
  const ordered = [...events].sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || b.value - a.value || a.id.localeCompare(b.id));
  list.append(...ordered.map(renderNote)); article.append(list); return article;
}
function render() {
  const ended = view === 'ended', events = ended ? data.ended : data.watch;
  const byId = new Map(data.games.map(g => [g.id, g])), query = $('search').value.trim().toLocaleLowerCase();
  const filtered = events.filter(event => {
    const game = byId.get(event.game);
    return (category === 'all' || category === event.category) &&
      (selectedTeam === 'all' || [game.home, game.away].includes(selectedTeam)) &&
      `${event.title} ${event.detail} ${event.action} ${TEAMS[game.home].name} ${TEAMS[game.away].name}`.toLocaleLowerCase().includes(query);
  });
  const grouped = new Map();
  for (const event of filtered) { const rows = grouped.get(event.game) || []; rows.push(event); grouped.set(event.game, rows); }
  const games = [...grouped].sort(([a], [b]) => {
    const first = byId.get(a), second = byId.get(b), difference = first.date.localeCompare(second.date) || (first.kickoff || '24:00').localeCompare(second.kickoff || '24:00') || first.id.localeCompare(second.id);
    return ended ? -difference : difference;
  });
  $('games').replaceChildren(...games.map(([id, rows]) => renderGame(byId.get(id), rows)));
  $('view-title').textContent = ended ? `Ended in ${data.season}` : data.week ? `What’s at stake · ${round(data.week)}` : 'Between seasons';
  $('view-description').textContent = ended ? 'Notable streaks and droughts broken in completed games this NFL season, newest first. The same thresholds apply as in the weekly watch list.' :
    data.week ? 'Remaining games with a qualifying streak or drought. Each note says what would extend the run or end the wait.' : 'No remaining games are listed for this season. Revisit the runs that ended, or check back when the next schedule is available.';
  $('count').textContent = `${filtered.length} ${filtered.length === 1 ? 'note' : 'notes'} across ${games.length} ${games.length === 1 ? 'game' : 'games'}${!ended && data.week ? ` · ${data.week.games.length} games remaining in this round` : ''}.`;
  $('empty').hidden = !!filtered.length;
  $('empty').textContent = query || selectedTeam !== 'all' || category !== 'all' ? 'No streaks match these filters. Try another team or category, or clear your search.' :
    ended ? 'No tracked streaks meeting these thresholds have ended this season yet.' : 'No remaining games have a tracked streak that meets these thresholds.';
  for (const key of ['watch', 'ended']) {
    $(key + '-link').textContent = `${key === 'watch' ? 'This week' : 'Ended this season'} (${data[key].length})`;
    if (key === view) $(key + '-link').setAttribute('aria-current', 'page'); else $(key + '-link').removeAttribute('aria-current');
  }
}
function syncView() {
  if (!data) return;
  if (location.hash !== '#method') view = location.hash === '#ended' ? 'ended' : 'watch';
  selectedTeam = teamFromUrl(); syncTeam(); render();
}
async function init() {
  try {
    const response = await fetch('../data/what-to-watch.json?v=watch-1', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incoming = await response.json(); if (!validWatchSnapshot(incoming)) throw new Error('Invalid watch list');
    data = incoming; view = location.hash === '#ended' ? 'ended' : 'watch';
    $('edition').textContent = `${data.season} season${data.week ? ` · ${round(data.week)}` : ' · Season complete'}`;
    $('dates').textContent = data.week ? `${date(data.week.start)}–${date(data.week.end)}` : '';
    $('freshness').textContent = `Results through ${date(data.through)}. Player feeds: QB starts ${date(data.coverage.qbs)} · receiving ${date(data.coverage.receiving)} · kicking ${date(data.coverage.kicking)}. Refreshed ${date(data.checkedAt.slice(0, 10))}.`;
    if (data.week && data.week.games[0].date < new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10))
      $('freshness').append(' Some scheduled results are still pending in the source; this is the latest saved watch list.');
    buildFilters(); render(); $('status').hidden = true; $('content').hidden = false;
    window.addEventListener('hashchange', syncView); window.addEventListener('popstate', syncView);
  } catch (error) {
    $('status').replaceChildren(make('span', 'The weekly watch list could not load. '));
    const retry = make('a', 'Reload this page'); retry.href = location.href; $('status').append(retry, make('span', ' or use the individual NFL trackers below.'));
    console.error(error);
  }
}
init();
