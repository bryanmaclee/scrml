# i29e session-primitive security fixes — progress log (S266)

Base branch: `feat/i29e-session-establishment` tip `7f13812b`
Work branch: `i29e-secfix-s266`
Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9ff335a98eb2ffcb

## Log (append-only)

- START: worktree verified, branch checked out at 7f13812b, bun install + pretest OK.
- Read primary.map.md. Routing: codegen/pipeline -> domain.map.md + error.map.md. §20.5 session code is BRANCH-ONLY, must verify against actual branch source.
- B1 DONE (commit 60672b32): anchored all 5 cookie-name parses in emit-server.ts (lines ~1715/1804/1934/2000/2007) to /(?:^|;\s*)<name>=([^;]+)/. Note: inside lines.push("...") double-quoted TS strings, `\s` must be written `\\s` to emit a literal `\s`. Validated regex against all 6 injection vectors (bun -e) -> ALL PASS. Full pre-commit suite passed (hook takes 3-5min; use timeout 300000+).
- NOTE ON HOOK: pre-commit runs FULL unit+integration+conformance suite (~3-5min in this worktree). Docs-only commits skip it. Pre-existing noise in output: corpus-bridge map .insert TypeError (pre-existing, not mine).
