# progress — channel-nested-program-precedence-2026-08-19

Append-only. Timestamps are local (America/Denver).

## 2026-08-19 — startup

- WORKTREE_ROOT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa275a59028d3e6d4
- `git rev-parse --show-toplevel` == WORKTREE_ROOT. Tree clean at start.
- `git merge-base HEAD origin/main` = 3b5eed4465fdc92702098bba0049a1e3dce9f4ce
- `git rev-parse origin/main`        = 3b5eed4465fdc92702098bba0049a1e3dce9f4ce  => base assertion HOLDS.
- branch = worktree-agent-aa275a59028d3e6d4
- `bun install` ok (217 packages). `bun run pretest` ok (13 test samples compiled).
- BRIEF.md recovered from origin/bank/s353-three-rulings.

## 2026-08-19 — maps

- Read `.claude/maps/primary.map.md` Task-Shape Routing IN FULL. **There is no routing row for
  symbol-table / placement-diagnostic work.** Nearest rows: "a diagnostic code — ANY code, any
  prefix" -> error.map.md, and structure.map.md for file layout.
- LOAD-BEARING (error.map.md:348 + :276): `E-CHANNEL-INSIDE-PAGE` was **CATALOGED-BUT-NEVER-WIRED
  until S301 (#286)** — a `<channel>` inside a `<page>` compiled clean and wired PROGRAM-scoped,
  and a Wave-1 code comment asserting it fired kept anyone from re-checking. Generalised lesson:
  "a §34 row is not evidence of a fire site; `grep -rn` is." Directly relevant: this dispatch must
  verify fire sites by execution, not by reading.
- structure.map.md:140 names `symbol-table.ts` as the SOLE fire site for `E-CHANNEL-INSIDE-PAGE`
  (`:9377+`). error.generated.md:45 names `symbol-table.ts:9186` for `E-CHANNEL-OUTSIDE-PROGRAM`.
- Invariant 55 (regex over source text in a post-AST stage needs a justification or the structural
  route) flagged as potentially relevant to the `fileHasProgram` pre-scan — to be checked.

## 2026-08-19 — Rule 4 governing-sentence gate

All four sentences read IN FULL and confirmed verbatim. **Line numbers have DRIFTED from the BRIEF**
(SPEC grew since the gap entry was written); content is identical.

- BRIEF said §38 preamble `:20659` — actual **`:21076`**.
- BRIEF said §40 `:22395` — actual **`:22814`**.
- BRIEF said §4.12.1 `:724` — actual **`:724`** (exact).
- BRIEF said §4.12.1 `:718` — actual **`:718`** (exact).

No content contradiction. Proceeding.

Supporting sentence found while reading (not in the BRIEF), SPEC.md:35548 — §58:
"`story=` is not a `<page>` attribute. A `<page>` (§40.8) is not a separate compilation unit — it
shares the application `<program>` scope — so a per-`<program>` build story does not extend to it."
This is SPEC drawing the same distinction the ruling rests on, from the opposite side: `<page>`
shares the `<program>` scope; a nested `<program>` does NOT.

## 2026-08-19 — locus verification (PA-LOCATED-VERIFY)

**HELD.** `compiler/src/symbol-table.ts`, `walkChannelPlacement`. The BRIEF's contract-note range
`:9416`-`:9451` is exact. The fire pair is at `:10035` / `:10045`:

    if (isChannelMarkup && pageDepth >= 1)                            -> fireChannelInsidePage(...)
    else if (isChannelMarkup && programDepth === 0 && fileHasProgram) -> fireChannelOutsideProgram(...)

Depth computation at `:10057`-`:10058`:

    const childProgramDepth = tag === "program" ? programDepth + 1 : programDepth;
    const childPageDepth    = tag === "page"    ? pageDepth + 1    : pageDepth;

`hasProgramElement` (`:9918`) is a STRUCTURAL AST walk, not a source-text regex — invariant 55 does
NOT apply.

## 2026-08-19 — pre-fix empirical probe (execute, don't grep)

Ran a 7-case probe through `splitBlocks` -> `buildAST` -> `runSYM`. Verbatim pre-fix results:

| case | shape | pre-fix SYM |
|---|---|---|
| A | `<program>` > `<page>` > `<program name=w>` > `<channel>` | **E-CHANNEL-INSIDE-PAGE** (the ruled-wrong fire) |
| B | `<page>` > `<program name=w>` > `<channel>` (route file)   | **E-CHANNEL-INSIDE-PAGE** |
| C | `<program>` > `<page>` > `<channel>` (genuine page-nested) | E-CHANNEL-INSIDE-PAGE (must STAY) |
| D | `<program>` > `<channel>` sibling of `<page>` (canonical)  | (none) |
| E | `<program>` > `<page>` > `<program w>` > `<page>` > `<channel>` | E-CHANNEL-INSIDE-PAGE (must STAY: page inside the fresh scope) |
| F | `<program>` > `<program w>` > `<channel>` (no page)        | (none) — already accepted |
| G | file-top `<channel>` + a program-in-page elsewhere         | E-CHANNEL-OUTSIDE-PROGRAM |

TAB parses A/B/E without error — the nested-`<program>`-inside-`<page>` shape is genuinely
constructible, so this is a live mis-fire, not a shape the parser rejects first.

## 2026-08-19 — migration measurement (MY OWN NUMBER, not the BRIEF's)

Walked EVERY `.scrml` in the worktree (skipping node_modules/.git/dist/.claude), building the real
AST and classifying every `<channel>` by the walker's own ancestor semantics.

    .scrml files walked : 2362   (== `git ls-files '*.scrml' | wc -l` = 2362, exact)
      parsed ok         : 2362
      parse failed      : 0
    <channel> nodes     : 53

    PLACEMENT POPULATIONS          pre-fix -> post-fix
      REJECT E-CHANNEL-INSIDE-PAGE      1 -> 1
      REJECT E-CHANNEL-OUTSIDE-PROGRAM  1 -> 1
      ACCEPT canonical (in <program>)  41 -> 41
      ACCEPT dispensed (PURE-CHANNEL)  10 -> 10

The BRIEF's S239 figure was 2260 files / 0 page-nested channels. **My number is 2362 files and
ONE page-nested channel** — and it is `conformance/cases/channel/inside-page/case.scrml`, the
deliberate NEGATIVE fixture for the diagnostic itself. Zero in adopter / example / sample / stdlib
code. That fixture is `<program>` > `<page>` > `<channel>` with NO intervening `<program>`, so it
is the arm that must keep rejecting; it is unmoved by the fix.

**Nested-`<program>`-inside-`<page>` channels in the corpus: ZERO.** Blast radius of the
newly-accepting direction is zero, measured, not assumed.
