import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { TEAMS } from '../nfl/divstreaks-data.mjs';
import { VIEWS, buildLeaders, currentRoster, normalizeName, parseCsv, parseLeaderboardTable } from '../nfl/franchise-leaders-data.mjs';

const destination = new URL('../data/franchise-leaders.json', import.meta.url);
const now = new Date();
const season = now.getUTCMonth() < 8 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const rosterUrl = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response.text();
}
const roster = currentRoster(parseCsv(await download(rosterUrl)), season);
const views = {};
const historical = {
  receiving: [
    { team: 'CLE', name: 'Dante Lavelli', yards: 6488, receptions: 386, touchdowns: 62 },
    { team: 'CLE', name: 'Mac Speedie', yards: 5602, receptions: 349, touchdowns: 33 },
  ],
  // Full AAFC + NFL franchise totals: Hall of Fame and PFRA career tables.
  passing: [
    { team: 'CLE', name: 'Otto Graham', yards: 23584, touchdowns: 174, interceptions: 135 },
    { team: 'SF', name: 'Frankie Albert', yards: 10795, touchdowns: 115, interceptions: 98 },
  ],
  rushing: [{ team: 'SF', name: 'Joe Perry', yards: 8689, attempts: 1667, touchdowns: 68 }],
  sacks: [],
};
// Fetch sequentially to keep requests to the historical source modest.
for (const [view, config] of Object.entries(VIEWS)) {
  const records = [], sources = [];
  for (const [team, details] of Object.entries(TEAMS)) {
    const slug = details.name.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.statmuse.com/nfl/ask/${slug}-all-time-${config.query}-leaders`;
    records.push(...parseLeaderboardTable(await download(url), team, view));
    sources.push({ team, url });
    console.log(`Checked ${details.name}: ${view}`);
  }
  for (const override of historical[view]) {
    const index = records.findIndex(row => row.team === override.team && normalizeName(row.name) === normalizeName(override.name));
    if (index < 0) records.push(override);
    else records[index] = override;
  }
  const leaders = buildLeaders(records, roster.memberships, view);
  const minimumRows = { receiving: 150, passing: 100, rushing: 60, sacks: 60 }[view];
  if (new Set(leaders.map(row => row.team)).size !== 32 || leaders.length < minimumRows) throw new Error(`Incomplete ${view} leader data; keeping saved records`);
  views[view] = { sources, leaders };
}
const sourceHash = createHash('sha256').update(JSON.stringify({ season, rosterWeek: roster.week, views })).digest('hex');
let saved = null;
try { saved = JSON.parse(await readFile(destination, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (saved && season * 100 + roster.week < saved.season * 100 + saved.rosterWeek) throw new Error('Roster feed regressed; keeping saved records');
if (saved?.sourceHash === sourceHash) { console.log('Franchise leaders are unchanged.'); }
else {
  const data = { schemaVersion: 2, checkedAt: now.toISOString(), season, rosterWeek: roster.week, sourceHash, views };
  await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Saved ${Object.values(views).reduce((sum, view) => sum + view.leaders.length, 0)} player–franchise pairs across four views; rosters ${season} Week ${roster.week}.`);
}
