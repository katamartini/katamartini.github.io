import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreaks, DIVISIONS, upcomingDivisionalGames } from './divstreaks-data.mjs';

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
  assert.equal(data.homeStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA').count, 2);
  assert.equal(data.awayStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA').count, 1);
  assert.equal(data.homeStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF').count, 0);
  assert.equal(data.awayStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF').count, 0);
});

test('only scheduled divisional games in the next league week are marked upcoming', () => {
  const { schedule } = calculateStreaks(sampleCsv());
  assert.deepEqual(upcomingDivisionalGames(schedule, '2026-09-24').map(game => game.id),
    ['2026_03_BUF_MIA', '2026_03_CIN_PIT']);
  assert.deepEqual(upcomingDivisionalGames(schedule, '2026-09-28').map(game => game.id),
    ['2026_04_NYJ_MIA']);
  assert.deepEqual(upcomingDivisionalGames(schedule, '2026-08-01'), []);
});

test('a tie resets both the overall and venue-specific win streak', () => {
  const csv = `${sampleCsv()}\n${game('BUF_MIA_tie', '2025-12-01', 'BUF', 14, 'MIA', 14)}`;
  const data = calculateStreaks(csv);
  assert.equal(data.streaks.find(row => row.teams.join('-') === 'BUF-MIA').count, 0);
  assert.equal(data.homeStreaks.find(row => row.team === 'MIA' && row.opponent === 'BUF').count, 0);
  assert.equal(data.awayStreaks.find(row => row.team === 'BUF' && row.opponent === 'MIA').count, 0);
});
