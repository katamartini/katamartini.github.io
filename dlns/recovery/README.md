# Partial recovery, 2026-11-14

18 in-scope Challenger/Finals maps with 216 team hero selections are preserved in `verified-sets.json`. These are unordered sets, not complete drafts. Original `history.json`, snapshot, complete-history statistics and local editor remain unchanged. Qualifiers are excluded.

Scope: 55 EU Challenger; 57 EU Challenger and Finals game 1; 59 EU Finals; 59 and 60 NA Challenger and Finals; 61 EU and NA Challenger and Finals. Sources are linked per map. Source agreement is not evidence of independent provenance. No player identities are merged; player names are withheld pending alias review. Historical Melee Creeps and Pulsar Esports are retained rather than retrospective Cloud9/aimerz labels.

The EDL displayed overall order fails a known-data control: its 54-EU-C-1 first pick differs from the original Google-sheet archive. Therefore first pick and all chronology are explicitly null. Alphabetical hero display is not pick order. Do not promote records into the editor until chronology is reliably established.

Bans are included only where the source lists four distinct heroes, disjoint from the twelve picks. For 59-NA-F-1, Deadfrag lists Haze as both picked and banned, so all bans are withheld. Other missing bans are null, not an assertion that no bans occurred. Explicit source contradictions are not guessed away.

This JSON is intentionally a separate format, not `dlns-local-v1` and not an editor backup. It must not be fed into complete-history statistics as if it contained draft order. This recovery does not claim completeness through week 61.
