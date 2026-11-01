import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchWeek, teamWatchEvents, playerWatchEvents, postseasonWatchEvents, validWatchSnapshot, droughtLength } from './what-to-watch-data.mjs';

const game = (id, date, patch = {}) => ({ id, date, season: 2026, type: 'REG', week: 8, home: 'BUF', away: 'MIA', homeScore: 24, awayScore: 10, location: 'Home', completed: true, ...patch });
const run = (n, patch = {}) => Array.from({ length: n }, (_, i) => game(`g${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, patch));
const upcoming = game('next', '2026-11-01', { completed: false, homeScore: null, awayScore: null });
const emptyFeeds = () => ({ qbs: { starts: [], history: { streaks: [], through: '2026-10-31' }, through: '2026-10-31' }, receiving: { watchStreaks: [], through: '2026-10-31' }, kicking: { views: { fg: [], all: [] }, through: '2026-10-31' } });
const player = (patch = {}) => ({ id: 'p:run', playerId: 'p', name: 'Test Player', length: 50, start: { date: '2020-09-13', season: 2020, game: 'old', team: 'BUF' }, last: { date: '2026-10-25', game: 'last', team: 'BUF' }, active: true, ...patch });

test('weekly grouping retains Thursday-to-Monday bounds but watches only remaining games', () => {
  const thursday = game('thu', '2026-10-29');
  const monday = game('mon', '2026-11-02', { ...upcoming, id: 'mon', date: '2026-11-02', home: 'CHI', away: 'SEA' });
  const later = game('later', '2026-11-05', { ...upcoming, id: 'later', date: '2026-11-05', week: 9 });
  const week = watchWeek([later, monday, upcoming, thursday], 2026);
  assert.equal(week.week, 8); assert.equal(week.start, '2026-10-29'); assert.equal(week.end, '2026-11-02');
  assert.deepEqual(week.games.map(g => g.id), ['next', 'mon']);
  assert.equal(watchWeek([thursday], 2026), null);
});
test('five-game thresholds, first pending game and cross-season carries are exact', () => {
  const old = run(5, { season: 2025 }), games = [...old, upcoming];
  const { watch, ended } = teamWatchEvents(games, 2026, [upcoming]);
  assert.ok(watch.some(e => e.team === 'BUF' && e.title === 'Bills: 5 straight wins'));
  assert.ok(watch.some(e => e.team === 'MIA' && e.title === 'Dolphins: 5 straight losses'));
  assert.equal(ended.length, 0);
  assert.equal(teamWatchEvents([...run(4), upcoming], 2026, [upcoming]).watch.length, 0);
  assert.deepEqual(teamWatchEvents(games, 2026, [upcoming]), { watch, ended });
});
test('a loss ends a winning run and a win ends a losing run, with the ending game and score', () => {
  const final = game('final', '2026-10-25', { homeScore: 3, awayScore: 14 });
  const { ended } = teamWatchEvents([...run(5), final], 2026);
  const bills = ended.find(e => e.title === 'Bills: 5 straight wins');
  assert.equal(bills.game, 'final'); assert.equal(bills.date, '2026-10-25'); assert.equal(bills.result, 'Dolphins 14, Bills 3');
  assert.ok(ended.some(e => e.title === 'Dolphins: 5 straight losses'));
});
test('droughts include elapsed time to the scheduled or actual ending game', () => {
  const d = droughtLength('2003-10-05', '2026-11-01', { count: 22, unit: 'meetings', anchor: 'since last win' });
  assert.equal(d.elapsed, '23 years'); assert.equal(d.days, 8428); assert.equal(d.count, 22);
  const win = game('win', '2025-12-01', { season: 2025, homeScore: 3, awayScore: 24 });
  const { watch } = teamWatchEvents([win, ...run(5), upcoming], 2026, [upcoming]);
  const matchup = watch.find(e => e.title === 'Dolphins: 5 games without a win against the Bills');
  assert.equal(matchup.drought.since, '2025-12-01'); assert.equal(matchup.drought.elapsed, '11 months');
  assert.equal(matchup.drought.lowerBound, false);
  const unknown = teamWatchEvents([...run(5), upcoming], 2026, [upcoming]).watch.find(e => e.category === 'matchup');
  assert.equal(unknown.drought.lowerBound, true); assert.equal(unknown.drought.since, '2026-09-01');
});
test('team ranks compare maximal historical runs and preserve venue scope', () => {
  const first = run(7), loss = game('loss', '2026-09-10', { homeScore: 3, awayScore: 24 });
  const second = run(5).map((g, i) => ({ ...g, id: `second${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  const { watch, ended } = teamWatchEvents([...first, loss, ...second, upcoming], 2026, [upcoming]);
  const active = watch.find(e => e.title === 'Bills: 5 straight wins');
  assert.equal(active.leaderboard.franchise.rank, 2); assert.equal(active.leaderboard.franchise.record, 7);
  assert.equal(active.leaderboard.franchise.length, 5); assert.equal(active.leaderboard.franchise.next.rank, 2);
  assert.equal(active.leaderboard.franchise.nextHigher.length, 7);
  assert.equal(active.leaderboard.franchise.recordHolders[0].name, 'Bills');
  assert.equal(active.leaderboard.franchise.recordHolders[0].years, '2026');
  assert.equal(active.leaderboard.franchise.recordHolders[0].active, false);
  assert.equal(ended.find(e => e.title === 'Bills: 7 straight wins').leaderboard.franchise.rank, 1);
  assert.match(watch.find(e => e.title.endsWith('wins at home')).leaderboard.overall.coverage, /1999/);
});
test('QB rank projections exclude the active history row even when the roster uses a different ID', () => {
  const feeds = emptyFeeds();
  const active = player({ id: 'history-id', playerId: 'p', team: 'BUF', length: 16 });
  feeds.qbs.history.streaks = [active, { ...active, id: 'other', playerId: 'q', length: 17 }];
  feeds.qbs.starts = [{ ...active, id: 'p', playerId: undefined }];
  const event = playerWatchEvents([upcoming], 2026, [upcoming], feeds).watch[0];
  assert.equal(event.leaderboard.franchise.rank, 2); assert.equal(event.leaderboard.franchise.tied, false);
  assert.deepEqual(event.leaderboard.franchise.next, { rank: 1, tied: true });
});
test('ties end strict wins and losses while preserving matchup and overall winless droughts', () => {
  const tie = game('tie', '2026-10-25', { homeScore: 10, awayScore: 10 });
  const { watch, ended } = teamWatchEvents([...run(5), tie, upcoming], 2026, [upcoming]);
  assert.ok(ended.some(e => e.title === 'Bills: 5 straight wins'));
  assert.ok(ended.some(e => e.title === 'Dolphins: 5 straight losses'));
  assert.ok(!ended.some(e => e.category === 'matchup'));
  assert.ok(watch.some(e => e.title === 'Dolphins: 6 games without a win'));
  assert.ok(watch.some(e => e.title === 'Dolphins: 6 games without a win against the Bills'));
});
test('neutral sites do not enter venue runs and do count in overall and matchup runs', () => {
  const neutral = game('neutral', '2026-10-25', { location: 'Neutral' });
  const { watch } = teamWatchEvents([...run(5), neutral, upcoming], 2026, [upcoming]);
  assert.ok(watch.some(e => e.title === 'Bills: 6 straight wins'));
  assert.ok(watch.some(e => e.title === 'Bills: 5 straight wins at home'));
  const neutralNext = { ...upcoming, location: 'Neutral' };
  assert.ok(!teamWatchEvents([...run(5), neutralNext], 2026, [neutralNext]).watch.some(e => /at home|on the road/.test(e.title)));
});
test('byes and future weeks are absent and scheduled games never increase a streak', () => {
  const other = { ...upcoming, id: 'other', home: 'CHI', away: 'GB' };
  assert.equal(teamWatchEvents([...run(5), upcoming, other], 2026, [other]).watch.length, 0);
  const farther = { ...upcoming, id: 'farther', date: '2026-11-08', week: 9 };
  const { watch } = teamWatchEvents([...run(5), upcoming, farther], 2026, [upcoming]);
  assert.ok(watch.every(e => e.game === 'next' && e.value === 5));
});
test('five-win milestone watches require four wins and a verified decade-long wait', () => {
  const old = run(5, { season: 2010 }).map((g, i) => ({ ...g, id: `old${i}`, date: `2010-09-${String(i + 1).padStart(2, '0')}` }));
  const loss = game('loss', '2026-08-30', { homeScore: 3, awayScore: 10 });
  const games = [...old, loss, ...run(4), upcoming];
  const watch = teamWatchEvents(games, 2026, [upcoming]).watch.find(e => e.id.includes('five-win-drought'));
  assert.equal(watch.title, 'Bills: a first five-win run since 2010');
  const final = { ...upcoming, completed: true, homeScore: 24, awayScore: 10 };
  assert.ok(teamWatchEvents([...games.slice(0, -1), final], 2026).ended.some(e => e.id.includes('five-win-drought')));
  assert.ok(!teamWatchEvents([...run(4), upcoming], 2026, [upcoming]).watch.some(e => e.id.includes('five-win-drought')));
});
test('historical overall runs bridge the archive while matchup coverage does not invent older venue results', () => {
  const old = run(5).map((g, i) => ({ ...g, id: `old${i}`, season: 1998, date: `1998-09-${String(i + 1).padStart(2, '0')}` }));
  const { watch } = teamWatchEvents([upcoming], 2026, [upcoming], { BUF: old });
  assert.equal(watch.length, 1); assert.equal(watch[0].title, 'Bills: 5 straight wins');
});
test('receiving watches include runs outside the top 100, use current rosters and are conditional on appearances', () => {
  const feeds = emptyFeeds(); feeds.receiving.watchStreaks = [player()]; feeds.currentTeams = new Map([['p', 'MIA']]);
  const { watch } = playerWatchEvents([upcoming], 2026, [upcoming], feeds);
  assert.equal(watch.length, 1); assert.equal(watch[0].team, 'MIA'); assert.match(watch[0].action, /missed games do not/);
  assert.equal(playerWatchEvents([upcoming], 2026, [], feeds).watch.length, 0);
});
test('player watches wait for missing game data rather than displaying an unverified active count', () => {
  const feeds = emptyFeeds(); feeds.receiving.watchStreaks = [player()]; feeds.receiving.through = '2026-10-24';
  const final = game('last', '2026-10-25');
  assert.equal(playerWatchEvents([final, upcoming], 2026, [upcoming], feeds).watch.length, 0);
  feeds.receiving.through = '2026-10-25';
  assert.equal(playerWatchEvents([final, upcoming], 2026, [upcoming], feeds).watch.length, 1);
});
test('QB endings are dated to the next verified starter, including a run last played the previous season', () => {
  const feeds = emptyFeeds(), start = { id: 'next', date: '2026-11-01', season: 2026 };
  feeds.qbs.history.streaks = [{ ...player({ team: 'BUF', length: 16, active: false }), last: { date: '2026-01-01', season: 2025 } },
    player({ id: 'replacement', playerId: 'r', team: 'BUF', name: 'Replacement QB', length: 1, start })];
  const final = { ...upcoming, completed: true, homeScore: 24, awayScore: 10 };
  const { ended } = playerWatchEvents([final], 2026, [], feeds);
  assert.equal(ended.length, 1); assert.equal(ended[0].game, 'next'); assert.match(ended[0].action, /Replacement QB started/);
});
test('kicking endings use the game lookup, not a missing season field on kick points', () => {
  const feeds = emptyFeeds();
  feeds.kicking.views.fg = [player({ length: 20, active: false, endedBy: { game: 'next', team: 'BUF', distance: 52, type: 'FG', result: 'blocked' } })];
  const { ended } = playerWatchEvents([{ ...upcoming, completed: true, homeScore: 24, awayScore: 10 }], 2026, [], feeds);
  assert.equal(ended.length, 1); assert.match(ended[0].action, /52-yard field goal was blocked/);
});
test('censored player runs are excluded rather than presented as verified endings', () => {
  const feeds = emptyFeeds(); feeds.receiving.watchStreaks = [player({ gapAfter: { date: '2026-10-26' } }), player({ id: 'short', length: 49 })];
  assert.equal(playerWatchEvents([upcoming], 2026, [upcoming], feeds).watch.length, 0);
});
test('postseason droughts require the correct round and do not appear in regular-season games', () => {
  const baseline = { BUF: { playoffs: 2019, playoffWin: 2018, conference: 1993, superBowl: null } };
  assert.equal(postseasonWatchEvents([upcoming], 2026, [upcoming], baseline).watch.length, 0);
  const wildCard = { ...upcoming, type: 'WC', week: 19, date: '2027-01-17' };
  const watches = postseasonWatchEvents([wildCard], 2026, [wildCard], baseline).watch;
  assert.equal(watches.length, 2); assert.ok(!watches.some(e => /conference|Super Bowl/.test(e.title)));
  const conference = { ...wildCard, type: 'CON' };
  assert.ok(postseasonWatchEvents([conference], 2026, [conference], baseline).watch.some(e => /conference title/.test(e.title)));
  assert.deepEqual(baseline.BUF, { playoffs: 2019, playoffWin: 2018, conference: 1993, superBowl: null });
});
test('postseason droughts end only on an appearance or win and are recorded once per season', () => {
  const baseline = { BUF: { playoffs: 2010, playoffWin: 2010 } };
  const wc = game('wc', '2027-01-17', { type: 'WC', week: 19 });
  const div = game('div', '2027-01-24', { type: 'DIV', week: 20 });
  assert.equal(postseasonWatchEvents([wc, div], 2026, [], baseline).ended.length, 2);
  const loss = { ...wc, homeScore: 3, awayScore: 14 };
  const ended = postseasonWatchEvents([loss], 2026, [], baseline).ended;
  assert.equal(ended.length, 1); assert.match(ended[0].title, /playoff appearance/);
});
test('postseason elapsed time uses the verified achievement date without inventing old dates', () => {
  const prior = game('old-postseason', '2020-01-12', { season: 2019, type: 'DIV' });
  const wc = game('wc', '2027-01-17', { type: 'WC', week: 19 });
  const baseline = { BUF: { playoffs: 2019, playoffWin: 2019, superBowl: null } };
  const ended = postseasonWatchEvents([prior, wc], 2026, [], baseline).ended;
  assert.equal(ended[0].drought.count, 6); assert.equal(ended[0].drought.since, '2020-01-12'); assert.equal(ended[0].drought.elapsed, '7 years');
  const sb = { ...upcoming, type: 'SB', date: '2027-02-14' };
  const never = postseasonWatchEvents([sb], 2026, [sb], baseline).watch.find(e => /Super Bowl/.test(e.title));
  assert.equal(never.drought.never, true); assert.equal(never.drought.since, undefined);
});
test('snapshot validates subject clubs, season, unique events, results and scheduled watches', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/what-to-watch.json', import.meta.url)));
  assert.ok(validWatchSnapshot(saved));
  const games = [...run(5), game('final', '2026-10-25', { homeScore: 3, awayScore: 24 }), upcoming];
  const { ended } = teamWatchEvents(games, 2026);
  const { watch } = teamWatchEvents([...run(5), upcoming], 2026, [upcoming]);
  const snapshot = { schemaVersion: 1, season: 2026, through: '2026-10-25', games, watch, ended,
    week: watchWeek(games, 2026), coverage: { qbs: '2026-10-25', receiving: '2026-10-25', kicking: '2026-10-25' } };
  assert.ok(validWatchSnapshot(snapshot));
  assert.ok(validWatchSnapshot({ ...snapshot, week: null, watch: [] }));
  for (const mutate of [d => d.watch.push(d.watch[0]), d => { d.watch[0].team = 'INVALID'; },
    d => { d.watch[0].game = 'missing'; }, d => { d.ended[0].season--; },
    d => { d.games.find(g => g.id === d.watch[0].game).completed = true; },
    d => { d.watch[0].href = 'javascript:alert(1)'; }, d => { d.watch[0].date = 'not-a-date'; },
    d => { d.watch[0].leaderboard.franchise.rank = 0; },
    d => { d.watch[0].leaderboard.franchise.recordHolders[0].name = ''; },
    d => { d.watch[0].leaderboard.overall.nextHigher = { length: d.watch[0].leaderboard.overall.length, rank: 1, holders: [] }; },
    d => { d.watch.find(e => e.drought).drought.days = -1; }]) {
    const changed = structuredClone(snapshot); mutate(changed); assert.equal(validWatchSnapshot(changed), false);
  }
});
