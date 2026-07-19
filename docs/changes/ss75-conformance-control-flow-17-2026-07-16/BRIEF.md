# BRIEF — ss75 items 1-8: conformance authoring, control-flow §17 (`E-CTRL-*` + siblings)

**Dispatched:** S(ss75) 2026-07-16 · **Branch base:** `752574d9` (== `origin/main` == `spa/ss75`)
**List:** `spa-lists/ss75-conformance-control-flow-linear-17-35.md` items 1-8
**Landing:** sPA file-deltas your worktree output onto `spa/ss75`. Do NOT push. Do NOT advance main.

## Task

Author conformance cases pinning **8 control-flow diagnostic codes** toward the S256 tier-1 FREEZE bar.
All 8 are currently **UNCOVERED** (verified: zero grep hits across `conformance/cases/`).

Write to a NEW category dir: **`conformance/cases/control-flow/<case-id>/{case.scrml, expected.json}`**.
This dir is yours exclusively — a sibling agent owns `conformance/cases/linear/`. Do not touch any file
outside `conformance/cases/control-flow/` and this BRIEF's own change-id dir.

**One `pos` (reject path fires the code) + one `neg` (the clean/legal shape stays silent) per code = 16 cases.**

## What conformance authoring IS (the method — LOAD-BEARING)

A case = real scrml source + a JSON contract asserting **(a) which diagnostic CODES fire**. These are all
compile-time codes → **codes-half only**, no runtime half (no `input`/`dom`/`state` keys).

Method, in order:
1. Write representative scrml for the trigger.
2. Run it through impl#1 (the reference compiler) to capture the **ACTUAL** codes emitted.
3. Assert those in `expected.json`.
4. **SANITY-CHECK against the SPEC section.** If impl#1's behavior DIVERGES from a normative SPEC
   statement → **STOP and ESCALATE to the sPA in your final report**. Do **NOT** enshrine impl#1's
   behavior against the spec. Pure golden-capture is REJECTED — it would make impl#1 the spec.
   A capture that SURPRISES you is a **bug-or-spec-gap**: report it, do not bless it.
5. Verify GREEN: `bun conformance/run.ts` (baseline before your work: **663/663 pass**).

Schema + full authoring rules: **`conformance/README.md`** (read the `expected.json` schema §
+ the "(a) Codes-half matching" § — both load-bearing).

## Exemplar to mirror (exact shape)

`conformance/cases/loop/loop-001-break-outside/` — a codes-only case. Its shape:

```jsonc
{
  "id": "loop-001-break-outside",
  "description": "§49.9 — ... W-PROGRAM-001 co-fires incidentally (no `<program>` shell around the bare markup).",
  "language-version": "1.0",
  "spec": "§49.9, §49.4",
  "source-test": "compiler/src/type-system.ts",
  "rationale": "§49.9 E-LOOP-001: the compiler SHALL reject `break` that appears outside any enclosing loop. ...",
  "expect": {
    "codes": ["E-LOOP-001"],
    "notCodes": ["E-LOOP-002"],
    "severity": { "E-LOOP-001": "error" }
  }
}
```
```scrml
${
    let x = 5
    break
}
<p>x</>
```
And the neg twin (`loop-005-neg` / `loop-006-neg`): `"codes": []` + `"notCodes": ["E-LOOP-005"]`.

Notes carried from the exemplar:
- `codes` is a **SUPERSET** check — incidental co-fires (`W-PROGRAM-001` on bare markup, `W-SQL-*`, …)
  are FINE and need no assertion. Do not fight them; mention them in `description` as the exemplar does.
- Add a **`severity`** assertion per code (`{"E-CTRL-001": "error"}`). This is the §34 partition /
  cross-stream-honest assertion — the adapter unions BOTH streams, so a wrong severity FAILS. Verify the
  real severity from `compiler/SPEC.md` §34 (Error Codes registry, lines 17807-18621) + the live emit site.
- **`spec` + `rationale` are MANDATORY** for (b) cases and strongly expected here too — carry them.

## The 8 codes — triggers VERIFIED LIVE (2026-07-16)

Line numbers are a **starting pointer, not gospel** — they have already drifted once (`E-LOOP-007` was
briefed at `18601`, actually fires at `18675`). **Grep the code string yourself** in `compiler/src/` and
read the surrounding condition for the exact trigger before authoring.

| # | Code | Trigger (verified) | Site |
|---|------|--------------------|------|
| 1 | `E-CTRL-001` | orphaned `else` — no preceding `if=` element at the same level | `ast-builder.js:17524` |
| 2 | `E-CTRL-002` | orphaned `else-if=` — no preceding `if=` element at the same level | `ast-builder.js:17535` |
| 3 | `E-CTRL-003` | an element tries to extend a chain that **already ended with `else`** | `ast-builder.js:17583` |
| 4 | `E-CTRL-004` | `else` / `else-if=` on a **state object opener** | `ast-builder.js:17572` |
| 5 | `E-CTRL-005` | `else`/`else-if=` **and** `if=` on the **SAME element** | `ast-builder.js:17510` |
| 6 | `E-CTRL-011` | `for (... in ...)` unsupported — scrml uses `for (x of <iterable>)`. **TWO fire sites** — pick one, note the other in `description` | `ast-builder.js:8084` **and** `:12313` |
| 7 | `E-CONTROL-FLOW-IN-MARKUP` | a **bare control-flow keyword statement in markup**. Fires **ONCE** then RECOVERS (see the comment at `:1818`) — assert the single fire | `ast-builder.js:1850` |
| 8 | `E-LOOP-007` | `while` used as an **expression** (e.g. `let x = while (…) {…}`) — §49.4.4 | `type-system.ts:18675` |

**Neg-case hints (from the trigger semantics — VERIFY each, don't trust this table):**
- `E-CTRL-005` neg: `else` on a **sibling** element (the legal chain) → silent.
- `E-CTRL-001/002` neg: an `else`/`else-if=` **with** a proper preceding `if=` at the same level.
- `E-CTRL-003` neg: a chain that ends **at** `else` (nothing extends past it).
- `E-CTRL-011` neg: the canonical `for (x of <iterable>)`.
- `E-LOOP-007` neg: `while` used as a **statement**.

## SPEC anchors (normative — read the named subsection IN FULL before authoring)

`compiler/SPEC.md`:
- **§17 Control Flow** — lines **10184-11329**
  - **§17.1 `if=` Attribute** — line **10251**
  - **§17.1.1 `else` and `else-if=` Attributes** — line **10277** ← **THE** subsection for `E-CTRL-001..005`
  - §17.4a `else` Block on `for/lift` — line 10589
- **§49.4.4 `while` as a Statement** — line **25054** ← for `E-LOOP-007`
- **§34 Error Codes** — lines 17807-18621 (the registry; severity source of truth)

## Authoring discipline (project conventions — non-negotiable)

- **Declaration form (V5-strict).** `<x>=0` is the top-level form; `@x=0` ONLY inside `${...}`; `let`
  inside `${...}` as the exemplar shows. **Mixing forms means the case does not reproduce.** Mirror the
  existing `conformance/cases/loop/*` sources exactly.
- **Tier flags.** Items 7 (`E-CONTROL-FLOW-IN-MARKUP`) and 8 (`E-LOOP-007`) are marked `[tier-1?]`
  TIER-SPLIT-silent / reclassifiable in the list. Author them normally; no special handling.
- **Case-id convention:** mirror `loop-00N-<slug>` → e.g. `ctrl-001-orphan-else-pos` /
  `ctrl-001-orphan-else-neg`. Keep pos/neg twins adjacent by name.

## Worktree / path discipline (HARD)

- You are in an **isolated worktree**. Work **ONLY** via paths relative to YOUR worktree root.
- **NEVER** write through an absolute path into `/home/bryan-maclee/scrmlMaster/scrml/...` (the main
  checkout). A single abs-path Write leaks your work into main and corrupts the sPA's landing.
  A PreToolUse hook catches Edit/Write leaks but **NOT Bash writes** — self-check every Bash redirect.
- **Commit incrementally** (do not batch) — your branch is your crash-recovery anchor.
- Scratchpad: if you need temp files, use a **unique per-agent path** — a sibling agent shares the
  scratchpad dir and same-named files clobber.
- The pre-commit hook runs the full suite (~108-124s). Allow `timeout: 300000` on foreground commits.

## Definition of done

- All 8 codes pinned: reject-path `pos` + clean `neg` per code (16 case dirs).
- `bun conformance/run.ts` **GREEN** (≥ 663 + your new cases, 0 fail).
- Every case carries `spec` + `rationale` + a `severity` assertion.
- Any **impl#1-vs-SPEC divergence ESCALATED** in your final report (do NOT decide, do NOT enshrine).

## Report back (your final message = the data the sPA lands on)

`{ case-ids authored, run.ts pass count, any impl#1-vs-SPEC divergence, any code whose real trigger
contradicted this brief's table, commit SHAs }`.

<!-- thread-board: run `bun scripts/threads.ts` — DONE-PROBE asserts this arc's completion against landed artifacts -->
DONE-PROBE: for c in E-CTRL-001 E-CTRL-002 E-CTRL-003 E-CTRL-004 E-CTRL-005 E-CTRL-011 E-CONTROL-FLOW-IN-MARKUP E-LOOP-007; do git grep -qF "\"$c\"" -- conformance/cases/control-flow || exit 1; done
