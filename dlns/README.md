# DLNS — static history and local editing

`DLNS.html` reads match history from the repository's `dlns/history.json`. It does not contact Supabase, load an authentication SDK, or require a backend service. Public statistics, player history, validation, and the draft simulator use that published file.

## Editing

Choose **Open local workspace to edit**, or visit `DLNS.html?storage=local#draftsim`. The workspace initially starts empty. Open **History, local editing & backups** and either import the published history or import a preserved cache/backup JSON file. Imports replace the local working copy after confirmation; they do not merge or publish.

Use the existing match editor to choose teams, enter week/round/game, complete 12 picks and 4 bans, assign players, and set the winner. Load an existing match to correct it. New teams are stored in the same local workspace. Autofill uses the local history, and statistics update after saving. Strict validation still applies to new saves; historical anomalies can be imported unchanged but must be corrected before editing those records.

**Saves are local to this browser profile and site address.** There is no owner login or remote sync. Anyone using this profile can edit its workspace; this does not grant repository publishing access. Export dated backups after editing and keep copies outside the browser. Browser eviction, private browsing, clearing site data, or losing the device can remove local records. This is not an offline-installed app: serve the repository locally or use the static website to load its assets.

IndexedDB transactions reject conflicting saves from other tabs, changed imports, and stale match revisions. After a conflict, reload data and load the match again. Match edits retain the previous record in local change history. Imports retain the previous dataset and imported backup history. Export includes this history; there is no automatic rollback UI. Inputs are limited to 30 MB and 20,000 matches. Large accumulated backups may eventually require a separately reviewed compact snapshot.

## Publishing updates

Repository write access controls public updates. Local edits are never automatically uploaded, and this page does not store a GitHub token.

1. Export the local backup. Keep that full backup private because it includes historical revisions.
2. Prepare a **new** public file:
   ```sh
   node scripts/prepare-dlns-public.mjs downloaded-backup.json dlns/published-history.json
   ```
   The script validates the matches, omits local audit history and cache metadata, and refuses to overwrite an existing file. Match, team, and player names remain public. It only prepares a file; it does not publish.
3. Review the data, including missing weeks and corrections. Change `SNAPSHOT` in `dlns/database.js` to the new file path. Keep `history.json` and `DLNS.snapshot.js` intact as recovery evidence. For later updates use a new output filename, then review its diff and update the path.
4. Publish the reviewed change through the usual GitHub repository workflow. Viewers then receive the new history on reload. Local workspaces are independent and require an explicit import to adopt it.

## Recovery limits and original cache

The original Google Sheets export is dated 2026-10-21 and contains **363 matches / 5,808 actions through `54-NA-F-2`**. There are no matches from weeks 55–61 in that file. Its 468 missing player assignments and duplicate assignments in `44-NA-F-1` and `45-NA-F-3` remain preserved. Hero availability rules for week 61 do not establish that those matches have been recovered.

`DLNS.snapshot.js` contains the same historical CSV preview and is retained as evidence, but is no longer automatically loaded. No newer matches or private database revisions were recovered by this change. Supabase's data integrity remains unverified; its project has not been modified or restarted.

Later successful Supabase reads may survive in `localStorage['dlns.database.matches.v1']` on previously used devices. This includes matches, registered teams and a cache timestamp, not the private server revision history. **Download original database cache** downloads that raw value verbatim without parsing, changing, importing or deleting it. Use the original site address and browser profile: localhost cannot read a cache from `https://kmartini.com`. Keep exports from every likely device and compare records manually; a newer timestamp or larger match count does not prove completeness.

The new public and local modes never overwrite that cache, the original simulator/entry draft keys, or saved authentication state. Local edits use separate storage. Existing OAuth query parameters no longer initiate authentication. Recovery data is never automatically merged into a recovered database.

The original workbook is not in this checkout. `scripts/import-dlns-history.py` documents the Sheet source and converts an independently obtained workbook; run it in a separate checkout because it overwrites the original import artifacts. Legacy Supabase migrations and `scripts/test-dlns-live.mjs` remain for historical investigation, not as runtime dependencies. Do not run that live test against the stuck project during fallback work.

## Local checks

Node.js 20+ and Python 3 are sufficient to serve the page and run the storage/export checks:

```sh
npm install --prefix .cache/dlns-tools --ignore-scripts fake-indexeddb@6.2.4 playwright@1.58.2 @electric-sql/pglite@0.5.10
node scripts/test-dlns-local.mjs
node scripts/test-dlns-public-export.mjs
node scripts/test-dlns-database.mjs
node .cache/dlns-tools/node_modules/playwright/cli.js install chromium
node scripts/test-dlns-local-browser.mjs
python -m http.server 4173 --bind 127.0.0.1
```

To use a system Chromium, set `CHROMIUM_PATH=/usr/bin/chromium` for the browser test. The test starts its own localhost server and blocks external requests. It verifies the ordinary public route, local editing/import/export, cache preservation, unavailable storage, and absence of Supabase requests. The PGlite regression suite tests the historical schema locally without contacting the project.
