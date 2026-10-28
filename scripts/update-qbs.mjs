import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SOURCE_URL, TEAMS } from '../nfl/divstreaks-data.mjs';
import { parseCsv } from '../nfl/franchise-leaders-data.mjs';
import { parseRoster, rosterUrl } from '../nfl/longest-tenure-data.mjs';
import { completedTeamGames, parseStarter, qbTenures, starterUrl, startingStreak } from '../nfl/qbs-data.mjs';
import { buildStartingHistory, serializeQbData } from './update-qbs-history.mjs';

// Usage: node scripts/update-qbs.mjs [season] [--refresh-history]
const now = new Date();
const season = Number(process.argv.find(arg => /^20\d\d$/.test(arg)) || now.getUTCFullYear() - (now.getUTCMonth() < 7 ? 1 : 0));
if (!Number.isInteger(season) || season < 2009 || season > now.getUTCFullYear()) throw new Error('Invalid QB season');
const cache = new URL('../.cache/qbs/', import.meta.url);
await mkdir(cache, { recursive: true });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
async function download(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) { if (attempt === 2) throw new Error(`Download failed: ${url}`, { cause: error }); }
  }
}
const rosters = [];
for (let year = 2000; year <= season; year += 1) {
  const file = new URL(`roster_${year}.csv`, cache);
  let csv;
  if (year < season && !process.argv.includes('--refresh-history')) csv = await readFile(file, 'utf8').catch(() => null);
  if (!csv) { csv = await download(rosterUrl(year)); await writeFile(file, csv); }
  const rows = parseRoster(csv);
  if (!rows.length || rows.some(row => row.season !== year)) throw new Error(`Invalid roster ${year}`);
  rosters.push(...rows);
}
const roster = qbTenures(rosters, season);
const games = parseCsv(await download(SOURCE_URL));
for (const column of ['game_id', 'game_type', 'season', 'gameday', 'week', 'espn', 'home_score', 'away_score']) {
  if (!(column in (games[0] || {}))) throw new Error(`Missing game column: ${column}`);
}
const starts = [], unavailable = [], teams = Object.keys(TEAMS);
let cursor = 0, downloads = 0;
async function getStarter(team, game) {
  const file = new URL(`${game.id}_${team}.json`, cache);
  let saved = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
  // Recheck recent games for stat corrections. --refresh-history rechecks everything.
  if (!saved || saved.schemaVersion !== 1 || (Date.parse(today) - Date.parse(game.date)) < 14 * 86400000 || process.argv.includes('--refresh-history')) {
    const espn = parseStarter(JSON.parse(await download(starterUrl(game.event, team))));
    saved = { schemaVersion: 1, espn }; downloads += 1;
    await writeFile(file, JSON.stringify(saved));
  }
  if (!/^\d+$/.test(saved.espn)) throw new Error(`Bad starter cache: ${game.id}`);
  return saved.espn;
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < teams.length) {
    const team = teams[cursor++];
    const history = completedTeamGames(games, team, season, today);
    const streak = await startingStreak(history, game => getStarter(team, game));
    const player = roster.players.find(row => row.team === team && row.espn === streak.espn);
    if (player) starts.push({ ...player, ...streak });
    else unavailable.push({ team, reason: 'Latest starter is not on the current eligible QB roster.' });
    console.log(`${team}: ${player?.name || 'Not on current roster'} · ${streak.length} starts`);
  }
}));
starts.sort((a, b) => b.length - a.length || a.name.localeCompare(b.name));
const through = starts.map(row => row.last.date).sort().at(-1);
if (!through || starts.length + unavailable.length !== 32) throw new Error('Incomplete starting streak coverage');
const history = await buildStartingHistory(games, through, { rosters, getStarter });
const data = { schemaVersion: 2, checkedAt: now.toISOString(), season, through, rosterWeek: roster.week, rosterWeeks: roster.rosterWeeks, starts, tenures: roster.players, unavailable, history };
const path = new URL('../data/qbs.json', import.meta.url);
const previous = JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));
if (previous && (previous.season > season || previous.through > through || previous.season === season && previous.rosterWeek > roster.week)) throw new Error('Refusing to regress published QB coverage');
await writeFile(path, serializeQbData(data));
console.log(`Saved ${starts.length} active starting streaks, ${history.streaks.length} historical streaks, ${data.tenures.length} current QBs; games through ${through}; rosters ${season} Week ${roster.week}; ${downloads} starter downloads.`);
