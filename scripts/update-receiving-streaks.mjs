import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { parseCsv, currentRoster } from '../nfl/franchise-leaders-data.mjs';
import { readProjectedCsv } from '../nfl/kicking-data.mjs';
import { FIRST_STATS_SEASON, FIRST_PARTICIPATION_SEASON, KNOWN_MISSING_GAMES, KNOWN_INCOMPLETE_GAMES, STAT_COLUMNS, SNAP_COLUMNS,
  receivingAppearances, calculateReceivingStreaks, mergeReceivingArchive, topReceivingStreaks } from '../nfl/receiving-streaks-data.mjs';
import { RECEIVING_ARCHIVE } from '../nfl/receiving-streaks-archive.mjs';

const now = new Date(), season = now.getUTCMonth() < 8 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const root = 'https://github.com/nflverse/nflverse-data/releases/download';
const cache = new URL('../.cache/receiving-streaks/', import.meta.url), destination = new URL('../data/receiving-streaks.json', import.meta.url);
await mkdir(cache, { recursive: true });
async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`Download failed (${r.status}): ${url}`);
  return r;
}
async function projected(url, name, columns) {
  const file = new URL(`${name}.json`, cache);
  let saved;
  try { saved = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  const r = await fetch(url, { headers: saved?.schemaVersion === 1 && saved.etag ? { 'If-None-Match': saved.etag } : {}, signal: AbortSignal.timeout(90000) });
  if (r.status === 304 && saved?.schemaVersion === 1) return saved.rows;
  if (!r.ok) throw new Error(`Stats download failed (${r.status}): ${name}`);
  const stream = Readable.fromWeb(r.body).pipe(createGunzip()); stream.setEncoding('utf8');
  const rows = [];
  await readProjectedCsv(stream, columns, row => rows.push(row));
  if (!rows.length) throw new Error(`Empty source: ${name}`);
  await writeFile(file, JSON.stringify({ schemaVersion: 1, etag: r.headers.get('etag'), rows }));
  return rows;
}
const scheduleUrl = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const schedule = parseCsv(await (await download(scheduleUrl)).text()).filter(g => g.game_type === 'REG' &&
  Number(g.season) >= FIRST_STATS_SEASON && Number(g.season) <= season && g.home_score !== '' && g.away_score !== '');
const playersUrl = `${root}/players/players.csv`;
const players = new Map(parseCsv(await (await download(playersUrl)).text()).map(p => [p.gsis_id, p]));
const rosterUrl = `${root}/rosters/roster_${season}.csv`;
const roster = currentRoster(parseCsv(await (await download(rosterUrl)).text()), season);
const currentIds = new Set(roster.rows.filter(p => ['ACT', 'INA', 'RES', 'DEV', 'EXE'].includes(p.status)).map(p => p.gsis_id).filter(Boolean));
let stats = [], snaps = [];
const sources = [];
for (let year = FIRST_STATS_SEASON; year <= season; year++) {
  const url = `${root}/stats_player/stats_player_week_${year}.csv.gz`;
  const rows = (await projected(url, `stats-${year}`, STAT_COLUMNS)).filter(r => r.season_type === 'REG');
  if (year < season && rows.length < 5000) throw new Error(`Incomplete player stats: ${year}`);
  stats.push(...rows); sources.push({ kind: 'stats', season: year, url });
  if (year >= FIRST_PARTICIPATION_SEASON) {
    const url = `${root}/snap_counts/snap_counts_${year}.csv.gz`;
    const rows = (await projected(url, `snaps-${year}`, SNAP_COLUMNS)).filter(r => r.game_type === 'REG');
    if (year < season && rows.length < 15000) throw new Error(`Incomplete participation: ${year}`);
    snaps.push(...rows); sources.push({ kind: 'participation', season: year, url });
  }
  console.log(`Checked ${year} receiving stats${year >= FIRST_PARTICIPATION_SEASON ? ' and participation' : ''}`);
}
const unassigned = stats.filter(r => (!r.player_id || r.player_id === '0' || r.player_id === 'XX-0000001') && Number(r.receptions) > 0);
if (unassigned.some(r => !KNOWN_INCOMPLETE_GAMES.includes(r.game_id))) throw new Error('New unassigned catches in box-score feed; retaining saved data');
const incompleteIds = new Set(unassigned.map(r => r.game_id));
stats = stats.filter(r => !incompleteIds.has(r.game_id) && r.player_id && r.player_id !== 'XX-0000001' &&
  // One historical non-receiving row has no team or opponent. Do not invent
  // an affiliation; all other malformed player rows still fail validation.
  !(r.game_id === '1999_09_PHI_CAR' && r.player_id === '00-0001471' && r.receptions === '0' && !r.team && !r.opponent_team));
const statsGames = new Set(stats.map(r => r.game_id)), snapGames = new Set(snaps.map(r => r.game_id));
const latest = set => schedule.filter(g => set.has(g.game_id)).map(g => g.gameday).sort().at(-1);
const through = [latest(statsGames), latest(snapGames)].sort()[0];
if (!through || stats.length < 100000 || snaps.length < 150000) throw new Error('Incomplete receiving history; keeping saved data');
const games = schedule.filter(g => g.gameday <= through);
const missing = games.filter(g => !statsGames.has(g.game_id) || Number(g.season) >= FIRST_PARTICIPATION_SEASON && !snapGames.has(g.game_id));
const unexpected = missing.filter(g => !KNOWN_MISSING_GAMES.includes(g.game_id) && !incompleteIds.has(g.game_id));
if (unexpected.length) throw new Error(`Uncovered receiving games: ${unexpected.map(g => g.game_id).join(', ')}`);
const missingGames = missing.map(g => ({ game: g.game_id, date: g.gameday, home: g.home_team, away: g.away_team,
  reason: incompleteIds.has(g.game_id) ? 'Unassigned catches; game excluded conservatively' : 'Missing box score' }));
const gameIds = new Set(games.map(g => g.game_id));
stats = stats.filter(r => gameIds.has(r.game_id)); snaps = snaps.filter(r => gameIds.has(r.game_id));
const { appearances, participationGames } = receivingAppearances(stats, snaps, games, players);
const calculated = calculateReceivingStreaks(appearances, games, participationGames, players, currentIds);
const leaders = topReceivingStreaks(mergeReceivingArchive(calculated, RECEIVING_ARCHIVE));
if (leaders.length !== 100 || !leaders.some(r => r.name === 'Jerry Rice' && r.length === 274) || !leaders.some(r => r.name === 'Larry Fitzgerald' && r.length === 256))
  throw new Error('Receiving leaderboard validation failed; retaining saved data');
const latestWeek = Math.max(...games.filter(g => Number(g.season) === season).map(g => Number(g.week)));
if (!Number.isFinite(latestWeek)) throw new Error('No current-season games; retaining saved data');
const sourceHash = createHash('sha256').update(JSON.stringify({ season, through, latestWeek, rosterWeek: roster.week, missingGames, leaders })).digest('hex');
let saved;
try { saved = JSON.parse(await readFile(destination, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (saved && (through < saved.through || season * 100 + roster.week < saved.season * 100 + saved.rosterWeek)) throw new Error('Receiving feed regressed');
if (sourceHash === saved?.sourceHash) console.log('Receiving streaks are unchanged.');
else {
  await writeFile(destination, `${JSON.stringify({ schemaVersion: 1, checkedAt: now.toISOString(), season, through, latestWeek,
    rosterWeek: roster.week, firstStatsSeason: FIRST_STATS_SEASON, firstParticipationSeason: FIRST_PARTICIPATION_SEASON,
    historicalCoverage: 'partial', missingGames, sourceHash, sources, scheduleSource: scheduleUrl, rosterSource: rosterUrl, leaders }, null, 2)}\n`);
  console.log(`Saved top ${leaders.length} recorded receiving streaks through ${through}.`);
}
