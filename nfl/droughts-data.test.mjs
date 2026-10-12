import test from 'node:test';
import assert from 'node:assert/strict';
import { DIVISIONS } from './divstreaks-data.mjs';
import { calculateDroughts, divisionWinners, latestCompletedSeason, readGames, seasonsSince,
  calculateWinStreakDroughts, droughtViewFromHash, daysBetween, elapsedTime,
  WIN_STREAK_THRESHOLDS, winThresholdFromHash, winStreakState, validWinStreakView,
  winStreakHistoryStatus, compareWinStreakRows, FRANCHISE_DEBUTS, winStreakRowClass, bestStreakYears } from './droughts-data.mjs';
import { WIN_STREAK_HISTORY } from './droughts-history.mjs';
import { archiveByTeam, validateArchive, readArchive, expectedHistoricalGames, isHistoricalOpponent,
  ARCHIVE_SOURCE, ARCHIVE_SHA256, ARCHIVE_ROWS_SHA256, historicalClubFranchises } from './droughts-archive.mjs';
import { createHash } from 'node:crypto';
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
    date: new Date(Date.UTC(2026, 8, 1 + i * 3)).toISOString().slice(0, 10), away: 'GB', home: 'MIN', awayScore: 10, homeScore: 20, completed: true }));
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

test('Best retains ended records, includes current runs and ignores postseason games', () => {
  const games = winningGames(12);
  games[7].homeScore = 0;
  const row = streakFor(games);
  assert.equal(row.bestWins, 7); assert.equal(row.currentWins, 4);
  games[7].homeScore = 10;
  assert.equal(streakFor(games).bestWins, 7);
  games[7].type = 'WC';
  assert.equal(streakFor(games).bestWins, 11);
  games[7].type = 'REG'; games[7].homeScore = 20;
  assert.equal(streakFor(games).bestWins, 12);
  assert.equal(streakFor(games, 'GB').bestWins, 0);
});

test('record years retain separate tied runs and replace them when a new record is set', () => {
  const games = winningGames(11);
  games[3].homeScore = 0; games[7].homeScore = 10;
  for (const g of games.slice(4, 8)) { g.season = 2027; g.date = g.date.replace('2026', '2027'); }
  for (const g of games.slice(8)) { g.season = 2028; g.date = g.date.replace('2026', '2028'); }
  const tied = streakFor(games);
  assert.equal(tied.bestWins, 3);
  assert.deepEqual(tied.bestRuns, [2026, 2027, 2028].map(year => ({ startSeason: year, endSeason: year })));
  assert.equal(bestStreakYears(tied.bestRuns), '2026, 2027, 2028');
  games.push({ ...games.at(-1), id: 'new-record', date: '2028-10-10' });
  const record = streakFor(games);
  assert.equal(record.bestWins, 4);
  assert.deepEqual(record.bestRuns, [{ startSeason: 2028, endSeason: 2028 }]);
  assert.deepEqual(streakFor(games, 'GB').bestRuns, [{ startSeason: 2026, endSeason: 2026 }]);
  assert.equal(bestStreakYears([]), '—');
  assert.equal(bestStreakYears([{ startSeason: 2025, endSeason: 2026 }, { startSeason: 2025, endSeason: 2026 }]), '2025–2026');
});
test('offseasons and byes do not reset regular-season streaks, and playoffs do not count', () => {
  const games = winningGames(4).map(g => ({ ...g, season: 2025, date: g.date.replace('2026-09', '2025-12') }));
  games.push({ ...winningGames(1)[0], id: 'playoff-loss', type: 'WC', season: 2025, date: '2026-01-11', homeScore: 0 },
    { ...winningGames(1)[0], id: 'next-season', date: '2026-09-20', week: 2 });
  const row = streakFor(games); assert.equal(row.currentWins, 5); assert.equal(row.bestWins, 5); assert.equal(row.last.startDate, '2025-12-01'); assert.equal(row.last.season, 2026);
  assert.equal(bestStreakYears(row.bestRuns), '2025–2026');
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

test('each threshold from 1 to 23 qualifies at exactly its own number of wins', () => {
  for (const threshold of WIN_STREAK_THRESHOLDS) {
    const beforeGames = threshold === 1 ? [{ ...winningGames(1)[0], homeScore: 0 }] : winningGames(threshold - 1);
    const before = calculateWinStreakDroughts(beforeGames, {}, threshold).teams.find(r => r.team === 'MIN');
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
    if (threshold > 1) assert.equal(winStreakState(threshold - 2, threshold), '');
    assert.equal(winStreakState(0, threshold), threshold === 1 ? 'one-away' : '');
  }
  assert.throws(() => winStreakState(-1, 5), /Invalid/);
  assert.throws(() => winStreakState(5, 24), /Invalid/);
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
  for (const hash of ['#win-streaks-0', '#win-streaks-24', '#win-streaks-6junk', '#win-streaks-06', '#unknown']) {
    assert.equal(droughtViewFromHash(hash), 'milestones'); assert.equal(winThresholdFromHash(hash), 5);
  }
});
test('missing older qualifying runs remain unknown, not invented dates or never claims', () => {
  const games = winningGames(4);
  const row = calculateWinStreakDroughts(games, {}, 10).teams.find(r => r.team === 'MIN');
  assert.equal(row.last, null); assert.equal(row.daysSince, null); assert.equal(row.coverageStart, games[0].date);
});
test('all 23 saved views validate, share current streaks, and retain their correct threshold', () => {
  const data = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  for (const threshold of WIN_STREAK_THRESHOLDS) {
    const view = threshold === 5 ? data.winStreaks : data.winStreaks.thresholds[threshold];
    assert.equal(view.threshold, threshold); assert.equal(view.throughDate, data.winStreaks.throughDate);
    assert.equal(validWinStreakView(view), true);
    for (const row of view.teams) {
      const baseline = data.winStreaks.teams.find(r => r.team === row.team);
      assert.equal(row.currentWins, baseline.currentWins);
      assert.equal(row.bestWins, baseline.bestWins);
      assert.deepEqual(row.bestRuns, baseline.bestRuns);
      assert.ok(row.bestWins >= row.currentWins);
      if (row.last) assert.ok(row.bestWins >= threshold && row.bestWins >= row.last.wins);
      else assert.ok(row.bestWins < threshold);
    }
  }
  const cle = data.winStreaks.thresholds[6].teams.find(r => r.team === 'CLE');
  assert.ok(cle.last);
  if (cle.last.season < 1999) { assert.equal(cle.last.week, null); assert.ok(cle.last.gameNumber >= 1); }
  assert.equal(cle.coverageStart, '1946-09-06');
});
test('shared view validation rejects incomplete snapshots and impossible active states', () => {
  const data = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  assert.equal(validWinStreakView(null), false);
  const broken = structuredClone(data.winStreaks); broken.teams.pop(); assert.equal(validWinStreakView(broken), false);
  const duplicate = structuredClone(data.winStreaks); duplicate.teams[1] = duplicate.teams[0]; assert.equal(validWinStreakView(duplicate), false);
  const unknown = structuredClone(data.winStreaks.thresholds[10]); const row = unknown.teams[0];
  row.last = null; row.daysSince = null;
  row.currentWins = 10; assert.equal(validWinStreakView(unknown), false);
  row.currentWins = 0; row.daysSince = 100; assert.equal(validWinStreakView(unknown), false);
});

test('view validation rejects missing or contradictory franchise records', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  for (const best of [undefined, -1, 1.5, 0]) {
    const view = structuredClone(saved.winStreaks);
    view.teams[0].bestWins = best;
    assert.equal(validWinStreakView(view), false);
  }
  const current = structuredClone(saved.winStreaks);
  current.teams[0].currentWins = current.teams[0].bestWins + 1;
  assert.equal(validWinStreakView(current), false);
  const missing = structuredClone(saved.winStreaks);
  missing.teams[0].last = null; missing.teams[0].daysSince = null;
  assert.equal(validWinStreakView(missing), false);
  for (const runs of [undefined, [], [{ startSeason: 2026, endSeason: 2025 }], [{ startSeason: 1800, endSeason: 1801 }], [{ startSeason: 2025, endSeason: 3000 }]]) {
    const view = structuredClone(saved.winStreaks);
    view.teams[0].bestRuns = runs;
    assert.equal(validWinStreakView(view), false);
  }
});

const archiveFixture = () => JSON.parse(readFileSync(new URL('../data/droughts-history.json', import.meta.url)));
test('pinned archive covers all franchise schedules from 1920 through 1998', () => {
  const archive = archiveFixture();
  assert.equal(archive.source, ARCHIVE_SOURCE); assert.equal(archive.sha256, ARCHIVE_SHA256);
  assert.equal(createHash('sha256').update(JSON.stringify(archive.rows)).digest('hex'), ARCHIVE_ROWS_SHA256);
  assert.equal(archive.firstSeason, 1920); assert.equal(archive.lastSeason, 1998);
  assert.equal(archive.rows.length, 10612); assert.equal(validateArchive(archive.rows), true);
  const history = archiveByTeam(archive.rows);
  for (const team of Object.keys(history)) for (let year = 1920; year <= 1998; year++) {
    assert.equal(history[team].filter(g => g.season === year).length, expectedHistoricalGames(team, year), `${team} ${year}`);
  }
});
test('archive validation fails on missing, duplicated, unplayed or malformed historical games', () => {
  const rows = archiveFixture().rows;
  assert.throws(() => validateArchive(rows.slice(1)), /Incomplete/);
  assert.throws(() => validateArchive([...rows, rows[0]]), /Duplicate/);
  for (const [index, value] of [[3, -1], [3, null], [2, 'unknown'], [0, 'bad-date'], [1, 1999]]) {
    const broken = structuredClone(rows); broken[0][index] = value;
    assert.throws(() => validateArchive(broken), /Invalid/);
  }
  assert.throws(() => readArchive('bad,format'), /Unexpected/);
  assert.throws(() => readArchive('date,season,playoff,team1,team2,score1,score2\n1946-09-06,1946,0,CLE,SF,,0'), /Missing/);
});
test('defunct clubs and historical relocations retain distinct franchise identities', () => {
  const history = archiveByTeam(archiveFixture().rows);
  assert.equal(isHistoricalOpponent('historical:BCL'), true);
  assert.equal(isHistoricalOpponent('historical:BAL'), false);
  assert.equal(history.BAL[0].season, 1996); assert.equal(history.IND[0].season, 1953);
  assert.equal(history.SEA[0].season, 1976); assert.equal(history.MIA[0].season, 1966);
  assert.equal(history.TEN[0].season, 1960); assert.equal(history.HOU.length, 0);
  assert.ok(history.SF.some(g => g.home === 'historical:BCL' || g.away === 'historical:BCL'));
  assert.ok(history.LV.some(g => g.season === 1960)); assert.ok(history.LA.some(g => g.season === 1946));
  assert.equal(history.CLE.filter(g => g.season >= 1996).length, 0);
});
test('historical season game numbers are not fabricated NFL weeks and runs carry across 1999', () => {
  const modern = { id: 'modern', season: 1999, type: 'REG', week: 1, date: '1999-09-12', away: 'GB', home: 'MIN', awayScore: 0, homeScore: 20, completed: true };
  const earlier = winningGames(9).map((g, i) => ({ ...g, id: `archive:${i}`, season: 1998, week: null, date: g.date.replace('2026', '1998') }));
  const view = calculateWinStreakDroughts([modern], { MIN: earlier }, 9);
  const row = view.teams.find(r => r.team === 'MIN');
  assert.equal(row.last.week, 1); assert.equal(row.last.wins, 10); assert.equal(row.bestWins, 10); assert.equal(row.currentStart, '1998-09-01');
  assert.equal(bestStreakYears(row.bestRuns), '1998–1999');
  assert.equal(view.firstResultsSeason, 1998);
  const historical = calculateWinStreakDroughts([{ ...modern, homeScore: 0, awayScore: 20 }], { MIN: earlier }, 9).teams.find(r => r.team === 'MIN');
  assert.equal(historical.last.week, null); assert.equal(historical.last.gameNumber, 9); assert.equal(historical.bestWins, 9); assert.equal(historical.gamesSince, 1);
});
test('historical backfill preserves verified Browns records and resolves older longer runs', () => {
  const archive = archiveByTeam(archiveFixture().rows);
  for (const fixture of WIN_STREAK_HISTORY.CLE) {
    const found = archive.CLE.find(g => g.date === fixture.date);
    for (const key of ['home', 'away', 'homeScore', 'awayScore']) assert.equal(found[key], fixture[key]);
  }
  const modern = { ...winningGames(1)[0], season: 1999, date: '1999-09-12' };
  const five = calculateWinStreakDroughts([modern], archive, 5);
  assert.equal(five.firstResultsSeason, 1920);
  assert.equal(five.teams.find(r => r.team === 'CLE').last.date, '1994-10-23');
  const six = calculateWinStreakDroughts([modern], archive, 6).teams.find(r => r.team === 'CLE');
  assert.equal(six.last.date, '1972-11-26'); assert.equal(six.last.gameNumber, 11);
  assert.equal(calculateWinStreakDroughts([modern], archive, 9).teams.find(r => r.team === 'CLE').last.date, '1953-12-06');
  assert.equal(calculateWinStreakDroughts([modern], archive, 10).teams.find(r => r.team === 'ARI').last.date, '1949-09-26');
  assert.equal(calculateWinStreakDroughts([modern], archive, 10).teams.find(r => r.team === 'HOU').last, null);
});

test('never requires coverage back to the franchise debut, not merely a missing last date', () => {
  const view = { firstResultsSeason: 1946 };
  const row = { team: 'NYJ', last: null, coverageStart: '1960-09-11' };
  assert.equal(winStreakHistoryStatus(row, view), 'never');
  assert.equal(winStreakHistoryStatus({ ...row, last: { date: '2026-10-11' } }, view), 'recorded');
  assert.equal(winStreakHistoryStatus({ ...row, coverageStart: '1999-09-12' }, view), 'unknown');
  assert.equal(winStreakHistoryStatus(row, { firstResultsSeason: 1999 }), 'unknown');
  assert.equal(winStreakHistoryStatus(row, {}), 'unknown');
  assert.equal(winStreakHistoryStatus({ team: 'ARI', last: null, coverageStart: '1946-09-22' }, view), 'unknown');
  assert.equal(FRANCHISE_DEBUTS.NYJ, 1960); assert.equal(FRANCHISE_DEBUTS.HOU, 2002);
});

const sortingFixture = () => {
  const data = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  // Synthetic no-streak rows avoid making future weekly tests depend on a
  // franchise still never having a qualifying streak at that future date.
  const view = structuredClone(data.winStreaks.thresholds[10]);
  for (const team of ['NYJ', 'ATL', 'CIN', 'TB', 'HOU']) {
    const row = view.teams.find(r => r.team === team);
    row.last = null; row.daysSince = null;
  }
  return view;
};
test('longest drought sorts put never teams first, older franchises before newer ones', () => {
  const view = sortingFixture();
  for (const [key, descending] of [['gamesSince', true], ['daysSince', true], ['last', false]]) {
    const rows = [...view.teams].sort((a, b) => compareWinStreakRows(a, b, key, descending, view));
    assert.deepEqual(rows.slice(0, 5).map(r => r.team), ['NYJ', 'ATL', 'CIN', 'TB', 'HOU']);
    assert.ok(rows[5].last);
  }
});
test('shortest drought sorts move never teams below known streaks and unknown history stays last', () => {
  const view = sortingFixture();
  const ari = view.teams.find(r => r.team === 'ARI'); ari.last = null; ari.daysSince = null;
  ari.coverageStart = '1946-09-20'; // Deliberately incomplete early history.
  for (const [key, descending] of [['gamesSince', false], ['daysSince', false], ['last', true]]) {
    const rows = [...view.teams].sort((a, b) => compareWinStreakRows(a, b, key, descending, view));
    assert.equal(winStreakHistoryStatus(rows[0], view), 'recorded');
    assert.deepEqual(rows.slice(-6, -1).map(r => r.team), ['HOU', 'TB', 'CIN', 'ATL', 'NYJ']);
    assert.equal(rows.at(-1).team, 'ARI');
  }
  const longest = [...view.teams].sort((a, b) => compareWinStreakRows(a, b, 'gamesSince', true, view));
  assert.equal(longest.at(-1).team, 'ARI');
});
test('same-debut never teams have deterministic name ties and normal column sorts stay normal', () => {
  const view = { firstResultsSeason: 1946 };
  const bills = { team: 'BUF', last: null, coverageStart: '1960-09-11', currentWins: 2 };
  const patriots = { team: 'NE', last: null, coverageStart: '1960-09-09', currentWins: 4 };
  assert.ok(compareWinStreakRows(bills, patriots, 'gamesSince', true, view) < 0);
  assert.ok(compareWinStreakRows(bills, patriots, 'team', true, view) > 0);
  assert.ok(compareWinStreakRows(bills, patriots, 'currentWins', true, view) > 0);
  assert.ok(compareWinStreakRows(bills, patriots, 'currentWins', false, view) < 0);
});
test('known droughts keep numeric and date ordering with no mutation of saved records', () => {
  const view = sortingFixture(), rows = view.teams.filter(r => r.last);
  const saved = JSON.stringify(view);
  for (const [key, descending] of [['gamesSince', true], ['daysSince', false], ['last', true]]) {
    const result = [...rows].sort((a, b) => compareWinStreakRows(a, b, key, descending, view));
    const values = result.map(r => key === 'last' ? r.last.date : r[key]);
    for (let i = 1; i < values.length; i++) assert.ok(descending ? values[i - 1] >= values[i] : values[i - 1] <= values[i]);
  }
  assert.equal(JSON.stringify(view), saved);
});

test('Best sorts numerically in both directions, without promoting Never or unknown teams', () => {
  const view = { firstResultsSeason: 1920, threshold: 23 };
  const rows = [
    { team: 'HOU', last: null, coverageStart: '2002-09-08', bestWins: 9 },
    { team: 'IND', last: { date: '2009-12-17' }, coverageStart: '1953-09-27', bestWins: 23 },
    { team: 'ARI', last: null, coverageStart: '1946-09-22', bestWins: 10 },
  ];
  assert.deepEqual([...rows].sort((a,b) => compareWinStreakRows(a,b,'bestWins',true,view)).map(r => r.team), ['IND','ARI','HOU']);
  assert.deepEqual([...rows].sort((a,b) => compareWinStreakRows(a,b,'bestWins',false,view)).map(r => r.team), ['HOU','ARI','IND']);
});

test('pink highlights only confirmed never teams, with active and one-away status taking priority', () => {
  const view = { firstResultsSeason: 1946, threshold: 10 };
  const never = { team: 'HOU', coverageStart: '2002-09-08', last: null, currentWins: 1 };
  assert.equal(winStreakRowClass(never, view), 'never-streak');
  assert.equal(winStreakRowClass({ ...never, currentWins: 9 }, view), 'one-away');
  assert.equal(winStreakRowClass({ ...never, currentWins: 10, last: { date: '2026-10-11' } }, view), 'active-streak');
  assert.equal(winStreakRowClass({ ...never, last: { date: '2025-10-11' } }, view), '');
  assert.equal(winStreakRowClass({ ...never, coverageStart: '2003-09-07' }, view), '');
  assert.equal(winStreakRowClass({ ...never, team: 'ARI', coverageStart: '1946-09-22' }, view), '');
});

test('supported range and saved schema cover 1 through 23 without replacing the legacy 5+ root', () => {
  assert.deepEqual(WIN_STREAK_THRESHOLDS, Array.from({ length: 23 }, (_, i) => i + 1));
  const saved = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  assert.equal(saved.winStreaks.threshold, 5);
  assert.deepEqual(Object.keys(saved.winStreaks.thresholds).map(Number), WIN_STREAK_THRESHOLDS.filter(n => n !== 5));
  for (const n of [1, 4, 11, 22, 23]) {
    assert.equal(winThresholdFromHash(`#win-streaks-${n}`), n);
    assert.equal(saved.winStreaks.thresholds[n].threshold, n);
  }
  assert.equal(validWinStreakView({ ...saved.winStreaks, threshold: 24 }), false);
});

test('1+ tracks the latest win and one loss is one game since that win', () => {
  const games = winningGames(4); games[3].homeScore = 0;
  const view = calculateWinStreakDroughts(games, {}, 1);
  const row = view.teams.find(r => r.team === 'MIN');
  assert.equal(row.last.date, games[2].date); assert.equal(row.gamesSince, 1);
  assert.equal(row.currentWins, 0); assert.equal(winStreakRowClass(row, view), 'one-away');
  games[3].homeScore = 20;
  const resumed = calculateWinStreakDroughts(games, {}, 1).teams.find(r => r.team === 'MIN');
  assert.equal(resumed.gamesSince, 0); assert.equal(winStreakRowClass(resumed, view), 'active-streak');
});

test('the 23+ view retains a qualifying Colts record and now covers all franchise debuts', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  const view = saved.winStreaks.thresholds[23];
  const colts = view.teams.find(r => r.team === 'IND');
  assert.ok(colts.last); assert.ok(colts.last.wins >= 23);
  for (const row of view.teams) {
    assert.equal(Number(row.coverageStart.slice(0, 4)), FRANCHISE_DEBUTS[row.team]);
    if (!row.last) assert.equal(winStreakHistoryStatus(row, view), 'never');
  }
});

test('all 32 franchise debuts and every saved threshold have full first-season coverage', () => {
  assert.equal(Object.keys(FRANCHISE_DEBUTS).length, 32);
  assert.deepEqual(Object.keys(FRANCHISE_DEBUTS).sort(), DIVISIONS.flatMap(d => d.teams).sort());
  const saved = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  for (const n of WIN_STREAK_THRESHOLDS) {
    const view = n === 5 ? saved.winStreaks : saved.winStreaks.thresholds[n];
    assert.equal(view.firstResultsSeason, 1920);
    for (const row of view.teams) {
      assert.equal(Number(row.coverageStart.slice(0, 4)), FRANCHISE_DEBUTS[row.team]);
      assert.notEqual(winStreakHistoryStatus(row, view), 'unknown');
    }
  }
});

test('wartime games are shared by both franchises while their opponents see a single combined club', () => {
  const rows = archiveFixture().rows, history = archiveByTeam(rows);
  for (const [club, year, teams, wins, ties] of [
    ['historical:STG', 1943, ['PHI', 'PIT'], 5, 1],
    ['historical:CRP', 1944, ['ARI', 'PIT'], 0, 0],
  ]) {
    assert.deepEqual(historicalClubFranchises(club, year), teams);
    for (const team of teams) {
      const games = history[team].filter(g => g.season === year);
      assert.equal(games.length, 10); assert.ok(games.every(g => g.mergedClub === club));
      assert.equal(games.filter(g => g.home === team ? g.homeScore > g.awayScore : g.awayScore > g.homeScore).length, wins);
      assert.equal(games.filter(g => g.homeScore === g.awayScore).length, ties);
    }
    const sample = rows.find(r => [r[2], r[4]].includes(club) && [r[2], r[4]].some(t => history[t]));
    const opponent = sample[2] === club ? sample[4] : sample[2];
    const opponentGames = history[opponent].filter(g => g.date === sample[0]);
    assert.equal(opponentGames.length, 1);
    assert.ok([opponentGames[0].home, opponentGames[0].away].includes(club));
    for (const team of teams) assert.equal(history[team].filter(g => g.id === opponentGames[0].id).length, 1);
  }
  assert.throws(() => historicalClubFranchises('historical:STG', 1944), /Invalid Steagles/);
  assert.throws(() => historicalClubFranchises('historical:CRP', 1943), /Invalid Card-Pitt/);
});

test('early names, pre-league seasons and suspensions cannot leak into other franchise histories', () => {
  const history = archiveByTeam(archiveFixture().rows);
  assert.equal(history.GB[0].season, 1921); assert.ok(history.GB.every(g => g.season >= 1921));
  assert.equal(history.NYG[0].season, 1925); assert.deepEqual(historicalClubFranchises('historical:NG1', 1921), []);
  assert.equal(history.DET[0].season, 1930); assert.deepEqual(historicalClubFranchises('historical:DTM', 1925), []);
  assert.equal(history.LA[0].season, 1937); assert.equal(history.LA.filter(g => g.season === 1943).length, 0);
  assert.equal(history.BUF[0].season, 1960); assert.deepEqual(historicalClubFranchises('historical:BFF', 1920), []);
  assert.equal(history.CHI[0].date, '1920-10-03'); assert.equal(history.CHI[0].away, 'historical:MUT');
  assert.equal(history.CHI[0].homeScore, 20); assert.equal(history.CHI[0].awayScore, 0);
  assert.equal(history.CLE.filter(g => g.season >= 1996).length, 0);
});

test('the 1932 standings tiebreaker is retained and prewar qualifying runs are calculable', () => {
  const history = archiveByTeam(archiveFixture().rows);
  const tiebreaker = history.CHI.find(g => g.date === '1932-12-18');
  assert.ok(tiebreaker); assert.equal(tiebreaker.away, 'DET'); assert.equal(tiebreaker.homeScore, 9);
  const modern = { ...winningGames(1)[0], season: 1999, date: '1999-09-12' };
  assert.equal(calculateWinStreakDroughts([modern], history, 17).teams.find(r => r.team === 'CHI').last.date, '1934-12-02');
  assert.equal(calculateWinStreakDroughts([modern], history, 13).teams.find(r => r.team === 'WAS').last.date, '1943-10-31');
});

test('old never franchises sort first by their league debut, with name ties deterministic', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
  const view = saved.winStreaks.thresholds[23];
  const oldTeams = ['ARI', 'CHI', 'GB', 'NYG', 'DET', 'WAS', 'PHI', 'PIT', 'LA'];
  const rows = view.teams.filter(r => oldTeams.includes(r.team)).map(r => ({ ...r, last: null, daysSince: null }));
  assert.deepEqual(rows.sort((a,b) => compareWinStreakRows(a,b,'gamesSince',true,view)).map(r => r.team),
    ['CHI', 'ARI', 'GB', 'NYG', 'DET', 'WAS', 'PHI', 'PIT', 'LA']);
});
