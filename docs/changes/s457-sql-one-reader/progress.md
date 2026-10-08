# progress — s457-sql-one-reader (append-only)

## 2026-10-07 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a118db290abcc3990`, base `0d8e9d8ce` = origin/main.
- Governing text, SPEC §8.1.2 (quoted): "**One reader of a slot's extent.** Where a `${…}` bound parameter ends
  inside a `?{}` body SHALL be decided by ONE reader — the emitter's (`compiler/src/codegen/sql-lex.ts`), which reads
  the slot the way JavaScript reads the substitution of the template the body is emitted into (string literals,
  nested template literals, comments and regular-expression literals do not end it). Every check that reads the SQL
  text around the parameters — this rule, the §14.8.10 allow-list, the tenant SQL subset, the protect floor, §52
  write detection, the §8.10 hoist — takes its slot extents from it or refuses a slot whose extent it cannot prove the
  same."
- Maps: primary.map.md Task-Shape Routing row "S456 — PROGRAM-BODY SQL … ANY reader that splits `${…}` slots" was
  load-bearing (named `jsInterpolationEnd` :91, the guard, and the consumers).

## Locus verification
- Gap 1 locus HELD: `codegen/sql-lex.ts` `jsInterpolationEnd` used `code-segments.ts` `regexAllowedAfter`.
- Gap 2 locus FOUND: `codegen/rewrite.ts` `rewriteSqlRefs` (whole-text regexes `/\?\{`([^`]*)`\}/g`). The checker is
  `sql-in-expression-text.ts` `scanExpressionTextForSql` (string/comment/regex/template-text aware).
- Reproduced gap 2 on base: `if (x == "?{`SELECT 1; DELETE FROM log`}")` → emitted `( x == "(()=>{throw …E-SQL-MULTIPLE…` (broken string), 0 codes.
- Reproduced gap 1 on base (compile): `${ g("if(") / 2 }) /* } */` → 0 codes, site emitted as an E-SQL-001 throw (silent);
  `${ x // (⏎ / 2 }` and `${ x // return⏎ / 2 }` → E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED.

## Hypothesis REFINED (brief said: acorn.parseExpressionAt; if acorn cannot parse, refuse)
- Pure acorn would newly REJECT SPEC-legal scrml payloads: `${ x is not ? "a" : "b" }` compiles and lowers on base
  (`(x === null || x === undefined) ? …`), and a template slot of expression text holds `?{…}` (not JS). Also `${@x}`
  (775 corpus slots use `@`/plain identifiers; 0 fail acorn once `@`/`::` are read).
- Design: (a) PARSE the payload with `ScrmlParser` (acorn + the scrml `@` / `::` lexical plugins, moved to leaf
  module `compiler/src/scrml-acorn.ts`) — `new ScrmlParser(opts, src, start+2); nextToken(); parseExpression()`;
  the slot ends at the next token iff it is `}` (acorn has skipped ws/comments). (b) Only when that fails
  (scrml-only syntax), read with the SAME parser's tokenizer, `}` balancing `{` / `${`. (c) Neither → -1 (fail closed;
  consumers refuse as before). `regexAllowedAfter` is no longer used by sql-lex.
- Differential battery (810 generated slots, 520 JS-accepted): base reader disagrees with JS on 50, new on 0.

## Consumers of the slot reader (all get the new extent; none re-derive)
1. `codegen/sql-lex.ts` `liveSqlInterpolations` → `replaceLiveSqlInterpolations`, `liveSqlInterpolationExprs`,
   `sqlHasLiveInterpolation` (and through them):
   - `codegen/rewrite.ts` `extractSqlParams` (the emitter)
   - `codegen/collect.ts` :1020/:1035 (load-kind / row-scope classifier)
   - `schema-differ.js` `programSqlTokens` :4063 (+ direct `jsInterpolationEnd` cross-check :4134 — same function,
     so it agrees by construction; -1 still → "an unclosed `${…}` slot")
   - `codegen/tenant-sql-subset.ts` :373, `codegen/protect-egress.ts` :406 (cross-check)
   - `codegen/protect-flow.ts` `sqlSkeleton` :1028, `codegen/scheduling.ts` :876, `type-system.ts` `sqlIsPersistWrite`
     :6928, `sql-table-refs.js` :67, `route-inference.ts` :2597
2. Direct `jsInterpolationEnd`: `db-ownership.ts` :340, `hoist-sql-shape.ts` :125 (-1 → null, refuse),
   `codegen/protect-egress.ts` `blankSqlNoise` :503, `sql-in-expression-text.ts` :72 (template slot in expression text —
   payload may hold `?{…}`: read by the tokenizer branch) and :89 (skipping an unbackticked `?{ … }` body that is
   already reported unreadable — SQL text, read by the tokenizer branch; -1 skips to the end, the compile is refused
   either way).
- The old internal helpers `jsStringEnd` / `jsTemplateEnd` / `jsRegexEnd` are deleted (the parser reads those tokens).

## Gap 2 design
- `sql-in-expression-text.ts`: the visitor's `sql` now carries `end`; NEW `sqlSitesInExpressionText(text)`.
- `rewriteSqlRefs` lowers exactly those sites (same scanner as the checks), each with its own chain; `.nobatch()` /
  `.acrossTenants()` read from that site's chain only. Side effect (correct): the old `_acrossSqls` keyed by SQL TEXT
  suppressed the tenant floor for a second, identical query in the same expression that did NOT carry
  `.acrossTenants()`; now per site.

## 2026-10-07 — verification (code commit a0b71b10f)
- Pre-commit gate (unit + integration + conformance + parser-conformance): 31807 pass / 58 skip / 12 todo / 0 fail
  (base commit 0c5b9e5ee: 31786 pass / 0 fail; +21 = the new test file).
- `bun conformance/run.ts`: 1341/1391 pass + 50 xfail, 0 fail.
- Bite: the generated battery (810 slots, 520 JS-accepted) — base reader 50 disagreements with JS, head 0.
- EMPIRICAL corpus (scripts/corpus-emit-differential.ts capture, roots examples, samples, conformance, stdlib,
  benchmarks, compiler/self-host-v2 = 2485 sources; base = `git archive 0c5b9e5ee` in .tmp/base, head = worktree):
  compile-failure SET identical (1494 ok / 991 failed both sides), diagnostic-CODE changes 0 of 2485; after
  normalizing the root path (base lived at `<wt>/.tmp/base`): compile stdout/stderr identical 2485 of 2485, artifacts
  identical 12228 of 12230 — the 2 differing are `conformance/cases/module/e-import-00{3,8}-…/case.client.js`, a
  relative import path that encodes the base checkout's nesting (`../../base/conformance/…` vs `../../../conformance/…`),
  a harness artifact. Direction: INERT on the corpus; newly-accepting only on the false-refusal shapes (unit +
  compile tests), which §8.1.2 already says are one slot ("string literals, nested template literals, comments and
  regular-expression literals do not end it").
- Micro-cost: liveSqlInterpolations on a 3-slot body ~1.1 µs (base) → ~7.8 µs (head) per call.

## 2026-10-07 — fix round 1 (S239 review of b0b5796e9: LAND-WITH-NITS)
1. QUADRATIC slot reader — CONFIRMED + FIXED (4f4aca561). acorn's constructor with a start offset runs
   `input.slice(0, lineStart).split(lineBreak)` per slot. Now `new ScrmlParser(opts, src.slice(start), 2)` and the
   offset is added back (nothing acorn reads depends on text before the start; `locations` off).
   liveSqlInterpolations, 16k one-per-line slots: base 3.5 ms · head-before 10561 ms · head-after 106 ms (JS
   payloads); `is not` payloads (tokenizer branch): base 6.9 ms · before 23790 ms · after 79 ms; 64k slots 298 / 478 ms
   (linear). Full CLI compile of a 2000-row VALUES insert: base 0.67 s / head 0.82 s; with `is not` slots base 1.00 s /
   head 1.45 s (reviewer measured head 2.7 s / 4.8 s before). Tests: 16k-slot bound (4 s) for both branches, absolute extents.
2. Site location regex-vs-division — CONFIRMED + FIXED (cf6bcec72). `scanExpressionTextForSql` now asks
   `regexAllowedAfter` over the CODE read so far (literals/regex/templates/queries → one value token `0`, comments → space,
   a property name after `.`/`?.` → `_`), kept as units with a bounded suffix (`CodeSoFar.tail()`, reaching back past
   the `(` matching a trailing `)`) so it stays linear (16k sites after `)`+`/`: ~157 ms; a `+=` string version was 756 ms,
   quadratic). Unit: `x.if(1) / ?{…}`, `x // (⏎ / ?{…}`, `g("if(") / ?{…}`, `x?.while(1) / ?{…}` are checked AND lowered
   (base lowered them UNCHECKED — the base checker missed them too); `return /?{…}/.test(x)` stays a regex. Site battery vs
   an acorn parse (query replaced by an identifier): 49 comparable texts, base 6 wrong, head 0.
   RESIDUAL (not parser-based): site location is still lexical, because expression text holds `?{…}` and scrml
   operators no JS parser reads; the regex decision is still the shared heuristic on a cleaned prefix. Known miss: an
   object literal in EXPRESSION position before `/` (`({a: 1} / ?{…})` — `}` is read as a block end → regex). Fails
   closed (raw `?{` → invalid JS) and both the checks and the rewriter share the reading.
3. Bare `.unsafe` param array — FIXED (4f4aca561): each param parenthesized, `${a, b}` is one bound value.
- Gate at cf6bcec72: 31819 pass / 0 fail. Conformance 1341/1391 + 50 xfail. Corpus re-run (base 0c5b9e5ee vs head
  cf6bcec72, 2485 sources): 0 diagnostic-code changes, compile streams identical 2485/2485, artifacts identical
  12228/12230 (the same 2 harness-path artifacts). INERT.
