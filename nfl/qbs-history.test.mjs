import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { TEAMS } from './divstreaks-data.mjs';
import { franchiseStartingLeaders, historicalStartingStreaks, rankedStartingStreaks, readStartingHistory, validStartingHistory } from './qbs-history.mjs';

const game = (date, team, playerId, season = Number(date.slice(0, 4)), opponent = 'MIA') => ({ team, playerId, name: playerId, game: { id: `${date}_${team}`, date, season, week: 1, opponent } });
test('historical runs span seasons/byes and relocations, split on replacement starts, and flag the 1950 boundary', () => {
  const games = [game('1987-09-20', 'BUF', 'A'), game('1987-10-04', 'BUF', 'Replacement'), game('1987-10-25', 'BUF', 'A'), game('1988-09-04', 'BUF', 'A'), game('1950-09-17', 'GB', 'Early', 1950, 'BCL')];
  const runs = historicalStartingStreaks(games.reverse());
  assert.equal(runs.find(row => row.length === 2).start.date, '1987-10-25');
  assert.equal(runs.filter(row => row.team === 'BUF').length, 3);
  assert.equal(runs.find(row => row.start.date === '1987-09-20').active, false);
  assert.equal(runs.find(row => row.playerId === 'Early').startKnown, false);
  assert.throws(() => historicalStartingStreaks([...games, games[0]]), /Duplicate/);
});

const archiveGame = { date: '2023-01-01', season: '2022', playoff: '', team1: 'OAK', team2: 'LAR', qb1: 'Actual Starter', qb2: 'Other QB', score1: '10', score2: '7' };
const scheduledGame = (patch = {}) => ({ game_id: '2023_01_LAR_LV', gameday: '2023-09-10', season: '2023', week: '1', game_type: 'REG', home_team: 'LV', away_team: 'LA', home_score: '20', away_score: '10', home_qb_id: 'backup', home_qb_name: 'Most Passes', away_qb_id: 'other', away_qb_name: 'Other QB', ...patch });
test('uses verified starters rather than primary passers, joins the archive at 2023, and keeps franchise aliases', () => {
  const modern = scheduledGame();
  const flags = new Map([[`${modern.game_id}:LV`, { playerId: 'starter', name: 'Actual Starter' }], [`${modern.game_id}:LA`, { playerId: 'other', name: 'Other QB' }]]);
  const older = scheduledGame({ game_id: '2022_17_LAR_LV', gameday: '2023-01-01', season: '2022', home_qb_id: 'starter', home_qb_name: 'Actual Starter' });
  const games = readStartingHistory([archiveGame], [older, modern, scheduledGame({ gameday: '2024-01-01' }), scheduledGame({ game_type: 'WC' })], '2023-09-10', flags);
  const streak = historicalStartingStreaks(games).find(row => row.team === 'LV');
  assert.equal(streak.playerId, 'starter'); assert.equal(streak.length, 2);
  assert.equal(streak.start.id, older.game_id); assert.equal(streak.last.id, modern.game_id);
  assert.throws(() => readStartingHistory([archiveGame], [modern], '2023-09-10'), /Unverified QB starter/);
  assert.throws(() => readStartingHistory([{ ...archiveGame, qb1: '' }], [], '2023-09-10'), /Incomplete/);
  assert.throws(() => readStartingHistory([archiveGame, archiveGame], [], '2023-09-10'), /Duplicate/);
});

test('franchise leaderboards use each QB’s best run and competition ranks independently for each team', () => {
  const runs = [
    { ...game('2000-09-03', 'BUF', 'A'), start: game('2000-09-03', 'BUF', 'A').game, length: 10 },
    { ...game('2002-09-08', 'BUF', 'A'), start: game('2002-09-08', 'BUF', 'A').game, length: 10 },
    { ...game('2003-09-07', 'BUF', 'B'), start: game('2003-09-07', 'BUF', 'B').game, length: 10 },
    { ...game('2004-09-12', 'BUF', 'C'), start: game('2004-09-12', 'BUF', 'C').game, length: 5 },
    { ...game('2004-09-12', 'NE', 'A'), start: game('2004-09-12', 'NE', 'A').game, length: 8 },
  ];
  const leaders = franchiseStartingLeaders(runs);
  assert.deepEqual(leaders.filter(row => row.team === 'BUF').map(row => row.rank), [1, 1, 3]);
  assert.equal(leaders.find(row => row.team === 'NE').rank, 1);
  assert.equal(leaders.find(row => row.team === 'BUF' && row.playerId === 'A').start.date, '2000-09-03');
  assert.deepEqual(rankedStartingStreaks(runs).map(row => row.rank), [1, 1, 1, 4, 5]);
  assert.equal(runs[0].rank, undefined);
});

test('published history preserves known records, all 32 franchise leaderboards and verified current runs', async () => {
  const data = JSON.parse(await readFile(new URL('../data/qbs.json', import.meta.url), 'utf8'));
  assert.ok(validStartingHistory(data.history));
  assert.equal(data.history.through, data.through);
  for (const [name, team, length] of [['Brett Favre', 'GB', 253], ['Philip Rivers', 'LAC', 224], ['Eli Manning', 'NYG', 210], ['Peyton Manning', 'IND', 208], ['Ron Jaworski', 'PHI', 116], ['Tom Brady', 'NE', 112]]) {
    assert.equal(Math.max(...data.history.streaks.filter(row => row.name === name && row.team === team).map(row => row.length)), length, `${name}: official starts must survive rest/relief appearances`);
  }
  const leaders = franchiseStartingLeaders(data.history.streaks);
  assert.deepEqual([...new Set(leaders.map(row => row.team))].sort(), Object.keys(TEAMS).sort());
  assert.equal(new Set(leaders.map(row => `${row.team}:${row.playerId}`)).size, leaders.length);
  assert.equal(new Set(leaders.filter(row => row.rank === 1).map(row => row.team)).size, 32);
  for (const current of data.starts) {
    const run = data.history.streaks.find(row => row.team === current.team && row.playerId === current.id && row.active);
    assert.equal(run?.length, current.length, current.team);
  }
  assert.equal(validStartingHistory({ ...data.history, streaks: [] }), false);
  const corrupt = structuredClone(data.history); corrupt.streaks[0].last.opponent = 'UNKNOWN';
  assert.equal(validStartingHistory(corrupt), false);
});
