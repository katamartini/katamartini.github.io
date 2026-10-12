import test from 'node:test';
import assert from 'node:assert/strict';
import { DIVISIONS } from './divstreaks-data.mjs';
import { calculateDroughts, divisionWinners, latestCompletedSeason, readGames, seasonsSince,
  calculateWinStreakDroughts, droughtViewFromHash, daysBetween, elapsedTime,
  WIN_STREAK_THRESHOLDS, winThresholdFromHash, winStreakState, validWinStreakView } from './droughts-data.mjs';
import { WIN_STREAK_HISTORY } from './droughts-history.mjs';
import { readFileSync } from 'node:fs';

const header = 'game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location';
const game = (season, type, date, away, awayScore, home, homeScore) =>
  ['id', season, type, 1, date, 'Sunday', '13:00', away, awayScore, home, homeScore, 'Home'].join(',');
const fixtures = () => [header,
  game(2024, 'CON', '2025-01-26', 'BUF', 29, 'KC', 32),
  game(2024, 'SB', '2025-02-09', 'KC', 22, 'PHI', 40),
  game(2025, 'WC', '2026-01-10', 'GB', 27, 'CHI', 31),
  game(2025, 'CON', '2026-01-25', 'LA', 27, 'SEA', 31),
  game(2025, 'SB', '2026-02-08', 'SEA', 29, 'NE', 13),
  game(2026, 'REG', '2026-09-10', 'SF', 27, 'LA', 7),
  game(2026, 'SB', '2027-02-14', 'KC', '', 'SEA', ''),
].join('\n');

test('milestones use season years and both Super Bowl teams won a conference title', () => {
  const data = calculateDroughts(readGames(fixtures()));
  assert.equal(data.throughSeason, 2025);
  assert.equal(data.currentSeason, 2026);
  assert.equal(data.teams.length, 32);
  const find = team => data.teams.find(row => row.team === team).last;
  assert.equal(find('SEA').superBowl, 2025);
  assert.equal(find('SEA').conference, 2025);
  assert.equal(find('NE').conference, 2025);
  assert.equal(find('NE').superBowl, null); // No Patriots SB win in this fixture.
  assert.equal(find('CHI').playoffWin, 2025);
  assert.equal(find('GB').playoffs, 2025);
  assert.equal(find('GB').playoffWin, null);
  assert.equal(find('LA').conference, 1979); // Appearing in CON does not win it.
  assert.equal(find('SF').superBowl, 1994);
  assert.equal(find('NYJ').conference, 1968);
  assert.equal(find('CLE').conference, null);
});

test('an unfinished season cannot change completed-season droughts', () => {
  const csv = `${fixtures()}\n${game(2026, 'WC', '2027-01-10', 'KC', 30, 'BUF', 20)}`;
  const data = calculateDroughts(readGames(csv));
  assert.equal(data.teams.find(row => row.team === 'KC').last.playoffWin, 2024);
  assert.equal(latestCompletedSeason(readGames(csv)), 2025);
});

test('never and elapsed droughts count active seasons, including expansion and the Browns hiatus', () => {
  assert.equal(seasonsSince('SEA', 2025, 2025), 0);
  assert.equal(seasonsSince('DAL', 1995, 2025), 30);
  assert.equal(seasonsSince('CLE', 1989, 2025), 33);
  assert.equal(seasonsSince('CLE', null, 2025), 57);
  assert.equal(seasonsSince('DET', null, 2025), 60);
  assert.equal(seasonsSince('HOU', null, 2025), 24);
  assert.equal(seasonsSince('JAX', null, 2025), 31);
  assert.equal(seasonsSince('CIN', null, 2025), 58);
});

test('relocated franchises retain playoff results under their current identities', () => {
  const csv = [fixtures(),
    game(2024, 'WC', '2025-01-11', 'SD', 24, 'OAK', 10),
    game(2024, 'DIV', '2025-01-18', 'STL', 14, 'WSH', 21),
  ].join('\n');
  const data = calculateDroughts(readGames(csv));
  assert.equal(data.teams.find(row => row.team === 'LAC').last.playoffWin, 2024);
  assert.equal(data.teams.find(row => row.team === 'LV').last.playoffs, 2024);
  assert.equal(data.teams.find(row => row.team === 'LA').last.playoffs, 2025);
  assert.equal(data.teams.find(row => row.team === 'WAS').last.playoffWin, 2024);
});

function standingsFixture() {
  return { children: [{ children: DIVISIONS.map((division, index) => ({
    name: division.name,
    standings: {
      season: 2025, seasonType: 2,
      entries: division.teams.map((team, i) => ({
        team: { abbreviation: team === 'LA' ? 'LAR' : team },
        stats: [{ name: 'playoffSeed', value: i === 2 ? index % 4 + 1 : i + 5 }],
      })),
    },
  })) }] };
}

test('division champions follow final playoff seeds, not entry order or win-total ties', () => {
  assert.deepEqual(divisionWinners(standingsFixture(), 2025), DIVISIONS.map(division => division.teams[2]));
  assert.throws(() => divisionWinners(standingsFixture(), 2026), /Incomplete/);
  const duplicate = standingsFixture();
  duplicate.children[0].children[0].standings.entries[0].stats[0].value = 1;
  assert.throws(() => divisionWinners(duplicate, 2025), /unique division champion/);
});

test('malformed or unfinished championship data fails rather than inventing a completed season', () => {
  assert.throws(() => readGames('bad,data'), /Unexpected/);
  assert.throws(() => latestCompletedSeason(readGames([header,
    game(2026, 'SB', '2027-02-14', 'KC', '', 'SEA', ''),
  ].join('\n'))), /No completed Super Bowl/);
  assert.throws(() => calculateDroughts(readGames([header,
    game(2025, 'SB', '2026-02-08', 'SEA', 13, 'NE', 13),
  ].join('\n'))), /Tied postseason/);
});

function winningGames(count = 5) {
  return Array.from({ length: count }, (_, i) => ({ id: `g${i}`, season: 2026, type: 'REG', week: i + 1,
    date: `2026-09-${String(i * 3 + 1).padStart(2, '0')}`, away: 'GB', home: 'MIN', awayScore: 10, homeScore: 20, completed: true }));
}
const streakFor = (games, team = 'MIN', history = {}) => calculateWinStreakDroughts(games, history).teams.find(r => r.team === team);

test('five wins qualify exactly; longer runs keep resetting the drought', () => {
  assert.equal(streakFor(winningGames(4)).last, null);
  const five = streakFor(winningGames(5)); assert.equal(five.last.date, '2026-09-13'); assert.equal(five.gamesSince, 0); assert.equal(five.currentWins, 5);
  const seven = streakFor(winningGames(7)); assert.equal(seven.last.date, '2026-09-19'); assert.equal(seven.last.wins, 7); assert.equal(seven.gamesSince, 0);
});
test('losses and ties break runs and count as games since the last qualifying win', () => {
  const games = winningGames(7); games[5].homeScore = 5; games[6].homeScore = 10;
  const row = streakFor(games); assert.equal(row.gamesSince, 2); assert.equal(row.currentWins, 0); assert.equal(row.daysSince, 6); assert.equal(row.last.date, games[4].date);
});
test('offseasons and byes do not reset regular-season streaks, and playoffs do not count', () => {
  const games = winningGames(4).map(g => ({ ...g, season: 2025, date: g.date.replace('2026-09', '2025-12') }));
  games.push({ ...winningGames(1)[0], id: 'playoff-loss', type: 'WC', season: 2025, date: '2026-01-11', homeScore: 0 },
    { ...winningGames(1)[0], id: 'next-season', date: '2026-09-20', week: 2 });
  const row = streakFor(games); assert.equal(row.currentWins, 5); assert.equal(row.last.startDate, '2025-12-01'); assert.equal(row.last.season, 2026);
});
test('home and away wins are treated equally; unfinished games are excluded', () => {
  const games = winningGames(5); games[2] = { ...games[2], home: 'GB', away: 'MIN', homeScore: 10, awayScore: 20 };
  games.push({ ...games[0], id: 'future', date: '2026-10-01', completed: false, homeScore: null, awayScore: null });
  const row = streakFor(games); assert.equal(row.currentWins, 5); assert.equal(row.gamesSince, 0); assert.equal(row.last.date, '2026-09-13');
});
test('game drought counts only the franchise games, while calendar time uses the league as-of date', () => {
  const games = winningGames(5); games.push({ ...games[0], id: 'other', date: '2026-09-20', home: 'KC', away: 'SF' });
  const row = streakFor(games); assert.equal(row.gamesSince, 0); assert.equal(row.daysSince, 7);
});
test('separate runs restart the drought when the newer run reaches five', () => {
  const games = winningGames(7); games[5].homeScore = 0;
  for (let i = 0; i < 4; i++) games.push({ ...games[0], id: `oct${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, week: i + 8 });
  const row = streakFor(games); assert.equal(row.currentWins, 5); assert.equal(row.last.startDate, '2026-09-19'); assert.equal(row.gamesSince, 0);
});
test('Browns archive has their last five-win run and exactly 25 games afterward before the hiatus', () => {
  assert.equal(WIN_STREAK_HISTORY.CLE.length, 32);
  const [sample] = winningGames(1); const row = streakFor([{ ...sample, home: 'CLE', date: '1999-09-12', season: 1999, homeScore: 0 }], 'CLE', WIN_STREAK_HISTORY);
  assert.equal(row.last.date, '1994-10-23'); assert.equal(row.last.week, 8); assert.equal(row.last.wins, 5); assert.equal(row.gamesSince, 26); assert.equal(row.currentWins, 0);
});
test('historical opponent games are not silently added to their incomplete histories', () => {
  const [sample] = winningGames(1); const row = streakFor([{ ...sample, home: 'CIN' }], 'CIN', WIN_STREAK_HISTORY);
  assert.equal(row.currentWins, 1); assert.equal(row.gamesSince, 1); assert.equal(row.last, null);
});
test('invalid results, duplicate games, mixed historical schedules and empty feeds fail closed', () => {
  assert.throws(() => calculateWinStreakDroughts([]), /No completed/);
  assert.throws(() => calculateWinStreakDroughts(winningGames(), {}, 0), /threshold/);
  assert.throws(() => calculateWinStreakDroughts([...winningGames(), winningGames()[0]]), /Duplicate/);
  assert.throws(() => calculateWinStreakDroughts([{ ...winningGames()[0], homeScore: -1 }]), /Invalid/);
  assert.throws(() => calculateWinStreakDroughts(winningGames(), { MIN: WIN_STREAK_HISTORY.CLE }), /historical/);
});
test('view hashes are linkable and unknown values fall back to milestones', () => {
  assert.equal(droughtViewFromHash('#win-streaks'), 'win-streaks');
  for (const hash of ['', '#milestones', '#unknown']) assert.equal(droughtViewFromHash(hash), 'milestones');
});
test('calendar durations use UTC days and whole calendar months across leap years', () => {
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(elapsedTime('2026-10-11', '2026-10-11'), '0 days');
  assert.equal(elapsedTime('2026-10-10', '2026-10-11'), '1 day');
  assert.equal(elapsedTime('2025-09-15', '2026-10-14'), '1 year');
  assert.equal(elapsedTime('1994-10-23', '2026-10-11'), '31 years, 11 months');
});
test('saved data includes all 32 win-streak droughts without changing the milestone schema', () => {
  const data = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  assert.equal(data.teams.length, 32); assert.equal(data.winStreaks.teams.length, 32); assert.equal(data.winStreaks.threshold, 5);
  assert.equal(new Set(data.winStreaks.teams.map(r => r.team)).size, 32);
  for (const row of data.winStreaks.teams) {
    assert.ok(row.last); assert.ok(row.last.wins >= 5); assert.equal(row.daysSince, daysBetween(row.last.date, data.winStreaks.throughDate));
    if (row.currentWins >= 5) assert.equal(row.gamesSince, 0);
  }
});

test('each threshold from 5 to 10 qualifies at exactly its own number of wins', () => {
  for (const threshold of WIN_STREAK_THRESHOLDS) {
    const before = calculateWinStreakDroughts(winningGames(threshold - 1), {}, threshold).teams.find(r => r.team === 'MIN');
    assert.equal(before.last, null); assert.equal(winStreakState(before.currentWins, threshold), 'one-away');
    const at = calculateWinStreakDroughts(winningGames(threshold), {}, threshold).teams.find(r => r.team === 'MIN');
    assert.equal(at.last.wins, threshold); assert.equal(at.gamesSince, 0); assert.equal(winStreakState(at.currentWins, threshold), 'active-streak');
  }
});
test('green qualifying streaks take priority; yellow is exactly one win away', () => {
  for (const threshold of WIN_STREAK_THRESHOLDS) {
    assert.equal(winStreakState(threshold + 1, threshold), 'active-streak');
    assert.equal(winStreakState(threshold, threshold), 'active-streak');
    assert.equal(winStreakState(threshold - 1, threshold), 'one-away');
    assert.equal(winStreakState(threshold - 2, threshold), '');
    assert.equal(winStreakState(0, threshold), '');
  }
  assert.throws(() => winStreakState(-1, 5), /Invalid/);
  assert.throws(() => winStreakState(5, 11), /Invalid/);
});
test('a loss or tie removes qualifying and one-away highlights', () => {
  for (const score of [0, 10]) {
    const games = winningGames(7); games[6].homeScore = score;
    const row = calculateWinStreakDroughts(games, {}, 6).teams.find(r => r.team === 'MIN');
    assert.equal(row.currentWins, 0); assert.equal(row.gamesSince, 1); assert.equal(winStreakState(row.currentWins, 6), '');
  }
});
test('each threshold is independently linkable and existing links keep selecting 5+', () => {
  for (const threshold of WIN_STREAK_THRESHOLDS) {
    assert.equal(droughtViewFromHash(`#win-streaks-${threshold}`), 'win-streaks');
    assert.equal(winThresholdFromHash(`#win-streaks-${threshold}`), threshold);
  }
  assert.equal(winThresholdFromHash('#win-streaks'), 5);
  for (const hash of ['#win-streaks-11', '#win-streaks-6junk', '#win-streaks-06', '#unknown']) {
    assert.equal(droughtViewFromHash(hash), 'milestones'); assert.equal(winThresholdFromHash(hash), 5);
  }
});
test('missing older qualifying runs remain unknown, not invented dates or never claims', () => {
  const games = winningGames(4);
  const row = calculateWinStreakDroughts(games, {}, 10).teams.find(r => r.team === 'MIN');
  assert.equal(row.last, null); assert.equal(row.daysSince, null); assert.equal(row.coverageStart, games[0].date);
});
test('all six saved views validate, share current streaks, and retain their correct threshold', () => {
  const data = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  for (const threshold of WIN_STREAK_THRESHOLDS) {
    const view = threshold === 5 ? data.winStreaks : data.winStreaks.thresholds[threshold];
    assert.equal(view.threshold, threshold); assert.equal(view.throughDate, data.winStreaks.throughDate);
    assert.equal(validWinStreakView(view), true);
    for (const row of view.teams) assert.equal(row.currentWins, data.winStreaks.teams.find(r => r.team === row.team).currentWins);
  }
  const cle = data.winStreaks.thresholds[6].teams.find(r => r.team === 'CLE');
  assert.equal(cle.last, null); assert.equal(cle.daysSince, null); assert.equal(cle.coverageStart, '1994-09-04');
});
test('shared view validation rejects incomplete snapshots and impossible active states', () => {
  const data = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  assert.equal(validWinStreakView(null), false);
  const broken = structuredClone(data.winStreaks); broken.teams.pop(); assert.equal(validWinStreakView(broken), false);
  const duplicate = structuredClone(data.winStreaks); duplicate.teams[1] = duplicate.teams[0]; assert.equal(validWinStreakView(duplicate), false);
  const unknown = structuredClone(data.winStreaks.thresholds[6]); const row = unknown.teams.find(r => r.last === null);
  row.currentWins = 6; assert.equal(validWinStreakView(unknown), false);
  row.currentWins = 0; row.daysSince = 100; assert.equal(validWinStreakView(unknown), false);
});
