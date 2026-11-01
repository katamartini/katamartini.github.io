import { TEAMS } from './divstreaks-data.mjs';
import { seasonsSince } from './droughts-data.mjs';

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
export function teamWatchEvents(games, season, upcoming = [], earlierByTeam = {}) {
  const watch = [], ended = [], pending = new Set(upcoming.map(g => g.id));
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
        const state = states.get(context) || { wins: 0, losses: 0, winless: 0, lastWin: null, lastFive: null };
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
          action: 'A win ends the drought; a tie keeps it going.', ends: 'W',
        });
        if (!matchup) {
          for (const [key, label, ends] of [['wins', 'wins', 'not-W'], ['losses', 'losses', 'not-L']]) {
            if (state[key] < WATCH_THRESHOLDS.team) continue;
            events.push({ ...base, id: `${base.id}:${key}`, kind: key === 'wins' ? 'streak' : 'drought',
              value: state[key], unit: 'games', href: context === 'overall' ? `/nfl/droughts.html#${key === 'wins' ? 'win' : 'loss'}-streaks` : base.href,
              title: `${TEAMS[team].name}: ${state[key]} straight ${label}${suffix}`,
              detail: `Run began ${state[`${key}Start`]}.`,
              action: key === 'wins' ? `A win makes it ${state.wins + 1}; a loss or tie ends the run.` : 'A win or tie ends the losing streak.', ends,
            });
          }
          if (state.winless >= WATCH_THRESHOLDS.team && state.winless !== state.losses) events.push({ ...base,
            id: `${base.id}:winless`, kind: 'drought', value: state.winless, unit: 'games',
            title: `${TEAMS[team].name}: ${state.winless} games without a win${suffix}`,
            detail: `Winless run began ${state.winlessStart}; ties count as winless games.`,
            action: 'A win ends the drought.', ends: 'W',
          });
          if (context === 'overall' && state.wins === 4 && state.lastFive && game.season - state.lastFive.season >= WATCH_THRESHOLDS.fiveWinDrought) {
            events.push({ ...base, id: `${base.id}:five-win-drought`, kind: 'drought',
              value: game.season - state.lastFive.season, unit: 'seasons',
              title: `${TEAMS[team].name}: a first five-win run since ${state.lastFive.season}`,
              detail: `Four straight wins entering this game. Last reached five on ${state.lastFive.date}.`,
              action: 'One more win ends the wait for five consecutive regular-season wins.', ends: 'W',
            });
          }
        }
        const outcome = game.completed ? result(game, team) : null;
        if (game.season === season) for (const { ends, ...event } of events) {
          if (!game.completed) watch.push(point(game, event));
          else if (ends === outcome || ends === 'not-W' && outcome !== 'W' || ends === 'not-L' && outcome !== 'L')
            ended.push(point(game, { ...event, action: outcome === 'T' ? 'A tie ended the run.' : `The ${TEAMS[team].name} ${outcome === 'W' ? 'won' : 'lost'}, ending the run.` }, true));
        }
        // Never treat a scheduled game as a loss, or project future victories.
        if (game.completed) {
          for (const [key, expected] of [['wins', 'W'], ['losses', 'L'], ['winless', 'not-W']]) {
            if (expected === outcome || expected === 'not-W' && outcome !== 'W') {
              if (!state[key]) state[`${key}Start`] = game.date;
              state[key]++;
            } else state[key] = 0;
          }
          if (outcome === 'W') state.lastWin = game;
          if (state.wins >= 5) state.lastFive = game;
          states.set(context, state);
        }
      }
    }
  }
  return { watch, ended };
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
  for (const row of qbs.starts) add({ ...row, active: true }, 'qb', WATCH_THRESHOLDS.qb, qbs.through, { ...qbConfig, team: row.team });
  const byTeam = new Map();
  for (const row of qbs.history.streaks) { const rows = byTeam.get(row.team) || []; rows.push(row); byTeam.set(row.team, rows); }
  for (const rows of byTeam.values()) {
    rows.sort((a, b) => a.start.date.localeCompare(b.start.date));
    for (let i = 0; i < rows.length - 1; i++) {
      const row = rows[i], next = rows[i + 1];
      if (!row.active && next.start.season === season) add({ ...row, endedBy: next.start, replacement: next.name }, 'qb',
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

export function postseasonWatchEvents(games, season, upcoming, baseline) {
  const watch = [], ended = [], pending = new Set(upcoming.map(g => g.id));
  const last = structuredClone(baseline);
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
          action: key === 'playoffs' ? 'Taking the field in this playoff game ends the drought.' : 'A win in this game ends the drought.', href: '/nfl/droughts.html',
        };
        if (!game.completed) watch.push(point(game, event));
        else if (key === 'playoffs' || result(game, team) === 'W') ended.push(point(game,
          { ...event, action: key === 'playoffs' ? 'Playing this postseason game ended the drought.' : 'A win ended the drought.' }, true));
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
  return { watch, ended };
}

export function buildWatchSnapshot({ games, season, earlierByTeam, qbs, receiving, kicking, currentTeams, postseasonBaseline }) {
  const week = watchWeek(games, season), upcoming = week?.games || [];
  const events = [teamWatchEvents(games, season, upcoming, earlierByTeam),
    playerWatchEvents(games, season, upcoming, { qbs, receiving, kicking, currentTeams }),
    postseasonWatchEvents(games, season, upcoming, postseasonBaseline)];
  const watch = events.flatMap(e => e.watch).sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || b.value - a.value || a.id.localeCompare(b.id));
  const ended = events.flatMap(e => e.ended).sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value || a.id.localeCompare(b.id));
  return { schemaVersion: 1, season, through: games.filter(g => g.completed).map(g => g.date).sort().at(-1),
    thresholds: WATCH_THRESHOLDS, week, watch, ended,
    games: games.filter(g => g.season === season && (g.completed || upcoming.some(u => u.id === g.id))),
    coverage: { qbs: qbs.through, receiving: receiving.through, kicking: kicking.through },
  };
}

export function validWatchSnapshot(data) {
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  if (data?.schemaVersion !== 1 || !Number.isInteger(data.season) || !date(data.through) || !Array.isArray(data.games)) return false;
  const games = new Map(data.games.map(g => [g.id, g]));
  if (games.size !== data.games.length || data.games.some(g => !g.id || !TEAMS[g.home] || !TEAMS[g.away] || g.home === g.away || !date(g.date) || g.season !== data.season)) return false;
  if (!data.coverage || Object.values(data.coverage).some(value => !date(value))) return false;
  if (data.week !== null && (!Number.isInteger(data.week?.week) || !Array.isArray(data.week.games) || !data.week.games.length ||
    data.week.games.some(g => !games.has(g.id) || g.completed || g.week !== data.week.week || g.type !== data.week.type))) return false;
  return ['watch', 'ended'].every(key => Array.isArray(data[key]) && new Set(data[key].map(e => e.id)).size === data[key].length && data[key].every(e =>
    games.has(e.game) && Object.hasOwn(WATCH_CATEGORIES, e.category) && ['streak', 'drought'].includes(e.kind) && TEAMS[e.team] &&
    [games.get(e.game).home, games.get(e.game).away].includes(e.team) && e.season === data.season && date(e.date) && e.date === games.get(e.game).date &&
    e.title && e.action && Number.isInteger(e.value) && e.value > 0 && typeof e.href === 'string' && e.href.startsWith('/nfl/') &&
    e.status === (key === 'ended' ? 'ended' : 'watch') && (key === 'ended' ? games.get(e.game).completed && e.date <= data.through :
      !games.get(e.game).completed && data.week?.games.some(g => g.id === e.game))));
}
