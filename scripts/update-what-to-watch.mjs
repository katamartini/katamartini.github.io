import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SOURCE_URL } from '../nfl/divstreaks-data.mjs';
import { readGames, calculateDroughts } from '../nfl/droughts-data.mjs';
import { archiveByTeam, ARCHIVE_ROWS_SHA256 } from '../nfl/droughts-archive.mjs';
import { parseCsv, currentRoster, normalizeTeam } from '../nfl/franchise-leaders-data.mjs';
import { validStartingHistory } from '../nfl/qbs-history.mjs';
import { buildWatchSnapshot, validWatchSnapshot } from '../nfl/what-to-watch-data.mjs';

const now = new Date(), season = now.getUTCMonth() < 8 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const cache = new URL('../.cache/what-to-watch/', import.meta.url);
const destination = new URL('../data/what-to-watch.json', import.meta.url);
await mkdir(cache, { recursive: true });
async function source(url, file) {
  const path = new URL(file, cache);
  if (process.argv.includes('--cached')) return readFile(path, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const text = await response.text();
  await writeFile(path, text);
  return text;
}
const readJSON = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const csv = await source(SOURCE_URL, 'games.csv');
const games = readGames(csv);
const rawGames = new Map(parseCsv(csv).map(g => [g.game_id, g]));
for (const game of games) {
  game.location = rawGames.get(game.id).location;
  game.kickoff = rawGames.get(game.id).gametime || null; // nflverse times are US Eastern.
}
if (games.filter(g => g.completed).length < 7000 || !games.some(g => g.season === season)) throw new Error('Incomplete game feed; keeping saved watch list');
if (new Set(games.map(g => g.id)).size !== games.length) throw new Error('Duplicate games');
const [qbs, receiving, kicking, archive] = await Promise.all(['qbs', 'receiving-streaks', 'kicking', 'droughts-history'].map(readJSON));
if (createHash('sha256').update(JSON.stringify(archive.rows)).digest('hex') !== ARCHIVE_ROWS_SHA256) throw new Error('Historical results checksum changed');
if (qbs.season !== season || !validStartingHistory(qbs.history) || !qbs.history.recentComplete ||
  receiving.season !== season || !Array.isArray(receiving.watchStreaks) || !Array.isArray(receiving.weeklyResults) || kicking.season !== season || !Array.isArray(kicking.weeklyResults) ||
  !['fg', 'all'].every(key => Array.isArray(kicking.views[key]))) throw new Error('Missing current-season player feeds; keeping saved watch list');
const rosterUrl = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;
const roster = currentRoster(parseCsv(await source(rosterUrl, `roster-${season}.csv`)), season);
const currentTeams = new Map(roster.rows.filter(p => ['ACT', 'INA', 'RES', 'DEV', 'EXE'].includes(p.status) && p.gsis_id)
  .map(p => [p.gsis_id, normalizeTeam(p.team)]));
const postseasonBaseline = Object.fromEntries(calculateDroughts(games.filter(g => g.season < season)).teams.map(row => [row.team, row.last]));
const data = buildWatchSnapshot({ games, season, earlierByTeam: archiveByTeam(archive.rows), qbs, receiving, kicking, currentTeams, postseasonBaseline });
data.sources = { schedule: SOURCE_URL, historicalResults: archive.source, roster: rosterUrl,
  qbs: '/data/qbs.json', receiving: '/data/receiving-streaks.json', kicking: '/data/kicking.json' };
if (!validWatchSnapshot(data)) throw new Error('Watch list validation failed; keeping saved data');
let saved;
try { saved = await readJSON('what-to-watch'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (saved && (saved.season > season || saved.through > data.through || Object.keys(data.coverage).some(key => saved.coverage[key] > data.coverage[key])))
  throw new Error('A source feed regressed; keeping saved watch list');
const sourceHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
if (saved?.sourceHash === sourceHash) console.log('What to watch is unchanged.');
else {
  await writeFile(destination, `${JSON.stringify({ ...data, sourceHash, checkedAt: now.toISOString() }, null, 2)}\n`);
  console.log(`Saved ${data.watch.length} watches for ${data.week ? `Week ${data.week.week}` : 'the offseason'} and ${data.ended.length} ended runs in ${season}; results through ${data.through}.`);
}
