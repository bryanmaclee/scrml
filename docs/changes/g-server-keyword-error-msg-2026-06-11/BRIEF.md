# BRIEF — g-server-keyword-error-msg (S181)

Change-id: `g-server-keyword-error-msg-2026-06-11`

# Task: reword compiler user-facing strings that still teach the deprecated `server function` form

Background: the S180 server-keyword-eliminate arc removed `server function` from the scrml canon (examples + docs) — the modifier is deprecated; the server boundary is now INFERRED (§12.2 Triggers 1-3/5/6/7/8). But the compiler's OWN user-facing strings still TEACH the deprecated form — a "compiler suggests a now-eliminated form" inconsistency. Reword them to `function` (or `function`/`fn` where the pure-server form is relevant). This is canon-consistency polish, NOT a correctness fix. NO codegen change.

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). The §"Task-Shape Routing" tells you which additional maps to consult — this is a compiler-source string/message + SPEC-text edit (task-shape: compiler-source bug fix / spec-text edit).

Map currency: maps reflect HEAD `d70f6bd8` as of 2026-06-10, AND a maps refresh is running CONCURRENTLY (not yet committed) — so treat map content as a starting hypothesis to verify via grep/Read against current source, not ground truth. Your worktree base is HEAD `b81fe03f`.

Feedback: in your final report include "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing".

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree is assigned by the harness. Before ANY other tool call:

1. Run `pwd` via Bash. It MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. Run `git rev-parse --show-toplevel` — MUST equal WORKTREE_ROOT.
3. Run `git merge main --no-edit` (your base may be a session-start snapshot; sync to current main first). Then `git status --short` — confirm clean post-merge.
4. Run `bun install` (worktrees do NOT inherit node_modules; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
5. Run `bun run pretest` (populates `samples/compilation-tests/dist/`; gitignored, empty in a fresh worktree).

## Path discipline (EVERY edit)
- This repo has had a path-leak class (S99/S126): Edit/Write tool calls occasionally land in MAIN's checkout instead of the worktree. To sidestep it BY CONSTRUCTION, apply ALL file edits via **Bash** (`perl -i` / `python3` / heredoc / `sed`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools. Echo the target path before each write; re-verify with `git diff` / `grep` after.
- NEVER `cd` into the main repo (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"` for bun, and worktree-absolute paths exclusively.
- Your FIRST commit message MUST include the verbatim `pwd` output: `WIP(server-keyword-error-msg): start at <pwd>`.

# COMMIT DISCIPLINE (crash-recovery)
- After EVERY edit: `git diff <file>` to verify; `git add <file>`; commit IMMEDIATELY. Don't batch.
- Before reporting DONE: `git status` MUST be clean. "work in worktree, no commits" is NOT an acceptable terminal report.
- Update `docs/changes/g-server-keyword-error-msg-2026-06-11/progress.md` after each step (append-only, timestamped).
- Do NOT use `--no-verify`. If the pre-commit hook fails, diagnose the real cause.

# SCOPE (user-FACING strings only — NOT code comments)

1. `compiler/src/type-system.ts` — the message string at/near line 8502 ("assign from a server function") + any sibling user-facing error/suggestion/`fix:`-hint strings in `compiler/src` that say "server function". Grep `compiler/src` for `server function` but EDIT ONLY strings SURFACED TO THE ADOPTER (error messages, lint suggestions, fix hints). The gap notes the ~71 raw mentions are MOSTLY code comments — leave comments untouched.

2. `compiler/SPEC.md` — the error-output DEPICTIONS that show the compiler emitting "server function" in sample diagnostics: near `saveOrder` (~line 3297), `logEdit` (~28690), and the `getUser` prose (~14023). Reword the DEPICTED compiler output to match the new canon. Do NOT touch SPEC normative prose that legitimately discusses the deprecated `server function` MODIFIER in its deprecation context (§34 `W-DEPRECATED-SERVER-MODIFIER`, §12.2, §13.6/§37 SSE) — only the depicted error-OUTPUT strings.

## Reword rule
- A bare "server function" in a suggestion/error string → "function" (the keyword is gone; the server boundary is inferred).
- Where the message is specifically about a PURE server helper, "function/`fn`" is acceptable.
- Preserve `server fn` mentions verbatim (still canonical).
- Preserve `server function*` SSE mentions verbatim (deferred per `g-sse-server-keyword`, still valid).

# VERIFY
- After edits: grep `compiler/src` for `server function` in STRING literals → confirm only legitimate deprecation-context mentions remain.
- Add/extend a unit test asserting the reworded diagnostic(s) no longer emit "server function" (where a test harness for that message exists; if not, add a minimal one).
- `bun --cwd "$WORKTREE_ROOT" test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` green (0 fail).
- R26 not required (message-string only, no codegen path) — but confirm the pre-commit subset is green.

# REPORT
WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, the exact strings changed (before→after for each), test result, maps-consulted note. List any "server function" occurrences you deliberately LEFT and why.
