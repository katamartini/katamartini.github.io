# DLNS Match Database

DLNS reads its match history from Supabase. Google Sheets is no longer fetched by the page.

## Editing Matches

Open `https://kmartini.com/DLNS.html#draftsim` and choose **Sign in with GitHub** under Match entry.
Only GitHub account ID `66887569` (katamartini) can submit or edit. Other accounts remain read-only.

For a new match, choose a region and select each team from the dropdown in its draft header. The options include existing teams from that region. Set first pick with the left/right switch between the teams, then enter week, round and game; complete all 16 draft actions, optionally assign players, and submit. The winner has its own left/right switch and a clear control to leave the result pending.

Changing first pick preserves the hero selection order and moves draft ownership to the correct sides. Changing region clears team selections that do not belong to that region. Changing either team clears the winner.

To edit, select a saved match and choose **Load match**. Update it and choose **Save changes**. Edits refresh the page's stats immediately. Reload data on other open clients to see the latest changes.

Each save keeps a private revision snapshot. Concurrent edits are rejected instead of overwriting a newer revision. Match IDs can be corrected by editing their week, region, round or game. There is intentionally no delete control.

## Security

- Tables have row-level security. Matches and hero availability are publicly readable; revision snapshots are owner-only.
- Browser roles have no direct insert, update or delete privileges.
- The save RPC checks the provider-owned GitHub identity in `auth.identities`, not editable user metadata.
- Server-side validation enforces draft order, unique heroes, hero availability, player assignments and canonical match IDs.
- The checked-in publishable key is public by design. No service-role key, database password or OAuth secret belongs in this repo.
- The Supabase OAuth callback is configured in the DLNS GitHub OAuth app. Supabase allows `https://kmartini.com/DLNS.html` and `http://localhost:4173/DLNS.html` as sign-in return URLs.

The schema is in `supabase/migrations/202610210001_dlns.sql`. It was applied before the history import. Apply future database changes through new reviewed migrations; do not rerun this initial migration on an existing database.

## History and Offline Preview

`history.json` is the structured import snapshot: 363 matches through `54-NA-F-2`, with all 5,808 actions. It is not a second live database. The initial import preserved 468 missing player assignments and duplicate player assignments in `44-NA-F-1` and `45-NA-F-3`; those records need corrected player assignments before saving an edit.

The page caches successful database reads locally and still refreshes from the server. If the database cannot be reached, it uses cached data, then lazily loads `DLNS.snapshot.js` as a last-resort offline preview. That fallback is not downloaded on a successful database load and cannot be used to submit matches.

To regenerate import artifacts from an exported source workbook:

```powershell
python scripts/import-dlns-history.py path/to/source.xlsx
```

This writes `dlns/history.json`, updates `DLNS.snapshot.js`, and writes idempotent import SQL to `.cache/dlns/import-history.sql`. Review the report and SQL before applying it. Existing database matches are not overwritten by the import SQL.

## Checks

Node.js 20+ and Python 3 are sufficient for source checks and importing. The database integration test uses PGlite without a live database or credentials:

```powershell
pnpm --dir .cache/dlns-tools add --ignore-scripts @electric-sql/pglite@0.5.10
node scripts/test-dlns-database.mjs
node scripts/test-dlns-live.mjs
```

The first test runs the real schema, imports the committed history, round-trips every draft through the simulator model, and exercises owner/outsider/anonymous access, forged metadata, validation, edits, conflicts and audit history. The live check compares imported content and verifies public reads and anonymous write denial; it does not add or edit matches.

For local browser sign-in testing:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://localhost:4173/DLNS.html#draftsim`. `file://` previews are read-only because OAuth requires an HTTP(S) callback.
