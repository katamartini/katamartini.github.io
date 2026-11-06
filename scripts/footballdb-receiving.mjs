import { normalizeName } from '../nfl/franchise-leaders-data.mjs';

export const DET_RECEIVING_URL = 'https://www.footballdb.com/teams/nfl/detroit-lions/leaders/career-receiving-yards';
const plain = value => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const matches = (value, pattern) => [...value.matchAll(pattern)].map(match => match[1]);

// Deliberately scoped to one source and one career leaderboard. Fail closed on
// layout or scope changes instead of treating unrelated tables as player data.
export function parseDetroitReceiving(html) {
  const fail = reason => { throw new Error(`Invalid FootballDB DET receiving: ${reason}`); };
  const title = plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const headings = matches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi).map(plain);
  if (!title.startsWith('Detroit Lions Career Receiving Leaders') || headings.length !== 1 || headings[0] !== 'Detroit Lions Career Receiving Leaders') fail('wrong career leaderboard');
  if (!plain(html).includes('Only stats for Regular Season Games have been included.')) fail('missing regular-season scope');
  if (!/Detroit Lions \(NFL\) from 1934-\d{4} and the Portsmouth Spartans \(NFL\) from 1930-1933/.test(plain(html))) fail('missing franchise history scope');
  const playerIds = new Set();
  let previousYards;
  const expected = ['', 'Player', 'Gms', 'Rec', 'Yds', 'Avg', 'Lg', 'TD'];
  const candidates = matches(html, /<table\b[^>]*>([\s\S]*?)<\/table>/gi).filter(table => {
    const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const rows = matches(head, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
    const headers = matches(rows.at(-1) || '', /<th\b[^>]*>([\s\S]*?)<\/th>/gi).map(plain);
    return JSON.stringify(headers) === JSON.stringify(expected);
  });
  if (candidates.length !== 1) fail('missing or ambiguous columns');
  const bodies = matches(candidates[0], /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi);
  if (bodies.length !== 1) fail('missing or ambiguous body');
  const records = matches(bodies[0], /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi).map((row, index) => {
    const cells = matches(row, /<td\b[^>]*>([\s\S]*?)<\/td>/gi);
    if (cells.length !== expected.length) fail('incomplete row');
    const links = [...cells[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    const names = links.map(link => link[1].match(/\btitle="([^"]+) Stats"/i)?.[1]).filter(Boolean).map(plain);
    const ids = links.map(link => link[1].match(/\bhref="(\/players\/[^"?#]+)"/i)?.[1]);
    if (!links.length || names.length !== links.length || ids.some(id => !id) || new Set(ids).size !== 1 || new Set(names).size !== 1 || !normalizeName(names[0])) fail('invalid player identity');
    if (playerIds.has(ids[0])) fail('duplicate player ID');
    playerIds.add(ids[0]);
    const number = index => {
      const value = plain(cells[index]);
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) fail('invalid integer');
      const result = Number(value.replaceAll(',', ''));
      if (!Number.isSafeInteger(result)) fail('invalid integer');
      return result;
    };
    number(2);
    const yards = number(4);
    const rank = plain(cells[0]);
    const tied = index > 0 && yards === previousYards;
    if (tied ? rank !== '' : rank !== `${index + 1}.`) fail('missing or inconsistent rank');
    previousYards = yards;
    return { team: 'DET', name: names[0], yards, receptions: number(3), touchdowns: number(7) };
  });
  if (!records.length || new Set(records.map(row => normalizeName(row.name))).size !== records.length || records.some((row, i) => i > 0 && row.yards > records[i - 1].yards)) fail('empty, duplicate or unsorted rows');
  if (records.at(-1).yards >= 5000) fail('truncated at qualifying cutoff');
  const qualified = records.filter(row => row.yards >= 5000);
  if (!qualified.length) fail('empty qualifying leaderboard');
  return qualified;
}
