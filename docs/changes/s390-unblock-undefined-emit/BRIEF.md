URGENT, SMALL, SCOPED. `origin/main` currently fails its own pre-commit gate, which blocks EVERY local code commit in the repo for every contributor. One token.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST: `pwd`. MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP, write nothing.
2. `git rev-parse --show-toplevel` equals it; tree clean. Your worktree is cut from `origin/main`, which is where the defect lives — no branch to fetch.
3. `bun install`.
4. Worktree-absolute paths only. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`.
5. **NEVER `git stash`** — `refs/stash` is shared across worktrees. File COPY only.
6. **Never `pkill -f`/`killall`** on a command string. Kill by PID captured at launch.
7. First commit: `WIP: start at $(pwd)`.

# THE DEFECT — I confirmed all of this by execution on `origin/main` @ 1288ce67

`compiler/src/codegen/emit-channel.ts:756` emits, into CLIENT output:

```js
const _scrml_lk = (v) => { let s; try { s = JSON.stringify(v); } catch (_e) { return " e"; } return s === undefined ? " u" : s; };
```

The bare `undefined` KEYWORD in emitted JS is forbidden repo-wide by the `W-CG-UNDEFINED-INTERPOLATION` regression guard. Landed by `d3145620` (PR #782).

**Measured, not assumed:**
- `bun test compiler/tests/integration/trucking-dispatch-smoke-integration.test.js` on `origin/main` → **11 pass / 2 fail**, `W-CG-UNDEFINED-INTERPOLATION` in the unexpected-codes set.
- The pre-commit hook runs `unit,integration,conformance --bail`, so **main cannot take a local code commit today.**
- The merge `gate` job is unit+conformance ONLY, which is why #782 merged green. The local hook is stricter than the merge gate — that gap is a real finding, but NOT your task.

# THE FIX — use the convention this same file already documents

Do NOT invent a spelling. **`emit-channel.ts` itself, ~line 891-894**, documents the sanctioned idiom for exactly this problem — a comment explaining it "evaluates to the JS undefined value without using the keyword literal (W-CG-UNDEFINED-INTERPOLATION-safe; standards-conforming idiom)". **Read that site and match it.** Other precedents exist at `emit-machines.ts:256`, `emit-lift.js:410`, `runtime-template.js:2367`, `atom-emitter.ts:171`, `emit-machine-property-tests.ts:417` — the convention is well established; a seventh spelling would be worse than reusing the sixth.

The replacement MUST be semantically identical for a declared `let s` that is either assigned a string or left unassigned. State in your report which idiom you chose and why it matches the file's existing one.

# SCOPE — hold this line

- **ONLY** the emitted `undefined` keyword at `emit-channel.ts:756`. Nothing else in that file, nothing in #782's logic. The echo-dedup fix #782 landed is CORRECT and stays.
- Do NOT edit the trucking-dispatch baseline to make the test pass. That baseline records a class driven to zero at S93; editing it masks a live regression instead of fixing it. **If you find yourself wanting to touch a `.json` baseline, stop and report.**
- Do NOT touch `compiler/src/commands/diagnostic-format.js` or `path-canonical.js` — a sibling round owns those and would collide.

# GATES

1. `bun test compiler/tests/integration/trucking-dispatch-smoke-integration.test.js` → **13 pass / 0 fail**. That is the bite proof: it fails before your change and passes after. Run it BOTH ways and report both numbers.
2. Full pre-commit scope (`unit`+`integration`+`conformance`). Never `--no-verify`. Report the fail-name set and confirm it is the pre-existing set minus these two.
3. Grep the emitted-output surface for any OTHER bare `undefined` keyword #782 introduced — `git show d3145620 -- compiler/src | grep -n 'undefined'` — and report whether 756 is the only one. If there are more, fix them the same way; if you are unsure whether a hit is in emitted output vs. compiler-internal code, report rather than guess.
4. `docs/FACTS.md`: run `bun scripts/facts.ts --write` AFTER your last content commit and commit it — the pre-push hook blocks on a stale FACTS, and regenerating early then editing source again is the exact failure it catches.

# PROCESS

- Write this brief VERBATIM to `docs/changes/s390-unblock-undefined-emit/BRIEF.md`; commit early.
- Commit after each meaningful unit; append `progress.md`.
- Report `WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, files touched, both gate-1 numbers, the full-suite fail sets, and whether 756 was the only site.
- This is deliberately a one-token change. If it turns out NOT to be one token — if the guard is firing for a second reason — STOP and report rather than widening.
