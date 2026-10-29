import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { leaderboardDiagnostics, parseLeaderboardTable } from '../nfl/franchise-leaders-data.mjs';

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
        status: response?.status, contentType: response?.headers.get('content-type'),
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
  return downloadValidated(url, html => parseLeaderboardTable(html, team, view), {
    ...options, describe: html => ({ team, view, ...leaderboardDiagnostics(html) }),
  });
}
