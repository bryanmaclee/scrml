# s462-p0-sql-chain-truncation — progress

- [x] merged origin/main (1c1e9eee5), bun install, pretest
- [x] reproduce — base 1c1e9eee5, bun:sqlite route, raw body of `return ?{SELECT name, pw …}.get().name`:
      `{"name":"ada","pw":"HASH-SECRET-9f2c"}` (whole row). Same for const/let, `.all().length` (all rows),
      `.all().map(u => u.name)` (all rows), `.all()[0].name` (stray `[0].name` dropped → all rows),
      `.get().id + 1` (`+ 1` dropped), `.run().changes` (driver array). `.get()?.name`, `.map((u) => …)`,
      `x ?? ?{…}`, `c ? ?{…} : d`, `?{…}.get() is not` did not compile (invalid JS / E-PARSE-001 /
      E-ERROR-003 / E-SCOPE-001 — wrong diagnostics, fail-closed).
- [x] root cause — ast-builder `consumeSqlChainedCalls` took EVERY `.x` after a `?{}` BLOCK_REF as a SQL
      chained call (args read up to the FIRST `)`); every structured statement site (return / yield / lift /
      const-let-state initializers via tryConsumeSqlInit / bare statement; fn-body + logic-body-top) built a
      `sqlNode` from it; emit-logic `case "sql"` lowers `calls[0]` only. collectExpr broke the statement at a
      depth-0 `?{}` even in operand position. Text path `rewriteSqlRefs` took any `.word()` as chain and
      appended the tail to an un-parenthesized lowering (`?? null.v`).
- [x] fix + tests — commit f6f00bb3c (pre-commit 35206 pass / 0 fail)
- [ ] corpus differential
- [ ] gates

## S465 resume (cloud, owner absent)
- 2026-10-11T17:10Z reset worktree to wip/s464-p0-sql-chain @ c6b77477; node_modules symlinked (package.json == origin/main 1c1e9eee); pretest OK.
- 2026-10-11T17:11Z applied salvage patch agent-a1a75d1c0988a788f (S462 agent's uncommitted diff). It closes the one chained form the
      f6f00bb3c fix left open: `const r = ?{…}.get()?` inside a `!` function. After f6f00bb3c that tail routes through the
      expression path as a `propagate-expr` whose exprNode holds a `sql-ref`; route-inference never scanned propagate-expr, so the
      function was CLIENT-placed and the query emitted as `null /* sql-ref unresolved */.get()` (compiled clean). And the `?`
      lowering tested `tmp.__scrml_error` unguarded, so a no-row `.get()` (`not` → null, §44.3: no row is not a failure) threw.
      Fix: route-inference escalates a server-only resource in a propagate-expr (like a return expr); emit-logic guards the
      envelope test (`tmp && tmp.__scrml_error`), matching emitPropagateArm / the await-guarded form. KEPT (verified: the two new
      tests fail with the src hunks reverted, 108 pass / 2 fail; pass with them).
- Governing SPEC sentences (quoted):
      §8.3 (SPEC.md:9130): "The result of a `?{ }` context is a query result object. The following methods are supported:"
        `.all()` (or bare `?{}`) → `Row[]` "All matching rows as an array"; `.get()` → `Row | not` "First matching row, or `not`
        if no rows"; `.run()` → `void` "Execute without returning rows (INSERT/UPDATE/DELETE)".
      §8.1.2 (SPEC.md:8971): "a program-body `?{}` — any `?{}` outside `<schema>`, in statement or expression position, with any
        chain (`.all()` / `.get()` / `.run()` / `.acrossTenants()` / none) — SHALL hold **exactly one SQL statement**."
      §44.3 (SPEC.md:32090): "`Row | not` is the success type of `.get()`: `not` means the query ran and matched no row. A query
        that fails to run is not `not` and not `[]` — it is a `SqlError` variant, and the `?{}` is a failable expression in every
        context (§19.8.3, S451 R11)."
      The SPEC names the result methods and their return types; it says nothing that lets a member access / call / index after
      the method be absorbed — so the value of `?{…}.get().name` is the `.name` of the `Row | not` value (ordinary JS semantics).
- 2026-10-11T17:55Z pre-commit gate (unit+integration+conformance, 1540 files): 32886 pass / 3 env-only fail files, all failing
      identically on base 1c1e9eee (cloud container has no IPv6 + runs as root): dev-db-no-side-file (5 tests, `scrml dev` prints
      127.0.0.1 not localhost), headless-serve-bind-host (::1 twin), promote-safety-harness (read-only file writable by root).
      0 new failures. Committed salvage + BRIEF-resume-S465.md.
- 2026-10-11T19:05Z [x] corpus differential — scripts/corpus-emit-differential.ts capture base (git-archive of 1c1e9eee under
      .tmp/base) vs head 72780ed2a, default roots examples/samples/conformance/stdlib/benchmarks: 2809 = 2809 sources, compile
      outcome SET identical (1675 ok / 1134 fail both sides; 0 newly failing, 0 newly passing), 0 diagnostic-code changes,
      0 syntax delta, bare server-fn delta 0. The harness verdict is "NOT A VALID COMPARISON" only because the base side is not
      a git checkout (revision <unknown>) and every artifact/diagnostic embeds the compiler root; after normalizing the base root
      path: 2808 diagnostic-text diffs -> 0, 171 artifact diffs -> 6. The 6 real emit changes are all the `?` propagation guard
      (`if (t.__scrml_error)` -> `if (t && t.__scrml_error)`), client.js only:
        conformance/cases/defer/propagate-path, error/propagate-in-non-failable-fn-neg, error/propagate-non-failable-callee-neg,
        error/propagate-reaches-handler, error/propagate-success-unwrap,
        samples/compilation-tests/gauntlet-s20-error-test/failable-propagate-001.
      ZERO corpus sites change from the f6f00bb3c chain fix: no corpus source writes a tail after a `?{}` result method
      (grep `}.get|all|run|first()` followed by `.x` / `?.` / `[` / `+` / `??`: 0 hits in 387 `?{}`-bearing files). So no corpus
      site was over-sharing; the exposure was latent (any adopter writing `.get().name`).
      gauntlet-r25 (4 files, compiled separately): all 4 fail to compile on BOTH sides with identical diagnostic-code multisets;
      no emit to compare; their 32 `?{}` sites carry no tail. ../giti and ../flogence are NOT cloned in this container — skipped.
      Executed sample (propagate-success-unwrap `outer`, `let v = inner(id)?`, from both artifacts): ok / NotFound / Timeout
      identical; with a callee whose success value is null (`not`): base THROWS `null is not an object (evaluating
      '_scrml__scrml_tmp_5.__scrml_error')`, head returns null. Previously-wrong value: a crash on a legitimate `not` success.
- 2026-10-11T19:40Z [x] gates (head 72780ed2a + FACTS regen):
      types-gate --check 0 · facts --check 1 → regenerated by `bun scripts/facts.ts --write` (compiler/src line count) ·
      regen-spec-index --check 0 · bootstrap-conformance --check 0 · gen-bootstrap-severity --check 0 · host-global-scan --check 0 ·
      s34-census --check-new --base 1c1e9eee 0 · state --check 0 · gen-md-shim --check 0 · conflict-marker-gate 0 · delta-lint 0 ·
      snippet-gate 0 · corpus-compile-floor --check 0 · tracking: compiler/tests/*.test.js 2239/0 · e2e-render-map 259/0 ·
      lsp+commands 713 pass / 11 fail — all 11 (7 files, `scrml dev`/`serve` bind + watcher) fail identically on base (no IPv6) ·
      browser-baseline --check 1 (twice): one NEW name "a nested <each> under an element in a lifted each row" — passes alone on
      head and base; the full tier fails it identically on base 1c1e9eee (cross-file state leak, `JSON Parse error … "bad"`).
      Pre-existing/environmental; baseline NOT re-recorded (not this change's to accept).

## S465 fix round 1 (cloud, owner absent) — BRIEF-fix-round-1-S465.md
- 2026-10-11T20:30Z reset worktree to wip/s464-p0-sql-chain @ 5c5e4064a; node_modules symlinked (package.json == origin/main); pretest OK.
      Reviewer probes copied to .tmp/probe; base 1c1e9eee5 and WIP 5c5e4064a compilers git-archived under .tmp/ for A/B.
- F1 [MED] `!{}` on a tailed `?{}` dropped — REPRODUCED (h2-tail-full: head THREW `SQLiteError: integer overflow`,
      base "qf"; h2-tail-partial/h2-tail-bogus: head compiled, base E-TYPE-080). Root cause: every "is this handler on a
      query?" test (`handledSqlOfGuardedNode`, type-system `_operandErrorVariants`, the guarded-expr emitter's three
      sites) asked `sqlQueryExprShape(operand)` — true only when the query is the WHOLE operand. FIX: sql-attempt.ts
      `sqlQueryHeadOfExpr` finds the query that is the operand's LEFTMOST operand (member/index object, callee, binary
      left, ternary condition, cast, non-update unary — the operand JS evaluates first) + `replaceSqlQueryHead`;
      those three consumers use it. Emission: the query is attempt-wrapped and bound first, the tail runs only on
      success — `const _scrml_query_N = (await _scrml_sql_attempt(…)); let r = (q && q.__scrml_error) ? q : q.name;`.
      Governing: §44.3 "the `?{}` is a failable expression in every context (§19.8.3, S451 R11)".
      Pinned (integration, executed routes): const/let/return/reassign failing query → arm; success → tail value;
      partial handler → E-TYPE-080 for each form; bogus arm → E-TYPE-080. 10 of them fail with the src reverted.
      NOT covered: `match ?{…}.get().name { … }` (probe h5-match-tail) throws on BASE too (pre-existing; the match
      scrutinee test still reads the whole-operand shape) — deferred, not a regression of this change.
- F2 [MED] tailed server cell — REPRODUCED (c4-one, c2-*, c3-*, c-p-*: E-CG-006, raw `?{` in client JS). Root cause:
      after f6f00bb3c a tailed cell is not a structured `sqlNode`, so codegen classed it a "callable" loader: ≥2 →
      `/__mountHydrate` (worked), 1 → client-side `await (?{…}.get().name)`. FIX: a `<x server>` initializer that
      evaluates an inline `?{}` IS §52.6.5 Pattern C ("When the RHS of a `<var server>` declaration is an inline `?{}`
      query, that `?{}` IS the cell's mount load. The compiler emits a `/__serverLoad/<var>` route that runs the query
      server-side"): collect.ts `serverVarDeclExprQueries` / `serverVarDeclLoadQuery` (ONE reader for the load
      classification, the row-scope predicate, `@currentUser` detection and type-system W-AUTH-004);
      `callableServerVarDecls` excludes them; emit-server `_patternCLoadExpr` evaluates the WHOLE initializer
      server-side for the route AND the SSR seed (redacted at the sink as before). Also `isServerOnlyNode` now detects
      a query in a decl initializer structurally (a no-backtick `?{SELECT …}.get().name` slipped the sigil regex and
      emitted `null /* sql-ref unresolved */.get()` on the client). protect=: rows leaving via `.all().slice(0,1)` /
      `.all()[0]` / `.get()` stripped; `.all().map(u => u.pw)` / `.get().pw` → E-PROTECT-006 (the route is analysed as
      an egress). Param-bearing tailed cell → W-AUTH-004, no load (same as untailed). Pinned: 1 cell, no-backtick,
      query-not-leftmost, 1 and 2 cells in `${}` in `<db>`, 3 protect strip + 2 protect E-PROTECT-006 cases; the
      earlier 2-cell test now asserts the two `/__serverLoad` routes. All fail with the src reverted (control `.get()`
      passes on both).
- F3 [MED] client-side tailed `?{}` — STOPPED, NOT CHANGED (spec conflict surfaced). The code that fits is
      §13.7 E-VALUE-SERVER-CALL, item 3: "A `?{}` query written directly in the position (`<n> = ?{…}.get()`), outside
      the right-hand side of a §52 `<x server>` declaration. The query runs on the server; the position would wait for
      it." — the value positions include "a render expression (a markup `${ … }` interpolation …)" and "an initializer".
      BUT §13.7's status block: "Status: Nominal / spec-ahead (S451). NORMATIVE; impl#1 does not implement it and is
      not changed for it (frozen for language semantics, S447 — the divergence is filed: docs/known-gaps.md
      g-impl1-value-server-call-s451)." Emitting it from impl#1 contradicts that sentence; no other code fits
      (E-SQL-007 §44.4 is the async-context code with no fire site; E-SQL-QUERY-NOT-READABLE is for unparsed text).
      Needs a PA/user ruling: lift the impl#1 freeze for item 3 (narrowly: a `?{}` in a client value position) or
      accept the carried divergence. Measured: cl-interp → W-CG-001 + `null /* sql-ref unresolved */.name` in client;
      cl-top-const → W-CG-001 + declaration dropped. Base: cl-interp → W-CG-001 (sql block suppressed);
      cl-top-const(-notail) → `const n = null; // SQL-init for n — client cannot evaluate _scrml_sql (E-CG-006)…` (a null stub, compiles clean).
- F4 [LOW, record only] `lift ?{…}.all().map(u => u.name)` in a standard function = E-SYNTAX-002 (§49.6.2, correct);
      untailed `lift ?{…}.all()` compiles and lifts whole rows. Not filed before → filed
      `g-impl1-lift-sql-whole-rows-in-standard-function-s465` (prov=review:s465-sqlchain). Not changed.
- 2026-10-11T22:10Z commits: afc72e07b (BRIEF archive), a33bf5849 (F1), ac4ff2747 (F2).
- [x] targeted corpus differential — every `?{`-bearing .scrml under examples/samples/conformance/stdlib/benchmarks
      (387 files), each compiled standalone by three compilers: base 1c1e9eee5, WIP 5c5e4064a (both git-archived
      under .tmp/), head. WIP -> head: compile outcome identical (200 ok / 187 fail both), 0 newly failing,
      0 newly passing, 0 warning-code diffs, 0 artifact diffs (sha1 of every emitted artifact, compiler root
      normalized). The only fatal-code diffs are 3 stdlib sources (auth/flows, auth/password, crypto/index) where
      the WORKTREE compiler applies the stdlib real-path exemption (`isStdlibSourceFile`) and the archived
      compilers do not (their stdlib is under .tmp/) — base <-> WIP shows 0 such diffs; harness artifact, not a
      change. base -> head: 0 newly failing; 2 serverJs diffs, identical to base -> WIP (carried from the
      earlier commits). No corpus source writes a tailed `?{}` handler or a tailed server cell. ../giti and
      ../flogence are NOT cloned in this container — skipped.
- [x] gates (head ac4ff2747 + docs): types-gate --check 0 (182 diag, unchanged) · facts --check 1 -> `facts.ts
      --write` (line counts) -> 0 · state --check 1 -> `state.ts --write` (gap counts, the new F4 gap) -> 0 ·
      regen-spec-index 0 · bootstrap-conformance 0 · gen-bootstrap-severity 0 · host-global-scan 0 ·
      s34-census --check-new --base 1c1e9eee PASS · snippet-gate 0 · corpus-compile-floor --check PASS ·
      pretest 0 · compiler/tests/*.test.js 2239/0 · e2e-render-map 259/0 · lsp+commands 713 pass / 11 fail (the
      same 11 `scrml dev`/`serve` env failures recorded above) · browser-baseline --check 1: the same one name
      recorded above ("a nested <each> under an element in a lifted each row"), pre-existing, not re-recorded.
- pre-commit gate run 1 (before the F1/F2 commits): 32925 pass / 10 fail — 7 env-only (dev-db-no-side-file 5,
      headless-serve-bind-host 1, promote-safety-harness 1, as recorded above) + 3 in
      tenant-floor-project-set.test.js (a `pinTenant` route's Set-Cookie absent under full-suite load); that file
      passes alone 24/0 (and with the files run beside it, 58/0).
- final pre-commit gate (head ac4ff2747 + docs): 32925 pass / 132 skip / 10 fail — the SAME 10. The 3
      tenant-floor-project-set failures repeated, so they were checked as real: the same full gate with the WIP
      compiler source (5c5e4064a `compiler/src`, this round's tests) fails the SAME 3 tenant tests (plus the 20 new
      S465 tests, as expected) → pre-existing in this container, order-dependent (process-shared state in the one
      bun process), NOT this change. Not chased (outside scope); recorded here for the PA.
