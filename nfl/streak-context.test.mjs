import test from 'node:test';
import assert from 'node:assert/strict';
import { streakPosition, playerStreakContext } from './streak-context.mjs';

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
