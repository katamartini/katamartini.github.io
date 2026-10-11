import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { receivingAppearances, calculateReceivingStreaks, mergeReceivingArchive, topReceivingStreaks } from './receiving-streaks-data.mjs';
import { RECEIVING_ARCHIVE } from './receiving-streaks-archive.mjs';

const game = (id, date, season = 2026, home = 'MIN', away = 'GB') => ({ game_id: id, gameday: date, season: String(season), game_type: 'REG', home_team: home, away_team: away, home_score: '20', away_score: '17' });
const appearance = (g, receptions = 1, team = 'MIN', id = 'p') => ({ id, name: 'Test Receiver', season: Number(g.season), game: g.game_id, date: g.gameday, team, opponent: team === g.home_team ? g.away_team : g.home_team, receptions });
const players = (rookie = 2020) => new Map([['p', { display_name: 'Test Receiver', rookie_season: String(rookie), pfr_id: 'RecvTe00' }]]);
const calculate = (rows, games, p = players(), current = new Set(['p']), participation = new Set(games.filter(g => +g.season >= 2013).map(g => g.game_id))) => calculateReceivingStreaks(rows, games, participation, p, current);
const stats = (g, catches = '1') => ({ player_id: 'p', player_display_name: 'Test Receiver', season: g.season, season_type: 'REG', game_id: g.game_id, team: 'MIN', opponent_team: 'GB', receptions: catches });
const snap = (g, fields = {}) => ({ game_id: g.game_id, season: g.season, game_type: 'REG', player: 'Test Receiver', pfr_player_id: 'RecvTe00', team: 'MIN', opponent: 'GB', offense_snaps: '0', defense_snaps: '0', st_snaps: '1', ...fields });
const g1 = game('g1', '2026-09-13'), g2 = game('g2', '2026-09-20'), g3 = game('g3', '2026-09-27'), g4 = game('g4', '2026-10-04');

test('counts games, not catches, and DNPs do not break a modern run', () => {
  const rows = calculate([appearance(g1, 8), appearance(g3, 1)], [g1, g2, g3]);
  assert.equal(rows.length, 1); assert.equal(rows[0].length, 2); assert.equal(rows[0].active, true); assert.equal(rows[0].lowerBound, false);
});
test('zero-catch appearance ends a run, and separate runs can both qualify', () => {
  const rows = calculate([appearance(g1), appearance(g2, 0), appearance(g3), appearance(g4)], [g1, g2, g3, g4]);
  assert.deepEqual(rows.map(r => r.length), [2, 1]); assert.equal(rows[1].endedBy.game, 'g2'); assert.equal(rows[1].active, false);
});
test('seasons and franchise changes do not reset streaks', () => {
  const old = game('old', '2025-12-28', 2025), next = game('next', '2026-09-13', 2026, 'SF', 'SEA');
  const [row] = calculate([appearance(old), appearance(next, 1, 'SF')], [old, next]);
  assert.equal(row.length, 2); assert.deepEqual(row.teams, ['MIN', 'SF']);
});
test('current roster membership alone cannot turn an ended streak green', () => {
  const [ended] = calculate([appearance(g1), appearance(g2, 0)], [g1, g2]); assert.equal(ended.active, false);
  const [inactive] = calculate([appearance(g1)], [g1], players(), new Set()); assert.equal(inactive.active, false); assert.equal(inactive.endedBy, null);
});
test('snap-only special-teams or defensive appearances count as zero catches', () => {
  const normalized = receivingAppearances([stats(g1)], [snap(g1), snap(g2, { st_snaps: '0', defense_snaps: '1' })], [g1, g2], players());
  assert.equal(normalized.appearances.length, 2); assert.equal(normalized.appearances[1].receptions, 0);
  assert.equal(calculate(normalized.appearances, [g1, g2])[0].endedBy.game, 'g2');
});
test('zero total snaps and postseason rows are excluded', () => {
  const result = receivingAppearances([{ ...stats(g1), season_type: 'POST' }], [snap(g1, { st_snaps: '0' }), snap(g2, { game_type: 'POST' })], [g1, g2], players());
  assert.equal(result.appearances.length, 0);
});
test('stats and snaps merge by player identity without double-counting', () => {
  const result = receivingAppearances([stats(g1, '4')], [snap(g1)], [g1], players());
  assert.equal(result.appearances.length, 1); assert.equal(result.appearances[0].receptions, 4);
});
test('unmapped PFR IDs can match a unique normalized box-score name', () => {
  const result = receivingAppearances([stats(g1)], [snap(g1, { pfr_player_id: 'Different00' })], [g1], new Map());
  assert.equal(result.appearances.length, 1); assert.equal(result.appearances[0].id, 'p');
});
test('directory names and other games supply missing historical names', () => {
  const result = receivingAppearances([{ ...stats(g1), player_display_name: '' }, stats(g2)], [], [g1, g2], new Map());
  assert.equal(result.appearances[0].name, 'Test Receiver');
});
test('anonymous zero-catch team events do not become players', () => {
  const result = receivingAppearances([{ ...stats(g1, '0'), player_id: '0', player_display_name: '' }], [], [g1], players()); assert.equal(result.appearances.length, 0);
});
test('invalid counts, duplicate box scores and mismatched opponents fail closed', () => {
  assert.throws(() => receivingAppearances([stats(g1, '-')], [], [g1], players()), /Invalid receptions/);
  assert.throws(() => receivingAppearances([stats(g1), stats(g1)], [], [g1], players()), /Duplicate/);
  assert.throws(() => receivingAppearances([{ ...stats(g1), opponent_team: 'CHI' }], [], [g1], players()), /Invalid receiving/);
  assert.throws(() => calculate([appearance(g1), appearance(g1)], [g1]), /Duplicate/);
  assert.throws(() => calculate([appearance(g1, -1)], [g1]), /Invalid catch/);
});
test('pre-participation missing games split runs instead of guessing DNP or zero catches', () => {
  const old = [game('a', '2012-09-09', 2012), game('missing', '2012-09-16', 2012), game('b', '2012-09-23', 2012)];
  const rows = calculate([appearance(old[0]), appearance(old[2])], old, players(2010));
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.length === 1 && r.lowerBound && !r.active));
  assert.equal(rows.find(r => r.start.game === 'a').gapAfter.game, 'missing');
  assert.equal(rows.find(r => r.start.game === 'b').startUnknown, true);
});
test('a known zero-catch appearance establishes the exact start of the next run', () => {
  const old = game('old', '2012-12-30', 2012);
  const [row] = calculate([appearance(old, 0), appearance(g1)], [old, g1], players(1998));
  assert.equal(row.lowerBound, false); assert.equal(row.startUnknown, false);
});
test('veterans already playing before the source boundary are minimums', () => {
  const old = game('old', '1999-09-12', 1999);
  const [row] = calculate([appearance(old)], [old], players(1990)); assert.equal(row.lowerBound, true); assert.equal(row.startUnknown, true); assert.ok(row.gapAfter);
});
test('known missing rookie-season box score leaves the initial start unverified', () => {
  const missing = game('1999_01_BAL_STL', '1999-09-12', 1999, 'STL', 'BAL');
  const next = game('next', '1999-09-19', 1999, 'LA', 'SF');
  const [row] = calculate([appearance(next, 1, 'LA')], [missing, next], players(1999)); assert.equal(row.startUnknown, true);
});
test('documented older totals replace fragments without fabricating dates', () => {
  const old = game('old', '1999-09-12', 1999), [fragment] = calculate([appearance(old)], [old], players(1990));
  const archive = { ...structuredClone(RECEIVING_ARCHIVE[0]), playerId: 'p', id: 'archive:p', start: { season: 1990, date: null }, last: { season: 2004, date: null } };
  const merged = mergeReceivingArchive([fragment], [archive]); assert.equal(merged.length, 1); assert.equal(merged[0].length, 274); assert.equal(merged[0].start.date, null);
});
test('a fully calculated archive match retains its exact game dates', () => {
  const [row] = calculate([appearance(g1)], [g1]);
  const archive = { ...row, id: 'archive:p', archive: true, source: 'https://example.com/record' };
  const merged = mergeReceivingArchive([row], [archive]); assert.equal(merged.length, 1); assert.equal(merged[0].archive, false); assert.equal(merged[0].source, archive.source);
});
test('top 100 ranks are deterministic and unknown dates sort last in count ties', () => {
  const rows = Array.from({ length: 102 }, (_, i) => ({ id: String(i), name: `Player ${String(i).padStart(3, '0')}`, length: 2, start: { date: i === 0 ? null : '2020-01-01' } }));
  const top = topReceivingStreaks(rows.reverse()); assert.equal(top.length, 100); assert.equal(top[0].id, '1'); assert.equal(top.at(-1).rank, 100);
});
test('saved snapshot has 100 valid ranks, partial coverage, sourced archives and no invented historical dates', () => {
  const saved = JSON.parse(readFileSync(new URL('../data/receiving-streaks.json', import.meta.url)));
  assert.equal(saved.historicalCoverage, 'partial'); assert.equal(saved.leaders.length, 100); assert.ok(saved.missingGames.length >= 3);
  assert.equal(new Set(saved.leaders.map(r => r.id)).size, 100);
  saved.leaders.forEach((r, i) => { assert.equal(r.rank, i + 1); assert.ok(r.length > 0); if (r.archive) { assert.match(r.source, /^https:\/\//); assert.equal(r.active, false); } if (r.active) { assert.equal(r.endedBy, null); assert.equal(r.gapAfter, null); } });
});
