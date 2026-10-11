import { TEAMS } from './divstreaks-data.mjs';
import { normalizeName, normalizeTeam } from './franchise-leaders-data.mjs';

export const FIRST_STATS_SEASON = 1999;
export const FIRST_PARTICIPATION_SEASON = 2013;
// These completed games are absent from the historical box-score feed.
// Keep them in the schedule: they must censor runs, never join them silently.
export const KNOWN_MISSING_GAMES = ['1999_01_BAL_STL', '2000_03_SD_KC', '2000_06_BUF_MIA'];
// This box score has two catches assigned to no player ID. Exclude the entire
// game conservatively until the source identifies the receiver.
export const KNOWN_INCOMPLETE_GAMES = ['2012_06_PIT_TEN'];
export const STAT_COLUMNS = ['player_id', 'player_display_name', 'season', 'week', 'season_type', 'game_id', 'team', 'opponent_team', 'receptions'];
export const SNAP_COLUMNS = ['game_id', 'season', 'game_type', 'player', 'pfr_player_id', 'team', 'opponent', 'offense_snaps', 'defense_snaps', 'st_snaps'];

const integer = (value, label) => {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${label}: ${value}`);
  return Number(value);
};

// Box scores prove appearances with recorded statistics; snaps also capture
// players who took the field but never caught or were targeted by a pass.
export function receivingAppearances(stats, snaps, games, players) {
  const schedule = new Map(games.map(game => [game.game_id, game]));
  const pfrIds = new Map([...players].filter(([, p]) => p.pfr_id).map(([id, p]) => [p.pfr_id, id]));
  const names = new Map(stats.filter(row => row.player_id && row.player_display_name).map(row => [row.player_id, row.player_display_name]));
  const rows = new Map(), statsNames = new Map(), participationGames = new Set();
  const base = (id, name, season, gameId, team, opponent) => {
    const game = schedule.get(gameId);
    name = players.get(id)?.display_name || name || names.get(id) || (id ? `Unknown player (${id})` : '');
    team = normalizeTeam(team); opponent = normalizeTeam(opponent);
    if (!game || game.game_type !== 'REG' || !TEAMS[team] || !TEAMS[opponent] ||
      ![normalizeTeam(game.home_team), normalizeTeam(game.away_team)].includes(team) ||
      ![normalizeTeam(game.home_team), normalizeTeam(game.away_team)].includes(opponent) || team === opponent ||
      !id || !name || !/^\d{4}-\d{2}-\d{2}$/.test(game.gameday)) throw new Error(`Invalid receiving appearance: ${gameId}:${id}`);
    return { id, name: players.get(id)?.display_name || name, season: integer(season, 'season'), game: gameId,
      date: game.gameday, team, opponent, receptions: 0 };
  };
  for (const row of stats) {
    if (row.season_type !== 'REG') continue;
    // nflverse includes anonymous team-event rows (ID 0); they aren't players.
    if (row.player_id === '0' && !row.player_display_name && row.receptions === '0') continue;
    const entry = base(row.player_id, row.player_display_name, row.season, row.game_id, row.team, row.opponent_team);
    entry.receptions = integer(row.receptions, 'receptions');
    const key = `${entry.game}:${entry.id}`;
    if (rows.has(key)) throw new Error(`Duplicate player box score: ${key}`);
    rows.set(key, entry);
    const nameKey = `${entry.game}:${entry.team}:${normalizeName(entry.name)}`;
    const candidates = statsNames.get(nameKey) || []; candidates.push(entry.id); statsNames.set(nameKey, candidates);
  }
  for (const row of snaps) {
    if (row.game_type !== 'REG') continue;
    const total = ['offense_snaps', 'defense_snaps', 'st_snaps'].reduce((sum, key) => sum + integer(row[key], key), 0);
    if (!total) continue;
    participationGames.add(row.game_id);
    let id = pfrIds.get(row.pfr_player_id);
    if (!id) {
      const candidates = statsNames.get(`${row.game_id}:${normalizeTeam(row.team)}:${normalizeName(row.player)}`) || [];
      if (candidates.length > 1) throw new Error(`Ambiguous snap identity: ${row.player}`);
      if (!candidates.length && !row.pfr_player_id) throw new Error(`Missing snap identity: ${row.player}`);
      id = candidates[0] || `pfr:${row.pfr_player_id}`;
    }
    const entry = base(id, row.player, row.season, row.game_id, row.team, row.opponent);
    const key = `${entry.game}:${entry.id}`;
    if (!rows.has(key)) rows.set(key, entry);
  }
  return { appearances: [...rows.values()], participationGames };
}

export function calculateReceivingStreaks(appearances, games, participationGames, players = new Map(), currentIds = new Set()) {
  const byPlayer = new Map(), seen = new Set(), teamGames = new Map();
  for (const game of games) {
    if (game.game_type !== 'REG' || game.home_score === '' || game.away_score === '') continue;
    for (const code of [game.home_team, game.away_team]) {
      const team = normalizeTeam(code), rows = teamGames.get(team) || [];
      rows.push(game); teamGames.set(team, rows);
    }
  }
  for (const row of appearances) {
    const key = `${row.id}:${row.game}`;
    if (seen.has(key)) throw new Error(`Duplicate receiving appearance: ${key}`);
    seen.add(key);
    if (!Number.isInteger(row.receptions) || row.receptions < 0) throw new Error('Invalid catch count');
    const rows = byPlayer.get(row.id) || []; rows.push(row); byPlayer.set(row.id, rows);
  }
  const streaks = [];
  const point = row => ({ date: row.date, season: row.season, game: row.game, team: row.team, opponent: row.opponent });
  for (const [id, rows] of byPlayer) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game));
    let length = 0, start, last, teams = new Set(), knownStart = Number(players.get(id)?.rookie_season || 0) >= FIRST_STATS_SEASON;
    if (knownStart && (teamGames.get(rows[0].team) || []).some(game => [...KNOWN_MISSING_GAMES, ...KNOWN_INCOMPLETE_GAMES].includes(game.game_id) &&
      Number(game.season) >= Number(players.get(id)?.rookie_season) && game.gameday < rows[0].date)) knownStart = false;
    const save = (endedBy = null, gapAfter = null) => {
      if (!length) return;
      streaks.push({ id: `${id}:${start.game}`, playerId: id, name: players.get(id)?.display_name || rows[0].name,
        length, start, last, teams: [...teams], endedBy, gapAfter, lowerBound: !knownStart || !!gapAfter,
        startUnknown: !knownStart, active: !endedBy && !gapAfter && currentIds.has(id), archive: false });
    };
    let previous;
    for (const row of rows) {
      // Before snap coverage, a missing stat row is not evidence of either a
      // DNP or a zero-catch appearance. Censor the run instead of guessing.
      if (previous && previous.season < FIRST_PARTICIPATION_SEASON) {
        const missing = [...(teamGames.get(previous.team) || []), ...(previous.team === row.team ? [] : teamGames.get(row.team) || [])]
          .filter(game => game.gameday > previous.date && game.gameday < row.date && !participationGames.has(game.game_id))
          .sort((a, b) => a.gameday.localeCompare(b.gameday))[0];
        if (missing) { save(null, { date: missing.gameday, game: missing.game_id }); length = 0; teams = new Set(); knownStart = false; }
      }
      if (!row.receptions) { save(point(row)); length = 0; teams = new Set(); knownStart = true; }
      else {
        if (!length) start = point(row);
        length++; last = point(row); teams.add(row.team);
      }
      previous = row;
    }
    // We cannot establish the trailing zero-catch appearances of a player
    // whose available career ends before participation coverage begins.
    const trailingGap = last?.season < FIRST_PARTICIPATION_SEASON && length ? { date: null, game: null } : null;
    save(null, trailingGap);
  }
  return sortReceivingStreaks(streaks);
}

export const sortReceivingStreaks = rows => [...rows].sort((a, b) => b.length - a.length ||
  (a.start.date || '9999-12-31').localeCompare(b.start.date || '9999-12-31') ||
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export function mergeReceivingArchive(rows, archive) {
  let merged = [...rows];
  for (const entry of archive) {
    const exact = merged.find(row => row.playerId === entry.playerId && row.length === entry.length && !row.lowerBound &&
      row.start.season >= entry.start.season && row.last.season <= entry.last.season);
    merged = merged.filter(row => !(row.playerId === entry.playerId && row.lowerBound &&
      row.start.season >= entry.start.season && row.last.season <= entry.last.season));
    if (exact) merged = merged.map(row => row.id === exact.id ? { ...row, source: entry.source } : row);
    else merged.push(structuredClone(entry));
  }
  const ids = new Set();
  for (const row of merged) { if (ids.has(row.id)) throw new Error(`Duplicate streak: ${row.id}`); ids.add(row.id); }
  return sortReceivingStreaks(merged);
}

export function topReceivingStreaks(rows, limit = 100) {
  return sortReceivingStreaks(rows).slice(0, limit).map((row, i) => ({ ...row, rank: i + 1 }));
}
