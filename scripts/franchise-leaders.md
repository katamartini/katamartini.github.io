# Franchise leader refresh

Run the offline checks on Node 22:

```sh
node --test nfl/franchise-leaders-data.test.mjs scripts/franchise-leaders-source.test.mjs nfl/divstreaks-data.test.mjs
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
