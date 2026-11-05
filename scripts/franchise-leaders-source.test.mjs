import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEAMS } from '../nfl/divstreaks-data.mjs';
import { VIEWS } from '../nfl/franchise-leaders-data.mjs';
import { downloadLeaderboard, downloadValidated } from './franchise-leaders-source.mjs';
import { refreshFranchiseLeaders } from './update-franchise-leaders.mjs';

const quiet = { sleep: async () => {}, warn: () => {}, log: () => {} };
const url = 'https://www.statmuse.com/nfl/ask/lions-all-time-receiving-yards-leaders';
function html(view = 'receiving') {
  const config = VIEWS[view];
  return `<table><thead><tr><th>NAME</th>${config.stats.map(stat => `<th>${stat.source}</th>`).join('')}</tr></thead><tbody>${
    ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Tail'].map((name, i) => `<tr><td><a title="${name}">${name}</a></td>${
      config.stats.map(stat => `<td>${stat.key === config.metric ? config.minimum + 4 - i : 100}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const broken = '<title>Lions receiving leaders</title><table><thead><tr><th>NAME</th><th>YDS</th></tr></thead></table>';

test('a transient DET column mismatch is refetched and diagnostics explain the response', async () => {
  const logs = [], delays = [];
  let calls = 0;
  const result = await downloadLeaderboard(url, 'DET', 'receiving', {
    fetchImpl: async () => new Response(++calls === 1 ? broken : html(), { headers: { 'content-type': 'text/html' } }),
    sleep: async ms => delays.push(ms), warn: line => logs.push(JSON.parse(line)),
  });
  assert.equal(calls, 2);
  assert.equal(result.length, 5);
  assert.deepEqual(delays, [1000]);
  assert.equal(logs[0].team, 'DET');
  assert.equal(logs[0].view, 'receiving');
  assert.equal(logs[0].status, 200);
  assert.equal(logs[0].contentType, 'text/html');
  assert.deepEqual(logs[0].headers, [['NAME', 'YDS']]);
  assert.equal(logs[0].title, 'Lions receiving leaders');
  assert.match(logs[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(logs[0].bytes, Buffer.byteLength(broken));
  assert.equal(logs[0].retry, true);
});

test('persistent malformed responses stop after three attempts', async () => {
  let calls = 0;
  const delays = [], logs = [];
  await assert.rejects(downloadLeaderboard(url, 'DET', 'receiving', {
    fetchImpl: async () => { calls++; return new Response(broken); },
    sleep: async ms => delays.push(ms), warn: line => logs.push(JSON.parse(line)),
  }), /after 3 attempt.*keeping saved records/);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(logs[2].retry, false);
});

test('network, timeout, body-read, throttling and server failures retry; permanent HTTP failures do not', async () => {
  for (const failure of [new TypeError('fetch failed'), new DOMException('Timed out', 'TimeoutError'), 429, 503, 'body']) {
    let calls = 0;
    const result = await downloadValidated(url, text => text, { ...quiet, fetchImpl: async () => {
      if (++calls > 1) return new Response('valid');
      if (failure instanceof Error) throw failure;
      if (failure === 'body') return { ok: true, status: 200, headers: new Headers(), text: async () => { throw new Error('connection reset'); } };
      return new Response('', { status: failure });
    } });
    assert.equal(result, 'valid');
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(downloadValidated(url, text => text, { ...quiet, fetchImpl: async () => {
    calls++; return new Response('', { status: 404 });
  } }), /after 1 attempt/);
  assert.equal(calls, 1);
});

function sourceFetch(fail = () => false) {
  return async url => {
    if (url.includes('roster_')) return new Response('season,week,team,full_name,status\n' +
      Object.keys(TEAMS).map(team => `2026,8,${team},Alpha,ACT`).join('\n'));
    const view = Object.keys(VIEWS).find(view => url.endsWith(`${VIEWS[view].query}-leaders`));
    return new Response(fail(url) ? broken : html(view));
  };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'franchise-leaders-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const destination = join(dir, 'leaders.json');
  const original = '{"season":2026,"rosterWeek":7,"saved":"unchanged"}\n';
  await writeFile(destination, original);
  return { dir, destination, original, now: new Date('2026-10-29T00:00:00Z'), ...quiet };
}

test('DET failure after ten teams and a late sacks failure both preserve saved bytes', async t => {
  for (const target of ['lions-all-time-receiving', 'vikings-all-time-sack']) {
    const options = await fixture(t);
    const visited = [];
    await assert.rejects(refreshFranchiseLeaders({ ...options, fetchImpl: sourceFetch(url => {
      visited.push(url); return url.includes(target);
    }) }), /keeping saved records/);
    assert.equal(visited.filter(url => url.includes(target)).length, 3);
    assert.ok(visited.length >= 13);
    assert.equal(await readFile(options.destination, 'utf8'), options.original);
    assert.deepEqual(await readdir(options.dir), ['leaders.json']);
  }
});

test('dry run validates all 128 tables without writing; success atomically saves and unchanged sources are a no-op', async t => {
  const options = await fixture(t);
  let calls = 0;
  const fetchImpl = sourceFetch(() => { calls++; return false; });
  const result = await refreshFranchiseLeaders({ ...options, fetchImpl, dryRun: true });
  assert.equal(calls, 128);
  assert.equal(Object.keys(result.views).length, 4);
  assert.equal(await readFile(options.destination, 'utf8'), options.original);
  await refreshFranchiseLeaders({ ...options, fetchImpl });
  const saved = await readFile(options.destination, 'utf8');
  assert.equal(JSON.parse(saved).rosterWeek, 8);
  await refreshFranchiseLeaders({ ...options, now: new Date('2026-10-30'), fetchImpl });
  assert.equal(await readFile(options.destination, 'utf8'), saved);
  assert.deepEqual(await readdir(options.dir), ['leaders.json']);
});

test('regressed roster and incomplete views never replace saved records', async t => {
  const options = await fixture(t);
  const newer = '{"season":2026,"rosterWeek":9}\n';
  await writeFile(options.destination, newer);
  await assert.rejects(refreshFranchiseLeaders({ ...options, fetchImpl: sourceFetch() }), /regressed/);
  assert.equal(await readFile(options.destination, 'utf8'), newer);
  const normalFetch = sourceFetch();
  await assert.rejects(refreshFranchiseLeaders({ ...options, fetchImpl: async url => {
    const response = await normalFetch(url);
    return url.includes('statmuse') ? new Response((await response.text()).replace(/>[45]\d{3}</g, '>4000<')) : response;
  } }), /Incomplete receiving/);
  assert.equal(await readFile(options.destination, 'utf8'), newer);
});
