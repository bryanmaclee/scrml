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
