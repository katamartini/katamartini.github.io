export const SOURCE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

export const DIVISIONS = [
  { name: 'AFC East', teams: ['BUF', 'MIA', 'NE', 'NYJ'] },
  { name: 'AFC North', teams: ['BAL', 'CIN', 'CLE', 'PIT'] },
  { name: 'AFC South', teams: ['HOU', 'IND', 'JAX', 'TEN'] },
  { name: 'AFC West', teams: ['DEN', 'KC', 'LAC', 'LV'] },
  { name: 'NFC East', teams: ['DAL', 'NYG', 'PHI', 'WAS'] },
  { name: 'NFC North', teams: ['CHI', 'DET', 'GB', 'MIN'] },
  { name: 'NFC South', teams: ['ATL', 'CAR', 'NO', 'TB'] },
  { name: 'NFC West', teams: ['ARI', 'LA', 'SF', 'SEA'] },
];

export const TEAMS = {
  ARI: { name: 'Cardinals', color: '#97233f' },
  ATL: { name: 'Falcons', color: '#a71930' },
  BAL: { name: 'Ravens', color: '#241773' },
  BUF: { name: 'Bills', color: '#00338d' },
  CAR: { name: 'Panthers', color: '#0075aa' },
  CHI: { name: 'Bears', color: '#0b162a' },
  CIN: { name: 'Bengals', color: '#c94e00' },
  CLE: { name: 'Browns', color: '#6c3516' },
  DAL: { name: 'Cowboys', color: '#003594' },
  DEN: { name: 'Broncos', color: '#b8490b' },
  DET: { name: 'Lions', color: '#006b9e' },
  GB: { name: 'Packers', color: '#203731' },
  HOU: { name: 'Texans', color: '#03202f' },
  IND: { name: 'Colts', color: '#002c5f' },
  JAX: { name: 'Jaguars', color: '#006778' },
  KC: { name: 'Chiefs', color: '#a41220' },
  LA: { name: 'Rams', color: '#003f86' },
  LAC: { name: 'Chargers', color: '#006a99' },
  LV: { name: 'Raiders', color: '#303030' },
  MIA: { name: 'Dolphins', color: '#00797c' },
  MIN: { name: 'Vikings', color: '#4f2683' },
  NE: { name: 'Patriots', color: '#002244' },
  NO: { name: 'Saints', color: '#75613c' },
  NYG: { name: 'Giants', color: '#0b2265' },
  NYJ: { name: 'Jets', color: '#125740' },
  PHI: { name: 'Eagles', color: '#004c54' },
  PIT: { name: 'Steelers', color: '#2b2b2b' },
  SEA: { name: 'Seahawks', color: '#002244' },
  SF: { name: '49ers', color: '#aa0000' },
  TB: { name: 'Buccaneers', color: '#b20d19' },
  TEN: { name: 'Titans', color: '#3b4a73' },
  WAS: { name: 'Commanders', color: '#5a1414' },
};

const FORMER_CODES = { OAK: 'LV', SD: 'LAC', STL: 'LA' };

function pairKey(a, b) {
  return [a, b].sort().join('-');
}

export function upcomingDivisionalGames(schedule, today) {
  const future = schedule.filter(game => game.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const next = future[0];
  if (!next || Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > 7 * 86400000) return [];
  return future.filter(game => game.season === next.season && game.week === next.week && game.divisional);
}

export function calculateStreaks(csv) {
  const gamesByPair = new Map();
  const schedule = [];
  let through = '';

  for (const division of DIVISIONS) {
    for (let i = 0; i < division.teams.length; i += 1) {
      for (let j = i + 1; j < division.teams.length; j += 1) {
        gamesByPair.set(pairKey(division.teams[i], division.teams[j]), {
          division: division.name,
          teams: [division.teams[i], division.teams[j]],
          games: [],
        });
      }
    }
  }

  // The fields used here all precede the CSV's quoted text columns.
  // Limiting the split also avoids parsing commas in coach and stadium names.
  const lines = csv.trim().split(/\r?\n/);
  if (!lines[0].startsWith('game_id,season,game_type,week,gameday,')) {
    throw new Error('Unexpected NFL results format');
  }

  for (const line of lines.slice(1)) {
    const columns = line.split(',', 12);
    if (columns.length < 12 || columns[2] !== 'REG') continue;

    const away = FORMER_CODES[columns[7]] || columns[7];
    const home = FORMER_CODES[columns[9]] || columns[9];
    const pair = gamesByPair.get(pairKey(away, home));
    if (columns[8] === '' || columns[10] === '') {
      schedule.push({
        id: columns[0],
        season: Number(columns[1]),
        week: Number(columns[3]),
        date: columns[4],
        away,
        home,
        location: columns[11],
        divisional: Boolean(pair),
      });
      continue;
    }
    const awayScore = Number(columns[8]);
    const homeScore = Number(columns[10]);
    if (!Number.isInteger(awayScore) || !Number.isInteger(homeScore)) continue;
    if (columns[4] > through) through = columns[4];

    if (!pair) continue;

    pair.games.push({
      id: columns[0],
      date: columns[4],
      away,
      home,
      location: columns[11],
      awayScore,
      homeScore,
      winner: awayScore === homeScore ? null : awayScore > homeScore ? away : home,
    });
  }

  schedule.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const streaks = [];
  const homeStreaks = [];
  const awayStreaks = [];
  for (const pair of gamesByPair.values()) {
    pair.games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const latest = pair.games.at(-1);
    if (!latest) throw new Error(`No completed games for ${pair.teams.join('–')}`);

    let count = 0;
    if (latest.winner) {
      for (let i = pair.games.length - 1; i >= 0; i -= 1) {
        if (pair.games[i].winner !== latest.winner) break;
        count += 1;
      }
    }

    streaks.push({
      division: pair.division,
      teams: pair.teams,
      winner: latest.winner,
      count,
      latest: {
        date: latest.date,
        away: latest.away,
        awayScore: latest.awayScore,
        home: latest.home,
        homeScore: latest.homeScore,
      },
    });

    for (const team of pair.teams) {
      const opponent = pair.teams.find(other => other !== team);
      for (const [venue, target] of [['home', homeStreaks], ['away', awayStreaks]]) {
        const venueGames = pair.games.filter(game => game.location !== 'Neutral' && game[venue] === team);
        const mostRecent = venueGames.at(-1);
        if (!mostRecent) throw new Error(`No ${venue} games for ${team} against ${opponent}`);
        let wins = 0;
        for (let i = venueGames.length - 1; i >= 0 && venueGames[i].winner === team; i -= 1) wins += 1;
        target.push({
          division: pair.division,
          teams: pair.teams,
          team,
          opponent,
          count: wins,
          latest: {
            date: mostRecent.date,
            away: mostRecent.away,
            awayScore: mostRecent.awayScore,
            home: mostRecent.home,
            homeScore: mostRecent.homeScore,
          },
        });
      }
    }
  }

  if (streaks.length !== 48) throw new Error(`Expected 48 rivalries, found ${streaks.length}`);
  if (homeStreaks.length !== 96 || awayStreaks.length !== 96) throw new Error('Expected 96 team rows per venue');
  return { through, schedule, streaks, homeStreaks, awayStreaks };
}
