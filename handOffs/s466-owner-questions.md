# S466 — owner questions (from the S466 PA gap list)

Collected from the S466 gap list (`~/.cache/scrml-s466-pa/gaps-to-file-snapshot.md`). These were NOT filed
as gaps: each is a decision for bryan, not a defect. Context and sources are given for each. Nothing here is ruled.

1. **Exhaustiveness over the built-in error types (§19.7).** Should `Error`, `SqlError` and `ServerCallError`
   have variant lists that feed exhaustiveness and mismatch checks? Today they do not (see the resolved
   `g-impl1-handler-arm-undeclared-qualifier-accepted-s466`). Turning it on is **newly-rejecting**: #1423's first
   cut did it and the s462 sql-chain test (`.Transport(_)` on `! -> SqlError`) failed. If yes, it also closes
   `g-builtin-error-arm-nonexistent-variant-accepted-s466`. Source: #1423 review / branch progress.md.

2. **`scrml fix` and §66-dialect files.** A file already rewritten to the §66 dialect is refused by every later
   `scrml fix` run (`--s66` re-runs exit 3), because impl#1 has no §66 error class and cannot tell the dialect
   from breakage. Option in the PR: judge such files with the bootstrap compiler. Recorded in SPEC §63.4 as
   "PA reading S466, owner veto". Source: open PR #1425 body.

3. **Language-wide narrowing of parameter defaults.** Should a parameter default be limited to fully-structured
   expressions everywhere (the limit-primitives lean), or only on server-placed functions? SPEC §7.3.2 says
   "Default values are arbitrary expressions", and that stands until ruled. Source: s466-server-param-defaults
   round-3 review.

4. **Provisional codes from the parameter-defaults work:** `E-PARAM-DEFAULT-AWAIT`,
   `E-PARAM-DEFAULT-SERVER-IDENTITY`, `E-PARAM-DEFAULT-UNSUPPORTED`, `E-PARAM-DEFAULT-FORWARD-REF`. They are
   marked provisional in SPEC on the unmerged branch `origin/s466-server-param-defaults`. Ratify the names?
   Source: that branch's commits 6605001ed / 4214e026b.

5. **Placement-only helper in a parameter default (newly-accepting fix).** A plain `function` placed on the
   server only by caller context is always an async peer with a route, so in a parameter default it is
   refused and in a body its call is awaited. Proposed fix: emit a sync server-bundle helper, as a `fn` gets.
   The defect is filed as `g-placement-only-helper-always-async-peer-s466`; the question is whether to accept
   the newly-accepting fix. Reviewer probe `~/.cache/scrml-review-param-defaults/p/hb.scrml`.
