import { TEAMS } from './divstreaks-data.mjs';
import { expectedHistoricalGames } from './droughts-archive.mjs';

export const recordKey = (wins, losses, ties = 0) => `${wins}-${losses}-${ties}`;
export const recordText = (wins, losses, ties = 0) => `${wins}-${losses}${ties ? `-${ties}` : ''}`;
export function validateRecord(wins, losses, ties) {
  if (![wins, losses, ties].every(n => Number.isInteger(n) && n >= 0 && n <= 17) || wins + losses + ties > 17) throw new Error('Enter a valid W–L–T record totaling 0–17 games.');
  return wins + losses + ties;
}
export function buildSeasonRows(games, earlier, historicalPost, throughSeason, activeSeason, today) {
  const post = [...historicalPost, ...games.filter(g => g.type !== 'REG' && g.completed && g.date <= today)]
    .sort((a, b) => a.date.localeCompare(b.date));
  const bowls = new Map();
  for (let season = 1966; season <= throughSeason; season++) {
    const finals = post.filter(g => g.season === season && (season < 1999 || g.type === 'SB'));
    const final = finals.at(-1);
    if (!final || !TEAMS[final.home] || !TEAMS[final.away] || final.homeScore === final.awayScore ||
        finals.filter(g => g.date === final.date).length !== 1) throw new Error(`Missing unique Super Bowl: ${season}`);
    bowls.set(season, final);
  }
  const seasons = [];
  for (const team of Object.keys(TEAMS)) {
    const regular = [...(earlier[team] || []), ...games.filter(g => g.type === 'REG' && (g.home === team || g.away === team))];
    const years = new Set(regular.map(g => g.season).filter(year => year <= activeSeason));
    years.add(activeSeason);
    for (const season of [...years].sort((a, b) => a - b)) {
      const rows = regular.filter(g => g.season === season && g.completed && g.date <= today).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      if (!rows.length && season !== activeSeason) continue;
      if (new Set(rows.map(g => g.date)).size !== rows.length) throw new Error(`Duplicate team game: ${team} ${season}`);
      let wins = 0, losses = 0, ties = 0;
      const records = [recordKey(0, 0, 0)];
      for (const game of rows) {
        const own = game.home === team ? game.homeScore : game.awayScore, other = game.home === team ? game.awayScore : game.homeScore;
        if (![own, other].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid score');
        if (own > other) wins++; else if (own < other) losses++; else ties++;
        records.push(recordKey(wins, losses, ties));
      }
      const complete = season <= throughSeason;
      const expected = season >= 2021 ? (season === 2022 && ['BUF', 'CIN'].includes(team) ? 16 : 17) : season >= 1999 ? 16 : expectedHistoricalGames(team, season);
      if (complete && rows.length !== expected) throw new Error(`Incomplete regular season: ${team} ${season} (${rows.length}/${expected})`);
      const teamPost = post.filter(g => g.season === season && (g.home === team || g.away === team));
      const playoffWins = teamPost.filter(g => g.home === team ? g.homeScore > g.awayScore : g.awayScore > g.homeScore).length;
      const bowl = bowls.get(season), bowlAppearance = bowl && [bowl.home, bowl.away].includes(team);
      const bowlWin = bowlAppearance && (bowl.homeScore > bowl.awayScore ? bowl.home : bowl.away) === team;
      let outcome = !complete ? 'Season in progress' : season < 1933 ? 'No scheduled playoffs' : !teamPost.length ? 'Missed playoffs' : `Playoffs · ${playoffWins} win${playoffWins === 1 ? '' : 's'}`;
      if (complete && bowlAppearance) outcome = bowlWin ? 'Won Super Bowl' : 'Lost Super Bowl';
      else if (complete && season >= 1999 && teamPost.length) outcome = `Lost ${{ WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference Championship' }[teamPost.at(-1).type] || 'in playoffs'}`;
      seasons.push({ team, season, wins, losses, ties, records, games: rows.length, format: season >= 2021 ? 17 : expected,
        complete, lastDate: rows.at(-1)?.date || null, playoffs: complete && season >= 1933 ? teamPost.length > 0 : null,
        playoffWins: complete && season >= 1933 ? playoffWins : null,
        superBowl: complete && season >= 1966 ? !!bowlAppearance : null, superBowlWin: complete && season >= 1966 ? !!bowlWin : null, outcome });
    }
  }
  return seasons.sort((a, b) => b.season - a.season || TEAMS[a.team].name.localeCompare(TEAMS[b.team].name));
}

export function filterSeasons(seasons, filters, record) {
  const { wins, losses, ties } = record;
  const n = validateRecord(wins, losses, ties), key = recordKey(wins, losses, ties);
  return seasons.filter(row => row.records[n] === key && (filters.team === 'all' || row.team === filters.team) &&
    row.season >= filters.from && row.season <= filters.to && row.season >= ({ all: 1920, sb: 1966, merger: 1970 }[filters.era] ?? 1920) &&
    (filters.format === 'all' || (filters.format === '17' ? row.season >= 2021 : row.format === Number(filters.format))) && (filters.ongoing || row.complete));
}
export function summarize(rows) {
  const done = rows.filter(row => row.complete);
  const rate = (key, predicate = value => value === true) => {
    const eligible = done.filter(row => row[key] !== null);
    const count = eligible.filter(row => predicate(row[key])).length;
    return { count, total: eligible.length, percent: eligible.length ? count / eligible.length * 100 : null };
  };
  return { count: done.length, ongoing: rows.length - done.length, playoffs: rate('playoffs'), playoffWin: rate('playoffWins', n => n > 0),
    superBowl: rate('superBowl'), superBowlWin: rate('superBowlWin'),
    avgWins: done.length ? done.reduce((sum, row) => sum + row.wins, 0) / done.length : null,
    avgLosses: done.length ? done.reduce((sum, row) => sum + row.losses, 0) / done.length : null,
    avgTies: done.length ? done.reduce((sum, row) => sum + row.ties, 0) / done.length : null };
}
export function currentComparisons(data, filters) {
  return data.seasons.filter(row => row.season === data.activeSeason && (filters.team === 'all' || filters.team === row.team)).map(current => {
    const matches = filterSeasons(data.seasons, { ...filters, team: current.team, ongoing: false }, current).filter(row => row.season < data.activeSeason);
    return { ...current, matches, summary: summarize(matches) };
  });
}
export function validRecordData(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.seasons) || !Number.isInteger(data.activeSeason) || !Number.isInteger(data.throughSeason) || data.activeSeason < data.throughSeason || !Number.isFinite(Date.parse(data.checkedAt))) return false;
  const keys = new Set();
  for (const row of data.seasons) {
    const key = `${row.team}:${row.season}`;
    if (keys.has(key) || !TEAMS[row.team] || !Number.isInteger(row.season) || row.season < 1920 || row.season > data.activeSeason ||
      ![row.wins, row.losses, row.ties, row.games].every(n => Number.isInteger(n) && n >= 0) || row.wins + row.losses + row.ties !== row.games || row.games > 17 ||
      row.complete !== (row.season <= data.throughSeason) || !Array.isArray(row.records) || row.records.length !== row.games + 1 || row.records[0] !== '0-0-0' || row.records.at(-1) !== recordKey(row.wins, row.losses, row.ties) ||
      row.complete && row.season >= 1933 && (typeof row.playoffs !== 'boolean' || !Number.isInteger(row.playoffWins) || row.playoffWins < 0) ||
      row.complete && row.season >= 1966 && (typeof row.superBowl !== 'boolean' || typeof row.superBowlWin !== 'boolean') ||
      !row.complete && [row.playoffs, row.playoffWins, row.superBowl, row.superBowlWin].some(value => value !== null) ||
      row.superBowlWin && !row.superBowl || row.superBowl && !row.playoffs) return false;
    for (let i = 1; i < row.records.length; i++) {
      const before = row.records[i - 1].split('-').map(Number), after = row.records[i].split('-').map(Number);
      if (after.length !== 3 || after.some((n, j) => !Number.isInteger(n) || n < before[j] || n > before[j] + 1) || after.reduce((sum, n) => sum + n, 0) !== i) return false;
    }
    keys.add(key);
  }
  return Object.keys(TEAMS).every(team => keys.has(`${team}:${data.activeSeason}`));
}
