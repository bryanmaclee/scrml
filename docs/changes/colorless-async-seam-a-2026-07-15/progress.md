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

## 2026-07-18 — fixes landed
- Confirmed BOTH leaks pre-fix (finding1: `function _scrml_f_3(x = safeCallAsync(...))` + bare `x.ok`, exit 0, zero errors; finding2: `export function outer` sync with bare `const ok = h(o)`, exit 0, zero errors).
- Fix A: threaded `fn.params`+`fn.span` into `collectNonAwaitableAsyncCalls` (5th/6th args) + a param-default text-scan (extractCalleeNames) → E-ASYNC-STDLIB-IN-SYNC-CALLBACK. Updated all 3 callers (emit-server/emit-library/emit-functions). Corrected the false `_clientSyncPeerCalls`-drains-param-default comment.
- Fix B: `collectAliasedAsyncCalls` now collects EVERY `X=<ident>` decl (Pass 1) then chain-follows to an async terminal (Pass 1b, cycle-safe `visited`). Single-level finding6 still fires; multi-hop finding2 now fires (resolves `h -> middle`).
- Committed source fixes @ 4ad67ed7 (full pre-commit gate passed; foreground timed out at 5m but commit finalized in bg — background-commit-race).
- Verified: finding1 fail-closed (`safeCallAsync(…)`), async-peer param default fail-closed (`middle(…)`), library param default fail-closed; finding2 2-hop + 3-hop fail-closed; sync-terminal multi-hop NOT flagged (no over-coloring); mutual-alias forward-ref cycle terminates.
- R26 no-regression: giti037 / transitive / crossmodule all still emit `async`+`await` correctly.
- Added §12 (4 tests) + §13 (4 tests) to colorless-async-seam-a.test.js → 22/22 pass. Full unit suite 16496 pass / 20 skip / 0 fail.

## note (write-on-fatal-error is pre-existing)
The CLI writes the well-formed-but-would-leak artifact to disk even on a FAILED build (exit 1) — verified this is PRE-EXISTING (finding6, an existing fail-closed case, behaves identically). Fail-close is enforced at the diagnostic/build-failure level (exit 1 + fatal E-ASYNC-STDLIB-IN-SYNC-CALLBACK); a failed build never ships. The test-harness (compileScrml write:false) proves the leak is diagnosed, not silently accepted.

## done
- All four source files + tests committed; branch tip advanced. Report returned.
