import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateKickingStreaks, kickingView, kickFromPlay, readProjectedCsv } from './kicking-data.mjs';
import { HISTORICAL_GAMES, historicalKicks } from './kicking-history.mjs';
import { HISTORICAL_STREAKS, mergeHistoricalStreaks } from './kicking-archive.mjs';

async function* chunks(text, size = 3) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
const kick = (i, type = 'FG', made = true, extra = {}) => ({ id: 'kicker', shortName: 'T.Kicker', season: 2025, week: 1,
  date: '2025-09-07', game: '2025_01_KC_LAC', play: i, team: 'KC', opponent: 'LAC', type, made,
  result: made ? 'made' : 'missed', distance: 35, ...extra });
const player = new Map([['kicker', { name: 'Test Kicker', rookieSeason: 2020 }]]);

test('streamed CSV projection preserves quoted delimiters, newlines, escaped quotes, CRLF and chunk boundaries', async () => {
  const csv = 'ignore,name,value\r\n"skip,this","A ""quoted"" name",1\r\nother,"two\nlines",2\r\n';
  for (const size of [1, 2, 9, 1000]) {
    const rows = [];
    await readProjectedCsv(chunks(csv, size), ['name', 'value'], row => rows.push(row));
    assert.deepEqual(rows, [{ name: 'A "quoted" name', value: '1' }, { name: 'two\nlines', value: '2' }]);
  }
  await assert.rejects(readProjectedCsv(chunks('name\n"unfinished'), ['name'], () => {}), /Unclosed/);
  await assert.rejects(readProjectedCsv(chunks('other\nx'), ['name'], () => {}), /Missing/);
  await assert.rejects(readProjectedCsv(chunks('name,other\nx'), ['name'], () => {}), /Incomplete/);
});

test('only official regular-season kicks count; blocked and failed kicks break streaks', () => {
  const row = { play_id: '5', game_id: '2025_01_KC_LAC', season: '2025', season_type: 'REG', week: '1', game_date: '2025-09-07',
    posteam: 'SD', defteam: 'OAK', play_type: 'field_goal', field_goal_attempt: '1', extra_point_attempt: '0',
    field_goal_result: 'made', kicker_player_id: 'kicker', kicker_player_name: 'T.Kicker', kick_distance: '50' };
  assert.equal(kickFromPlay(row).made, true);
  assert.equal(kickFromPlay(row).team, 'LAC');
  assert.equal(kickFromPlay({ ...row, field_goal_result: 'blocked' }).made, false);
  assert.equal(kickFromPlay({ ...row, field_goal_result: 'aborted', kicker_player_id: '' }), null);
  assert.equal(kickFromPlay({ ...row, play_type: 'no_play' }), null);
  assert.equal(kickFromPlay({ ...row, season_type: 'POST' }), null);
  assert.equal(kickFromPlay({ ...row, field_goal_attempt: '0' }), null);
  assert.throws(() => kickFromPlay({ ...row, field_goal_result: '' }), /Unknown/);
  assert.throws(() => kickFromPlay({ ...row, kicker_player_id: '' }), /Incomplete/);
  assert.equal(kickFromPlay({ ...row, field_goal_attempt: '0', extra_point_attempt: '1', extra_point_result: 'good' }).made, true);
  assert.equal(kickFromPlay({ ...row, field_goal_attempt: '0', extra_point_attempt: '1', extra_point_result: 'failed' }).made, false);
});

test('FG view ignores extra-point misses; combined view counts both kick types in order', () => {
  const attempts = [kick(0, 'FG', false), ...Array.from({ length: 20 }, (_, i) => kick(i + 1)),
    kick(21, 'XP', false), ...Array.from({ length: 20 }, (_, i) => kick(i + 22)), kick(42, 'FG', false)];
  const views = calculateKickingStreaks(attempts, player);
  assert.equal(views.fg.length, 1);
  assert.equal(views.fg[0].length, 40);
  assert.equal(views.fg[0].endedBy.play, 42);
  assert.equal(views.all.length, 0);
});

test('every qualifying maximal streak is retained, including active streaks and exact cutoffs', () => {
  const attempts = [kick(0, 'FG', false), ...Array.from({ length: 40 }, (_, i) => kick(i + 1, i % 2 ? 'XP' : 'FG')),
    kick(41, 'FG', false), ...Array.from({ length: 40 }, (_, i) => kick(i + 42, i % 2 ? 'XP' : 'FG'))];
  const views = calculateKickingStreaks(attempts.reverse(), player, new Set(['kicker']));
  assert.equal(views.fg.length, 2);
  assert.equal(views.all.length, 2);
  assert.equal(views.all[0].fieldGoals, 20);
  assert.equal(views.all[0].extraPoints, 20);
  assert.equal(views.all[0].active, false);
  assert.equal(views.all[1].active, true);
  assert.equal(views.all[1].endedBy, null);
  assert.equal(views.all[0].name, 'Test Kicker');
  assert.equal(calculateKickingStreaks(Array.from({ length: 19 }, (_, i) => kick(i)), player).fg.length, 0);
  assert.equal(calculateKickingStreaks(Array.from({ length: 39 }, (_, i) => kick(i, 'XP')), player).all.length, 0);
});

test('streaks follow the kicker across seasons and teams, without resets for inactivity or other kickers', () => {
  const attempts = Array.from({ length: 20 }, (_, i) => kick(i, 'FG', true,
    i < 10 ? { season: 2024, date: '2024-12-29', game: '2024_17_KC_PIT' } : { season: 2025, date: '2025-09-07', game: '2025_01_SF_SEA', team: 'SF', opponent: 'SEA' }));
  attempts.push(kick(21, 'FG', false, { id: 'other' }));
  const row = calculateKickingStreaks(attempts, player).fg[0];
  assert.deepEqual(row.teams, ['KC', 'SF']);
  assert.equal(row.length, 20);
  assert.equal(row.active, false); // Unbroken at last appearance is not automatically active.
  assert.equal(row.endedBy, null);
});

test('1999 boundary streaks are lower bounds until an observed miss or a known career start', () => {
  const attempts = Array.from({ length: 20 }, (_, i) => kick(i, 'FG', true, { season: 1999 }));
  const veteran = new Map([['kicker', { name: 'Veteran', rookieSeason: 1995 }]]);
  assert.equal(calculateKickingStreaks(attempts, veteran).fg[0].lowerBound, true);
  assert.equal(calculateKickingStreaks([kick(-1, 'FG', false), ...attempts], veteran).fg[0].lowerBound, false);
  assert.equal(calculateKickingStreaks(attempts, new Map([['kicker', { name: 'Rookie', rookieSeason: 1999 }]])).fg[0].lowerBound, false);
  assert.throws(() => calculateKickingStreaks([...attempts, attempts[0]], veteran), /Duplicate/);
  assert.equal(kickingView('#all'), 'all');
  assert.equal(kickingView('#invalid'), 'fg');
});

test('saved history retains known record streaks and internally consistent dates and counts', async () => {
  const data = JSON.parse(await readFile(new URL('../data/kicking.json', import.meta.url), 'utf8'));
  assert.equal(data.firstSeason, 1999);
  assert.equal(data.sources.length, data.season - 1999 + 1);
  const vinatieri = data.views.fg.find(row => row.name === 'Adam Vinatieri' && row.start.date === '2015-10-04');
  assert.equal(vinatieri.length, 44);
  assert.equal(vinatieri.last.date, '2016-11-06');
  assert.equal(vinatieri.endedBy.date, '2016-11-20');
  const vanderjagt = data.views.all.find(row => row.name === 'Mike Vanderjagt' && row.start.date === '2002-12-15');
  assert.equal(vanderjagt.length, 98);
  assert.equal(vanderjagt.fieldGoals, 42);
  assert.equal(vanderjagt.extraPoints, 56);
  for (const [view, rows] of Object.entries(data.views)) {
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    for (const row of rows) {
      assert.ok(row.length >= (view === 'fg' ? 20 : 40));
      assert.equal(row.fieldGoals + row.extraPoints, row.length);
      if (row.start.date && row.last.date) assert.ok(row.start.date <= row.last.date);
      if (row.last.date) assert.ok(row.last.date <= data.through);
      if (row.archive) {
        assert.equal(row.active, false);
        assert.ok(row.source.startsWith('https://'));
        assert.ok(row.period && row.note);
      } else { assert.ok(row.start.date && row.last.date); }
      if (row.endedBy) { assert.ok(row.last.date <= row.endedBy.date); assert.equal(row.active, false); }
    }
  }
});

test('partial older archive preserves sourced counts without inventing dates or attempt sequences', () => {
  assert.equal(HISTORICAL_STREAKS.fg.length, 5);
  const fg = new Map(HISTORICAL_STREAKS.fg.map(row => [row.id, row]));
  assert.equal(fg.get('archive:gary-anderson-1997-98').length, 40);
  assert.deepEqual(fg.get('archive:gary-anderson-1997-98').teams, ['SF', 'MIN']);
  assert.equal(fg.get('archive:gary-anderson-1997-98').start.date, null);
  assert.equal(fg.get('archive:fuad-reveiz-1994-95').start.date, '1994-10-10');
  assert.equal(fg.get('archive:fuad-reveiz-1994-95').last.date, '1995-09-17');
  assert.equal(fg.get('archive:john-carney-1992-93').length, 29);
  assert.equal(fg.get('archive:john-carney-1994').length, 21);
  assert.equal(fg.get('archive:chris-boniol-1996').length, 27);
  const segment = HISTORICAL_STREAKS.all[0];
  assert.equal(segment.length, 94);
  assert.equal(segment.fieldGoals, 35);
  assert.equal(segment.extraPoints, 59);
  assert.equal(segment.lowerBound, true);
  assert.equal(segment.segment, true);
  assert.equal(segment.start.date, null);
  for (const [view, rows] of Object.entries(HISTORICAL_STREAKS)) for (const row of rows) {
    assert.equal(row.fieldGoals + row.extraPoints, row.length);
    assert.ok(row.length >= (view === 'fg' ? 20 : 40));
    assert.equal(row.archive, true);
    assert.equal(row.active, false);
    assert.equal(row.endedBy, null); // Unknown is not an invented missed kick.
    assert.ok(row.source.startsWith('https://'));
    assert.ok(row.note && row.period);
  }
});

test('weekly regeneration retains older records once and does not change or join modern runs', () => {
  const modern = calculateKickingStreaks(Array.from({ length: 40 }, (_, i) => kick(i)), player, new Set(['kicker']));
  const saved = structuredClone(modern);
  const merged = mergeHistoricalStreaks(modern);
  assert.deepEqual(modern, saved);
  assert.equal(merged.fg.length, modern.fg.length + 5);
  assert.equal(merged.all.length, modern.all.length + 1);
  assert.deepEqual(merged.fg.find(row => row.playerId === 'kicker'), modern.fg[0]);
  assert.ok(merged.fg.every((row, i, rows) => !i || rows[i - 1].length >= row.length));
  assert.deepEqual(mergeHistoricalStreaks(merged), merged);
  merged.fg.find(row => row.archive).teams.push('KC');
  assert.ok(HISTORICAL_STREAKS.fg.every(row => !row.teams.includes('KC')));
  assert.throws(() => mergeHistoricalStreaks({ fg: [] }), /Missing/);
});

test('missing attempt sequences censor both sides of a gap rather than creating a false streak', () => {
  const before = Array.from({ length: 20 }, (_, i) => kick(i));
  const after = Array.from({ length: 20 }, (_, i) => kick(i + 21, 'FG', true, { date: '2025-09-21', game: '2025_03_KC_LAC' }));
  const gap = kick(0, 'gap', false, { date: '2025-09-14', game: '2025_02_KC_LAC', source: 'https://example.com/boxscore' });
  const views = calculateKickingStreaks([...before, ...after], player, new Set(['kicker']), [gap]);
  assert.equal(views.fg.length, 2);
  assert.ok(views.fg.every(row => row.length === 20 && row.lowerBound));
  assert.equal(views.fg[0].active, false);
  assert.equal(views.fg[0].gapAfter.date, '2025-09-14');
  assert.equal(views.fg[0].startUnknown, false);
  assert.equal(views.fg[1].startUnknown, true);
  assert.equal(views.all.length, 0);
});

test('historical supplements restore only miss-free totals and do not duplicate restored PBP games', () => {
  const names = HISTORICAL_GAMES.flatMap(game => game.kickers.map(row => row.name));
  const players = new Map(names.map((name, i) => [`id-${i}`, { name, rookieSeason: 1990 }]));
  const result = historicalKicks([], players);
  assert.equal(result.gaps.length, 2);
  assert.equal(result.additions.length, 18);
  assert.ok(result.additions.every(kick => kick.made));
  assert.equal(result.additions.filter(kick => kick.shortName === 'Olindo Mare').length, 4);
  assert.equal(result.gaps.find(gap => gap.shortName === 'John Carney').fieldGoalsAttempted, 2);
  assert.equal(historicalKicks(HISTORICAL_GAMES.map(game => ({ game: game.game })), players).additions.length, 0);
});
