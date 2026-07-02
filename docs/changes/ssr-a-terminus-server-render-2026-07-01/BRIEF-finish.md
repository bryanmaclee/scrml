# BRIEF — SSR A-terminus Dispatch 1 — FINISH the salvaged server-renderer (S234, 2026-07-01)

The prior D1 attempt (agent a2d20327) BUILT a high-quality server-side markup renderer but STALLED at
the commit step (S164 commit-timeout hang, used the stale 300s value). Its work is salvaged +
diagnosed. **Your job: FINISH it** — reuse the salvaged source, close the one gate failure, add the
tests + R26 verification the stall skipped, and land it green. Do NOT rebuild from scratch — the
groundwork is sound.

## STEP 1 — pull in the salvaged source (both files are based on main e5d6a5ff = your base)
Copy from the retained prior worktree into YOUR worktree (a cp — reading another worktree is fine;
writing stays in yours):
```
cp /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2d20327a5a3fdc4a/compiler/src/codegen/emit-ssr-render.ts  "$WORKTREE_ROOT/compiler/src/codegen/emit-ssr-render.ts"
cp /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2d20327a5a3fdc4a/compiler/src/codegen/emit-server.ts      "$WORKTREE_ROOT/compiler/src/codegen/emit-server.ts"
```
(emit-ssr-render.ts is a NEW ~404L module; emit-server.ts overwrites your base's copy with the D1
delta — safe, both were authored on e5d6a5ff.) Then READ both + the design context below; assess the
renderer is sound before finishing (it compiled + passed the full suite except the one guard below).

## DESIGN CONTEXT (what the salvage implements — verify, don't re-derive)
`scrml-support/docs/deep-dives/ssr-prerender-step0-rulings-2026-06-30.md` §2.2/§4.2/§4.3. The renderer
(`emit-ssr-render.ts`, `buildSsrEachRenderers` + `SSR_RENDER_HELPER`) lifts per-row render server-side
for each `<each>` over a seeded server-authority cell, feeds on the B-substrate's §14.8.9-REDACTED rows
(`_scrml_ssr_state[<var>]`), keys rows with `data-scrml-key` (for the NEXT dispatch's DOM-adoption),
and CONSERVATIVELY FALLS BACK to the client-only render (empty mount) for any `<each>` it can't
faithfully serialize (never ships wrong markup). `emit-server.ts` wires it into `generateServerJs`'s
`_scrml_ssr_compose_handler` (fills each mount via `_scrml_ssr_fill_mount`).

## STEP 2 — the FINISH work (the exact remaining items)
1. **Close the P3-FOLLOW `isComponent` guard** (the ONE gate failure). `emit-ssr-render.ts` reads
   `isComponent` (1 occurrence). The test `compiler/tests/unit/p3-follow-no-isComponent-routing.test.js`
   (:206) states the rule: **if it's a routing read → migrate to NR's `resolvedKind`/`resolvedCategory`**
   (see `compiler/src/component-expander.ts` `isUserComponentMarkup()`); **if it's a write-side stamp /
   pre-NR syntactic check → add `emit-ssr-render.ts` to that test's ALLOWED list with a budget.** ASSESS
   which the read actually is (routing decision vs syntactic content-check) and fix accordingly — prefer
   the NR migration if it's a routing read.
2. **Add the D1 integration tests** (the stall skipped these): server-render FILLS the each-mount div ·
   §14.8.9 redaction applied (a protected column ABSENT from the rendered HTML) · `data-scrml-key`
   markers present on rows · the conservative fallback (an unsupported `<each>` → empty mount, no crash).
3. **R26-VERIFY (MANDATORY acceptance):** compile a real `<each>`-over-server-authority-cell app
   (`examples/23-trucking-dispatch/` renders `<each>` over server rows; else construct a minimal
   `<program>` with a Tier-1 server cell + `<each>`). The composed first-paint HTML (server-rendered,
   BEFORE client JS) MUST CONTAIN the rendered rows (view-source shows the data, NOT an empty
   `data-scrml-each-mount`) + REDACTED (protected column absent). Report the before/after first-paint HTML.
4. **Commit green** (full `bun run test`, no --no-verify). **Use `timeout: 600000` on the foreground
   commit** — the prior attempt died on the stale 300s value; the ~26k-suite hook exceeds 5min under
   load (S164/S214). Verify HEAD/tree post-hoc if the hook times out (it still lands).

## DO NOT (this dispatch — subsequent A-terminus dispatches)
- NO DOM-adoption hydration (`runtime-template.js` `_scrml_reconcile_list`) — NEXT dispatch. Your
  client STILL rebuilds the mount (a transient double-render is ACCEPTABLE; HTML-contains-rows is the deliverable).
- NO retiring/narrowing **W-AUTH-002** (`type-system.ts:8322-8343`) — the FINAL A-terminus dispatch.
- NO per-role subtree gating (GITI-027B Option D — deferred). NO per-user query scope.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90). Save WORKTREE_ROOT. `git -C "$WORKTREE_ROOT" merge --ff-only main` to base on e5d6a5ff (S112).
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT; `bun install`; `bun run pretest`.
Edits via **Bash** on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NEVER Edit/Write,
NEVER main-rooted paths, NEVER `cd` into main (`git -C "$WORKTREE_ROOT"`, `bun --cwd`). First commit
message includes verbatim `pwd` (S99). (The STEP-1 `cp` READS the prior worktree but WRITES only into yours.)

# MAPS — `.claude/maps/primary.map.md` first (new-feature/compiler-source). ~5 commits stale — verify vs live source.

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT"`, timeout 600000). Full `bun run test` GREEN before DONE.
Report: WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · how you resolved the isComponent guard (NR-migrate
vs allowlist + why) · the R26 result (first-paint HTML before/after — rows present + redacted) · what's
DEFERRED to the DOM-adoption + W-AUTH-002 dispatches · any new findings.
