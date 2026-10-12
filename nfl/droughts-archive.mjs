import { TEAMS } from './divstreaks-data.mjs';

export const ARCHIVE_FIRST_SEASON = 1946;
export const ARCHIVE_LAST_SEASON = 1998;
export const ARCHIVE_SOURCE = 'https://raw.githubusercontent.com/fivethirtyeight/nfl-elo-game/f7d430b4781aa34736f2ecb3795ca1fa495f5876/data/nfl_games.csv';
export const ARCHIVE_SHA256 = 'af16cf3c5848393057fad07feea278f0a85ab7b57ddbfe42ed96b5c80e7d519d';
export const ARCHIVE_ROWS_SHA256 = '7ad76657d8762b5dccfa19fbe826a4f078860c7fec1ba167df9569c774cd4d06';
const aliases = { LAR: 'LA', OAK: 'LV', WSH: 'WAS' };
// Defunct clubs are opponents, not predecessors of similarly named current teams.
const defunct = new Set(['BBA', 'BCL', 'BDA', 'BYK', 'CRA', 'DTX', 'LDA', 'MSA', 'NAA', 'NYY']);
export const isHistoricalOpponent = code => typeof code === 'string' && code.startsWith('historical:') && defunct.has(code.slice(11));
const normalize = code => aliases[code] || (defunct.has(code) ? `historical:${code}` : code);

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
  const starts = { IND: 1953, DAL: 1960, BUF: 1960, DEN: 1960, KC: 1960, LAC: 1960, NE: 1960,
    NYJ: 1960, LV: 1960, TEN: 1960, MIN: 1961, ATL: 1966, MIA: 1966, NO: 1967, CIN: 1968,
    SEA: 1976, TB: 1976, CAR: 1995, JAX: 1995, BAL: 1996, HOU: 2002 };
  if (season < (starts[team] || ARCHIVE_FIRST_SEASON) || team === 'CLE' && season >= 1996) return 0;
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
      const seasonKey = `${team}:${season}`;
      schedules.set(seasonKey, (schedules.get(seasonKey) || 0) + 1);
    }
  }
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
    for (const team of [home, away]) if (history[team]) history[team].push(game);
  }
  return history;
}
