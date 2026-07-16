# BRIEF — Phase 1: colorless-async Seam-A unification (Gaps 1/2/3) — GITI-037

**Change-id:** `colorless-async-seam-a-2026-07-15` · **Dispatched:** S259 (bryan) · **Model:** opus
**Branch (pre-made manual worktree):** `feat/colorless-async-seam-a` @ base `origin/main` `9c27ce9a`
**Worktree:** `/home/bryan-maclee/scrmlMaster/scrml-phase1-async` (ALREADY CREATED — do NOT create your own)

---

## MAPS — REQUIRED FIRST READ
Read `/home/bryan-maclee/scrmlMaster/scrml-phase1-async/.claude/maps/primary.map.md` FIRST (stamp: commit
`f079d0a9`, 2026-07-14). Follow its Task-Shape Routing for codegen/async work. **Currency note:** HEAD is
`9c27ce9a` — landings SINCE the map stamp include S258 compiler fixes (block-splitter #28, E-MATCH-012,
GITI-036 emit-client reference-scan) + 3 conformance-data reintegrations (ss60/ss73/ss74, data-only, no
compiler-source change). Treat map file:line anchors as a verify-against-source hypothesis; the anchors in
THIS brief were verified against `9c27ce9a` directly. Report the load-bearing map finding (incl. "not
load-bearing").

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — incident-count this session: 0
Auto-`isolation:"worktree"` was BROKEN in S258 (landed in the main checkout). You are dispatched into a
PRE-MADE MANUAL worktree. Your FIRST actions:
1. `cd /home/bryan-maclee/scrmlMaster/scrml-phase1-async && pwd` — confirm output is EXACTLY that path.
2. `git -C /home/bryan-maclee/scrmlMaster/scrml-phase1-async branch --show-current` — MUST be
   `feat/colorless-async-seam-a`. `git -C ... status --short` — MUST be clean. If ANY check fails, STOP + report.
3. `cd /home/bryan-maclee/scrmlMaster/scrml-phase1-async && bun install` (worktrees don't inherit
   `node_modules`; the suite fails "cannot find package 'acorn'" otherwise).
4. `cd /home/bryan-maclee/scrmlMaster/scrml-phase1-async && bun run pretest` (populates gitignored
   `samples/compilation-tests/dist/` browser fixtures). Use `bun run test` (chains pretest) for baselines.
5. **ALL writes go to absolute paths UNDER `/home/bryan-maclee/scrmlMaster/scrml-phase1-async/`.** NEVER `cd`
   into `/home/bryan-maclee/scrmlMaster/scrml` (the main checkout). Use `git -C <worktree>` / `--cwd <worktree>`
   for every git/bun op. A relative path resolves against the MAIN checkout via additional-working-dirs — a leak.
6. **Commit INCREMENTALLY** after each meaningful unit (WIP commits fine) + keep an append-only
   `/home/bryan-maclee/scrmlMaster/scrml-phase1-async/progress.md` (timestamped: done / next / blockers). The
   branch + progress.md are your crash-recovery anchor.

---

## THE TASK — Seam-A colorless-async unification (the S258-ratified Phase 1)

**Authority (READ IN FULL FIRST):** `../scrml-support/docs/deep-dives/interprocedural-cps-colorless-async-2026-07-15.md`
(status: current; ruled S258 "do it right"). From the worktree:
`/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/interprocedural-cps-colorless-async-2026-07-15.md`.

**The bug (GITI-037, REPRODUCED on `9c27ce9a`):** a plain `export function` that calls a Promise-returning
host/stdlib primitive (`safeCallAsync` from `scrml:host`, `scrml:auth`, `scrml:http`, …) is NOT marked async
and its call is NOT `await`-ed → the Promise leaks (`r.ok === undefined`). Minimal repro:
```scrml
${
  import { safeCallAsync } from "scrml:host"
  export function callHost(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg) :> ({ ok: false, error: msg }) }
    return r.ok
  }
}
```
Current emit (`--mode library` AND default): `export function callHost(obj) { let _x = safeCallAsync(() => obj.doThing()); … }`
— **no `await`, not `async`.** Target emit: `export async function callHost(obj) { let _x = await safeCallAsync(...); … }`.

**The design (RATIFIED S258 — do NOT re-litigate):** async-ness is COMPILER-INFERRED across function
boundaries, uncolored in source. The dev writes plain code + `safeCallAsync(() => rawHostCall())` only at raw
JS-host boundaries. NO `async`/`await`/`server`-on-fn/`.then` in source. An UNRESOLVABLE async gap → a COMPILE
ERROR pointing at the fix, NEVER a silent leak.

### The emit already works — this is an INFERENCE unification. Close 3 gaps on ONE nucleus.
The nucleus is **`computeAsyncFnNames`** (`compiler/src/codegen/emit-library-shared.ts:89`) — already the
transitive async fixpoint (seed async → any fn calling an async fn becomes async → fixpoint). Its seed today is
`fn.isAsync === true || bodyHasForeignOrSql(fn.body)` (recognizes only `?{}` SQL + `<foreign>`).

- **Gap 1 (seed) — `emit-library-shared.ts:89-123` + `collect.ts` `bodyContains`/`bodyHasForeignOrSql`:** extend
  the per-fn seed so a body that calls a Promise-returning stdlib/vendor primitive ALSO seeds async. REUSE the
  existing classifier `isPromiseReturningStdlibFn` (`module-resolver.js:846-857`, keyed on exportRegistry
  `isAsync`). This requires threading `calleeMap` + `exportRegistry` into `computeAsyncFnNames` (today it takes
  only `fns`, `_sourceText`, `seedAsync`). Keep call-detection STRUCTURAL (the S239 regression was a text-regex
  over-match — `collectCalleeIdents` / structural `call` nodes only; do NOT reintroduce `\bname\s*\(`).
- **Gap 2 (transitivity) — `scheduling.ts:106` `hasServerCallees` (non-transitive) consumed at
  `emit-functions.ts:1174`:** `hasServerCallees` walks ONLY the fn's own top-level statements, so a client/plain
  fn calling a LOCAL PEER that calls `safeCallAsync` isn't colored. Route the plain-fn async classification
  through the transitive `computeAsyncFnNames` fixpoint instead of the flat `hasServerCallees` walk. (Preserve
  `hasServerCallees`'s existing stdlib-classifier behavior where still used; the goal is transitive coloring for
  the plain/client-fn path.)
- **Gap 3 (cross-module seed) — `codegen/index.ts:494` in `asyncExportNamesOf`:** the loop does
  `if (!imp.source.endsWith(".scrml")) continue;` → `scrml:` vendor imports (the async-PRIMITIVE sources
  `scrml:host`/`scrml:auth`/…) are excluded from the transitive cross-module seed. Include `scrml:` vendor async
  exports in the seed (their async-ness is known via the stdlib registry / exportRegistry `isAsync` —
  `isPromiseReturningStdlibFn` is the classifier). GITI-037 = Gaps 1∩3.

### Soundness (must hold; Seam-A only — Seam B is OUT of scope)
- **S4 (failure-mode preservation):** trivially preserved for Seam A — `await calleeAsync()` in an `async` caller
  propagates the callee's `!`/`CpsError` as a Promise rejection (the exact mechanism the server-fn path already
  uses). Verify `!{}` handlers still route correctly across the newly-async boundary.
- **S5 (replay safety):** the monotonicity classification is a call-graph fixpoint (same shape as the async
  fixpoint), cycle-safe by construction. Do not break it.
- **Termination roots already exist + are already `async`** (route handlers, §52 mount IIFEs, reactive/event
  wrappers, SSE). A newly-async fn reachable from one of these is awaited fine.

### The no-silent-leak guarantee (axis-i completeness)
After unification, if a plain fn hits an async boundary the inference CANNOT resolve (e.g. a dynamic
higher-order callee — `scheduling.ts:240-243` classifiers are static-callee-only) OR a newly-async fn is called
from a genuinely-sync context that cannot be made async, it MUST fire a COMPILE ERROR, not leak. REUSE/extend the
existing pattern `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` / `E-SERVER-FN-IN-SYNC-CALLBACK` (`emit-server.ts:1099-1108`,
`:1968`), naming the `safeCallAsync(() => …)` boundary idiom. If you ADD a §34 code, land the §34 catalog row
WITH the impl (Rule 4). Prefer reusing an existing code where the shape matches.

## VERIFICATION — do NOT mark DONE without ALL of these
1. **R26 empirical (the bug-specific symptom check, NOT "tests pass"):** compile the minimal repro above
   `bun --cwd <worktree> compiler/bin/scrml.js compile <repro.scrml> --mode library --output-dir <tmp>` AND
   default-mode. **PASS = the emit shows `export async function callHost` AND `await safeCallAsync(...)`.** Also
   test the TRANSITIVE case (a plain fn calling a local peer that calls `safeCallAsync` — Gap 2) and the
   cross-module case (importing an async `scrml:host` primitive — Gap 3). Put these repros under
   `<worktree>/docs/changes/colorless-async-seam-a-2026-07-15/repros/`.
2. **Full suite green:** `bun --cwd <worktree> run test` (chains pretest) — 0 failures. Coloring MORE fns async
   is the risk surface: a fn newly-async but called from a sync context that can't await it is either a correct
   propagation (good) OR must fire the fail-closed diagnostic (good) — but MUST NOT SyntaxError or silently
   break. Watch for `await`-in-non-async-fn SyntaxErrors and sync-context regressions.
3. **Conformance green:** `bun --cwd <worktree> conformance/run.ts` — 642/642 (current main baseline).
4. Report: files touched, the exact emit before/after for the 3 repros, any §34 code added, any fn that
   flipped async that you did NOT expect (blast radius), and the full-suite delta.

## OUT OF SCOPE (do NOT build)
- **The surfacing NOTATION** (how inferred async-ness appears in signatures/LSP) — a deferred Phase-1 follow-on
  per the DD ("the glyph is not a today-call"). Infer + emit correctly; do NOT design display notation.
- **Seam B** (interprocedural body-split — splitting a callee's INTERIOR client/server batches through the
  caller). The DD defers it; GITI-037 is pure Seam A. Each fn's batches stay whole; a call is one `await`ed unit.
- Re-litigating no-`async`/`await` (settled S114) or `server` placement inference (§12, orthogonal).

## CRASH-RECOVERY
Commit after each gap closes (WIP commits fine); update `progress.md` each step. If you die mid-task, the branch
+ progress.md are the recovery anchor. Report your final branch SHA + files-touched + the R26 emit evidence.
