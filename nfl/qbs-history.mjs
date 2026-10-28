import { TEAMS } from './divstreaks-data.mjs';
import { normalizeTeam } from './franchise-leaders-data.mjs';

// Pinned nfelo mirror of FiveThirtyEight's historical starting-quarterback data.
// The original FiveThirtyEight starter history ends after the 2022 season.
// Later nfelo forecasts and nflverse's primary passers are not starter flags.
export const QB_HISTORY_SOURCE = 'https://raw.githubusercontent.com/greerreNFL/nfeloqb/b88af41f71bc95e25826869fd8ceca8a80939ac6/qb_elos.csv';
export const QB_HISTORY_SHA256 = '78bb27e2903987e57edd20181ae6943bf439450530dd778dc25c3af19979c192';
export const HISTORICAL_OPPONENTS = { BCL: 'Baltimore Colts (1950)', NYY: 'New York Yanks', DTX: 'Dallas Texans (1952)' };
const nameKey = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const dateValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const knownTeam = team => TEAMS[team] || HISTORICAL_OPPONENTS[team];

export function readStartingHistory(archive, schedule, through, verifiedStarters = new Map()) {
  if (!dateValid(through)) throw new Error('Invalid QB history cutoff');
  const identities = new Map();
  for (const row of schedule) {
    for (const side of ['home', 'away']) {
      if (row[`${side}_qb_id`] && row[`${side}_qb_name`]) identities.set(nameKey(row[`${side}_qb_name`]), row[`${side}_qb_id`]);
    }
  }
  const games = [], seen = new Set();
  const add = (team, opponent, date, season, week, id, playerId, name) => {
    team = normalizeTeam(team); opponent = normalizeTeam(opponent);
    if (!knownTeam(team) || !knownTeam(opponent) || team === opponent || !dateValid(date) || !Number.isInteger(season) || !name?.trim() || !playerId) throw new Error(`Incomplete QB starter history: ${id}`);
    if (!TEAMS[team]) return; // Defunct clubs are opponents, never today's franchises.
    const key = `${team}:${date}`;
    if (seen.has(key)) throw new Error(`Duplicate QB starter game: ${key}`);
    seen.add(key);
    games.push({ team, playerId, name, game: { id, date, season, week, opponent } });
  };
  const scheduleGames = new Map();
  for (const row of schedule) for (const side of ['home', 'away']) scheduleGames.set(`${normalizeTeam(row[`${side}_team`])}:${row.gameday}`, row);
  const historical = archive.filter(row => Number(row.season) >= 1950 && Number(row.season) <= 2022 && !row.playoff && row.score1 !== '' && row.score2 !== '' && row.date <= through);
  if (!historical.length) throw new Error('Missing historical QB starters');
  for (const row of historical) {
    const scheduled = scheduleGames.get(`${normalizeTeam(row.team1)}:${row.date}`);
    const id = scheduled?.game_id || `${row.date}_${row.team2}_${row.team1}`;
    for (const [side, other] of [['1', '2'], ['2', '1']]) {
      const name = row[`qb${side}`];
      add(row[`team${side}`], row[`team${other}`], row.date, Number(row.season), Number(scheduled?.week || row.week) || null, id, name && (identities.get(nameKey(name)) || `historical:${nameKey(name)}`), name);
    }
  }
  for (const row of schedule) {
    if (row.game_type !== 'REG' || Number(row.season) < 2023 || row.gameday > through || row.home_score === '' || row.away_score === '') continue;
    if (![row.home_score, row.away_score].every(score => score != null && Number.isFinite(Number(score)))) throw new Error(`Invalid completed QB game: ${row.game_id}`);
    for (const [side, other] of [['home', 'away'], ['away', 'home']]) {
      const starter = verifiedStarters.get(`${row.game_id}:${normalizeTeam(row[`${side}_team`])}`);
      if (!starter) throw new Error(`Unverified QB starter: ${row.game_id} ${row[`${side}_team`]}`);
      add(row[`${side}_team`], row[`${other}_team`], row.gameday, Number(row.season), Number(row.week), row.game_id, starter.playerId, starter.name);
    }
  }
  return games.sort((a, b) => a.game.date.localeCompare(b.game.date) || a.team.localeCompare(b.team));
}

export function historicalStartingStreaks(games) {
  const latest = new Map(), streaks = [], seen = new Set();
  for (const { team, playerId, name, game } of [...games].sort((a, b) => a.game.date.localeCompare(b.game.date))) {
    if (!TEAMS[team] || !playerId || !name || !dateValid(game?.date) || !knownTeam(game.opponent)) throw new Error('Incomplete QB streak game');
    const key = `${team}:${game.date}`;
    if (seen.has(key)) throw new Error(`Duplicate QB starter game: ${key}`);
    seen.add(key);
    let run = latest.get(team);
    if (!run || run.playerId !== playerId) {
      if (run) { run.active = false; run.endKnown = true; }
      const startKnown = !!run || game.season > 1950;
      run = { id: `${team}:${game.id}:${playerId}`, playerId, name, team, length: 0, start: game, last: game, startKnown, endKnown: true, active: true };
      streaks.push(run); latest.set(team, run);
    }
    run.length += 1; run.last = game;
  }
  return streaks.sort(streakOrder);
}

function streakOrder(a, b) {
  return b.length - a.length || a.start.date.localeCompare(b.start.date) || a.name.localeCompare(b.name) || a.team.localeCompare(b.team);
}

// Competition ranks preserve ties and remain fixed when a table is filtered.
export function rankedStartingStreaks(streaks) {
  let previous, rank;
  return [...streaks].sort(streakOrder).map((row, index) => {
    if (row.length !== previous) rank = index + 1;
    previous = row.length;
    return { ...row, rank };
  });
}

export function franchiseStartingLeaders(streaks) {
  const best = new Map();
  for (const row of [...streaks].sort(streakOrder)) {
    const key = `${row.team}:${row.playerId}`;
    if (!best.has(key)) best.set(key, row);
  }
  return Object.keys(TEAMS).flatMap(team => rankedStartingStreaks([...best.values()].filter(row => row.team === team)));
}

export function validStartingHistory(history) {
  return history?.firstSeason === 1950 && typeof history.recentComplete === 'boolean' && Number.isInteger(history.lastCompleteSeason) && dateValid(history.through) && Array.isArray(history.streaks) && history.streaks.length > 0 &&
    new Set(history.streaks.map(row => row.id)).size === history.streaks.length &&
    Object.keys(TEAMS).every(team => history.streaks.some(row => row.team === team)) &&
    history.streaks.every(row => TEAMS[row.team] && row.id && row.playerId && typeof row.name === 'string' && row.name.trim() && Number.isInteger(row.length) && row.length > 0 &&
      typeof row.active === 'boolean' && typeof row.startKnown === 'boolean' && typeof row.endKnown === 'boolean' && [row.start, row.last].every(game => dateValid(game?.date) && knownTeam(game.opponent)) &&
      row.start.date <= row.last.date && row.last.date <= history.through && row.start.season >= 1950);
}
