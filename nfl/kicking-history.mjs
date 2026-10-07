// Six kicker box-score lines recover games absent from the early PBP feed.
// All-make games need no within-game ordering to count either streak correctly.
// If there was a miss, its order is unknown: use a gap marker, never guess it.
const query = suffix => `https://www.statmuse.com/nfl/ask/nfl-kickers-field-goals-made-field-goals-attempted-extra-points-made-extra-points-attempted-${suffix}`;
export const HISTORICAL_GAMES = [
  { season: 1999, week: 1, date: '1999-09-12', game: '1999_01_BAL_STL', source: query('ravens-rams-september-12-1999'),
    kickers: [
      { name: 'Matt Stover', team: 'BAL', opponent: 'LA', fg: 1, fga: 3, xp: 1, xpa: 1 },
      { name: 'Jeff Wilkins', team: 'LA', opponent: 'BAL', fg: 2, fga: 2, xp: 3, xpa: 3 },
    ] },
  { season: 2000, week: 3, date: '2000-09-17', game: '2000_03_SD_KC', source: query('chargers-chiefs-september-17-2000'),
    kickers: [
      { name: 'John Carney', team: 'LAC', opponent: 'KC', fg: 1, fga: 2, xp: 1, xpa: 1 },
      { name: 'Pete Stoyanovich', team: 'KC', opponent: 'LAC', fg: 0, fga: 0, xp: 6, xpa: 6 },
    ] },
  { season: 2000, week: 6, date: '2000-10-08', game: '2000_06_BUF_MIA', source: query('bills-dolphins-october-8-2000'),
    kickers: [
      { name: 'Steve Christie', team: 'BUF', opponent: 'MIA', fg: 2, fga: 2, xp: 1, xpa: 1 },
      { name: 'Olindo Mare', team: 'MIA', opponent: 'BUF', fg: 2, fga: 2, xp: 2, xpa: 2 },
    ] },
];

export function historicalKicks(attempts, players) {
  const present = new Set(attempts.map(kick => kick.game));
  const additions = [], gaps = [], sources = [];
  for (const game of HISTORICAL_GAMES) {
    if (present.has(game.game)) continue;
    sources.push({ game: game.game, date: game.date, url: game.source });
    let play = -1000;
    for (const line of game.kickers) {
      const id = [...players].find(([, player]) => player.name === line.name)?.[0];
      if (!id) throw new Error(`Missing historical kicker identifier: ${line.name}`);
      const base = { id, shortName: line.name, season: game.season, week: game.week, date: game.date, game: game.game,
        team: line.team, opponent: line.opponent, distance: null, reconstructed: true };
      if (line.fg !== line.fga || line.xp !== line.xpa) {
        gaps.push({ ...base, play: play++, type: 'gap', fieldGoalsMade: line.fg, fieldGoalsAttempted: line.fga,
          extraPointsMade: line.xp, extraPointsAttempted: line.xpa, source: game.source });
      } else {
        for (const [type, count] of [['FG', line.fg], ['XP', line.xp]]) for (let i = 0; i < count; i++)
          additions.push({ ...base, play: play++, type, made: true, result: 'made' });
      }
    }
  }
  return { additions, gaps, sources };
}
