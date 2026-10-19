import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { TEAMS } from './divstreaks-data.mjs';
import { completedTeamGames, parseStarter, qbTenures, rankRows, starterUrl, startingStreak } from './qbs-data.mjs';

const entry = (id, starter = true, position = 8, didNotPlay = false) => ({ playerId: id, starter, didNotPlay, valid: true, position: { $ref: `http://sports.core.api.espn.com/v2/positions/${position}?lang=en` } });
const roster = (...entries) => ({ entries: [...entries, ...Array.from({ length: 25 }, (_, i) => entry(100 + i, false, 73))] });
test('uses explicit game-roster QB starter flags, not passing volume or lineup order', () => {
  assert.equal(parseStarter(roster(entry(2, false), entry(1), entry(3, true, 1))), '1');
  assert.throws(() => parseStarter(roster(entry(1, true, 8, true))), /Missing or ambiguous/);
  assert.throws(() => parseStarter(roster(entry(1), entry(2))), /Missing or ambiguous/);
  assert.throws(() => parseStarter({ entries: [entry(1)] }), /Incomplete/);
  assert.match(starterUrl('123', 'LA'), /competitors\/14\/roster/);
});

test('streak crosses seasons and byes but ends immediately at another QB start', async () => {
  const games = [
    { id: 'now', date: '2026-09-20', season: 2026 },
    { id: 'opening', date: '2026-09-06', season: 2026 },
    { id: 'end', date: '2026-01-04', season: 2025 },
    { id: 'backup', date: '2025-12-28', season: 2025 },
    { id: 'older', date: '2025-12-21', season: 2025 },
  ];
  const requested = [];
  const result = await startingStreak(games, async game => { requested.push(game.id); return game.id === 'backup' ? '2' : '1'; });
  assert.equal(result.length, 3); assert.equal(result.start.id, 'end'); assert.equal(result.last.id, 'now');
  assert.deepEqual(requested, ['now', 'opening', 'end', 'backup']);
  assert.equal((await startingStreak(games, async game => game.id === 'now' ? 'new' : 'old')).length, 1);
  await assert.rejects(startingStreak(games, async () => '1'), /history boundary/);
  await assert.rejects(startingStreak(games, async () => { throw new Error('unavailable'); }), /unavailable/);
});

test('games exclude future, unfinished, postseason and other teams; aliases retain franchise', () => {
  const row = (id, patch = {}) => ({ game_id: id, espn: '123', season: '2026', week: '1', game_type: 'REG', gameday: '2026-09-01', home_team: 'LAR', away_team: 'BUF', home_score: '0', away_score: '3', ...patch });
  const games = completedTeamGames([row('ok'), row('playoff', { game_type: 'WC' }), row('pending', { home_score: '' }), row('future', { gameday: '2026-11-01' }), row('other', { home_team: 'NE', away_team: 'NYJ' }), row('newseason', { season: '2027' })], 'LA', 2026, '2026-10-19');
  assert.deepEqual(games.map(game => game.id), ['ok']); assert.equal(games[0].opponent, 'BUF');
  assert.throws(() => completedTeamGames([row('ok', { espn: '' })], 'LA', 2026, '2026-10-19'), /Incomplete/);
  assert.throws(() => completedTeamGames([row('ok'), row('ok')], 'LA', 2026, '2026-10-19'), /Incomplete/);
});

const player = (id, team, season, patch = {}) => ({ gsis_id: id, espn_id: String(id), full_name: `QB ${id}`, position: 'QB', status: 'ACT', team, season, week: 6, game_type: 'REG', ...patch });
const allTeams = () => Object.keys(TEAMS).map((team, i) => player(i + 1, team, 2026));
test('tenures include backups and reserves, reset missing years/other franchises, preserve bye snapshots', () => {
  const rows = allTeams();
  rows.push(player(100, 'BUF', 2024, { status: 'DEV' }), player(100, 'BUF', 2025, { status: 'RES' }), player(100, 'BUF', 2026));
  rows.push(player(101, 'MIA', 2022), player(101, 'MIA', 2024), player(101, 'MIA', 2025), player(101, 'MIA', 2026, { status: 'DEV' }));
  rows.push(player(102, 'NE', 2023), player(102, 'NYJ', 2024), player(102, 'NE', 2024), player(102, 'NE', 2025), player(102, 'NE', 2026, { status: 'RES' }));
  rows.push(player(103, 'OAK', 2019), player(103, 'LV', 2020), player(103, 'LV', 2021), player(103, 'LV', 2022), player(103, 'LV', 2023), player(103, 'LV', 2024), player(103, 'LV', 2025), player(103, 'LV', 2026));
  rows.push(player(104, 'BUF', 2026, { status: 'CUT' }), player(105, 'BUF', 2026, { status: 'RET' }), player(106, 'BUF', 2026, { week: 2 }), player(107, 'BUF', 2026, { position: 'WR' }));
  for (const row of rows) if (row.team === 'CAR') row.week = 5;
  const result = qbTenures(rows, 2026);
  assert.equal(result.week, 6); assert.equal(result.rosterWeeks.CAR, 5);
  assert.equal(result.players.find(row => row.id === 100).since, 2024);
  assert.equal(result.players.find(row => row.id === 101).since, 2024);
  assert.equal(result.players.find(row => row.id === 102).since, 2024);
  assert.equal(result.players.find(row => row.id === 103).since, 2019);
  assert.ok(!result.players.some(row => [104, 105, 106, 107].includes(row.id)));
  assert.equal(result.players.length, 36);
});
test('missing teams, missing QB identities and truncated tenure history fail closed', () => {
  assert.throws(() => qbTenures(allTeams().filter(row => row.team !== 'BUF'), 2026), /No current QBs/);
  const rows = allTeams(); rows[0].gsis_id = '';
  assert.throws(() => qbTenures(rows, 2026), /missing identity/);
  const optionalEspn = allTeams(); optionalEspn[0].espn_id = '';
  assert.ok(qbTenures(optionalEspn, 2026).players.some(row => row.espn === null), 'Tenure includes rookies without ESPN IDs');
  const boundary = allTeams(); for (let year = 2000; year <= 2026; year++) boundary.push(player(999, 'BUF', year));
  assert.throws(() => qbTenures(boundary, 2026), /history boundary/);
});
test('table sorts are numeric/textual and do not mutate rank order', () => {
  const rows = [{ name: 'A', team: 'BUF', length: 2 }, { name: 'B', team: 'MIA', length: 10 }];
  assert.equal(rankRows(rows, 'length', true)[0].name, 'B');
  assert.equal(rankRows(rows, 'length', false)[0].name, 'A');
  assert.equal(rankRows(rows, 'team', true)[0].team, 'MIA');
  assert.equal(rows[0].name, 'A');
});
test('published data has one starting result per team and every team has tenure QBs', async () => {
  const data = JSON.parse(await readFile(new URL('../data/qbs.json', import.meta.url), 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual([...data.starts, ...data.unavailable].map(row => row.team).sort(), Object.keys(TEAMS).sort());
  assert.deepEqual([...new Set(data.tenures.map(row => row.team))].sort(), Object.keys(TEAMS).sort());
  assert.ok(data.tenures.length >= 64, 'Includes backups');
  assert.ok(data.starts.length >= 24);
  for (const row of data.starts) {
    assert.ok(row.length > 0); assert.ok(row.start.date <= row.last.date);
    assert.ok(data.tenures.some(player => player.id === row.id && player.team === row.team));
  }
  for (const row of data.tenures) assert.equal(row.seasons, data.season - row.since + 1);
  for (const file of ['../nfl.html', './index.html']) assert.ok((await readFile(new URL(file, import.meta.url), 'utf8')).includes('href="/nfl/QBs.html"'));
});
