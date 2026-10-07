import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS } from './divstreaks-data.mjs';
import { VIEWS, buildLeaders, currentRoster, franchiseHighs, normalizeName, normalizeTeam, parseCsv, parseReceivingTable, parseLeaderboardTable, validRecord, viewFromHash } from './franchise-leaders-data.mjs';

function table(rows, headers = ['', '', 'NAME', 'REC YDS', 'GP', 'REC', 'REC TD']) {
  return `<table><thead><tr>${headers.map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(([name, yards, rec = 400, td = 30], i) =>
    `<tr><td>${i + 1}</td><td></td><td><a title="${name}">${name}<span>short name</span></a></td><td>${yards.toLocaleString('en-US')}</td><td>100</td><td>${rec}</td><td>${td}</td></tr>`).join('')}
    <tr>${headers.map(() => '<td><!-- placeholder --></td>').join('')}</tr></tbody></table>`;
}
const record = (team, name, yards) => ({ team, name, yards, receptions: 400, touchdowns: 30 });

test('franchise leaders follow yardage, independent of sort order, with tied leaders sharing first place', () => {
  const rows = [record('MIN', 'Justin Jefferson', 8659), record('SF', 'Jerry Rice', 19247),
    record('MIN', 'Cris Carter', 12383), record('SF', 'Terrell Owens', 8572),
    record('MIN', 'Tied Leader', 12383)];
  const highs = franchiseHighs(rows);
  assert.equal(highs.get('MIN'), 12383);
  assert.equal(highs.get('SF'), 19247);
  assert.deepEqual(rows.filter(row => row.yards === highs.get(row.team)).map(row => row.name),
    ['Jerry Rice', 'Cris Carter', 'Tied Leader']);
  assert.deepEqual([...franchiseHighs([...rows].reverse())].sort(), [...highs].sort());
});

test('receiving parser includes exactly 5,000 and ignores empty placeholders and abbreviated names', () => {
  const parsed = parseReceivingTable(table([['Jerry Rice', 19247], ['Test &amp; Receiver', 5000], ['Below Threshold', 4999]]), 'SF');
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], record('SF', 'Jerry Rice', 19247));
  assert.equal(parsed[1].name, 'Test & Receiver');
});

test('unexpected columns, broken rows, unsorted results, duplicates, and truncation fail closed', () => {
  assert.throws(() => parseReceivingTable('<html>challenge</html>', 'SF'), /Missing/);
  assert.throws(() => parseReceivingTable(`<title>Jets receiving</title>${table([['One', 4000]])}`, 'SF'), /Wrong franchise/);
  assert.throws(() => parseReceivingTable(table([['Name', 4000]], ['wrong']), 'SF'), /columns/);
  assert.throws(() => parseReceivingTable(table([['Name', 6000]]), 'SF'), /truncated/);
  assert.throws(() => parseReceivingTable(table([['One', 4000], ['Two', 5000]]), 'SF'), /leaderboard/);
  assert.throws(() => parseReceivingTable(table([['One', 6000], ['One', 4000]]), 'SF'), /leaderboard/);
  assert.throws(() => parseReceivingTable(table([['Name', 6000], ['Tail', 4000]]).replace('6,000', 'unknown'), 'SF'), /Invalid REC YDS/);
});

test('CSV parser preserves quoted commas, escaped quotes, CRLF, and empty fields', () => {
  assert.deepEqual(parseCsv('name,college,status\r\n"Player, Jr.","A ""College""",ACT\r\nOther,,RES\r\n'), [
    { name: 'Player, Jr.', college: 'A "College"', status: 'ACT' }, { name: 'Other', college: '', status: 'RES' },
  ]);
  assert.throws(() => parseCsv('name\n"unfinished'), /Unclosed/);
});

function rosterFixture() {
  return Object.keys(TEAMS).map(team => ({ season: '2026', week: '4', game_type: 'REG', team,
    full_name: `Player ${team}`, status: 'ACT' }));
}
test('current roster uses latest league-wide snapshot, including inactive/reserve/practice squad but excluding releases and retirement', () => {
  const rows = rosterFixture();
  rows.push(
    { season: '2026', week: '3', game_type: 'REG', team: 'TB', full_name: 'Mike Evans', status: 'ACT' },
    { season: '2026', week: '4', game_type: 'REG', team: 'SF', full_name: 'Mike Evans', status: 'ACT' },
    { season: '2026', week: '4', game_type: 'REG', team: 'MIN', full_name: 'Justin Jefferson', status: 'INA' },
    { season: '2026', week: '4', game_type: 'REG', team: 'KC', full_name: 'Injured Player', status: 'RES' },
    { season: '2026', week: '4', game_type: 'REG', team: 'KC', full_name: 'Practice Player', status: 'DEV' },
    { season: '2026', week: '4', game_type: 'REG', team: 'MIN', full_name: 'Adam Thielen', status: 'RET' },
    { season: '2026', week: '4', game_type: 'REG', team: 'KC', full_name: 'Released Player', status: 'CUT' },
  );
  const result = currentRoster(rows, 2026);
  assert.equal(result.week, 4);
  assert.ok(result.memberships.has('SF:mikeevans'));
  assert.ok(!result.memberships.has('TB:mikeevans'));
  for (const key of ['MIN:justinjefferson', 'KC:injuredplayer', 'KC:practiceplayer']) assert.ok(result.memberships.has(key));
  for (const key of ['MIN:adamthielen', 'KC:releasedplayer']) assert.ok(!result.memberships.has(key));
  assert.throws(() => currentRoster(rows.filter(row => row.team !== 'ARI'), 2026), /Incomplete/);
});

test('names normalize punctuation and suffixes; franchise aliases retain team continuity', () => {
  assert.equal(normalizeName('D.K. Metcalf'), normalizeName('DK Metcalf'));
  assert.equal(normalizeName('Steve Smith Sr.'), normalizeName('Steve Smith'));
  assert.equal(normalizeTeam('OAK'), 'LV');
  assert.equal(normalizeTeam('STL'), 'LA');
  assert.equal(normalizeTeam('SD'), 'LAC');
});

test('bye-week teams retain their most recent roster rather than making the feed incomplete', () => {
  const rows = rosterFixture();
  rows.find(row => row.team === 'KC').week = '3';
  const snapshot = currentRoster(rows, 2026);
  assert.equal(snapshot.week, 4);
  assert.ok(snapshot.memberships.has('KC:playerkc'));
  assert.equal(snapshot.rows.length, 32);
});

test('one player may qualify for two franchises, but only their current franchise is green', () => {
  const leaders = buildLeaders([record('GB', 'Davante Adams', 8121), record('LA', 'Davante Adams', 5000), record('SF', 'Jerry Rice', 19247)], new Set(['LA:davanteadams']));
  assert.equal(leaders[0].name, 'Jerry Rice');
  assert.equal(leaders.find(row => row.team === 'GB').current, false);
  assert.equal(leaders.find(row => row.team === 'LA').current, true);
  assert.throws(() => buildLeaders([record('GB', 'Duplicate', 5000), record('GB', 'Duplicate', 6000)], new Set()), /Invalid/);
});

function statTable(view, rows) {
  const stats = VIEWS[view].stats;
  return `<table><thead><tr><th>NAME</th>${stats.map(stat => `<th>${stat.source}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
    `<tr><td><a title="${row.name}">${row.name}</a></td>${stats.map(stat => `<td>${row[stat.key].toLocaleString('en-US')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

test('passing and rushing use their own columns, cutoffs, and franchise rankings', () => {
  const passing = [{ name: 'Pass Leader', yards: 30000, touchdowns: 210, interceptions: 95 },
    { name: 'At Cutoff', yards: 5000, touchdowns: 25, interceptions: 15 },
    { name: 'Below', yards: 4999, touchdowns: 20, interceptions: 10 }];
  const rushing = [{ name: 'Rush Leader', yards: 10000, attempts: 1900, touchdowns: 80 },
    { name: 'At Cutoff', yards: 5000, attempts: 1100, touchdowns: 30 },
    { name: 'Below', yards: 4999, attempts: 1000, touchdowns: 20 }];
  for (const [view, rows] of [['passing', passing], ['rushing', rushing]]) {
    const parsed = parseLeaderboardTable(statTable(view, rows), 'KC', view);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].yards, 5000);
    const leaders = buildLeaders([...parsed].reverse(), new Set([`KC:${normalizeName(rows[0].name)}`]), view);
    assert.equal(leaders[0].name, rows[0].name);
    assert.equal(leaders[0].current, true);
    assert.equal(leaders[1].current, false);
    assert.equal(franchiseHighs(leaders).get('KC'), rows[0].yards);
    assert.throws(() => parseLeaderboardTable(table([['Receiver', 4000]]), 'KC', view), /columns/);
    assert.throws(() => parseLeaderboardTable(statTable(view, rows.slice(0, 2)), 'KC', view), /truncated/);
  }
});

test('sacks retain half sacks, use 50 cutoff, and award all tied franchise leaders', () => {
  const rows = [{ name: 'Leader One', sacks: 126.5, games: 169 }, { name: 'Leader Two', sacks: 126.5, games: 170 },
    { name: 'At Cutoff', sacks: 50, games: 99 }, { name: 'Below', sacks: 49.5, games: 90 }, { name: 'Historic Third Sack', sacks: 28.3, games: 73 }];
  const parsed = parseLeaderboardTable(statTable('sacks', rows), 'KC', 'sacks');
  assert.equal(parsed.length, 3);
  const leaders = buildLeaders(parsed, new Set(['KC:leaderone']), 'sacks');
  const highs = franchiseHighs(leaders, 'sacks');
  assert.equal(highs.get('KC'), 126.5);
  assert.equal(leaders.filter(row => row.sacks === highs.get(row.team)).length, 2);
  assert.equal(leaders[0].current, true);
  assert.ok(!validRecord({ ...leaders[0], sacks: 50.25 }, 'sacks'));
  assert.ok(validRecord({ ...leaders[0], sacks: 50.3 }, 'sacks'));
  assert.ok(!validRecord({ ...leaders[0], games: 0 }, 'sacks'));
  assert.throws(() => parseLeaderboardTable(statTable('sacks', rows.slice(0, 3)), 'KC', 'sacks'), /truncated/);
});

test('stat view hashes resolve direct links and safely default unknown values', () => {
  for (const view of Object.keys(VIEWS)) assert.equal(viewFromHash(`#${view}`), view);
  for (const hash of ['', '#unknown', '#constructor', '#__proto__']) assert.equal(viewFromHash(hash), 'receiving');
});
