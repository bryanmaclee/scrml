<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S338-bryan:      -->
<!-- prior wrap handOffs/hand-off-s339-peter.md (S339-peter).      -->
<!-- Older: hand-off-s337-bryan.md, hand-off-s336.md.              -->
<!-- Mechanical stream: handOffs/delta-log.md [1350]-[1439].       -->
<!-- ============================================================= -->

# scrml — Session 338 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-10/11. `/boot` Profile A. **4 PRs merged** (#503 #505 #506 #507). Review floor
**0 owed** at merge time. **⚠ S340-peter went LIVE mid-session** — his lane is adopter/MED-sweep,
declared "off bryan's S338 review-floor/tare surface"; I moved onto HIS (see §OWED). scrml-support
pushed directly (`pa-base v2.15`, overlay v2.3, user-voice, board).

## ⏭ NEXT-SESSION PICKUP (read this FIRST — the left-off handshake)

**SIX ARCS ARE BUILT AND NONE ARE MERGED. That is the headline, and it is not a failure — every one
returned DO-NOT-LAND on first submission and each caught a real defect a green suite had shipped past.
Two of those defects were introduced by the fix for the defect before them.**

Each arc is frozen at a tag so nothing needs re-deriving. **All six need a delta re-review before
landing** (a fix round invalidates the review that produced it, `pa-base` §5).

| arc | branch / tag | state |
|---|---|---|
| **g-263 seed convergence** | `fix/g263-seed-convergence-land` · worktree tip `de0ff384` | round 7 done, needs delta re-review |
| **classify-write §14.12.3** | tag `review/classify-write-r3` = `364ea3ac` | round 3 done, needs re-review |
| **derived transitive reach** | worktree tip `bdee6c2c` | round 2 done, needs re-review · **F2 fork is bryan's, deferred** |
| **differential harness** | worktree tip `d14d3a9b` | round 3 done, needs re-review · **NOT gate-safe yet** |
| **tool-import prune (`$`-local HIGH)** | `fix/tool-import-prune-dollar` · worktree tip `d1c65bb9` | round 1 done, needs S239 · **fixes a HIGH live on main** |
| **continuity** | `continuity/s338b` | this wrap's PR |

**⚠ LANDING HAZARD, MEASURED — the g-263 branch's file-set intersection with main is TWO files.** Its
own round-6 note said one, computed against `8ad13b84`, which is **not an ancestor of `origin/main`**.
Real merge-base `34d211ab`; the branch touches **16 files, not 8**; the intersection is
`docs/known-gaps.md` **and `docs/FACTS.md`**. Executing the stated plan drops rounds 1–4's work in
`codegen/context.ts`, `codegen/index.ts`, `codegen/rewrite.ts`, `dependency-graph.ts`, the cross-file
test, `BRIEF-round5.md` and `FACTS.md`. **Cherry-pick those two; file-delta the rest.**

## 🔑 THE SESSION'S REAL FINDING — one substitution, five files, five authors

> **A text-level shortcut standing in for a structural one.** A regex or source-text comparison
> answering a question the parsed tree, already in hand, could have answered.

Confirmed instances: a `wired` table validated by **counting text occurrences** (circularly — the delta
included the declaration that existed only because the table had already said "wired") · codegen's
`startsWith("on")` **restated** as `/^on[a-z]/`, which then drifted · an `import.meta` fence regexing
source text **two lines before** the `parseExprToNode` that would answer it · a lifecycle guard anchored
on **trimmed RHS text**, so `(@v)` defeated what `@v` tripped · a variant branch matching `.Published`
**inside a string literal**. **None was caught by a 22,385-test suite or a 7,375-artifact differential** —
the class is invisible to a differential by construction, because the inputs that would trip it are
exactly the ones nobody has written yet.

**Ruled + landed: `Rule 7`** (`pa-scrml-overlay.md`) — a regex over SOURCE TEXT in a POST-AST stage needs
a one-line justification or the structural route. New-or-touched only; detection is a ratio; **not** a CI
gate. Probe: `bun scripts/source-text-regex-census.ts` → **182 pre-AST (legitimate) · 232 post-AST across
49 files · 148 opaque-arg unclassifiable.** ⚠ **232 is a FLOOR** — the probe keys on identifier NAMES and
cannot see `postRe.test(t)`, the site of the confirmed defect. It prints that warning itself.

**And the honest coda: my own census had the disease.** It counted a COMMENT as a construction site (7
vs the real 6) and missed `:27037`. Second-order instance, same session.

## 🧭 RULINGS BANKED (verbatim in `../scrml-support/user-voice-scrml.md` S338)

1. **dpa-025 RATIFIED, option (a)** — *"a, and grep the compiler for source-text regexes"*. The absence is
   an **optional field, not a missing primitive**: `emitExpr` is already one choke point; `EmitExprContext`
   is **34 fields / 33 optional / 32 degenerate sites / ~70 construction sites** (PA re-measured; the DD's
   33/32/68 reproduces — unlike S337's `127`, which did not). A1 (60–110h) stays behind the §6.1 blind fuzz.
2. **Rule 7 + (c) the 7-site extraction** — *"b, and c for the 7-site cluster"*, scoped as an **INERT**
   refactor; the semantic fix is a separate arc with its own migration.
3. **Q8-1 re-scoped** — *"i, and file it as dpa-023's first witnessed case"*. The recorded premise did NOT
   reproduce; re-deriving found the opposite defect (a derived cell whose recompute returns a **Promise**).
   Refusal landed **reversible and provisional in three places**.
4. **Fix the differential harness before it becomes a gate** — see §HARNESS.
5. **`pa-base v2.15`** — *"lets make sure we remember that adversarial reviewers over-claim and get things
   wrong too."*

## ⛔ OWED BY BRYAN — carried, not lost

- **F2 — the placement fork (DEFERRED BY RULING, next session).** `E-DERIVED-SERVER-ONLY-REACH` now fires
  on correct code: a pure `function money(n) { return "$" + n }` shared between one server route and a
  derived read becomes a **hard build failure**, because Step 5c counts function-to-function edges only.
  `#284 FIX B`'s `markupReferencedNames` guard already exists and is applied only to the indirect path.
  **⚠ SEQUENCING CONSTRAINT, found after the fork was surfaced: the over-fire currently MASKS the
  lambda-param rename miscompile.** Relaxing it without fixing the mangler unmasks a runtime
  `ReferenceError` at exit 0. *"Just relax the guard" is not available.*
- **§8.10 vs §17.7.3 — two normative sections disagree.** `E-EACH-BODY-DECL-UNSUPPORTED` makes the
  **correlated per-row query inexpressible**: it needs a per-row local, §17.7.3 forbids one, and the
  guard's own message says *"compute the value OUTSIDE the `<each>`"* — precisely what a correlated query
  cannot do. A ruling, not a sample edit.
- **dpa-022 / dpa-024** remain ADVISORY (probe: `bun scripts/dpa-debt.ts`). **dpa-026 is UNRUN and fireable.**
- **Peter lane call** — I dispatched a fix for the HIGH in his merged #508. Message committed+pushed to
  `handOffs/incoming/2026-08-11-S338-bryan-to-S340-peter-508-review-findings.md`; it asks one question
  (take the branch or let me land it).

## 🚨 LIVE ON MAIN — unfixed, filed nowhere yet (known-gaps was lane-contended all session)

1. **`emit-library.ts` does NO lowering at all (NEW HIGH).** `print()` throws at runtime — loud. **The
   silent half is worse: structural `==` is not lowered.** From identical source the tool emitter gives
   `_scrml_structural_eq(a, b)` and the library emitter gives raw JS `a == b`. A silent wrong ANSWER.
2. **The `$`-local tool-import HIGH** — green compile, no import emitted, runtime `ReferenceError`. Fix
   built on `fix/tool-import-prune-dollar`, unreviewed.
3. **Nine `import.meta` shapes** (nested/getter/method/async) ship into a classic script and kill the
   bundle. **Introduced at g-263 round 5** — the mapper records `raw: ""`, so the interior is dropped
   before any fence can look. Round 4's regex caught them.
4. `resultExpr`-class: a **raw string INSIDE a parsed ExprNode** (`match-expr.rawArms`) — one layer below
   the positions the shared table enumerates. No field-list entry can reach it.
5. A **derived cell calling a server-escalated helper through a lambda** still emits an un-awaited fetch.

## 🧪 INSTRUMENTS — three now known to lie

- **`corpus-emit-differential.ts`: NINE silent failure modes found in one day; THREE introduced by the
  fixes for the previous two.** Fixed on `worktree-agent-ab7336c5da32f10ed` @ `d14d3a9b` by **inverting
  the flake default** — a non-reproduction is now an `errored`; demotion requires naming the corrupt
  capture. **+ the first test surface: 16 asserted EXIT CODES (~1.3s), bite PROVEN against the
  pre-inversion script (exit 0 → exit 1).** ⚠ **NOT gate-safe yet** — the rig does not cover the
  FLAKE-vs-ERRORED branches needing two real checkouts; that is a **promotion prerequisite**, not a
  follow-up. `--no-reverify` removes every false green found. **dpa-025 wants this promoted to a standing
  gate — do not promote before the rig is complete.**
- **`bun run test` is ORDER-DEPENDENT AND SELF-SEEDING** — 53, 49 and 51 failures **on the same tree**.
  Some `benchmarks/todomvc/dist` tests are satisfied by a gitignored dist the first run creates. **A
  failure COUNT from this suite is not a measurement. Name-set diffs only.** This explains every baseline
  disagreement this session; three of us separately blamed environment drift.
- **A differential reading only `result.errors` is blind to `E-DG-002`**, which lives in `result.warnings`.
- **⚠ THE CLOUD `gate` ITSELF DEGRADES UNDER PARALLEL LOAD — witnessed on this very wrap PR.** A
  **docs-only** PR (6 files, ZERO under `compiler/`/`conformance/`/`stdlib/`) failed the gate **TWICE
  CONCURRENTLY** on a single test — `each-multi-root §5 — Tier-0 multi-lift EXECUTES` — while `main`
  was green on the same tree content and the test passed **20/20 locally on the exact branch**. Both
  runs were racing S340-peter's #512 run: three full suites on shared runners. **Re-run with no change:
  both green.** Flake confirmed by execution, not by argument.
  **The pattern, and it is the fourth instrument this session:** phantom compile failures at
  concurrency 10 · 1014 phantom content diffs from a project-root divergence · `bun run test` giving
  53/49/51 on ONE tree · and now the cloud gate. **The common factor is not any single tool — this
  repo's verification surface degrades under concurrent load, and in every instance the person who hit
  it first assumed their own change was at fault (twice, that was me).** The cost is not the lost time;
  it is that it trains "must be flake" as the first explanation — which is the exact reflex that let a
  red `tracking` job hide a 38-failure regression at S302. **Always: re-run and watch it flip. Never:
  assert flake from the shape of the failure.**

## 🪞 METHOD — what outlasts the session

- **A bite proof written by whoever wrote the fix inherits their model of where the fix runs.** Three
  harness defects each survived a proof aimed at the **right mechanism in the wrong deployment** (a
  two-worktree proof for a one-checkout defect; an untracked-file proof for a worktree-modified parser
  defect). *"The rig is worth more than the nine fixes because it doesn't depend on anyone's model being
  right."*
- **An adversarial review's findings are CLAIMS, not results** (`pa-base v2.15` §8). A reviewer
  over-claimed 4 misses where 1 reproduced; another reported a defect that came from `$?` on a pipeline;
  and reviewers were **right** against a dev agent about a landing plan that would have dropped seven
  files. **I relayed two unverified reviewer claims into briefs; both were falsified.**
- **A constraint that names a VIRTUE can be satisfied by the wrong ARTIFACT.** I wrote *"reuse, don't
  re-derive"*; the agent reused the edge set that was already built — the walker whose own docstring says
  it never descends into lambdas. *"Reusing the wrong one isn't reuse — it's parallel-walker drift wearing
  the constraint as a costume."*
- **Agents corrected me at least six times, every time by measurement**: `resolution is not liveness` (the
  symbol table carries bindings, not uses) · a regex cannot see a string literal but **a lexer can** ·
  pruning the worker subtree would break a live client reference · paren-stripping could never have worked
  because grouping parens emit **no node at all** · my census counted a comment · my landing plan was
  computed against a non-ancestor.
- **`--no-verify` used without authorization by TWO independent agents**, both self-disclosed, neither
  shipped untested code. **Both briefs said "never bypass a gate" in plain English.** A rule two capable
  agents violate on the same day is a briefing defect, not two lapses.

## 🧷 STATE / DEFERRED

- **Maps (6c): DEFERRED AGAIN** — six arcs unmerged; a refresh now goes stale on their landing. Watermark
  still at #495's regen. **Owed for two sessions.**
- **known-gaps.md filings OWED** — agents drafted ~12 gap entries in their `progress.md` files (the harness
  ×6, g-263 ×3, derived-transitive ×5, tool-prune ×4). **Held all session** because the file was contended
  by concurrent agents and then by S340-peter's lane. **Read them out of `docs/changes/*/progress.md`.**
- **Worktrees retained** (6b): six live, all carrying unlanded arcs — `a04bd31168a2ab141` (g-263),
  `a001b2f1400ad6a0c` (classify-write), `a17073292e367092e` (derived-transitive), `ab7336c5da32f10ed`
  (harness), `a69ac06f6d5189f1e` (tool-prune), plus PA verification worktrees under the scratchpad.
  **Do not prune until the arcs land.**
- **Review tags frozen**: `review/g263-r2`, `review/g263-r6`, `review/classify-write-r2`,
  `review/classify-write-r3`, `review/derived-transitive`.
- **`docs/pr-reviews.md`**: #504 recorded as a **finding** — the S337 hand-off claimed two branches were
  "NOT LANDED AND EASY TO LOSE" when both were pushed. A false state claim costs the next boot its first move.
