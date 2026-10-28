import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { calculatePlayerTeamTenures, franchiseTenureLeaders, parseRoster, rosterUrl, ROSTER_SOURCE } from '../nfl/longest-tenure-data.mjs';
import { DIVISIONS, TEAMS } from '../nfl/divstreaks-data.mjs';

// Usage: node scripts/update-longest-tenure.mjs [season] [--cached] [--refresh-history]
const now = new Date();
const season = Number(process.argv.find(arg => /^\d{4}$/.test(arg)) || now.getUTCFullYear() - (now.getUTCMonth() < 2 ? 1 : 0));
if (!Number.isInteger(season) || season < 2009 || season > now.getUTCFullYear()) throw new Error('Invalid roster season');
const cache = new URL('../.cache/longest-tenure/', import.meta.url);
await mkdir(cache, { recursive: true });
const rows = [];
for (let year = 1920; year <= season; year += 1) {
  const path = new URL(`roster_${year}.csv`, cache);
  let csv;
  if (process.argv.includes('--cached')) csv = await readFile(path, 'utf8');
  else if (year < season && !process.argv.includes('--refresh-history')) csv = await readFile(path, 'utf8').catch(() => null);
  if (!csv) {
    const response = await fetch(rosterUrl(year), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Roster ${year} download failed: ${response.status}`);
    csv = await response.text();
    await writeFile(path, csv, 'utf8');
  }
  const parsed = parseRoster(csv);
  if (!parsed.length || parsed.some(row => row.season !== year)) throw new Error(`Invalid roster season: ${year}`);
  rows.push(...parsed);
}
const result = calculatePlayerTeamTenures(rows, season);
const data = { schemaVersion: 2, firstSeason: 1920, source: ROSTER_SOURCE, ...result,
  activeCount: result.active.length, allTimeCount: result.allTime.length,
  active: result.active.slice(0, 100), allTime: result.allTime.slice(0, 100),
  franchiseLeaders: franchiseTenureLeaders(result.allTime),
  updated: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now) };
const cities = {
  ARI: 'Arizona', ATL: 'Atlanta', BAL: 'Baltimore', BUF: 'Buffalo', CAR: 'Carolina',
  CHI: 'Chicago', CIN: 'Cincinnati', CLE: 'Cleveland', DAL: 'Dallas', DEN: 'Denver',
  DET: 'Detroit', GB: 'Green Bay', HOU: 'Houston', IND: 'Indianapolis', JAX: 'Jacksonville',
  KC: 'Kansas City', LA: 'Los Angeles', LAC: 'Los Angeles', LV: 'Las Vegas', MIA: 'Miami',
  MIN: 'Minnesota', NE: 'New England', NO: 'New Orleans', NYG: 'New York', NYJ: 'New York',
  PHI: 'Philadelphia', PIT: 'Pittsburgh', SEA: 'Seattle', SF: 'San Francisco',
  TB: 'Tampa Bay', TEN: 'Tennessee', WAS: 'Washington',
};
const escapeHtml = (text) => String(text).replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const teamName = (team) => `${cities[team]} ${TEAMS[team].name}`;
const teamLogo = (team) => `../images/nfl/${({ LA: 'lar', WAS: 'wsh' })[team] || team.toLowerCase()}.png`;
for (const team of data.teams) team.name = teamName(team.team);
const longest = Math.max(...data.teams.map((team) => team.seasons));
const rowsHtml = [...data.teams]
  .sort((a, b) => a.since - b.since || teamName(a.team).localeCompare(teamName(b.team)))
  .map((team) => `      <article class="team-row" data-team="${teamName(team.team)}" data-since="${team.since}" data-division="${DIVISIONS.findIndex((division) => division.name === team.division)}">
        <div class="team"><strong class="team-name"><img class="team-logo" src="${teamLogo(team.team)}" alt="" width="26" height="26" loading="lazy"><span>${teamName(team.team)}</span></strong><span class="division">${team.division}${team.players.length > 1 ? ' · Tied' : ''}</span></div>
        <div class="players">${team.players.map((player) => `<span class="player"><strong>${escapeHtml(player.name)}</strong><span class="position">${escapeHtml(player.position)}</span></span>`).join('')}</div>
        <div class="tenure"><div class="tenure-label"><strong>${team.seasons}</strong><span>seasons</span></div><span class="since">Since ${team.since}</span><div class="track" aria-hidden="true"><span class="bar" style="--width: ${(team.seasons / longest * 100).toFixed(2)}%; --team-color: ${TEAMS[team.team].color}"></span></div></div>
      </article>`).join('\n');
const formattedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.updated}T12:00:00Z`));
const metaHtml = `    <div class="meta"><span><strong>32</strong> teams</span><span><strong>${data.season}</strong> season · roster data through Week ${data.week}</span><span>Updated <time datetime="${data.updated}">${formattedDate}</time></span></div>`;
const pagePath = new URL('../nfl/longest-tenure.html', import.meta.url);
let html = await readFile(pagePath, 'utf8');
for (const [marker, content] of [['rows', rowsHtml], ['meta', metaHtml]]) {
  const expression = new RegExp(`(<!-- tenure-${marker}:start -->)[\\s\\S]*?(<!-- tenure-${marker}:end -->)`);
  if (!expression.test(html)) throw new Error(`Missing page marker: ${marker}`);
  html = html.replace(expression, (_, start, end) => `${start}\n${content}\n      ${end}`);
}
const franchiseJson = Object.entries(data.franchiseLeaders).map(([team, leaders]) =>
  `    "${team}": [\n${leaders.map(row => `      ${JSON.stringify(row)}`).join(',\n')}\n    ]`).join(',\n');
const json = JSON.stringify({ ...data, franchiseLeaders: {} }, null, 2)
  .replace('"franchiseLeaders": {}', `"franchiseLeaders": {\n${franchiseJson}\n  }`);
await writeFile(new URL('../data/longest-tenure.json', import.meta.url), `${json}\n`);
await writeFile(pagePath, html);
console.log(`Saved ${data.teams.length} team leaders, top ${data.active.length} active and top ${data.allTime.length} all-time tenures, plus 32 franchise leaderboards: 1920–${season}, week ${data.week}`);
for (const team of [...data.teams].sort((a, b) => a.since - b.since)) {
  console.log(`${team.team}: ${team.players.map((player) => player.name).join(' / ')} (${team.since}, ${team.seasons} seasons)`);
}
