# DISPATCH CONTEXT
scrml compiler bug fix: R28-1b (HIGH, CONFIRMED) — gauntlet R28 fix-wave tail, S143. Baseline HEAD `6507f596` (v0.6.11; gate DEFAULT-ON). `isolation: "worktree"`.

# MAPS
`.claude/maps/primary.map.md` ~17 commits stale (watermark `9ab7aa38`). §Task-Shape Routing (compiler-source bug fix) = STARTING HYPOTHESIS; verify via grep/Read.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP+report. Save WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT; `git -C "$WORKTREE_ROOT" status --short` clean; `git -C "$WORKTREE_ROOT" merge main`.
3. `cd "$WORKTREE_ROOT" && bun install`; `bun run pretest`.
4. First commit message includes verbatim `pwd`.
## Path discipline (S126): edit source via Bash (`perl -i`/`python3`/heredoc) on WORKTREE-ABSOLUTE paths with the `.claude/worktrees/agent-<id>/` segment. NO Edit/Write tool for source. NEVER `cd` into main. `git -C`/`bun --cwd`.
# COMMIT DISCIPLINE (S83): commit per change; clean `git status` before DONE; no `--no-verify`.

# THE BUG — R28-1b: block-form <match> inside <each> is NOT rendered per-item
**PA-confirmed empirical (`/tmp/r28-1b/`).** A `<match for=T on=…>` block that is a CHILD of `<each … as alias>` produces broken codegen — TWO defects in the emitted client.js:
1. The each per-item factory (`(article, _scrml_each_idx) => { ... }`) emits a literal comment `// each: unhandled template child kind="match-block"` — **the per-item match is DROPPED**; it never renders inside the item.
2. A phantom MODULE-scope match dispatcher is emitted instead: `function __scrml_match_match_NN_dispatch(_v){...}` + `_scrml_effect(() => __scrml_match_match_NN_dispatch(article.status))` at top level — `article` is the per-item factory param, UNDEFINED at module scope. (In R28's dev-2 it silently resolved to an unrelated formFor-synth `article` cell.)

R28-1 (already landed, `e6fb2f3d`) closed only the `@.`→loop-var GATE-FIRE. This is the deeper architectural gap: `emit-each.ts` has no handler for the `match-block` template-child kind, so block-form match-in-each is structurally unrendered. "node-check-clean ≠ correct" silent-wrong/missing-output class.

## Repro (PA-confirmed):
```
<program title="T">
${ type Status:enum = { Draft, Published }
   type Article:struct = { id: integer, status: Status, title: string } }
<articles>: Article[] = []
<ul>
  <each in=@articles key=@.id as article>
    <li>
      ${article.title}
      <match for=Status on=@.status>
        <Draft>: <span>DRAFT</span>
        <Published>: <span>PUBLISHED</span>
      </>
    </li>
  </each>
</ul>
</program>
```
Compile + grep the emitted client.js: you'll see `// each: unhandled template child kind="match-block"` inside the per-item factory + a module-scope `__scrml_match_match_NN_dispatch(article.status)`.

## What to build:
**Render the block-form `<match>` PER-ITEM inside the each factory.** The per-item factory (`emit-each.ts`, where it walks template children + emits the `// unhandled template child kind="match-block"`) must handle the `match-block` child kind: emit a per-item match render INSIDE the factory body — an item-scoped mount in the item fragment + a per-item dispatch keyed on the item's discriminant (`article.status`, in factory scope where `article` IS defined). SUPPRESS the module-scope match dispatcher + `_scrml_effect` for a match that is a child of an each (it must only render per-item). The factored `emit-variant-guard.ts` helper (variant-source-agnostic; PRIMER §7 — "future match-block-form codegen reuses it") is the intended reuse point; survey it.

**SCOPE FENCE:** stay in CODEGEN — `emit-each.ts` + `emit-match.ts` + `emit-variant-guard.ts` (+ runtime-template.js if a per-item match helper is needed). **Do NOT edit `compiler/src/type-system.ts`** (a sibling dispatch R28-7 is editing it concurrently — a conflict would force a merge). If you find you NEED a type-system change, STOP and report instead.

**If per-item match rendering is a large feature** (it may be — block-form match was designed module-scope-singleton per §51.0/§18.0.1, and per-item instancing needs per-item dispatch state), land an incremental improvement + STOP-report the remainder with a survey. A clean STOP with a precise survey is a good outcome.

# PHASE 3 — R26 EMPIRICAL VERIFICATION (S138 — MANDATORY before DONE)
This is a runtime-correctness bug (node-check passes today; the OUTPUT is wrong). A happy-dom acceptance test is REQUIRED, not just emit-shape:
1. Compile the repro → confirm NO `// unhandled template child kind="match-block"` in the per-item factory + NO module-scope `__scrml_match_..._dispatch(article.status)` referencing the item var out of scope.
2. happy-dom runtime: mount a list of ≥2 articles with DIFFERENT statuses (one `.Draft`, one `.Published`); confirm EACH `<li>` renders ITS OWN match arm (item 1 shows DRAFT, item 2 shows PUBLISHED) — the per-item match resolves to the live per-item value. Add this as a regression test (mirror the existing happy-dom each/match test harness).
3. node --check the emitted JS.
DO NOT mark DONE without the happy-dom per-item-correctness test passing.

# REPORT
WORKTREE_PATH · BRANCH · FINAL_SHA · FILES_TOUCHED · REGRESSION-TESTS-ADDED (incl. the happy-dom per-item test) · R26-RESULT · STOPPED? (+ survey if partial) · MAPS-FEEDBACK.
