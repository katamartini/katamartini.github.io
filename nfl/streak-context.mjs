// Competition ranks compare complete individual runs, rather than every
// overlapping suffix of a run. A projection replaces the subject's own row.
export function streakHolder(row) {
  const season = point => {
    if (Number.isInteger(point?.season)) return point.season;
    const game = /^(\d{4})_/.exec(point?.game || point?.id || '');
    return game ? Number(game[1]) : null;
  };
  const calendarYear = point => {
    const date = typeof point === 'string' ? point : point?.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? Number(date.slice(0, 4)) : null;
  };
  const documented = String(row.period || '').match(/\b(?:19|20)\d{2}\b/g)?.map(Number) || [];
  const firstSeason = season(row.start) ?? documented[0] ?? calendarYear(row.start);
  const lastSeason = season(row.last) ?? documented.at(-1) ?? calendarYear(row.last);
  const years = firstSeason && lastSeason ? firstSeason === lastSeason ? String(firstSeason) : `${firstSeason}–${lastSeason}` :
    firstSeason ? `From ${firstSeason}; end unverified` : lastSeason ? `Through ${lastSeason}; start unverified` : 'Years unverified';
  return { id: row.id, name: row.name || row.team || 'Holder unverified', teams: row.teams || (row.team ? [row.team] : []),
    opponent: row.opponent || null, length: row.length, firstSeason, lastSeason, years,
    active: !!row.active, lowerBound: !!row.lowerBound || row.startKnown === false };
}

export function streakPosition(row, rows, { scope, coverage, partial = false } = {}) {
  const length = row.length;
  const others = rows.filter(other => other.id !== row.id);
  const place = value => ({ rank: 1 + others.filter(other => other.length > value).length,
    tied: others.some(other => other.length === value) });
  const record = rows.reduce((best, other) => Math.max(best, other.length), length);
  const higher = others.reduce((best, other) => other.length > length ? Math.min(best, other.length) : best, Infinity);
  const holders = value => [...others, row].filter(other => other.length === value).map(streakHolder)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.firstSeason || 0) - (b.firstSeason || 0) || a.id.localeCompare(b.id));
  return { scope, coverage, partial, length, ...place(length), record,
    recordHolders: holders(record),
    nextHigher: Number.isFinite(higher) ? { length: higher, rank: place(higher).rank, holders: holders(higher) } : null,
    next: place(length + 1), lowerBound: !!row.lowerBound || row.startKnown === false };
}

export function playerStreakContext(row, rows, clubRows, team, coverage) {
  const club = clubRows.find(other => other.playerId === row.playerId && other.teams?.[0] === team &&
    other.last?.game === row.last?.game && other.last?.play === row.last?.play);
  return {
    overall: streakPosition(row, rows, { scope: 'Recorded NFL', coverage, partial: true }),
    franchise: club ? streakPosition(club, clubRows.filter(other => other.teams?.[0] === team),
      { scope: team, coverage, partial: true }) : null,
    franchiseTeam: team,
  };
}
