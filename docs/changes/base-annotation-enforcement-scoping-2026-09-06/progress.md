# progress — base-annotation-enforcement-scoping-2026-09-06

SCOPING dispatch. Instrument-only; no enforcement change lands.

## Startup verification (verified by execution)

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a13467dfcbdebe503`
- `git rev-parse --show-toplevel` == same
- `git status --short` clean at start
- `git merge-base HEAD origin/main` == `origin/main` == `c64c84008746b4cf151c8e2d0503bdd09b801dc5`
- `bun install` ok (218 packages)
- `bun run pretest` PLAIN from worktree CWD; `samples/compilation-tests/dist/` has 34 artifacts (13 samples x .client.js/.html + extras)

## Log

- [t0] BRIEF.md written verbatim. Census dir fetched from `census/s402-type-annotation` into worktree.

## Instruments

- `pos3-migration-probe.mjs` — drives `__pos3Probe` (env-gated, in `compiler/src/type-system.ts`)
  over a corpus; reports NEW-REJECT sites at three inference power levels PLUS the
  denominator (how many argument positions the check could even see).
- `etype031-bool-probe.mjs` — the §7.5.1 position-1 annotation x literal matrix,
  plus the un-annotated arm and the §53 predicate zones the same classifier feeds.
- `corpus-diag-snapshot.mjs` — per-file diagnostic CODE SET snapshot + `--diff`,
  for measuring a candidate widening's blast radius over the whole corpus.

## Measured (verified by execution)

### Position 3 — call-site argument assignability, 1920 `.scrml`

units 1920 · compile-clean today 1271 · already-failing 648 · compiler threw 1

| level | NEW-REJECT sites | files | sites in already-failing files |
|---|---|---|---|
| L1 (today's inference) | 37 | 9 | 6 |
| L2 (+ literal set) | 37 | 9 | 6 |
| L3 (+ decl-site cascade) | 40 | 11 | 6 |

REACH (the denominator): 2935 call nodes seen · 1377 non-simple-ident callee ·
524 callee not in `fnSignatures` · 1034 calls resolved · 900 positions with an
UNANNOTATED param · **309 positions examinable** · proven L1 99 / L3 170.

### §7.5.1 position 1 — the ONE normative SHALL, measured cell by cell

8 off-diagonal cells over {number,string,boolean} x {string, number, bool, template}.
**4 fire, 4 do not** (not 4-of-6 — the census did not test template literals).
Misses: `string = true`, `number = true`, `number = \`tpl\``, `boolean = \`tpl\``.

### Position 3 — false-positive classification (verified by execution, `pos3-corpus.json`)

| level | declared <- inferred | clean-file sites | verdict |
|---|---|---|---|
| L1 | `integer <- number` | 37 | **FALSE POSITIVE** |
| L2 | `integer <- number` | 37 | **FALSE POSITIVE** |
| L3 | `integer <- number` | 38 | **FALSE POSITIVE** |
| L3 | `string\|not <- string\|not` | 1 | **FALSE POSITIVE** |
| L3 | `LoadStatus <- string` | 1 | **GENUINE** |

**False-positive rate: L1 37/37 = 100%. L3 39/40 = 97.5%.**

- FP class 1 — `int` is `tPrimitive("integer")` (`BUILTIN_TYPES`, `compiler/src/type-system.ts`);
  `fieldTypeEquals` compares primitives BY NAME, so `number` is not assignable to `int`.
  SPEC has NO `int`/`number` assignability rule anywhere (`grep integer compiler/SPEC.md`);
  §53's grammar lists `integer` as a base type and §14.1.2 lists `int` as a builtin, and
  nothing rules the pair. **Position 3 cannot be turned on before this ruling.**
- FP class 2 — `fieldTypeAssignable` has a union-TARGET rule and no union-SOURCE rule, so
  `string|not` is not assignable to `string|not`.
- GENUINE — `examples/23-trucking-dispatch/pages/customer/loads.scrml`, `matchesFilter`
  passes `loadStatus: string` into `isActiveLoad(status: LoadStatus)`. The source comment
  says "`loadStatus` is the stored variant-name string" — the author knew.

### Flagship as ONE program, and the self-host

- `examples/23-trucking-dispatch` (36 files, one program): L1/L2 **0**, L3 **1** (the genuine one).
  Reach: 489 call nodes, 201 resolved, 205 unannotated params, **18 examinable**.
  241 `fn`/`function` declarations in the tree; **47 (19.5%) carry any annotated parameter**.
- `compiler/self-host` (11 files): L1/L2/L3 **0**. Reach: 3145 call nodes, 1566 resolved,
  **1501 unannotated params, 0 examinable**, 18 over-supplied args (arity — nothing checks it).
  75 `fn` declarations, **ZERO annotated parameters** (`fn tPrimitive(name)`, `fn tStruct(name, fields)`).

### E-TYPE-031 literal-set candidate — blast radius (verified by execution)

Patch: `etype031-literal-set-CANDIDATE.patch` (68 lines, 4 edits in 2 files).

- `bun scripts/types-gate.ts --check`: **identical 12 diagnostics before and after** — zero new.
  (Those 12 are PRE-EXISTING on `origin/main@c64c8400`; types-gate is red on main.)
- Corpus diff over 1920 files: **+0 errors, -0 errors, +0 warnings, -18 warnings.**
  18 files RETIRE `W-TYPE-031-UNPROVEN`. Strictly improving; zero migration.
- Test suite (`unit`+`integration`+`conformance`): 23275 pass / 70 skip / **3 fail**, all
  expected-shape: 2 x `trucking-dispatch v0.2-shape diagnostic baseline` (a count that goes
  DOWN, 338 -> 321) and 1 x `s365-asis-unknown-split.test.js` `gap at \`lit\`` — a GAP_CASES
  entry that asserts today's narrow inference and must move to SILENT_CASES.
  ⚑ That test carries NO FLIP marker (unlike §7.5.2's `match`/`if` pin), so it reads as a
  regression rather than as an intended flip.
- Closes 4 of 4 missing cells: `string = true`, `number = true`, `number = \`tpl\``,
  `boolean = \`tpl\``. All 8 off-diagonal cells fire; all 4 diagonal cells stay silent.
- One reachability change, corpus impact 0: a bool/template initializer at a PREDICATED
  position moves from the BOUNDARY zone to the STATIC zone, so `checkPredicateLiteral`
  (and its `checkNamedShapes` arm) now runs there. `checkPredicateLiteral` already declares
  `value: number | string | boolean` and already returns `null` for a boolean.

### Position 2 (state-cell declaration) candidate — blast radius (verified by execution)

Patch: `pos2-state-cell-CANDIDATE.patch` (44 lines; the position-1 arm copied verbatim to the
reactive-decl site, ~20 lines of real code).

- Corpus diff over 1920 files: **files changed 0. +0 errors, +0 warnings.**
- Verified NOT a dead path: census fixture `07-state-decl-number.violation.scrml`
  (`<n>: number = "not a number"`) now emits `E-TYPE-031`; its control stays silent;
  `08-state-decl-int` stays silent (correct — `int` is outside §7.5.1's enumerated set).

### The "6 specified and DEAD" partition is NOT homogeneous (verified by reading)

`grep -rn '"E-TYPE-0xx"' compiler/src`:
- **E-TYPE-072 — ZERO push sites.** Never implemented. Greenfield, not wiring.
- **E-TYPE-043 — ZERO push sites.** Same.
- E-TYPE-004 — 2 push sites (`compiler/src/type-system.ts`).
- E-TYPE-046 — 1 push site, but `collectPlainOptionalReceivers` collects `state-decl`
  nodes ONLY and explicitly `continue`s past `function-decl`. Census rows 25/26 (`let u: User?`,
  `fn f(u: User?)`) are outside its receiver set BY CONSTRUCTION — a scope that never covered
  `let` or fn params, not a missing case.

### Position 2 — test-suite churn, candidate UNGATED (verified by execution)

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`
with `__POS2_CANDIDATE = true` (fully on, not env-gated):

**23278 pass / 70 skip / 0 fail.** Zero test churn on top of zero corpus migration.

Baseline for comparison (probe-only tree, `SCRML_POS3_PROBE` unset): 23278 tests,
0 fail — the same population, since the 3 failures seen under the E-TYPE-031
candidate were that candidate's, not the probe's.

## Verdict summary

1. **The migration does not dominate.** Bryan's stated prior is falsified as stated:
   position 3's migration over 1920 files is 40 sites of which **1 is genuine**;
   position 2's is **0**; the E-TYPE-031 literal-set fix's is **0 (negative — it
   retires 18 warnings)**. What dominates instead is the check's **precision**
   (97.5% false-positive at L3) and its **reach** (309 of 2935 call nodes examinable).
2. **"It's wiring, not invention" survives for positions 1 and 2 and FAILS for position 3.**
   Position 3's dominant false-positive class needs a SPEC ruling on `int`/`number`
   that does not exist, and §7.5.1's ruled order does not schedule it.

## Final tree state

`compiler/src/type-system.ts` is restored to `origin/main`. This dispatch lands
**docs only**. The three throwaway compiler-side instruments are archived as patches
in this directory and are NOT applied:

| patch | what it is | re-apply with |
|---|---|---|
| `pos3-probe.patch` | the env-gated §7.5.1 position-3 measuring probe + REACH counters (272 lines). NOT A GATE — inert unless `SCRML_POS3_PROBE=1`, pushes nothing into `errors`. | `git apply` then `bun .../pos3-migration-probe.mjs` |
| `etype031-literal-set-CANDIDATE.patch` | the position-1 bool + template literal-set widening (4 edits, 2 files) | `git apply` then `bun .../etype031-bool-probe.mjs` |
| `pos2-state-cell-CANDIDATE.patch` | the position-2 state-cell arm, env-gated on `SCRML_POS2_CANDIDATE=1` | `git apply` then `bun .../corpus-diag-snapshot.mjs` |

The three `.mjs` harnesses ARE landed and are re-runnable once the matching patch is applied.
