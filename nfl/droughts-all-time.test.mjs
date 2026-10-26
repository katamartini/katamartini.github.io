import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateWinStreakDroughts, calculateLossStreakDroughts, daysBetween,
  allTimeDroughtsFromHash, droughtViewFromHash, streakDroughtHash,
  winThresholdFromHash, lossThresholdFromHash, validAllTimeDroughts,
  WIN_STREAK_THRESHOLDS, LOSS_STREAK_THRESHOLDS, ALL_TIME_DROUGHT_LIMIT } from './droughts-data.mjs';

function games(results, team = 'MIN', season = 2026) {
  return [...results].map((result, i) => ({ id: `g${i}`, season, type: 'REG', week: i + 1,
    date: new Date(Date.UTC(season, 8, 1 + i * 7)).toISOString().slice(0, 10),
    home: team, away: 'GB', homeScore: result === 'W' ? 20 : result === 'L' ? 0 : 10,
    awayScore: 10, completed: true }));
}
const teamRows = (view, team = 'MIN') => view.allTime.filter(row => row.team === team);

test('separate ended droughts and the ongoing gap count games before, not including, the ending qualifier', () => {
  const input = games('WWWLWWWLWWWLL');
  const view = calculateWinStreakDroughts(input, {}, 3);
  const rows = teamRows(view);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.gamesSince), [3, 3, 2]);
  assert.equal(rows[0].start.date, input[2].date);
  assert.equal(rows[0].end.date, input[6].date);
  assert.equal(rows[1].start.date, input[6].date);
  assert.equal(rows[1].end.date, input[10].date);
  assert.equal(rows[2].ongoing, true);
  assert.equal(rows[2].end, null);
  assert.equal(rows[2].gamesSince, view.teams.find(row => row.team === 'MIN').gamesSince);
  assert.equal(validAllTimeDroughts(view), true);
});

test('more than 50 droughts are truncated to the 50 longest with deterministic tie ordering', () => {
  const input = games('WWWL'.repeat(80));
  const view = calculateWinStreakDroughts(input, {}, 3);
  assert.equal(view.allTime.length, 50);
  assert.equal(validAllTimeDroughts(view), true);
  assert.ok(view.allTime.every(row => row.team === 'MIN' && row.gamesSince === 3));
  assert.equal(view.allTime[0].start.date, input[2].date);
  assert.equal(view.allTime[49].start.date, input[2 + 49 * 4].date);
});

test('each extra qualifying win resets the start; zero-game droughts are not leaderboard entries', () => {
  const input = games('WWWWWLWWW');
  const rows = teamRows(calculateWinStreakDroughts(input, {}, 3));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start.date, input[4].date);
  assert.equal(rows[0].gamesSince, 3);
  assert.equal(rows[0].end.date, input[8].date);
});

test('initial and never-ended droughts start at franchise debut, but partial-history boundaries are excluded', () => {
  const input = games('LLWW', 'HOU', 2002);
  const initial = teamRows(calculateWinStreakDroughts(input, {}, 1), 'HOU');
  assert.equal(initial.length, 1);
  assert.equal(initial[0].fromDebut, true);
  assert.equal(initial[0].gamesSince, 2);
  assert.equal(initial[0].start.date, input[0].date);
  assert.equal(initial[0].end.date, input[2].date);
  const never = teamRows(calculateWinStreakDroughts(input, {}, 5), 'HOU')[0];
  assert.equal(never.fromDebut, true); assert.equal(never.ongoing, true); assert.equal(never.gamesSince, 4);
  assert.equal(teamRows(calculateWinStreakDroughts(games('LL', 'HOU'), {}, 5), 'HOU').length, 0);
});

test('loss droughts use losses, ties reset runs, postseason and unfinished games do not count', () => {
  const input = games('LLLTLLLWW');
  input.push({ ...input[0], id: 'post', type: 'WC', date: '2027-01-12' },
    { ...input[0], id: 'future', date: '2027-02-12', completed: false, homeScore: null });
  const view = calculateLossStreakDroughts(input, {}, 3), rows = teamRows(view);
  assert.deepEqual(rows.map(row => row.gamesSince), [3, 2]);
  assert.equal(rows[0].start.date, input[2].date);
  assert.equal(rows[0].end.date, input[6].date);
  assert.equal(view.throughDate, input[8].date);
  assert.equal(validAllTimeDroughts(view), true);
});

test('streaks and droughts carry across seasons; league as-of date adds time, not franchise games', () => {
  const input = games('WWWLW');
  input[4] = { ...input[4], season: 2027, date: '2027-09-01' };
  input.push({ ...input[0], id: 'other', season: 2027, home: 'KC', away: 'SF', date: '2027-10-01' });
  const row = teamRows(calculateWinStreakDroughts(input, {}, 3))[0];
  assert.equal(row.gamesSince, 2);
  assert.equal(row.daysSince, daysBetween(input[2].date, '2027-10-01'));
});

test('independent qualifier-index calculation agrees across all thresholds and both outcomes', () => {
  const input = games(Array.from({ length: 160 }, (_, i) => i % 31 < 25 ? 'W' : i % 31 === 25 ? 'T' : 'L').join(''));
  for (const [calculate, target, thresholds] of [[calculateWinStreakDroughts, 'W', WIN_STREAK_THRESHOLDS], [calculateLossStreakDroughts, 'L', LOSS_STREAK_THRESHOLDS]]) {
    for (const threshold of thresholds) {
      let run = 0;
      const qualifiers = [];
      input.forEach((g, i) => {
        const result = g.homeScore > g.awayScore ? 'W' : g.homeScore < g.awayScore ? 'L' : 'T';
        run = result === target ? run + 1 : 0;
        if (run >= threshold) qualifiers.push(i);
      });
      const expected = [];
      qualifiers.forEach((start, i) => {
        const end = qualifiers[i + 1];
        const count = (end ?? input.length) - start - 1;
        if (count) expected.push([count, input[start].date, end === undefined ? null : input[end].date]);
      });
      const actual = teamRows(calculate(input, {}, threshold)).map(row => [row.gamesSince, row.start.date, row.end?.date ?? null]);
      // This fixture has fewer than 20 total nonzero gaps, so no truncation.
      assert.deepEqual(actual.sort(), expected.sort());
    }
  }
});

test('every threshold has shareable all-time and current links; invalid hashes retain fallback behavior', () => {
  for (const [view, thresholds, parse] of [['win-streaks', WIN_STREAK_THRESHOLDS, winThresholdFromHash], ['loss-streaks', LOSS_STREAK_THRESHOLDS, lossThresholdFromHash]]) {
    for (const n of thresholds) for (const allTime of [false, true]) {
      const hash = streakDroughtHash(view, n, allTime);
      assert.equal(droughtViewFromHash(hash), view);
      assert.equal(parse(hash), n);
      assert.equal(allTimeDroughtsFromHash(hash), allTime);
    }
  }
  for (const hash of ['#win-streaks-24-all-time', '#loss-streaks-30-all-time', '#win-streaks-05-all-time', '#milestones-all-time']) {
    assert.equal(droughtViewFromHash(hash), 'milestones'); assert.equal(allTimeDroughtsFromHash(hash), false);
  }
});

test('all 52 published top-50 lists validate, rank by games and use known franchise history', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  for (const [root, thresholds] of [[saved.winStreaks, WIN_STREAK_THRESHOLDS], [saved.lossStreaks, LOSS_STREAK_THRESHOLDS]]) {
    for (const n of thresholds) {
      const view = n === 5 ? root : root.thresholds[n];
      assert.ok(view.allTime.length >= 20 && view.allTime.length <= ALL_TIME_DROUGHT_LIMIT);
      if (n <= 5) assert.equal(view.allTime.length, 50);
      assert.equal(validAllTimeDroughts(view), true);
      for (const row of view.allTime.filter(row => row.ongoing)) {
        const current = view.teams.find(team => team.team === row.team);
        assert.equal(row.gamesSince, current.gamesSince);
        assert.equal(row.daysSince, daysBetween(row.start.date, view.throughDate));
        assert.equal(row.fromDebut, current.last === null);
      }
    }
  }
  for (const modify of [
    view => { delete view.allTime; }, view => { view.allTime.push(view.allTime[0]); }, view => { view.allTime[0] = null; },
    view => { view.allTime[0].gamesSince = -1; }, view => { view.allTime[0].daysSince++; },
    view => { view.allTime.reverse(); }, view => { view.allTime[0].ongoing = !view.allTime[0].ongoing; },
    view => { view.allTime[1] = view.allTime[0]; },
  ]) {
    const broken = structuredClone(saved.winStreaks); modify(broken); assert.equal(validAllTimeDroughts(broken), false);
  }
});
