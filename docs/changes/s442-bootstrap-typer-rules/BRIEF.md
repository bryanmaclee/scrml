# BRIEF — s442-bootstrap-typer-rules (S442, bryan/XPS PA)

You are the canonical dev agent working in an ISOLATED WORKTREE on the scrml bootstrap compiler
(`compiler/self-host-v2/`, scrml source compiled by impl#1). Task: implement the S440-RULED typer/checker
diagnostics in the bootstrap.

## 0. CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENT counter: 0 this session)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit.
2. `git rev-parse --show-toplevel` == that path. `git status --short` clean.
3. `git merge-base HEAD origin/main` == `git rev-parse origin/main` (your base is origin/main; assert it).
4. `git fetch origin brief/s442-bootstrap && git checkout FETCH_HEAD -- docs/changes/s442-bootstrap-typer-rules/`
   (this BRIEF lives on that branch; main is protected so it is not on main yet). Commit it as your first commit:
   `WIP(s442-typer-rules): start at $(pwd)`.
5. `bun install` then `bun run pretest` run PLAINLY from the worktree CWD (NOT `bun --cwd <path> run` — that
   silently no-ops and exits 0).
6. Every Edit/Write uses an ABSOLUTE path under your worktree root. Never `cd` into
   `/home/bryan/scrmlMaster/scrml` (the main checkout). Use `git -C "$WT"` / `--cwd=` forms.
7. NEVER `git stash` (the stash stack is shared across all worktrees). Flip base-vs-build by FILE COPY.
8. NEVER `pkill -f` / `killall` on a shared command string — kill only by the PID you captured.
9. Commit after EVERY meaningful unit (WIP commits expected) and append a timestamped line to
   `docs/changes/s442-bootstrap-typer-rules/progress.md` (what was done / what's next / blockers). Your branch +
   progress.md are the crash-recovery anchor. Never end with uncommitted work.

## 1. MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing. ⚑ The map stamp is `fb21983a`
(S438) — it PREDATES the bootstrap M3 typer (#1117), the tables split (#1122), the ingest/bite matrix (#1118)
and the S440 re-land (#1129, spread all-or-nothing, strict snapshot, E-STRUCT-DUPLICATE-KEY). Treat every map
claim about `compiler/self-host-v2/` as a HYPOTHESIS to verify against source. A refresh is running in
parallel; do not wait for it. Report whether the maps were load-bearing ("not load-bearing" is a valid answer).

## 2. Anti-pattern briefing
The bootstrap is WRITTEN IN scrml. Before writing scrml, read
`../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` and `docs/articles/llm-kickstarter-v2-2026-05-04.md`;
re-read before each feature. The bootstrap has its own established idioms and known impl#1 workarounds
(`compiler/self-host-v2/progress.md` DOGFOOD FINDINGS F1-F10, slice progress files) — mirror the surrounding
code, do not invent new shapes.

## 3. Authority — the RULINGS, not SPEC (SPEC pass 2 is not written yet)
The governing text for every item below is `../scrml-support/user-voice-scrml.md` §S440 (lines ~19229-19502).
READ IT IN FULL before building. PA restatements below are POINTERS; if a restatement and the ruling text
disagree, the ruling text wins and you REPORT the disagreement (S439/S440: PA briefs have widened rulings
three times — do not trust this brief's paraphrase over the ledger). For each item record in progress.md:
`provenance: ruling:user-voice-scrml.md S440 — "<verbatim answered line>"`. Where SPEC already has a
sentence, quote it too (Rule 4 governing-sentence gate). Prior context: the typer's own OWES-A-RULING table
at `docs/changes/s439-bootstrap-m3-typer/progress.md` — S440 ruled most of those rows.

## 4. The work (ordered; commit per item)
Scope = the bootstrap typer/checker. You OWN: `compiler/self-host-v2/{analyze,check,names}.scrml` and the
typer tests (`slice-m2/typer.test.js`, `slice-m2/typer-gap.test.js`, new test files you add). A parallel agent
owns `parse/lex/ast/lower/print/html/js/walk.scrml` — if you MUST touch one of those, keep the edit minimal and
additive and list it explicitly in your report. Do NOT touch `core.scrml` or `slice-m3/` CSS files (another
session holds a branch on them).

1. **#1 cell AND field write type mismatch → `E-TYPE-031`** (S440 22-item "the rest your recs" #1 + the
   three-SPEC-items rec #1: a wrong-typed FIELD write is E-TYPE-031 too).
2. **#2 call arity** — extra arguments are an error; too few is an error unless the parameter has a default
   (§7.3.2). Replace `E-BOOTSTRAP-CALL-ARITY` with the code you find ruled/named; if none is named, propose one
   and flag it.
3. **#3 `<each in=>` over a provable non-sequence → `E-EACH-NOT-SEQUENCE`**; unresolved type stays SILENT
   (provable-or-silent).
4. **#5 `E-HANDLE-REDECLARE`** — duplicate `as=` in one scope; a handle named like a cell; same name on
   mutually-exclusive `if=` instances (error for now). **#7:** a row `as=` handle MAY shadow a program-level
   HANDLE, NOT a CELL.
5. **#6 duplicate top-level `function` → `E-SCOPE-010`.**
6. **Duplicate keys in ANY struct literal → compile error** (plain, nested, spread-override). The spread
   case already landed as `E-STRUCT-DUPLICATE-KEY` in #1129 — extend the same code; do not mint a second.
7. **Truthiness (c) + Q1/Q2** — conditions (`if=`, `if`, `while`, ternary, `!`/`&&`/`||` operands) require a
   boolean or a `T | not` presence test; a bare `@x` of type `T | not` IS a presence test (emit an absence
   check, never JS truthiness); error where PROVABLE, silent where the type is unknown; no §63 window.
8. **Operators (Gotcha Q1-Q3)** — arithmetic/relational take numbers only; `+` two numbers or two strings;
   `!`/`&&`/`||`/`and`/`or` booleans only; a `T | not` operand must be narrowed before `+`/arithmetic/
   comparison/template use. Provable-or-silent.
9. **`int` enforcement (JS-WAT 7(a))** — `7 / 2` into `int` is an error; §7.5.1's provable domain widens to
   `int`. NOTE `/` on two ints becomes a compile error under dpa-054 #3 (`div(a, b, .Mode)`) — implement the
   `/`-on-int error message naming `div`, but NOT the `div` function or `decimal` (separate dispatch).

## 5. Verification — a grade is only evidence if breaking the thing breaks it (S439)
- Each new diagnostic: a positive test (fires on the ruled shape) AND a negative test (silent on the adjacent
  legal shape — especially the provable-or-silent boundary and the #7 handle-vs-cell carve-out).
- Run the existing suites before/after: slice-m1, slice-m2 (typer/front/lower/tables/parse), slice-m3
  (ingest/footprint/bite), and `bun conformance/run.ts` (impl#1 must be unchanged — you are not editing impl#1).
- Re-run the footprint grader + bite matrix (`slice-m3/bench/bite-matrix.js`) and report the before/after
  counts. A newly-rejecting rule may drop previously-certified passes — REPORT, don't hide.
- Newly-rejecting ⇒ MEASURED migration: report how many corpus cases the bootstrap now rejects per new
  diagnostic (the ingest corpus is the measure). Non-zero is fine; it must be reported with case names.
- Do NOT mark DONE on "tests pass" alone.

## 6. Report (final message)
WORKTREE_PATH · FINAL_SHA (== branch tip) · files-touched (flag any outside your owned set) · per item:
done/partial/blocked + provenance line + tests · suite before/after numbers · footprint/bite before/after ·
per-diagnostic corpus rejection counts · rulings you found ambiguous or that this brief mis-stated ·
maps load-bearing? · deferred items.
