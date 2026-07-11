# BRIEF — Issue #26: async scrml:auth calls not auto-awaited in server fns → auth bypass

Dispatch: P0 / SECURITY-CRITICAL. Isolated worktree; do NOT land to main (PA reviews hard + lands).

## The bug (from issue #26, author pjoliver11, compiler v0.7.1)
In a `?{}`-bearing server function, the compiler awaits the `?{}` SQL template calls but does
NOT await plain imported `async` stdlib calls (`scrml:auth` `verifyPassword` / `hashPassword`,
and any Promise-returning stdlib fn). scrml has no `async`/`await` source surface
(compiler-managed CPS), so source cannot force the await. The leaked `Promise`:
1. `const ok = verifyPassword(...)` in a predicate → `ok` is a truthy Promise → `if (!ok)` never
   fires → every password accepted (bypass).
2. `hashPassword(...)` in an INSERT → stores a stringified Promise, not the Argon2 digest.

`dist/login.server.js` shows `const ok = verifyPassword(...)` with NO `await` (the SQL on the line
above IS awaited).

## Mandate
- Reproduce the exact shape first (server fn calling verifyPassword in a predicate + hashPassword
  in an INSERT); confirm the emitted JS is missing the `await` before fixing.
- Investigate the EXISTING auto-await-for-async-stdlib mechanism (S247 crypto.hmac worked) and find
  WHY it doesn't fire for verifyPassword/hashPassword in the `?{}`-bearing server-fn path.
- Extend auto-await so a call to an imported `async`/Promise-returning stdlib fn is awaited in every
  compiler-managed context (server fns especially; check client). Do not break sync calls.
- Consider all shapes: predicate `if (!verifyPassword(...))`, bound value `const x = hashPassword(...)`,
  `${hashPassword(...)}` in a `?{}` INSERT, nested in an expression, bare statement.
- ADVERSARIAL SECURITY MATRIX (a) bypass closes (b) hash correct (c) no over-await regression
  (d) other async stdlib fns awaited consistently — with emitted-JS evidence + runtime proof.
- Regression test + conformance case if one fits. `bun conformance/run.ts` green + FULL pre-commit
  gate 0 fail. R26: recompile the issue repro on the post-fix baseline.

## Deliverables
- docs/changes/issue-26-auth-bypass-autoawait-2026-07-11/BRIEF.md + progress.md.
- Return: root cause + fire-site/fix; adversarial matrix (a-d, emitted-JS); regression test +
  conformance; oracle + full-gate; R26 result; branch tip SHA. Do NOT land.
