(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.DLNSModel = model;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const heroes = Object.freeze(['Abrams','Apollo','Baba','Bebop','Billy','Calico','Celeste','Deadman Danny','Doorman','Drifter','Dynamo','Graves','Grey Talon','Haze','Holliday','Infernus','Ivy','Kelvin','Lady Geist','Lash','McGinnis','Mina','Mirage','Mo and Krill','Nurse Harrow','Paige','Paradox','Pocket','Rat King','Rem','Seven','Shiv','Silver','Sinclair','Solomon','Venator','Victor','Vindicta','Violet','Viscous','Vyper','Warden','Wraith','Yamato']);
  const availability = Object.freeze(Object.fromEntries(heroes.map(hero => [hero, ({
    Apollo:'26-EU-C-1',Billy:'2-NA-C-1',Celeste:'25-EU-C-1',Doorman:'3-EU-C-1',
    Drifter:'3-NA-C-1',Graves:'24-EU-C-1',Mina:'2-EU-C-1',Paige:'3-EU-C-1',
    Rem:'23-EU-C-1',Silver:'24-EU-C-1',Venator:'25-EU-C-1',Victor:'4-EU-C-1',
    'Rat King':'59-EU-C-1',Baba:'59-EU-C-1',Solomon:'60-EU-C-1',
    'Deadman Danny':'60-EU-C-1',Violet:'61-EU-C-1','Nurse Harrow':'61-EU-C-1'
  })[hero] || '1-EU-C-1'])));
  const other = side => side === 'left' ? 'right' : 'left';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const matchId = match => `${match.week}-${match.region}-${String(match.round || '')[0]}-${match.game}`;
  const regions = Object.freeze(['EU','NA','APAC']);
  const THREE_BAN_START = 62;
  const FIRST_APAC_WEEK = 63;
  const DAY = 86400000, EPOCH = Date.parse('2026-11-04');
  // EDL event dates, separate from official region/shift IDs. No projected APAC dates.
  const schedule = Object.freeze({
    '63-EU':'2026-11-04','63-NA':'2026-11-05','1-APAC':'2026-11-06',
    '64-EU':'2026-11-11','64-NA':'2026-11-12','2-APAC':'2026-11-13',
    '65-EU':'2026-11-18','65-NA':'2026-11-19','3-APAC':'2026-11-20',
    '66-EU':'2026-11-25','66-NA':'2026-11-26','4-APAC':'2026-11-27',
    '67-EU':'2026-12-02','67-NA':'2026-12-03'
  });
  const eventKey = ({week,region}) => `${week}-${region}`;
  const parseId = id => {
    const [week,region,r,game] = String(id || '').split('-');
    return {week:Number(week),region,round:r==='F'?'Finals':'Challenger',game:Number(game)||0};
  };
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  const scheduledOn = match => schedule[eventKey(match)] || '';
  const playedOn = match => match.played_on || scheduledOn(match);
  const hasModernTimeline = ({region,week}) => region==='APAC' || Number(week)>=FIRST_APAC_WEEK;
  const dayOffset = d => (Date.parse(d)-EPOCH)/DAY;
  const timelineWeek = match => {
    const day = match.region==='APAC' ? playedOn(match) : scheduledOn(match);
    return day ? FIRST_APAC_WEEK+Math.floor((dayOffset(day)+2)/7) : Number(match.week);
  };
  const chronology = (idOrMatch,date) => {
    const m = typeof idOrMatch==='object' ? idOrMatch : {...parseId(idOrMatch),played_on:date};
    const week = Number(m.week)||0, phase = (m.round==='Finals' ? 1000 : 0)+(Number(m.game)||0);
    if (!hasModernTimeline(m)) return week*100000+(m.region==='NA'?2000:0)+phase;
    const day = playedOn(m);
    // Keep historic undated shifts in their established order; later undated EU/NA
    // shifts use their usual weekly position until a play date is supplied.
    const offset = day ? dayOffset(day) : (week-FIRST_APAC_WEEK)*7+(m.region==='NA'?1:0);
    return FIRST_APAC_WEEK*100000+offset*100000+(Math.max(0,regions.indexOf(m.region))*2000)+phase;
  };
  const banCount = (week,region) => region==='APAC' || Number(week) >= THREE_BAN_START ? 3 : 2;
  function slotIndex(side,type,count,week,region) {
    if (type === 'pick') return side === 'left' ? count : 5-count;
    const slots = banCount(week,region);
    // New bans start at the outer edge; historical bans start nearest the center.
    const reversed = slots === 3 ? side === 'right' : side === 'left';
    return reversed ? slots-1-count : count;
  }

  function sequence(first = 'left', week, region) {
    const side = other(first), modern = banCount(week,region) === 3;
    const owners = modern
      ? [first,side,side,first,side,first,side,first,first,side,first,side]
      : [first,side,side,first,first,side,side,first,first,side,side,first];
    const picks = owners.map((owner,i) => ({type:'pick',order:i+1,side:owner}));
    const ban = (order,owner) => ({type:'ban',order,side:owner});
    return [
      ban(1,first), ban(2,side),
      ...(modern ? [ban(3,first),ban(4,side)] : []),
      ...picks.slice(0,6),
      ban(modern ? 5 : 3,side), ban(modern ? 6 : 4,first),
      ...picks.slice(6)
    ];
  }

  function validateMatch(match, options = {}) {
    const errors = [];
    if (!Number.isInteger(match.week) || match.week < 1 || match.week > 9999) errors.push('Enter a week from 1 to 9999.');
    if (!regions.includes(match.region)) errors.push('Choose EU, NA, or APAC.');
    if (match.played_on && (!validDate(match.played_on) || (hasModernTimeline(match) && dayOffset(match.played_on)<0))) errors.push('Enter a valid match date (November 4, 2026 or later for the combined timeline).');
    if (match.region==='APAC' && !playedOn(match)) errors.push('Enter the date this APAC match was played.');
    if (!['Challenger','Finals'].includes(match.round)) errors.push('Choose Challenger or Finals.');
    if (!Number.isInteger(match.game) || match.game < 1 || match.game > 99) errors.push('Enter a game number from 1 to 99.');
    if (!['left','right'].includes(match.first_pick)) errors.push('Choose the first-pick team.');
    if (match.winner != null && match.winner !== '' && !['left','right'].includes(match.winner)) errors.push('Choose a valid winner or leave the result pending.');
    const left = text(match.left_team), right = text(match.right_team);
    if (!left || !right || left.length > 100 || right.length > 100 || [left,right].some(t => /^team [12]$/i.test(t))) errors.push('Enter the actual team names (100 characters or fewer).');
    if (left.toLowerCase() === right.toLowerCase()) errors.push('The two teams must be different.');
    if (match.match_id !== matchId(match)) errors.push('The match ID does not match its details.');
    const expected = sequence(match.first_pick,match.week,match.region);
    if (!Array.isArray(match.actions) || match.actions.length !== expected.length) {
      errors.push(`Complete all 12 picks and ${2*banCount(match.week,match.region)} bans.`);
      return errors;
    }
    const seenHeroes = new Set(), seenPlayers = new Set();
    match.actions.forEach((action,i) => {
      const wanted = expected[i];
      if (!action || action.type !== wanted.type || action.order !== wanted.order || action.side !== wanted.side) {
        errors.push(`Invalid action at draft slot ${i+1}.`);
        return;
      }
      if (!heroes.includes(action.hero)) errors.push(`Choose a valid hero for draft slot ${i+1}.`);
      else if (chronology(match) < chronology(availability[action.hero])) errors.push(`${action.hero} was not available for this match.`);
      if (seenHeroes.has(action.hero)) errors.push('A hero cannot appear twice in one draft.');
      seenHeroes.add(action.hero);
      if (Object.hasOwn(action,'player') && typeof action.player !== 'string') errors.push('Player names must be text.');
      const player = text(action.player);
      if (player.length > 100) errors.push('Player names must be 100 characters or fewer.');
      if (action.type === 'ban' && player) errors.push('Bans cannot have player assignments.');
      if (player && seenPlayers.has(player.toLowerCase()) && !(options.allowHistoricalPlayers && match.source === 'google-sheet')) errors.push('A player cannot be assigned to two heroes.');
      if (player) seenPlayers.add(player.toLowerCase());
    });
    return [...new Set(errors)];
  }

  function matchToRecords(match) {
    return match.actions.map((action,i) => ({
      sq:String(i+1),matchid:match.match_id,region:match.region,week:String(match.week),
      round:match.round,game:String(match.game),team:match[`${action.side}_team`],
      type:action.type === 'pick' ? 'Pick' : 'Ban',order:String(action.order),hero:action.hero,
      matchresult:action.type === 'pick' && match.winner ? (action.side === match.winner ? 'Win' : 'Loss') : '',
      player:text(action.player),...(match.played_on ? {played_on:match.played_on} : {})
    }));
  }

  function teamsForRegion(records, region, registered = []) {
    const names = new Map();
    for (const row of [...records,...registered.map(team => ({region:team.region,team:team.name}))]) {
      const name = text(row.team);
      if (row.region === region && name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(),name);
    }
    return [...names.values()].sort((a,b) => a.localeCompare(b));
  }

  function latestHeroPlayer(records, team, hero, region) {
    const teamKey = text(team).toLowerCase();
    let latest = -Infinity, player = '';
    for (const row of records) {
      if (row.region !== region || text(row.team).toLowerCase() !== teamKey || row.hero !== hero
          || text(row.type).toLowerCase() !== 'pick' || !text(row.player) || !row.matchid) continue;
      const order = chronology(row.matchid,row.played_on);
      if (order > latest) { latest = order; player = text(row.player); }
    }
    return player;
  }

  function heroPickRanks(records, pickedHeroes = [], replacingMatchId = null) {
    const picks = records.filter(row=>text(row.type).toLowerCase() === 'pick' && row.hero);
    const selected = new Set(pickedHeroes.filter(Boolean));
    const universe = new Set([...heroes,...picks.map(row=>row.hero),...selected]);
    const currentCounts = new Map([...universe].map(hero=>[hero,0]));
    for (const row of picks) currentCounts.set(row.hero,currentCounts.get(row.hero)+1);
    const projectedCounts = new Map(currentCounts);
    if (replacingMatchId) {
      for (const row of picks) {
        if (row.matchid === replacingMatchId) projectedCounts.set(row.hero,projectedCounts.get(row.hero)-1);
      }
    }
    for (const hero of selected) projectedCounts.set(hero,projectedCounts.get(hero)+1);
    const standing = (counts,hero) => {
      const count = counts.get(hero), values = [...counts.values()];
      const rank = 1+values.filter(value=>value > count).length;
      return {picks:count,rank,label:String(rank)};
    };
    return new Map([...universe].map(hero=>{
      const current = standing(currentCounts,hero), projected = standing(projectedCounts,hero);
      const improved = projected.rank < current.rank;
      return [hero,{current,projected,improved}];
    }));
  }

  const pickRankBadgeTiers = Object.freeze(['Eternus','Ascendant','Phantom','Oracle','Emissary','Ritualist','Mystic','Sentinel','Acolyte','Seeker','Initiate']);
  function heroPickBadge(rank) {
    if (!Number.isInteger(rank) || rank < 1) return null;
    const band = Math.min(pickRankBadgeTiers.length-1,Math.floor((rank-1)/4));
    const name = pickRankBadgeTiers[band];
    return {name,image:`images/deadlock/ranks/ranked-mode/${name.toLowerCase()}.png`,minRank:band*4+1,maxRank:band*4+4};
  }

  function validateTeam(name, region) {
    const errors = [];
    if (!regions.includes(region)) errors.push('Choose EU, NA, or APAC.');
    const value = text(name);
    if (!value || value.length > 100 || /^team [12]$/i.test(value)) errors.push('Enter the actual team name (100 characters or fewer).');
    return errors;
  }

  function withFirstPick(sim, first) {
    if (!['left','right'].includes(first)) throw new Error('Choose the first-pick team.');
    const actions = sequence(first,sim.week,sim.region).slice(0,sim.events.length).map((action,i) => ({...action,hero:sim.events[i].hero}));
    return matchToSim({week:sim.week,region:sim.region,left_team:sim.left,right_team:sim.right,first_pick:first,actions});
  }

  function seriesWins(matches, details, teams) {
    const wins = {left:0,right:0}, week = Number(details.week), game = Number(details.game);
    const left = text(teams.left), right = text(teams.right);
    if (!Number.isInteger(week) || week < 1 || !Number.isInteger(game) || game < 1 || !left || !right || left === right) return wins;
    for (const match of matches) {
      if (Number(match.week) !== week || match.region !== details.region || match.round !== details.round
          || Number(match.game) >= game || !['left','right'].includes(match.winner)) continue;
      const sameTeams = (match.left_team === left && match.right_team === right)
        || (match.left_team === right && match.right_team === left);
      if (!sameTeams) continue;
      const winner = match[`${match.winner}_team`];
      wins[winner === left ? 'left' : 'right']++;
    }
    return wins;
  }

  function nextMatch(matches) {
    if (!matches.length) return {week:1,region:'EU',round:'Challenger',game:1};
    const latest = matches.reduce((last,match) => chronology(matchId(match)) > chronology(matchId(last)) ? match : last);
    const week = Number(latest.week), game = Number(latest.game), region = latest.region;
    const nextRegion = () => ({week:region === 'EU' ? week : week+1,region:region === 'EU' ? 'NA' : 'EU',round:'Challenger',game:1});
    let next;
    if (latest.round === 'Challenger' && game === 1) next = {week,region,round:'Finals',game:1};
    else if (latest.round === 'Finals' && game === 1) next = {week,region,round:'Finals',game:2};
    else if (latest.round === 'Finals' && game === 2) {
      const finals = [1,2].map(n => matches.find(match => Number(match.week) === week && match.region === region && match.round === 'Finals' && Number(match.game) === n));
      const winners = finals.map(match => match && ['left','right'].includes(match.winner) ? text(match[`${match.winner}_team`]) : '');
      if (winners.some(winner => !winner)) throw new Error('Finals Games 1 and 2 need winners before deciding whether Game 3 is required.');
      const teams = new Set([finals[0].left_team,finals[0].right_team]);
      if (![finals[1].left_team,finals[1].right_team].every(team => teams.has(team))) throw new Error('The teams in Finals Games 1 and 2 do not match.');
      next = winners[0] !== winners[1] ? {week,region,round:'Finals',game:3} : nextRegion();
    } else if (latest.round === 'Finals' && game === 3) next = nextRegion();
    else throw new Error('The latest match is outside the supported Challenger/Finals sequence.');
    if (next.week > 9999) throw new Error('The next match would exceed week 9999.');
    return next;
  }

  function nextOpenMatch(matches, regionPreference = '') {
    const entry = (week,region,round='Challenger',game=1) => ({week,region,round,game});
    const missingGame = ({week,region}) => {
      const regional = matches.filter(m=>Number(m.week)===week && m.region===region);
      const find = (round,game) => regional.find(m=>m.round===round && Number(m.game)===game);
      for (const [round,game] of [['Challenger',1],['Finals',1],['Finals',2]]) {
        if (!find(round,game)) return entry(week,region,round,game);
      }
      if (find('Finals',3)) return null;
      const finals = [find('Finals',1),find('Finals',2)];
      if (finals.some(m=>!['left','right'].includes(m.winner) || !text(m[`${m.winner}_team`]))) {
        throw new Error('Finals Games 1 and 2 need winners before deciding whether Game 3 is required.');
      }
      if (![finals[1].left_team,finals[1].right_team].every(team=>[finals[0].left_team,finals[0].right_team].includes(team))) {
        throw new Error('The teams in Finals Games 1 and 2 do not match.');
      }
      return finals[0][`${finals[0].winner}_team`]!==finals[1][`${finals[1].winner}_team`] ? entry(week,region,'Finals',3) : null;
    };
    const nextWeek = week => {
      if (week>=9999) throw new Error('The next match would exceed week 9999.');
      return week+1;
    };
    if (regions.includes(regionPreference)) {
      const regional = matches.filter(m=>m.region===regionPreference);
      const week = regional.length ? Math.max(...regional.map(m=>Number(m.week))) :
        (regionPreference==='APAC' ? 1 : Math.max(1,...matches.map(timelineWeek)));
      return missingGame(entry(week,regionPreference)) || entry(nextWeek(week),regionPreference);
    }
    if (!matches.length) return nextMatch(matches);
    // Like legacy New Match, start at the latest active calendar week, not old gaps.
    // Include scheduled APAC stops and APAC events entered manually with real dates.
    const week = Math.max(...matches.map(timelineWeek));
    const eventDates = new Map();
    for (const match of matches) {
      const key = eventKey(match), date = playedOn(match);
      if (date && (!eventDates.has(key) || date < eventDates.get(key))) eventDates.set(key,date);
    }
    const datesApplied = event => ({...event,played_on:eventDates.get(eventKey(event)) || scheduledOn(event)});
    const events = [datesApplied(entry(week,'EU')),datesApplied(entry(week,'NA'))];
    for (const key of new Set([...Object.keys(schedule),...eventDates.keys()])) {
      const {week:shift,region} = parseId(key);
      if (region!=='APAC') continue;
      const event = datesApplied(entry(shift,region));
      if (timelineWeek(event)===week) events.push(event);
    }
    events.sort((a,b)=>chronology(a)-chronology(b));
    for (const event of events) {
      const next = missingGame(event);
      if (next) return next;
    }
    return entry(nextWeek(week),'EU');
  }

  function gameOneTeams(matches, details) {
    if (![2,3].includes(Number(details.game))) return null;
    const first = matches.find(match=>Number(match.week)===Number(details.week)
      && match.region===details.region && match.round===details.round && Number(match.game)===1);
    return first ? {left:first.left_team,right:first.right_team} : null;
  }

  function simToMatch(sim, details, players = {}) {
    const match = {
      week:Number(details.week),region:details.region,round:details.round,game:Number(details.game),
      left_team:text(sim.left),right_team:text(sim.right),first_pick:sim.first,winner:details.winner || null,
      actions:sim.events.map(event => ({type:event.type,order:Number(event.n),side:event.side,
        hero:event.hero,player:event.type === 'pick' ? text(players[event.hero]) : ''}))
    };
    if (details.played_on) match.played_on = details.played_on;
    match.match_id = matchId(match);
    return match;
  }

  function matchToSim(match) {
    const sideSlots = () => ({picks:Array(6).fill(''),bans:Array(banCount(match.week,match.region)).fill('')});
    const slots = {left:sideSlots(),right:sideSlots()};
    const counts = {left:{pick:0,ban:0},right:{pick:0,ban:0}};
    const events = match.actions.map(action => {
      const count = counts[action.side][action.type]++;
      const index = slotIndex(action.side,action.type,count,match.week,match.region);
      slots[action.side][`${action.type}s`][index] = action.hero;
      return {type:action.type,n:action.order,side:action.side,index,hero:action.hero};
    });
    return {week:match.week,region:match.region,left:match.left_team,right:match.right_team,first:match.first_pick,step:events.length,events,slots};
  }

  return Object.freeze({heroes,availability,regions,playedOn,scheduledOn,timelineWeek,eventKey,THREE_BAN_START,banCount,slotIndex,sequence,matchId,chronology,validateMatch,matchToRecords,simToMatch,matchToSim,teamsForRegion,latestHeroPlayer,heroPickRanks,heroPickBadge,validateTeam,withFirstPick,seriesWins,nextMatch,nextOpenMatch,gameOneTeams});
});
