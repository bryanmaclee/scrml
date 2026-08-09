# S331 — derived-cell RHS reaching a server-only stdlib module

Append-only, timestamped. Recovery anchor for the dispatch.

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a22e2a0608d5bcd30`
Branch: `worktree-agent-a22e2a0608d5bcd30`
Base: `87ae577f`

---

## 2026-08-09 — startup + defect reproduced

- Startup verification passed: `pwd` under `.claude/worktrees/agent-`, VCS toplevel == pwd,
  tree clean, `bun install` OK, `bun run pretest` OK (13 samples compiled).
- Read SPEC §12.2 IN FULL (lines 7210-7239), including the Trigger-3 S299 amendment block and
  §12.4's *"Route inference SHALL be per-function"*.
- **Defect reproduced exactly as briefed.** `docs/changes/s331-.../reproducer.scrml`:
  - exit **0**, no `.server.js` emitted at all
  - `reproducer.client.js:21` — `const { hashPassword } = _scrml_stdlib.auth;`
  - `reproducer.client.js:36` — the call inside the derived recompute closure
  - shipped runtime: **4** occurrences of `Bun.password`
- **Control built and confirmed** (`control-function.scrml` — same import, same call, inside a
  plain `function`): `.server.js` IS emitted; `hashPassword` count in client bundle = **0**;
  `Bun.password` in shipped runtime = **0**; count in `.server.js` = **2**.
  Attribution is therefore derived-specific, as briefed.

## 2026-08-09 — locus traced: hypothesis REFINED, not merely held

The brief's hypothesis was "a derived RHS is not a function, so the walk never visits it."
That is TRUE but NARROWER than the actual cause.

- Trigger 3's walk is `collectServerOnlyBindingModules` (`route-inference.ts`), driven from the
  **Step 3** loop, which iterates `collectFileFunctions(fileAST)`.
- `collectFileFunctions` (`route-inference.ts:1086`) collects **`function-decl` nodes only**.
- A derived cell is a `state-decl` with `shape: "derived"` — so its RHS is never visited.

**The refinement.** The miss is not specific to *derived* cells; it is specific to **every
non-function position**. Measured, same import, same member, same runtime differential:

| position | compiles | `.server.js` | `Bun.password` in shipped runtime |
|---|---|---|---|
| inside a `function` (control) | exit 0 | **emitted** | 0 |
| `const <x> = hashPassword(@pw)` (derived RHS — this fix) | exit 0 | none | **4** |
| `<x> = hashPassword(@pw)` (MUTABLE cell initialiser) | exit 0 | none | **4** |
| `<div>${hashPassword(@pw)}</div>` (markup interpolation) | exit 0 | none | **4** |

Rows 3 and 4 are the SAME defect class in adjacent positions and are **NOT closed by this
dispatch** — see "Surfaced, deliberately not done" below.

## 2026-08-09 — fix landed: refuse, do not escalate

- `scanForServerOnlyBindingRefs` extracted from `collectServerOnlyBindingModules`
  (behaviour-preserving; full suite green at `6c279228`) so the derived check shares ONE walk
  with the function check instead of forking the confidentiality rule.
- Added `collectDerivedCellDecls` / `collectDerivedRhsServerOnlyRefs` /
  `collectDerivedRhsLocalNames` / `stateDeclRhsRoots`.
- Added RI **Step 3b**, which emits `E-DERIVED-SERVER-ONLY-REACH` (error).
- Carve-out: `isToolProgram(fileAST)` files are skipped — a `kind="tool"` program (§64) has no
  client boundary, so a server-only module there is not a leak and refusing would reject valid
  code. Mirrors the carve-out §12.2 Trigger 3 already takes for `print()`/`println()`.

**Reproducer after the fix:** exit **1**, `E-DERIVED-SERVER-ONLY-REACH` at the derived cell.
**Control after the fix:** still compiles, still emits `.server.js`, still 0 leak. Non-regression
gate holds.

## 2026-08-09 — measurements

- **Migration count: ZERO.** Ran RI over all **59** repo `.scrml` files that import a module in
  `ESCALATION_SERVER_ONLY_MODULES` (set read from the compiler source, not hand-copied; 0
  parse/RI failures). Exactly **1** fire, and it is `reproducer.scrml` — the deliberate defect
  file added by this change. **No pre-existing corpus file fires.**
  - Note: the brief's "14 corpus files import an escalation module" used a narrower corpus
    definition; whole-repo the number is 59.
  - Note: 6 real corpus files DO both import an escalation module and declare a derived cell
    (`examples/23-trucking-dispatch/**`), but co-occurrence is not the fire condition — in every
    one, `createSessionStore` is reached only from inside a `function`, never from a derived RHS.
    Co-occurrence over-counts; the fire measurement is the real one.

## 2026-08-09 — SPEC + conformance

- §6.6.19 NEW (normative home) with the inline `> **Provenance:** spec:§12.2 Trigger-3 S299
  amendment` line; §12.2 Trigger 3 gains a block making its FUNCTION scope explicit and pointing
  at §6.6.19; §6.6.12 local summary; §34 catalog row with emitter provenance; SPEC-INDEX entry.
- 3 conformance cases, all asserting in `codes`/`notCodes` (not prose):
  `-pos` (fires, severity error) · `-neg` (`scrml:data` in a derived RHS still compiles — the
  over-fire guard for the 72-site class) · `-fn-path` (the S299 function path still escalates and
  does NOT fire the derived code — the non-regression gate).
- `bun conformance/run.ts`: **879/879 pass.**

## 2026-08-09 — corpus emit differential

**Stated expectation before running:** 0 content differences on common sources; exactly 3 added
sources (the new conformance cases); 0 newly-failing pre-existing sources.

**First run was CONTAMINATED and I threw it out.** Base was a `git archive` extract at a different
absolute path from head; the diff reported **1009 of 7334 artifacts differing**, every one with an
IDENTICAL byte count. Cause, isolated to a single token:

```
< // --- chunk cell scope (01klyi21) ---
> // --- chunk cell scope (000h8maz) ---
```

The chunk-scope ID is **derived from the compiler root's absolute path** (verified: compiling the
same source twice from one root gives an identical ID; from the two roots gives the two IDs above).
`scripts/corpus-emit-differential.ts` states in its own docstring: *"The emitted ARTIFACTS were
separately verified to contain no absolute-path leak, so artifacts are compared byte-exact with no
normalization at all."* **That claim is false** — the leak is path-DERIVED rather than a literal
path string, so a substring check for the path passes while the bytes still depend on it. Filed as
`g-corpus-emit-differential-path-derived-chunk-id-false-diffs`.

**Corrected run** — both sides captured from the SAME absolute path (`.../scratchpad/cmp`, a clone
checked out at base then at head), so the token is constant:

```
VERDICT: 3 DIFFERENCE(S)  over 1899 common sources of 1899 base / 1902 head enumerated
                          and 7334 compared artifacts
  source set delta          3   (exactly the 3 added conformance cases)
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7334 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  bare server-fn sites      base 142 / head 145 (+3, in 0 EXISTING source(s))
```

The `+3` bare sites are confined to the new `-fn-path` case and are the metric counting
`async function _scrml_fetch_*` DECLARATIONS; both real call sites in that artifact are `await`ed.

**What this axis does and does NOT cover.** It covers: did emitted bytes move for any corpus
program, and did any pre-existing source newly fail to compile (the load-bearing check for a
newly-rejecting change — it is **0**). It does NOT cover: (a) sources outside the five default
roots — `docs/`, `compiler/native-parser/`, `handOffs/` are excluded, which is why the reproducer
itself is not in it; (b) the leak this fix closes, because the corpus does not contain the shape —
a clean `0 of 7334` here means the corpus lacks the defect, NOT that the fix is safe; (c) runtime
behaviour of the emitted artifacts.

## 2026-08-09 — suite counts

- **Pre-commit gate** (`bun test compiler/tests/unit compiler/tests/integration
  compiler/tests/conformance`): **22237 pass · 70 skip · 0 fail** (22308 across 1216 files).
- **`bun conformance/run.ts`**: **879/879**.
- **Full `bun run test`, head**: 29869 pass · 216 skip · **49 fail** (30135 across 1347 files).
- **Full `bun run test`, base 87ae577f** (same machine, same `node_modules`, `bun run pretest`
  run first in the base clone): 29849 pass · 216 skip · **51 fail** (30117 across 1346 files).
- **Failure-set diff: 0 NEW in head.** All 49 head failures are pre-existing browser / happy-dom
  runtime tests (engine `§51.0.S`, Bug-60 compound render-by-tag, `§20.8.2` rehydration, the S265
  per-route-chunk module control). The 2 present only in base are
  `TodoMVC §0/§1 — dist not compiled`, a gitignored-`dist` env gap in the fresh clone, not a fix.

  Note on a transient: one pre-commit run failed with `errarm-refail-lowering §5` "timed out after
  5000ms" — with **858397ms** of wall clock on a 5s-limit test. That is process starvation from
  two full suites overlapping (the previous commit's post-commit hook against this one's
  pre-commit hook), not a regression: the file passes in 626ms in isolation, and the commit landed
  green on retry with no concurrent load.

## 2026-08-09 — adversarial round 1: the perverse path is now REFUSED in the message

Coordinator's adversarial pass returned one finding, and it was correct. I had surfaced the
perverse path myself (below, item 1) and stopped at *documenting* it. **That was the wrong
stopping point for a security diagnostic.** Verified end to end: `const <h> = hashPassword(@pw)`
fires and exits 1; deleting one keyword → `<h> = hashPassword(@pw)` is silent, exits 0, and puts
4 × `Bun.password` in the shipped runtime. The single fastest edit that clears the red text
restores the leak — which makes the diagnostic worse on the confidentiality axis than no
diagnostic, because it manufactures traffic into the hole.

Closed by refusing the workaround explicitly, in all three places the contract lives:

1. **The message** (`route-inference.ts` Step 3b) gains: *"Do NOT just delete `const`: a plain
   cell initialiser (`<name> = …`) reaches the same module from the same client-side position, is
   NOT yet diagnosed, and compiles clean while shipping the implementation to the browser — the
   shortest edit that silences this error is the one that restores the leak."*
2. **A dedicated test** (`§8 — REFUSES the perverse path`) pins the clause so it cannot regress
   out silently, and carries an instruction that when the sibling position IS diagnosed the
   clause is to be REWRITTEN to name the sibling's code, never simply deleted.
3. **§6.6.19 normative bullet** — because a message requirement that lives only in impl#1's
   source is not part of the contract (§12.5's own recorded lesson: *"A normative sentence that
   lives only in one implementation's source is not part of the contract."*). A second
   implementation would otherwise ship the un-defended message. The bullet is scoped *"for as
   long as the adjacent non-function positions remain undiagnosed"* and says the clause SHALL be
   rewritten, not removed, when they are.

Held per instruction: rows 3-4 (the mutable-initialiser and markup-interpolation positions) are
NOT closed — the refusal rationale does not transfer unexamined and that is an operator ruling.

Re-verified after the change: unit file **17 pass / 0 fail**; `bun conformance/run.ts`
**879/879**; `bun scripts/s34-census.ts --check-new` PASS.

## Surfaced, deliberately not done (STOP-IF-BIGGER)

1. **`g-cell-initialiser-and-markup-interp-server-only-reach-do-not-escalate` (HIGH).**
   The mutable-cell-initialiser and markup-interpolation positions leak identically (table
   above). NOT closed here: the brief scoped this dispatch to the derived RHS, and the refusal
   rationale does not transfer unexamined — a derived recompute is synchronous and therefore
   *cannot* be escalated, whereas a one-shot initialiser might legitimately be escalatable. That
   is an operator question. **Consequence worth ruling on:** until they close, an adopter who
   hits the new error can "fix" it by deleting `const`, and get the leak back with no
   diagnostic. The error message deliberately steers to the safe shape (move it into a
   `function`), never to dropping the `const`.

2. **Artifacts are written even when the compile FAILS.** After the fix the reproducer exits 1,
   but the CLI still writes `reproducer.client.js` + the runtime (still 4 × `Bun.password`) into
   the output dir. Verified **pre-existing and general**, not introduced here: the
   `conformance/cases/server-fn/e-route-005-pos` case exits 1 and writes its artifacts too.
   Fail-closed at the diagnostic level is therefore NOT the same as "no bytes on disk" — worth a
   separate ruling. Filed as `g-cli-emits-artifacts-on-failed-compile`.

3. **`g-corpus-emit-differential-path-derived-chunk-id-false-diffs` (MED).** The harness's
   byte-exact artifact comparison is invalid across two checkouts at different paths — see the
   differential section above. It reports ~1009 false differences, which is the trust-destroying
   direction: a reader who has seen the harness cry wolf once stops reading it. The minimal fix is
   to normalize the chunk-scope token (it is already normalizing the console streams for exactly
   this reason) or to document that both sides MUST be captured from one path. Not fixed here —
   outside the brief, and it changes a shared gate.
