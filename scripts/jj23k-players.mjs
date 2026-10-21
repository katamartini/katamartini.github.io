const normalizeName = name => name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');

// Display names are not unique: a rookie can share a veteran's full name.
// Resolve baseline identities once, then use NFL IDs for inclusion and ranks.
export function baselinePlayerIds(leaders, currentPlayers, past, knownIds = new Map()) {
  const names = new Map();
  for (const [id, player] of [...past, ...currentPlayers]) {
    const key = normalizeName(player.name);
    const ids = names.get(key) ?? new Set();
    ids.add(id);
    names.set(key, ids);
  }
  const result = new Map();
  for (const [, name] of leaders) {
    if (knownIds.has(name)) {
      result.set(name, knownIds.get(name));
      continue;
    }
    const candidates = [...(names.get(normalizeName(name)) ?? [])];
    const careerYards = id => (past.get(id)?.yards ?? 0) + (currentPlayers.get(id)?.beforeSeasonYards ?? 0);
    candidates.sort((a, b) => careerYards(b) - careerYards(a));
    if (candidates.length > 1 && careerYards(candidates[0]) === careerYards(candidates[1])) {
      throw new Error(`Ambiguous baseline player identity: ${name}`);
    }
    if (candidates.length) result.set(name, candidates[0]);
  }
  return result;
}
