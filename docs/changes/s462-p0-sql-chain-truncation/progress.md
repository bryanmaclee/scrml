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
