# BRIEF — ss75 items 9-14: conformance authoring, linear §35 + pipeline-accumulator §32 (`E-LIN-*` / `E-TILDE-*`)

**Dispatched:** S(ss75) 2026-07-16 · **Branch base:** `752574d9` (== `origin/main` == `spa/ss75`)
**List:** `spa-lists/ss75-conformance-control-flow-linear-17-35.md` items 9-14
**Landing:** sPA file-deltas your worktree output onto `spa/ss75`. Do NOT push. Do NOT advance main.

## Task

Author conformance cases pinning **6 diagnostic codes** toward the S256 tier-1 FREEZE bar. These pin a
**soundness** guarantee: `lin` is a single-consumption contract — a linear value used **twice** or
**never** is unsound. All 6 are currently **UNCOVERED** (verified: zero grep hits across `conformance/cases/`).

Write to a NEW category dir: **`conformance/cases/linear/<case-id>/{case.scrml, expected.json}`**.
This dir is yours exclusively — a sibling agent owns `conformance/cases/control-flow/`. Do not touch any
file outside `conformance/cases/linear/` and this BRIEF's own change-id dir.

**One `pos` (reject path fires the code) + one `neg` (the clean/legal shape stays silent) per code = 12 cases.**

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
- `codes` is a **SUPERSET** check — incidental co-fires (`W-PROGRAM-001` on bare markup, …) are FINE and
  need no assertion. Do not fight them; mention them in `description` as the exemplar does.
- Add a **`severity`** assertion per code (`{"E-LIN-001": "error"}`). This is the §34 partition /
  cross-stream-honest assertion — the adapter unions BOTH streams, so a wrong severity FAILS. Verify the
  real severity from `compiler/SPEC.md` §34 (Error Codes registry, lines 17807-18621) + the live emit site.
- **`spec` + `rationale` are MANDATORY** for (b) cases and strongly expected here too — carry them.

## The 6 codes — triggers VERIFIED LIVE (2026-07-16)

Line numbers are a **starting pointer, not gospel** — they have already drifted elsewhere in this list.
**Grep the code string yourself** in `compiler/src/type-system.ts` and read the surrounding condition for
the exact trigger before authoring. Note these codes flow through a **descriptor** indirection
(`TildeErrorDescriptor` / the `E-LIN-*` descriptor union at `type-system.ts:17065` + `:17076`) — the
DETECTION site and the EMIT site are different lines. Read both.

| # | Code | Trigger (verified — from the live message text) | Sites |
|---|------|--------------------------------------------------|-------|
| 9 | `E-LIN-001` | Linear variable declared but **NEVER consumed** before scope exit | emit `:17547` |
| 10 | `E-LIN-002` | Linear variable **consumed inside a LOOP** | detect `:17128`, emit `:17512` |
| 11 | `E-LIN-003` | Linear variable **consumed in SOME branches but not others** | emit `:17554` |
| 12 | `E-LIN-006` | **§35.5** — a `lin` declared **OUTSIDE** a `<request>`/`<poll>` **deferred ctx**, consumed **INSIDE** it | detect `:17112`, ctx `:17015` |
| 13 | `E-TILDE-001` | the `~` pipeline accumulator was **READ before being initialized** | detect `:17315`, emit `:17577` |
| 14 | `E-TILDE-002` | the `~` accumulator was **SET but never used** before it was overwritten / the block ended | detect `:17304`, emit `:17579` |

**Neg-case hints (from the trigger semantics — VERIFY each, don't trust this table):**
- `E-LIN-001` neg: **exactly one** consumption before scope exit → silent. (Single consumption is the
  whole `lin` contract — this neg is the flagship "legal shape".)
- `E-LIN-002` neg: consumption **outside** the loop.
- `E-LIN-003` neg: consumed in **ALL** branches (or none, per the trigger — verify which).
- `E-LIN-006` neg: the `lin` **declared inside** the same deferred ctx it is consumed in.
- `E-TILDE-001` neg: `~ = <value>` **before** the read (the fix the message itself names).
- `E-TILDE-002` neg: `~` **read / `lift ~`** before being overwritten or the block ends.

## SPEC anchors (normative — read the named subsection IN FULL before authoring)

`compiler/SPEC.md`:
- **§35 Linear Types — `lin`** — lines **18622-19083** ← for `E-LIN-001/002/003`
  - **§35.5** — the deferred-ctx subsection ← **THE** subsection for `E-LIN-006`
- **§32 The `~` Keyword — Implicit Pipeline Accumulator** — lines **17528-17739** ← for `E-TILDE-001/002`
- **§34 Error Codes** — lines 17807-18621 (the registry; severity source of truth)

> **⚠ Brief-vs-list correction (sPA-verified).** The ss75 list files the `E-TILDE-*` codes under "§35".
> They are **§32**-governed — the live `E-TILDE-001/002` messages *themselves* cite "See §32 in the spec".
> Cite **§32** in those two cases' `spec` field, not §35. (Flagged to the PA; author against §32.)

## Scope boundary

- **`E-LIN-005` is OUT OF SCOPE — do NOT author it.** (The list excludes it. FYI, its "RESERVED" label is
  stale — it is in fact live at `type-system.ts:7737`, firing on a decl that *shadows an in-scope `lin`
  variable of the same name*. The sPA has escalated that list-vs-impl drift to the PA. Do not act on it.)
- **`E-LIN-004`** is not on this list either — do not author it.

## Authoring discipline (project conventions — non-negotiable)

- **Declaration form (V5-strict).** `<x>=0` is the top-level form; `@x=0` ONLY inside `${...}`; `let`
  inside `${...}` as the exemplar shows. **Mixing forms means the case does not reproduce.** Mirror the
  existing `conformance/cases/loop/*` sources exactly. Find the canonical `lin` decl form + `~` usage
  **from the SPEC §35/§32 worked examples**, not from memory.
- **Case-id convention:** mirror `loop-00N-<slug>` → e.g. `lin-001-never-consumed-pos` /
  `lin-001-never-consumed-neg`, `tilde-001-read-before-init-pos` / `-neg`. Keep pos/neg twins adjacent.

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

- All 6 codes pinned: reject-path `pos` + clean `neg` per code (12 case dirs).
- `bun conformance/run.ts` **GREEN** (≥ 663 + your new cases, 0 fail).
- Every case carries `spec` + `rationale` + a `severity` assertion.
- Any **impl#1-vs-SPEC divergence ESCALATED** in your final report (do NOT decide, do NOT enshrine).

## Report back (your final message = the data the sPA lands on)

`{ case-ids authored, run.ts pass count, any impl#1-vs-SPEC divergence, any code whose real trigger
contradicted this brief's table, commit SHAs }`.

<!-- thread-board: run `bun scripts/threads.ts` — DONE-PROBE asserts this arc's completion against landed artifacts -->
<!-- S274 (bryan "75 done"): E-TILDE-001/002 PARKED — their emit descriptors exist (type-system.ts:17448/17459) but the fire-wiring was scoped-separately per the S261 ruling, so they are UNREACHABLE via a conformance compile() (0 authorable cases; re-verified on 58c8161d). 12/14 items landed, 2 parked-legit. The probe drops the parked codes so the board reflects reality; re-add them if/when the E-TILDE fire-wiring lands. -->
DONE-PROBE: for c in E-LIN-001 E-LIN-002 E-LIN-003 E-LIN-006; do git grep -qF "\"$c\"" -- conformance/cases/linear || exit 1; done
