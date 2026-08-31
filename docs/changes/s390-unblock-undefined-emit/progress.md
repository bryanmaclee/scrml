# S390 — unblock main: `undefined` keyword emitted into client JS

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2f419d982b12f1d5`
Branch: `worktree-agent-a2f419d982b12f1d5`
Base: `1288ce67` (= `origin/main` at dispatch)

## Steps

1. Startup verification — `pwd` / `git rev-parse --show-toplevel` agree; tree clean at `1288ce67`; `bun install` (218 packages). No branch to fetch (defect lives on `origin/main`).
2. Archived the dispatch brief verbatim to `BRIEF.md`; committed `f36cecba`.
   The pre-commit hook short-circuits on docs-only staged changes, so this commit was possible on a red main.
3. **Gate 1 BEFORE** — `bun test compiler/tests/integration/trucking-dispatch-smoke-integration.test.js`
   → **11 pass / 2 fail**. Failures:
   - `aggregate diagnostic count matches baseline` — observed 433, expected 418 (15 extra).
   - `no UNEXPECTED diagnostic codes fire` — unexpected set `["W-CG-UNDEFINED-INTERPOLATION"]`.
   Reproduces the briefed defect exactly.
4. Read the sanctioned idiom the file documents at `emit-channel.ts:891-894` — `void 0`,
   with the comment "evaluates to the JS undefined value without using the keyword literal
   (W-CG-UNDEFINED-INTERPOLATION-safe; standards-conforming idiom)". Reused it; no new spelling.
5. Read `lint-undefined-interpolation.ts` to confirm the matcher scans **final compiled client+server JS**
   for the bare keyword. `void 0` contains no `undefined` token, so the guard cannot fire on it.
6. **Gate 3** — `git show d3145620 -- compiler/src | grep -n 'undefined'` → 5 hits.
   - diff line 65 (`emit-channel.ts:756`) — inside a `lines.push(\`...\`)` template literal = **emitted output**. THE defect.
   - diff lines 62/63 and 90 — `//` TypeScript comments in compiler-internal code; not emitted, not scanned.
   - diff lines 14/22 — commit-message prose.
   **756 was the only emitted-output site.** One token, as briefed.
7. Applied the fix: `s === undefined` → `s === void 0` (line 756 only). Nothing else touched.
   No `.json` baseline edited — the regression is fixed at the emitter, not masked.
8. **Gate 1 AFTER** → **13 pass / 0 fail**.
9. `compiler/tests/unit/channel-sync-echo-dedup.test.js` (#782's own regression test) → **10 pass / 0 fail**.
   Load-bearing: that suite `new Function(...)`-executes the REAL emitted `clientJs` (line 117), and case
   "an undefined-serializing cell still dedups" drives the exact `JSON.stringify` → undefined path.
   So the change is proven by execution, not merely by the lint going quiet.
10. **Gate 2** — full pre-commit scope (`unit` + `integration` + `conformance` + `compiler/tests/*.test.js --bail`)
    ran green inside the commit hook: **29360 pass / 86 skip / 1 todo / 0 fail**, 1291 files, 279.72s.
    Post-fix fail set is EMPTY = the pre-existing set minus exactly the two trucking-dispatch failures.
11. Fix committed `509271e6` (1 file, 1 insertion, 1 deletion — verified non-empty via `git show --stat`).
12. **Gate 4** — `bun scripts/facts.ts --write` → both generated blocks "already current".
    A one-token emitter change alters no FACTS metric, so there is nothing to commit for FACTS.

## Snags

- First `git commit -F` attempt died with `error: a NUL byte in commit log message not allowed`
  **after** the hook had already run green. The brief renders the emitted sentinel (source form `"\\u0000u"`) as a
  literal NUL, and quoting the helper verbatim carried those bytes into the message. Stripped with
  `tr -d '\000'` and recommitted. The committed source is unaffected — `emit-channel.ts` holds the
  escape sequence `\\u0000`, not a raw NUL.
- The recommit's foreground call hit the 10m tool timeout during the **post-commit** hook; the commit
  object itself had already landed. Confirmed by `git log` + `git show --stat`, tree clean.

## Out of scope, surfaced not acted on

- The merge `gate` job runs unit+conformance only while the local pre-commit hook also runs integration.
  That asymmetry is why #782 merged green and still bricked every local commit. Real finding; not this task.
