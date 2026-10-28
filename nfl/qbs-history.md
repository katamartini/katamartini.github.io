# Quarterback starting-streak history

`QBs.html#all-time` lists recorded single-franchise runs. `#franchise` keeps
each quarterback's best run per franchise, with competition ranks within that
franchise. The team filter is shareable, for example
`QBs.html?team=BUF#franchise`. Both historical tables use 50 rows per page.

The historical snapshot combines FiveThirtyEight's 1950–2022 starter records,
preserved in a pinned nfelo archive, with ESPN's explicit game-roster QB
starter flags from 2023 onward. nflverse supplies schedule dates and player
identities. Its primary passer is **not** necessarily the starting QB: a starter
can leave after one snap or series, including in season finales.

The committed snapshot contains starter history from 1950 through the cutoff
in `data/qbs.json`, including verified recent and active runs. Records before
1950 are outside the archive's coverage. An explicitly partial import sets
`recentComplete: false` and exposes the recent-history gap in the page's coverage
note. A run still open at that archive boundary has an unknown ending and a
lower-bound length; it is not labeled as ended.

From the repository root:

```sh
node --test nfl/qbs-data.test.mjs nfl/qbs-history.test.mjs
node scripts/update-qbs.mjs
```

The daily GitHub workflow refreshes current rosters, active runs and historical
records together. To fill only the historical views while preserving the current
roster snapshot, run `node scripts/update-qbs-history.mjs`. Downloads need GitHub
and `sports.core.api.espn.com`; in the supplied Node 24 cloud runtime, use
`node --use-env-proxy` for network commands. ESPN starter results are cached in
`.cache/qbs`, shared with the existing active-streak updater. The first historical
refresh needs more requests than subsequent cached runs. Failed or ambiguous
starter reads abort the refresh before writing the published snapshot.

For an explicitly partial offline-friendly import, run
`node scripts/update-qbs-history.mjs --archive-and-current-only`. This retains the
coverage warning and must not replace a complete recent-history refresh silently.

FiveThirtyEight's source data is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with the license in
[`data/qbs-history-LICENSE.txt`](../data/qbs-history-LICENSE.txt). This project
extracts starting QBs and derives consecutive-start runs from that data. The
original field definitions are in
[FiveThirtyEight's NFL Elo documentation](https://github.com/fivethirtyeight/data/tree/master/nfl-elo),
and the pinned mirror URL and SHA-256 are in `qbs-history.mjs`.
