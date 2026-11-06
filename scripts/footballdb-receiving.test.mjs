import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDetroitReceiving, DET_RECEIVING_URL } from './footballdb-receiving.mjs';
import { downloadLeaderboard } from './franchise-leaders-source.mjs';

const fixture = await readFile(new URL('./fixtures/det-footballdb.html', import.meta.url), 'utf8');
test('real downloaded table yields six qualifying career receivers with full identities', () => {
  const rows = parseDetroitReceiving(fixture);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], {team:'DET', name:'Calvin Johnson', yards:11619, receptions:731, touchdowns:83});
  assert.deepEqual(rows[2], {team:'DET', name:'Amon-Ra St. Brown', yards:6823, receptions:600, touchdowns:49});
  assert.equal(rows.at(-1).name, 'Gail Cogdill');
});
test('wrong team, yearly page and missing regular-season declaration fail closed', () => {
  for (const altered of [fixture.replaceAll('Detroit Lions', 'Chicago Bears'), fixture.replaceAll('Career Receiving', 'Yearly Receiving'), fixture.replace('Only stats for Regular Season Games have been included.', '')]) assert.throws(() => parseDetroitReceiving(altered));
});
test('duplicate tables, missing or extra columns, and partial rows fail closed', () => {
  const table = fixture.match(/<table\b[\s\S]*<\/table>/)[0];
  for (const altered of [fixture + table, fixture.replace('>Yds<', '>Yards<'), fixture.replace('>Yds<', '>Yds</th><th>Season<'), fixture.replace('<td>731</td>', '')]) assert.throws(() => parseDetroitReceiving(altered));
});
test('invalid numbers, unsafe integers and mismatched player identities fail closed', () => {
  for (const altered of [fixture.replace('11,619', '11,61x'), fixture.replace('11,619', '9007199254740992'), fixture.replace('Calvin Johnson Stats', 'Fake Player Stats'), fixture.replace('/players/calvin-johnson-johnsca03', '/players/somebody-else')]) assert.throws(() => parseDetroitReceiving(altered));
});
test('duplicate players, unsorted yards, empty bodies and qualifying truncation fail closed', () => {
  const tbody = fixture.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...tbody.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(match => match[0]);
  for (const body of [rows[0]+tbody, rows[1]+rows[0]+rows.slice(2).join(''), '', rows.slice(0,6).join('')]) assert.throws(() => parseDetroitReceiving(fixture.replace(tbody, body)));
});
test('FootballDB HTTP 403 is terminal with one request and no alternate route', async () => {
  const urls = [];
  await assert.rejects(downloadLeaderboard(DET_RECEIVING_URL, 'DET', 'receiving', {
    fetchImpl: async url => { urls.push(url); return new Response('', {status:403}); },
    warn: () => {}, sleep: async () => { throw new Error('must not retry'); },
  }), /after 1 attempt/);
  assert.deepEqual(urls, [DET_RECEIVING_URL]);
});
test('FootballDB cannot be used for another team or stat view', () => {
  assert.throws(() => downloadLeaderboard(DET_RECEIVING_URL, 'ATL', 'receiving'), /scope/);
  assert.throws(() => downloadLeaderboard(DET_RECEIVING_URL, 'DET', 'passing'), /scope/);
});

test('missing first or middle row, duplicate player IDs and absent franchise history fail closed', () => {
  const tbody = fixture.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...tbody.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(match => match[0]);
  for (const altered of [fixture.replace(rows[0], ''), fixture.replace(rows[3], ''), fixture.replaceAll('/players/herman-moore-moorehe01', '/players/calvin-johnson-johnsca03'), fixture.replace(' and the Portsmouth Spartans (NFL) from 1930-1933', '')]) assert.throws(() => parseDetroitReceiving(altered));
});
