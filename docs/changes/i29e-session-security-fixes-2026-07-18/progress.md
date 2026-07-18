# i29e session-primitive security fixes — progress log (S266)

Base branch: `feat/i29e-session-establishment` tip `7f13812b`
Work branch: `i29e-secfix-s266`
Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9ff335a98eb2ffcb

## Log (append-only)

- START: worktree verified, branch checked out at 7f13812b, bun install + pretest OK.
- Read primary.map.md. Routing: codegen/pipeline -> domain.map.md + error.map.md. §20.5 session code is BRANCH-ONLY, must verify against actual branch source.
- B1 DONE (commit 60672b32): anchored all 5 cookie-name parses in emit-server.ts (lines ~1715/1804/1934/2000/2007) to /(?:^|;\s*)<name>=([^;]+)/. Note: inside lines.push("...") double-quoted TS strings, `\s` must be written `\\s` to emit a literal `\s`. Validated regex against all 6 injection vectors (bun -e) -> ALL PASS. Full pre-commit suite passed (hook takes 3-5min; use timeout 300000+).
- NOTE ON HOOK: pre-commit runs FULL unit+integration+conformance suite (~3-5min in this worktree). Docs-only commits skip it. Pre-existing noise in output: corpus-bridge map .insert TypeError (pre-existing, not mine).
- B2 DONE (commit 2e43c50d): emit-expr.ts (_sessionShadowedInFile flag + setter; E-SESSION-VALUE module sink reset/drain; emitMember drop !optional + combined shadow guard; emitIndex NEW session case; emitCall drop callee-!optional + combined shadow guard; emitIdent B2.4 bare-value-use -> E-SESSION-VALUE), emit-server.ts (astSessionMemberMatch += index; reset/drain sink), log-loc.ts (fileDeclaresFileScopeBinding non-descending walk), index.ts (wire setSessionShadowedInFile at both runCG loop sites), SPEC.md (§20.5 normative statement + §34 E-SESSION-VALUE row). Probe: all 5 shapes fixed (B2.1 lowered, B2.2 lowered, B2.3 write lowered+store, B2.4 E-SESSION-VALUE clean error, B2.5 honors local). Full suite 20712 pass 0 fail.
- B3 DONE (commit 836923e0): role gated on userId!=null in read-middleware role: line + write-ctx get role(). Coupled: updated server-load-authority impl-gap-#2 assertion. Full suite 20712 pass 0 fail.
- KEY FINDING (maps): §20.5 session code is BRANCH-ONLY (confirmed absent from map snapshot). declaredNames (per-handler) DOES accumulate handler-local let/const (emit-logic 1760/1883), so ctx.declaredNames.has("session") handles handler-local shadows; only FILE-SCOPE needed the new flag. ctx.errors is NOT threaded to server-fn bodies via _makeExprCtx, so B2.4 uses a module-level sink (mirrors emit-server _foreignCrossingErrors narrow-sink precedent).
