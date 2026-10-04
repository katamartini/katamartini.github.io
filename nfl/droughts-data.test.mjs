import test from 'node:test';
import assert from 'node:assert/strict';
import { DIVISIONS } from './divstreaks-data.mjs';
import { calculateDroughts, divisionWinners, latestCompletedSeason, readGames, seasonsSince } from './droughts-data.mjs';

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
