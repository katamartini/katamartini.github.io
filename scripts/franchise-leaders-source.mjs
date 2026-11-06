import { DET_RECEIVING_URL, parseDetroitReceiving } from './footballdb-receiving.mjs';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { TEAMS } from '../nfl/divstreaks-data.mjs';
import { VIEWS, leaderboardDiagnostics, parseLeaderboardTable } from '../nfl/franchise-leaders-data.mjs';

// One explicit source selection; no fallback on HTTP denial.
export function leaderboardUrl(team, view) {
  if (!Object.hasOwn(TEAMS, team) || !Object.hasOwn(VIEWS, view)) throw new Error(`Unknown leaderboard: ${team}/${view}`);
  if (team === 'DET' && view === 'receiving') return DET_RECEIVING_URL;
  const slug = TEAMS[team].name.toLowerCase().replace(/\s+/g, '-');
  const query = `${slug}-all-time-${VIEWS[view].query}-leaders`;
  return `https://www.statmuse.com/nfl/ask/${query}`;
}

// Retry the whole download + validation, never reuse an invalid response.
export async function downloadValidated(url, parse, {
  fetchImpl = fetch, sleep = setTimeout, warn = console.warn, describe = () => ({}),
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response, body;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.text();
      return parse(body);
    } catch (error) {
      const retryable = !response || response.ok || response.status === 408 || response.status === 429 || response.status >= 500;
      const retry = retryable && attempt < 3;
      warn(JSON.stringify({ event: 'franchise-source-failure', url, attempt, retry,
        status: response?.status, responseUrl: response?.url, redirected: response?.redirected, contentType: response?.headers.get('content-type'),
        error: error.message, cause: error.cause?.code || error.cause?.message,
        ...(body === undefined ? {} : { bytes: Buffer.byteLength(body),
          sha256: createHash('sha256').update(body).digest('hex'), ...describe(body) }),
      }));
      if (!retry) throw new Error(`Source failed after ${attempt} attempt(s): ${url}; keeping saved records`, { cause: error });
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

export function downloadLeaderboard(url, team, view, options = {}) {
  if (url === DET_RECEIVING_URL && (team !== 'DET' || view !== 'receiving')) throw new Error('Wrong FootballDB scope');
  return downloadValidated(url, html => url === DET_RECEIVING_URL ? parseDetroitReceiving(html) : parseLeaderboardTable(html, team, view), {
    ...options, describe: html => ({ team, view, ...leaderboardDiagnostics(html) }),
  });
}
