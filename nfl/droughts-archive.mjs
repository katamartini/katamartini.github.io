import { TEAMS } from './divstreaks-data.mjs';

export const ARCHIVE_FIRST_SEASON = 1920;
export const ARCHIVE_LAST_SEASON = 1998;
export const ARCHIVE_GAME_COUNT = 10612;
export const ARCHIVE_SOURCE = 'https://raw.githubusercontent.com/fivethirtyeight/nfl-elo-game/f7d430b4781aa34736f2ecb3795ca1fa495f5876/data/nfl_games.csv';
export const ARCHIVE_SHA256 = 'af16cf3c5848393057fad07feea278f0a85ab7b57ddbfe42ed96b5c80e7d519d';
export const ARCHIVE_ROWS_SHA256 = '8505710f2ac174d8773baa0818b8197f544953f77d5951f8da28f583fffa7dd5';
const aliases = { LAR: 'LA', OAK: 'LV', WSH: 'WAS' };
// Defunct/non-league clubs remain distinct from similarly named franchises.
// STG and CRP are retained as clubs, with shared franchise membership below.
const defunct = new Set(('ABU AKR ATN BFF BKN BRL BYK CBD CCL CHB CHL CHT CIB CLI CLP CNC COL CST CTI CWP DAY DHR DPN DTI DTM DUL DWL ECG ELY FTP FTW FYJ GAR GUN HAM HRT KCB KEN KEW LAB LAN LOG LOU MCK MIL MNM MNN MUN MUT NG1 NYA OOR PRV PTB PTQ PUL RAC RCH RCK RED RIC RII ROS SEN SIS SLA STP SYR THO TLM TOL TON TOR UAP UTI WBU WGC WHE WJA ZAN BBA BCL BDA CRA DTX LDA MSA NAA NYY STG CRP').split(' '));
export const isHistoricalOpponent = code => typeof code === 'string' && code.startsWith('historical:') && defunct.has(code.slice(11));
const normalize = code => aliases[code] || (defunct.has(code) ? `historical:${code}` : code);
// First APFA/NFL, AAFC or 1960 AFL season, not earlier semipro/exhibition play.
export const FRANCHISE_DEBUTS = Object.freeze({ ARI: 1920, CHI: 1920, GB: 1921,
  NYG: 1925, DET: 1930, WAS: 1932, PHI: 1933, PIT: 1933, LA: 1937,
  CLE: 1946, SF: 1946, IND: 1953,
  DAL: 1960, BUF: 1960, DEN: 1960, KC: 1960, LAC: 1960, NE: 1960,
  NYJ: 1960, LV: 1960, TEN: 1960, MIN: 1961, ATL: 1966, MIA: 1966,
  NO: 1967, CIN: 1968, SEA: 1976, TB: 1976, CAR: 1995, JAX: 1995, BAL: 1996, HOU: 2002 });

// Fixed early schedule totals from the pinned archive's historical season
// records. Teams scheduled unequal numbers of games; no modern formula applies.
// Shared wartime seasons are counted for each participating franchise, and
// the Rams' 1943 suspension has zero games. The 1932 standings tiebreaker is
// classified as regular season by the archive and counted in season standings.
const earlyCounts = {
  ARI: [10,8,11,12,10,14,12,11,6,13,13,9,10,11,11,12,12,11,11,11,11,11,11,10,10,10],
  CHI: [13,11,12,12,11,17,16,14,13,15,14,13,14,13,13,12,12,11,11,11,11,11,11,10,10,10],
  GB: [6,10,10,11,13,13,10,13,13,14,14,14,13,13,12,12,11,11,11,11,11,11,10,10,10],
  DET: [14,14,12,11,13,12,12,11,11,11,11,11,11,10,10,10],
  NYG: [12,13,13,13,15,17,14,12,14,13,12,12,11,11,11,11,11,11,10,10,10],
  PIT: [11,12,12,12,11,11,11,11,11,11,10,10,10],
  PHI: [9,11,11,12,11,11,11,11,11,11,10,10,10],
  WAS: [10,12,12,11,12,11,11,11,11,11,11,10,10,10],
  LA: [11,11,11,11,11,11,0,10,10],
};

export function historicalClubFranchises(code, season) {
  if (code === 'historical:STG') {
    if (season !== 1943) throw new Error('Invalid Steagles season');
    return ['PHI', 'PIT'];
  }
  if (code === 'historical:CRP') {
    if (season !== 1944) throw new Error('Invalid Card-Pitt season');
    return ['ARI', 'PIT'];
  }
  return TEAMS[code] ? [code] : [];
}

export function readArchive(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const columns = lines.shift().split(',');
  const fields = ['date', 'season', 'playoff', 'team1', 'team2', 'score1', 'score2'];
  if (fields.some(key => !columns.includes(key))) throw new Error('Unexpected historical results format');
  const rows = [];
  for (const line of lines) {
    const cells = line.split(',');
    const row = Object.fromEntries(fields.map(key => [key, cells[columns.indexOf(key)]]));
    const season = Number(row.season);
    if (!Number.isInteger(season)) throw new Error('Invalid historical season');
    if (season < ARCHIVE_FIRST_SEASON || season > ARCHIVE_LAST_SEASON || row.playoff !== '0') continue;
    if (row.score1 === '' || row.score2 === '' || row.score1 == null || row.score2 == null) throw new Error('Missing historical score');
    rows.push([row.date, season, normalize(row.team1), Number(row.score1), normalize(row.team2), Number(row.score2)]);
  }
  validateArchive(rows);
  return rows;
}

export function expectedHistoricalGames(team, season) {
  if (season < (FRANCHISE_DEBUTS[team] || ARCHIVE_FIRST_SEASON) || team === 'CLE' && season >= 1996) return 0;
  if (season < 1946) return earlyCounts[team]?.[season - FRANCHISE_DEBUTS[team]] ?? 0;
  if (season <= 1948 && ['CLE', 'SF'].includes(team)) return 14; // AAFC
  if (season === 1946) return 11; // NFL expanded to twelve games in 1947.
  if (season <= 1960 && !['BUF', 'DEN', 'KC', 'LAC', 'NE', 'NYJ', 'LV', 'TEN'].includes(team)) return 12;
  if (season < 1978) return 14;
  return season === 1982 ? 9 : season === 1987 ? 15 : 16;
}

export function validateArchive(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty historical results');
  const schedules = new Map();
  const seen = new Set();
  for (const row of rows) {
    const [date, season, home, homeScore, away, awayScore] = row;
    if (row.length !== 6 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        Number(date.slice(0, 4)) < season || Number(date.slice(0, 4)) > season + 1 ||
        !Number.isInteger(season) || season < ARCHIVE_FIRST_SEASON || season > ARCHIVE_LAST_SEASON ||
        home === away || ![home, away].every(t => TEAMS[t] || isHistoricalOpponent(t)) ||
        ![homeScore, awayScore].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid historical result');
    for (const team of [home, away]) {
      const key = `${team}:${date}`;
      if (seen.has(key)) throw new Error(`Duplicate historical game: ${key}`);
      seen.add(key);
      for (const franchise of historicalClubFranchises(team, season)) {
        const seasonKey = `${franchise}:${season}`;
        schedules.set(seasonKey, (schedules.get(seasonKey) || 0) + 1);
      }
    }
    if (historicalClubFranchises(home, season).some(t => historicalClubFranchises(away, season).includes(t))) throw new Error('Franchise playing itself');
  }
  if (rows.length !== ARCHIVE_GAME_COUNT) throw new Error('Incomplete historical archive');
  for (let season = ARCHIVE_FIRST_SEASON; season <= ARCHIVE_LAST_SEASON; season++) {
    for (const team of Object.keys(TEAMS)) {
      if ((schedules.get(`${team}:${season}`) || 0) !== expectedHistoricalGames(team, season)) {
        throw new Error(`Incomplete historical schedule: ${team} ${season}`);
      }
    }
  }
  return true;
}

export function archiveByTeam(rows) {
  validateArchive(rows);
  const history = Object.fromEntries(Object.keys(TEAMS).map(team => [team, []]));
  for (const [date, season, home, homeScore, away, awayScore] of rows) {
    const game = { id: `archive:${date}:${away}:${home}`, date, season, type: 'REG', week: null,
      home, homeScore, away, awayScore, completed: true };
    for (const club of [home, away]) for (const team of historicalClubFranchises(club, season)) {
      // Project a merged club into each franchise's own schedule. Opponents
      // retain the merged club code and see just one game, not two opponents.
      history[team].push({ ...game, ...(club === home ? { home: team } : { away: team }),
        ...(club.startsWith('historical:') ? { mergedClub: club } : {}) });
    }
  }
  return history;
}
