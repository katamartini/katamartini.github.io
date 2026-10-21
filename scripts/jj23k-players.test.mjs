import test from 'node:test';
import assert from 'node:assert/strict';
import { baselinePlayerIds } from './jj23k-players.mjs';

test('a zero-yard namesake cannot overwrite the established receiver, regardless of feed order', () => {
  const veteran = ['veteran', { name: 'Justin Jefferson', yards: 258, later: { yards: 166 } }];
  const rookie = ['rookie', { name: 'Justin Jefferson', yards: 0, later: { yards: 0 } }];
  const past = new Map([['veteran', { name: 'Justin Jefferson', yards: 8480 }]]);
  for (const rows of [[veteran, rookie], [rookie, veteran]]) {
    const players = new Map(rows);
    const ids = baselinePlayerIds([[94, 'Justin Jefferson', 8572]], players, past);
    assert.equal(ids.get('Justin Jefferson'), 'veteran');
    assert.equal(8572 + players.get(ids.get('Justin Jefferson')).later.yards, 8738);
    assert.deepEqual([...players.keys()].filter(id => !new Set(ids.values()).has(id)), ['rookie']);
  }
});

test('historical identities and suffix variants resolve to the same NFL ID', () => {
  const ids = baselinePlayerIds([[1, 'Steve Smith'], [2, 'Retired Receiver']],
    new Map([['smith', { name: 'Steve Smith Sr.', beforeSeasonYards: 0 }]]),
    new Map([['smith', { name: 'Steve Smith Sr.', yards: 14000 }], ['retired', { name: 'Retired Receiver', yards: 9000 }]]));
  assert.equal(ids.get('Steve Smith'), 'smith');
  assert.equal(ids.get('Retired Receiver'), 'retired');
});

test('known stable IDs take priority and unresolved equal names fail safely', () => {
  const players = new Map([['a', { name: 'Same Name' }], ['b', { name: 'Same Name' }]]);
  assert.throws(() => baselinePlayerIds([[1, 'Same Name']], players, new Map()), /Ambiguous/);
  assert.equal(baselinePlayerIds([[1, 'Same Name']], players, new Map(), new Map([['Same Name', 'a']])).get('Same Name'), 'a');
  assert.equal(baselinePlayerIds([[1, 'Older Player']], players, new Map()).size, 0);
});
