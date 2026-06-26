# sPA ss31 → PA — re-integration (codegen expression / JS-validity)

**List:** `spa-lists/ss31-codegen-expr-validity.md` · **Branch:** `spa/ss31` · **Tip:** `21404e89` · **Base:** current main `1ada2b3e` (rebased current — **0 behind / 1 ahead**, clean FF/merge). **Worktree:** `../scrml-spa-ss31`.

## All 3 items LANDED (one sPA landing commit `21404e89`)
One `scrml-js-codegen-engineer` dispatch (worktree, opus) fixed B1→B2→B3 sequentially (shared serializer surface — no parallel). Agent per-bug commits `b2cc45d5`/`65831767`/`6bf6b585` squashed into the single sPA landing commit. sPA verified independently before landing (S215 adversarial).

- **B1 g-unary-left-of-exponent-no-paren** (MED) — bare `-@a ** 2` now fires a LOUD targeted `E-CODEGEN-INVALID-JS` ("a unary operator immediately left of `**` is invalid JavaScript … write `(-@a) ** 2`") instead of silently emitting invalid JS. Root: AST-path guard (`binaryOperandNeedsParens:1207`) already handled `(-@a)**2` (Bug-A, S221); the bare form errored in acorn → escape-hatch fallback bypassing the guard. Surfaced at parse time (`expression-parser.ts` → `ast-builder.js` TABError), mirroring `sqlDiagnostic`/E-SQL-008. REJECT-LOUD per brief; no auto-paren (no design fork taken).
- **B2 g-enum-toenum-client-structured-decl** (MED) — client structured `<status> = Status.toEnum(@raw)` now lowers to `(Status_toEnum[…] ?? null)` (C1 dispatch + C5 reset thunk). Mirror of the ss22 server fix, client-gated. Agent used the AST-native lowered template (more robust than the Pass-9 `[^)]+` regex for nested-paren args — Rule 3). giti-relevant (§14.4.3).
- **B3 g-double-unary-minus-emit-decrement** (LOW) — `Unary(-,Unary(-,a))` → `- -a` (was `--a`); `+(+a)` → `+ +a`; BOTH serializers (`emitUnary` + the `emitStringFromTree` twin). Minimal space-split (S215).

**Files (9):** `compiler/src/{expression-parser.ts, ast-builder.js, codegen/emit-expr.ts}` + 3 integration tests (`g-unary-left-of-exponent-paren` extended, `g-enum-toenum-client-structured-decl` new, `g-double-unary-minus-emit-decrement` new) + BRIEF/progress/list-status. +727/−15.

## Verification
- Full `bun run test` (the landing commit's pre-commit gate): **25429 pass / 0 fail / 214 skip** (+34 new tests, 0 new failures). Baseline was 25395/25396 (2 non-recurring flaky).
- sPA-independent (S215): 3 new suites re-run 56/0; direct real-shaped repros — B1 bare → LOUD E-CODEGEN-INVALID-JS (good message); `(-@a)**2` → clean; B4 `-(@a**2)` → caught loud-but-generic (confirms the parked finding).
- **Within-node re-baseline (in-landing):** one fixture shifted — `g-unary-left-of-exponent-paren.test.js` §1 nested `(--a)**2` → `(- -a)**2` (runtime now `=== 4`). Sibling `not.toContain("- -")` unaffected.

## PARKED — out-of-scope discovery (PA: mint a follow-up item)
**g-unary-of-exponent-arg-no-paren** — `emitUnary` drops needed parens around a `**` ARGUMENT: `-(@a ** 2)` emits `-_scrml_reactive_get("a") ** 2` (same unary-left-of-`**` SyntaxError). DISTINCT from B1 (AST path — acorn parses `-(@a**2)` fine, not the escape-hatch) and B3 (double-unary). Caught loud-but-GENERIC today ("compiler emitted JS it cannot itself parse"); wants a targeted fix (wrap a `**`-binary unary-argument in `emitUnary`) + diagnostic. The agent deliberately recommended ONLY `(-@a) ** 2` in the B1 message (not `-(@a ** 2)`) to avoid steering authors into this trap; once fixed, B1's message can add the square-then-negate alternative.

## Notes
- Coherence: spa/ss31 = current main + exactly 1 commit; no source leak in main.
- First dispatch hit a provisioning miss (sPA omitted `isolation:worktree` → agent landed in main checkout, correctly REFUSED to edit + STOPPED; no damage, main clean). Re-dispatched with isolation — clean run.
- Worktree `../scrml-spa-ss31` has a `node_modules` symlink → main (gitignored; clean on prune). No main advance, no push.

— sPA ss31 (stood down)
