import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { calculateTenures, calculatePlayerTeamTenures, parseRoster, rankTenures, rosterFranchises } from '../nfl/longest-tenure-data.mjs';
import { TEAMS } from '../nfl/divstreaks-data.mjs';

test('CSV handles quoted names, commas, escaped quotes and historical files without weeks', () => {
  const [row] = parseRoster('season,team,gsis_id,full_name,position,status\r\n2020,OAK,1,"Player, ""Jr.""",LS,ACT\r\n');
  assert.equal(row.full_name, 'Player, "Jr."');
  assert.equal(row.team, 'LV');
  assert.equal(row.source_team, 'OAK');
  assert.equal(row.week, 0);
  assert.throws(() => parseRoster('season,team\n2026,BUF'), /Missing roster column/);
  assert.equal(parseRoster('season,team,gsis_id,full_name,first_name,last_name,position,status\n2016,MIN,1,,Bryant,Dubose,DE,RES')[0].full_name, 'Bryant Dubose');
});

test('historical franchise codes keep relocations together and distinguish reused names and joint clubs', () => {
  for (const [code, year, teams] of [
    ['HOU', 1983, ['TEN']], ['HST', 2010, ['HOU']], ['HOU', 2026, ['HOU']],
    ['BAL', 1950, []], ['BAL', 1970, ['IND']], ['BLT', 2010, ['BAL']],
    ['STL', 1987, ['ARI']], ['PHO', 1990, ['ARI']], ['STL', 1999, ['LA']], ['SL', 2010, ['LA']],
    ['CLE', 1940, ['LA']], ['CLE', 1946, ['CLE']], ['CLV', 2010, ['CLE']],
    ['BOS', 1933, ['WAS']], ['BOS', 1946, []], ['BOS', 1960, ['NE']],
    ['BUF', 1920, []], ['BUF', 1960, ['BUF']], ['KC', 1924, []], ['TEX', 1960, ['KC']],
    ['DAL', 1952, []], ['COW', 1960, ['DAL']], ['NY', 1921, []], ['NY', 1930, ['NYG']],
    ['P-P', 1943, ['PHI', 'PIT']], ['C-P', 1944, ['ARI', 'PIT']],
  ]) assert.deepEqual(rosterFranchises(code, year), teams, `${code} ${year}`);
  assert.throws(() => rosterFranchises('UNKNOWN', 2026), /Unknown historical/);
});

const player = (id, team, season, patch = {}) => ({ gsis_id: id, full_name: id, team, season, status: 'ACT', week: 8, position: 'LS', ...patch });
const currentTeams = () => Object.keys(TEAMS).map(team => player(`current-${team}`, team, 2026));

test('individual lists preserve separate stints, shared transition seasons, reserves, ties and bye snapshots', () => {
  const rows = currentTeams();
  rows.push(player('returning', 'BUF', 2023), player('returning', 'BUF', 2024), player('returning', 'NYJ', 2024), player('returning', 'BUF', 2025, { status: 'RES' }), player('returning', 'BUF', 2026));
  rows.push(player('gap', 'MIA', 2023), player('gap', 'MIA', 2025), player('gap', 'MIA', 2026));
  rows.push(player('cut', 'BUF', 2025), player('cut', 'BUF', 2026, { status: 'CUT' }));
  rows.push(player('retired', 'BUF', 2025), player('retired', 'BUF', 2026, { status: 'RET' }));
  rows.push(player('stale', 'BUF', 2025), player('stale', 'BUF', 2026, { week: 1 }));
  for (const row of rows) if (row.team === 'CAR' && row.season === 2026) row.week = 7;
  const data = calculatePlayerTeamTenures(rows, 2026);
  assert.equal(data.active.find(row => row.id === 'returning').since, 2024);
  assert.deepEqual(data.allTime.filter(row => row.id === 'returning' && row.team === 'BUF').map(row => [row.since, row.through, row.active]), [[2024, 2026, true], [2023, 2024, false]]);
  assert.equal(data.active.find(row => row.id === 'gap').seasons, 2);
  assert.ok(!data.active.some(row => ['cut', 'retired', 'stale'].includes(row.id)));
  assert.equal(data.teams.find(row => row.team === 'CAR').week, 7);
  const ranked = rankTenures([{ id: 'a', name: 'A', team: 'BUF', since: 2000, seasons: 10 }, { id: 'b', name: 'B', team: 'BUF', since: 2001, seasons: 10 }, { id: 'c', name: 'C', team: 'BUF', since: 2002, seasons: 9 }]);
  assert.deepEqual(ranked.map(row => row.rank), [1, 1, 3]);
});

test('old players without GSIS IDs join modern identities while namesakes and historical franchises stay separate', () => {
  const rows = currentTeams();
  rows.push(player('', 'LA', 1993, { full_name: 'Veteran', birth_date: '1960-01-01' }), player('modern-id', 'LA', 1994, { full_name: 'Veteran', birth_date: '1960-01-01' }));
  rows.push(...parseRoster('season,team,gsis_id,full_name,position,status,birth_date\n1995,STL,modern-id,Veteran,T,RES,1960-01-01'));
  rows.push(player('', 'BUF', 1970, { full_name: 'Same Name', birth_date: '1940-01-01' }), player('', 'BUF', 1971, { full_name: 'Same Name', birth_date: '1950-01-01' }));
  rows.push(player('', 'PIT', 1942, { full_name: 'Wartime', birth_date: '1920-01-01' }), player('', 'P-P', 1943, { full_name: 'Wartime', birth_date: '1920-01-01' }), player('', 'C-P', 1944, { full_name: 'Wartime', birth_date: '1920-01-01' }), player('', 'PIT', 1945, { full_name: 'Wartime', birth_date: '1920-01-01' }));
  const data = calculatePlayerTeamTenures(rows, 2026);
  const veteran = data.allTime.find(row => row.id === 'modern-id');
  assert.equal(veteran.team, 'LA'); assert.equal(veteran.seasons, 3);
  assert.equal(data.allTime.filter(row => row.name === 'Same Name').length, 2);
  assert.equal(data.allTime.find(row => row.name === 'Wartime' && row.team === 'PIT').seasons, 4);
  assert.throws(() => calculatePlayerTeamTenures(currentTeams().filter(row => row.team !== 'BUF'), 2026), /No current roster for BUF/);
});

test('counts current franchise seasons, preserves ties, handles byes and excludes former players', () => {
  const row = (id, team, season, status = 'ACT', week = 5) => ({
    gsis_id: id, full_name: id, team, season, status, week, position: 'LS',
  });
  const rows = Object.keys(TEAMS).map((team) => row(`rookie-${team}`, team, 2026));
  rows.push(row('veteran', 'BUF', 2024, 'DEV'), row('veteran', 'BUF', 2025, 'RES'), row('veteran', 'BUF', 2026));
  rows.push(row('tied', 'BUF', 2024), row('tied', 'BUF', 2025), row('tied', 'BUF', 2026));
  rows.push(row('released', 'BUF', 2010), row('released', 'BUF', 2026, 'CUT'));
  rows.push(row('retired', 'BUF', 2010), row('retired', 'BUF', 2026, 'RET'));
  rows.push(row('stale', 'BUF', 2010), row('stale', 'BUF', 2026, 'ACT', 2));
  rows.push(row('returned', 'MIA', 2023), row('returned', 'MIA', 2024), row('returned', 'NYJ', 2024), row('returned', 'MIA', 2025), row('returned', 'MIA', 2026));
  rows.push(row('gap', 'NE', 2023), row('gap', 'NE', 2025), row('gap', 'NE', 2026));
  for (const record of rows) if (record.team === 'CAR' && record.season === 2026) record.week = 4;
  const result = calculateTenures(rows, 2026);
  assert.equal(result.teams.length, 32);
  const buffalo = result.teams.find((team) => team.team === 'BUF');
  assert.equal(buffalo.since, 2024);
  assert.deepEqual(buffalo.players.map((player) => player.name), ['tied', 'veteran']);
  assert.equal(result.teams.find((team) => team.team === 'MIA').since, 2024);
  assert.equal(result.teams.find((team) => team.team === 'NE').since, 2025);
  assert.equal(result.teams.find((team) => team.team === 'CAR').week, 4);
});

test('saved data and visible page cover all 32 teams consistently', async () => {
  const data = JSON.parse(await readFile(new URL('../data/longest-tenure.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../nfl/longest-tenure.html', import.meta.url), 'utf8');
  assert.deepEqual(data.teams.map((team) => team.team).sort(), Object.keys(TEAMS).sort());
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.firstSeason, 1920);
  for (const key of ['active', 'allTime']) {
    assert.equal(data[key].length, 100);
    assert.ok(data[`${key}Count`] >= 100);
    assert.equal(new Set(data[key].map(row => `${row.id}:${row.team}:${row.since}`)).size, 100);
    for (let i = 0; i < data[key].length; i++) {
      const row = data[key][i];
      assert.ok(TEAMS[row.team]);
      assert.equal(row.seasons, row.through - row.since + 1);
      if (i) assert.ok(data[key][i - 1].seasons >= row.seasons);
    }
  }
  assert.ok(data.active.every(row => row.active && row.through === data.season));
  for (const [name, team, seasons] of [['Jason Hanson', 'DET', 21], ['Tom Brady', 'NE', 20], ['Darrell Green', 'WAS', 20], ['Jackie Slater', 'LA', 20], ['Bruce Matthews', 'TEN', 19], ['Jim Marshall', 'MIN', 19], ['Johnny Unitas', 'IND', 17], ['Ray Lewis', 'BAL', 17]]) {
    assert.equal(data.allTime.find(row => row.name === name && row.team === team)?.seasons, seasons, name);
  }
  for (const row of data.allTime.filter(row => row.active)) assert.ok(data.active.some(active => active.id === row.id && active.team === row.team && active.since === row.since));
  assert.equal((html.match(/<article class="team-row"/g) || []).length, 32);
  for (const team of data.teams) {
    assert.equal(team.seasons, data.season - team.since + 1);
    assert.ok(team.players.length);
    for (const player of team.players) {
      assert.equal(player.since, team.since);
      assert.ok(html.includes(player.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')));
    }
  }
  for (const file of ['../nfl/index.html', '../nfl.html']) {
    const index = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(index.includes('href="/nfl/longest-tenure.html"'));
  }
});
