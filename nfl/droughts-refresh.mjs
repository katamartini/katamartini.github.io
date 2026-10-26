import { SOURCE_URL } from './divstreaks-data.mjs';
import { readGames, latestCompletedSeason, calculateDroughts, divisionWinners,
  calculateWinStreakDroughts, calculateLossStreakDroughts, validWinStreakView, validLossStreakView,
  WIN_STREAK_THRESHOLDS, LOSS_STREAK_THRESHOLDS, WIN_STREAK_TARGET, validAllTimeDroughts } from './droughts-data.mjs?v=team-droughts-1';
import { archiveByTeam, ARCHIVE_SOURCE, ARCHIVE_SHA256, ARCHIVE_ROWS_SHA256, FRANCHISE_DEBUTS } from './droughts-archive.mjs';

export function updateTimeText(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Date(value).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York', timeZoneName: 'short',
  });
}

export function validateRefreshGames(games, published) {
  const season = latestCompletedSeason(games);
  const regular = games.filter(g => g.type === 'REG' && g.completed);
  const through = regular.map(g => g.date).sort().at(-1);
  if (season < published.throughSeason || !through || through < published.winStreaks.throughDate ||
      through < published.lossStreaks.throughDate) throw new Error('Results would move backwards');
  for (let year = 1999; year <= season; year++) {
    const expected = (year < 2002 ? 248 : year < 2021 ? 256 : 272) - (year === 2022 ? 1 : 0);
    if (regular.filter(g => g.season === year).length !== expected) throw new Error(`Incomplete ${year} results`);
  }
  return season;
}

export async function refreshDroughts(published, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const download = async url => {
    const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return response;
  };
  const [csv, archive] = await Promise.all([
    download(SOURCE_URL).then(r => r.text()),
    download(new URL('../data/droughts-history.json', import.meta.url)).then(r => r.json()),
  ]);
  const games = readGames(csv);
  const season = validateRefreshGames(games, published);
  if (archive.source !== ARCHIVE_SOURCE || archive.sha256 !== ARCHIVE_SHA256) throw new Error('Unexpected archive');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(archive.rows)));
  const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== ARCHIVE_ROWS_SHA256) throw new Error('Archive checksum changed');
  const history = archiveByTeam(archive.rows);
  const titles = Object.fromEntries(published.teams.map(row => [row.team, row.last.division]));
  // A newly completed season needs verified division champions, not guessed
  // winners or division-title years left behind from the old snapshot.
  for (let year = published.throughSeason + 1; year <= season; year++) {
    const url = `https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?region=us&lang=en&contentorigin=espn&type=0&level=3&season=${year}`;
    for (const team of divisionWinners(await (await download(url)).json(), year)) titles[team] = year;
  }
  const pack = (thresholds, calculate, validate) => {
    const views = thresholds.map(n => calculate(games, history, n));
    if (views.some(view => !validate(view) || !validAllTimeDroughts(view) || view.teams.some(row =>
      Number(row.coverageStart.slice(0, 4)) !== FRANCHISE_DEBUTS[row.team]))) throw new Error('Incomplete streak records');
    return { ...views.find(view => view.threshold === WIN_STREAK_TARGET),
      historicalSources: published.winStreaks.historicalSources,
      thresholds: Object.fromEntries(views.filter(view => view.threshold !== WIN_STREAK_TARGET).map(view => [view.threshold, view])) };
  };
  return { ...calculateDroughts(games, titles),
    winStreaks: pack(WIN_STREAK_THRESHOLDS, calculateWinStreakDroughts, validWinStreakView),
    lossStreaks: pack(LOSS_STREAK_THRESHOLDS, calculateLossStreakDroughts, validLossStreakView),
    updatedAt: now().toISOString(),
  };
}
