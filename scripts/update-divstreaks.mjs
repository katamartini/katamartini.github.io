import { readFile, writeFile } from 'node:fs/promises';
import { calculateStreaks, SOURCE_URL } from '../nfl/divstreaks-data.mjs';

const csv = process.argv[2]
  ? await readFile(process.argv[2], 'utf8')
  : await (async () => {
      const response = await fetch(SOURCE_URL);
      if (!response.ok) throw new Error(`NFL results download failed: ${response.status}`);
      return response.text();
    })();

const data = calculateStreaks(csv);
await writeFile(new URL('../data/divstreaks.json', import.meta.url),
  `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Saved ${data.streaks.length} rivalries through ${data.through}`);
