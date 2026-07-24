---
status: current
last-reviewed: 2026-07-24 (S284)
supersedes-framing-in: BUG6-RENAME-SCOPING.md §"residual"
---

# chunk-namespacing BUG-6 accessor-rename — FINISH + LAND scope (the true state)

> **Boot this doc for the focused finish effort.** The BUG-6 accessor-rename is **~90% mechanically done** on a retained branch, but it is **stale + red + needs a real (not mechanical) finish**. The S282 hand-off's "runs next session / 137 text-pins" framing **understated it** — see §"what's LEFT". This doc is the current-truth kickoff; `BUG6-RENAME-SCOPING.md` §2 measurements remain valid, but its "residual" framing is superseded here.
>
> **DONE-PROBE:** `git rev-list --left-right --count origin/main...worktree-agent-a91ad13968b46ab5d` is `0 0` AND `docs/changes/chunk-namespacing/FINISH-SCOPE.md` frontmatter `status: superseded` — i.e. the rename has landed on main and this scope is retired. (Until then: OPEN.)

## Record correction (S284)

**S283 was NOT a no-op orient** (the `active-sessions/S283-bryan.md` board says "no-op"; that is wrong). Git shows S283 **dispatched and ran the full BUG-6 rename campaign** on branch `worktree-agent-a91ad13968b46ab5d` (~24 commits, `074f6ddc`→`307bf9b7`, incl. `096f2239 "archive S283 BUG-6 accessor-rename dispatch brief"`). None of it landed (main was at the S282 wrap). The board is corrected in scrml-support at S284.

## DONE — verified S284 (do not re-do)

- **Mechanism (chunk-namespacing N1–N4)** — complete + proven at S282 (acceptance CLOBBERED→isolated both module formats, real Chromium).
- **BUG-6 core strip** — `_scrml_cell_scope` / `_scrml_cell_key` / `_scrml_cell_name` removed from the always-loaded core (`runtime-template.js`); author-name inverse moved into the conformance shim (`_scrml_cell_name` is production-dead — only the shim calls it). Commit `862b6cf8`.
- **gzip budget HELD** — SPA runtime **16,330 B gzip** (`SPA_COUNTER` fixture), **54 B under the 16,384 budget**. **PA-re-measured S284 on the branch — confirms it holds 16 KB.** (Base main `c27dca49` is still 16,257, 0 drift — the "raise is forced" trigger did NOT fire.)
- **C10.1 tree-shake** — green (the messages accessors no longer appear in the core-only assembly).
- **Acorn callee-rename pass** — wired into codegen (`2eceded0`; ESM crux verified — a renamed local `_scrml_cs_*` never shadows the imported runtime accessor).
- **`E-CG-018` §34 catalog rows** — on the branch (`69dce8be`).
- **Test migration (partial)** — 675 → ~199 fails, 0 regressions claimed. The execution-file **text-pins are essentially done — only ~2 old-accessor-name assertions remain** (the PART-A literal-fold batches `98b96b2d`/`307bf9b7` ground them down).

## The gzip decision — RULED S284: HOLD 16 KB

bryan ruled **hold 16 KB via zero-core-residue** (not raise). Already achieved (16,330). **Caveat (load-bearing):** the 54 B margin is *smaller than the ~200 B gzip whitespace-noise band*, so the finish MUST whitespace-normalize the runtime removal and re-measure carefully; and any future core-runtime addition (any arc) re-breaks it — the budget test enforces this, so it self-guards.

## What's LEFT — the real finish (ordered)

1. **Rebase the branch onto current main** (base is stale `e8fdd44c`, 11 behind `c27dca49`). **Conflict surface = ONE file: `compiler/src/codegen/emit-each.ts`** — the branch's small rename-awareness tweak (18/9 lines, each-helper names) vs #161's component-descent + item-root mount-guard (51 lines, hunks ~675/698/735/938/2180). Resolvable by hand; the bulk of the rename is in NEW files + `runtime-template.js`, untouched by #162/#161. Do NOT replay 46 commits blindly if the rebase gets messy — a net-diff file-delta onto a fresh branch off main is the fallback.
2. **Clean re-count (the stale-branch 199 is POLLUTED — do not trust it).** Post-rebase, re-run the suite with **browser tests ISOLATED** (the happy-dom global-state leak, Bug-60 class, cascades order-dependently and inflates the browser fail count; the #161 agent measured **12 pre-existing base browser flakes**). Stale base also carries fails main already fixed (#150/#161/S282 each+browser work). The **true rename-caused count** is a subset of 199.
3. **Within-node parity — the core rename residual (~19 fails).** The rename shifts the **LIVE** pipeline's emitted accessor names (`_scrml_X` → prologue-wrapped `_scrml_cs_X`), so the native-vs-live byte-parity gate (`M6.5.b.0 within-node parity per-fixture`) goes **over-budget** per fixture (`stdlib/path` residual 27, `stdlib/router` 18, `stdlib/time` 4, `examples/05-multi-step-form` 2, `gauntlet-r10-solid-spreadsheet` 1, …). **RULING NEEDED (surface to bryan):** resolve by (a) regenerating the within-node parity baselines to the post-rename live output [likely — the rename is a live-pipeline codegen change, native follows at the M-swap], (b) applying the rename to the native pipeline too, or (c) making the parity gate rename-aware. This is the largest genuine chunk of remaining work.
4. **Executed-output correctness — HIGHEST RISK, not mechanical.** The campaign has REVERT commits (`c3cc1b95`/`8a09756c`/`7b22aa37`) of a "folded prologue self-recurses / mangled the EXECUTED clientJs." So the rename's executed output HAD bugs. The finish MUST verify the renamed accessors **execute correctly in real Chromium** (reactive get/set/derived round-trip, engine transitions, each reconcile) — emit-shape/text asserts are NOT sufficient (S265 execute-don't-grep). Any residual browser/engine fail that is NOT stale-base and NOT happy-dom-leak is a real executed-output bug to fix here.
5. **Full verification bar (the S282 land bar) — ALL required before landing:**
   - acceptance CLOBBERED→isolated under **both** module formats (classic + ESM) in **real Chromium**;
   - both BUG-6 pinned tests green (`c10-error-message-resolution` tree-shake + `v0-3-x-spa-tree-shake-phase-b` gzip budget), gzip whitespace-normalized + re-measured;
   - full-suite **name-diff clean** vs base (the **31-unique-name** base set — from 34 lines / 3 dups);
   - **artifact-diff PASS** (the hardened 446-file gate, not the hollow 8-of-115);
   - **S239 adversarial** review on the diff (PA-side, mandatory — this is a large blast-radius codegen change).
6. **Land** → PR → cloud `gate` → merge. **Payoff:** closes adopter **#27** (navigate soft-nav) + unblocks the held classic Wave-1c loader AND ESM U4.

## Caveats / traps (read before starting)

- **Stale base** — rebase FIRST; never measure/triage on `e8fdd44c`.
- **happy-dom leak** — run browser tests isolated; 12 base flakes are expected, not rename-caused.
- **Rocky migration** — the reverts prove the executed output is fragile; verify in real Chromium, not emit-shape.
- **gzip margin 54 B < noise band** — whitespace-normalize + re-measure; do not trust a single measurement.
- **Do not re-dispatch fresh** — ~90% (the hard parts: core strip, rename pass, gzip-hold, §34 code) is done + proven; salvage it.

## Held branches — do NOT delete

`worktree-agent-a91ad13968b46ab5d` (the rename campaign @ `307bf9b7`) · `origin/evidence/u4-premise-falsified` · `origin/worktree-agent-a2ed001a5de228134` + local `feat/wave1c-nav` (Wave-1c pieces 2+3 — unblocked the moment this lands).

## How to boot the focused effort

Profile A or a tightly-briefed dispatch. Read: this doc + `BUG6-RENAME-SCOPING.md` (§2 measurements + §3 rename surface) + `SCOPING.md` (the mechanism + the R1/R2/R3 rulings). Then: rebase → clean-count → parity ruling → executed-output fix → verification bar → land. Estimated a focused multi-phase session, not a quick finish.
