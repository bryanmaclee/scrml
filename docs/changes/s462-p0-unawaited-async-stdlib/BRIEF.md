You are a dispatched dev agent on the scrml repo (impl#1, compiler/src and stdlib). PA session S462. Priority: P0 SECURITY. Two pre-existing auth bypasses on main. In both, an async stdlib function is called without await, so a Promise (which is truthy) stands in for the result.

FIRST:
1. Run `git fetch origin && git merge origin/main`. Main is at or after d6820a607, which includes #1393, the stdlib structs.
2. Archive this prompt verbatim to docs/changes/s462-p0-unawaited-async-stdlib/BRIEF.md, then commit it with a progress.md.

Commit rules:
- Commit incrementally.
- Code and its tests go in one commit.
- Never use --no-verify and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15. Use timeout 300000 and commit in the foreground.

S1: an ALIASED async stdlib import is never awaited.
- Repro: `import { verifyPassword as vp, hashPassword } from "scrml:auth"` in a server function, then `const ok = vp("wrong", hash)`. The route returns a Promise (truthy), so a WRONG PASSWORD IS ACCEPTED. `get as httpGet` from scrml:http is not awaited either.
- Cause: buildCalleeImportMap (compiler/src/codegen/scheduling.ts ~:68-72) maps the local alias to the module. isPromiseReturningStdlibFn (compiler/src/module-resolver.js ~:1889) then looks the ALIAS up as if it were an export name.
- Fix: carry the imported name (specifiers[].imported) through to the lookup.
- Then audit EVERY other consumer that keys stdlib facts by local name: async-ness, server-only-ness, type seeding, E-IMPORT-004, erasure, client-chunk routing. Fix each the same way.
- Re-exports: a local `.scrml` file that does `export { verifyPassword as vp } from "scrml:auth"`, imported elsewhere. Does async-ness follow it? Fix it if not.

S2: async shims declared SYNC in the stdlib `.scrml` sources, so they are never awaited:
- verifyJwtJwks (stdlib/auth/jwt.scrml:234). Repro: `if (verifyJwtJwks("garbage", url)) return "ACCEPTED"` returns ACCEPTED, a JWT BYPASS.
- resetPassword (stdlib/auth/flows.scrml:209)
- hmac (stdlib/crypto/index.scrml:135)
- the request* flows (requestMagicLink, requestEmailVerification, requestPasswordReset): sync in `.scrml`, Promise from the shim
Fix: declare them async in `.scrml`.
- Write a check: for every stdlib export, compare the `.scrml` isAsync with whether the shim function is an AsyncFunction or returns a Promise. Fix every mismatch.
- Extend the stdlib shim parity test (the one #1394 added, which pins names, variants and payload fields) to pin async-ness too, so this cannot regress.

DEFENCE IN DEPTH (propose; implement if cheap): when a value the compiler believes is sync turns out to be a Promise at a boolean test site in server code (`if`, `!`, `&&`, `||`, ternary), it is always a bug. Consider whether codegen or the runtime can fail CLOSED there. Report your assessment; do not implement anything broad without saying so.

TESTS: execute each repro end to end. Drive the real server route under bun with bun:sqlite, and use a local mock HTTP server for JWKS and http. Each must FAIL on base and PASS after. Cover:
- an aliased verifyPassword with a wrong password (rejected) and the right one (accepted)
- an aliased http get (has .status)
- verifyJwtJwks with garbage (rejected)
- resetPassword, hmac and the request* flows (results awaited)

SPEC: if the SPEC states how stdlib async calls are awaited (search SPEC-INDEX for await / async / §13 / §21), quote it in your commits.

GATES, all of them:
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (its "PARSER DISAGREES" refusal is a known flake; re-run it)
- `s34-census --check-new`
- host-global-scan --check
- facts / spec-index / bootstrap-conformance / severity --check
- snippet-gate and corpus-compile-floor
- a corpus differential over samples, examples, stdlib, conformance, gauntlet-r25 and the adopters (../giti, ../flogence; read-only), with any newly awaited call sites listed

Resolve generated-doc conflicts by hunk, then regenerate, and restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, per-item results, the full list of async mismatches found and fixed, the defence-in-depth assessment, and the gates table. Do NOT push.
