import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEAMS, SOURCE_URL } from './divstreaks-data.mjs';
import { refreshDroughts, updateTimeText, validateRefreshGames } from './droughts-refresh.mjs';
import { readGames, validWinStreakView, validLossStreakView } from './droughts-data.mjs';

const saved = () => JSON.parse(readFileSync(new URL('../data/droughts.json', import.meta.url)));
// Fixed as-of dates keep this synthetic feed test valid as weekly production
// snapshots advance beyond the fixture's 2026 game dates.
const publishedFixture = () => {
  const data = saved(); data.throughSeason = 2025; data.currentSeason = 2026;
  data.winStreaks.throughDate = data.lossStreaks.throughDate = '2026-10-11';
  for (const row of data.teams) row.last.division = Math.min(row.last.division, 2025);
  return data;
};
const archive = () => JSON.parse(readFileSync(new URL('../data/droughts-history.json', import.meta.url)));
function csvFixture() {
  const lines = ['game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location'];
  const add = (year, type, date, i, codes, pairs) => lines.push(`fixture${year}-${type}-${i},${year},${type},${Math.floor(i / pairs) + 1},${date},Sunday,13:00,${codes[(i % pairs)*2+1]},10,${codes[(i % pairs)*2]},20,Home`);
  for (let year = 1999; year <= 2025; year++) {
    const codes = Object.keys(TEAMS).filter(t => year >= 2002 || t !== 'HOU').slice(0, year < 2002 ? 30 : 32);
    const pairs = codes.length / 2;
    const count = (year < 2002 ? 248 : year < 2021 ? 256 : 272) - (year === 2022 ? 1 : 0);
    for (let i = 0; i < count; i++) add(year, 'REG', `${year}-09-${String(Math.floor(i / pairs)+1).padStart(2,'0')}`, i, codes, pairs);
  }
  add(2025, 'SB', '2026-02-08', 0, ['SEA','NE'], 1);
  const codes = Object.keys(TEAMS);
  for (let i = 0; i < 16; i++) add(2026, 'REG', '2026-10-12', i, codes, 16);
  return lines.join('\n');
}

test('last updated formats an actual timestamp in Eastern time, not the game date', () => {
  assert.equal(updateTimeText(null), 'Not recorded');
  assert.equal(updateTimeText('bad'), 'Not recorded');
  assert.match(updateTimeText('2026-10-12T18:05:00Z'), /Oct 12, 2026.*2:05 PM EDT/);
  assert.match(updateTimeText('2026-12-12T18:05:00Z'), /Dec 12, 2026.*1:05 PM EST/);
});

test('refresh rejects stale and truncated result feeds', () => {
  const games = readGames(csvFixture());
  assert.equal(validateRefreshGames(games, publishedFixture()), 2025);
  assert.throws(() => validateRefreshGames(games.slice(1), publishedFixture()), /Incomplete 1999/);
  const stale = { ...publishedFixture(), throughSeason: 2027 };
  assert.throws(() => validateRefreshGames(games, stale), /backwards/);
  const staleDate = publishedFixture(); staleDate.winStreaks.throughDate = '2030-01-01';
  assert.throws(() => validateRefreshGames(games, staleDate), /backwards/);
});

test('live refresh recalculates every view with a real update timestamp and leaves the published object unchanged', async () => {
  const published = publishedFixture(), original = JSON.stringify(published), requests = [];
  const result = await refreshDroughts(published, {
    now: () => new Date('2026-10-12T18:05:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), cache: options.cache });
      return { ok: true, text: async () => csvFixture(), json: async () => archive() };
    },
  });
  assert.equal(result.updatedAt, '2026-10-12T18:05:00.000Z');
  assert.equal(result.winStreaks.throughDate, '2026-10-12');
  assert.equal(result.teams.length, 32);
  assert.equal(validWinStreakView(result.winStreaks), true);
  assert.equal(validLossStreakView(result.lossStreaks), true);
  for (const view of Object.values(result.winStreaks.thresholds)) assert.equal(validWinStreakView(view), true);
  for (const view of Object.values(result.lossStreaks.thresholds)) assert.equal(validLossStreakView(view), true);
  assert.equal(JSON.stringify(published), original);
  assert.equal(requests.length, 2); assert.equal(requests[0].url, SOURCE_URL);
  assert.ok(requests.every(r => r.cache === 'no-store'));
});

test('network errors and archive changes fail without altering existing records or their timestamp', async () => {
  const published = publishedFixture(), original = JSON.stringify(published);
  await assert.rejects(refreshDroughts(published, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /Download failed/);
  await assert.rejects(refreshDroughts(published, { fetchImpl: async () => {
    const changed = archive(); changed.rows[0][3] += 1;
    return { ok: true, text: async () => csvFixture(), json: async () => changed };
  } }), /checksum/);
  assert.equal(JSON.stringify(published), original);
});
