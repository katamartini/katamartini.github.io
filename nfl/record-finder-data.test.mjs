import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildSeasonRows, currentComparisons, filterSeasons, recordKey, recordText, summarize, validateRecord, validRecordData } from './record-finder-data.mjs';
import { TEAMS } from './divstreaks-data.mjs';

const data = JSON.parse(await readFile(new URL('../data/record-finder.json', import.meta.url), 'utf8'));
const filters = { team: 'all', era: 'all', format: 'all', from: 1920, to: data.activeSeason, ongoing: false };
const find = (team, season) => data.seasons.find(row => row.team === team && row.season === season);

test('record inputs count ties and reject impossible, fractional and missing counts', () => {
  assert.equal(validateRecord(3, 2, 1), 6); assert.equal(validateRecord(0, 0, 0), 0); assert.equal(validateRecord(17, 0, 0), 17);
  for (const input of [[-1, 1, 0], [10, 8, 0], [1.5, 0, 0], [NaN, 0, 0], [3, 2, undefined]]) assert.throws(() => validateRecord(...input));
  assert.equal(recordKey(3, 2, 0), '3-2-0'); assert.equal(recordText(3, 2, 0), '3-2'); assert.equal(recordText(3, 2, 1), '3-2-1');
});
test('a starting record is the exact cumulative W-L-T after N games, not any record reached later', () => {
  const rows = [{ ...find('NE', 2007), records: ['0-0-0', '1-0-0', '1-1-0', '2-1-0', '2-2-0'] }];
  assert.equal(filterSeasons(rows, filters, { wins: 2, losses: 1, ties: 0 }).length, 1);
  assert.equal(filterSeasons(rows, filters, { wins: 3, losses: 0, ties: 0 }).length, 0);
  assert.equal(filterSeasons(rows, filters, { wins: 1, losses: 1, ties: 1 }).length, 0);
  assert.equal(filterSeasons(rows, filters, { wins: 0, losses: 0, ties: 0 }).length, 1);
});
test('era, format, franchise and inclusive year bounds intersect correctly', () => {
  const record = { wins: 0, losses: 0, ties: 0 };
  const modern = filterSeasons(data.seasons, { ...filters, era: 'sb', format: '17', team: 'BUF', from: 2021, to: 2023 }, record);
  assert.deepEqual(modern.map(row => row.season).sort(), [2021, 2022, 2023]);
  assert.equal(find('BUF', 2022).games, 16); assert.equal(find('BUF', 2022).format, 17);
  assert.equal(find('CIN', 2022).games, 16); assert.equal(find('CIN', 2022).format, 17);
  assert.ok(filterSeasons(data.seasons, { ...filters, format: '17' }, record).every(row => row.season >= 2021));
  const strike = filterSeasons(data.seasons, { ...filters, era: 'sb', format: '9' }, record);
  assert.ok(strike.length === 28 && strike.every(row => row.season === 1982));
  assert.ok(filterSeasons(data.seasons, { ...filters, era: 'merger' }, record).every(row => row.season >= 1970));
  assert.equal(filterSeasons(data.seasons, { ...filters, from: 2007, to: 2007, team: 'NE', format: '16' }, record).length, 1);
});
test('known undefeated seasons retain regular-season records and correct Super Bowl outcomes', () => {
  const ne = find('NE', 2007), mia = find('MIA', 1972);
  assert.equal(recordText(ne.wins, ne.losses, ne.ties), '16-0'); assert.equal(ne.superBowl, true); assert.equal(ne.superBowlWin, false); assert.equal(ne.outcome, 'Lost Super Bowl'); assert.equal(ne.playoffWins, 2);
  assert.equal(recordText(mia.wins, mia.losses, mia.ties), '14-0'); assert.equal(mia.superBowlWin, true); assert.equal(mia.playoffWins, 3);
  assert.equal(filterSeasons([ne, mia], filters, { wins: 14, losses: 0, ties: 0 }).length, 2);
  assert.equal(filterSeasons([ne, mia], filters, { wins: 16, losses: 0, ties: 0 }).length, 1);
  const sample = summarize([ne, mia]); assert.equal(sample.playoffs.percent, 100); assert.equal(sample.superBowlWin.percent, 50);
});
test('era-specific denominators and empty samples are explicit, never treating N/A or ongoing as failure', () => {
  const rows = [find('CHI', 1920), find('CHI', 1933), find('MIA', 1972), find('BUF', data.activeSeason)];
  const summary = summarize(rows);
  assert.equal(summary.count, 3); assert.equal(summary.ongoing, 1);
  assert.equal(summary.playoffs.total, 2); assert.equal(summary.playoffs.count, 2);
  assert.equal(summary.superBowlWin.total, 1); assert.equal(summary.superBowlWin.count, 1);
  assert.equal(summarize([]).superBowlWin.percent, null); assert.equal(summarize([]).avgWins, null);
  assert.equal(summarize([find('CHI', 1920)]).playoffs.percent, null);
});
test('unfinished seasons are optional results but always excluded from completed outcome statistics', () => {
  const current = find('BUF', data.activeSeason);
  const record = { wins: current.wins, losses: current.losses, ties: current.ties };
  assert.ok(!filterSeasons(data.seasons, filters, record).some(row => !row.complete));
  assert.ok(filterSeasons(data.seasons, { ...filters, ongoing: true }, record).some(row => row.team === 'BUF' && row.season === data.activeSeason));
  assert.equal(summarize([current]).count, 0);
  assert.equal(current.playoffs, null); assert.equal(current.superBowlWin, null);
});
test('current comparisons use the same franchise and record, exclude the active year and honor history filters', () => {
  const rows = currentComparisons(data, { ...filters, ongoing: true });
  assert.equal(rows.length, 32);
  for (const row of rows) {
    assert.ok(row.matches.every(prior => prior.team === row.team && prior.season < data.activeSeason && prior.complete && prior.records[row.games] === recordKey(row.wins, row.losses, row.ties)));
    assert.equal(row.summary.count, row.matches.length);
  }
  assert.equal(currentComparisons(data, { ...filters, team: 'MIN', from: data.activeSeason, to: data.activeSeason })[0].summary.count, 0);
});
test('byes do not add games, ties advance a start, relocation and wartime history stay with each franchise', () => {
  const tied = find('MIN', 1967);
  assert.ok(tied.ties > 0);
  const match = tied.records.find(value => Number(value.split('-')[2]) > 0).split('-').map(Number);
  assert.ok(filterSeasons([tied], filters, { wins: match[0], losses: match[1], ties: match[2] }).length === 1);
  assert.equal(find('LA', 1999).superBowlWin, true); assert.equal(find('LV', 1983).superBowlWin, true);
  const phi = find('PHI', 1943), pit = find('PIT', 1943);
  assert.deepEqual(phi.records, pit.records);
  assert.ok(!find('CLE', 1996));
});
test('snapshot validates unique, internally consistent team seasons and current coverage', () => {
  assert.equal(validRecordData(data), true);
  assert.ok(data.seasons.length > 2200);
  assert.equal(data.seasons.filter(row => row.season === data.activeSeason).length, 32);
  for (const mutate of [copy => copy.seasons.push(copy.seasons[0]), copy => copy.seasons[0].records[0] = '1-0-0', copy => copy.seasons[0].records[1] = '0-2-0', copy => copy.seasons[0].wins = 100, copy => copy.seasons = copy.seasons.filter(row => row.team !== 'BUF'), copy => copy.seasons[0].superBowlWin = true]) {
    const copy = structuredClone(data); mutate(copy); assert.equal(validRecordData(copy), false);
  }
});
test('incomplete season history and duplicate games fail instead of publishing false results', () => {
  assert.throws(() => buildSeasonRows([], { BUF: [{ id: 'one', season: 1998, date: '1998-09-01', home: 'BUF', away: 'NE', homeScore: 7, awayScore: 0, completed: true }] }, [], 1998, 1999, '1999-10-01'), /Missing unique Super Bowl/);
  const game = { id: 'one', type: 'REG', season: 1965, date: '1965-09-01', home: 'BUF', away: 'NE', homeScore: 7, awayScore: 0, completed: true };
  assert.throws(() => buildSeasonRows([], { BUF: [game] }, [], 1965, 1966, '1966-10-01'), /Incomplete regular season/);
  assert.throws(() => buildSeasonRows([], { BUF: [game, { ...game, id: 'duplicate' }] }, [], 1965, 1966, '1966-10-01'), /Duplicate team game/);
});
test('game chronology skips byes and postseason while ties advance the cumulative record', () => {
  const game = (date, homeScore, awayScore, type = 'REG') => ({ id: date, type, season: 2026, date, home: 'BUF', away: 'NE', homeScore, awayScore, completed: true });
  const rows = buildSeasonRows([game('2026-09-28', 0, 7), game('2026-09-07', 7, 0), game('2026-09-21', 3, 3), game('2026-10-01', 7, 0, 'WC')], {}, [], 1965, 2026, '2026-10-10');
  const buffalo = rows.find(row => row.team === 'BUF');
  assert.deepEqual(buffalo.records, ['0-0-0', '1-0-0', '1-0-1', '1-1-1']);
  assert.equal(buffalo.games, 3); assert.equal(buffalo.playoffWins, null);
});
test('completed historical Super Bowl counts are exactly one champion and two participants per season', () => {
  for (let season = 1966; season <= data.throughSeason; season++) {
    const rows = data.seasons.filter(row => row.season === season);
    assert.equal(rows.filter(row => row.superBowlWin).length, 1, String(season));
    assert.equal(rows.filter(row => row.superBowl).length, 2, String(season));
  }
});
test('both NFL indexes link to the requested extensionless page', async () => {
  for (const file of ['../nfl.html', './index.html']) assert.ok((await readFile(new URL(file, import.meta.url), 'utf8')).includes('href="/nfl/record-finder/"'));
  const html = await readFile(new URL('./record-finder/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('href="#current"')); assert.ok(html.includes('href="/nfl/football.svg"'));
  assert.ok(Object.keys(TEAMS).length === 32);
});
