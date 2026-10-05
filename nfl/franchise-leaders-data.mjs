import { TEAMS } from './divstreaks-data.mjs';

export const MIN_YARDS = 5000;
export const VIEWS = {
  receiving: { label: 'Receiving yards', metric: 'yards', minimum: 5000, query: 'receiving-yards', stats: [
    { key: 'yards', label: 'Receiving yards', source: 'REC YDS' },
    { key: 'receptions', label: 'Receptions', source: 'REC' },
    { key: 'touchdowns', label: 'Receiving TDs', source: 'REC TD' },
  ] },
  passing: { label: 'Passing yards', metric: 'yards', minimum: 5000, query: 'passing-yards', stats: [
    { key: 'yards', label: 'Passing yards', source: 'YDS' },
    { key: 'touchdowns', label: 'Passing TDs', source: 'TD' },
    { key: 'interceptions', label: 'Interceptions', source: 'INT' },
  ] },
  rushing: { label: 'Rushing yards', metric: 'yards', minimum: 5000, query: 'rushing-yards', stats: [
    { key: 'yards', label: 'Rushing yards', source: 'RUSH YDS' },
    { key: 'attempts', label: 'Carries', source: 'ATT' },
    { key: 'touchdowns', label: 'Rushing TDs', source: 'RUSH TD' },
  ] },
  sacks: { label: 'Sacks', metric: 'sacks', minimum: 50, query: 'sack', stats: [
    { key: 'sacks', label: 'Sacks', source: 'SCK' },
    { key: 'games', label: 'Games', source: 'GP' },
  ] },
};
export const viewFromHash = hash => Object.hasOwn(VIEWS, hash.replace(/^#/, '')) ? hash.replace(/^#/, '') : 'receiving';
export const normalizeTeam = team => ({ OAK: 'LV', SD: 'LAC', STL: 'LA', LAR: 'LA', WSH: 'WAS' })[team] || team;
export const normalizeName = name => name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');

export function franchiseHighs(records, metric = 'yards') {
  const highs = new Map();
  for (const row of records) highs.set(row.team, Math.max(highs.get(row.team) ?? 0, row[metric]));
  return highs;
}

export function parseCsv(csv) {
  const values = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value !== '')) values.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length) { row.push(field); values.push(row); }
  const [headers, ...rows] = values;
  if (!headers) throw new Error('Empty CSV');
  return rows.map(fields => Object.fromEntries(headers.map((key, i) => [key, fields[i] ?? ''])));
}

function decode(text) {
  return text.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value) => String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
const plain = html => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseLeaderboardTable(html, team, view = 'receiving') {
  const config = VIEWS[view];
  if (!config) throw new Error(`Unknown view: ${view}`);
  if (!TEAMS[team]) throw new Error(`Unknown franchise: ${team}`);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && !plain(title).toLowerCase().includes(TEAMS[team].name.toLowerCase())) throw new Error(`Wrong franchise in source: ${team}`);
  const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error(`Missing ${view} table for ${team}`);
  const headers = [...(table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(match => plain(match[1]));
  const indexes = Object.fromEntries(['NAME', ...config.stats.map(stat => stat.source)].map(key => [key, headers.indexOf(key)]));
  if (Object.values(indexes).some(index => index < 0)) throw new Error(`Unexpected ${view} columns for ${team}`);
  const rows = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
    if (!cells.length) continue;
    if (cells.every(cell => plain(cell) === '')) continue; // Source's empty placeholder rows.
    if (cells.length !== headers.length) throw new Error(`Incomplete ${view} row for ${team}`);
    const playerCell = cells[indexes.NAME];
    const name = decode(playerCell.match(/\btitle="([^"]+)"/i)?.[1] || '');
    const stat = key => {
      const text = plain(cells[indexes[key]]).replace(/,/g, '');
      if (!/^-?\d+(?:\.\d)?$/.test(text)) throw new Error(`Invalid ${key} for ${team}: ${name}`);
      return Number(text);
    };
    if (!name) throw new Error(`Missing player name for ${team}`);
    rows.push({ team, name, ...Object.fromEntries(config.stats.map(field => [field.key, stat(field.source)])) });
  }
  if (!rows.length || rows.some((row, i) => i && row[config.metric] > rows[i - 1][config.metric]) ||
      new Set(rows.map(row => normalizeName(row.name))).size !== rows.length) throw new Error(`Invalid ${view} leaderboard for ${team}`);
  // The free source shows 25 rows. A qualifying final row could hide others.
  if (rows.at(-1)[config.metric] >= config.minimum) throw new Error(`${view} leaderboard is truncated above ${config.minimum} for ${team}`);
  return rows.filter(row => row[config.metric] >= config.minimum);
}
export const parseReceivingTable = (html, team) => parseLeaderboardTable(html, team, 'receiving');

export function currentRoster(rosterRows, season) {
  const rows = rosterRows.filter(row => Number(row.season) === season && (!row.game_type || row.game_type === 'REG'));
  if (!rows.length) throw new Error(`No ${season} roster rows`);
  const week = Math.max(...rows.map(row => Number(row.week || 0)));
  if (!Number.isInteger(week) || week < 0 || week > 18) throw new Error('Invalid roster week');
  const memberships = new Set();
  const teams = new Set();
  const eligible = new Set(['ACT', 'INA', 'RES', 'DEV', 'EXE']);
  for (const row of rows.filter(row => Number(row.week || 0) === week)) {
    const team = normalizeTeam(row.team);
    if (!TEAMS[team]) throw new Error(`Unknown roster team: ${row.team}`);
    teams.add(team);
    if (eligible.has(row.status)) {
      if (!row.full_name) throw new Error('Missing roster name');
      memberships.add(`${team}:${normalizeName(row.full_name)}`);
      if (row.football_name && row.last_name) memberships.add(`${team}:${normalizeName(`${row.football_name} ${row.last_name}`)}`);
    }
  }
  if (teams.size !== 32) throw new Error(`Incomplete current roster feed: ${teams.size} teams`);
  return { week, memberships };
}

export function validRecord(row, view = 'receiving') {
  const config = VIEWS[view];
  return !!config && !!TEAMS[row.team] && typeof row.name === 'string' && !!normalizeName(row.name) &&
    config.stats.every(({ key }) => key === 'sacks' ? Number.isFinite(row[key]) && Number.isSafeInteger(Math.round(row[key] * 10)) && Math.round(row[key] * 10) / 10 === row[key] && row[key] >= 0 : Number.isSafeInteger(row[key]) && row[key] >= 0) &&
    row[config.metric] >= config.minimum && (view !== 'receiving' || row.receptions > 0) &&
    (view !== 'rushing' || row.attempts > 0) && (view !== 'sacks' || row.games > 0);
}

export function buildLeaders(records, memberships, view = 'receiving') {
  const config = VIEWS[view];
  if (!config) throw new Error(`Unknown view: ${view}`);
  const keys = new Set();
  return records.map(row => {
    const key = `${row.team}:${normalizeName(row.name)}`;
    if (!validRecord(row, view) || keys.has(key)) throw new Error(`Invalid franchise record: ${key}`);
    keys.add(key);
    return { ...row, current: memberships.has(key) };
  }).sort((a, b) => b[config.metric] - a[config.metric] || a.name.localeCompare(b.name) || a.team.localeCompare(b.team));
}
