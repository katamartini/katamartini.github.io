import { DIVISIONS, TEAMS } from './divstreaks-data.mjs';
import { FRANCHISE_DEBUTS } from './droughts-archive.mjs';

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
    record.full_name ||= [record.first_name, record.last_name].filter(Boolean).join(' ');
    record.source_team = record.team;
    record.team = FORMER_CODES[record.team] || record.team;
    record.season = Number(record.season);
    record.week = Number(record.week || 0);
    return record;
  });
}

export function calculateTenures(rosters, season) {
  const { week, teams } = calculatePlayerTeamTenures(rosters, season);
  return { season, week, teams };
}

const defunct = new Set('AKR BRK CAN CHH CHT COL DAY DON DUL ECG FYJ HAM HAR KEN LOU MIL MUN NEW NYB NYY OOR ORG POT PRO RAC RI ROC SI TOL TON'.split(' '));
const aliases = { ARZ: 'ARI', PHO: 'ARI', CHC: 'ARI', CHB: 'CHI', CHS: 'CHI', DEC: 'CHI', BLT: 'BAL', CLV: 'CLE', COW: 'DAL', RAM: 'LA', LAR: 'LA', SL: 'LA', RAI: 'LV', OAK: 'LV', SD: 'LAC', HST: 'HOU', NYT: 'NYJ', WSH: 'WAS' };

// Codes such as BAL, HOU, BOS, CLE and STL refer to different franchises
// in different eras. Joint wartime rosters belong to both partner clubs.
export function rosterFranchises(code, season) {
  if (code === 'P-P' && season === 1943) return ['PHI', 'PIT'];
  if (code === 'C-P' && season === 1944) return ['ARI', 'PIT'];
  if (defunct.has(code)) return [];
  let team = aliases[code] || code;
  if (code === 'BAL' && season < 1996) team = season >= 1953 && season <= 1983 ? 'IND' : null;
  if (code === 'HOU' && season < 2002) team = season >= 1960 && season <= 1996 ? 'TEN' : null;
  if (code === 'BOS') team = season >= 1932 && season <= 1936 ? 'WAS' : season >= 1960 ? 'NE' : null;
  if (code === 'CLE' && season < 1946) team = season >= 1937 ? 'LA' : null;
  if (code === 'STL') team = season >= 1995 ? 'LA' : season >= 1960 && season <= 1987 ? 'ARI' : null;
  if (code === 'CHR') team = season === 1960 ? 'LAC' : null;
  if (code === 'NY') team = season >= 1925 ? 'NYG' : null;
  if (code === 'POR') team = season >= 1930 && season <= 1933 ? 'DET' : null;
  if (code === 'TEX') team = season >= 1960 && season <= 1962 ? 'KC' : null;
  if (team === null) return [];
  if (!TEAMS[team]) throw new Error(`Unknown historical roster franchise: ${code} ${season}`);
  return season >= FRANCHISE_DEBUTS[team] ? [team] : [];
}

const nameKey = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const identityKey = row => `${nameKey(row.full_name)}:${row.birth_date || 'unknown'}`;
const foreignSeason = (year, team) => year.groups.some(group => !group.includes(team));

export function rankTenures(rows) {
  let previous, rank;
  return [...rows].sort((a, b) => b.seasons - a.seasons || a.since - b.since || a.name.localeCompare(b.name) || a.team.localeCompare(b.team) || a.id.localeCompare(b.id))
    .map((row, index) => {
      if (row.seasons !== previous) rank = index + 1;
      previous = row.seasons;
      return { ...row, rank };
    });
}

export function calculatePlayerTeamTenures(rosters, season) {
  const knownIds = new Map();
  for (const row of rosters) {
    if (!row.full_name || !row.gsis_id) continue;
    const key = identityKey(row);
    if (!knownIds.has(key)) knownIds.set(key, new Set());
    knownIds.get(key).add(String(row.gsis_id));
  }
  const people = new Map(), current = [];
  for (const row of rosters) {
    if (row.season > season) continue;
    const franchises = rosterFranchises(row.source_team || row.team, row.season);
    if (!franchises.length) continue;
    if (!row.full_name?.trim() || !Number.isInteger(row.season)) throw new Error('Incomplete roster player');
    const ids = knownIds.get(identityKey(row));
    if (!row.gsis_id && ids?.size > 1) throw new Error(`Ambiguous historical player identity: ${row.full_name}`);
    const id = String(row.gsis_id || (ids?.size === 1 ? [...ids][0] : `historical:${identityKey(row)}`));
    if (!people.has(id)) people.set(id, new Map());
    const years = people.get(id);
    if (!years.has(row.season)) years.set(row.season, { teams: new Map(), groups: [] });
    const year = years.get(row.season);
    if (!year.groups.some(group => group.join(',') === franchises.join(','))) year.groups.push(franchises);
    for (const team of franchises) {
      const player = { id, team, name: row.full_name, position: row.depth_chart_position || row.position || '—', week: row.week || 0, status: row.status };
      const previous = year.teams.get(team);
      if (!previous || player.week >= previous.week) year.teams.set(team, player);
      if (row.season === season) current.push(player);
    }
  }
  const week = Math.max(...current.map(row => row.week));
  if (!Number.isInteger(week) || week < 1) throw new Error('No current roster week');
  const teamWeeks = Object.fromEntries(Object.keys(TEAMS).map(team => [team, Math.max(...current.filter(row => row.team === team).map(row => row.week))]));
  const activePlayers = new Map(current.filter(row => row.week === teamWeeks[row.team] && CURRENT_STATUSES.has(row.status)).map(row => [`${row.id}:${row.team}`, row]));
  const allTime = [], active = [];
  for (const [id, years] of people) {
    const latest = new Map();
    for (const year of [...years.keys()].sort((a, b) => a - b)) {
      for (const [team, player] of years.get(year).teams) {
        let run = latest.get(team);
        if (!run || run.through !== year - 1 || (foreignSeason(years.get(year - 1), team) && run.since < year - 1)) {
          const since = run?.through === year - 1 && foreignSeason(years.get(year - 1), team) ? year - 1 : year;
          run = { id, team, name: player.name, position: player.position, since, through: year, seasons: year - since + 1, active: false };
          allTime.push(run); latest.set(team, run);
        } else {
          run.through = year; run.seasons = year - run.since + 1;
          run.name = player.name; run.position = player.position;
        }
      }
    }
    for (const team of Object.keys(TEAMS)) {
      const player = activePlayers.get(`${id}:${team}`);
      if (!player) continue;
      let since = season;
      while (!foreignSeason(years.get(since), team) && years.get(since - 1)?.teams.has(team)) since -= 1;
      const row = { id, team, name: player.name, position: player.position, since, through: season, seasons: season - since + 1, active: true };
      active.push(row);
      const run = allTime.find(run => run.id === id && run.team === team && run.since === since && run.through === season);
      if (run) run.active = true; else allTime.push(row);
    }
  }
  const rankedActive = rankTenures(active);
  const teams = DIVISIONS.flatMap(division => division.teams.map(team => {
    const candidates = rankedActive.filter(row => row.team === team);
    if (!candidates.length) throw new Error(`No current roster for ${team}`);
    const since = Math.min(...candidates.map(row => row.since));
    return { team, division: division.name, week: teamWeeks[team], since, seasons: season - since + 1,
      players: candidates.filter(row => row.since === since).map(({ id, name, position, since, seasons }) => ({ id, name, position, since, seasons })).sort((a, b) => a.name.localeCompare(b.name)) };
  }));
  return { season, week, teams, active: rankedActive, allTime: rankTenures(allTime) };
}
