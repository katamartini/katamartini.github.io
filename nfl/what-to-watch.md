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

## Drought lengths and historical ranks

Cards show the elapsed calendar time and relevant game/season count of the
drought that a result would end. The clock runs from the last success to the
scheduled game, or to the actual ending game in the season archive. If that
success is outside verified coverage, the observed duration is a lower bound.
Postseason droughts always show completed seasons; an exact date is added only
when the source schedule verifies it.

Ranks compare maximal individual runs with competition ranking (1, 1, 3).
Separate runs by the same player or franchise count separately. Team comparisons
use the same metric and venue scope. Overall team history covers today's 32
franchises since 1920; venue and matchup history starts in 1999. QB comparisons
start in 1950. Receiving and kicking ranks include the uncapped calculated
history and documented older runs, and are explicitly labeled partial.

The player updaters also calculate franchise-only portions, resetting at team
changes, and attach summarized ranks to eligible watch records. A career run
spanning several clubs is never credited in full to the current club. The
franchise portion can be shorter than the weekly selection threshold, so its
comparison pool retains those short runs too. Unknown coverage gaps remain
censored. One-more projections remove the current run before inserting its
projected length. Ended runs display their final length against the latest
saved history, without future projections.

Tests cover these rules, season boundaries, byes, missing player-game data,
postseason eligibility, and snapshot validity. The page uses versioned entry and
data URLs with revalidation, and has explicit failed-load and offseason states.
