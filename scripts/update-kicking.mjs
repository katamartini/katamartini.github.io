import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { parseCsv, currentRoster, normalizeName, normalizeTeam } from '../nfl/franchise-leaders-data.mjs';
import { FIRST_SEASON, KICK_COLUMNS, readProjectedCsv, kickFromPlay, calculateKickingStreaks } from '../nfl/kicking-data.mjs';
import { historicalKicks } from '../nfl/kicking-history.mjs';

const now = new Date();
const season = now.getUTCMonth() < 8 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const cacheDirectory = new URL('../.cache/kicking/', import.meta.url);
const destination = new URL('../data/kicking.json', import.meta.url);
const sourceUrl = year => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${year}.csv.gz`;
const playersUrl = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
const rosterUrl = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;
async function download(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}
await mkdir(cacheDirectory, { recursive: true });
const playerRows = parseCsv(await (await download(playersUrl)).text());
const players = new Map(playerRows.map(row => [row.gsis_id, { name: row.display_name, rookieSeason: Number(row.rookie_season) }]));
const roster = currentRoster(parseCsv(await (await download(rosterUrl)).text()), season);
const currentIds = new Set(playerRows.filter(row => roster.memberships.has(`${normalizeTeam(row.latest_team)}:${normalizeName(row.display_name)}`)).map(row => row.gsis_id));
// Use roster player IDs directly as well: the player directory's latest team can lag.
for (const row of roster.rows) if (['ACT', 'INA', 'RES', 'DEV', 'EXE'].includes(row.status) && row.gsis_id) currentIds.add(row.gsis_id);
const attempts = [], sources = [];
let latestDate = '', latestWeek = 0;
for (let year = FIRST_SEASON; year <= season; year++) {
  const url = sourceUrl(year), cacheFile = new URL(`${year}.json`, cacheDirectory);
  let cache = null;
  try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  // Revalidate historical files using source ETags, so corrections are included.
  const response = await fetch(url, { headers: cache?.schemaVersion === 1 && cache.etag ? { 'If-None-Match': cache.etag } : {}, signal: AbortSignal.timeout(180000) });
  let kicks;
  if (response.status === 304 && cache?.schemaVersion === 1) {
    kicks = cache.attempts;
    console.log(`${year}: cached ${kicks.length} kicks`);
  } else {
    if (!response.ok) throw new Error(`PBP download failed (${response.status}): ${year}`);
    kicks = [];
    const stream = Readable.fromWeb(response.body).pipe(createGunzip());
    stream.setEncoding('utf8');
    await readProjectedCsv(stream, KICK_COLUMNS, row => { const kick = kickFromPlay(row); if (kick) kicks.push(kick); });
    if (year < season && kicks.length < 1500) throw new Error(`Incomplete historical season: ${year}`);
    await writeFile(cacheFile, JSON.stringify({ schemaVersion: 1, etag: response.headers.get('etag'), attempts: kicks }));
    console.log(`${year}: downloaded ${kicks.length} kicks`);
  }
  attempts.push(...kicks);
  for (const kick of kicks) {
    if (kick.date > latestDate) latestDate = kick.date;
    if (kick.season === season) latestWeek = Math.max(latestWeek, kick.week);
  }
  sources.push({ season: year, url });
}
if (attempts.length < 50000 || !latestDate) throw new Error('Incomplete kick history; retaining saved data');
const history = historicalKicks(attempts, players);
attempts.push(...history.additions);
const scheduleUrl = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const schedule = parseCsv(await (await download(scheduleUrl)).text());
const coveredGames = new Set([...attempts, ...history.gaps].map(kick => kick.game));
const missingGames = schedule.filter(game => Number(game.season) >= FIRST_SEASON && Number(game.season) <= season &&
  game.game_type === 'REG' && game.gameday <= latestDate && game.home_score !== '' && game.away_score !== '' && !coveredGames.has(game.game_id));
if (missingGames.length) throw new Error(`Uncovered games; retaining saved data: ${missingGames.map(game => game.game_id).join(', ')}`);
const views = calculateKickingStreaks(attempts, players, currentIds, history.gaps);
const sourceHash = createHash('sha256').update(JSON.stringify({ season, rosterWeek: roster.week, through: latestDate, historicalSources: history.sources, gaps: history.gaps, views })).digest('hex');
let saved = null;
try { saved = JSON.parse(await readFile(destination, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (saved && (latestDate < saved.through || season * 100 + roster.week < saved.season * 100 + saved.rosterWeek)) throw new Error('Source feed regressed; retaining saved data');
if (saved?.sourceHash === sourceHash) console.log('Kicking streaks are unchanged.');
else {
  await writeFile(destination, `${JSON.stringify({ schemaVersion: 1, checkedAt: now.toISOString(), firstSeason: FIRST_SEASON, season,
    through: latestDate, latestWeek, rosterWeek: roster.week, sourceHash, sources, historicalSources: history.sources,
    gaps: history.gaps.map(({ id, shortName, date, game, source }) => ({ playerId: id, name: shortName, date, game, source })), views }, null, 2)}\n`);
  console.log(`Saved ${views.fg.length} field-goal streaks and ${views.all.length} combined streaks, through ${latestDate}.`);
}
