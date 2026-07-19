# progress — colorless-async-seam-a S239 fix-round (param-default + multi-hop alias)

Append-only, timestamped. Recovery anchor alongside per-unit WIP commits.

## 2026-07-18 — startup
- Worktree /home/bryan-maclee/scrmlMaster/scrml-phase1-async on feat/colorless-async-seam-a, HEAD 19cba92f, clean (only untracked = the archived BRIEF).
- Read primary.map.md (S265 CSS-window stamp; NOT load-bearing for async coloring — loci come from the brief).
- Traced loci in source:
  - `collectNonAwaitableAsyncCalls` (emit-library-shared.ts:318) walks `fnBody` only via `walk(fnBody,false)` — never `fn.params`. Fix A target.
  - `collectAliasedAsyncCalls` (emit-library-shared.ts:234) is single-level (Pass 1 records `X=<rhs>` only when `isAsyncName(rhs)`), so a re-alias `h=g` is missed. Fix B target.
  - `paramSignature` (utils.ts:165) splices `p.defaultValue` (RAW STRING) verbatim — no structured expr for function-decl params, so the param-default scan must be TEXT-based via `extractCalleeNames`.
  - Both collectors are shared across emit-server.ts / emit-library.ts / emit-functions.ts (3 callers each). Fixing at the shared collector closes the leak on all three boundaries (no-silent-leak is absolute; server param-defaults leak identically).
  - emit-functions.ts:1407-1414 comment claims `_clientSyncPeerCalls` drains a `function f(x=middle())` param default — FALSE per brief; must correct/remove.

## next
- Write repros, confirm current leak, implement Fix A + Fix B, add tests.
