import test from 'node:test';
import assert from 'node:assert/strict';
import { streakPosition, playerStreakContext, streakHolder } from './streak-context.mjs';

const row = (id, length, extra = {}) => ({ id, length, playerId: id, last: { game: id }, ...extra });
test('competition ranks share ties and next-value projections replace the current run', () => {
  const subject = row('subject', 10), pool = [row('leader', 11), subject, row('tie', 10), row('short', 8)];
  const place = streakPosition(subject, pool, { scope: 'NFL', coverage: '1950+' });
  assert.deepEqual([place.rank, place.tied, place.record], [2, true, 11]);
  assert.deepEqual(place.next, { rank: 1, tied: true });
  const first = streakPosition(row('leader', 11), pool);
  assert.deepEqual(first.next, { rank: 1, tied: false });
  assert.equal(subject.rank, undefined);
});
test('rank pools can extend beyond a displayed top 100 and carry coverage limits', () => {
  const subject = row('subject', 50), pool = [...Array.from({ length: 130 }, (_, i) => row(String(i), 51)), subject];
  const place = streakPosition(subject, pool, { scope: 'Recorded NFL', coverage: '1999+', partial: true });
  assert.equal(place.rank, 131); assert.equal(place.next.rank, 1); assert.equal(place.next.tied, true);
  assert.equal(place.partial, true); assert.equal(place.coverage, '1999+');
});
test('career and franchise comparisons use different lengths for multi-team runs', () => {
  const subject = row('career', 100, { playerId: 'p', last: { game: 'last' } });
  const club = row('club', 4, { playerId: 'p', teams: ['BUF'], last: { game: 'last' } });
  const context = playerStreakContext(subject, [row('global-record', 110), subject],
    [row('club-record', 20, { teams: ['BUF'] }), club, row('other-team', 40, { teams: ['MIA'] })], 'BUF', '1999+');
  assert.equal(context.overall.length, 100); assert.equal(context.overall.rank, 2);
  assert.equal(context.franchise.length, 4); assert.equal(context.franchise.rank, 2); assert.equal(context.franchise.record, 20);
  assert.equal(playerStreakContext(subject, [subject], [club], 'NYJ', '1999+').franchise, null);
});
test('kick points within the same game are distinguished and lower bounds remain explicit', () => {
  const subject = row('overall', 22, { playerId: 'p', lowerBound: true, last: { game: 'last', play: 99 } });
  const wrong = row('wrong', 40, { playerId: 'p', teams: ['BUF'], last: { game: 'last', play: 10 } });
  const correct = row('right', 2, { playerId: 'p', teams: ['BUF'], last: { game: 'last', play: 99 } });
  const context = playerStreakContext(subject, [subject], [wrong, correct], 'BUF', '1999+');
  assert.equal(context.franchise.length, 2); assert.equal(context.franchise.rank, 2); assert.equal(context.overall.lowerBound, true);
});
test('next higher means the nearest strictly longer run and retains every tied holder', () => {
  const subject = row('subject', 87), tied = row('same-length', 87);
  const pool = [row('record', 120, { name: 'Record Holder' }), row('farther', 89), row('b', 88, { name: 'B' }), row('a', 88, { name: 'A' }), tied, subject];
  const context = streakPosition(subject, pool);
  assert.equal(context.nextHigher.length, 88); assert.equal(context.nextHigher.rank, 3);
  assert.deepEqual(context.nextHigher.holders.map(h => h.name), ['A', 'B']);
  assert.equal(context.record, 120); assert.equal(context.recordHolders[0].name, 'Record Holder');
  assert.ok(!context.nextHigher.holders.some(h => h.id === tied.id));
});
test('a record-holder has no strictly higher target and retains current and tied record holders', () => {
  const subject = row('subject', 10, { name: 'Active Player', active: true, start: { season: 2020 }, last: { season: 2026 }, teams: ['BUF'] });
  const context = streakPosition(subject, [subject, row('other', 10, { name: 'Earlier Player', start: { season: 1995 }, last: { season: 2000 } })]);
  assert.equal(context.nextHigher, null);
  assert.deepEqual(context.recordHolders.map(h => [h.name, h.years, h.active]), [['Active Player', '2020–2026', true], ['Earlier Player', '1995–2000', false]]);
  assert.deepEqual(context.recordHolders[0].teams, ['BUF']);
});
test('holder years use NFL seasons, including January games belonging to the prior season', () => {
  const january = row('kick', 22, { name: 'Kicker', start: { date: '2025-11-01', game: '2025_09_BUF_MIA' }, last: { date: '2026-01-04', game: '2025_18_MIA_BUF' } });
  assert.equal(streakHolder(january).years, '2025');
  assert.equal(streakHolder({ ...january, last: { date: '2026-01-04', season: 2025 } }).lastSeason, 2025);
  const team = streakHolder(row('team', 5, { name: 'Bills', team: 'BUF', opponent: 'MIA', start: { season: 2025 }, last: { season: 2026 } }));
  assert.equal(team.years, '2025–2026'); assert.equal(team.opponent, 'MIA'); assert.deepEqual(team.teams, ['BUF']);
});
test('documented archive years are retained without inventing unverified endpoints', () => {
  const documented = streakHolder(row('archive', 94, { name: 'Gary Anderson', period: '1998 season', start: { date: null }, last: { date: '1999-01-01' }, lowerBound: true }));
  assert.equal(documented.years, '1998'); assert.equal(documented.lowerBound, true);
  const earlier = streakHolder(row('rice', 274, { name: 'Jerry Rice', start: { season: 1985, date: null }, last: { season: 2004, date: null } }));
  assert.equal(earlier.years, '1985–2004');
  assert.equal(streakHolder(row('unknown', 10)).years, 'Years unverified');
  assert.equal(streakHolder(row('only-end', 10, { last: { season: 1998 } })).years, 'Through 1998; start unverified');
});
