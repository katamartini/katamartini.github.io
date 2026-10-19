import { TEAMS } from './divstreaks-data.mjs';
import { normalizeTeam } from './franchise-leaders-data.mjs';

export const CURRENT_STATUSES = new Set(['ACT', 'DEV', 'EXE', 'INA', 'PUP', 'RES', 'RSN', 'SUS', 'E14']);
export const ESPN_TEAMS = { ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12, LA: 14, LAC: 24, LV: 13, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19, NYJ: 20, PHI: 21, PIT: 23, SEA: 26, SF: 25, TB: 27, TEN: 10, WAS: 28 };
export const starterUrl = (event, team) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${event}/competitions/${event}/competitors/${ESPN_TEAMS[team]}/roster?lang=en&region=us`;

export function parseStarter(data) {
  if (!Array.isArray(data.entries) || data.entries.length < 20) throw new Error('Incomplete ESPN game roster');
  const qbs = data.entries.filter(row => /\/positions\/8(?:\?|$)/.test(row.position?.$ref || '') && row.starter === true && row.didNotPlay === false && row.valid !== false);
  if (qbs.length !== 1 || !Number.isInteger(qbs[0].playerId) || qbs[0].playerId < 1) throw new Error('Missing or ambiguous starting QB');
  return String(qbs[0].playerId);
}

export function qbTenures(rosters, season) {
  const history = new Map();
  const current = rosters.filter(row => row.season === season && TEAMS[normalizeTeam(row.team)] && (!row.game_type || row.game_type === 'REG'));
  const week = Math.max(...current.map(row => row.week));
  if (!Number.isInteger(week) || week < 1) throw new Error('No current roster week');
  for (const row of rosters) {
    const team = normalizeTeam(row.team);
    if (!row.gsis_id || !TEAMS[team] || row.season > season) continue;
    if (!history.has(row.gsis_id)) history.set(row.gsis_id, new Map());
    const years = history.get(row.gsis_id);
    if (!years.has(row.season)) years.set(row.season, new Set());
    years.get(row.season).add(team);
  }
  const players = [], rosterWeeks = {};
  for (const team of Object.keys(TEAMS)) {
    const teamRows = current.filter(row => normalizeTeam(row.team) === team);
    const teamWeek = Math.max(...teamRows.map(row => row.week));
    rosterWeeks[team] = teamWeek;
    const candidates = teamRows.filter(row => row.week === teamWeek && row.position === 'QB' && CURRENT_STATUSES.has(row.status));
    if (!candidates.length) throw new Error(`No current QBs for ${team}`);
    const seen = new Set();
    for (const row of candidates) {
      if (!row.gsis_id || !row.full_name || row.espn_id && !/^\d+$/.test(row.espn_id)) throw new Error(`QB missing identity: ${team}`);
      if (seen.has(row.gsis_id)) continue;
      seen.add(row.gsis_id);
      const years = history.get(row.gsis_id);
      let since = season;
      // The joining season may contain another team. Do not cross that season.
      while (years.get(since)?.size === 1 && years.get(since)?.has(team) && years.get(since - 1)?.has(team)) since -= 1;
      if (since === 2000) throw new Error('Tenure reaches history boundary; fetch earlier rosters');
      players.push({ id: row.gsis_id, espn: row.espn_id || null, name: row.full_name, team, since, seasons: season - since + 1, status: row.status, rosterWeek: teamWeek });
    }
  }
  players.sort((a, b) => b.seasons - a.seasons || a.name.localeCompare(b.name));
  return { week, rosterWeeks, players };
}

export function completedTeamGames(rows, team, season, today) {
  const games = rows.filter(row => row.game_type === 'REG' && Number(row.season) <= season && Number(row.season) >= 2000 &&
    row.gameday <= today && row.home_score !== '' && row.away_score !== '' && Number.isFinite(Number(row.home_score)) && Number.isFinite(Number(row.away_score)) &&
    [normalizeTeam(row.home_team), normalizeTeam(row.away_team)].includes(team))
    .map(row => ({ id: row.game_id, event: row.espn, date: row.gameday, season: Number(row.season), week: Number(row.week),
      opponent: normalizeTeam(row.home_team) === team ? normalizeTeam(row.away_team) : normalizeTeam(row.home_team) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (!games.length || new Set(games.map(row => row.id)).size !== games.length || games.some(row => !/^\d+$/.test(row.event) || !TEAMS[row.opponent])) throw new Error(`Incomplete game history: ${team}`);
  return games;
}

// Read only the active suffix, plus the game proving where it began.
export async function startingStreak(games, getStarter) {
  const id = await getStarter(games[0]);
  let length = 0, start;
  for (const game of games) {
    const starter = length === 0 ? id : await getStarter(game);
    if (starter !== id) return { espn: id, length, start, last: games[0] };
    length += 1; start = game;
  }
  throw new Error('Starting streak reaches history boundary');
}

export function rankRows(rows, key, descending) {
  return [...rows].sort((a, b) => {
    const x = key === 'team' ? TEAMS[a.team].name : a[key], y = key === 'team' ? TEAMS[b.team].name : b[key];
    const order = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return (descending ? -order : order) || a.name.localeCompare(b.name) || a.team.localeCompare(b.team);
  });
}
