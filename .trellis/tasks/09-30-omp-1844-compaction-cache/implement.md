# Implementation record: compaction summarize request reuses main-chain cache

Root cause of the 07:22Z $1.15 miss: the compaction request cut the main chain at the summarize boundary, so the cache entry at the cut had expired (cacheRead 14257 / cacheWrite 265136).

| Layer | What | Why it did not hold live |
|---|---|---|
| 0086 | live-chain lane for turn-boundary compaction + capacity gate | Carrier message with no usage defeated the gate; also refused split-turn |
| 0087 | skip control-only carriers | Still refused split-turn; 3 of 4 real compactions were split-turn |
| 0088 (rollup of 0086+0087+0088 draft) | split-turn rides the live chain in one request | 16:43Z live run refused `capacity-unattested`: the local estimate vs 512k-capped window |
| 0089 | delete the capacity gate entirely; provider overflow is the only safety, live->cold uses the ordinary cold plan (`planColdWindows`) | Measured: 18:15Z usesLiveChainReplay true, cacheRead 162688, cacheWrite 2473 |

Lessons (also in spec `verification-gate-contracts.md`): model the host's in-memory chain, not the session rebuild; classify real compaction shapes first; no local pre-flight capacity verdict; only a measured live trace counts as fixed.

Residuals: native lane has no overflow retry; >1h idle compaction still cache-writes (provider TTL); overflow retry verified offline only; single live request output budget 0.8x reserve.
Post-compaction first request: cacheRead 14257 (system+tools) / cacheWrite 28984 (new summary+tail), expected.
