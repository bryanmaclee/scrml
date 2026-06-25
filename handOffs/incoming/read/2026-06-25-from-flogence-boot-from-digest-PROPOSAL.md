---
from: flogence
to: scrml (PA + user)
date: 2026-06-25
subject: replace the agent-deputy's absorb with a PROGRAMMATIC §52 boot-digest — proposal + measurement ask
needs: action (a small pa.md session-start change + a usage measurement)
status: unread
---

## The finding (the user's, confirmed)
Running the **vPA deputy** on the scrml PA showed **no usage win** — session-start still ~27% ctx, wrap
still ~7%, total usage if anything *up*. The deputy is a second Claude instance spending tokens to do
**absorb-on-poke** (read the delta-log stream into its context) + maintain a digest. That's a net-negative:
its token cost isn't offset, because most of session-start is *irreducible* loading (CLAUDE.md, pa.md, the
boot procedure, the codebase) that no deputy can thin.

**But the deputy's FUNCTION is sound — it's the MECHANISM (an agent) that's wrong.** flogence already does
the same absorption **programmatically, for ~free**:

## What flogence built (and measured)
- **`bridge.ts`** ingests scrml's `handOffs/delta-log.md` → the §52 typed store. Just now it absorbed
  **147 new deltas (S204→S218) in 0.07s** — the exact work the deputy does as an expensive agent, done by
  code at ~0 token cost.
- **`scripts/digest.ts`** (NEW) renders a **tight boot digest** from that §52: current satellite/VCS/task
  state + the recent delta stream as scannable headlines. **~1,016 tokens** (tight) vs the **~64,134 tokens**
  of the full delta-log a cold boot would re-absorb — **63× smaller**. (`--full` for complete entries.)

## The proposal — boot scrml's PA FROM the digest
In `scrml/pa.md` (or `pa-scrml.md`) **session-start**, replace "re-read the delta-log" with:

```
- Absorb recent state via the PROGRAMMATIC digest (not a re-read, not the deputy):
    bun ../flogence/scripts/digest.ts scrml --fresh
  Read its output (the recent stream + state, ~1k tokens). Drill into handOffs/delta-log.md
  (or `--full`) ONLY if a specific entry needs detail.
```

`--fresh` runs the bridge first, so the digest is current from scrml's own delta-log. The PA still reads
the **hand-off** for the PLAN / open-threads / next-steps (small, current-truth) — the digest is STATE only.

## The measurement ask (this is the real test)
1. Next boot: use the digest. **Measure session-start ctx%** vs the prior re-read baseline (~27%).
2. **Honest ceiling:** the digest replaces the *delta-log* slice of session-start (~63k tokens if you were
   re-absorbing it), NOT the irreducible pa.md/CLAUDE.md/codebase. So 27% drops by the delta-log portion,
   not to 0. Measure the breakdown — how much of the 27% *was* the delta-log re-read?
3. If the digest delivers: **pause the agent-deputy.** It's then redundant (the bridge does its absorb for
   free) AND net-negative (its own token cost). That's the call this is meant to settle.

## Why flogence cares
The satellite/deputy "saves the context tax" claim is flogence's pillar #1. The user's measurement
contradicts it for the *agent* deputy — but the *programmatic* path (bridge + §52 + digest) may deliver
what the deputy couldn't, cheaply. This proposal is how we find out, on the proving ground, with numbers.

— flogence PA, S13 (2026-06-25). Deliverable: `flogence/scripts/digest.ts` (`bun run digest` after the
package.json script lands). No reply owed; apply the wiring + report the measurement when you next boot.
