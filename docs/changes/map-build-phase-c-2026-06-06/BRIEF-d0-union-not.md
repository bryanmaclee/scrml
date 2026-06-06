# MAP BUILD — PHASE C — DISPATCH D0: §42.3.1 union-`not` normalization

(Verbatim archive of the dispatch prompt, per S136.)

---

# MAPS — REQUIRED FIRST READ

Before any other context, read `.claude/maps/primary.map.md` in full (~100 lines). Its "Task-Shape Routing" section names the additional maps for a compiler-source **type-system** change — follow it.

Map currency: maps reflect HEAD `4c8063b6` as of 2026-06-06 (the §59 SPEC landing). Live HEAD `40aa63ca`+ is docs/maps-only ahead — **source is current**, treat map content as a verified starting point.

Feedback in your final report: `Maps consulted: [list]; load-bearing finding: <one sentence>` OR `Maps consulted but not load-bearing`.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree is assigned by the harness. Do this BEFORE any other tool call:

1. `pwd` (Bash). It MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 wrong-repo allocation. Save the output as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git status --short` — confirm clean.
4. `bun install` (worktrees do NOT inherit node_modules; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
5. `bun run pretest` (populates `samples/compilation-tests/dist/` for browser tests; gitignored — empty in a fresh worktree → ~130 ECONNREFUSED failures otherwise). Use `bun run test` (chains pretest) for full-suite gates, NOT bare `bun test`.

If ANY check fails: do NOT proceed; report the mismatch and exit.

**Path discipline (S99/S126 — there have been repeated leak incidents):**
- Apply ALL file edits via **Bash** (`perl -0pi`/`python`/heredoc/`cp`) on **worktree-absolute paths** that include the `.claude/worktrees/agent-<id>/` segment — NOT the Edit/Write tools. Echo the target path before each write; `git diff`/`grep` after to verify.
- **NEVER `cd` into the main repo (or anywhere).** Use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"` (for bun), and worktree-absolute paths exclusively. A `cd` into main leaks edits + `bun add` into main.
- If an intake path looks like `/home/.../scrmlTS/compiler/...` (main), translate it to `$WORKTREE_ROOT/compiler/...` before writing.
- Your FIRST commit message MUST include the verbatim `pwd` output: `WIP(d0): start at <pwd>`.

---

# TASK — implement SPEC §42.3.1 union-`not` normalization

This is an **already-landed** normative spec statement (NOT spec-ahead). It is the cleanest first piece of the value-native-map build (Phase c) and is **independent of the map type itself** — the map read-type (§59.6 `@m[k] → ValT | not`) depends on it, but this dispatch touches only the union-normalization in the type system.

## Read the spec FIRST (Rule 4)
Read `compiler/SPEC.md` §42.3.1 IN FULL (line ~21130-21142; grep `42.3.1`). The normative statement: *"A union type SHALL be normalized so that duplicate `not` members collapse: `(T | not) | not` is `T | not`. There is exactly one `not` member in a normalized optional union; re-optionalizing an already-optional type is idempotent."*

## Implementation
- `tUnion(members)` at `compiler/src/type-system.ts:~593` does ZERO flattening/dedup today (confirmed: no nested-union flatten exists anywhere in the typer). Add a `normalizeUnion(members)` helper that:
  1. **FLATTENS** nested-union members — a member whose `.kind === "union"` is spliced in (so `(V|not)|not`'s outer union absorbs the inner `V|not`).
  2. **DEDUPS `not`** — collapse multiple `{kind:"not"}` members to exactly one.
  3. Returns the normalized member list. Wire it into `tUnion` so every constructed union is normalized.
- Match the existing `tUnion` contract for the degenerate case: if normalization collapses to a single member, return whatever `tUnion` returns for a 1-member input today (bare type vs 1-member union) — preserve current behavior, don't change it.
- The `resolveTypeExpr` union split (`type-system.ts:~1837-1843`) already feeds `members` into `tUnion`; once `tUnion` normalizes, both the `string | not | not` text annotation and programmatically-constructed nested unions collapse.

## SCOPE — dedup-`not`-ONLY (hard constraint)
The ONLY two transformations are (a) flatten nested unions and (b) collapse duplicate `not`. **Do NOT** reorder non-`not` members, dedup non-`not` members, or canonicalize member order. This is load-bearing: it protects the EXACTLY-`[T, not]` recognizers (canary below). If you find yourself wanting broader union canonicalization, STOP — that is out of scope for this dispatch.

## BLAST-RADIUS CANARY (mandatory — the survey's #1 risk)
The schemaFor (§41.15.8) and tableFor (§41.16.6) nullable-union recognizers match an **exactly-2-member** `{kind:"union", members:[T, {kind:"not"}]}` by hand — references near `type-system.ts:13201 / 13217 / 13898 / 13902`. Your normalization MUST NOT break them. Required:
- A regression test proving `(string | not) | not` (both the text annotation `string | not | not` AND a programmatically nested union) resolves to a **2-member** `[string, not]` union that schemaFor + tableFor STILL recognize as nullable (recognizer fires; column is nullable).
- A test that a normal `[T, not]` 2-member union is **unchanged** by normalization (round-trips identically).
- Grep every `.members` / `members:[` consumer that assumes a specific arity or order; confirm none break. Report what you found.

## VERIFICATION (before DONE)
1. Full `bun run test` — baseline **23,091 pass / 0 fail / 220 skip / 1 todo / 916 files**. ZERO regressions. Report exact counts.
2. The new canary tests pass.
3. Empirical smoke: grep `samples/compilation-tests/` + `examples/` for server fns / cells typed `| not` (e.g. `-> User | not`, `: T | not`); recompile 2 such sources via `bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile <file>`; confirm NO new errors + emitted JS `node --check` clean. If none exist, say so.
4. within-node parity: if your change could shift it, run the within-node test and confirm 1005/0 unchanged (a pure union-normalization change should not, but verify).

## COMMIT DISCIPLINE (S83 two-sided)
- Commit per logical unit (the `normalizeUnion` impl; the canary tests). After EVERY edit: `git diff` the file, `git add`, commit IMMEDIATELY — don't batch. WIP commits expected (crash-recovery).
- Before reporting DONE: `git status` MUST be clean. "work in worktree, no commits" is NOT acceptable.
- Update `docs/changes/map-build-phase-c-2026-06-06/progress.md` (worktree-absolute path) after each step — append-only, timestamped: what's done / what's next / blockers.

## REPORT (your final message — it is a tool result, return raw structured text)
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` · full-suite counts · canary results · the `.members`-consumer grep findings · empirical-smoke results · deferred items · maps feedback.
