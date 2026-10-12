You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. P0 SECURITY: SQL result over-sharing.

FIRST:
1. Run `git fetch origin && git merge origin/main`. Main must be at or after 1c1e9eee5.
2. Archive this prompt verbatim to docs/changes/s462-p0-sql-chain-truncation/BRIEF.md, and commit it together with a progress.md.
3. Commit rules:
   - Commit incrementally. Code and its test go in one commit.
   - Never use --no-verify, and never disable hooks.
   - Gate each commit on free memory above 6GB and a load average below 15.
   - Commit in the foreground with timeout 600000.
   - Use your own scratch subdir. Never use the shared scratchpad root or scratchpad/base.

BUG (reported by the CPS P0 dev; reproduce it first): in `?{SELECT name, pw FROM users WHERE …}.get().name`, the parser records `.name` as a chained call, and the lowering honours only the FIRST call. So the expression evaluates to the WHOLE ROW. `return ?{SELECT name, pw…}.get().name` from a plain server function therefore sends the password hash to the client.

TASK:
1. Reproduce it with a real route (bun:sqlite), and check the raw response body.
2. Find the root cause in the `?{}` SQL expression parse and lowering. Find every chained form that is dropped or misapplied, for example:
   - `.get().field`
   - `.all().length`
   - `.all().map(…)`
   - `.get()?.field`
   - `.get().field.sub`
   - `.run().changes`
   - a method call after `.all()`
   - an index `[0]` after `.all()`
3. Read the SPEC on SQL blocks and their result methods (§8 / §44; find them via SPEC-INDEX) and quote it.
4. Fix it so the full chain is applied, as in JS semantics, after the SQL call.
5. Check that `protect=` still strips protected columns (§14.8.9) wherever the whole row does leave. With the chain applied, only `.name` should leave.
6. Audit for other places where a parsed chain is truncated after a special form (`?{}`, `^{}`, `match`, `<request>`, etc.).

TESTS:
- End-to-end route tests asserting the response body contains ONLY the selected field. Each must fail on base.
- Unit tests for every chained form above.

CORPUS: run an emit differential over samples, examples, conformance, stdlib, gauntlet-r25 and the adopters ../giti and ../flogence (read-only). List every site whose emit changes. Those sites were previously returning more data than written, or computing wrong values. Execute a sample of them before and after.

GATES (all):
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (re-run it on the PARSER DISAGREES flake)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate
- corpus-compile-floor

Resolve generated-doc conflicts by hunk, then regenerate, and restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the SPEC sentence, the root cause, the fix, the chain-truncation audit, the corpus sites, and the gates table. Do NOT push.
