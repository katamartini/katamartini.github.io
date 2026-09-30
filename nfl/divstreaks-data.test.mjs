import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreaks, DIVISIONS, nextMatchup, upcomingDivisionalGames } from './divstreaks-data.mjs';

const header = 'game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location';
const game = (id, date, away, awayScore, home, homeScore, location = 'Home', season = 2025, week = 1) =>
  [id, season, 'REG', week, date, 'Sunday', '13:00', away, awayScore, home, homeScore, location].join(',');

function sampleCsv() {
  const lines = [header];
  for (const division of DIVISIONS) {
    for (let i = 0; i < division.teams.length; i++) {
      for (let j = i + 1; j < division.teams.length; j++) {
        const [a, b] = [division.teams[i], division.teams[j]];
        if (a === 'BUF' && b === 'MIA') continue;
        lines.push(game(`${a}_${b}_1`, '2024-09-01', b, 7, a, 14));
        lines.push(game(`${a}_${b}_2`, '2025-09-01', a, 7, b, 14));
      }
    }
  }
  lines.push(game('BUF_MIA_1', '2024-09-01', 'MIA', 7, 'BUF', 14));
  lines.push(game('BUF_MIA_2', '2024-10-01', 'BUF', 7, 'MIA', 14));
  lines.push(game('BUF_MIA_3', '2025-09-01', 'MIA', 7, 'BUF', 14));
  lines.push(game('BUF_MIA_4', '2025-10-01', 'BUF', 14, 'MIA', 7));
  lines.push(game('BUF_MIA_neutral', '2025-11-01', 'BUF', 7, 'MIA', 14, 'Neutral'));
  lines.push(game('2026_03_ATL_GB', '2026-09-24', 'ATL', '', 'GB', '', 'Home', 2026, 3));
  lines.push(game('2026_03_BUF_MIA', '2026-09-27', 'BUF', '', 'MIA', '', 'Home', 2026, 3));
  lines.push(game('2026_03_CIN_PIT', '2026-09-27', 'CIN', '', 'PIT', '', 'Home', 2026, 3));
  lines.push(game('2026_04_NYJ_MIA', '2026-10-04', 'NYJ', '', 'MIA', '', 'Home', 2026, 4));
  return lines.join('\n');
}

test('overall and team-specific venue streaks use the right games', () => {
  const data = calculateStreaks(sampleCsv());
  assert.equal(data.streaks.length, 48);
  assert.equal(data.homeStreaks.length, 96);
  assert.equal(data.awayStreaks.length, 96);
  const pair = data.streaks.find(row => row.teams.join('-') === 'BUF-MIA');
  assert.equal(pair.winner, 'MIA');
  assert.equal(pair.count, 1);
  assert.equal(pair.startDate, '2025-11-01');
  const billsHome = data.homeStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA');
  assert.equal(billsHome.count, 2);
  assert.equal(billsHome.startDate, '2024-09-01');
  const billsAway = data.awayStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA');
  assert.equal(billsAway.count, 1);
  assert.equal(billsAway.startDate, '2025-10-01');
  const dolphinsHome = data.homeStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF');
  assert.equal(dolphinsHome.count, 0);
  assert.equal(dolphinsHome.startDate, null);
  const dolphinsAway = data.awayStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF');
  assert.equal(dolphinsAway.count, 0);
  assert.equal(dolphinsAway.startDate, null);
});

test('only scheduled divisional games in the next league week are marked upcoming', () => {
  const { schedule } = calculateStreaks(sampleCsv());
  assert.deepEqual(upcomingDivisionalGames(schedule, '2026-09-24').map(game => game.id),
    ['2026_03_BUF_MIA', '2026_03_CIN_PIT']);
  assert.deepEqual(upcomingDivisionalGames(schedule, '2026-09-28').map(game => game.id),
    ['2026_04_NYJ_MIA']);
  assert.deepEqual(upcomingDivisionalGames(schedule, '2026-08-01'), []);
});

test('next matchup searches all future weeks and respects each team’s venue', () => {
  const csv = [sampleCsv(),
    game('BUF_MIA_home', '2026-12-06', 'MIA', '', 'BUF', '', 'Home', 2026, 13),
    game('BUF_MIA_neutral_future', '2026-10-04', 'MIA', '', 'BUF', '', 'Neutral', 2026, 4),
    game('BUF_MIA_away', '2026-10-18', 'BUF', '', 'MIA', '', 'Home', 2026, 6),
  ].join('\n');
  const { schedule } = calculateStreaks(csv);
  const teams = ['BUF', 'MIA'];
  const next = nextMatchup(schedule, teams, '2026-09-30');
  assert.equal(next.id, 'BUF_MIA_neutral_future');
  assert.equal(next.week, 4);
  assert.equal(nextMatchup(schedule, teams, '2026-09-30', 'home', 'BUF').id, 'BUF_MIA_home');
  assert.equal(nextMatchup(schedule, teams, '2026-09-30', 'away', 'BUF').id, 'BUF_MIA_away');
  assert.equal(nextMatchup(schedule, teams, '2026-09-30', 'home', 'MIA').id, 'BUF_MIA_away');
  assert.equal(nextMatchup(schedule, teams, '2026-12-07'), null);
  assert.equal(nextMatchup(schedule, ['BUF', 'NE'], '2026-09-30'), null);
});

test('neutral-site notes show the effect only on the designated home and away rows', () => {
  const data = calculateStreaks(sampleCsv());
  const billsAway = data.awayStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA');
  assert.equal(billsAway.count, 1);
  assert.deepEqual(billsAway.neutralSiteEffect, {
    count: 0,
    startDate: null,
    games: [{ date: '2025-11-01', away: 'BUF', awayScore: 7, home: 'MIA', homeScore: 14 }],
  });
  const dolphinsHome = data.homeStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF');
  assert.equal(dolphinsHome.count, 0);
  assert.equal(dolphinsHome.neutralSiteEffect.count, 1);
  assert.equal(dolphinsHome.neutralSiteEffect.startDate, '2025-11-01');
  assert.equal(data.homeStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA').neutralSiteEffect, null);
  assert.equal(data.awayStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF').neutralSiteEffect, null);
});

test('neutral-site notes disappear once later venue games reset the affected streaks', () => {
  const csv = [sampleCsv(),
    game('BUF_MIA_reset_1', '2025-12-01', 'BUF', 14, 'MIA', 7),
    game('BUF_MIA_reset_2', '2025-12-15', 'BUF', 7, 'MIA', 14),
  ].join('\n');
  const data = calculateStreaks(csv);
  assert.equal(data.awayStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA').neutralSiteEffect, null);
  assert.equal(data.homeStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF').neutralSiteEffect, null);
});

test('neutral-site notes also catch a changed start date with the same win count', () => {
  const csv = [sampleCsv(),
    game('BUF_MIA_neutral_loss', '2024-11-01', 'MIA', 14, 'BUF', 7, 'Neutral'),
    game('BUF_MIA_neutral_win', '2025-08-01', 'MIA', 7, 'BUF', 14, 'Neutral'),
  ].join('\n');
  const data = calculateStreaks(csv);
  const billsHome = data.homeStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA');
  assert.equal(billsHome.count, 2);
  assert.equal(billsHome.startDate, '2024-09-01');
  assert.equal(billsHome.neutralSiteEffect.count, 2);
  assert.equal(billsHome.neutralSiteEffect.startDate, '2025-08-01');
  assert.equal(billsHome.neutralSiteEffect.games.length, 2);
});

test('a tie resets both the overall and venue-specific win streak', () => {
  const csv = `${sampleCsv()}\n${game('BUF_MIA_tie', '2025-12-01', 'BUF', 14, 'MIA', 14)}`;
  const data = calculateStreaks(csv);
  assert.equal(data.streaks.find(row => row.teams.join('-') === 'BUF-MIA').count, 0);
  assert.equal(data.streaks.find(row => row.teams.join('-') === 'BUF-MIA').startDate, null);
  assert.equal(data.homeStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF').count, 0);
  assert.equal(data.awayStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA').count, 0);
});
