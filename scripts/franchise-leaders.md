# Franchise leader refresh

Run the offline checks on Node 22:

```sh
node --test nfl/franchise-leaders-data.test.mjs scripts/franchise-leaders-source.test.mjs scripts/footballdb-receiving.test.mjs nfl/divstreaks-data.test.mjs
```

Validate the roster and all 128 live leaderboards without changing the saved dataset:

```sh
node scripts/update-franchise-leaders.mjs --dry-run
```

The normal command (without `--dry-run`) replaces the saved JSON only after every
source, record, coverage check, and roster progression check succeeds. Replacement
uses a temporary file on the same filesystem and an atomic rename. A failed source
never yields partial data or falls back to stale records to claim a successful refresh.

Each source gets at most three attempts, with 1s and 2s backoff and a 45s timeout
per attempt. Transport errors, HTTP 408/429/5xx, and validation failures are retried;
other HTTP errors stop immediately. Repeated invalid HTML still fails closed.

Failure logs are JSON lines containing the URL, attempt, HTTP status/content type
when available, error, response byte count and SHA-256. HTML diagnostics also include
the team, view, page title, table count, and bounded normalized header lists. Full
response bodies are not logged. The parser selects exactly one table with the required
columns, accepts case/whitespace/markup differences, and rejects duplicate required
columns or multiple matching tables. It does not guess alternative statistic meanings.

The October 24/29 DET errors did not retain the response headers or HTML, so their
exact source variation remains unknown. Synthetic regressions cover an unrelated
first table, harmless header formatting, transient incorrect columns, and persistent
malformed data. These demonstrate recovery paths, not a replay of those incidents.
The pull request workflow only runs offline tests; production refresh/publishing
remains in the separate main-only scheduled workflow.

## November 5 follow-up

[The first post-merge run](https://github.com/katamartini/katamartini.github.io/actions/runs/42120699878)
returned HTTP 200 for DET receiving three times, with six tables but no matching
leaderboard. The five logged header lists were standings/schedules. This is missing
leaderboard content, not a header-formatting problem; retrying the same URL did not
recover it. The logs do not establish why the source omitted the answer table.

The DET receiving source now uses the explicit equivalent query
[Detroit Lions receiving yards leaders all-time](https://www.statmuse.com/nfl/ask/detroit-lions-receiving-yards-leaders-all-time).
On November 5, the search-indexed page showed career receiving columns, Calvin
Johnson leading, and rows below the 5,000-yard cutoff. Direct HTML retrieval from
this environment returned HTTP 403. This supports the query choice but does **not**
prove its current raw HTML parses successfully or that the full refresh will pass.
All other 127 source URLs remain unchanged; the successful query URL is recorded
in the saved source metadata only when the complete refresh validates.

The regression fixture reconstructs the five logged header arrays, not the full
incident HTML. Tests cover rejecting that response, using the explicit route,
preserving saved bytes if that route also fails, and rejecting season/game splits
with otherwise valid statistic columns. Diagnostics now retain up to ten header
lists (so all six tables are visible) and the final response URL/redirect flag.
HTTP 403 remains terminal: no alternate-route retry, access workaround, or saved
statistics are used to manufacture a successful refresh.

## November 6 source replacement

The explicit StatMuse query also failed in [run 42299433768](https://github.com/katamartini/katamartini.github.io/actions/runs/42299433768). DET receiving now uses [FootballDB career receiving](https://www.footballdb.com/teams/nfl/detroit-lions/leaders/career-receiving-yards) directly, not as a fallback after an HTTP denial. All other source URLs and atomic save behavior are unchanged. Its dedicated parser requires Detroit career/regular-season scope, exact columns, full player identities, strict integers, unique sorted rows and below-cutoff coverage.

The reduced fixture retains the actual downloaded 50-row table; its title, heading and scope wrapper are reconstructed from observed page text. Full downloaded response SHA-256: 2ee041db1648c79a3e6a409a57b5f32e35fd5e67c09abaea5ecb9eabb60107da. Fixture SHA-256: 7d06cd0dd83f2570ae2a3450c7bb903495275740583a008e913fc32112837bb2. Local parsing does not prove production access. HTTP 403 remains terminal with no alternate-route request. A complete successful scheduled run is required before calling live refresh restored.
