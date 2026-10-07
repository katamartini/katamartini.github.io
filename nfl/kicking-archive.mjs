// A deliberately partial archive of individually documented regular-season runs.
// These are sourced records, not synthetic attempts. Never invent dates or join
// a documented segment onto the play-by-play feed without an attempt sequence.
const chargersGuide = 'https://library.sfo2.cdn.digitaloceanspaces.com/publications/football/yearbooks/FSDCHMG-1996-los-angeles-chargers-media-guide.pdf#page=199';
const perfectSeason = 'https://www.vikings.com/news/throwin-it-back-to-98-vikings-have-record-day-in-music-city';
const record = (id, name, teams, length, period, source, extra = {}) => ({
  id: `archive:${id}`, playerId: null, name, teams, length, fieldGoals: length, extraPoints: 0,
  period, source, archive: true, segment: false, start: { date: null }, last: { date: null },
  endedBy: null, active: false, startUnknown: false, lowerBound: false, gapAfter: null, ...extra,
});

export const HISTORICAL_STREAKS = {
  fg: [
    record('gary-anderson-1997-98', 'Gary Anderson', ['SF', 'MIN'], 40, '1997–1998',
      'https://operations.nfl.com/media/4414/2020-nfl-record-and-fact-book-1.pdf', {
        last: { date: '1998-12-26' },
        note: 'NFL Record & Fact Book, regular-season scoring records (printed page 541). The final make is verified by the Vikings’ 1998 season-finale recap.',
        additionalSources: [perfectSeason],
      }),
    record('fuad-reveiz-1994-95', 'Fuad Reveiz', ['MIN'], 31, '1994–1995',
      'https://www.vikings.com/news/will-reichard-5-field-goals-creative-kickoffs-help-drop-dolphins', {
        start: { date: '1994-10-10' }, last: { date: '1995-09-17' },
        note: 'The Vikings identify this 31-attempt run and its first and last made-field-goal dates.',
      }),
    record('john-carney-1992-93', 'John Carney', ['LAC'], 29, '1992–1993',
      'https://www.chargers.com/news/bolts-to-induct-john-carney-and-anthony-miller-into-chargers-hall-of-fame-2026', {
        note: 'Chargers Hall of Fame announcement confirms 29 straight in 1992–93. Exact first/last make and subsequent miss dates are not entered without verification.',
      }),
    record('chris-boniol-1996', 'Chris Boniol', ['DAL'], 27, '1996',
      'https://www.dallascowboys.com/news/mick-shots-kicking-the-ball-around-full-circle', {
        note: 'Cowboys franchise-history article identifies 27 consecutive made field goals in 1996. Exact attempt dates are not verified.',
      }),
    record('john-carney-1994', 'John Carney', ['LAC'], 21, '1994', chargersGuide, {
      note: '1996 Chargers Media Guide, Individual Records, printed page 196: 21 consecutive field goals in 1994. This is separate from his 1992–93 run.',
    }),
  ],
  all: [
    record('gary-anderson-1998-segment', 'Gary Anderson', ['MIN'], 94, '1998 season', perfectSeason, {
      fieldGoals: 35, extraPoints: 59, last: { date: '1998-12-26' }, lowerBound: true, segment: true,
      note: 'All 35 field goals and 59 extra points were made during the 1998 regular season: at least 94 consecutive kicks. This is a verified season-long segment, not the reconstructed full multi-season run. Playoff kicks are excluded.',
    }),
  ],
};

export function mergeHistoricalStreaks(views) {
  return Object.fromEntries(Object.entries(HISTORICAL_STREAKS).map(([view, archive]) => {
    if (!Array.isArray(views[view])) throw new Error(`Missing kicking view: ${view}`);
    // Idempotent so re-running an import cannot add the same records twice.
    const rows = [...views[view].filter(row => !row.archive), ...archive.map(row => structuredClone(row))];
    return [view, rows.sort((a, b) => b.length - a.length ||
      (a.start.date || '9999').localeCompare(b.start.date || '9999') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))];
  }));
}
