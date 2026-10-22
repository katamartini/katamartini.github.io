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
  const chronology = id => {
    const [week,region,round,game] = id.split('-');
    return Number(week)*100000 + (region === 'NA' ? 2000 : 0) + (round === 'F' ? 1000 : 0) + Number(game);
  };

  function sequence(first = 'left') {
    const side = other(first);
    const owners = [first,side,side,first,first,side,side,first,first,side,side,first];
    return [
      {type:'ban',order:1,side:first}, {type:'ban',order:2,side},
      ...owners.slice(0,6).map((owner,i) => ({type:'pick',order:i+1,side:owner})),
      {type:'ban',order:3,side}, {type:'ban',order:4,side:first},
      ...owners.slice(6).map((owner,i) => ({type:'pick',order:i+7,side:owner}))
    ];
  }

  function validateMatch(match, options = {}) {
    const errors = [];
    if (!Number.isInteger(match.week) || match.week < 1 || match.week > 9999) errors.push('Enter a week from 1 to 9999.');
    if (!['EU','NA'].includes(match.region)) errors.push('Choose EU or NA.');
    if (!['Challenger','Finals'].includes(match.round)) errors.push('Choose Challenger or Finals.');
    if (!Number.isInteger(match.game) || match.game < 1 || match.game > 99) errors.push('Enter a game number from 1 to 99.');
    if (!['left','right'].includes(match.first_pick)) errors.push('Choose the first-pick team.');
    if (match.winner != null && match.winner !== '' && !['left','right'].includes(match.winner)) errors.push('Choose a valid winner or leave the result pending.');
    const left = text(match.left_team), right = text(match.right_team);
    if (!left || !right || left.length > 100 || right.length > 100 || [left,right].some(t => /^team [12]$/i.test(t))) errors.push('Enter the actual team names (100 characters or fewer).');
    if (left.toLowerCase() === right.toLowerCase()) errors.push('The two teams must be different.');
    if (match.match_id !== matchId(match)) errors.push('The match ID does not match its details.');
    if (!Array.isArray(match.actions) || match.actions.length !== 16) {
      errors.push('Complete all 12 picks and 4 bans.');
      return errors;
    }
    const seenHeroes = new Set(), seenPlayers = new Set(), expected = sequence(match.first_pick);
    match.actions.forEach((action,i) => {
      const wanted = expected[i];
      if (!action || action.type !== wanted.type || action.order !== wanted.order || action.side !== wanted.side) {
        errors.push(`Invalid action at draft slot ${i+1}.`);
        return;
      }
      if (!heroes.includes(action.hero)) errors.push(`Choose a valid hero for draft slot ${i+1}.`);
      else if (chronology(match.match_id) < chronology(availability[action.hero])) errors.push(`${action.hero} was not available for this match.`);
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
      player:text(action.player)
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

  function validateTeam(name, region) {
    const errors = [];
    if (!['EU','NA'].includes(region)) errors.push('Choose EU or NA.');
    const value = text(name);
    if (!value || value.length > 100 || /^team [12]$/i.test(value)) errors.push('Enter the actual team name (100 characters or fewer).');
    return errors;
  }

  function withFirstPick(sim, first) {
    if (!['left','right'].includes(first)) throw new Error('Choose the first-pick team.');
    const actions = sequence(first).slice(0,sim.events.length).map((action,i) => ({...action,hero:sim.events[i].hero}));
    return matchToSim({left_team:sim.left,right_team:sim.right,first_pick:first,actions});
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

  function simToMatch(sim, details, players = {}) {
    const match = {
      week:Number(details.week),region:details.region,round:details.round,game:Number(details.game),
      left_team:text(sim.left),right_team:text(sim.right),first_pick:sim.first,winner:details.winner || null,
      actions:sim.events.map(event => ({type:event.type,order:Number(event.n),side:event.side,
        hero:event.hero,player:event.type === 'pick' ? text(players[event.hero]) : ''}))
    };
    match.match_id = matchId(match);
    return match;
  }

  function matchToSim(match) {
    const slots = {left:{picks:Array(6).fill(''),bans:Array(2).fill('')},right:{picks:Array(6).fill(''),bans:Array(2).fill('')}};
    const counts = {left:{pick:0,ban:0},right:{pick:0,ban:0}};
    const events = match.actions.map(action => {
      const count = counts[action.side][action.type]++;
      const index = action.type === 'pick' ? (action.side === 'left' ? count : 5-count) : (action.side === 'left' ? 1-count : count);
      slots[action.side][`${action.type}s`][index] = action.hero;
      return {type:action.type,n:action.order,side:action.side,index,hero:action.hero};
    });
    return {left:match.left_team,right:match.right_team,first:match.first_pick,step:events.length,events,slots};
  }

  return Object.freeze({heroes,availability,sequence,matchId,chronology,validateMatch,matchToRecords,simToMatch,matchToSim,teamsForRegion,validateTeam,withFirstPick,seriesWins,nextMatch});
});
