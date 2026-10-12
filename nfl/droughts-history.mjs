// Cleveland is the only franchise whose latest five-win regular-season run
// predates nflverse's 1999 boundary. Its complete 1994–95 schedules bridge
// that boundary; the franchise did not play in 1996–98. Opponents retain
// current franchise identities (Houston Oilers = TEN, not today's HOU).
export const WIN_STREAK_HISTORY_SOURCES = [
  'https://www.clevelandbrowns.com/schedule/1994/',
  'https://www.clevelandbrowns.com/schedule/1995/',
];
const cleveland = [
  // Date, week, away, away score, home, home score. Monday 1995 scores
  // are verified on the team schedules, not ESPN's empty 0–0 placeholders.
  ['1994-09-04', 1, 'CLE', 28, 'CIN', 20],
  ['1994-09-11', 2, 'PIT', 17, 'CLE', 10],
  ['1994-09-18', 3, 'ARI', 0, 'CLE', 32],
  ['1994-09-25', 4, 'CLE', 21, 'IND', 14],
  ['1994-10-02', 5, 'NYJ', 7, 'CLE', 27],
  ['1994-10-13', 7, 'CLE', 11, 'TEN', 8],
  ['1994-10-23', 8, 'CIN', 13, 'CLE', 37],
  ['1994-10-30', 9, 'CLE', 14, 'DEN', 26],
  ['1994-11-06', 10, 'NE', 6, 'CLE', 13],
  ['1994-11-13', 11, 'CLE', 26, 'PHI', 7],
  ['1994-11-20', 12, 'CLE', 13, 'KC', 20],
  ['1994-11-27', 13, 'TEN', 10, 'CLE', 34],
  ['1994-12-04', 14, 'NYG', 16, 'CLE', 13],
  ['1994-12-10', 15, 'CLE', 19, 'DAL', 14],
  ['1994-12-18', 16, 'CLE', 7, 'PIT', 17],
  ['1994-12-24', 17, 'SEA', 9, 'CLE', 35],
  ['1995-09-03', 1, 'CLE', 14, 'NE', 17],
  ['1995-09-10', 2, 'TB', 6, 'CLE', 22],
  ['1995-09-17', 3, 'CLE', 14, 'TEN', 7],
  ['1995-09-24', 4, 'KC', 17, 'CLE', 35],
  ['1995-10-02', 5, 'BUF', 22, 'CLE', 19],
  ['1995-10-08', 6, 'CLE', 20, 'DET', 38],
  ['1995-10-22', 8, 'JAX', 23, 'CLE', 15],
  ['1995-10-29', 9, 'CLE', 29, 'CIN', 26],
  ['1995-11-05', 10, 'TEN', 37, 'CLE', 10],
  ['1995-11-13', 11, 'CLE', 3, 'PIT', 20],
  ['1995-11-19', 12, 'GB', 31, 'CLE', 20],
  ['1995-11-26', 13, 'PIT', 20, 'CLE', 17],
  ['1995-12-03', 14, 'CLE', 13, 'LAC', 31],
  ['1995-12-09', 15, 'CLE', 11, 'MIN', 27],
  ['1995-12-17', 16, 'CIN', 10, 'CLE', 26],
  ['1995-12-24', 17, 'CLE', 21, 'JAX', 24],
].map(([date, week, away, awayScore, home, homeScore]) => ({
  id: `historical:${date}:${away}:${home}`, season: Number(date.slice(0, 4)),
  type: 'REG', date, week, away, awayScore, home, homeScore, completed: true,
}));
export const WIN_STREAK_HISTORY = { CLE: cleveland };
