import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { TEAMS } from '../nfl/divstreaks-data.mjs';
import { buildLeaders, currentRoster, parseCsv, parseReceivingTable } from '../nfl/franchise-leaders-data.mjs';

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
const records = [];
const sources = [];
// Fetch sequentially to keep requests to the historical source modest.
for (const [team, details] of Object.entries(TEAMS)) {
  const slug = details.name.toLowerCase().replace(/\s+/g, '-');
  const url = `https://www.statmuse.com/nfl/ask/${slug}-all-time-receiving-yards-leaders`;
  records.push(...parseReceivingTable(await download(url), team));
  sources.push({ team, url });
  console.log(`Checked ${details.name}`);
}
// StatMuse's NFL totals exclude the AAFC. These two historical Browns qualify
// when their full franchise history is counted, matching PFR's team records.
records.push(
  { team: 'CLE', name: 'Dante Lavelli', yards: 6488, receptions: 386, touchdowns: 62 },
  { team: 'CLE', name: 'Mac Speedie', yards: 5602, receptions: 349, touchdowns: 33 },
);
const leaders = buildLeaders(records, roster.memberships);
if (new Set(leaders.map(row => row.team)).size !== 32 || leaders.length < 150) throw new Error('Incomplete franchise leader data; keeping saved records');
const sourceHash = createHash('sha256').update(JSON.stringify({ season, rosterWeek: roster.week, leaders })).digest('hex');
let saved = null;
try { saved = JSON.parse(await readFile(destination, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (saved && season * 100 + roster.week < saved.season * 100 + saved.rosterWeek) throw new Error('Roster feed regressed; keeping saved records');
if (saved?.sourceHash === sourceHash) { console.log('Franchise leaders are unchanged.'); }
else {
  const data = { schemaVersion: 1, checkedAt: now.toISOString(), season, rosterWeek: roster.week, sourceHash, sources, leaders };
  await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Saved ${leaders.length} player–franchise pairs; rosters ${season} Week ${roster.week}.`);
}
