import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SOURCE_URL } from '../nfl/divstreaks-data.mjs';
import { parseCsv, normalizeTeam } from '../nfl/franchise-leaders-data.mjs';
import { TEAMS } from '../nfl/divstreaks-data.mjs';
import { latestCompletedSeason, readGames } from '../nfl/droughts-data.mjs';
import { ARCHIVE_SOURCE, ARCHIVE_SHA256, ARCHIVE_ROWS_SHA256, archiveByTeam, isHistoricalOpponent } from '../nfl/droughts-archive.mjs';
import { buildSeasonRows, validRecordData } from '../nfl/record-finder-data.mjs';

const now = new Date(), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
const activeSeason = now.getUTCFullYear() - (now.getUTCMonth() < 2 ? 1 : 0);
const hash = value => createHash('sha256').update(value).digest('hex');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response.text();
}
const cache = new URL('../.cache/record-finder/', import.meta.url);
await mkdir(cache, { recursive: true });
const archiveFile = new URL('historical.csv', cache);
let csv = await readFile(archiveFile, 'utf8').catch(() => null);
if (!csv || hash(csv) !== ARCHIVE_SHA256) { csv = await download(ARCHIVE_SOURCE); if (hash(csv) !== ARCHIVE_SHA256) throw new Error('Historical archive checksum changed'); await writeFile(archiveFile, csv); }
const archive = JSON.parse(await readFile(new URL('../data/droughts-history.json', import.meta.url), 'utf8'));
if (hash(JSON.stringify(archive.rows)) !== ARCHIVE_ROWS_SHA256) throw new Error('Historical season history changed');
const earlier = archiveByTeam(archive.rows);
const normalize = code => TEAMS[normalizeTeam(code)] ? normalizeTeam(code) : `historical:${code}`;
const historicalPost = parseCsv(csv).filter(row => row.playoff === '1' && Number(row.season) <= 1998).map(row => {
  const home = normalize(row.team1), away = normalize(row.team2);
  if (![home, away].every(team => TEAMS[team] || isHistoricalOpponent(team)) || row.score1 === '' || row.score2 === '') throw new Error('Invalid historical playoff game');
  return { id: `archive-post:${row.date}:${home}:${away}`, season: Number(row.season), type: 'POST', date: row.date, home, away, homeScore: Number(row.score1), awayScore: Number(row.score2), completed: true };
});
const games = readGames(await download(SOURCE_URL)).filter(game => game.date <= today || !game.completed);
if (games.some(game => game.completed && (!Number.isInteger(game.homeScore) || game.homeScore < 0 || !Number.isInteger(game.awayScore) || game.awayScore < 0)) || new Set(games.map(g => g.id)).size !== games.length) throw new Error('Invalid or duplicated modern results');
const throughSeason = latestCompletedSeason(games);
if (throughSeason < activeSeason - 1) throw new Error('Completed-season results are stale');
for (let year = 1999; year <= throughSeason; year++) {
  const post = games.filter(g => g.season === year && g.type !== 'REG' && g.completed);
  if (post.length !== (year >= 2020 ? 13 : 11) || post.some(g => g.homeScore === g.awayScore)) throw new Error(`Incomplete postseason: ${year}`);
}
const seasons = buildSeasonRows(games, earlier, historicalPost, throughSeason, activeSeason, today);
const through = games.filter(g => g.completed && g.season <= activeSeason).map(g => g.date).sort().at(-1);
const data = { schemaVersion: 1, checkedAt: now.toISOString(), through, activeSeason, throughSeason, firstSeason: 1920,
  sources: [ARCHIVE_SOURCE, SOURCE_URL], archiveSha256: ARCHIVE_SHA256,
  historicalLicense: 'https://github.com/fivethirtyeight/nfl-elo-game/blob/master/LICENSE', seasons };
if (!validRecordData(data)) throw new Error('Invalid record-finder snapshot');
const destination = new URL('../data/record-finder.json', import.meta.url);
const saved = JSON.parse(await readFile(destination, 'utf8').catch(error => { if (error.code === 'ENOENT') return 'null'; throw error; }));
if (saved && (saved.through > through || saved.throughSeason > throughSeason || saved.activeSeason > activeSeason || saved.seasons.length > seasons.length || saved.seasons.some(previous => {
  const row = seasons.find(row => row.team === previous.team && row.season === previous.season);
  return !row || row.games < previous.games;
}))) throw new Error('Refusing to regress published season coverage');
await writeFile(destination, `${JSON.stringify(data)}\n`);
console.log(`Saved ${seasons.length} team-seasons, 1920–${throughSeason} completed; active ${activeSeason}; games through ${through}.`);
