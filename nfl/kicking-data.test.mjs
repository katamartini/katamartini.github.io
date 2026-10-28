import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KICKING_VIEWS, calculateKickingStreaks, kickingView, kickFromPlay, readProjectedCsv } from './kicking-data.mjs';
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
  assert.equal(kickingView('#near-fg'), 'near-fg');
  assert.equal(kickingView('#near-all'), 'near-all');
  assert.equal(kickingView('#constructor'), 'fg');
  assert.equal(kickingView('#invalid'), 'fg');
});

test('saved history retains known record streaks and internally consistent dates and counts', async () => {
  const data = JSON.parse(await readFile(new URL('../data/kicking.json', import.meta.url), 'utf8'));
  assert.equal(data.firstSeason, 1999);
  assert.equal(data.schemaVersion, 1); // Cached flawless-only pages still expect version 1.
  assert.equal(data.views['near-fg'].length, 100);
  assert.equal(data.views['near-all'].length, 100);
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
      const config = KICKING_VIEWS[view];
      assert.ok(row.length >= config.minimum);
      assert.equal(row.fieldGoals + row.extraPoints, row.length - (config.near ? 1 : 0));
      if (config.near) {
        assert.ok(!row.archive && row.beforeMiss > 0 && row.afterMiss > 0);
        assert.equal(row.beforeMiss + row.afterMiss + 1, row.length);
        assert.ok(row.start.date <= row.missed.date && row.missed.date <= row.last.date);
        assert.ok(['missed', 'blocked', 'failed'].includes(row.missed.result));
        if (!config.combined) assert.equal(row.missed.type, 'FG');
      }
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

test('near-streak lists retain exactly the 100 longest runs without limiting flawless views', () => {
  const attempts = [];
  for (let i = 0; i < 110; i++) {
    const start = i * 1000, id = `kicker-${i}`;
    attempts.push(...Array.from({ length: 40 }, (_, j) => kick(start + j, 'FG', true, { id })),
      kick(start + 40, 'FG', false, { id }),
      ...Array.from({ length: i + 1 }, (_, j) => kick(start + 41 + j, 'FG', true, { id })));
  }
  const views = calculateKickingStreaks(attempts, player);
  for (const view of ['near-fg', 'near-all']) {
    assert.equal(views[view].length, 100);
    assert.equal(views[view][0].length, 151);
    assert.equal(views[view].at(-1).length, 52);
    assert.deepEqual(new Set(views[view].map(row => row.playerId)),
      new Set(Array.from({ length: 100 }, (_, i) => `kicker-${i + 10}`)));
  }
  assert.ok(views.fg.length > 100);
  assert.ok(views.all.length > 100);
});

test('near-streaks include one internal miss in the attempt threshold and retain its details', () => {
  const attempts = [...Array.from({ length: 9 }, (_, i) => kick(i)), kick(9, 'FG', false, { distance: 55 }),
    ...Array.from({ length: 10 }, (_, i) => kick(i + 10)), kick(20, 'FG', false)];
  const near = calculateKickingStreaks(attempts, player, new Set(['kicker']))['near-fg'];
  assert.equal(near.length, 1);
  assert.equal(near[0].length, 20);
  assert.equal(near[0].fieldGoals, 19);
  assert.equal(near[0].beforeMiss, 9);
  assert.equal(near[0].afterMiss, 10);
  assert.equal(near[0].missed.play, 9);
  assert.equal(near[0].missed.distance, 55);
  assert.equal(near[0].endedBy.play, 20);
  assert.equal(near[0].active, false);
  const ongoing = calculateKickingStreaks(attempts.slice(0, -1).reverse(), player, new Set(['kicker']))['near-fg'][0];
  assert.equal(ongoing.active, true);
  assert.equal(ongoing.endedBy, null);
  assert.equal(calculateKickingStreaks(attempts.slice(0, -1), player)['near-fg'][0].active, false);
});

test('near-streaks require makes on both sides and exclude flawless runs and adjacent misses', () => {
  const makes = Array.from({ length: 40 }, (_, i) => kick(i + 1));
  for (const attempts of [makes, [kick(0, 'FG', false), ...makes], [...makes, kick(41, 'FG', false)],
    [...makes, kick(41, 'FG', false), kick(42, 'FG', false), ...makes.map(row => ({ ...row, play: row.play + 42 }))]]) {
    const views = calculateKickingStreaks(attempts, player);
    assert.equal(views['near-fg'].length, 0);
    assert.equal(views['near-all'].length, 0);
  }
  const short = [...makes.slice(0, 9), kick(10, 'FG', false), ...makes.slice(11, 20)];
  assert.equal(calculateKickingStreaks(short, player)['near-fg'].length, 0);
});

test('each internal miss gets its maximal near-streak, including overlapping make-runs', () => {
  const attempts = Array.from({ length: 32 }, (_, i) => kick(i, 'FG', i !== 10 && i !== 21));
  const rows = calculateKickingStreaks(attempts, player, new Set(['kicker']))['near-fg'];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.start.play, row.missed.play, row.last.play, row.length]),
    [[0, 10, 20, 21], [11, 21, 31, 21]]);
  assert.equal(rows[0].endedBy.play, 21);
  assert.equal(rows[1].active, true);
});

test('FG near-streaks ignore XP misses while combined near-streaks count blocked or failed kicks of either type', () => {
  const attempts = Array.from({ length: 43 }, (_, i) => kick(i, i === 10 ? 'XP' : 'FG', i !== 10 && i !== 21));
  const views = calculateKickingStreaks(attempts, player);
  assert.equal(views['near-fg'][0].length, 42);
  assert.equal(views['near-fg'][0].missed.play, 21);
  assert.equal(views['near-all'].length, 0); // Each of the two one-miss spans is below 40.
  for (const [type, result] of [['FG', 'blocked'], ['XP', 'failed']]) {
    const combined = [...Array.from({ length: 19 }, (_, i) => kick(i, 'XP')),
      kick(19, type, false, { result }), ...Array.from({ length: 20 }, (_, i) => kick(i + 20, 'FG'))];
    const row = calculateKickingStreaks(combined, player)['near-all'][0];
    assert.equal(row.length, 40);
    assert.equal(row.fieldGoals, 20);
    assert.equal(row.extraPoints, 19);
    assert.equal(row.missed.result, result);
    assert.equal(row.missed.type, type);
  }
});

test('near-streaks follow players across teams and seasons, but never join across unknown attempts', () => {
  const before = Array.from({ length: 10 }, (_, i) => kick(i, 'FG', true, { season: 1999 }));
  const miss = kick(10, 'FG', false, { team: 'SF', opponent: 'SEA', season: 1999 });
  const after = Array.from({ length: 10 }, (_, i) => kick(i + 11, 'FG', true,
    { date: '2026-09-07', game: '2026_01_BUF_MIA', season: 2026, team: 'BUF', opponent: 'MIA' }));
  const veteran = new Map([['kicker', { name: 'Veteran', rookieSeason: 1990 }]]);
  const row = calculateKickingStreaks([...before, miss, ...after], veteran)['near-fg'][0];
  assert.deepEqual(row.teams, ['KC', 'SF', 'BUF']); // The miss's team belongs to the span too.
  assert.equal(row.lowerBound, true);
  assert.equal(row.startUnknown, true);
  const gap = kick(0, 'gap', false, { date: '2026-01-01', game: '2025_18_KC_LAC', source: 'https://example.com' });
  assert.equal(calculateKickingStreaks([...before, miss, ...after], player, new Set(), [gap])['near-fg'].length, 0);
  const laterGap = { ...gap, date: '2026-09-14', game: '2026_02_KC_LAC' };
  const censored = calculateKickingStreaks([...before, miss, ...after], player, new Set(['kicker']), [laterGap])['near-fg'][0];
  assert.equal(censored.gapAfter.date, laterGap.date);
  assert.equal(censored.active, false);
  assert.equal(censored.lowerBound, true);
  const laterMiss = kick(25, 'FG', false, { date: '2026-09-21', game: '2026_03_KC_LAC' });
  const laterMakes = Array.from({ length: 19 }, (_, i) => kick(i + 26, 'FG', true, { date: '2026-09-21', game: '2026_03_KC_LAC' }));
  const resumed = calculateKickingStreaks([...before, miss, ...after, ...before.map(row => ({ ...row, play: row.play + 1, date: laterMiss.date, game: laterMiss.game })), laterMiss, ...laterMakes], player, new Set(), [laterGap])['near-fg'];
  assert.equal(resumed.length, 2);
  assert.equal(resumed.find(row => row.missed.play === 25).startUnknown, true);
  const merged = mergeHistoricalStreaks({ fg: [], all: [], 'near-fg': [row], 'near-all': [] });
  assert.deepEqual(merged['near-fg'], [row]);
  assert.deepEqual(mergeHistoricalStreaks(merged)['near-fg'], [row]);
});

test('near-streak output matches exhaustive windows for mixed kicks and interleaved kickers', () => {
  let seed = 17;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const attempts = Array.from({ length: 1000 }, (_, i) => kick(i, random() < .5 ? 'FG' : 'XP', random() > .04,
    { id: i % 3 ? 'kicker' : 'other' }));
  const views = calculateKickingStreaks(attempts, player);
  for (const view of ['near-fg', 'near-all']) {
    const config = KICKING_VIEWS[view], expected = [];
    for (const id of ['kicker', 'other']) {
      const kicks = attempts.filter(row => row.id === id && (config.combined || row.type === 'FG'));
      for (let i = 0; i < kicks.length; i++) {
        if (kicks[i].made) continue;
        let left = i - 1, right = i + 1;
        while (left >= 0 && kicks[left].made) left--;
        while (right < kicks.length && kicks[right].made) right++;
        if (i - left > 1 && right - i > 1 && right - left - 1 >= config.minimum)
          expected.push([id, kicks[left + 1].play, kicks[i].play, kicks[right - 1].play, right - left - 1, kicks[right]?.play ?? null]);
      }
    }
    const actual = views[view].map(row => [row.playerId, row.start.play, row.missed.play, row.last.play, row.length, row.endedBy?.play ?? null]);
    assert.deepEqual(actual.sort(), expected.sort());
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
  const boniol = fg.get('archive:chris-boniol-1996-97');
  assert.equal(boniol.length, 28);
  assert.deepEqual(boniol.teams, ['DAL', 'PHI']);
  assert.equal(boniol.last.date, '1997-08-31');
  assert.equal(boniol.endedBy.date, '1997-09-07');
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
    if (row.endedBy) assert.ok(row.endedBy.date >= row.last.date);
    else assert.equal(row.endedBy, null); // Unknown is not an invented missed kick.
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
