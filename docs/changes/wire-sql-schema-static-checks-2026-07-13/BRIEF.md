# BRIEF — wire the 6 spec'd-but-unbuilt SQL/schema static diagnostics (ss66 Class A)

**Change-id:** `wire-sql-schema-static-checks-2026-07-13`
**Dispatched:** S253, 2026-07-13. **Agent:** scrml-js-codegen-engineer, isolation:"worktree".
**Origin:** ss66 conformance triage — these 6 codes are catalogued in §34 + §8.6/§39.12 but have
**ZERO emit sites** in `compiler/src` (independently verified by two ss66 sPA boots). This is
"make the spec'd code fire," NOT a new-code design — the §34 rows already exist; do not add or
rename codes.

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The
§"Task-Shape Routing" tells you which additional maps to consult for a compiler-source diagnostic
task. Follow it.

Map currency: maps reflect HEAD `fbb4d9fd` as of `2026-07-09`. HEAD is now `5d1f3cbf`, but the
intervening commits are PA-contract docs only (no `compiler/src` change) — the map is current for
compiler-source navigation. Treat map content as a verify-against-source hypothesis if a named file
looks moved.

In your final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps
consulted but not load-bearing."

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: <ABSOLUTE-WORKTREE-PATH>  (echo your real `pwd` and use THAT)

⚠️ The PRIOR ss66 fan-out had an isolation LEAK — a dispatched agent's `isolation:"worktree"` did
not isolate and it wrote into the shared `main` checkout. DO NOT repeat this. Enforce:

## Startup verification (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is
   under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report (the S90
   CWD-routing failure). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — clean.
4. `bun install` (worktrees don't inherit node_modules; the hook fails "cannot find package 'acorn'"
   otherwise).
5. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`; ~130 ECONNREFUSED
   browser fails without it). Use `bun run test` (chains pretest) for the full baseline.
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- Write/Edit ALWAYS via ABSOLUTE paths under WORKTREE_ROOT. NEVER a bare relative path (resolves
  against main via the additional-working-directories list). NEVER a main-rooted absolute path.
- Prefer editing via **Bash on worktree-absolute paths** (echo the path before, `git diff`/grep
  after). NEVER `cd` into the main repo; use `git -C "$WORKTREE_ROOT"` and `--cwd "$WORKTREE_ROOT"`.
- Your FIRST commit message includes your verbatith startup `pwd`: `WIP(sql-schema-checks): start at $(pwd)`.

# CRASH RECOVERY
Commit after EVERY meaningful edit (WIP commits fine; the branch is your checkpoint). Keep an
append-only `progress.md`. A clean `git status` before you report DONE is mandatory.

---

## THE TASK — wire 6 static diagnostics (they already exist in §34; make them fire)

**Rule 4 — read the SPEC section for EACH code before wiring it; the rule text is authority:**
- Schema: **§39.4** (column types / legal set) · **§39.5** (column constraints) · **§39.7**
  (Compile-Time Schema Validation — the WHEN authority; note it makes `references`-validation +
  no-dup-column + no-dup-table COMPILE-TIME) · **§39.12** (the code table).
- SQL: **§44.4** (Async Model — the E-SQL-007 rule) · **§8.6** (SQL error table).

### The seam (verified S253)
- `<schema>` is an AST node `kind:"state", stateType:"schema"`. The ONE wired schema check today is
  **E-SCHEMA-003** (placement) in `compiler/src/gauntlet-phase1-checks.js` **Check 4** (~L453-547) —
  it walks nodes for `node.kind==="state" && node.stateType==="schema"`. **Mirror that walker** for
  the new schema checks.
- **`parseSchemaBlock(body)` in `compiler/src/schema-differ.js`** already parses the schema body into
  structured tables/columns (used by `protect-analyzer.ts`). USE IT to get columns/types/constraints/
  references — do NOT re-parse the DSL by hand.
- E-SQL-007 is a DIFFERENT seam (SQL/route path, §44.4 — async-context of a `?{}` block). Locate it
  via `dock`/grep (the route-inference / SQL-context path); it is NOT a schema check.

### The 6 codes to fire
| Code | Sev | Fires when | Notes |
|---|---|---|---|
| E-SCHEMA-001 | Error | a `<schema>` block in a file whose `<program>` root has no `db=` | static; check the ancestor `<program db=>`. NB §39.12.0 v0.3 db-anchor `<program db=>` wrapper is the legal host. |
| E-SCHEMA-002 | Error | >1 `<schema>` block in the same file | static; count schema nodes per file |
| E-SCHEMA-004 | Error | a column type name not in the per-driver legal set (§39.4) | validate each parsed column's type vs the §39.4 enumerated set |
| E-SCHEMA-006 | Error | a `references` clause targets a table/column not in scope | §39.7 stmt 1: compile-time self-consistency; resolve against the parsed tables |
| W-SCHEMA-001 | Warning | a table declaration has no primary key | static; per parsed table |
| E-SQL-007 | Error | a `?{}` SQL block in a non-async context (§44.4) | static context check; §44.4 defines "non-async context" |

**Severity matters** — 4 Errors, 1 Warning (W-SCHEMA-001), 1 Error (E-SQL-007). Route warnings to the
warnings stream, not fatal.

### FLAG, don't fix (surface in your report — do NOT invent codes)
§39.7 stmt 1 also mandates compile-time **"no duplicate column names within a table, no duplicate
table names"** — but NO §34 code exists for either. Report this gap (whether to name new codes or
extend a family is a PA/design ruling). Wire ONLY the 6 named codes above.

### Conformance cases (these are now string-compile-authorable)
For EACH of the 6 codes, add a **neg** case (a minimal `.scrml` that triggers it) and confirm/add a
**pos** clean case. Mirror the landed pattern: `conformance/cases/schema/{schema-003-neg,clean-pos}/`
and `conformance/cases/sql/{bad-conn-prefix-neg,clean-pos}/` — a `case.scrml` (+ the expected
metadata those dirs use; match their exact shape). Run `bun conformance/run.ts` — all green,
including your new cases.

### Gates (NO --no-verify)
- `bun run test` (FULL suite — not just the pre-commit subset) green.
- `bun conformance/run.ts` green (base + your new cases).
- If a code's SPEC rule is ambiguous or the seam doesn't fit, STOP and report — do NOT guess.

### Report on completion
- WORKTREE_ROOT, FINAL_SHA, FILES_TOUCHED, deferred items.
- The dup-column/dup-table no-code gap (above).
- Per-code: fire site + the conformance case name.
- NOTE: `/code-review` is not invokable in-agent — the PA runs the mandatory S239 adversarial review
  on your diff before landing. Do a thorough self-review but expect the PA pass.
