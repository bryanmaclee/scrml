# progress — §17.6 value-form amendment

Append-only. Crash-recovery anchor.

## Startup

- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a96528615f5c41280`, base `63f4e3e5`, clean.
- `bun install` OK (218 packages).

## Re-verification of the brief's premises (all PA-EXECUTED claims re-run by me)

- **Divergence 1 CONFIRMED.** `<p>${ if @isAdmin { "Admin" } else { "User" } }</p>` → exit 0, emits
  `(_scrml_cs_reactive_get("isAdmin") ? "Admin" : "User")`. Matches the brief exactly.
- **Divergence 3 CONFIRMED.** `<p>${ if @shown { "YES" } }</p>` → exit 0, zero diagnostics, emits a
  dangling `"YES";` no-op inside a plain `if`, HTML has an EMPTY `<span data-scrml-logic="...">`.
  Silent-wrong exactly as briefed.
- **`lift` form also renders** — `${ if @isAdmin { lift "Admin" } else { lift "User" } }` renders via a
  DIFFERENT lowering (`_scrml_lift(...)` accumulation into a lift target), not the ternary. So
  "sugar for `lift`" is defensible at the OBSERVABLE-RESULT level but NOT at the codegen level; the
  amendment must say "equivalent to" (behaviour), not "lowers identically". §17.6.8 already grants
  the compiler latitude over IIFE/assign/ternary, so this is consistent.

## Contradicting loci — brief named 2, PA addendum named a 3rd, I found a 4th

1. `:11856` §17.6.1 grammar `arm-body ::= '{' statement* lift-stmt statement* '}'` (brief).
2. `:11885` "An if-as-expression arm body SHALL produce its result value via a `lift` statement."
   **NOT named by the brief or the addendum — found by me.** A SHALL that forbids the ruled form.
3. `:11890` "An arm body that does not contain a `lift` statement MAY exist; its contribution to the
   result type is `not`." (brief cited `:11884`; drifted to `:11890`).
4. `:7034` §10 value-lift mode "Each arm ... SHALL contain exactly one `lift` statement." (addendum).
5. `:11877` "The arm body SHOULD contain a `lift` statement" — SHOULD, soft; survives with a cross-ref.

## `:7094` ruling — SURVIVES UNCHANGED

"In value-lift mode (§17.6), `lift` SHALL appear at most once on any execution path through an arm
body." This bounds MULTIPLICITY, not PRESENCE. Zero explicit lifts satisfies "at most once" (0 <= 1);
under the sugar reading the bare expression desugars to exactly one lift, which also satisfies it.
Either way no contradiction. Confirmed by construction, not assumed. I will add one clause making the
desugared lift explicitly count as the arm's single lift so the E-LIFT-002 interaction is closed
rather than left implicit.

## Item 7 (`match` limb) — VERIFIED, half-covered

- `:12771` `arm-body ::= expression | block-body` — a match arm body MAY already be a bare expression.
  So the match limb needs NO arm-body rule change, unlike `if` (whose arm-body grammar REQUIRES lift).
- §18.0 already assigns JS-style `match` to "value-return context".
- BUT the PLACEMENT (sole content of a markup `${...}`, allocating a render slot) is unspecified for
  BOTH limbs. `grep 'sole content'` finds only §4.18.7/W-DISPLAY-TEXT-OVERQUOTE and §16.10 spread.
- Verdict: one placement rule covering both limbs. NOT separate normative work for `match` → no STOP.

## Hazard analysis for item 4 (no-`else`) — a fork the brief did not surface

Admitting else-less ifs into `isValueFormIfStmt` (the slot-allocation gate) also captures
SIDE-EFFECT-only ifs: `${ if @n > 3 { ping() } }` becomes `(cond ? ping() : "")` in a reactive slot.
- Benign for rendering: `_scrml_render_value` does `v == null ? "" : String(v)` (runtime-template.js:849),
  so a void call renders empty either way.
- NOT benign for timing: today it fires ONCE as a statement; after, it re-runs reactively per `n` change.
- The WITH-else form ALREADY has this property today (verified: `${ if @ready { doThing() } else { doThing() } }`
  emits a reactive `_scrml_effect` ternary). So this is consistency, not a new class of behaviour.

### The landed adversarial test that appears to contradict item 4 is INERT

`compiler/tests/unit/inline-value-form-interp-codegen.test.js:122` asserts an else-less if is NOT a
value-form via:
    expect(clientJs).not.toMatch(/_scrml_render_value\(el, \(_scrml_reactive_get\("n"\) > 3 \?/)
This regex is UNSATISFIABLE for the value-form shape: (a) the value always routes through a
`_scrml_cf__scrml_logic_N()` thunk, so `_scrml_render_value(el, (` never occurs; (b) the emit uses
`_scrml_cs_reactive_get` (chunk-scoped), not `_scrml_reactive_get`. Verified against real output.
So it pins NOTHING — there is no enforced landed contract to overturn, only a comment expressing an
intent. I implement item 4 as briefed and replace the inert assertion with one that actually bites.
This is the one judgment call the brief did not explicitly consider; surfaced in the report.

## Plan

A. Codegen: admit else-less value-form at all THREE lock-step copies (emit-html `isValueFormIfStmt`,
   emit-control-flow `_emitIfValueExprInner`, emit-each `_eachValueFormIfRaw`) with false path `""`.
B. SPEC §17.6: new subsection naming the value-form + grammar + sugar equivalence + no-else +
   provenance; reconcile loci 1/2/3/5.
C. SPEC §10: reconcile locus 4; note `:7094` survives.
D. Conformance cases (codes + runtime), bite-proved.
E. Replace the inert adversarial assertion.
F. Regen SPEC-INDEX.

## Landed

- `91f87f81` progress anchor.
- `c88a2b0d` SPEC amendment — §17.6.10 added; loci 1/2/3/5 (§17.6) + locus 4 (§10) reconciled;
  §10 `:7094` multiplicity clause extended; §18.0 cross-ref added; SPEC-INDEX regenerated
  (37,549 → 37,647 lines). DONE-PROBE `grep -q 'value-form' compiler/SPEC.md` now PASSES
  (22 occurrences, earned by a real normative name — §17.6.10 "value-form control-flow
  interpolation" — not by mentioning the string).

## Codegen — DONE and VERIFIED, but BLOCKED FROM COMMITTING

Three lock-step copies changed so an else-less value-form emits `""` for the absent arm:
`emit-html.ts isValueFormIfStmt` · `emit-control-flow.ts _emitIfValueExprInner` ·
`emit-each.ts _eachValueFormIfRaw`. Verified by compile:
- `${ if @shown { "YES" } }` → `(_scrml_cs_reactive_get("shown") ? "YES" : "")` + a render slot.
- cascade, no trailing else → `(n > 8 ? "hi" : (n > 3 ? "mid" : ""))`.
- inside `<each>` → `String((r > 1 ? "big" : ""))`.
- with-else form UNCHANGED.

### BLOCKER — main is RED; the pre-commit gate refuses every code commit

`compiler/tests/integration/s385-channel-mount-in-match-arm.test.js`
"OUT-OF-SCOPE GUARD — `<each in=@undeclared>` is still not checked" asserts
`hardErrors(result)).toEqual([])` but now receives `E-STATE-UNDECLARED`. Sibling commit
`4bc6bc03 fix/s390 each in scope check (#785)` — which is ON MY BASE — deliberately closed
that gap, making the guard stale. Reproduced on PRISTINE base source, so it is NOT mine.
The hook runs the suite with `--bail`, so this one test blocks all code commits repo-wide.

I did NOT use `--no-verify` (unauthorized) and did NOT rewrite another arc's guard test
(out of scope; whether #785 intended to close that gap is the PA's/#785-owner's call).

The full code delta is preserved as `pending-code-changes.patch.txt` in this directory so
nothing is lost — it lands no executable code, so it does not circumvent the gate's purpose.
Apply with `git apply`. Remedy is either (a) update the stale s385 guard, or (b) authorize
`--no-verify` for this one commit.

## Conformance — both cases written and BITE-PROVED

- `ctrl-022-value-form-no-else-renders-nothing-pos` — TRUE bite: FAILS on base with
  `text expected "YES", got ""` (the silent-wrong symptom itself), PASSES after.
- `ctrl-021-value-form-sugar-lift-less-branch-pos` — CANNOT fail on base, because the CODE
  was already correct there (the divergence was SPEC-side). Non-vacuity proved by
  perturbation instead: `text expected "PERTURBED", got "User"` — the harness genuinely
  reads the rendered value. Stated plainly rather than claimed as a bite.

### HARNESS DEFECT found while bite-proving (surfaced, NOT fixed — out of scope)

`conformance/normalize.ts` `runAnchored` treats `count` as MUTUALLY EXCLUSIVE with
`text`/`attr`/`value`: when `count` is a number it checks the count and `continue`s,
SILENTLY SKIPPING the sibling assertions in the same object. So
`{ "selector": "#x", "count": 1, "text": "YES" }` never checks the text.
My first draft used that shape and passed on BASE — i.e. it pinned nothing. I re-authored
my cases as separate assertion objects to get both checks.
**Blast radius: 16 such dead `text` assertions across 14 existing case files** (e.g.
`error/match-failable-ok-arm-rt`, `error-boundary/*`, `components/props-render`). Those
cases are weaker than they read. Fixing `runAnchored` is a corpus-wide pass/fail change and
belongs to the PA, not to this dispatch.
