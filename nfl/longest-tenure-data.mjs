import { DIVISIONS, TEAMS } from './divstreaks-data.mjs';

export const ROSTER_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/tag/rosters';
export const rosterUrl = (season) => `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;
const FORMER_CODES = { OAK: 'LV', SD: 'LAC', STL: 'LA', LAR: 'LA' };
const CURRENT_STATUSES = new Set(['ACT', 'DEV', 'EXE', 'INA', 'PUP', 'RES', 'RSN', 'SUS', 'E14']);

// Roster CSVs include quoted colleges and names containing commas.
export function parseRoster(csv) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV field');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = rows.shift();
  for (const key of ['season', 'team', 'gsis_id', 'full_name', 'position', 'status']) {
    if (!header?.includes(key)) throw new Error(`Missing roster column: ${key}`);
  }
  return rows.filter((fields) => fields.length === header.length).map((fields) => {
    const record = Object.fromEntries(header.map((key, index) => [key, fields[index]]));
    record.team = FORMER_CODES[record.team] || record.team;
    record.season = Number(record.season);
    record.week = Number(record.week || 0);
    return record;
  });
}

export function calculateTenures(rosters, season) {
  const current = rosters.filter((row) => row.season === season && TEAMS[row.team]);
  const week = Math.max(...current.map((row) => row.week));
  if (!Number.isInteger(week) || week < 1) throw new Error('No current roster week');
  const history = new Map();
  for (const row of rosters) {
    if (!row.gsis_id || !TEAMS[row.team] || row.season > season) continue;
    if (!history.has(row.gsis_id)) history.set(row.gsis_id, new Map());
    const years = history.get(row.gsis_id);
    if (!years.has(row.season)) years.set(row.season, new Set());
    years.get(row.season).add(row.team);
  }
  const teams = DIVISIONS.flatMap((division) => division.teams.map((team) => {
    const teamWeek = Math.max(...current.filter((row) => row.team === team).map((row) => row.week));
    const candidates = current.filter((row) => row.team === team && row.week === teamWeek &&
      CURRENT_STATUSES.has(row.status) && row.gsis_id);
    if (!candidates.length) throw new Error(`No current roster for ${team}`);
    const players = new Map();
    for (const row of candidates) {
      const years = history.get(row.gsis_id);
      let since = season;
      // A missing season or another franchise ends the previous stint.
      while (years.get(since)?.size === 1 && years.get(since)?.has(team) &&
             years.get(since - 1)?.has(team)) since -= 1;
      players.set(row.gsis_id, {
        id: row.gsis_id, name: row.full_name, position: row.depth_chart_position || row.position,
        since, seasons: season - since + 1,
      });
    }
    const since = Math.min(...[...players.values()].map((player) => player.since));
    return {
      team, division: division.name, week: teamWeek, since, seasons: season - since + 1,
      players: [...players.values()].filter((player) => player.since === since)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }));
  return { season, week, teams };
}
