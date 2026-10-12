import { DIVISIONS, TEAMS } from './divstreaks-data.mjs';
import { isHistoricalOpponent, FRANCHISE_DEBUTS, ARCHIVE_FIRST_SEASON, ARCHIVE_LAST_SEASON } from './droughts-archive.mjs';
export { FRANCHISE_DEBUTS } from './droughts-archive.mjs';

export const CATEGORIES = [
  { key: 'superBowl', label: 'Super Bowl win' },
  { key: 'conference', label: 'Conference title' },
  { key: 'division', label: 'Division title' },
  { key: 'playoffWin', label: 'Playoff win' },
  { key: 'playoffs', label: 'Playoff appearance' },
];

// nflverse's game results begin in 1999. These are the last earlier titles
// in the Super Bowl era; newer game results supersede them.
const EARLIER_SUPER_BOWLS = {
  CHI: 1985, DAL: 1995, DEN: 1998, GB: 1996, IND: 1970, KC: 1969,
  LV: 1983, MIA: 1973, NYG: 1990, NYJ: 1968, PIT: 1979, SF: 1994, WAS: 1991,
};
const EARLIER_CONFERENCE_TITLES = {
  ATL: 1998, BUF: 1993, CHI: 1985, CIN: 1988, DAL: 1995, DEN: 1998,
  GB: 1997, IND: 1970, KC: 1969, LA: 1979, LAC: 1994, LV: 1983,
  MIA: 1984, MIN: 1976, NE: 1996, NYG: 1990, NYJ: 1968, PHI: 1980,
  PIT: 1995, SF: 1994, WAS: 1991,
};

// Verified through 2025. The updater merges each subsequent completed
// season's division champions from ESPN's final playoff seeds.
export const DIVISION_BASELINE_SEASON = 2025;
export const DIVISION_TITLES = {
  ARI: 2015, ATL: 2016, BAL: 2024, BUF: 2024, CAR: 2025, CHI: 2025,
  CIN: 2022, CLE: 1989, DAL: 2023, DEN: 2025, DET: 2024, GB: 2021,
  HOU: 2024, IND: 2014, JAX: 2025, KC: 2024, LA: 2024, LAC: 2009,
  LV: 2002, MIA: 2008, MIN: 2022, NE: 2025, NO: 2020, NYG: 2011,
  NYJ: 2002, PHI: 2025, PIT: 2025, SEA: 2025, SF: 2023, TB: 2024,
  TEN: 2021, WAS: 2020,
};

const DEBUTS_AFTER_1966 = {
  BAL: 1996, CAR: 1995, CIN: 1968, HOU: 2002, JAX: 1995,
  NO: 1967, SEA: 1976, TB: 1976,
};
const INACTIVE_SEASONS = { CLE: [1996, 1997, 1998] };
const ALIASES = { OAK: 'LV', SD: 'LAC', STL: 'LA', LAR: 'LA', WSH: 'WAS' };
const normalizeTeam = team => ALIASES[team] || team;

export function seasonsSince(team, lastSeason, throughSeason) {
  const first = lastSeason == null ? (DEBUTS_AFTER_1966[team] || 1966) : lastSeason + 1;
  let seasons = 0;
  for (let year = first; year <= throughSeason; year += 1) {
    if (!(INACTIVE_SEASONS[team] || []).includes(year)) seasons += 1;
  }
  return seasons;
}

export function readGames(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines[0].startsWith('game_id,season,game_type,week,gameday,')) {
    throw new Error('Unexpected NFL results format');
  }
  return lines.slice(1).map(line => {
    const c = line.split(',', 12);
    const awayScore = c[8] === '' ? null : Number(c[8]);
    const homeScore = c[10] === '' ? null : Number(c[10]);
    return {
      id: c[0], season: Number(c[1]), type: c[2], week: Number(c[3]), date: c[4],
      away: normalizeTeam(c[7]), home: normalizeTeam(c[9]),
      awayScore, homeScore,
      completed: Number.isInteger(awayScore) && Number.isInteger(homeScore),
    };
  }).filter(game => Number.isInteger(game.season) && TEAMS[game.away] && TEAMS[game.home]);
}

export const WIN_STREAK_TARGET = 5;
export const WIN_STREAK_THRESHOLDS = Array.from({ length: 23 }, (_, i) => i + 1);
const winThresholdPattern = /^#win-streaks-([1-9]|1[0-9]|2[0-3])$/;
export const droughtViewFromHash = hash => hash === '#win-streaks' || winThresholdPattern.test(hash) ? 'win-streaks' : 'milestones';
export const winThresholdFromHash = hash => {
  const match = winThresholdPattern.exec(hash);
  return match ? Number(match[1]) : WIN_STREAK_TARGET;
};
export function winStreakState(currentWins, threshold) {
  if (!Number.isInteger(currentWins) || currentWins < 0 || !WIN_STREAK_THRESHOLDS.includes(threshold)) throw new Error('Invalid win-streak status');
  return currentWins >= threshold ? 'active-streak' : currentWins === threshold - 1 ? 'one-away' : '';
}
export function winStreakHistoryStatus(row, view) {
  if (row.last) return 'recorded';
  const debut = FRANCHISE_DEBUTS[row.team];
  return Number.isInteger(debut) && Number.isInteger(view.firstResultsSeason) && view.firstResultsSeason <= debut &&
    Number(row.coverageStart?.slice(0, 4)) === debut ? 'never' : 'unknown';
}

export function winStreakRowClass(row, view) {
  return winStreakState(row.currentWins, view.threshold) ||
    (winStreakHistoryStatus(row, view) === 'never' ? 'never-streak' : '');
}

export function bestStreakYears(runs) {
  return [...new Set(runs.map(run => run.startSeason === run.endSeason ? String(run.startSeason) : `${run.startSeason}–${run.endSeason}`))].join(', ') || '—';
}

export function compareWinStreakRows(a, b, key, descending, view) {
  const names = TEAMS[a.team].name.localeCompare(TEAMS[b.team].name);
  if (key === 'team') return descending ? -names : names;
  if (key !== 'currentWins' && key !== 'bestWins') {
    const aStatus = winStreakHistoryStatus(a, view), bStatus = winStreakHistoryStatus(b, view);
    // Unknown history stays last; it must not be promoted into a "never" claim.
    if (aStatus === 'unknown' || bStatus === 'unknown') {
      return aStatus === bStatus ? names : aStatus === 'unknown' ? 1 : -1;
    }
    const longestFirst = key === 'last' ? !descending : descending;
    if (aStatus === 'never' || bStatus === 'never') {
      if (aStatus === bStatus) {
        const age = FRANCHISE_DEBUTS[a.team] - FRANCHISE_DEBUTS[b.team];
        return (longestFirst ? age : -age) || names;
      }
      return (aStatus === 'never' ? -1 : 1) * (longestFirst ? 1 : -1);
    }
  }
  const value = row => key === 'last' ? row.last.date : row[key];
  const aValue = value(a), bValue = value(b);
  const difference = typeof aValue === 'string' ? aValue.localeCompare(bValue) : aValue - bValue;
  return (descending ? -difference : difference) || names;
}
export function validWinStreakView(wins) {
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  return !!wins && WIN_STREAK_THRESHOLDS.includes(wins.threshold) && wins.scope === 'REG' && date(wins.throughDate) &&
    wins.teams?.length === 32 && new Set(wins.teams.map(row => row.team)).size === 32 && wins.teams.every(row =>
      TEAMS[row.team] && DIVISIONS.some(d => d.name === row.division && d.teams.includes(row.team)) &&
      date(row.coverageStart) && row.coverageStart <= wins.throughDate &&
      ['gamesSince', 'currentWins', 'bestWins'].every(key => Number.isInteger(row[key]) && row[key] >= 0) &&
      row.bestWins >= row.currentWins &&
      Array.isArray(row.bestRuns) && (row.bestWins === 0 ? row.bestRuns.length === 0 : row.bestRuns.length > 0) &&
      row.bestRuns.every(run => Number.isInteger(run.startSeason) && Number.isInteger(run.endSeason) &&
        run.startSeason >= Number(row.coverageStart.slice(0, 4)) && run.endSeason >= run.startSeason &&
        run.endSeason <= Number(wins.throughDate.slice(0, 4))) &&
      (row.last === null ? row.daysSince === null && row.bestWins < wins.threshold :
        date(row.last.date) && row.last.date <= wins.throughDate && Number.isInteger(row.last.season) &&
        (Number.isInteger(row.last.week) && row.last.week >= 1 || row.last.week === null && Number.isInteger(row.last.gameNumber) && row.last.gameNumber >= 1) &&
        Number.isInteger(row.last.wins) && row.last.wins >= wins.threshold && row.last.wins <= row.bestWins &&
        row.daysSince === daysBetween(row.last.date, wins.throughDate) &&
        (row.currentWins >= wins.threshold ? row.gamesSince === 0 : row.gamesSince > 0)));
}
export const daysBetween = (first, last) => Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000);
export function elapsedTime(first, last) {
  const a = new Date(`${first}T00:00:00Z`), b = new Date(`${last}T00:00:00Z`);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  if (months <= 0) { const days = daysBetween(first, last); return `${days} ${days === 1 ? 'day' : 'days'}`; }
  const years = Math.floor(months / 12), rest = months % 12;
  return [years ? `${years} ${years === 1 ? 'year' : 'years'}` : '', rest ? `${rest} ${rest === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(', ');
}

export function calculateWinStreakDroughts(games, earlierByTeam = {}, threshold = WIN_STREAK_TARGET) {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error('Invalid win-streak threshold');
  const regular = games.filter(g => g.type === 'REG' && g.completed).sort((a, b) => a.date.localeCompare(b.date));
  if (!regular.length) throw new Error('No completed regular-season games');
  const valid = game => /^\d{4}-\d{2}-\d{2}$/.test(game.date) && Number.isFinite(Date.parse(game.date)) &&
    Number.isInteger(game.season) && (Number.isInteger(game.week) && game.week > 0 ||
      game.week === null && game.id?.startsWith('archive:') && game.season >= ARCHIVE_FIRST_SEASON && game.season <= ARCHIVE_LAST_SEASON) &&
    [game.home, game.away].every(t => TEAMS[t] || isHistoricalOpponent(t)) && game.home !== game.away &&
    Number.isInteger(game.homeScore) && game.homeScore >= 0 && Number.isInteger(game.awayScore) && game.awayScore >= 0;
  if (regular.some(g => !valid(g))) throw new Error('Invalid regular-season result');
  const throughDate = regular.at(-1).date;
  const teams = DIVISIONS.flatMap(division => division.teams.map(team => {
    const modern = regular.filter(g => g.home === team || g.away === team);
    const earlier = earlierByTeam[team] || [];
    if (earlier.some(g => !valid(g) || !g.completed || g.type !== 'REG' || (g.home !== team && g.away !== team) || modern[0] && g.date >= modern[0].date))
      throw new Error(`Invalid historical schedule: ${team}`);
    const rows = [...earlier, ...modern].sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(rows.map(g => g.date)).size !== rows.length) throw new Error(`Duplicate game: ${team}`);
    let currentWins = 0, bestWins = 0, bestRuns = [], currentStart = null, currentStartSeason = null, last = null, gamesSince = 0, season = null, gameNumber = 0;
    for (const game of rows) {
      if (season !== game.season) { season = game.season; gameNumber = 0; }
      gameNumber++;
      const win = game.home === team ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
      gamesSince++;
      if (win) { if (!currentWins) { currentStart = game.date; currentStartSeason = game.season; } currentWins++; }
      else { currentWins = 0; currentStart = null; currentStartSeason = null; }
      if (currentWins > bestWins) { bestWins = currentWins; bestRuns = []; }
      // Each tied record is a separate run. A subsequent record-breaking win
      // replaces shorter runs, rather than labeling every win in one run a tie.
      if (win && currentWins === bestWins) bestRuns.push({ startSeason: currentStartSeason, endSeason: game.season });
      if (currentWins >= threshold) {
        last = { date: game.date, season: game.season, week: game.week, game: game.id, startDate: currentStart, wins: currentWins };
        if (game.week === null) last.gameNumber = gameNumber;
        gamesSince = 0;
      }
    }
    return { team, division: division.name, last, gamesSince, daysSince: last ? daysBetween(last.date, throughDate) : null, currentWins, bestWins, bestRuns, currentStart,
      coverageStart: rows[0]?.date ?? null };
  }));
  return { threshold, scope: 'REG', throughDate,
    firstResultsSeason: Math.min(...regular.map(g => g.season), ...Object.values(earlierByTeam).flatMap(rows => rows.map(g => g.season))), teams };
}

export function latestCompletedSeason(games) {
  const seasons = games.filter(game => game.type === 'SB' && game.completed)
    .map(game => game.season);
  if (!seasons.length) throw new Error('No completed Super Bowl in results');
  return Math.max(...seasons);
}

export function divisionWinners(standings, season) {
  const groups = (standings.children || []).flatMap(conference => conference.children || []);
  const winners = [];
  const seenTeams = new Set();
  for (const division of DIVISIONS) {
    const group = groups.find(item => item.name === division.name);
    const table = group?.standings;
    if (table?.season !== season || table.seasonType !== 2 || table.entries?.length !== 4) {
      throw new Error(`Incomplete ${season} standings for ${division.name}`);
    }
    for (const entry of table.entries) {
      const team = normalizeTeam(entry.team.abbreviation);
      if (!division.teams.includes(team) || seenTeams.has(team)) {
        throw new Error('Unexpected or duplicate team in standings');
      }
      seenTeams.add(team);
    }
    // Final seeds 1–4 are division champions. Entries are not always sorted
    // by rank, and win totals alone cannot resolve NFL tiebreakers.
    const champions = table.entries.filter(entry => {
      const seed = entry.stats.find(stat => stat.name === 'playoffSeed')?.value;
      return Number.isInteger(seed) && seed >= 1 && seed <= 4;
    });
    if (champions.length !== 1) throw new Error(`No unique division champion for ${division.name}`);
    winners.push(normalizeTeam(champions[0].team.abbreviation));
  }
  return winners;
}

export function calculateDroughts(games, divisionTitles = DIVISION_TITLES) {
  const throughSeason = latestCompletedSeason(games);
  if (throughSeason < DIVISION_BASELINE_SEASON) throw new Error('Results predate the verified division history');
  const teams = DIVISIONS.flatMap(division => division.teams.map(team => ({
    team, division: division.name,
    last: {
      superBowl: EARLIER_SUPER_BOWLS[team] ?? null,
      conference: EARLIER_CONFERENCE_TITLES[team] ?? null,
      division: divisionTitles[team],
      playoffWin: null,
      playoffs: null,
    },
  })));
  const byTeam = new Map(teams.map(row => [row.team, row]));
  const record = (team, key, season) => {
    const last = byTeam.get(team).last;
    if (last[key] == null || season > last[key]) last[key] = season;
  };
  for (const game of games) {
    if (game.season > throughSeason || !['WC', 'DIV', 'CON', 'SB'].includes(game.type) || !game.completed) continue;
    if (game.awayScore === game.homeScore) throw new Error('Tied postseason game in results');
    const winner = game.awayScore > game.homeScore ? game.away : game.home;
    record(game.away, 'playoffs', game.season);
    record(game.home, 'playoffs', game.season);
    record(winner, 'playoffWin', game.season);
    if (game.type === 'SB') {
      record(winner, 'superBowl', game.season);
      record(game.away, 'conference', game.season);
      record(game.home, 'conference', game.season);
    }
  }
  return {
    throughSeason,
    currentSeason: Math.max(...games.map(game => game.season)),
    teams,
  };
}
