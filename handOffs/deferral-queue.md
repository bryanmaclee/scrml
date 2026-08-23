# Deferral queue — arcs deferred on SIZE, whose reason `[1678]` withdrew

<!-- Tracked artifact created S365-bryan, ratified by bryan ("your recs on 2-9", Q8). -->

**Status:** live · **Created:** 2026-08-22 (S365) · **Owner:** PA

## Why this file exists

`[1678]` (S354, STANDING) withdrew initial time investment as a valid reason to defer:

> *"I have often defered large arcs in the past based on the inital time investment and to get the
> language working. that restraint is completely gone for me. days, months or years. dosn't matter
> to me any more"*

**The remaining valid reasons to defer: a genuine dependency, an unratified fork, an unwitnessed
need. Size is not one.** So every artifact still reading *"deferred — too large"* / *"defer to v2"*
/ *"out of scope for the timeline"* is reasoning from a withdrawn constraint and must be re-derived
on merit before being cited.

## ⚑ Honest scoping — what this file is NOT

The S354 wrap recorded *"~54 (Part A) + 23 (Part B) SIZE-deferred items whose reason is now void,
currently only in scratch + this hand-off."* **That working list is UNRECOVERABLE** — it lived in
S354's session scratch, which is session-scoped and gone. Only the one-line summary survives.

**That loss is the argument for this file, not a gap in it.** The question "should we bank the
deferral queue as a tracked artifact?" was asked at S354 and answered at S365; in between, the
untracked list evaporated. An untracked queue does not survive a session boundary.

Rather than pretend to restore 77 items, this file records the **class** and the **method**, so the
population is re-derivable and stays detectable.

## The live population — measured S365, maintained tier only

A corpus-wide grep for size-deferral language returns **695 hits across both repos** and is
worthless: it cannot distinguish *"we deferred X because it was big"* (live, now void) from
*"this cost 10h"* (a record). Archived `BRIEF.md`/`SCOPING.md` files are write-once records of past
decisions, not live deferrals.

Scoped to the **maintained tier** — the docs a live decision actually reads — the population is **4
lines**, and they resolve to **one real item**:

| site | disposition |
|---|---|
| `master-list.md:108` | ⚠️ **LIVE — the one real item.** Cross-function body-split, *"DEFERRED to v0.3.0+ (~200-400h interprocedural CPS, Links territory; would double v0.2.0 scope alone)"* |
| `master-list.md:143` | ⚠️ **LIVE — same item**, the tracking record, same `~200-400h` reason |
| `handOffs/dpa-queue.md:56` | ✅ not a size deferral — it *rejects* cost reasoning verbatim (*"the sign is wrong, not just the size"*) |
| `compiler/SPEC.md:34111` | ✅ not a size deferral — enforcement deferred **to a named build** (the §54 substate-conformance arc). A genuine dependency, which `[1678]` leaves valid. |

### The one live item, and its reason is already refuted

**Cross-function body-split**, deferred on `~200-400h`. **That number was already refuted by bryan's
own S258 ruling** — user-voice S258, verbatim: *"Research showed the ~200-400h 'Links territory'
estimate was the WRONG seam."* The colorless-async / interprocedural-CPS arc was then RATIFIED at
S258 and Phase 1 landed at S269 (`#108` `1c577da5`, `#110` `9c950dfe`).

⚑ **So `master-list.md` has carried a refuted cost estimate as a live deferral reason for ~107
sessions.** Both lines need correcting regardless of what is decided about the remaining work.

> **Note on a stale citation:** the S354 hand-off cited `known-gaps.md:6429` for this refutation.
> That line now holds unrelated content (line numbers shift as the file grows) and **there is no
> body-split entry in `known-gaps.md` at all.** The refutation is real and is in user-voice S258 —
> cite it there. A line-number citation into a growing file is not a durable pointer.

## Method — how to re-derive the population

```sh
# maintained tier only; archived BRIEF/SCOPING are records, not live deferrals
python3 - <<'PY'
import re
pat = re.compile(r'(defer\w*.{0,80}(too (large|big|expensive)|\d+ ?-? ?\d* ?h\b|size))'
                 r'|((too (large|big|expensive))|\bsize\b).{0,60}defer', re.I)
for f in ['master-list.md','handOffs/dpa-queue.md','compiler/SPEC.md','docs/known-gaps.md']:
    for i, l in enumerate(open(f, encoding='utf-8', errors='replace')):
        if pat.search(l): print(f"{f}:{i+1}: {l[:160]}")
PY
```

**Read each hit in context — a grep cannot classify it.** Three outcomes: a genuine dependency
(valid, leave it) · an unratified fork (valid, leave it) · **a size/cost reason (void — re-derive on
merit)**. This mirrors the `corpus-zero-debt` design: a candidate detector plus an author
disposition, never an oracle.

⚑ **Do not build a CI gate over this.** A gate instantly red for reasons no change caused is the
§8 cry-wolf shape that gets bypassed and then deleted. Detection, not control.
