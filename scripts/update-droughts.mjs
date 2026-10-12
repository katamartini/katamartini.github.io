import { readFile, writeFile } from 'node:fs/promises';
import { SOURCE_URL } from '../nfl/divstreaks-data.mjs';
import { calculateDroughts, DIVISION_BASELINE_SEASON, DIVISION_TITLES,
  divisionWinners, latestCompletedSeason, readGames, calculateWinStreakDroughts } from '../nfl/droughts-data.mjs';
import { WIN_STREAK_HISTORY, WIN_STREAK_HISTORY_SOURCES } from '../nfl/droughts-history.mjs';

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} (${url})`);
  return response;
}

const csv = process.argv[2] ? await readFile(process.argv[2], 'utf8')
  : await (await download(SOURCE_URL)).text();
const games = readGames(csv);
const throughSeason = latestCompletedSeason(games);
const divisionTitles = { ...DIVISION_TITLES };
for (let season = DIVISION_BASELINE_SEASON; season <= throughSeason; season += 1) {
  const url = `https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?region=us&lang=en&contentorigin=espn&type=0&level=3&season=${season}`;
  const standings = await (await download(url)).json();
  const winners = divisionWinners(standings, season);
  if (season === DIVISION_BASELINE_SEASON && winners.some(team => divisionTitles[team] !== season)) {
    throw new Error('Division standings disagree with the verified 2025 history');
  }
  for (const team of winners) divisionTitles[team] = season;
}
const data = calculateDroughts(games, divisionTitles);
data.winStreaks = { ...calculateWinStreakDroughts(games, WIN_STREAK_HISTORY), historicalSources: WIN_STREAK_HISTORY_SOURCES };
if (data.winStreaks.teams.length !== 32 || data.winStreaks.teams.some(row => !row.last ||
  row.gamesSince < 0 || row.daysSince < 0 || row.last.wins < data.winStreaks.threshold)) {
  throw new Error('Incomplete win-streak history; keeping saved data');
}
for (let season = 1999; season <= throughSeason; season++) {
  const actual = games.filter(g => g.season === season && g.type === 'REG' && g.completed).length;
  const expected = season < 2002 ? 248 : season < 2021 ? 256 : 272;
  if (actual !== expected - (season === 2022 ? 1 : 0)) throw new Error(`Incomplete ${season} regular-season results`);
}
if (data.teams.length !== 32 || data.teams.some(row =>
  Object.values(row.last).some(year => year !== null && (!Number.isInteger(year) || year > data.throughSeason)) ||
  row.last.playoffs === null || row.last.playoffWin === null)) {
  throw new Error('Incomplete franchise history; keeping saved data');
}
const destination = new URL('../data/droughts.json', import.meta.url);
try {
  const saved = JSON.parse(await readFile(destination, 'utf8'));
  if (saved.throughSeason > data.throughSeason) throw new Error('Results would move the tracker backwards');
  if (saved.winStreaks?.throughDate > data.winStreaks.throughDate) throw new Error('Win-streak results would move backwards');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Saved ${data.teams.length} teams: milestones through ${data.throughSeason}, win streaks through ${data.winStreaks.throughDate}`);
