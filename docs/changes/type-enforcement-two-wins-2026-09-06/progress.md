# progress — type-enforcement-two-wins-2026-09-06

Landing dispatch. Two measured §7.5.1 widenings, both ruled by bryan S402
(`user-voice-scrml.md`: *"land the two cheap wins and bank the strip-first
proposal"*).

## Startup verification (verified by execution)

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a139edb492547f739`
- `git rev-parse --show-toplevel` == same
- `git status --short` clean at start
- `git merge-base HEAD origin/main` == `origin/main` == `HEAD` == `94572819b39b46b34127b00d8c026291e8b00a0e`
- `bun install` ok (218 packages)
- `bun run pretest` PLAIN from worktree CWD; `samples/compilation-tests/dist/` populated, 34 artifacts
- BASE moved since the scoping dispatch (`c64c8400` -> `94572819`), but
  `git log c64c8400..origin/main -- compiler/src/type-system.ts compiler/src/expression-parser.ts compiler/SPEC.md`
  is EMPTY, so both CANDIDATE patches were derived against the same text I edited.

## Baselines, all captured on this worktree BEFORE any edit

| instrument | base |
|---|---|
| `bun test compiler/tests/` (full) | 31051 pass / 214 skip / **56 fail** |
| `bun test unit integration conformance` | 23278 pass / 70 skip / **0 fail** |
| `bun scripts/types-gate.ts --check` | **12 NEW** diagnostics — RED on main, pre-existing debt |
| `bun scripts/facts.ts --check` | PASS |
| census harness | ENFORCED FRACTION **10/36 (28%)** |
| two-wins probe (42 rows) | **22 matching / 20 mismatched** |
| corpus snapshot | 1920 `.scrml`; compiler THREW on 1; 0 emitted no artifact |

## What the patches were, and what I did with them

Both CANDIDATE patches were **re-derived, not applied**. They apply cleanly
against this base, but the E-TYPE-031 one is WRONG on the template-literal arm
and the reason is not visible from reading it. See the two-sided section below.

The scoping dispatch's whole directory is vendored into this change at
`docs/changes/base-annotation-enforcement-scoping-2026-09-06/` (byte-identical
to `worktree-agent-a13467dfcbdebe503`) so this branch's derivation is
self-contained.

## WIN 1 — §7.5.1 position 1, the literal set

`compiler/src/expression-parser.ts` — `classifyLiteralFromExprNode`,
`isStaticTemplateLit` (new).
`compiler/src/type-system.ts` — `inferExprType` (`lit` arm), `SourceInfo`,
`sourcePrimitiveType` (new), `extractInitLiteral`, `classifyPredicateZone`,
`annotateNodes` (position-1 arm + the un-annotated `resolvedType` arm).

THREE functions needed the case, and the filed gap
`g-e-type-031-is-blind-to-boolean-literals` names two. The third —
`inferExprType`'s `lit` arm — is why `let flag = true` kept emitting
`W-TYPE-031-UNPROVEN`, and it is the entire 17-site `lit` row of the trucking
baseline.

### ⚑ The candidate patch would have introduced a two-sided failure

`classifyLiteralFromExprNode` feeds TWO consumers with different needs:

  - §7.5.1's `E-TYPE-031` needs only the primitive TYPE;
  - §53.4's `classifyPredicateZone` evaluates the VALUE at compile time and
    ELIDES the runtime guard when it can.

The candidate returns `{ kind: "literal", value: n.value }` for ANY `template`
litType. For a MULTI-QUASI (interpolated) template the parser records
`value: ""` — not the text — so that program:

```scrml
${
    let a = "hello"
    let s: string(.length >= 5) = `${a} world`
}
```

would have been statically FAILED against its own predicate (E-CONTRACT-001,
`Value  does not satisfy`) **and** had its runtime guard deleted. Reproduced
before the fix; pinned after it.

Resolution: `SourceInfo` gains a fourth kind, `literal-type-only` — *the
initializer is syntactically a literal of this primitive TYPE, value not
statically known*. An interpolated template is that kind and classifies
BOUNDARY, the zone it already had. `isStaticTemplateLit` distinguishes the two
EXACTLY (the single-quasi parser branch sets `raw = "\`" + value + "\`"`, the
multi-quasi one does not) rather than scanning for `${`.

A BOOLEAN literal keeps its value — E-TYPE-031 and the un-annotated
`resolvedType` binding both want it — and gets an explicit BOUNDARY arm in
`classifyPredicateZone`. `checkPredicateLiteral` returns `null` for a boolean by
construction and `evaluatePredicateOnLiteral` is typed over `number | string`,
so "static" there would delete a guard in exchange for a check that does not
happen. Booleans could not reach that switch AT ALL before this change, so the
arm changes nothing pre-existing.

### Measured (verified by execution)

- probe: position-1 matrix **12/12** cells correct, was 8/12.
- corpus, 1920 files: **+0 errors, -0 errors, +0 warnings, -18 W-TYPE-031-UNPROVEN**.
  **ARTIFACT-CONTENT delta: 0 files.**
- `types-gate --check`: byte-identical to base.
- unit+integration+conformance: 23297 pass / 0 fail.

## WIN 2 — §7.5.1 position 2, the state-cell declaration

`compiler/src/type-system.ts` — `annotateNodes`, the reactive-decl arm (the
`else` of its predicated branch, mirroring position 1).

- probe: **42/42** rows matching (was 34/42 after win 1, 22/42 at base).
- census: **10/36 (28%) -> 12/36 (33%)**. `07-state-decl-number` DECORATIVE ->
  ENFORCED; `11-let-boolean-literal-to-number` DECORATIVE -> ENFORCED;
  `08-state-decl-int` stays DECORATIVE, which is correct.
- corpus, position 2 in isolation: **0 files changed**, 0 diagnostics, 0 artifact
  delta.
- unit+integration+conformance: 23312 pass / 0 fail.

## Test dispositions — all three, and why

1. **`trucking-dispatch v0.2-shape diagnostic baseline` (2 tests).** UPDATED.
   `W-TYPE-031-UNPROVEN` 338 -> 321, aggregate 414 -> 397. The `lit` row of that
   file's own measured breakdown was exactly 17 and is now 0. Breakdown
   RE-MEASURED (`call` 232, `ternary` 28, `member` 27, `binary` 14, `index` 10,
   `ident` 5, `array` 5, `lit` 0), not arithmetic-adjusted.

2. **`s365-asis-unknown-split.test.js` — the `gap at `lit`` GAP_CASES entry.**
   MOVED to SILENT_CASES, which is what that file's own header says a rung
   landing does. Two corrections to how it was left:
   - the entry carried **no flip marker** (§7.5.2's `match`/`if` pins have one),
     so a landed widening read as a regression. A ⚑ FLIP block now sits above
     GAP_CASES naming both readings of a red row and which is which.
   - the row is **re-pointed at the `not` literal** rather than deleted. `lit` is
     a PARTIALLY-closed gap — `inferExprType` still declines `litType: "not"` —
     and deleting the row would have retired the pin along with the gap.
   Body `let x = not` + `print(x is not)`: 1 gap, 0 errors (`print(x)` alone
   trips E-PRINT-NON-PRIMITIVE, which would have broken the fail-loud assertion).

3. **`gauntlet-s19/type-annot-mismatch.test.js`.** EXTENDED, not weakened. The
   old file sampled `number = "x"` twice, which is exactly how 4 dead cells
   survived: a partial matrix reads like a complete one from outside. Now runs
   both 12-cell matrices plus the §53 interaction cases, which assert on the
   EMITTED GUARD (`E-CONTRACT-001-RT` in the artifact) rather than on the absence
   of a diagnostic.

## SPEC — §7.5.1 and the §34 catalog row

- MEASURED table: row 1 gains its cell coverage, row 2 -> **CHECKED**. Every row
  reproduced by compiling; positions 3-5 re-verified unchecked by the census.
- Normative statements: position 2 joins the SHALL; the literal SET is stated
  explicitly (four forms; `not` named out to §42/E-TYPE-041); `int` named OUT of
  the annotation set with the reason; a new clause forbidding a literal-set
  widening from converting a §53.4 BOUNDARY assignment to STATIC for a value the
  compiler does not have.
- Ordering clause: divergence DECLARED and marked `supersedes:` on the
  position-2 axis only; rest of the sequence stands. ⚑ note added that position 3
  is BLOCKED (37 of 37 false positives, all `number` into `int`), not merely next.
- §34 E-TYPE-031 row: **18 push sites / two positions -> 19 / three**, and
  "positions 2-5" -> "positions 3-5". That row asserts a measurement, so a
  widening that does not update it re-creates the §34.0 defect the row exists to
  remove.
- `docs/FACTS.md` regenerated (line counts only; `--check` was PASS at base).

## ⚑ PRE-EXISTING BUG SURFACED, NOT FIXED — out of scope, routed to PA

**A state-cell initialized with an INTERPOLATED template literal silently loses
its entire initializer.**

```scrml
<a> = "hello"
<s> = `${@a} world`
```

parses to `lit{ litType:"template", raw:"``", value:"" }` and codegen emits
`_scrml_cs_init_set("s", () => \`\`)` — the empty string. Compiles clean, zero
diagnostics. Reproduces with NO annotation and NO predicate, so it is not this
change's; the static form `<s> = \`hello world\`` emits correctly, and the same
interpolated template in a `let` emits correctly. The interpolation is stripped
before the type system ever sees the node.

Consequence for this change: at a PREDICATED state-cell annotation the S402
widening reasons correctly about an AST that is already wrong and reports
`E-CONTRACT-001 … Value  does not satisfy the predicate` — an empty value the
author never wrote. Papering over that in the type system would have HIDDEN a
data-loss bug, so it is pinned instead, as a ⚑ FLIP row in the probe
(`bug-cell-tpl-interp`). When the drop is fixed that row must become
`SILENT +guard`.

NOT filed in `docs/known-gaps.md` — that is a PA-owned shared doc and a
sub-agent writing it risks clobbering the session's version.

## Instruments landed in this change

| file | what it is |
|---|---|
| `two-wins-probe.mjs` | the 42-row §7.5.1 probe: pos-1 + pos-2 matrices, the §53 predicate negatives, and the ⚑ FLIP row for the upstream bug |
| `corpus-differential.mjs` | corpus snapshot + diff that hashes the EMITTED ARTIFACT as well as the diagnostic code set, pins the compiler root into the snapshot, and REFUSES a cross-root diff |

The scoping dispatch's `corpus-diag-snapshot.mjs` records diagnostic codes only.
A zero code-set delta is not the claim "the artifact is unchanged" — a widening
that re-classifies a §53 zone changes whether a guard is emitted with no
diagnostic to show for it. That is why the second instrument exists.

## Final verification (verified by execution, at the landing HEAD)

| instrument | base | after |
|---|---|---|
| `bun test compiler/tests/` | 31051 pass / **56 fail** | 31086 pass / **54 fail** |
| failure SET comparison | — | **0 NEW failures.** 2 fewer, both `TodoMVC … dist not compiled` — `benchmarks/todomvc/dist/` is gitignored and was populated by a post-commit hook mid-session. ENV, not code. |
| `bun test unit integration conformance` | 23278 / 0 fail | **23312 / 0 fail** |
| `bun scripts/types-gate.ts --check` | 12 NEW | **12 NEW, byte-identical diff** |
| `bun scripts/facts.ts --check` | PASS | **PASS** |
| census ENFORCED FRACTION | 10/36 (28%) | **12/36 (33%)** |
| two-wins probe | 22/42 | **42/42** |
| corpus diagnostics (1920 files) | — | +0 E, -0 E, +0 W, **-18 W** |
| corpus artifact content | — | **0 files changed** |
