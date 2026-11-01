import { TEAMS } from './divstreaks-data.mjs';

export function weeklyResult(event, { status = event.status, before = event.value, after = event.value, action = event.action, newlyNoteworthy = false } = {}) {
  const { id, category, kind, team, opponent, title, detail, unit, href, game, date, season, week, gameType, drought, sourceThrough } = event;
  return { id, category, kind, team, ...(opponent ? { opponent } : {}), title, detail: detail || '', unit, href, game, date, season, week,
    gameType, status, before, after, value: after ?? before, action, newlyNoteworthy,
    ...(drought ? { drought: { ...drought, count: after ?? drought.count } } : {}), ...(sourceThrough ? { sourceThrough } : {}) };
}

// Reconstruct each game's counter from a maximal run and its actual observations.
// Missing appearances or attempts never become fabricated continuations or ends.
export function playerWeeklyResults(streaks, observations, games, { season, category, minimum, unit, label, href, through }) {
  const byId = new Map(games.filter(g => g.completed && g.season === season && g.type === 'REG' && g.date <= through).map(g => [g.id, g]));
  const byPlayer = new Map();
  for (const row of observations) if (row.season === season && byId.has(row.game)) {
    const rows = byPlayer.get(row.playerId) || []; rows.push(row); byPlayer.set(row.playerId, rows);
  }
  const results = [];
  for (const run of streaks) {
    if (run.length < minimum || !run.start?.date || !run.last?.date || run.last.date > through) continue;
    const rows = (byPlayer.get(run.playerId) || []).filter(row => row.date >= run.start.date && row.date <= run.last.date &&
      (row.game !== run.start.game || row.play == null || row.play >= run.start.play) &&
      (row.game !== run.last.game || row.play == null || row.play <= run.last.play));
    const buckets = new Map();
    for (const row of rows) {
      const bucket = buckets.get(row.game) || { game: byId.get(row.game), team: row.team, made: 0 };
      bucket.made++; buckets.set(row.game, bucket);
    }
    const ending = byId.get(run.endedBy?.game);
    if (ending && !buckets.has(ending.id)) buckets.set(ending.id, { game: ending, team: run.endedBy.team, made: 0 });
    let count = run.length - rows.length;
    for (const bucket of [...buckets.values()].sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.id.localeCompare(b.game.id))) {
      const game = bucket.game, before = count; count += bucket.made;
      const ended = run.endedBy?.game === game.id;
      if (count < minimum && !ended) continue;
      const event = { id: `${run.id}:${game.id}`, category, kind: 'streak', team: bucket.team,
        title: `${run.name}: ${run.lowerBound ? 'at least ' : ''}${count} ${label}`,
        detail: `Run began ${run.start.date}. ${ended ? 'Final recorded length' : 'Length after this game'}: ${count}.`,
        unit, href, game: game.id, date: game.date, season, week: game.week, gameType: game.type, sourceThrough: through,
      };
      let action;
      if (ended && category === 'receiving') action = `A zero-catch appearance ended the run at ${count} games.`;
      else if (ended) action = `A ${run.endedBy.distance ? `${run.endedBy.distance}-yard ` : ''}${run.endedBy.type === 'FG' ? 'field goal' : 'extra point'} was ${run.endedBy.result === 'failed' ? 'missed' : run.endedBy.result}, ending the run at ${count} kicks.`;
      else action = `Extended from ${before} to ${count} ${unit}${bucket.made > 1 ? ` (+${bucket.made})` : ''}.`;
      results.push(weeklyResult(event, { status: ended ? 'ended' : 'continued', before, after: count, action, newlyNoteworthy: before < minimum }));
    }
  }
  return results;
}

export function qbWeeklyResults(games, season, qbs, minimum = 16) {
  const current = games.filter(g => g.completed && g.season === season && g.type === 'REG' && g.date <= qbs.history.through);
  const results = [];
  for (const run of qbs.history.streaks) {
    if (run.length < minimum) continue;
    const played = current.filter(g => [g.home, g.away].includes(run.team) && g.date >= run.start.date && g.date <= run.last.date)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let count = run.length - played.length;
    for (const game of played) {
      const before = count; count++;
      if (count < minimum) continue;
      results.push(weeklyResult({ id: `${run.id}:${game.id}`, category: 'qb', kind: 'streak', team: run.team,
        title: `${run.name}: ${count} consecutive starts for his team`, detail: `Run began ${run.start.date}.`, unit: 'starts',
        href: '/nfl/QBs.html#all-time', game: game.id, date: game.date, season, week: game.week, gameType: game.type,
        sourceThrough: qbs.history.through }, { status: 'continued', before, after: count,
        action: `${run.name} started for the ${TEAMS[run.team].name}, extending the run from ${before} to ${count} starts.`, newlyNoteworthy: before < minimum }));
    }
  }
  return results;
}

export function summarizeWeeks(games, season, currentWeek, results, watch, ended, coverage) {
  const weeks = new Map();
  for (const game of games.filter(g => g.season === season && (g.completed || currentWeek?.games.some(other => other.id === g.id)))) {
    const id = `${game.type}-${game.week}`;
    if (weeks.has(id)) continue;
    const schedule = games.filter(g => g.season === season && g.type === game.type && g.week === game.week)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    weeks.set(id, { id, season, type: game.type, week: game.week, start: schedule[0].date, end: schedule.at(-1).date,
      totalGames: schedule.length, completedGames: schedule.filter(g => g.completed).length,
      pendingGames: schedule.filter(g => !g.completed).map(g => g.id),
      awaitingFeeds: Object.fromEntries(Object.entries(coverage).map(([key, date]) => [key,
        schedule.filter(g => g.type === 'REG' && g.completed && g.date > date).map(g => g.id)])),
      events: [] });
  }
  const events = new Map(ended.map(event => [event.id, weeklyResult(event)]));
  for (const event of results) events.set(event.id, event);
  for (const event of watch) events.set(event.id, weeklyResult(event, { status: 'pending', after: null }));
  for (const event of events.values()) weeks.get(`${event.gameType}-${event.week}`)?.events.push(event);
  return [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start)).map(week => ({ ...week,
    events: week.events.sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game) || a.id.localeCompare(b.id)),
    counts: Object.fromEntries(['continued', 'ended', 'pending'].map(status => [status, week.events.filter(event => event.status === status).length])),
  }));
}

export function validWeeklySummaries(weeks, games, season, categories) {
  if (!Array.isArray(weeks) || new Set(weeks.map(w => w.id)).size !== weeks.length) return false;
  const statuses = ['continued', 'ended', 'pending'];
  return weeks.every(week => week && week.id === `${week.type}-${week.week}` && week.season === season && Number.isInteger(week.week) &&
    Number.isInteger(week.totalGames) && Number.isInteger(week.completedGames) && week.completedGames >= 0 &&
    Array.isArray(week.pendingGames) && week.totalGames === week.completedGames + week.pendingGames.length &&
    week.pendingGames.every(id => games.has(id) && !games.get(id).completed && games.get(id).week === week.week && games.get(id).type === week.type) &&
    week.awaitingFeeds && Object.values(week.awaitingFeeds).every(ids => Array.isArray(ids) && ids.every(id => games.get(id)?.completed && games.get(id).week === week.week)) &&
    Array.isArray(week.events) && new Set(week.events.map(e => e.id)).size === week.events.length &&
    statuses.every(status => week.counts?.[status] === week.events.filter(e => e.status === status).length) && week.events.every(event => {
      const game = games.get(event.game);
      return game && event.id && game.season === season && event.season === season && game.week === week.week && game.type === week.type &&
        event.week === week.week && event.gameType === week.type && event.date === game.date && [game.home, game.away].includes(event.team) &&
        Object.hasOwn(categories, event.category) && statuses.includes(event.status) && event.title && event.action && event.href?.startsWith('/nfl/') &&
        Number.isInteger(event.before) && event.before >= 0 && (event.status === 'pending' ? !game.completed && event.after === null :
          game.completed && Number.isInteger(event.after) && event.after >= event.before);
    }));
}
