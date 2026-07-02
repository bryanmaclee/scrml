# BRIEF — Road-B compiler, self-host-v2 LEXER slice 1 (S234, 2026-07-01)

You are building the FIRST piece of the re-imagined scrml compiler (impl#2, "Road B") — the LEXER,
as **human-authored idiomatic scrml**, in a FRESH dedicated directory `compiler/self-host-v2/`.
This is the flagship dogfood of the language: the success metric is *"is this how a scrml native
would write it,"* NOT a faithful port of the TS lexer.

Ratified decisions you operate under (S234, do NOT relitigate):
- **Home = `compiler/self-host-v2/`** (a fresh dedicated area — NOT inside `compiler/native-parser/`).
- **Fresh Approach-B build.** The existing `compiler/native-parser/lex*.scrml` is the ruled-out
  Approach-A engine-lexer (the GAP-A1 misfit) AND the live TS-era front-end. **DO NOT touch it, DO
  NOT migrate it, DO NOT import from it.** You are writing a NEW lexer from the design, from scratch.

---

# MAPS — REQUIRED FIRST READ

Before other context, read `.claude/maps/primary.map.md` in full (~100 lines) + follow its
Task-Shape Routing for "new feature / compiler-source". Map currency: maps reflect HEAD `04e7a1bb`
as of 2026-06-30; HEAD is now `495a041b` (maps ~5 commits stale) AND your work is in a BRAND-NEW dir
`compiler/self-host-v2/` with zero map coverage — so the maps are orientation only here; verify
against current source. In your report: "Maps consulted: [list]; load-bearing finding: <one line>"
OR "Maps not load-bearing (new-dir work)."

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree is under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.

## Startup verification (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is
   under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report (S90 CWD-routing
   failure). Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` — worktrees do NOT inherit node_modules (the pre-commit `bun test` fails with
   "cannot find package 'acorn'" otherwise).
5. `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; the browser suite
   reads it). Use `bun run test` (chains pretest), NOT bare `bun test`, for full-suite baselines.
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY write)
- Apply file edits via **Bash** (`perl`/`python3`/heredoc/`cp`) on **worktree-absolute paths that
  include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools, and NEVER on a
  main-rooted absolute path. Echo the target path before each write; re-verify via `git diff`/`grep`.
- **Never `cd` into the main repo** (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`,
  `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively. (S99/S126: Edit/Write +
  `cd`-into-main are the two live leak classes; Bash-on-worktree-absolute-paths sidesteps both.)
- First commit message includes the verbatim `pwd` output (S99), e.g. `WIP(lexer-slice1): start at $(pwd)`.

---

# READ FIRST — the design authority (Rule 4: these are normative; do not improvise the design)

1. `scrml-support/docs/deep-dives/compiler-reimagining-lexer-slice-2026-06-26.md` — read §"Shared
   substrate (both approaches)" + §"Approach B — types + match-fold" (YOUR build target). **IGNORE
   Approach A** (the ruled-out engine-native misfit). The `${...}` code blocks there are your
   compilable-shaped starting design.
2. `docs/changes/compiler-architecture-skeleton-2026-06-30/RULING.md` — §1 (pipeline: lex = a single
   fold) + §5 (conformance-driven build).
3. `scrml-support/docs/deep-dives/compiler-arch-conformance-driven-build-2026-06-30.md` — the
   loop-until-green shape + the **lexer→token-diff** oracle + the wave partition.
4. `docs/articles/llm-kickstarter-v2-2026-05-04.md` — IN FULL before writing ANY scrml (canonical
   scrml shape, the stdlib catalog, the inline anti-pattern table).
5. `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — before writing code + reread before
   each sub-feature (the React/Vue/JSX-reflex counter-table).

---

# THE TASK — Approach B lexer, slice 1

Approach B = a **pure `fn lex(src: string) -> Token[]`** that folds `step(st: LexState) -> LexState`
over a `match (st.mode, event)` transition table. NO `<engine>`, NO reactive `@` cells, NO singleton,
NO render — `LexState` is a struct THREADED through the fold (re-entrant by construction).

**Slice-1 scope — keep it GREEN-able (loop-until-green; small-and-green beats big-and-red):**

1. **Shared substrate** (author fresh per the DD §"Shared substrate"): `TokenKind:enum`
   (payload-carrying variants — `NumberLit(value, raw)`, `StringLit(...)`, `Ident(name)`, etc.),
   `QuoteKind`/`BracketKind`, `Span`/`Token`/`Cursor` structs, `makeCursor`/`peekCode`/`advance`/
   `isEof`, the char-class pure fns (`isWhitespace`/`isNewline`/`isDigit`/`isIdentStart`/
   `isIdentCont`), and `regexAllowedAfter` (the 2-line exhaustive `match`). This substrate IS the
   scanning-stdlib prereq — no separate stdlib needed for slice 1.
2. **The lex-fold skeleton** (per DD §"Approach B"): `LexMode:enum`, `LexState:struct`, `step(st)`
   with the `(mode, event)` match, `lex(src)` driver loop (`while (!isEof(st.cur)) st = step(st)`).
3. **CORE-TOKEN scanners ONLY** this slice: `scanIdentOrKeyword`, `scanNumber`,
   `scanOperatorOrPunct` (maximal-munch as a `match` on the leading code-point → small munchers:
   `munchEq`/`munchBang`/`munchLt`/`munchGt` + single-char punctuation/brackets).

**DEFER to later slices (do NOT build now):** strings, template-interp nesting, line/block comments,
regex bodies. In `step()`, route those events to a total-but-stub arm (e.g. `advanceOne(st)` with a
`// TODO slice-N` note) so the fold stays exhaustive — but they are NOT scanned this slice. Record
every deferral explicitly in `progress.md`.

---

# THE ORACLE — token-diff, loop-until-green

Per arch-skeleton §5 + the conformance-build dive, the lexer wave gates on a **token-diff vs impl#1**
(the reference), not the full source→codes+runtime conformance.

- **Phase 0 (characterize BEFORE building):** establish the reference token stream + the diff
  normalization. Inspect `compiler/tests/parser-conformance-lexer.test.js` for the existing
  token-diff harness shape and the impl#1 tokenizer it drives; decide the exact reference and what's
  compared (token `kind` + `span` + `text`; message-text / impl-internal fields are impl-freedom per
  D3). **Write the oracle design into `progress.md` before writing the lexer.** If the exact
  reference is ambiguous, pick the most defensible one, state the choice + why, and proceed (do not
  stall).
- **Phase 2 (drive to green):** compile `compiler/self-host-v2/lex.scrml` via the live compiler →
  run the emitted JS `lex()` on a SMALL corpus subset restricted to slice-1 tokens (identifiers,
  numbers, operators, punctuation — NO strings/comments/regex/templates, since those are deferred) →
  token-diff vs the reference → drive to GREEN on that subset.
- Add a test file `compiler/tests/self-host-v2/lexer-slice1.test.js` that runs the diff; it MUST pass
  in main (and in the pre-commit subset — put it under a dir the hook runs, or note if it needs the
  full suite).

---

# DOGFOOD DISCIPLINE (this is the POINT, not a side effect)

You are writing a real scrml program that must COMPILE via the live compiler. If the compiler
**rejects or miscompiles idiomatic scrml** you wrote (a payload-match, a threaded-struct update, a
`match (a, b)` product-match, an exhaustive-enum dispatch), that is a **REAL COMPILER BUG** and a
PRIMARY deliverable:
- Capture it precisely in `progress.md`: a MINIMAL repro `.scrml` + the exact `E-code`/symptom +
  what you expected. (`match (mode, event)` standalone product-match is an explicitly-flagged
  open-question in the lexer-slice DP — exercise it and report how it behaves.)
- Do NOT paper over a compiler bug with un-idiomatic contortions UNLESS necessary to stay green — and
  if you must, flag the workaround loudly + still file the underlying bug. "look, scrml does it WAY
  BETTER" is the goal; if it can't yet, we want to KNOW.

---

# COMMIT + REPORT

- **Incremental commits** per sub-bucket (substrate → skeleton → scanners → oracle/test) for
  crash-recovery — do NOT batch. Commit via `git -C "$WORKTREE_ROOT"`.
- Before reporting DONE: `git status` clean (no uncommitted work) + full `bun run test` GREEN (your
  new test passes + ZERO regressions). Never `--no-verify`.
- **Final report:** WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the oracle design (reference +
  normalization) · which slice-1 corpus subset is token-diff-GREEN · the deferred scanners · and the
  compiler-bug captures (the dogfood findings — even "zero bugs, compiled clean" is a valuable result).

This is slice 1 of a multi-slice wave; subsequent slices (strings → comments → regex → template-interp)
are separate dispatches. Land this one green + report the dogfood findings.
