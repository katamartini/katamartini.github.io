import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playerWeeklyResults, qbWeeklyResults, summarizeWeeks, weeklyResult, validWeeklySummaries } from './watch-weekly.mjs';
import { teamWatchEvents, postseasonWatchEvents, WATCH_CATEGORIES } from './what-to-watch-data.mjs';

const game = (id, date, week = 1, extra = {}) => ({ id, date, season: 2026, type: 'REG', week, home: 'BUF', away: 'MIA', homeScore: 20, awayScore: 7, completed: true, location: 'Home', ...extra });
const point = (g, play, extra = {}) => ({ game: g.id, date: g.date, season: g.season, team: 'BUF', ...(play == null ? {} : { play }), ...extra });
const run = (length, start, last, extra = {}) => ({ id: 'run', playerId: 'p', name: 'Test Player', length, start, last, active: true, ...extra });
const options = { season: 2026, category: 'receiving', minimum: 50, unit: 'games', label: 'straight appearances with a catch', href: '/nfl/receiving-streaks.html', through: '2026-10-31' };
const g1 = game('g1', '2026-09-13'), g2 = game('g2', '2026-09-20', 2), g3 = game('g3', '2026-09-27', 3);

test('receiving summaries reconstruct each game length instead of copying the final season length', () => {
  const streak = run(52, { date: '2025-01-01' }, point(g3));
  const observations = [g1, g2, g3].map(g => ({ ...point(g), playerId: 'p' }));
  const results = playerWeeklyResults([streak], observations, [g1, g2, g3], options);
  assert.deepEqual(results.map(r => [r.week, r.before, r.after]), [[1, 49, 50], [2, 50, 51], [3, 51, 52]]);
  assert.equal(results[0].newlyNoteworthy, true); assert.equal(results[1].newlyNoteworthy, false);
  assert.ok(results.every(r => r.status === 'continued'));
});
test('missed appearances and byes do not become fake continuations or endings', () => {
  const streak = run(51, { date: '2025-01-01' }, point(g3));
  const results = playerWeeklyResults([streak], [g1, g3].map(g => ({ ...point(g), playerId: 'p' })), [g1, g2, g3], options);
  assert.deepEqual(results.map(r => [r.week, r.after]), [[1, 50], [3, 51]]);
});
test('a zero-catch appearance records a single ended result at its final length', () => {
  const streak = run(50, { date: '2025-01-01' }, point(g1), { active: false, endedBy: point(g2) });
  const results = playerWeeklyResults([streak], [{ ...point(g1), playerId: 'p' }], [g1, g2], options);
  assert.deepEqual(results.map(r => [r.week, r.status, r.after]), [[1, 'continued', 50], [2, 'ended', 50]]);
  assert.match(results[1].action, /zero-catch/);
});
test('kick makes followed by a miss in the same game are ended once, with the pregame and final counters', () => {
  const streak = run(22, { game: 'old', date: '2025-12-01', play: 10 }, point(g1, 2), { active: false,
    endedBy: point(g1, 3, { type: 'FG', result: 'blocked', distance: 55 }) });
  const observations = [1, 2].map(play => ({ ...point(g1, play), playerId: 'p' }));
  const results = playerWeeklyResults([streak], observations, [g1], { ...options, category: 'kicking', minimum: 20, unit: 'kicks', label: 'consecutive field goals made', href: '/nfl/kicking.html#fg' });
  assert.equal(results.length, 1); assert.deepEqual([results[0].status, results[0].before, results[0].after], ['ended', 20, 22]);
  assert.match(results[0].action, /55-yard field goal was blocked/);
});
test('separate kick runs in the same game do not share observations across their play boundaries', () => {
  const first = run(20, { game: 'old', date: '2025-12-01', play: 1 }, point(g1, 2), { endedBy: point(g1, 3, { type: 'FG', result: 'missed' }) });
  const second = run(20, point(g1, 4), point(g2, 5), { id: 'second' });
  const observations = [1, 2, 4, 5].map(play => ({ ...point(g1, play), playerId: 'p' }));
  observations.push(...Array.from({ length: 18 }, (_, i) => ({ ...point(g2, i + 1), playerId: 'p' })));
  second.last.play = 18;
  const results = playerWeeklyResults([first, second], observations, [g1, g2], { ...options, category: 'kicking', minimum: 20, unit: 'kicks' });
  assert.equal(results.find(r => r.id === 'run:g1').before, 18);
  assert.equal(results.find(r => r.id === 'second:g2').after, 20);
  assert.ok(!results.some(r => r.id === 'second:g1'));
});
test('historical player results keep that game’s team, including former or transferred players', () => {
  const streak = run(51, { date: '2025-12-01' }, point(g2), { active: false });
  const observations = [{ ...point(g1), playerId: 'p' }, { ...point(g2, null, { team: 'MIA' }), playerId: 'p' }];
  const results = playerWeeklyResults([streak], observations, [g1, g2], options);
  assert.deepEqual(results.map(r => r.team), ['BUF', 'MIA']);
});
test('unplayed games and observations beyond the player feed’s cutoff remain unclassified', () => {
  const streak = run(51, { date: '2025-01-01' }, point(g2));
  const observations = [g1, g2].map(g => ({ ...point(g), playerId: 'p' }));
  const results = playerWeeklyResults([streak], observations, [g1, g2], { ...options, through: g1.date });
  assert.equal(results.length, 0);
  assert.equal(playerWeeklyResults([streak], observations, [{ ...g1, completed: false }, { ...g2, completed: false }], options).length, 0);
});
test('QB continuations use verified starts and the length for each week', () => {
  const streak = run(18, { date: '2025-12-01' }, point(g3), { team: 'BUF' });
  const results = qbWeeklyResults([g1, g2, g3], 2026, { history: { through: g3.date, streaks: [streak] } });
  assert.deepEqual(results.map(r => [r.before, r.after]), [[15, 16], [16, 17], [17, 18]]);
  assert.equal(results[0].newlyNoteworthy, true);
});
test('team results include new threshold qualifiers and distinguish a tie’s strict and winless outcomes', () => {
  const games = Array.from({ length: 5 }, (_, i) => game(`g${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, i + 1));
  const tie = game('tie', '2026-09-10', 6, { homeScore: 7, awayScore: 7 });
  const data = teamWatchEvents([...games, tie], 2026, [], {}, true);
  assert.ok(data.continued.some(r => r.title === 'Bills: 5 straight wins' && r.newlyNoteworthy));
  assert.ok(data.ended.some(r => r.title === 'Bills: 5 straight wins'));
  assert.ok(data.continued.some(r => r.title === 'Dolphins: 6 games without a win against the Bills'));
  assert.ok(!data.continued.some(r => r.game === 'tie' && r.title.includes('straight losses')));
});
test('postseason loss keeps an eligible drought going rather than falsely ending it', () => {
  const playoff = { ...g1, type: 'WC', date: '2027-01-17' };
  const result = postseasonWatchEvents([playoff], 2026, [], { MIA: { playoffs: 2010, playoffWin: 2010 } }, true);
  assert.ok(result.ended.some(e => /appearance/.test(e.title)));
  assert.ok(result.continued.some(e => /playoff win/.test(e.title)));
});
test('weeks separate postseason rounds and distinguish pending games from delayed player feeds', () => {
  const pending = { ...g2, completed: false }, playoff = { ...g3, type: 'WC', date: '2027-01-17', week: 19 };
  const base = { id: 'e:g1', category: 'qb', kind: 'streak', team: 'BUF', title: 'QB run', unit: 'starts', href: '/nfl/QBs.html', game: g1.id, date: g1.date, season: 2026, week: 1, gameType: 'REG', value: 20, action: 'A start.' };
  const continued = weeklyResult(base, { status: 'continued', before: 19, after: 20 });
  const weeks = summarizeWeeks([g1, pending, playoff], 2026, { games: [pending] }, [continued], [], [], { qbs: '2026-09-01', receiving: '2026-10-01', kicking: '2026-10-01' });
  assert.deepEqual(weeks.map(w => w.id), ['REG-1', 'REG-2', 'WC-19']);
  assert.deepEqual(weeks[0].awaitingFeeds.qbs, ['g1']); assert.deepEqual(weeks[1].pendingGames, ['g2']);
  assert.ok(validWeeklySummaries(weeks, new Map([g1, pending, playoff].map(g => [g.id, g])), 2026, WATCH_CATEGORIES));
});
test('saved weekly summaries agree with season endings and retain game-specific lengths', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/what-to-watch.json', import.meta.url)));
  const games = new Map(saved.games.map(g => [g.id, g]));
  assert.ok(validWeeklySummaries(saved.weeks, games, saved.season, WATCH_CATEGORIES));
  assert.equal(saved.weeks.flatMap(w => w.events).filter(e => e.status === 'ended').length, saved.ended.length);
  for (const change of [d => d[0].counts.continued++, d => { d[0].events[0].after = -1; }, d => { d[0].events[0].status = 'pending'; }, d => { d[0].events.push(d[0].events[0]); }]) {
    const invalid = structuredClone(saved.weeks); change(invalid); assert.equal(validWeeklySummaries(invalid, games, saved.season, WATCH_CATEGORIES), false);
  }
});
