---
status: current
last-reviewed: 2026-08-01
---

# `<machine>` keyword retirement — the IMPLEMENTATION arc

> **✅ COMPLETE — PR #328 (removal + codemod) · PR #332 (the loud holes) · closeout.**
> Verified END-TO-END on merged `main`: a `< machine>` source is REJECTED
> (`E-DEPRECATED-001`), `scrml migrate` rewrites opener + `</machine>` closer + the §51.9
> projection body into §51.0.J `derived=match … { }` with `var=` and state-children, and the
> migrated output COMPILES CLEAN. Gap `g-machine-keyword-retirement-carries-three-subsystems`
> RESOLVED.
>
> **What the arc actually cost, vs its briefing.** It was briefed as removing a deprecated
> spelling. It was four subsystem divergences, ~60 test files, a codemod that had to be taught
> three separate rewrites, and a bookkeeping bug the arc's own gap-filing surfaced. The single
> most valuable output was not the removal — it was discovering that a naive `machine`→`engine`
> swap **silently changes program behaviour**, which the §63.4 codemod gate had been treating as
> satisfied. Everything else followed from measuring that.
>
> **Still open, deliberately (filed, not fixed here):**
> `g-audit-clause-silent-noop-on-modern-engine` · `g-machine-tests-modern-engine-vacuous` ·
> `g-e-engine-34-emit-line-citations-stale`. The first two are one arc — a §51-era subsystem
> wired to `machine.rules` that was never re-pointed at the state-child metadata.

**Session:** S307 (bryan) · **Ruling authority:** bryan S305 (*"`<machine>` is deprecated long before V1
… there is no reason whatsoever to tie up the word machine. fix the spec."*) + bryan S305 (*"re-base"*)
+ bryan S307 (the re-base-scope fork → **remove + make the holes loud**).
**SPEC (landed S305, #320):** §63.7 · §51.0.L · §34 `W-DEPRECATED-001` row.
**Gap:** `g-machine-keyword-retirement-carries-three-subsystems`.

> **Why this doc exists.** The S305 hand-off's four-bullet plan was measured against the compiler and
> **three of its four bullets were wrong**. Following it literally would have deleted ~20 conformance
> cases covering **nine codes that still fire** — removing real freeze coverage during the freeze
> campaign. Everything below is measured by execution, not read off the SPEC prose.

---

## The load-bearing structural fact

**Removing the `<machine>` KEYWORD does not remove the legacy arrow-rules BODY SHAPE.**

`<engine name=Signal for=Light>` + arrow rules + `audit @slog` compiles today and emits a working
audit push (measured: `audit-push=1`). The parser treats `machine` / `engine` as aliases producing the
same `engine-decl` node; the legacy *body* is reachable under the `<engine>` spelling.

Consequence: a diagnostic is only keyword-bound if it is **explicitly gated on the keyword**. Exactly
one is.

## Measured partition (method: swap the opener `machine`→`engine`, recompile, check the code still fires)

| Code | Swap result | Disposition |
|---|---|---|
| `E-ENGINE-003` | **GONE** — gated on `decl.legacyMachineKeyword === true` (`type-system.ts:5993`, S182 Fix 2) | **RETIRE** + its 2 cases |
| `E-ENGINE-005` `-013` `-015` `-016` `-017` `-018` | **FIRES** | SURVIVE — cases **migrate** |
| `E-REPLAY-001` `-002` `-003` | **FIRES** | SURVIVE — cases **migrate** |
| `E-ENGINE-004` `-010` | type-level `transitions {}` — not the keyword | SURVIVE untouched |
| `E-ENGINE-014` `-019` | body-bound (dup `(from,to)` pair · `audit` clause) | SURVIVE untouched |
| `E-ENGINE-001` | type-level half survives; legacy half already dead (S305) | SURVIVE (see note) |

**`E-ENGINE-003` retirement is coverage-safe:** `E-ENGINE-VAR-DUPLICATE` owns the `<engine>` duplicate
form by deliberate mutual exclusion (S182) and carries its own pair `engine/engine-var-duplicate-{pos,neg}`.
Verified present before retiring.

## Phantom catalog rows — zero implementation repo-wide

`E-ENGINE-006` `-007` `-008` `-009` `-011` `-012` exist **only in `compiler/SPEC.md`**. Confirmed by three
independent patterns (bare grep · dynamic-construction probe · whole-repo sweep excl. dist/node_modules).
Their §34 rows also cite `§51.5 line 22245`-style prose anchors that are ~7,800 lines stale (added S84;
SPEC has grown since). **STRIKE the rows**; they inflate the freeze denominator exactly as the
retired-vs-uncatalogued probe trap did at S305.

> **Filed separately, not fixed here:** the whole E-ENGINE family's §34 "emitted at `type-system.ts:NNNN`"
> annotations are stale (e.g. `-014` cites 2592, actual 6759; `-019` cites 2053/8488, actual 5974/23231).
> Same rot class as the S280 FACTS.md figures and the S290 SPEC-INDEX totals: a hand-maintained derived
> number rots silently and nothing fails. → `g-e-engine-34-emit-line-citations-stale`.

## The three carried subsystems — measured

| Subsystem | legacy arrow-rules body | modern `<engine>` state-children |
|---|---|---|
| §51.14 replay | works | **works** (`E-REPLAY-001/-002` fire correctly) |
| §51.11 audit | works (`audit-push=1`) | **silent no-op** — 0 emit, 0 diagnostics |
| §51.13 property-tests | 4 real tests | **`test("no qualifying machines", () => expect(true).toBe(true))`** |

Both modern-shape holes are **pre-existing and independent of this arc** — but the arc makes them
matter, because once the keyword is gone `<engine>` is the only spelling and the modern state-children
form is the canonical, promoted one (§51.0, the Tier-2 ladder, `bun scrml promote`).

- property-tests hole: **already filed** — `g-machine-tests-modern-engine-vacuous` (MED, S241; rated
  "NOT a trivial re-wire" — `collectVariants`/`reachableVariants`/`resolveRule` all key off `m.rules`).
- audit hole: **unfiled** → file as `g-audit-clause-silent-noop-on-modern-engine`.
- Corpus demand for `audit`: **0 authored `.scrml` files** (6 conformance case dirs only).

**bryan's S307 ruling:** remove + make the holes LOUD; file the real port as its own arc.

---

## Work items

### PR1 — removal + migration + catalog truth
1. Remove the `machine` keyword from the parser's opener recognition; free the word as an ordinary
   identifier. `E-DEPRECATED-001` fires on `<machine>` / `< machine>`.
2. **Add the `E-DEPRECATED-001` §34 row** — it has no row and no fire site today (Rule 4: the row lands
   with the impl).
3. Retire `E-ENGINE-003` + its `machine-duplicate-name-{pos,neg}` cases (coverage verified above).
4. **Migrate ~18 conformance case dirs** `machine`→`engine` in the opener (NOT delete): `derived-machine-*`,
   `machine-alternation-*`, `machine-rule-binding-*`, `machine-guard-*`, `replay-*`. Update each
   `expected.json` description/rationale that names the legacy keyword.
5. Strike the 6 phantom §34 rows.
6. Re-word `E-REPLAY-001` / `-002` message text — they say *"machine-bound reactive"* / *"governed by a
   `< machine>` declaration"*, naming a keyword that will no longer exist (`type-system.ts:23304,23313`;
   `runtime-template.js:767` comment).
7. **Fix §51.0.L's self-contradiction:** the banner says removed-before-1.0 and §63.7 says
   `E-DEPRECATED-001` fires at 1.0, but a bullet 26 lines below states the promotion waits for *"a future
   MAJOR language-version event (unscheduled per §63.7)"* — citing §63.7 for what §63.7 refutes. Also
   correct §51.0.L's claim that the seven diagnostics' *"triggers are the `< machine>` DECLARATION
   surface"* — measured false for six of seven.
8. `scrml migrate` keeps rewriting `<machine` → `<engine` (the §63.4 codemod gate; already verified-landed).

### PR2 — make the holes loud
9. `audit @x` inside a modern state-children engine body → a diagnostic instead of silent swallow.
10. Property-test generator → refuse to emit a vacuously-green test; emit a real skip/diagnostic.

### Not in this arc (filed)
- The genuine port of audit + property-tests onto the state-children rule graph.
- The §34 emit-line-citation rot.

## Verification
- Corpus migration **measured zero** (space-tolerant `<[[:space:]]*machine\b`): the only non-conformance
  `.scrml` hit is a **comment** in `compiler/native-parser/parse-file.scrml`.
- Conformance must stay at **843/843** with the 18 migrated cases still asserting their codes, minus the
  2 retired.
- S239 adversarial pass before landing (this is a compiler-source change with a runtime surface).
