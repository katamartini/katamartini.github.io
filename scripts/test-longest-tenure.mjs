import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { calculateTenures, parseRoster } from '../nfl/longest-tenure-data.mjs';
import { TEAMS } from '../nfl/divstreaks-data.mjs';

test('CSV handles quoted names, commas, escaped quotes and historical files without weeks', () => {
  const [row] = parseRoster('season,team,gsis_id,full_name,position,status\r\n2020,OAK,1,"Player, ""Jr.""",LS,ACT\r\n');
  assert.equal(row.full_name, 'Player, "Jr."');
  assert.equal(row.team, 'LV');
  assert.equal(row.week, 0);
  assert.throws(() => parseRoster('season,team\n2026,BUF'), /Missing roster column/);
});

test('counts current franchise seasons, preserves ties, handles byes and excludes former players', () => {
  const row = (id, team, season, status = 'ACT', week = 5) => ({
    gsis_id: id, full_name: id, team, season, status, week, position: 'LS',
  });
  const rows = Object.keys(TEAMS).map((team) => row(`rookie-${team}`, team, 2026));
  rows.push(row('veteran', 'BUF', 2024, 'DEV'), row('veteran', 'BUF', 2025, 'RES'), row('veteran', 'BUF', 2026));
  rows.push(row('tied', 'BUF', 2024), row('tied', 'BUF', 2025), row('tied', 'BUF', 2026));
  rows.push(row('released', 'BUF', 2010), row('released', 'BUF', 2026, 'CUT'));
  rows.push(row('retired', 'BUF', 2010), row('retired', 'BUF', 2026, 'RET'));
  rows.push(row('stale', 'BUF', 2010), row('stale', 'BUF', 2026, 'ACT', 2));
  rows.push(row('returned', 'MIA', 2023), row('returned', 'MIA', 2024), row('returned', 'NYJ', 2024), row('returned', 'MIA', 2025), row('returned', 'MIA', 2026));
  rows.push(row('gap', 'NE', 2023), row('gap', 'NE', 2025), row('gap', 'NE', 2026));
  for (const record of rows) if (record.team === 'CAR' && record.season === 2026) record.week = 4;
  const result = calculateTenures(rows, 2026);
  assert.equal(result.teams.length, 32);
  const buffalo = result.teams.find((team) => team.team === 'BUF');
  assert.equal(buffalo.since, 2024);
  assert.deepEqual(buffalo.players.map((player) => player.name), ['tied', 'veteran']);
  assert.equal(result.teams.find((team) => team.team === 'MIA').since, 2024);
  assert.equal(result.teams.find((team) => team.team === 'NE').since, 2025);
  assert.equal(result.teams.find((team) => team.team === 'CAR').week, 4);
});

test('saved data and visible page cover all 32 teams consistently', async () => {
  const data = JSON.parse(await readFile(new URL('../data/longest-tenure.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../nfl/longest-tenure.html', import.meta.url), 'utf8');
  assert.deepEqual(data.teams.map((team) => team.team).sort(), Object.keys(TEAMS).sort());
  assert.equal((html.match(/<article class="team-row"/g) || []).length, 32);
  for (const team of data.teams) {
    assert.equal(team.seasons, data.season - team.since + 1);
    assert.ok(team.players.length);
    for (const player of team.players) {
      assert.equal(player.since, team.since);
      assert.ok(html.includes(player.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')));
    }
  }
  for (const file of ['../nfl/index.html', '../nfl.html']) {
    const index = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(index.includes('href="/nfl/longest-tenure.html"'));
  }
});
