CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: path-leak incidents on record >0 — be careful)
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- . If not: STOP, report, exit. Call this WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT; tree clean.
3. Your worktree was cut from origin/main, NOT from the work branch. Run: `git -C "$WORKTREE_ROOT" fetch origin wip/s449-scrml-fix-s66-twins && git -C "$WORKTREE_ROOT" reset --hard FETCH_HEAD`. Verify HEAD == 8d982ee982324d39adfaca5592ca7752ff39388e.
4. `bun install` from WORKTREE_ROOT. Set TMPDIR per command to ~/.cache/scrml-agent-tmp/s451-fix-r3/ (never inside a repo).
5. Every Edit/Write uses an absolute path under WORKTREE_ROOT. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml. Never `git stash` (shared across worktrees). Never bare `pkill -f`/`killall`. First commit message: `WIP(s449-fix-r3): start at <pwd>`.
6. Commit after each meaningful change (WIP fine); append timestamped lines to docs/changes/s449-scrml-fix-s66-twins/progress.md. Archive this whole prompt verbatim as docs/changes/s449-scrml-fix-s66-twins/BRIEF-r3.md in your first commit. Push the branch when done: `git push origin HEAD:wip/s449-scrml-fix-s66-twins` (fast-forward only; never force).

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp 47c863556, 2026-10-03; branch has landings since — treat as hypothesis). Report whether the map was load-bearing.

CONTEXT: `scrml fix` (compiler/src/commands/fix.js + fix-s66.js) is an adopter codemod. Its `--s66` path rewrites legacy cells into §66 openers: a cell that is never written becomes locked (no `let`), and an untyped cell may get `:int`. Both decisions are SAFE only if the tool can prove them; anything it cannot classify must fall CLOSED (keep `let`; don't narrow the type; report). Read docs/changes/s449-scrml-fix-s66-twins/progress.md first. An S239 re-review of 8d982ee98 returned FIX with two HIGHs, both PA-reproduced by execution:

HIGH 1 — imports in unrecognized positions are invisible (fail-open lock). `importSpecifiers` treats `import` as a statement only at line start or after `;` `{` `${`. Repro (PA-verified):
  bump.scrml:  ${ export const Bump = <button onclick=${@count = @count + 1}>+</button> }
  app.scrml:   <program> / ${ /* ui */ import { Bump } from "./bump.scrml" } / <count> = 0 / <Bump/> / <p>${@count}</p> / </program>
  `scrml fix app.scrml --s66` emits `+<count:number=0/>` (locked) though bump.scrml writes it and impl#1 compiles it. Same after `const k = 1 import …`, after `)`, `,`, `}`.
  FIX DIRECTION (required shape): fail-closed by construction — any `\bimport\b` token outside comments/strings whose specifier is not tied to a successfully read import counts as UNEXTRACTED (→ every cell `let`). Do NOT widen the list of statement-start positions; invert it. Accept the over-conservative false positives (prose `import is a word`) — note them. Also count `export type { X } from` as read-or-unextracted.

HIGH 2 — `:int` from a name-global raw-text regex. `intCells` is a regex over all project source keyed by name. Repro (PA-verified):
  <program> / <k> = 0.5 / // was <k>: int = 1 before / <m> = 2 / const <d>: int = @m * 2 / ${ function f() { @m = @k } } / <button onclick=f()>go</button> / <p>${@m} ${@d}</p> / </program>
  emits `+let <m:int=2/>` — but @m is written 0.5. Without the comment it correctly reports. Also triggers via a same-named `<k>: int` cell in ANOTHER file.
  FIX DIRECTION: resolve int-ness PER CELL from impl#1's AST — the declaring file's own declaration of that cell (resolved through imports when cross-file), never a regex, never name-global. Unresolvable → not int → reported.
  Also close LOW: destructuring writes (`[@m] = [1.5]`, `({m:@m}=obj)`) must make intWriteVerdict non-int (fail closed) even though impl#1 rejects them today.

REQUIRED: tests for every repro above plus the variants (after `)`, `,`, `}`, comment-in-braces, other-file same-name cell, destructuring), in compiler/tests/commands/fix-s66.test.js. Run that file + the pre-commit subset must pass at commit. Re-run the default CLI on examples/*.scrml copies (under ~/.cache/scrml-agent-tmp/s451-fix-r3/) and compile original vs fixed with `bun compiler/bin/scrml.js compile` — no new errors. Re-run `scripts/bootstrap-conformance.ts` and report the counter (was PASS 76 / 62 non-vacuous / 138 graded) — explain any change.

Do NOT mark done without executing both repros post-fix and pasting the observed output. Final report: worktree path, final SHA (pushed), files touched, test counts, repro outputs, counter, whether each fix is by-construction or per-position, deferred items. Under ~50 lines.
