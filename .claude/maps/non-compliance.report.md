# non-compliance.report.md
# project: scrml
# generated: 2026-08-09T15:20:00-06:00  commit: 616688ea
# **INCREMENTAL over `35d4d32e` -> `616688ea` (19 commits, TWO operators — bryan S331, peter
# S332/S333/S334).** Ancestry CHECKED FIRST (invariant 48): `git merge-base --is-ancestor 35d4d32e
# HEAD` passes, so the delta is bounded. `616688ea` is one DOCS-ONLY commit ahead of `origin/main`
# (`8863d457`).
# scan mode: INCREMENTAL, TARGETED at the surface this window's diff could have falsified.

## Summary — this pass

**BOTH HAZARDS THE REFRESH BRIEF ASKED ME TO CHECK WERE REAL. Neither was a false alarm, and both
are now corrected in-map.** That is the headline, because it means the failure mode is live and
reproducible, not a one-off:

1. **The §18.5 "single classifier" overstatement is REAL, and its ORIGIN is a live doc, not the
   maps.** `docs/known-gaps.md` calls `planBlockArmLift` *"the single §18.5 classifier"* (`:7784`)
   and *"the single §18.5 tail classifier"* (`:7791`). The maps inherited the phrase; a dispatch
   brief inherited it from the maps; an agent went to two wrong loci. **At HEAD it is the
   segmenter+plan for TWO of FOUR emission routes and has exactly two call sites.** The single
   shared leaf PREDICATE is `_blockTailIsValueExpr`, which all four routes touch. Finding **N1**.
2. **"§12.2 escalation covers a position" is REAL as a class, and SPEC itself now forbids the
   reading** (`SPEC.md:7312`, added this window). But **SPEC contradicts itself one section later**:
   §12.6's library-mode clause (`SPEC.md:7444`) numbers the triggers differently AND names the WRONG
   MODULE SET for placement — `SERVER_ONLY_SCRML_MODULES` instead of
   `ESCALATION_SERVER_ONLY_MODULES`. That is the exact conflation the S299 amendment exists to
   prevent, inside a normative clause. Finding **N2**.

**The most actionable finding for the next dispatch, though, is neither of those. It is N3: THREE
`docs/known-gaps.md` entries carry `status=open` while their fixes LANDED IN THIS WINDOW** and are
recorded in `docs/changelog.md` and `handOffs/delta-log.md`. `scripts/state.ts` derives the
CI-visible rollup from those markers, so the OPEN population over-reports by at least three, and an
agent scoping from the ledger would re-fix landed work — the S248 "three no-op dispatches" class,
recurring.

| | count |
|---|---|
| Tracked `*.md` in scope (outside `archive/`, `handOffs/`, `node_modules/`, `dist/`, `.claude/`) | 268 excluding `docs/changes/**`; ~1,400 including it |
| NEW findings this pass | 5 |
| Carried findings RE-VERIFIED still open | 6 |
| Carried findings **RESOLVED** this pass | 2 (S320-N1, S326-N3-partial) |
| Carried findings WIDENED (same defect, larger measurement) | 1 (the heading/marker drift: 10 → 13 by the NEW machine detector) |
| Uncertain — needs human review | 2 (both carried, unchanged) |

**What this report is NOT claiming.** It did not re-walk `docs/website/`, `docs/articles/`, the
`docs/changes/**` archive beyond this window's additions, or the `samples/` / `examples/` READMEs.
Those carry their prior-pass verdicts. This scan was TARGETED at the surface the window's diff could
have falsified: the 19 changed source files, the §18.5 / §12.2 / §6.6.19 / §44.3 doc surface, the
§34 catalog, the gap ledger, and the map set's own claims.

---

## NEW this pass

### N1. `docs/known-gaps.md` calls `planBlockArmLift` "the single §18.5 classifier" — it is the segmenter for TWO of FOUR routes, and the phrase has already propagated into a dispatch and cost a session

**Reason:** content-heuristic + grep-mismatch. Verified against source at `616688ea`.
**Severity:** HIGH as a process defect. This is a doc phrase that measurably mis-routed an agent.
**Locations:** `docs/known-gaps.md:7784` (inside the RESOLVED body of
`g-match-block-arm-value-lift-covers-one-of-five-paths`) and `:7791` (inside
`g-match-block-iife-tail-classifier-diverges-from-shared-plan`). Sibling phrasings in the archived
briefs: `docs/changes/s330-match-block-arm-value-lift-all-paths/BRIEF.md:11` ("the single §18.5
split+classify plan"), `.../progress.md:30` ("the ONE classifier-driven plan"),
`docs/changes/s331-block-arm-route-unification/BRIEF.md:137` ("the ONE classifier").

**What is actually true at HEAD, each line re-derived:**

- `planBlockArmLift` — `compiler/src/codegen/emit-logic.ts:4715`. **Exactly TWO call sites:**
  `emit-logic.ts:4738` and `emit-control-flow.ts:2109`. Both are RAW-STRING routes.
- `_blockTailIsValueExpr` — `emit-logic.ts:4653`. **FOUR consumers**, two of them direct:
  `emit-logic.ts:4720` (inside `planBlockArmLift`), `emit-logic.ts:4882` (the local-decl
  structured-AST arm), `emit-control-flow.ts:2354` (the IIFE structured-AST arm), plus the two
  string routes transitively.
- The two structured-AST routes do not segment **because an AST arm body already IS a statement
  list.** That is a design property, not an omission — but it means `planBlockArmLift` cannot be
  "the one place the decision is made" in the sense a reader takes from the phrase.

**Why the phrase is seductive and therefore dangerous.** The code comment above `planBlockArmLift`
says *"This is the ONE place the tail-vs-statement decision is made; every value-position
match-lowering path … routes through it"* (`emit-logic.ts:4702-4705`). **That comment is itself
imprecise at HEAD** — `emit-control-flow.ts:2324-2326`'s own comment corrects it, saying the
structured path delegates to `_blockTailIsValueExpr` because *"there is no second, independent
value/void predicate."* **Two comments in two files describing the same seam at two different levels
of abstraction, and the doc quoted the wrong one.**

**Suggested disposition:** update to match current — a one-line correction in each of the two
`docs/known-gaps.md` bodies. The precise wording that survives scrutiny: *"`_blockTailIsValueExpr` is
the single §18.5 tail PREDICATE (all four routes); `planBlockArmLift` is the shared
segmenter+plan for the two raw-string routes."* The archived `docs/changes/**` briefs are historical
records and should be left alone. **Also worth one line in `emit-logic.ts:4702`'s comment**, but that
is a code edit and out of this agent's scope.

---

### N2. `SPEC.md` §12.6 numbers the §12.2 escalation triggers differently from §12.2 itself AND names the WRONG server-only module set for placement

**Reason:** spec-internal contradiction on a confidentiality boundary. Verified by reading both.
**Severity:** MEDIUM-HIGH. It is normative text pointing a reader at the set the S299 amendment
exists to keep OFF the placement decision.
**Location:** `compiler/SPEC.md:7444` vs `compiler/SPEC.md:7290-7297` (the §12.2 numbered list).

`SPEC.md:7444` (§12.6, library mode) reads:

> *"…its escalation reasons (§12.2) are ALL server-only-resource reasons (**Trigger 1**, a server-only
> resource / server-only stdlib import per the **`SERVER_ONLY_SCRML_MODULES`** set; or **Trigger 3**,
> a `?{}` SQL context)…"*

**Both parentheticals disagree with §12.2's own numbered list**, where Trigger 1 is *"accesses a
resource not accessible from the client"* and **Trigger 3 is the server-only stdlib import trigger,
whose set is `ESCALATION_SERVER_ONLY_MODULES`** — named explicitly in §12.2 and enumerated there.
`?{}` SQL is not numbered as Trigger 3 anywhere in §12.2.

**Why this is more than a numbering nit.** §12.2's own S299 amendment note spends four paragraphs
establishing that the two sets are **deliberately distinct** and that reusing the async set
(`SERVER_ONLY_SCRML_MODULES`) for placement was **measured to over-escalate 72 corpus import
sites**. §12.6 then cites that exact set for a placement-adjacent decision. A reader implementing
§12.6 from its own text would consult the wrong set. The implementation is correct
(`isBodyOnlyEscalation` gates on the reason KIND, not on a module set), so **this is a spec-text
defect with no current code consequence — which is precisely why nothing will catch it.**

**Suggested disposition:** update to match current. Renumber the parentheticals to §12.2's list and
replace `SERVER_ONLY_SCRML_MODULES` with `ESCALATION_SERVER_ONLY_MODULES` in the §12.6 clause. **This
is a SPEC edit and therefore an operator/PA decision, not a fix-forward** — flagging only.

---

### N3. THREE `docs/known-gaps.md` entries say `status=open` while their fixes LANDED THIS WINDOW — the rollup over-reports and an agent scoping from the ledger will re-do landed work

**Reason:** grep-mismatch — the entries describe code that no longer exists.
**Severity:** HIGH for dispatch planning. This is the S248 "three no-op dispatches" class recurring.
**Verified:** each fix located in source at `616688ea` AND cross-referenced to `docs/changelog.md`
and `handOffs/delta-log.md`.

| Gap id | Marker | Actually landed | Evidence at HEAD |
|---|---|---|---|
| `g-s34-census-windows-only-url-pathname-breaks-the-one-command-catalog-probe` (`:54`) | `sev=MED status=open locus=scripts/s34-census.ts:49` | **#473 `0beddacc`** (S332-peter) | `scripts/s34-census.ts:48` `import { fileURLToPath } from "node:url"`, `:53` `const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")`. **The entry's own locus `:49` now points at the COMMENT explaining the fix.** `docs/changelog.md:19` records it. |
| `g-server-fn-body-reindent-corrupts-multiline-template-literals` (`:643`) | `sev=MED status=open` | **#474 `7c8e92ff`** (S332-peter) | `emit-server.ts` now carries a mini string/template lexer; `compiler/tests/integration/g-server-fn-reindent-template-literal.test.js` (102L) pins it. `docs/changelog.md:20` records it. **Caveat: a documented residual remains** (a REGEX LITERAL containing a backtick paired with a multi-line template; **corpus-unreachable, 0 instances**) — so the honest marker is `narrowed`, not `resolved`. But `open` with no narrowing note is wrong either way. |
| `g-request-is-some-in-value-bool-class-attr` (`:2588`) | `sev=MED status=open locus=compiler/src/codegen/emit-bindings.ts:383,874` | **#484 `93388e3c`** (S333-peter) | `reparseRequestRefEscapeHatch` + `collectRequestIds` are threaded at both callsites; `unit/request-ref-is-some-value-bool-class-attr-misroute.test.js` (200L) + conformance `lifecycle/request-data-is-some-value-bool-class-attr-rt` pin it. **Two SIBLINGS were filed as NEW open gaps in the same window** (`-in-each-loop-attr-misroute`, `-in-mixed-text-attr-template-misroute`), which is likely how the parent's own status was missed. |

**The transferable point, and it is the reason this is HIGH and not bookkeeping.** `scripts/state.ts`
derives the `@generated:gap-counts` rollup — and its CI `--check` gate — from **the marker**. The
gate passes. The counts are internally consistent. **They are just wrong about the world**, and
nothing in the repo compares a gap's locus against HEAD. Two of the three were fixed by a DIFFERENT
operator than the one who filed them, which is the structural reason: the fixing clone had no
prompt to close the other clone's ledger entry.

**Suggested disposition:** update to match current — flip `#473`'s and `#484`'s markers to
`resolved`, and `#474`'s to `narrowed` with its residual named. **A durable fix exists and is
cheap:** `state.ts` already grew a `headingMarkerDrift()` detector this window; a sibling check that
greps each `open` entry's `locus=` file for the exact code the entry quotes would have caught all
three. See N5.

---

### N4. `docs/known-gaps.md` heading-vs-marker status drift is now MACHINE-MEASURED at **13** — and the machine that measures it is WARN-only by design

**Reason:** the doc disagrees with itself; now instrumented.
**Severity:** MEDIUM. **Status change: this finding is no longer an estimate.** The prior pass
counted 10 by hand and a later pass said 19. `scripts/state.ts --check` at `616688ea` reports
**13 DRIFT**, and that figure is now reproducible on demand — #485 shipped the detector.

The thirteen, verbatim from `bun scripts/state.ts --check`:

```
L1338 G-DBAUTH-DOCS-NO-DO-NOT-MARK-USERS-EXAMPLE: heading=resolved marker=open
L3035 g-tailwind-lint-false-fires-on-scoped-class: heading=open marker=resolved
L3047 g-control-flow-in-markup-lift-body-evades-diagnostic: heading=open marker=resolved
L3057 g-safecall-bang-handler-not-lowered-in-library-mode: heading=open marker=resolved
L3062 g-bindvalue-wiring-dropped-in-match-arm: heading=open marker=resolved
L3074 g-expr-event-handler-dead-in-each: heading=open marker=resolved
L3077 g-onmount-async-call-renders-slot: heading=open marker=resolved
L3084 g-enum-toenum-not-lowered-server-side: heading=open marker=resolved
L5112 g-sse-route-object-typer-scope: heading=open marker=resolved
L5123 g-each-peritem-markup-value-ternary: heading=open marker=resolved
L5126 g-nested-interp-in-markup-value-literal: heading=open marker=resolved
L5129 g-nested-each-outer-key-reuse-inner-frozen: heading=open marker=resolved
L5137 g-foreign-inline-crossing-shadow: heading=open marker=resolved
```

**Note the direction, because it is not uniform.** Twelve read `heading=open marker=resolved` — the
grep-visible line over-reports open work. **One (`L1338`) runs the OTHER way**: the heading says
resolved while the marker says open, so a human skimming headings would believe a DB-authoritative
docs gap was closed when the counted state is open. **A drift detector that only checked one
direction would have missed it** — the same bidirectional-hole-detection principle the audits
mandate.

**Suggested disposition:** update to match current, thirteen one-line edits. **Do NOT gate it** —
the WARN-only choice is correct and deliberate (pre-existing drift exists, a hard gate blocks CI,
and this is doc hygiene not a currency guarantee).

---

### N5. `route-inference.ts:3438` cites SPEC **§6.6.20**; the section is **§6.6.19**

**Reason:** grep-mismatch — a code comment cross-references a SPEC section that does not exist.
**Severity:** LOW, but it is in the file carrying this window's flagship landing and it is one word.
**Detail:** `compiler/src/route-inference.ts:3438` —

```
 * the derived-cell-RHS one (`collectDerivedRhsServerOnlyRefs`, §6.6.20).
```

Every other reference in the same file and in the conformance cases says **§6.6.19**
(`route-inference.ts:3600`, `:4429`, `SPEC.md:3694`, `SPEC.md:3304`, `SPEC.md:19483`,
`SPEC.md:7312`, `SPEC-INDEX.md:134`, and all three `conformance/cases/derived/…/expected.json`).
`grep -n "6\.6\.20" compiler/SPEC.md` returns **nothing** — the section does not exist.

**Suggested disposition:** update to match current (one character). Flagged rather than fixed —
this agent does not edit source.

---

## RESOLVED this pass

### S320-N1 — **CLOSED.** `scripts/s34-census.ts` is no longer broken on any platform

Carried for **four consecutive passes** as "the one-line code fix is still owed". #473 (`0beddacc`,
S332-peter) landed it: `fileURLToPath(import.meta.url)` replaces
`new URL(import.meta.url).pathname`, mirroring `scripts/facts.ts` one file over. Re-executed at this
HEAD: `807 rows (§34 19113..19991, derived) · 1887 source files · 880 conformance cases`.

**The map set's own guidance was the collateral damage and it is now retired, not softened.**
primary.map.md, error.map.md and structure.map.md each carried a "broken / broken-on-Windows, fall
back to the manual table-column methodology" caveat. All three now say **run the oracle first, on
any platform**, and the manual `awk -F'|'` methodology is re-labelled an **independent cross-check**
rather than a fallback. (It agreed this pass: 808 EWIH rows = 807 `[EWI]` + 1 `H-LIFECYCLE-001`.)

⚠ **The gap ledger has NOT caught up** — see N3.

### S326-N3 — **PARTIALLY CLOSED**, and the closure is structural rather than editorial

The heading-vs-marker drift itself is not fixed (13 instances stand, N4). **What IS fixed is the
blindness**: #485 shipped `headingMarkerDrift()` in `scripts/state.ts`, so the disagreement is now
reported on every `--check` run instead of being rediscovered by each map pass with a different
hand count (10, then 19, now a reproducible 13). **A finding that moves from "estimated by hand each
pass" to "printed by a probe" has changed category**, even with the same instances outstanding.

---

## Carried findings — RE-VERIFIED at this HEAD

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
**Still open.** `grep -c "data-scrml-each-mount" compiler/SPEC.md` = **1**. Unchanged this window.

### C4. NINE live `W-LINT-*` codes have no §34 row — **re-measured, and the count is NINE, not eight**
**Still open, and WIDENED by measurement.** Each of `W-LINT-016` … `W-LINT-024` returns **0** rows
from `grep -c "| W-LINT-0NN " compiler/SPEC.md` while each appears in `compiler/src/`. The prior two
passes recorded this as "EIGHT"; the re-derivation at this HEAD says **nine** (`016`–`024`
inclusive). **The correction matters more than the delta**: a carried count that nobody re-derives
is exactly the rot class this report exists to name, and this report was the one carrying it.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
**Still open.** The generated totals + section row-ranges regenerated this window (+133 lines,
CI-gated by `scripts/regen-spec-index.ts --check`, and §6.6.19's insertion forced every range below
it to move). **Only the totals and ranges are gated.** The authored per-section prose is ungated and
was not touched.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
**Still open, count unchanged at 4.** Re-verified: `grep -c "v0\.7\.0" docs/tutorial.md` = 4;
`package.json` `"version": "0.7.1"`.

### C7. `compiler/native-parser/` — zero diff, none owed
**Still true.** `git diff --name-only 35d4d32e..616688ea -- compiler/native-parser/` is **EMPTY**.
The standing `.scrml`-mirror feature-staleness gap is unchanged and nothing this window widened it.

### C8. The four `*.generated.md` indexes are unmaintainable — and this window is the fifth demonstration
**Still open, and the gap widened again.** `.claude/maps/test.generated.md`,
`structure.generated.md`, `dependencies.generated.md` and `error.generated.md` are all stamped
**2026-06-25** and have not moved in six windows. `test.generated.md` claims 1042 `.test.js`; the
truth at this HEAD is **1,334** — it now under-reports by **292** (was 286).
**Suggested disposition: delete them.** They are strictly dominated by the hand-walked maps beside
them and their only function now is to give a grep a wrong answer.

### S313-N5. `scripts/git-hooks/pre-push` — comment still stale
**Still open.** Unchanged this window (`scripts/git-hooks/` has zero diff).

### S322-N1. `g-auto-await-family-not-closed-…` bakes **150** into an ID whose measurement is **142**
**Still open.** Unchanged this window. The ID is load-bearing for grep, so the disposition remains
"leave the ID, correct the body" rather than a rename.

---

## Map corrections applied this pass — what was WRONG and is now right

Recorded here rather than fixed silently, because the corrections ARE findings.

| Map claim (prior generation) | Truth at `616688ea` |
|---|---|
| §18.5: `planBlockArmLift` reads as the single classifier every path routes through | **FOUR emission routes; `planBlockArmLift` has TWO call sites and is the segmenter+plan for the raw-string pair. `_blockTailIsValueExpr` is the single leaf predicate.** Four-route table added to domain.map.md; invariant 49 added; dependencies.map.md's §18.5 row rewritten in place |
| §12.2 Trigger 3 described without a scope statement | **Escalation is per-FUNCTION and reaches no other position (`SPEC.md:7312`, normative this window). Two non-function positions still LEAK with no diagnostic.** Scope table added to domain.map.md; invariant 50 added; auth.map.md gains the coverage table |
| `_blockTailIsValueExpr` at `emit-logic.ts:4535` | **`:4653`** |
| `inverseCallerMap` at `route-inference.ts:4466`; `indirectInverseCallerMap` at `:4707`; `W-AUTH-MIDDLEWARE-AUTO-INJECTED` at `:5648` | **`:4727` · `:4968` · `:6001`** |
| `SERVER_ONLY_SCRML_MODULES` at `route-inference.ts:578`; `ESCALATION_…` at `:655` | **`:579` · `:656`** |
| §34 catalog **806**, "unchanged" | **807** — first movement in five windows (`E-DERIVED-SERVER-ONLY-REACH`) |
| `s34-census.ts` "broken on Windows, use the manual fallback" | **FIXED (#473). Runs everywhere. The manual method is a cross-check, not a fallback** |
| counts across four maps: 238,974 lines / 1,328 tests / 37,074 SPEC / 865 conformance | **240,107 / 1,334 / 37,150 / 880**, each independently re-derived and cross-checked three ways |
| `test.generated.md`: 1042 `.test.js` | **1,334** (under-reports by 292) |
| known-gaps heading/marker drift "10" then "19" | **13**, machine-measured and reproducible |

---

## Aspirational / archival content — this window's new docs, all correctly located

**No new finding.** The six `docs/changes/**` artifacts added this window
(`s330-match-block-arm-value-lift-all-paths`, `s330-unify-match-tail-classifier`,
`s331-block-arm-route-unification`, `s331-derived-rhs-server-only-escalation` incl. its
`reproducer.scrml` / `control-function.scrml`) are **dispatch briefs and progress logs, archived at
dispatch time per the standing convention.** They are historical records of a decision process, not
claims about current behaviour, and they live in the directory that says so. **Correctly located —
not flagged.**

One nuance worth stating so a future pass does not re-flag it: `s331-derived-rhs-server-only-escalation/`
contains **two live `.scrml` files** (`reproducer.scrml` — the leak, and `control-function.scrml` —
the function-path control). These are executable evidence for a measured claim, not sample code. They
are outside the compile gate and should stay that way; if they ever enter it, `reproducer.scrml` will
correctly fail with `E-DERIVED-SERVER-ONLY-REACH`, which is the point of it.

---

## Uncertain — needs human review (both carried, both unchanged)

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason uncertain:** each mixes durable design rationale with dated status claims, and the mix is
not separable by heuristic. Filename dates predate the current SPEC by two months, but the content
is not obviously superseded.
**What to check:** for each, decide whether it is (a) a current reference an adopter or agent should
read, (b) rationale that belongs in `scrml-support/docs/`, or (c) archival. **Unchanged this
window** — none was touched by the diff.

### `docs/website/`
**Reason uncertain:** a published surface with its own currency contract, not re-walked here.
**What to check:** whether the website's feature claims track the §34 catalog's movement this window
(806 → 807) and the two still-open server-only-leak positions. **A public page asserting that the
compiler prevents server-only code from reaching the browser would now be over-claiming** — the
guarantee holds for functions and for derived cells, and does NOT hold for a mutable-cell initialiser
or a markup interpolation.

---

## Map currency at this stamp

| Map | Stamp | Re-walked? | Evidence |
|---|---|---|---|
| primary · structure · dependencies · domain · test · error | `616688ea` | **yes** | 19 source files moved |
| auth | `616688ea` | **yes** | §6.6.19 is a confidentiality landing on this map's surface |
| build | `616688ea` | **partially** | `.github/` + `package.json` zero-diff; `scripts/` re-walked |
| non-compliance | `616688ea` | **yes** | this file |
| schema | `fe14c9b2` (AST) | no — **currency verified** | `git diff --name-only 35d4d32e..616688ea -- compiler/src/types` is EMPTY (8 windows) |
| config | `e80b692e` | no — **currency verified** | no added/removed `process.env`/`Bun.env` in the whole diff; `.github/` zero-diff |
| infra | `97576f35` (== `b7f89952`) | no — **currency verified** | `git diff --name-only 35d4d32e..616688ea -- .github/` is EMPTY |
| migrations | `115e8b1b` | no — **currency verified** | `schema-differ.js` / `db-migrate.js` / `db-authoritative.ts` / `sql-table-refs.js` all zero-diff |

**The watermark advanced `35d4d32e` → `616688ea`.** `scripts/state.ts --check` read **19 commits
behind** at the start of this pass; it will read 0 after the commit lands. ⚠ That instrument still
performs **no ancestry check** (invariant 48) and is WARN-only — it would print a meaningless number
against an off-main watermark and never say so.

## Tags
#non-compliance #project-mapper #cleanup #scrml #§18.5-four-routes #single-classifier-overstatement
#plan-block-arm-lift-two-callsites #leaf-predicate-not-segmenter #§12.2-per-function-scope
#§12.6-wrong-module-set #spec-internal-contradiction #escalation-vs-async-set #gap-ledger-stale-open
#three-gaps-open-but-landed #s248-no-op-dispatch-class #cross-operator-ledger-blindness
#heading-marker-drift-13 #bidirectional-drift #state-ts-detector-shipped #§6.6.20-does-not-exist
#s34-census-fixed-everywhere #s320-n1-closed #w-lint-nine-not-eight #generated-md-under-reports-292
#delete-the-generated-indexes #tutorial-v0.7.0 #spec-index-authored-half #website-over-claim-risk
#807-codes #880-conformance #1334-tests #watermark-advanced #no-ancestry-check

## Links
- [primary.map.md](./primary.map.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
- [build.map.md](./build.map.md)
- [test.map.md](./test.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [known-gaps.md](../../docs/known-gaps.md)
- [changelog.md](../../docs/changelog.md)
- [FACTS.md](../../docs/FACTS.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
