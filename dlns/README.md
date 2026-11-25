# DLNS — public history and owner publishing

`DLNS.html` reads match history from the repository's `dlns/published-history.json`. It does not contact Supabase, load an authentication SDK, or require a backend service. Public statistics, player history, validation, and the draft simulator use that published file.

## GitHub owner publishing (token method)

In the draft simulator’s **Match entry** bar, choose **Sign in with GitHub**. The familiar sign-in/sign-out layout now uses a token dialog rather than Supabase OAuth. Create your own **fine-grained** token in GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens: resource owner `katamartini`, only `katamartini.github.io`, **Contents: Read and write**, and a short expiration. Metadata read is automatic. No other permissions are needed. Never send a token in chat. This permission covers the repository's contents, not only DLNS; GitHub does not provide a path-scoped contents token. Branch rules may prevent direct writes.

The page verifies the authenticated GitHub user ID and repository access. GitHub enforces actual repository permissions; hiding editor controls alone is not a security boundary. The token is sent only to `https://api.github.com` with redirects disallowed, and stays in page memory by default. **Remember this browser** opts into storing the token in this site's browser local storage, which survives refreshes and browser restarts. On a new page, DraftSim verifies the owner and repository again. Sign out or clear site data to remove the stored token. Use the checkbox only on trusted devices: same-origin scripts and privileged extensions can read browser storage. DraftSim does not read or change Ballin's saved token. The token does not go into cookies, exports, URLs, or commits.

Connect loads the latest repository version, then **Submit match** creates a public GitHub commit, rather than saving only locally. Team registration also creates a commit. Match validation, duplicate IDs, revision checks and GitHub's file SHA protect against stale writes. If another tab changes history, reload GitHub history and load the match again. Failed or ambiguous writes are never automatically retried; reconnect and inspect the latest history first. An accepted commit is not proof of a successful Pages deployment: public viewers see changes after Pages rebuilds, typically a few minutes. The editor uses the saved repository result immediately.

The initial maintained file is an exact copy of the existing 363-match snapshot. `dlns/history.json`, `DLNS.snapshot.js`, original browser caches and separate partial recovery data remain untouched. This feature does not recover missing weeks.

## Draft format by shift

Through Shift 61, a draft has 12 picks and four bans. From Shift 62, it has 12 picks and six bans. In the sequence below, A is the selected first-pick team and B is the other team. The new order was checked against the [EDL EU finals](https://edl.gg/events/deadlock-night-shift-62-eu/series/grand-final-1-deadlock-night-shift-62-eu-template-grand-final?match=match-1) and [EDL NA finals](https://edl.gg/events/deadlock-night-shift-62-na/series/grand-final-1-deadlock-night-shift-62-na-template-grand-final?match=match-1).

- Bans 1–4: A B A B
- Picks 1–6: A B B A B A
- Bans 5–6: B A
- Picks 7–12: B A A B A B

From Shift 62 onward, each team's ban slots fill from its outer edge toward the center. Older shifts keep their original inside-out layout. This changes slot placement only, not the sequence.

DraftSim's owner view follows the match week; loading an old match restores its original format. Crossing the boundary with a draft in progress preserves the draft and requires **Reset** before continuing with the changed week. In the public simulator, choose either draft format. In the JSON action list, `order` remains numbered separately for picks and bans.

## Older browser-only data

Local-only submissions are retired. All URLs, including old `?storage=local` links, load public GitHub history. Owner submissions and team registration publish to GitHub; the simulator itself remains available to everyone. The Match entry bar retains Load match, New match, Autofill and Submit match after sign-in, with username, Reload history and Sign out beside it.

Existing IndexedDB matches, local revision history, old simulator/entry drafts and original cache values are left untouched. A collapsed **Recover older browser-only data** section at the bottom provides export-only downloads for older local matches, the original database cache and older draft forms. It has no import, overwrite or delete controls. Back up from the original browser/profile/site address before clearing site data. Exports are not automatically uploaded or merged. Recover older matches through the reviewed export procedure below or enter them individually after signing in.

## Publishing exported local updates manually

Repository write access controls public updates. Local edits are never automatically uploaded. Connecting a token on the ordinary page does not import a local workspace. Only the explicit Remember this browser option persists a DraftSim token.

1. Export the local backup. Keep that full backup private because it includes historical revisions.
2. Prepare a **new** public file:
   ```sh
   node scripts/prepare-dlns-public.mjs downloaded-backup.json reviewed-history.json
   ```
   The script validates the matches, omits local audit history and cache metadata, and refuses to overwrite an existing file. Match, team, and player names remain public. It only prepares a file; it does not publish.
3. Review the data, including missing weeks and corrections. Replace the maintained `dlns/published-history.json` with the reviewed export, checking for newer GitHub edits first. Keep `history.json` and `DLNS.snapshot.js` intact as recovery evidence. Public reads and token writes both use `published-history.json`; do not change only one path.
4. Publish the reviewed change through the usual GitHub repository workflow. Viewers then receive the new history on reload. Older browser backups remain untouched.

## Recovery limits and original cache

The original Google Sheets export is dated 2026-10-21 and contains **363 matches / 5,808 actions through `54-NA-F-2`**. There are no matches from weeks 55–61 in that file. Its 468 missing player assignments and duplicate assignments in `44-NA-F-1` and `45-NA-F-3` remain preserved. Hero availability rules for week 61 do not establish that those matches have been recovered.

`DLNS.snapshot.js` contains the same historical CSV preview and is retained as evidence, but is no longer automatically loaded. No newer matches or private database revisions were recovered by this change. Supabase's data integrity remains unverified; its project has not been modified or restarted.

Later successful Supabase reads may survive in `localStorage['dlns.database.matches.v1']` on previously used devices. This includes matches, registered teams and a cache timestamp, not the private server revision history. **Download original database cache** downloads that raw value verbatim without parsing, changing, importing or deleting it. Use the original site address and browser profile: localhost cannot read a cache from `https://kmartini.com`. Keep exports from every likely device and compare records manually; a newer timestamp or larger match count does not prove completeness.

The public page never overwrites that cache, older local workspace/draft keys, or saved authentication state. Existing OAuth query parameters no longer initiate authentication. Recovery data is never automatically merged into a recovered database.

The original workbook is not in this checkout. `scripts/import-dlns-history.py` documents the Sheet source and converts an independently obtained workbook; run it in a separate checkout because it overwrites the original import artifacts. Legacy Supabase migrations and `scripts/test-dlns-live.mjs` remain for historical investigation, not as runtime dependencies. Do not run that live test against the stuck project during fallback work.

## Local checks

Node.js 20+ and Python 3 are sufficient to serve the page and run the storage/export checks:

```sh
npm install --prefix .cache/dlns-tools --ignore-scripts fake-indexeddb@6.2.4 playwright@1.58.2 @electric-sql/pglite@0.5.10
node scripts/test-dlns-github.mjs
node scripts/test-dlns-local.mjs
node scripts/test-dlns-public-export.mjs
node scripts/test-dlns-database.mjs
node .cache/dlns-tools/node_modules/playwright/cli.js install chromium
node scripts/test-dlns-local-browser.mjs
node scripts/test-dlns-github-browser.mjs
python -m http.server 4173 --bind 127.0.0.1
```

To use a system Chromium, set `CHROMIUM_PATH=/usr/bin/chromium` for the browser test. The test starts its own localhost server and blocks external requests. It verifies the ordinary public route, export-only recovery, cache preservation, token dialog cancellation and sign-in/sign-out, unavailable storage, and absence of Supabase requests. The PGlite regression suite tests the historical schema locally without contacting the project.
