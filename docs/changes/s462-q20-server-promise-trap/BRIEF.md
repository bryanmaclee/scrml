You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. This implements ruling Q20, recorded in scrml-support/user-voice-scrml.md S462 Q20 as "q20 yes.". Read that entry verbatim first.

FIRST:
1. `git fetch origin && git merge origin/main`. Main is at or after a9aa81eff and includes #1399, the P0 await fix: the `isPromiseReturningImportedCallee` helper and the 14 classifier sites.
2. Archive this prompt verbatim to docs/changes/s462-q20-server-promise-trap/BRIEF.md.
3. Commit it together with a progress.md.

Commit rules:
- Commit incrementally.
- Code and its tests go in one commit.
- Never use --no-verify, and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15. The suite takes about 10 minutes: use a 600000 timeout and run in the foreground.

THE RULING: In SERVER code, wherever a boolean-test position tests the result of a call to a `scrml:` stdlib import, the compiler wraps the operand in a runtime check. Boolean-test positions are: an `if` / `while` / `for` condition, the operand of `!`, `&&` / `||` operands used as conditions, and a ternary condition. If the value is a Promise, the route fails with a 500 internal error, never a truthy pass. Client code is untouched. The purpose: a future await-classifier miss fails CLOSED. Stated limit: a result stored in a variable and tested later is not covered.

DESIGN:
- Identify the operand structurally: an ExprNode call whose callee resolves, by IMPORTED name and through aliases and re-exports (reuse the #1399 machinery), to any `scrml:` stdlib export. Include optional calls and calls nested as the direct operand.
- Do not limit this to functions currently classified async. The point is to catch classifier misses, so wrap every stdlib call in those positions. If that turns out to be too broad, report it before narrowing.
- Emit a small runtime helper in the server runtime (e.g. `_scrml_assert_settled(v)`). It throws an internal error that the route machinery maps to 500 with a fixed message, never leaking detail. Route it through `_scrml_g` if host-global-scan requires that.
- An already-awaited value passes through unchanged, so the cost is one function call. Keep the server runtime size ratchet in mind: don't raise its ceiling.
- Server-only: server functions, route handlers, `server` blocks, and Trigger-3 escalated functions. Never client bundles. Verify with a client-bundle grep test.
- SPEC: add the §13.2 normative sentence, with provenance `ruling:user-voice-scrml.md S462 Q20 "q20 yes."`, stating the scope and the limit. Add a §34 row only if a new diagnostic or runtime error code is introduced.

TESTS:
- (1) Unit tests that the wrap is emitted in each position and not elsewhere.
- (2) End-to-end, with the classifier deliberately defeated:
  - Use a test-only hook or a fixture that forces a stdlib async call to be mis-classified as sync. It must be an explicit test seam, not a production flag.
  - Show the route returns 500, not an accepted login.
  - Run it under bun with bun:sqlite.
- (3) The normal awaited paths still pass, with results unchanged: wrong password → rejected, right password → accepted.

GATES, all of them:
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (the "PARSER DISAGREES" refusal is a known flake; re-run it)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate and corpus-compile-floor
- emit differential over the corpus: list every server file whose output changed and how; adopters ../giti and ../flogence are read-only

Resolve generated-doc conflicts by hunk, then regenerate. Restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the design (helper, positions, how the operand is identified), the SPEC sentence, the emit-diff summary, runtime size, and the gates table. Do NOT push.
