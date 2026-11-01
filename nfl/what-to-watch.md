# Weekly NFL watch list

`what-to-watch.html` is linked from both NFL indexes. It reads the saved
`data/what-to-watch.json` snapshot, groups notes by game, and filters by team,
category, and search. The weekly view shows the remaining games in the next
unfinished schedule week. The ended view covers the entire NFL season,
including its January/February postseason.

## Refresh

```sh
node scripts/update-what-to-watch.mjs
node --test nfl/what-to-watch-data.test.mjs
```

The updater downloads nflverse's schedule and current rosters, and uses the
existing QB, receiving, kicking, and verified historical-results snapshots.
It validates the output and rejects regressed sources before replacing the
published snapshot. `--cached` uses `.cache/what-to-watch` downloads to reproduce
the calculation offline. When input data is unchanged, it preserves the file
and refresh timestamp.

The `Update NFL what to watch` workflow runs every six hours and after successful
QB, receiving, or kicking updates. It tests before and after generation, commits
the snapshot, and requests a Pages build. Individual player feeds retain their
own refresh schedules. Missing player-game data suppresses affected active
watches until that feed catches up; source coverage dates remain visible.

## Selection and evidence

Thresholds are exported in `what-to-watch-data.mjs` and described on the page:

- Five straight team wins/losses, overall or by venue; five-game winless runs
  containing ties; five meetings without beating an opponent, overall or by venue.
- Sixteen QB starts for one franchise, fifty receiving appearances with a catch,
  twenty made field goals, or forty made field goals and extra points combined.
- Four straight wins when a fifth would end a wait of at least ten seasons.
- Postseason achievements missed for five completed seasons, only in a round
  where an appearance or win can end the drought. Division-clinching scenarios
  are not inferred from standings.

Overall team runs include the validated historical archive; venue and matchup
coverage begins in 1999. Neutral sites never enter venue runs. Ties end strict
win/loss runs and preserve winless droughts. Scheduled games never advance a run.
QB endings require the next verified starter, receiving endings require an
actual zero-catch appearance, and kicking endings require a recorded miss or
block. Censored player runs are excluded. The receiving updater publishes an
additional uncapped watch feed so qualifying runs below its all-time top 100
are retained.

Tests cover these rules, season boundaries, byes, missing player-game data,
postseason eligibility, and snapshot validity. The page uses versioned entry and
data URLs with revalidation, and has explicit failed-load and offseason states.
