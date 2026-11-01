import { TEAMS } from './divstreaks-data.mjs';
import { seasonsSince, elapsedTime, daysBetween } from './droughts-data.mjs';
import { streakPosition } from './streak-context.mjs';
import { weeklyResult, qbWeeklyResults, summarizeWeeks, validWeeklySummaries } from './watch-weekly.mjs';

export function droughtLength(since, through, { count, unit, anchor, lowerBound = false } = {}) {
  return { since, through, elapsed: elapsedTime(since, through), days: daysBetween(since, through), count, unit, anchor, lowerBound };
}

export const WATCH_THRESHOLDS = { team: 5, matchup: 5, qb: 16, receiving: 50, fg: 20, kicks: 40, postseason: 5, fiveWinDrought: 10 };
export const WATCH_CATEGORIES = {
  team: 'Team runs', matchup: 'Matchups', qb: 'QB starts', receiving: 'Receiving', kicking: 'Kicking', postseason: 'Postseason',
};
const orderGames = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const opponent = (game, team) => game.home === team ? game.away : game.home;
const result = (game, team) => {
  const own = game.home === team ? game.homeScore : game.awayScore;
  const other = game.home === team ? game.awayScore : game.homeScore;
  return own === other ? 'T' : own > other ? 'W' : 'L';
};
const score = game => `${TEAMS[game.away].name} ${game.awayScore}, ${TEAMS[game.home].name} ${game.homeScore}`;
const point = (game, event, ended = false) => ({ ...event, id: `${event.id}:${game.id}`, game: game.id,
  date: game.date, season: game.season, week: game.week, gameType: game.type,
  status: ended ? 'ended' : 'watch', ...(ended ? { result: score(game) } : {}),
});

export function watchWeek(games, season) {
  const next = games.filter(g => g.season === season && !g.completed).sort(orderGames)[0];
  if (!next) return null;
  const weekGames = games.filter(g => g.season === season && g.week === next.week && g.type === next.type).sort(orderGames);
  return { season, week: next.week, type: next.type, start: weekGames[0].date, end: weekGames.at(-1).date,
    games: weekGames.filter(g => !g.completed) };
}

// Historical overall runs use each franchise's full schedule. Venue and matchup
// runs use nflverse's 1999+ results, where neutral-site designations are known.
export function teamWatchEvents(games, season, upcoming = [], earlierByTeam = {}, includeResults = false) {
  const watch = [], ended = [], pending = new Set(upcoming.map(g => g.id));
  const continued = [];
  const records = [], references = new Map();
  for (const team of Object.keys(TEAMS)) {
    const history = [...(earlierByTeam[team] || []), ...games.filter(g => g.home === team || g.away === team)].sort(orderGames);
    const states = new Map();
    for (const game of history) {
      if (game.type !== 'REG' || !game.completed && !pending.has(game.id)) continue;
      const other = opponent(game, team), venue = game.home === team ? 'home' : 'away';
      const contexts = ['overall'];
      if (game.season >= 1999) {
        contexts.push(`matchup:${other}`);
        if (game.location !== 'Neutral') contexts.push(venue, `matchup-${venue}:${other}`);
      }
      for (const context of contexts) {
        const state = states.get(context) || { wins: 0, losses: 0, winless: 0, lastWin: null, lastNonLoss: null, lastFive: null };
        const matchup = context.startsWith('matchup');
        const atVenue = context.includes('home') ? ' at home' : context.includes('away') ? ' on the road' : '';
        const suffix = matchup ? ` against the ${TEAMS[other]?.name || other}${atVenue}` : atVenue;
        const events = [];
        const base = { id: `${context}:${team}`, category: matchup ? 'matchup' : 'team', team,
          opponent: other, href: context !== 'overall' ? '/nfl/what-to-watch.html#method' : '/nfl/droughts.html#win-streaks',
          detail: '', sourceThrough: game.completed ? game.date : null };
        // A matchup watch describes the disadvantaged club's drought once,
        // rather than duplicating the same run as its opponent's winning streak.
        if (matchup && state.winless >= WATCH_THRESHOLDS.matchup) events.push({ ...base,
          id: `${base.id}:winless`, kind: 'drought', value: state.winless, unit: 'games',
          title: `${TEAMS[team].name}: ${state.winless} games without a win${suffix}`,
          detail: state.lastWin ? `Last win${suffix}: ${state.lastWin.date}.` : 'No earlier win in these matchup results, which begin in 1999.',
          drought: droughtLength(state.lastWin?.date || state.winlessStart, game.date, { count: state.winless, unit: 'meetings',
            anchor: state.lastWin ? 'since last win' : 'since first tracked winless meeting', lowerBound: !state.lastWin }),
          recordId: state.winlessRun.id,
          action: 'A win ends the drought; a tie keeps it going.', ends: 'W',
        });
        if (!matchup) {
          for (const [key, label, ends] of [['wins', 'wins', 'not-W'], ['losses', 'losses', 'not-L']]) {
            if (state[key] < WATCH_THRESHOLDS.team) continue;
            events.push({ ...base, id: `${base.id}:${key}`, kind: key === 'wins' ? 'streak' : 'drought',
              value: state[key], unit: 'games', href: context === 'overall' ? `/nfl/droughts.html#${key === 'wins' ? 'win' : 'loss'}-streaks` : base.href,
              title: `${TEAMS[team].name}: ${state[key]} straight ${label}${suffix}`,
              detail: `Run began ${state[`${key}Start`]}.`,
              recordId: state[`${key}Run`].id,
              ...(key === 'losses' ? { drought: droughtLength(state.lastNonLoss?.date || state.lossesStart, game.date,
                { count: state.losses, unit: 'losses', anchor: state.lastNonLoss ? `since last ${result(state.lastNonLoss, team) === 'T' ? 'tie' : 'win'}` : 'since first tracked loss', lowerBound: !state.lastNonLoss }) } : {}),
              action: key === 'wins' ? `A win makes it ${state.wins + 1}; a loss or tie ends the run.` : 'A win or tie ends the losing streak.', ends,
            });
          }
          if (state.winless >= WATCH_THRESHOLDS.team && state.winless !== state.losses) events.push({ ...base,
            id: `${base.id}:winless`, kind: 'drought', value: state.winless, unit: 'games',
            title: `${TEAMS[team].name}: ${state.winless} games without a win${suffix}`,
            detail: `Winless run began ${state.winlessStart}; ties count as winless games.`,
            drought: droughtLength(state.lastWin?.date || state.winlessStart, game.date, { count: state.winless, unit: 'games',
              anchor: state.lastWin ? 'since last win' : 'since first tracked winless game', lowerBound: !state.lastWin }),
            recordId: state.winlessRun.id,
            action: 'A win ends the drought.', ends: 'W',
          });
          if (context === 'overall' && state.wins === 4 && state.lastFive && game.season - state.lastFive.season >= WATCH_THRESHOLDS.fiveWinDrought) {
            events.push({ ...base, id: `${base.id}:five-win-drought`, kind: 'drought',
              value: game.season - state.lastFive.season, unit: 'seasons',
              title: `${TEAMS[team].name}: a first five-win run since ${state.lastFive.season}`,
              detail: `Four straight wins entering this game. Last reached five on ${state.lastFive.date}.`,
              drought: droughtLength(state.lastFive.date, game.date, { count: game.season - state.lastFive.season,
                unit: 'seasons', anchor: 'since last five-win run' }),
              action: 'One more win ends the wait for five consecutive regular-season wins.', ends: 'W',
            });
          }
        }
        const outcome = game.completed ? result(game, team) : null;
        if (game.season === season) for (const { ends, ...event } of events) {
          if (!game.completed) watch.push(point(game, event));
          else if (ends === outcome || ends === 'not-W' && outcome !== 'W' || ends === 'not-L' && outcome !== 'L')
            ended.push(point(game, { ...event, action: outcome === 'T' ? 'A tie ended the run.' : `The ${TEAMS[team].name} ${outcome === 'W' ? 'won' : 'lost'}, ending the run.` }, true));
          else if (includeResults) {
            const after = event.unit === 'seasons' ? event.value : event.value + 1;
            continued.push(weeklyResult(point(game, { ...event, title: event.title.replace(`: ${event.value} `, `: ${after} `) }),
              { status: 'continued', after, action: event.unit === 'seasons' ? 'The wait for a five-win run continued.' :
                `${outcome === 'T' ? 'A tie' : outcome === 'W' ? 'A win' : 'A loss'} ${event.kind === 'drought' ? `kept the drought going: ${event.value} → ${after} games.` : `extended the streak: ${event.value} → ${after} wins.`}` }));
          }
        }
        // Never treat a scheduled game as a loss, or project future victories.
        if (game.completed) {
          for (const [key, expected] of [['wins', 'W'], ['losses', 'L'], ['winless', 'not-W']]) {
            if (expected === outcome || expected === 'not-W' && outcome !== 'W') {
              if (!state[key]) {
                state[`${key}Start`] = game.date;
                const scope = context.split(':')[0];
                const record = { id: `${context}:${team}:${key}:${game.id}`, team, scope, metric: key, length: 0,
                  name: TEAMS[team].name, opponent: matchup ? other : null, active: true,
                  lowerBound: !states.has(context), start: { date: game.date, season: game.season } };
                state[`${key}Run`] = record; records.push(record); references.set(record.id, record);
              }
              state[key]++;
              state[`${key}Run`].length = state[key];
              state[`${key}Run`].last = { date: game.date, season: game.season };
              if (includeResults && game.season === season && state[key] === (matchup ? WATCH_THRESHOLDS.matchup : WATCH_THRESHOLDS.team) &&
                (matchup ? key === 'winless' : key !== 'winless' || state.winless !== state.losses)) {
                const value = state[key], label = key === 'wins' ? 'wins' : key === 'losses' ? 'losses' : 'games without a win';
                const title = `${TEAMS[team].name}: ${value} ${key === 'winless' ? '' : 'straight '}${label}${suffix}`;
                continued.push(weeklyResult(point(game, { ...base, id: `${base.id}:${key}`, kind: key === 'wins' ? 'streak' : 'drought',
                  title, value, unit: 'games', detail: `Run began ${state[`${key}Start`]}.`, href: key === 'losses' && context === 'overall' ? '/nfl/droughts.html#loss-streaks' : base.href }),
                  { status: 'continued', before: value - 1, after: value, action: `Reached the ${value}-game watch threshold in this game.`, newlyNoteworthy: true }));
              }
            } else {
              if (state[key]) state[`${key}Run`].active = false;
              state[key] = 0;
            }
          }
          if (outcome === 'W') state.lastWin = game;
          if (outcome !== 'L') state.lastNonLoss = game;
          if (state.wins >= 5) state.lastFive = game;
          states.set(context, state);
        }
      }
    }
  }
  for (const event of [...watch, ...ended]) {
    const record = references.get(event.recordId);
    delete event.recordId;
    if (!record) continue;
    const pool = records.filter(row => row.scope === record.scope && row.metric === record.metric);
    const coverage = record.scope === 'overall' ? '1920+ · today’s 32 franchises' : '1999+ · today’s 32 franchises';
    const labels = { overall: 'Overall runs', home: 'Home runs', away: 'Road runs', matchup: 'Matchup droughts', 'matchup-home': 'Home matchup droughts', 'matchup-away': 'Road matchup droughts' };
    event.leaderboard = { label: labels[record.scope],
      franchise: streakPosition(record, pool.filter(row => row.team === event.team), { scope: event.team, coverage }),
      overall: streakPosition(record, pool, { scope: 'Current franchises', coverage }), franchiseTeam: event.team };
  }
  return includeResults ? { watch, ended, continued } : { watch, ended };
}

export function playerWatchEvents(games, season, upcoming, { qbs, receiving, kicking, currentTeams = new Map() }) {
  const watch = [], ended = [], byId = new Map(games.map(g => [g.id, g]));
  const nextGame = new Map(upcoming.flatMap(g => [[g.home, g], [g.away, g]]));
  const latestTeamDate = new Map();
  for (const g of games.filter(g => g.completed).sort(orderGames)) for (const team of [g.home, g.away]) latestTeamDate.set(team, g.date);
  const add = (row, category, minimum, through, config) => {
    if (row.length < minimum || row.gapAfter) return;
    const team = config.team || currentTeams.get(row.playerId) || row.last.team || row.team;
    const event = { id: row.id, category, kind: 'streak', team, value: row.length, unit: config.unit,
      title: `${row.name}: ${row.lowerBound || row.startKnown === false ? 'at least ' : ''}${row.length} ${config.label}`,
      detail: `Run began ${row.start.date || row.start.season}. Last verified ${row.last.date}.`,
      action: config.action(row), href: config.href, sourceThrough: through,
      ...(row.leaderboard ? { leaderboard: row.active && row.leaderboard.franchiseTeam !== team ?
        { ...row.leaderboard, franchise: null, franchiseTeam: team } : row.leaderboard } : {}),
    };
    if (row.active && nextGame.has(team) && through >= (latestTeamDate.get(team) || '') && nextGame.get(team).type === 'REG')
      watch.push(point(nextGame.get(team), event));
    if (row.endedBy) {
      const game = byId.get(row.endedBy.game || row.endedBy.id);
      if (game?.completed && game.season === season) ended.push(point(game,
        { ...event, team: row.endedBy.team || row.team || team, action: config.ended(row),
          href: category === 'qb' ? '/nfl/QBs.html#all-time' : event.href }, true));
    }
  };
  const qbConfig = { unit: 'starts', label: 'consecutive starts for his team', href: '/nfl/QBs.html#starts',
    action: row => `Starting this game makes it ${row.length + 1}. A different starting QB ends the run.`,
    ended: row => `${row.replacement} started the next team game, ending ${row.name}’s starting streak.`,
  };
  const qbContext = row => {
    const record = qbs.history.streaks.find(other => other.team === row.team && other.playerId === (row.playerId || row.id) && other.start.date === row.start.date) || row;
    return { label: 'Consecutive QB starts', franchiseTeam: row.team,
      franchise: streakPosition(record, qbs.history.streaks.filter(other => other.team === row.team), { scope: row.team, coverage: '1950+' }),
      overall: streakPosition(record, qbs.history.streaks, { scope: 'NFL', coverage: '1950+' }) };
  };
  for (const row of qbs.starts) add({ ...row, active: true, leaderboard: qbContext(row) }, 'qb', WATCH_THRESHOLDS.qb, qbs.through, { ...qbConfig, team: row.team });
  const byTeam = new Map();
  for (const row of qbs.history.streaks) { const rows = byTeam.get(row.team) || []; rows.push(row); byTeam.set(row.team, rows); }
  for (const rows of byTeam.values()) {
    rows.sort((a, b) => a.start.date.localeCompare(b.start.date));
    for (let i = 0; i < rows.length - 1; i++) {
      const row = rows[i], next = rows[i + 1];
      if (!row.active && next.start.season === season) add({ ...row, endedBy: next.start, replacement: next.name, leaderboard: qbContext(row) }, 'qb',
        WATCH_THRESHOLDS.qb, qbs.history.through, { ...qbConfig, team: row.team });
    }
  }
  for (const row of receiving.watchStreaks) add(row, 'receiving', WATCH_THRESHOLDS.receiving, receiving.through, {
    unit: 'games', label: 'straight appearances with a catch', href: '/nfl/receiving-streaks.html',
    action: r => `A catch in his next appearance makes it ${r.length + 1}. A zero-catch appearance ends it; missed games do not.`,
    ended: () => 'A zero-catch appearance ended the run.',
  });
  for (const [view, minimum, label] of [['fg', WATCH_THRESHOLDS.fg, 'consecutive field goals made'], ['all', WATCH_THRESHOLDS.kicks, 'consecutive kicks made']]) {
    for (const row of kicking.views[view]) add(row, 'kicking', minimum, kicking.through, {
      unit: 'kicks', label, href: `/nfl/kicking.html#${view}`,
      action: () => view === 'fg' ? 'Each made field goal extends it; the next missed or blocked field goal ends it.' : 'Made field goals and extra points extend it; the next missed or blocked kick ends it.',
      ended: r => `A ${r.endedBy.distance ? `${r.endedBy.distance}-yard ` : ''}${r.endedBy.type === 'FG' ? 'field goal' : 'extra point'} was ${r.endedBy.result === 'failed' ? 'missed' : r.endedBy.result}, ending the run.`,
    });
  }
  return { watch, ended };
}

export function postseasonWatchEvents(games, season, upcoming, baseline, includeResults = false) {
  const watch = [], ended = [], pending = new Set(upcoming.map(g => g.id));
  const continued = [];
  const last = structuredClone(baseline);
  const dates = {};
  for (const game of [...games].filter(g => g.completed && g.season < season && ['WC', 'DIV', 'CON', 'SB'].includes(g.type)).sort(orderGames)) {
    for (const team of [game.home, game.away]) {
      dates[team] ||= {};
      if (baseline[team]?.playoffs === game.season) dates[team].playoffs = game.date;
      if (result(game, team) === 'W') for (const key of ['playoffWin', ...(game.type === 'CON' ? ['conference'] : []), ...(game.type === 'SB' ? ['superBowl'] : [])])
        if (baseline[team]?.[key] === game.season) dates[team][key] = game.date;
    }
  }
  for (const game of [...games].filter(g => g.season === season && ['WC', 'DIV', 'CON', 'SB'].includes(g.type)).sort(orderGames)) {
    if (!game.completed && !pending.has(game.id)) continue;
    for (const team of [game.away, game.home]) {
      const keys = ['playoffs', 'playoffWin', ...(game.type === 'CON' ? ['conference'] : []), ...(game.type === 'SB' ? ['superBowl'] : [])];
      for (const key of keys) {
        const previous = last[team]?.[key];
        if (previous === undefined) continue;
        const missed = seasonsSince(team, previous, season - 1);
        if (missed < WATCH_THRESHOLDS.postseason) continue;
        const label = { playoffs: 'playoff appearance', playoffWin: 'playoff win', conference: 'conference title', superBowl: 'Super Bowl win' }[key];
        const event = { id: `postseason:${team}:${key}`, category: 'postseason', kind: 'drought', team, value: missed, unit: 'seasons',
          title: `${TEAMS[team].name}: ${missed} completed seasons without a ${label}`,
          detail: previous == null ? 'No previous achievement in the Super Bowl era.' : `Last ${label}: ${previous} season.`,
          drought: { count: missed, unit: 'completed seasons', lastSeason: previous, never: previous == null,
            ...(dates[team]?.[key] ? droughtLength(dates[team][key], game.date, { count: missed, unit: 'completed seasons', anchor: `since last ${label}` }) : {}) },
          action: key === 'playoffs' ? 'Taking the field in this playoff game ends the drought.' : 'A win in this game ends the drought.', href: '/nfl/droughts.html',
        };
        if (!game.completed) watch.push(point(game, event));
        else if (key === 'playoffs' || result(game, team) === 'W') ended.push(point(game,
          { ...event, action: key === 'playoffs' ? 'Playing this postseason game ended the drought.' : 'A win ended the drought.' }, true));
        else if (includeResults) continued.push(weeklyResult(point(game, event),
          { status: 'continued', action: `A loss kept the ${label} drought going.` }));
      }
      if (game.completed) {
        last[team] ||= {};
        last[team].playoffs = season;
        if (result(game, team) === 'W') {
          last[team].playoffWin = season;
          if (game.type === 'CON') last[team].conference = season;
          if (game.type === 'SB') last[team].superBowl = season;
        }
      }
    }
  }
  return includeResults ? { watch, ended, continued } : { watch, ended };
}

export function buildWatchSnapshot({ games, season, earlierByTeam, qbs, receiving, kicking, currentTeams, postseasonBaseline }) {
  const week = watchWeek(games, season), upcoming = week?.games || [];
  const events = [teamWatchEvents(games, season, upcoming, earlierByTeam, true),
    playerWatchEvents(games, season, upcoming, { qbs, receiving, kicking, currentTeams }),
    postseasonWatchEvents(games, season, upcoming, postseasonBaseline, true)];
  const watch = events.flatMap(e => e.watch).sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || b.value - a.value || a.id.localeCompare(b.id));
  const ended = events.flatMap(e => e.ended).sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value || a.id.localeCompare(b.id));
  const coverage = { qbs: qbs.through, receiving: receiving.through, kicking: kicking.through };
  const results = [...events.flatMap(e => e.continued || []), ...qbWeeklyResults(games, season, qbs),
    ...(receiving.weeklyResults || []), ...(kicking.weeklyResults || [])];
  return { schemaVersion: 1, season, through: games.filter(g => g.completed).map(g => g.date).sort().at(-1),
    thresholds: WATCH_THRESHOLDS, week, watch, ended,
    games: games.filter(g => g.season === season && (g.completed || upcoming.some(u => u.id === g.id))),
    coverage, weeks: summarizeWeeks(games, season, week, results, watch, ended, coverage),
  };
}

export function validWatchSnapshot(data) {
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  if (data?.schemaVersion !== 1 || !Number.isInteger(data.season) || !date(data.through) || !Array.isArray(data.games)) return false;
  const games = new Map(data.games.map(g => [g.id, g]));
  if (games.size !== data.games.length || data.games.some(g => !g.id || !TEAMS[g.home] || !TEAMS[g.away] || g.home === g.away || !date(g.date) || g.season !== data.season)) return false;
  if (!data.coverage || Object.values(data.coverage).some(value => !date(value))) return false;
  if (data.weeks !== undefined && !validWeeklySummaries(data.weeks, games, data.season, WATCH_CATEGORIES)) return false;
  if (data.week !== null && (!Number.isInteger(data.week?.week) || !Array.isArray(data.week.games) || !data.week.games.length ||
    data.week.games.some(g => !games.has(g.id) || g.completed || g.week !== data.week.week || g.type !== data.week.type))) return false;
  return ['watch', 'ended'].every(key => Array.isArray(data[key]) && new Set(data[key].map(e => e.id)).size === data[key].length && data[key].every(e =>
    games.has(e.game) && Object.hasOwn(WATCH_CATEGORIES, e.category) && ['streak', 'drought'].includes(e.kind) && TEAMS[e.team] &&
    [games.get(e.game).home, games.get(e.game).away].includes(e.team) && e.season === data.season && date(e.date) && e.date === games.get(e.game).date &&
    e.title && e.action && Number.isInteger(e.value) && e.value > 0 && typeof e.href === 'string' && e.href.startsWith('/nfl/') &&
    (!e.drought || Number.isInteger(e.drought.count) && e.drought.count > 0 && typeof e.drought.unit === 'string' &&
      (!e.drought.since || date(e.drought.since) && e.drought.since <= e.date && e.drought.through === e.date &&
        e.drought.days === daysBetween(e.drought.since, e.date) && e.drought.elapsed === elapsedTime(e.drought.since, e.date))) &&
    (!e.leaderboard || validLeaderboard(e.leaderboard)) &&
    e.status === (key === 'ended' ? 'ended' : 'watch') && (key === 'ended' ? games.get(e.game).completed && e.date <= data.through :
      !games.get(e.game).completed && data.week?.games.some(g => g.id === e.game))));
}

function validLeaderboard(board) {
  const holders = (rows, length) => Array.isArray(rows) && rows.length > 0 && new Set(rows.map(row => row.id)).size === rows.length &&
    rows.every(row => row && typeof row.id === 'string' && typeof row.name === 'string' && row.name && row.length === length &&
      typeof row.years === 'string' && row.years && Array.isArray(row.teams) && row.teams.every(team => typeof team === 'string') &&
      [row.firstSeason, row.lastSeason].every(year => year === null || Number.isInteger(year)) &&
      (row.firstSeason === null || row.lastSeason === null || row.firstSeason <= row.lastSeason));
  const position = row => row && Number.isInteger(row.rank) && row.rank > 0 && typeof row.tied === 'boolean' &&
    Number.isInteger(row.length) && row.length > 0 && Number.isInteger(row.record) && row.record >= row.length &&
    typeof row.scope === 'string' && typeof row.coverage === 'string' && typeof row.partial === 'boolean' &&
    Number.isInteger(row.next?.rank) && row.next.rank > 0 && row.next.rank <= row.rank && typeof row.next.tied === 'boolean' &&
    (row.recordHolders === undefined || holders(row.recordHolders, row.record)) &&
    (row.nextHigher == null || Number.isInteger(row.nextHigher.length) && row.nextHigher.length > row.length && row.nextHigher.length <= row.record &&
      Number.isInteger(row.nextHigher.rank) && row.nextHigher.rank > 0 && row.nextHigher.rank < row.rank && holders(row.nextHigher.holders, row.nextHigher.length));
  return TEAMS[board.franchiseTeam] && position(board.overall) && (board.franchise === null || position(board.franchise));
}
