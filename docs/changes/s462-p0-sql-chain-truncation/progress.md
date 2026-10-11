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
