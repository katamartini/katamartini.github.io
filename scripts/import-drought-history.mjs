// One-time, pinned historical import. Weekly updates read the saved snapshot.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ARCHIVE_SOURCE, ARCHIVE_SHA256, ARCHIVE_FIRST_SEASON, ARCHIVE_LAST_SEASON,
  readArchive } from '../nfl/droughts-archive.mjs';

const response = await fetch(ARCHIVE_SOURCE, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Historical download failed: ${response.status}`);
const csv = await response.text();
if (createHash('sha256').update(csv).digest('hex') !== ARCHIVE_SHA256) throw new Error('Historical source checksum changed');
const rows = readArchive(csv);
const data = { source: ARCHIVE_SOURCE, sha256: ARCHIVE_SHA256,
  license: 'https://github.com/fivethirtyeight/nfl-elo-game/blob/master/LICENSE',
  firstSeason: ARCHIVE_FIRST_SEASON, lastSeason: ARCHIVE_LAST_SEASON,
  columns: ['date', 'season', 'home', 'homeScore', 'away', 'awayScore'], rows };
await writeFile(new URL('../data/droughts-history.json', import.meta.url), `${JSON.stringify(data)}\n`);
console.log(`Saved ${rows.length} regular-season games, ${ARCHIVE_FIRST_SEASON}–${ARCHIVE_LAST_SEASON}`);
