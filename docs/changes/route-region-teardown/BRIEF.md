# BRIEF — route-region teardown + re-entry (`g-route-timer-poll-not-stopped-on-soft-nav`, HIGH)

Archived verbatim at dispatch time per pa-base §5. **Authorized S313** (bryan: *"ratify C. build the
unblocked half"*), re-scoped S314 after the banked design was disproved and the emit-time machinery was
found already built.

**provenance:** `ruling:` user-voice S313 ("ratify C") · `debate:`
`scrml-support/docs/debates/soft-nav-outlet-lifecycle-model-2026-08-02.md` (Pole C 77.75/95)

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

1. `pwd` → WORKTREE_ROOT, MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90).
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git -C "$WORKTREE_ROOT" merge main` (S112). 4. status clean. 5. `cd "$WORKTREE_ROOT" && bun install` then `bun run pretest`.
- EVERY edit via Bash on worktree-absolute paths (`.claude/worktrees/agent-<id>/` segment); NOT Edit/Write; NEVER main-rooted; NEVER `cd` into main. First commit message includes the verbatim startup `pwd`.
- You do NOT have `/code-review`. The S239 adversarial pass is run PA-side and by bryan after you report. Do not simulate it; do not claim it.

## MAPS — REQUIRED FIRST READ

`.claude/maps/primary.map.md` — **refreshed THIS SESSION (S314), watermark `e80b692e`. Main is at
`de2f2b24` and the ONLY commit since the watermark is the docs-only maps landing itself, so the maps are
CURRENT against source — no post-map landings to factor in.** Follow its
**Task-Shape Routing**; rows **1 and 2** are this exact task and were written for it. Then
`.claude/maps/domain.map.md` §"The route region is a THIRD lifecycle owner" — read its **"WHAT THE
IMPLEMENTATION ACTUALLY DOES TODAY"** block *before* scoping — plus `structure.map.md` §"THE
EMITTED-BUNDLE EXECUTION BOUNDARY" and `dependencies.map.md` §"Module-init vs the soft-nav rehydrator".

Map content is a **verify-against-source hypothesis**, but these rows are fresh and were authored from a
source walk this session. Report whether they were load-bearing, "not load-bearing" included.

## NORMATIVE TARGETS — read IN FULL before scoping (Rule 4; the SPEC is authoritative, not this brief)

- **§6.7.2** + **NEW §6.7.2.1** (the third lifecycle owner + the closure clause)
- **§20.8.1** (exclusion clause) · **NEW §20.8.8** (the route-leave / route-enter edge contract)
- §6.7.1a ("bare expression" = the §7.3 lifecycle CATEGORY, not an arity limit — S313)

`§6.7.2` and `§20.8.8` are the **governing sentences that make this a fix rather than an amendment**.
Quote both in your final report.

## WHAT IS ALREADY VERIFIED — do not re-derive, but DO re-confirm cheaply

**The emit-time region↔resource association EXISTS.** `classifyMarkupNodes`
(`emit-reactive-wiring.ts:1091`) threads an `insideOutlet` flag and stamps `node._outletResident`
(`:1105` timer/poll, `:1114` input-state); `:1273` and `:1310` route that resource's teardown into
`_scrml_region_cleanups` instead of the boot-once `_scrml_register_cleanup` (beforeunload).

**Three-way differential, compiled on `e80b692e`, branch read off the emitted bundle:**

| # | shape | emitted branch | verdict |
|---|---|---|---|
| A | `<timer>` at shell top level | `_scrml_register_cleanup` | **correct** — must survive nav |
| B | `<timer>` in a route file | `_scrml_register_cleanup` | **the defect** |
| C | `<timer>` lexically inside `<outlet>…</outlet>` | `_scrml_region_cleanups` | **mechanism works** |

**Root cause: `insideOutlet` is the wrong PREDICATE.** It means "lexical descendant of an `<outlet>`
node in THIS file's AST." Route content is never that — the `<outlet>` is a slot in the SHELL file, the
route lives in its own file, the router fills the slot at nav time. The machinery is right; the
granularity is wrong.

**Loci in this brief are PA-located and TRACED for the runtime half** (`runtime-template.js`
`_scrml_destroy_scope:1339` → reachable only via `_scrml_unmount_scope:1469`; `_scrml_nav_apply_html:2996`
calls `_scrml_teardown_region:3026`; `_scrml_teardown_region:3122` drains only `_scrml_region_cleanups`)
**and LOCATED-not-traced for the emit half.** Treat the emit-side line numbers as verify-first and
**report whether each hypothesis HELD, was REFINED, or was WRONG.**

## THE TASK — both edges, one arc

### Edge 1 — route-LEAVE teardown

Make route-content lifecycle resources region-resident so `_scrml_teardown_region` drains them:

1. **Fix the discriminator.** Route content must be classified region-resident. `fileHasOutlet`
   (`emit-reactive-wiring.ts:1042`) is the SHELL discriminator and file-level granularity is
   **insufficient for the single-file `<page>` form**, which puts shell and routes in ONE file — a
   `<page>`-ancestry test is likely required. Design is yours; the invariant is the A/B/C table above.
2. **Fire author `cleanup()` LIFO at route-leave** (§6.7.2 step, §20.8.8 step 2.5) — **before**
   `liveOutlet.innerHTML = newHtml`, so `cleanup()` observes LIVE DOM (CN-5 asserts exactly this).
3. **Abort in-flight region `<request>`s; cancel pending `animationFrame()`.** `_scrml_destroy_scope`
   already does the latter — reuse, do not reimplement.

### Edge 2 — route-ENTER re-association (§20.8.8 step 3)

**This half is genuinely UNBUILT.** `emit-reactive-wiring.ts:1271-72` explicitly defers it: *"Restart-on-
return for the region timer rides §20.8.4 fresh-per-visit re-hydrate — a bounded follow-on."* No code
implements it. A route's `<timer>` starts exactly ONCE, at chunk module-init, and is never restarted.
§20.8.8 step 3 now requires route-enter to re-run region-associated bodies.

**Why both edges are one arc:** CN-1/CN-2/CN-3/CN-7/CN-9 all assert re-entry counts, so the conformance
set cannot be authored from the leave edge alone. (S313 argued the coupling from "the association must
be established at emit time"; that argument is superseded — it already is. The CN-set argument is the
surviving one and it is weaker. Say so if you find they separate cleanly.)

### ⛔ STOP-IF-BIGGER

If Edge 2 requires **moving route-content lifecycle bodies out of module-init into a registered
region-wiring function**, that is a materially larger codegen change than this brief assumes. **STOP,
report the finding with evidence, and do not build it.** A reported re-scope costs nothing here; the
S313 predecessor stopped on a traced disproof and that was the correct call. Do not build on a locus you
have just disproved.

### FIRST TASK — the cheap check that gates everything

**Verify that a resource created at chunk MODULE-INIT and routed into `_scrml_region_cleanups` is
actually drained on the swap.** This is unproven. It is the same shape as the hypothesis S313 disproved
(the rehydrator captures nothing at module-init), and it is cheap. If it fails, the whole approach
changes — report before proceeding.

## COMMENTS TO CORRECT — scope them, do NOT delete them

Two comments are **SCOPE-ACCURATE and COVERAGE-OVERCLAIMING**, not false. Both describe working
machinery and are locally true; both are silent about how little reaches them:

- `_scrml_teardown_region`'s doc-comment ("reactive display effects / subscriptions / **timers**") — an
  `_outletResident` timer really is drained there. (Tracked as **S313-N6**.)
- `emit-reactive-wiring.ts:1271-72` ("closing the leak … the leak is closed") — true of the
  `_outletResident` branch it sits in; it over-claims the CLASS.

Restate each to name its SCOPE. **This is why 28k tests never noticed** — neither comment is catchable
by reading it against its own function.

## CONFORMANCE — author CN-1 … CN-9. **DO NOT author CN-10.**

Specs verbatim in `docs/changes/route-region-teardown/CONFORMANCE-CN1-CN10.md`. Data-not-TS, under
`conformance/cases/`. **CN-4 must FAIL before your fix and PASS after** — establish that ordering
explicitly.

**CN-10 is BLOCKED and is NOT yours.** `<page keep-alive>` does not compile (`E-PAGE-INVALID-ATTR`); it
is a SPEC-vs-SPEC conflict (§20.8.4's normative MAY vs §4.15's "exactly the four") routed to bryan as a
ruling. Authoring it in any form — including codes-half under `"runtime-half-pending"` — would pin the
OPPOSITE of the ratified ruling into the versioned contract. **If you find yourself needing CN-10 to
pass, stop and report.**

**Do NOT author these** (§8.1 of the debate artifact — they become WRONG under the ruling): B-1, B-2,
B-4, B-5's `shellLog == []` half, A-1's annotation. **B-3's proposed `_scrml_nav_rewire` chain-seeding
fix MUST NOT be built** — the judge rates it the riskiest item any pole proposed. Not building it is a
saving, not a deferral.

## PHASE 3 — R26 EMPIRICAL (MANDATORY; do not mark DONE without it)

1. **EXECUTE the bundle. Do not grep emitted text.** The "emitted ≠ runs" trap has four recorded
   occurrences (S265 theme-switch, S268 component-root, S278 U3, S307 audit). A marker being present in
   the output has repeatedly coexisted with a bundle that throws at load.
2. **Reproduce first**: route with a `<timer>`, soft-nav away, assert the interval STOPS. Must fail
   before your fix.
3. **Hold A, flip B, do not regress C** — assert all three branches of the differential, not just the
   one you are fixing.
4. **★ Shell-timer non-regression is the single most important negative test.** You are editing the very
   predicate that currently classifies shell timers CORRECTLY. A sloppy widening kills them silently and
   **fails OPEN**. Case A must still take the beforeunload path and a shell timer must still tick after
   navigation.
5. **`if=` non-regression** — `_scrml_unmount_scope`'s path must be untouched.
6. Recompile real adopter `.scrml` (`scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`) on the
   post-fix baseline.
7. FULL `bun run test` (not the subset — conformance + browser + e2e live there) → 0 fail before DONE.

**Direction-of-change: `semantics-changed`** (pa-base §8 — the SILENT class: same source, different
behaviour, no diagnostic delta). An existing app whose route `<timer>` ran forever will now stop it.
Only an artifact diff reveals this class, which is why step 6 is not skippable. Classify your landing
explicitly in the report.

## COMMIT DISCIPLINE (S83)

Incremental commits per unit — do NOT batch. WIP commits expected; the branch + an append-only
timestamped `progress.md` are your crash-recovery anchor. `git status` clean before you report DONE.
Never `--no-verify`.

## FINAL REPORT

WORKTREE_ROOT · FINAL_SHA · FILES_TOUCHED · **whether each PA-asserted emit-side locus HELD / was
REFINED / was WRONG** · the module-init-drain check result (the FIRST TASK) · the A/B/C differential
before-and-after · shell-timer non-regression evidence **from an executed bundle** · the two governing
sentences quoted · direction-of-change classification · which CN cases you authored and CN-4's
fail-then-pass ordering · whether Edge 2 separated cleanly from Edge 1 · FULL `bun run test` counts ·
maps feedback (load-bearing or not).

Flag any SPEC clause you touch beyond §6.7.2 / §6.7.2.1 / §20.8.1 / §20.8.8 — **do not expand scope
silently.**
