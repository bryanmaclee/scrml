# progress — bare call at default-logic body-top (S368)

## Unit 0 — startup
- Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1eb5b222a7562611
- Base: 3a7203ff (origin/main at cut time)
- `bun install` + `bun run pretest` OK.
- BRIEF.md fetched from `brief/s368-bare-call`, read in full.

## Unit 1 — reproduce the four shapes on my own base (3a7203ff)
Exit codes measured DIRECTLY (no pipe):

| shape | exit | behaviour |
|---|---|---|
| `Welcome to the dashboard.` | 0 | renders as text (working shape) |
| `Loading` | 0 | renders as text (working shape) |
| `loadData()` | 0 | **ships literal `loadData()` at HTML line 11 — THE DEFECT** |
| `@n = 2` | 1 | `E-WRITE-NOT-IN-LOGIC-CONTEXT` (already ruled) |

All four reproduce exactly as the brief measured. PA loci HELD.

### Extended baseline probe matrix (pre-change)
- `store.refresh()` alone at body-top -> exit 0, ships as TEXT (in scope)
- `reset(@count)` alone at body-top -> exit 0, ships as TEXT (in scope; scrml builtin call form)
- `loadData()` at `<page>` body-top -> exit 0, ships as TEXT (in scope)
- `${ loadData() }` -> exit 0, runs (must stay)
- `function loadData() { helper() }` -> exit 0 (must stay)
- decl + call in ONE text run (`function f(){}` then `loadData()`) -> lifted by BARE_DECL_RE, runs (must stay)
- `Loading (please wait)` -> exit 0, text (must stay)
- `loadData()` inside a `<div>` markup body -> exit 0, ships as TEXT (**out of scope** — isDefaultLogicBody false)
- `if (@n > 0) { }` alone at body-top -> exit 0, ships as TEXT (**out of scope** — control-flow shape, not call shape; see DEFERRED)

## Unit 2 — E-CALL-NOT-IN-LOGIC-CONTEXT landed
`compiler/src/ast-builder.js`:
- `TOPLEVEL_BARE_CALL_RE` + `SCRML_BUILTIN_CALL_KEYWORDS` + `matchTopLevelBareCall()`
- fire site in `liftBareDeclarations`, gated `isDefaultLogicBody === true`, below the decl-lift gates
- reject + RECOVER by dropping the text block (mirrors `E-CONTROL-FLOW-IN-MARKUP`)

Discriminator is scrml's grammar only. The keyword fence reads the tokenizer's own
exported `KEYWORDS` set (its doc comment: "the single source of truth for what the
tokenizer reserves"), minus six SPEC-spelled builtin CALL forms
(`animationFrame`/`broadcast`/`cleanup`/`disconnect`/`navigate`/`reset`). No JS parse
anywhere; no "valid JS" reasoning anywhere.

Identifier charset `[A-Za-z_$][A-Za-z0-9_$]*` — verified empirically against
`compiler/src/tokenizer.ts:1342-1343` (`isIdentStart`/`isIdentPart`), not relayed.

## Unit 3 — MEASURED migration (compiler-derived, NOT text scanning)
Oracle: `compileScrml({write:false})` — the real front-end, i.e. the landed gate itself —
run over every `.scrml` under `samples/ examples/ conformance/cases/ stdlib/ benchmarks/ docs/`.

    scanned:        2193 .scrml files
    compiler-threw: 0
    E-CALL-NOT-IN-LOGIC-CONTEXT fires in 2 file(s)
      - docs/changes/default-logic-line-comment/repro-minimal.scrml
      - docs/changes/default-logic-line-comment/repro-original.scrml

**Count is NON-ZERO -> STOPPED before migrating, per the brief.** No exemption entries
added, no corpus file edited. Characterisation for PA is in the report.

## Unit 4 — SPEC
- §40.8: new **S368 COMPLEMENT amendment** + a `Provenance (pa-base v2.10 Rule 4b)` block carrying
  `ruling:user-voice-scrml.md S368` and BOTH verbatim lines (the `c.` ruling and the "valid js is
  not a consideration one way or another" correction), plus the two rejected alternatives.
- §34: new `E-CALL-NOT-IN-LOGIC-CONTEXT` row, inserted directly beneath its
  `E-WRITE-NOT-IN-LOGIC-CONTEXT` sibling.

## Unit 5 — LOCUS REFINEMENT (the brief's locus was narrower than the code it says to match)
The brief scopes the fire to `<program>` / `<page>` / `<channel>`. MEASURED: the sibling
`E-WRITE-NOT-IN-LOGIC-CONTEXT` also fires at the **IMPLICIT** default-logic body — the top level of
a file with no `<program>` wrapper (probe `q`, exit 1). A bare CALL there ships as page text
identically (probe `r`). The brief says "Match that code's discrimination exactly", and the sibling's
OWN conformance cases (`conformance/cases/reactive/write-not-in-logic-context-{pos,neg}`) are written
with no `<program>` wrapper — i.e. the file top level IS the canonical conformance expression of
"default-logic body-top". Gate widened to `isDefaultLogicBody || parentType === null`.
Re-measured census after widening: still exactly 2 files.

### The widening found a latent instance the .scrml census could not see
`compiler/tests/unit/c22-bare-variant-codegen.test.js` §C22.8 carried a bare `render(m)` at an
implicit default-logic body-top. MEASURED by EXECUTION: the emitted client JS contained **no lowered
render call at all** (only `_scrml_render_value`, the `${@phase}` interpolation lowering) while the
literal `render(m)` shipped into the emitted HTML as page text. The test passed because it asserts on
the `_scrml_reactive_set` line, not on render. Fixed to `${ render(m) }` (SPEC §20.3a: the built-in
is a `render(...)` call *in logic position*).

**Population-derivation gap, stated:** the census enumerates `.scrml` files on disk, so inline test
fixtures are invisible to it. Closed by EXECUTION — the full gate suite run without `--bail` names
the whole inline population: exactly ONE test.

## Unit 6 — conformance parity
Three cases mirroring the sibling's pos/neg pair, plus a prose COUNTER-gate:
`reactive/call-not-in-logic-context-{pos,neg,prose-neg}`. 886/886 pass (was 883/883).

## Unit 7 — verification (all measured, exit codes DIRECT, never through a pipe)
- Bite proof: `loadData()` -> **exit 1**; prose -> **exit 0**; bare word -> **exit 0**;
  reverted compiler (merge-base checkout) -> **exit 0 AND `loadData()` back at HTML line 11**.
- Exemption bite: with one entry, exit 0 AND the call ships as text again — byte-identical status quo.
- Gate suite: **29196 pass / 0 fail** (29283 across 1277 files).
- Full `bun run test`: 30487 pass / 53 fail — failure SET compared against a merge-base run of the
  SAME command: **0 new, 0 fixed**. All 53 are pre-existing browser-suite failures.
- Conformance `bun conformance/run.ts`: **886/886**, exit 0.
- `corpus-emit-differential`: over the **1906 COMMON sources / 7388 artifacts** — 0 newly failing,
  0 newly passing, 0 diagnostic changes, **0 artifact content diffs**. The only delta is a source-set
  ADDITION of my 3 new conformance case files.
