import { TEAMS } from './divstreaks-data.mjs';
import { WATCH_CATEGORIES, validWatchSnapshot } from './what-to-watch-data.mjs?v=watch-weekly-4';

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
let data, view, selectedTeam = teamFromUrl(), category = 'all', selectedWeek, outcome = 'all';
const viewFromHash = () => location.hash === '#weekly' ? 'weekly' : location.hash === '#ended' ? 'ended' : 'watch';
function weekFromUrl() {
  const weeks = data.weeks || [], requested = new URLSearchParams(location.search).get('week');
  return weeks.find(week => week.id === requested)?.id || weeks.filter(week => week.completedGames === week.totalGames).at(-1)?.id || weeks.at(-1)?.id;
}
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
function buildWeeklyFilters() {
  for (const week of data.weeks || []) {
    const button = make('button', round(week), 'category'); button.type = 'button'; button.dataset.week = week.id;
    button.title = `${round(week)} · ${week.completedGames}/${week.totalGames} games final`;
    button.addEventListener('click', () => {
      selectedWeek = week.id;
      const url = new URL(location.href); url.searchParams.set('week', week.id); history.replaceState(null, '', url); render();
    });
    $('week-filter').append(button);
  }
  for (const [status, label] of [['all', 'All results'], ['continued', 'Continued'], ['ended', 'Ended'], ['pending', 'Pending']]) {
    const button = make('button', label, 'outcome-button'); button.type = 'button'; button.dataset.outcome = status;
    button.addEventListener('click', () => { outcome = status; render(); }); $('week-outcomes').append(button);
  }
}
function renderNote(event) {
  const li = make('li', null, `note ${event.kind}`), tags = make('div', null, 'tags');
  const ended = view === 'ended' || view === 'weekly' && event.status === 'ended';
  const status = view === 'weekly' ? ({ continued: 'Continued', ended: 'Ended', pending: 'Pending' })[event.status] : ended ? 'Ended' : event.kind === 'drought' ? 'Drought in reach' : 'Streak on the line';
  tags.append(make('span', WATCH_CATEGORIES[event.category], 'tag'), make('span', status, `tag outcome-${event.status}`));
  if (view === 'weekly' && event.newlyNoteworthy) tags.append(make('span', 'Newly noteworthy', 'tag'));
  li.append(tags, make('h4', event.title), make('p', event.action, 'action'));
  if (event.drought) {
    const d = event.drought;
    let text = `${d.count} ${d.unit}`;
    if (d.elapsed) text += ` · ${d.lowerBound ? 'at least ' : ''}${d.elapsed} ${d.anchor} (${date(d.since, { month: 'short', day: 'numeric', year: 'numeric' })})`;
    else if (d.lastSeason != null) text += ` · Last achieved in the ${d.lastSeason} season`;
    else if (d.never) text += ' · Never achieved in the Super Bowl era';
    const length = make('p', null, 'drought-length');
    length.append(make('strong', ended ? 'Drought ended: ' : view === 'weekly' && event.status === 'continued' ? 'Drought continued: ' : 'Would end: '), document.createTextNode(text)); li.append(length);
  }
  if (event.leaderboard) li.append(renderLeaderboard(event));
  const context = make('details', null, 'context'); context.append(make('summary', 'Context & source'));
  if (event.detail) context.append(make('p', event.detail));
  if (event.sourceThrough) context.append(make('p', `Source results through ${date(event.sourceThrough, { month: 'short', day: 'numeric', year: 'numeric' })}.`));
  const link = make('a', event.href.endsWith('#method') ? 'How this is tracked' : 'Open tracker →'); link.href = event.href;
  context.append(link); li.append(context); return li;
}
function renderLeaderboard(event) {
  const board = event.leaderboard, box = make('div', null, 'leaderboard');
  if (board.label) box.append(make('p', board.label, 'rank-label'));
  const rankText = row => `${row.tied ? 'Tied ' : ''}#${row.rank}`;
  for (const [key, label] of [['franchise', TEAMS[board.franchiseTeam].name], ['overall', board.overall.scope]]) {
    const row = board[key]; if (!row) continue;
    const comparison = make('div', null, 'rank-comparison'); comparison.dataset.scope = key;
    const line = make('p', null, 'rank-line');
    line.append(make('strong', `${row.partial && key === 'franchise' ? 'Recorded ' : ''}${label}: ${rankText(row)}`), document.createTextNode(` · ${row.lowerBound ? 'at least ' : ''}${row.length} ${row.length === 1 ? event.unit.slice(0, -1) : event.unit}`));
    comparison.append(line);
    const qualification = key === 'franchise' && row.length !== event.value ? `This team’s portion of the ${event.value}-${event.unit === 'games' ? 'game' : event.unit === 'kicks' ? 'kick' : 'start'} career run. ` : '';
    if (qualification) comparison.append(make('p', qualification.trim(), 'rank-coverage'));
    if (row.nextHigher?.length === row.record) comparison.append(renderTarget('Next higher / record', row.record, row.recordHolders, event.unit));
    else {
      if (row.nextHigher) comparison.append(renderTarget('Next higher', row.nextHigher.length, row.nextHigher.holders, event.unit));
      else comparison.append(make('p', 'Next higher: no higher recorded run.', 'rank-target-empty'));
      comparison.append(renderTarget('Record', row.record, row.recordHolders, event.unit));
    }
    box.append(comparison);
  }
  const coverage = [...new Set([board.franchise, board.overall].filter(Boolean).map(row => `${row.coverage}${row.partial ? ' · partial historical coverage' : ''}`))];
  box.append(make('p', coverage.join(' / '), 'rank-coverage'));
  if (!board.franchise) box.append(make('p', 'No qualifying portion recorded for this franchise yet.', 'rank-coverage'));
  if (view === 'watch' && event.kind === 'streak') {
    const club = board.franchise, overall = board.overall;
    if (club && (club.next.rank !== club.rank || club.next.tied !== club.tied || club.length + 1 >= club.record) || overall.next.rank !== overall.rank || overall.next.tied !== overall.tied) {
      const projected = row => `${row.next.tied ? 'tied ' : ''}#${row.next.rank}`;
      let text = `One more: ${club ? `${TEAMS[board.franchiseTeam].name} ${projected(club)} · ` : ''}${overall.scope} ${projected(overall)}`;
      if (club && club.length + 1 === club.record) text += ' · ties the recorded franchise high';
      if (club && club.length >= club.record) text += ' · extends the recorded franchise high';
      box.append(make('p', text, 'rank-next'));
    }
  }
  return box;
}
function renderTarget(label, length, holders = [], unit) {
  const target = make('div', null, 'rank-target'); target.dataset.target = label.startsWith('Next higher') ? 'higher' : 'record';
  const header = make('p', null, 'rank-target-title');
  header.append(make('strong', `${label}: `), document.createTextNode(`${holders.some(holder => holder.lowerBound) ? 'at least ' : ''}${length} ${length === 1 ? unit.slice(0, -1) : unit}`));
  target.append(header);
  const holderLine = holder => {
    const teams = holder.teams.map(team => TEAMS[team]?.name || team).filter(name => name !== holder.name);
    const who = `${holder.name}${holder.opponent ? ` vs. ${TEAMS[holder.opponent]?.name || holder.opponent}` : ''}`;
    return make('p', `${who}${teams.length ? ` · ${teams.join(' / ')}` : ''} · ${holder.years}${holder.active ? ' · ongoing' : ''}${holder.lowerBound ? ' · minimum recorded run' : ''}`, 'rank-holder');
  };
  target.append(...holders.slice(0, 3).map(holderLine));
  if (holders.length > 3) {
    const more = make('details', null, 'rank-ties'); more.append(make('summary', `${holders.length - 3} more tied runs`), ...holders.slice(3).map(holderLine)); target.append(more);
  }
  return target;
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
  const ended = view === 'ended', weekly = view === 'weekly', week = data.weeks?.find(week => week.id === selectedWeek);
  const events = weekly ? week?.events || [] : ended ? data.ended : data.watch;
  const byId = new Map(data.games.map(g => [g.id, g])), query = $('search').value.trim().toLocaleLowerCase();
  const matching = events.filter(event => {
    const game = byId.get(event.game);
    return (category === 'all' || category === event.category) &&
      (selectedTeam === 'all' || [game.home, game.away].includes(selectedTeam)) &&
      `${event.title} ${event.detail} ${event.action} ${TEAMS[game.home].name} ${TEAMS[game.away].name}`.toLocaleLowerCase().includes(query);
  });
  const filtered = matching.filter(event => !weekly || outcome === 'all' || event.status === outcome);
  $('weekly-controls').hidden = !weekly;
  for (const button of $('week-filter').children) button.setAttribute('aria-pressed', String(button.dataset.week === selectedWeek));
  for (const button of $('week-outcomes').children) {
    const status = button.dataset.outcome, count = status === 'all' ? matching.length : matching.filter(event => event.status === status).length;
    button.textContent = `${({ all: 'All results', continued: 'Continued', ended: 'Ended', pending: 'Pending' })[status]} (${count})`;
    button.setAttribute('aria-pressed', String(status === outcome));
  }
  if (weekly && week) {
    const lag = Object.entries(week.awaitingFeeds).filter(([, games]) => games.length).map(([key, games]) => `${({ qbs: 'QB', receiving: 'receiving', kicking: 'kicking' })[key]} results pending for ${games.length} completed ${games.length === 1 ? 'game' : 'games'}`);
    $('week-schedule').textContent = `${week.completedGames} of ${week.totalGames} games final${lag.length ? ` · ${lag.join(' · ')}` : ''}.`;
  } else $('week-schedule').textContent = '';
  const edition = weekly ? week : data.week;
  $('edition').textContent = `${data.season} season${edition ? ` · ${round(edition)}` : ' · Season complete'}`;
  $('dates').textContent = edition ? `${date(edition.start)}–${date(edition.end)}` : '';
  const grouped = new Map();
  for (const event of filtered) { const rows = grouped.get(event.game) || []; rows.push(event); grouped.set(event.game, rows); }
  const games = [...grouped].sort(([a], [b]) => {
    const first = byId.get(a), second = byId.get(b), difference = first.date.localeCompare(second.date) || (first.kickoff || '24:00').localeCompare(second.kickoff || '24:00') || first.id.localeCompare(second.id);
    return ended ? -difference : difference;
  });
  $('games').replaceChildren(...games.map(([id, rows]) => renderGame(byId.get(id), rows)));
  $('view-title').textContent = weekly ? `${week ? round(week) : 'Weekly'} summary` : ended ? `Ended in ${data.season}` : data.week ? `What’s at stake · ${round(data.week)}` : 'Between seasons';
  $('view-description').textContent = weekly ? 'Which noteworthy runs continued, which ended, and which games are still pending. Lengths reflect that game’s result. New qualifiers are marked “Newly noteworthy.”' : ended ? 'Notable streaks and droughts broken in completed games this NFL season, newest first. The same thresholds apply as in the weekly watch list.' :
    data.week ? 'Remaining games with a qualifying streak or drought. Each note says what would extend the run or end the wait.' : 'No remaining games are listed for this season. Revisit the runs that ended, or check back when the next schedule is available.';
  $('count').textContent = `${filtered.length} ${filtered.length === 1 ? 'note' : 'notes'} across ${games.length} ${games.length === 1 ? 'game' : 'games'}${!ended && !weekly && data.week ? ` · ${data.week.games.length} games remaining in this round` : ''}.`;
  $('empty').hidden = !!filtered.length;
  $('empty').textContent = query || selectedTeam !== 'all' || category !== 'all' || weekly ? 'No streaks match these filters. Try another week, team, category, or result, or clear your search.' :
    ended ? 'No tracked streaks meeting these thresholds have ended this season yet.' : 'No remaining games have a tracked streak that meets these thresholds.';
  for (const key of ['watch', 'ended', 'weekly']) {
    $(key + '-link').textContent = key === 'weekly' ? 'Week-by-week' : `${key === 'watch' ? 'This week' : 'Ended this season'} (${data[key].length})`;
    if (key === view) $(key + '-link').setAttribute('aria-current', 'page'); else $(key + '-link').removeAttribute('aria-current');
  }
}
function syncView() {
  if (!data) return;
  if (location.hash !== '#method') view = viewFromHash();
  selectedTeam = teamFromUrl(); selectedWeek = weekFromUrl(); syncTeam(); render();
}
async function init() {
  try {
    const response = await fetch('../data/what-to-watch.json?v=watch-weekly-4', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incoming = await response.json(); if (!validWatchSnapshot(incoming)) throw new Error('Invalid watch list');
    data = incoming; view = viewFromHash(); selectedWeek = weekFromUrl();
    $('edition').textContent = `${data.season} season${data.week ? ` · ${round(data.week)}` : ' · Season complete'}`;
    $('dates').textContent = data.week ? `${date(data.week.start)}–${date(data.week.end)}` : '';
    $('freshness').textContent = `Results through ${date(data.through)}. Player feeds: QB starts ${date(data.coverage.qbs)} · receiving ${date(data.coverage.receiving)} · kicking ${date(data.coverage.kicking)}. Refreshed ${date(data.checkedAt.slice(0, 10))}.`;
    if (data.week && data.week.games[0].date < new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10))
      $('freshness').append(' Some scheduled results are still pending in the source; this is the latest saved watch list.');
    buildFilters(); buildWeeklyFilters(); render(); $('status').hidden = true; $('content').hidden = false;
    window.addEventListener('hashchange', syncView); window.addEventListener('popstate', syncView);
  } catch (error) {
    $('status').replaceChildren(make('span', 'The weekly watch list could not load. '));
    const retry = make('a', 'Reload this page'); retry.href = location.href; $('status').append(retry, make('span', ' or use the individual NFL trackers below.'));
    console.error(error);
  }
}
init();
