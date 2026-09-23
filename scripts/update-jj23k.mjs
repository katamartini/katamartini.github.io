import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const pageUrl = new URL('../jj23k.html', import.meta.url);
const outputUrl = new URL('../data/jj23k-data.js', import.meta.url);
const playerId = '00-0036322'; // Justin Jefferson's stable NFL ID.
const baselineSeason = 2026;
const startingWeek = 1;
const releaseRoot = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player';

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('Unclosed quoted field in nflverse CSV');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...values] = rows;
  if (!headers) throw new Error('Empty nflverse CSV');
  return values.map(rowValues => Object.fromEntries(headers.map((header, index) => [header, rowValues[index] ?? ''])));
}

async function fetchCsv(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  const csv = await response.text();
  return { rows: parseCsv(csv), hash: createHash('sha256').update(csv).digest('hex') };
}

function stat(row, key) {
  const value = Number(row[key] || 0);
  if (!Number.isSafeInteger(value) || (key !== 'receiving_yards' && value < 0)) {
    throw new Error(`Invalid ${key} for ${row.player_display_name}`);
  }
  return value;
}

function addStats(target, row) {
  target.yards += stat(row, 'receiving_yards');
  target.receptions += stat(row, 'receptions');
  target.touchdowns += stat(row, 'receiving_tds');
}

function sourceBaseline(html) {
  const chart = html.match(/jefferson:\s*(\[[^\]]+\])/);
  const table = html.match(/const leaders = (\[[\s\S]*?\n    \]);/);
  if (!chart || !table) throw new Error('Could not find the JJ23K Week 1 baseline in jj23k.html');
  const careerYards = JSON.parse(chart[1]);
  const leaders = JSON.parse(table[1]);
  const jefferson = leaders.find(row => row[1] === 'Justin Jefferson');
  if (careerYards.at(-1) !== jefferson?.[2] || careerYards.length - 1 !== 95 || jefferson[2] !== 8572) {
    throw new Error('JJ23K Week 1 baseline changed; review the updater before running it');
  }
  return { careerYards, leaders };
}

async function historicalStats(currentPlayers) {
  const totals = new Map();
  const years = Array.from({ length: baselineSeason - 1999 }, (_, index) => 1999 + index);
  // Only players in this season's feed can newly enter the top 100.
  for (let index = 0; index < years.length; index += 5) {
    const batch = await Promise.all(years.slice(index, index + 5).map(async year => {
      const url = `${releaseRoot}/stats_player_reg_${year}.csv`;
      return (await fetchCsv(url)).rows;
    }));
    for (const rows of batch) {
      for (const row of rows) {
        if (!currentPlayers.has(row.player_id) || row.season_type !== 'REG') continue;
        const total = totals.get(row.player_id) ?? { yards: 0, receptions: 0, touchdowns: 0 };
        addStats(total, row);
        totals.set(row.player_id, total);
      }
    }
  }
  return totals;
}

async function update() {
  const html = await readFile(pageUrl, 'utf8');
  const baseline = sourceBaseline(html);
  const now = new Date();
  const latestPossibleSeason = now.getUTCMonth() < 8 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const seasons = Array.from({ length: Math.max(1, latestPossibleSeason - baselineSeason + 1) }, (_, index) => baselineSeason + index);
  const regular = [];
  const sourceHashes = [];
  let season = baselineSeason;
  for (const year of seasons) {
    const url = `${releaseRoot}/stats_player_week_${year}.csv`;
    let feed;
    try {
      feed = await fetchCsv(url);
    } catch (error) {
      if (year > baselineSeason && String(error.message).startsWith('404 fetching')) break;
      throw error;
    }
    const seasonRows = feed.rows.filter(row => row.season_type === 'REG' && Number(row.season) === year);
    if (!seasonRows.length && year > baselineSeason) break;
    regular.push(...seasonRows);
    sourceHashes.push(`${year}:${feed.hash}`);
    season = year;
  }
  const hash = createHash('sha256').update(sourceHashes.join('|')).digest('hex');
  const throughWeek = Math.max(...regular.filter(row => Number(row.season) === season).map(row => Number(row.week)));
  if (!Number.isInteger(throughWeek) || throughWeek < startingWeek || throughWeek > 18) {
    throw new Error(`Invalid latest ${season} week: ${throughWeek}`);
  }

  const existing = await readFile(outputUrl, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (existing.includes(`"sourceHash": "${hash}"`)) {
    console.log('JJ23K source feed is unchanged.');
    return;
  }

  const jeffersonGames = regular.filter(row => row.player_id === playerId)
    .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.week) - Number(b.week));
  const weekOne = jeffersonGames.find(row => Number(row.season) === baselineSeason && Number(row.week) === startingWeek);
  if (!weekOne || stat(weekOne, 'receiving_yards') !== 92) {
    throw new Error('Jefferson Week 1 does not match the frozen page baseline');
  }
  const careerYards = [...baseline.careerYards];
  for (const row of jeffersonGames.filter(row => Number(row.season) > baselineSeason || Number(row.week) > startingWeek)) {
    careerYards.push(careerYards.at(-1) + stat(row, 'receiving_yards'));
  }

  const currentPlayers = new Map();
  for (const row of regular) {
    const player = currentPlayers.get(row.player_id) ?? {
      id: row.player_id, name: row.player_display_name, yards: 0, receptions: 0, touchdowns: 0,
      later: { yards: 0, receptions: 0, touchdowns: 0 }
    };
    addStats(player, row);
    if (Number(row.season) > baselineSeason || Number(row.week) > startingWeek) addStats(player.later, row);
    currentPlayers.set(row.player_id, player);
  }
  if (currentPlayers.get(playerId)?.yards !== jeffersonGames.reduce((sum, row) => sum + stat(row, 'receiving_yards'), 0)) {
    throw new Error('Jefferson weekly rows are inconsistent');
  }

  const originalNames = new Set(baseline.leaders.map(row => row[1]));
  const outsidePlayers = new Map([...currentPlayers].filter(([, player]) => !originalNames.has(player.name)));
  const past = await historicalStats(outsidePlayers);
  const all = baseline.leaders.map(([originalRank, name, yards, receptions, , touchdowns]) => {
    const live = [...currentPlayers.values()].find(player => player.name === name);
    return { originalRank, name, yards: yards + (live?.later.yards ?? 0),
      receptions: receptions + (live?.later.receptions ?? 0),
      touchdowns: touchdowns + (live?.later.touchdowns ?? 0) };
  });
  for (const player of outsidePlayers.values()) {
    const previous = past.get(player.id) ?? { yards: 0, receptions: 0, touchdowns: 0 };
    all.push({ originalRank: Infinity, name: player.name,
      yards: previous.yards + player.yards,
      receptions: previous.receptions + player.receptions,
      touchdowns: previous.touchdowns + player.touchdowns });
  }
  all.sort((a, b) => b.yards - a.yards || a.originalRank - b.originalRank || a.name.localeCompare(b.name));
  const leaders = all.slice(0, 100).map((player, index) => [
    index + 1, player.name, player.yards, player.receptions,
    player.receptions ? Math.round(player.yards / player.receptions * 10) / 10 : 0,
    player.touchdowns
  ]);
  const jefferson = leaders.find(row => row[1] === 'Justin Jefferson');
  if (!jefferson || jefferson[2] !== careerYards.at(-1)) {
    throw new Error('Jefferson chart and leaderboard totals disagree');
  }
  if (existing) {
    const previousSeason = Number(existing.match(/"season": (\d+)/)?.[1]);
    const previousWeek = Number(existing.match(/"throughWeek": (\d+)/)?.[1]);
    if (season * 100 + throughWeek < previousSeason * 100 + previousWeek) {
      throw new Error('Source feed has regressed to an earlier week');
    }
  }

  const data = { season, throughWeek, sourceHash: hash, careerYards, leaders };
  const output = `// Generated by scripts/update-jj23k.mjs from nflverse weekly player stats.\nwindow.JJ23K_DATA = ${JSON.stringify(data, null, 2)};\n`;
  if (output !== existing) {
    await writeFile(outputUrl, output);
    console.log(`Updated JJ23K through ${season} Week ${throughWeek}: Jefferson ${jefferson[2]} yards, rank ${jefferson[0]}.`);
  }
}

update().catch(error => { console.error(error); process.exitCode = 1; });
