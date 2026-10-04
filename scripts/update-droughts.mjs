import { readFile, writeFile } from 'node:fs/promises';
import { SOURCE_URL } from '../nfl/divstreaks-data.mjs';
import { calculateDroughts, DIVISION_BASELINE_SEASON, DIVISION_TITLES,
  divisionWinners, latestCompletedSeason, readGames } from '../nfl/droughts-data.mjs';

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
if (data.teams.length !== 32 || data.teams.some(row =>
  Object.values(row.last).some(year => year !== null && (!Number.isInteger(year) || year > data.throughSeason)) ||
  row.last.playoffs === null || row.last.playoffWin === null)) {
  throw new Error('Incomplete franchise history; keeping saved data');
}
const destination = new URL('../data/droughts.json', import.meta.url);
try {
  const saved = JSON.parse(await readFile(destination, 'utf8'));
  if (saved.throughSeason > data.throughSeason) throw new Error('Results would move the tracker backwards');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Saved ${data.teams.length} teams through the ${data.throughSeason} season`);
