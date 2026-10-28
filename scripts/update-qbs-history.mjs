import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SOURCE_URL, TEAMS } from '../nfl/divstreaks-data.mjs';
import { normalizeTeam, parseCsv } from '../nfl/franchise-leaders-data.mjs';
import { parseRoster, rosterUrl } from '../nfl/longest-tenure-data.mjs';
import { parseStarter, starterUrl } from '../nfl/qbs-data.mjs';
import { QB_HISTORY_SOURCE, QB_HISTORY_SHA256, historicalStartingStreaks, readStartingHistory, validStartingHistory } from '../nfl/qbs-history.mjs';

const cache = new URL('../.cache/qbs/', import.meta.url);
async function download(url, label) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (cause) { throw new Error(`${label}: ${url}`, { cause }); }
}

export function serializeQbData(data) {
  const { streaks, ...coverage } = data.history;
  return `${JSON.stringify({ ...data, history: { ...coverage, streaks: [] } }, null, 2).replace('"streaks": []', `"streaks": [\n${streaks.map(row => `      ${JSON.stringify(row)}`).join(',\n')}\n    ]`)}\n`;
}

export async function readVerifiedStarter(team, game) {
  const path = new URL(`${game.id}_${team}.json`, cache);
  let saved = JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));
  if (!saved || saved.schemaVersion !== 1) {
    const response = await download(starterUrl(game.event, team), `QB starter ${game.id} ${team}`);
    saved = { schemaVersion: 1, espn: parseStarter(await response.json()) };
    await writeFile(path, JSON.stringify(saved));
  }
  if (!/^\d+$/.test(saved.espn)) throw new Error(`Bad starter cache: ${game.id}`);
  return saved.espn;
}

export async function buildStartingHistory(schedule, through, { rosters = [], getStarter = readVerifiedStarter, archiveAndCurrent = null } = {}) {
  await mkdir(cache, { recursive: true });
  const path = new URL('starter-archive.csv', cache);
  let csv = await readFile(path, 'utf8').catch(() => null);
  if (!csv) {
    const response = await download(QB_HISTORY_SOURCE, 'QB starter archive');
    csv = await response.text();
  }
  if (createHash('sha256').update(csv).digest('hex') !== QB_HISTORY_SHA256) throw new Error('QB starter archive checksum mismatch');
  await writeFile(path, csv);
  const archive = parseCsv(csv);
  const verified = new Map();
  const players = new Map(rosters.filter(row => row.espn_id && row.gsis_id).map(row => [String(row.espn_id), { playerId: row.gsis_id, name: row.full_name }]));
  const recent = schedule.filter(row => row.game_type === 'REG' && Number(row.season) >= 2023 && row.gameday <= through && row.home_score !== '' && row.away_score !== '');
  if (!archiveAndCurrent) {
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < recent.length) {
        const row = recent[cursor++];
        for (const side of ['home', 'away']) {
          const team = normalizeTeam(row[`${side}_team`]);
          const game = { id: row.game_id, event: row.espn, date: row.gameday };
          const espn = await getStarter(team, game);
          const player = players.get(espn);
          if (!player) throw new Error(`Missing verified QB identity: ESPN ${espn}, ${game.id}`);
          verified.set(`${game.id}:${team}`, player);
        }
      }
    }));
  }
  const games = readStartingHistory(archive, archiveAndCurrent ? schedule.filter(row => Number(row.season) <= 2022) : schedule, through, verified);
  const streaks = historicalStartingStreaks(games);
  if (archiveAndCurrent) {
    // An explicit partial import preserves verified records without presenting
    // primary-passers or missing recent games as official historical starts.
    for (const run of streaks.filter(row => row.active)) { run.active = false; run.endKnown = false; }
    for (const current of archiveAndCurrent) {
      const index = streaks.findIndex(row => row.team === current.team && row.playerId === current.id && row.start.date === current.start.date);
      const run = { id: `${current.team}:${current.start.id}:${current.id}`, playerId: current.id, name: current.name, team: current.team, length: current.length, start: current.start, last: current.last, startKnown: true, endKnown: true, active: true };
      if (index < 0) streaks.push(run); else streaks[index] = run;
    }
  }
  const history = { firstSeason: 1950, lastCompleteSeason: archiveAndCurrent ? 2022 : Math.max(...games.map(row => row.game.season)) - 1, recentComplete: !archiveAndCurrent, through, sources: [QB_HISTORY_SOURCE, SOURCE_URL, 'https://sports.core.api.espn.com'], streaks };
  if (!validStartingHistory(history)) throw new Error('Incomplete historical starting streak coverage');
  const latestSeason = archiveAndCurrent ? 2023 : Math.max(...games.map(row => row.game.season));
  // A missing season/game must not silently join two runs into a record.
  for (const team of Object.keys(TEAMS)) {
    const teamGames = games.filter(row => row.team === team);
    for (let year = 1999; year < latestSeason; year += 1) {
      if (team === 'HOU' && year < 2002) continue;
      const expected = year >= 2021 ? year === 2022 && ['BUF', 'CIN'].includes(team) ? 16 : 17 : 16;
      if (teamGames.filter(row => row.game.season === year).length !== expected) throw new Error(`Incomplete QB starter season: ${team} ${year}`);
    }
  }
  return history;
}

// Refresh just the historical views while preserving the current ESPN/roster
// snapshot. The daily update-qbs.mjs refreshes both snapshots together.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const path = new URL('../data/qbs.json', import.meta.url);
  const data = JSON.parse(await readFile(path, 'utf8'));
  const response = await download(SOURCE_URL, 'QB schedule');
  const schedule = parseCsv(await response.text());
  const archiveAndCurrent = process.argv.includes('--archive-and-current-only') ? data.starts : null;
  const rosters = [];
  if (!archiveAndCurrent) {
    for (let year = 2023; year <= data.season; year += 1) {
      const response = await download(rosterUrl(year), `QB roster ${year}`);
      rosters.push(...parseRoster(await response.text()));
    }
  }
  data.history = await buildStartingHistory(schedule, data.through, { rosters, archiveAndCurrent });
  data.schemaVersion = 2;
  await writeFile(path, serializeQbData(data));
  console.log(`Saved ${data.history.streaks.length} starting streaks; ${data.history.recentComplete ? `1950 through ${data.through}` : '1950–2022 plus verified active streaks; other recent runs unavailable'}.`);
}
