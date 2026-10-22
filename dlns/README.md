# DLNS Match Database

DLNS reads its match history from Supabase. Google Sheets is no longer fetched by the page.

## Editing Matches

Open `https://kmartini.com/DLNS.html#draftsim` and choose **Sign in with GitHub** under Match entry.
Only GitHub account ID `66887569` (katamartini) can submit or edit. Other accounts remain read-only.

For a new match, choose a region and select each team from the dropdown in its draft header. The options include existing teams from that region. Set first pick with the left/right switch between the teams, then enter week, round and game; complete all 16 draft actions, optionally assign players, and submit. The winner has its own left/right switch and a clear control to leave the result pending.

For a team's first appearance, choose **+ Add new team...** at the bottom of either team dropdown while signed in as the owner. Enter the name and choose **Add team**. The name is saved for the current region and selected on that side without changing the draft's heroes or players. It remains available after refresh, on other devices, and before the team's first match is submitted. Names are limited to 100 characters; case-insensitive duplicates reuse the existing name. The same name may be registered in both regions.

Changing first pick preserves the hero selection order and moves draft ownership to the correct sides. Changing region clears team selections that do not belong to that region. Changing either team clears the winner.

The two circles for each team sit in the gap between the draft panels, level with the team names. They show wins in earlier games of the same series, matched by week, region, round and both team names. They follow the team even if it changes sides between games, and never include the current game or pending results.

To edit, select a saved match and choose **Load match**. Update it and choose **Save changes**. Edits refresh the page's stats immediately. Reload data on other open clients to see the latest changes.

**Autofill** refreshes the database and fills the next match's week, region, round and game. It follows EU Challenger, EU Finals, NA Challenger, NA Finals, then the next week; Finals Game 3 is included only when Games 1 and 2 have different winning teams. Missing or pending Finals results must be resolved before it can make that decision. Match order is based on match IDs, not edit timestamps.

Autofill keeps entered heroes, player assignments and valid team selections, clears the previous winner, and switches from editing an old record to creating a new one. It does not save a match; **Submit match** is still required.

Each save keeps a private revision snapshot. Concurrent edits are rejected instead of overwriting a newer revision. Match IDs can be corrected by editing their week, region, round or game. There is intentionally no delete control.

Below the player entries, **Unseen combinations** compares duos through full drafts in rows. The overall column shows the raw unseen count (out of all possible combinations) and its percentage, both before and after counting the new combinations in the current draft. All percentages in this comparison use three decimal places. Each team column shows unseen combinations already picked / all unseen combinations still possible for that team, with the corresponding picked percentage and icons for the new combinations. The denominator excludes historical combinations, banned heroes, opposing picks, and combinations that cannot fit alongside the team's current picks. It includes unseen combinations already picked, so a completed team's ratio is 100% when it has any new combinations, or 0 / 0 (0.000%) when none are unseen. The comparison stacks by combo size on narrow screens.

Below that comparison, **Likely unseen combinations** shows shared top-five lists for duos, trios, quads, quints and full drafts. Rankings are based on history, not the current simulator picks: duos and trios match their existing rankings, while larger combinations use the Likely Unseen weights. Quads and quints are calculated in short background batches; full drafts reuse the existing rarity-index scan. Each list shows progress until its ranking is final, with deterministic alphabetical tie-breaking. Results are cached until the history, hero universe or scoring weights change. Draft clicks only update whether either team can still fit each combination, taking bans, opposing picks and remaining team slots into account. Selected heroes get green outlines while the combination is possible; combinations impossible for both teams remain in place and are greyed out. The existing team-specific duo/trio suggestions are unchanged.

## Security

- Tables have row-level security. Matches, registered team names and hero availability are publicly readable; revision snapshots are owner-only.
- Browser roles have no direct insert, update or delete privileges.
- The match-save and team-registration RPCs check the provider-owned GitHub identity in `auth.identities`, not editable user metadata.
- Server-side validation enforces draft order, unique heroes, hero availability, player assignments and canonical match IDs.
- The checked-in publishable key is public by design. No service-role key, database password or OAuth secret belongs in this repo.
- The Supabase OAuth callback is configured in the DLNS GitHub OAuth app. Supabase allows `https://kmartini.com/DLNS.html` and `http://localhost:4173/DLNS.html` as sign-in return URLs.

The schema is in `supabase/migrations/202610210001_dlns.sql`. It was applied before the history import. Apply future database changes through new reviewed migrations; do not rerun this initial migration on an existing database.

`supabase/migrations/202610210002_dlns_teams.sql` adds region-specific team registration. The dropdown merges these names with teams already found in match history, so historical teams do not need to be registered again.

`supabase/migrations/202610220001_dlns_heroes.sql` adds Rat King and Baba from `59-EU-C-1`, Solomon and Deadman Danny from `60-EU-C-1`, and Violet and Nurse Harrow from `61-EU-C-1`. The shared catalog in `model.js` supplies the simulator, availability calculations and hero icons, including heroes with no recorded appearances. Both client and database validation reject picks and bans before each hero's first available match. The original history snapshot is unchanged.

On screens at least 1800px wide, only the simulator expands into the side columns. The page header, statistics and tab navigation retain the same width and position as the other tabs.

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
