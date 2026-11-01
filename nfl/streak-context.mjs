// Competition ranks compare complete individual runs, rather than every
// overlapping suffix of a run. A projection replaces the subject's own row.
export function streakPosition(row, rows, { scope, coverage, partial = false } = {}) {
  const length = row.length;
  const others = rows.filter(other => other.id !== row.id);
  const place = value => ({ rank: 1 + others.filter(other => other.length > value).length,
    tied: others.some(other => other.length === value) });
  const record = rows.reduce((best, other) => Math.max(best, other.length), length);
  return { scope, coverage, partial, length, ...place(length), record,
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
