# S330 — if-as-value block-branch tail-lift (`g-block-body-value-position-mislowers`, MED, if-value half)

Base: main `73df79ed`. Worktree branch `worktree-agent-ad7fea65da10675c1`.
The match half already landed (#469/#470); this is the residual if-value half.

## Reproduction (on base `73df79ed`)
- **Decl position** (SILENT null): `fn f(k){ const x = if k==1 { const a=42; a } else { const b=7; b }; return x }`
  emits per branch a DEAD inner tilde (`let _scrml_tilde_5 = a;`) instead of assigning the
  enclosing result var `_scrml_tilde_4`, so `const x = _scrml_tilde_4` is always `null`.
  Confirmed via scratch compile: `const x` binds `_scrml_tilde_4` (never assigned).
- **Derived position** (LOUD `E-CODEGEN-INVALID-LOGIC`): `const <label> = if (@n==1) {...} else {...}`.
  AST diagnosis: the ast-builder captures the if RHS of a derived cell as an `escape-hatch`
  raw string (no structured `ifExpr`/`if-expr` node — unlike `match`, which yields a `match-expr`
  node). emit-expr.ts has **no `if-expr` case**, so the raw `if (...) {...}` is emitted verbatim
  inside a `_scrml_derived_declare(name, () => …)` thunk → not a valid JS expression → the
  emitted-JS parse gate (validate-emit.ts) fires `E-CODEGEN-INVALID-LOGIC`.
  **The derived if-value position is broken for ALL arm shapes** (explicit `lift`, single-expr,
  and block-tail all error) — the whole position is unimplemented in codegen, independent of the
  tail-vs-lift question.

## SPEC grounding (no new language decision)
- §10.7 / §17.6.2: an if-as-expression binding SHALL select value-lift; an arm body produces its
  result value. §18.5 general block-value rule: a block's result is its tail expression (same rule
  #469/#470 applied to match block arms). Decl position: the compiler already ATTEMPTS the tail lift
  (wrong var) — pure lowering fix. Derived position: unimplemented + SPEC-governed → lower it.

## Fix
Reuse the shared §18.5 tail classifier `_blockTailIsValueExpr` / `planBlockArmLift` (emit-logic.ts,
established by #469/#470) — NO third predicate. Mirror the match block-arm structured-body path
(`emitMatchExprDecl`, ~:4738).

### Implementation (compiler/src/codegen/emit-logic.ts)
- New shared `emitIfExprBranchBodyLifted(body, tildeVar, bodyOpts, opts)` — one branch body,
  lifting the bare tail via `_blockTailIsValueExpr` (the ONE classifier; mirrors the match
  structured-body loop byte-for-byte, incl. `_awaitMatchArmServerCalls`).
- `emitIfExprAltChain` refactored to take `tildeVar`/`opts` and route both else-if and else through
  the shared branch helper.
- New shared `emitIfChainToTilde(ifNode, tildeVar, opts)` — the if/else-if/else chain assigning the
  taken branch's value to `tildeVar`; accepts BOTH the decl `ifExpr` node and a re-parsed `if-stmt`.
- `emitIfExprDecl` now = `let ~=null` + `emitIfChainToTilde` + `const name = ~` (decl fix).
- New `emitIfExprValueIIFE(ifNode, opts)` — value-returning IIFE for the derived/markup path.
- New `_reparseInitToIfNode(init)` — re-parses the escape-hatch derived-cell init to a structured
  `if-stmt` via BS→TAB (the `_emitNestedGuardedArmBody` pattern).
- State-decl derived arm: when the init is an escape-hatch `if`, RHS = `emitIfExprValueIIFE(...)`
  in both the no-deps and deps sub-branches.

### Verification results
- Decl repro: branch tails now assign the ENCLOSING `_scrml_tilde_4` (no dead inner tilde).
- Derived repro: compiles clean; emits `_scrml_derived_declare("label", () => (function(){…})())`.
- Runtime (happy-dom exec): derived→one, ret(1)→42, ret(2)→7, lift arms→L1/L2, else-if→one/two/other,
  void tail→empty, value tail→9. All pass.
- Suite: `bun test compiler/tests/{unit,integration,conformance}` — 22151 pass; the 6 fails are
  PRE-EXISTING (reproduce on base 73df79ed: self-compilation + 3 self-host-smoke [stale
  main-checkout dist] + B5 session + unnamed [auth roundtrip]). Zero new fails.
- Conformance: 869/869 (added `if-value/block-branch-tail-lift-all-paths`, 10 domAnchored asserts).
- `scripts/facts.ts --write` regenerated (868→869); `--check` PASS.
- R26: 5 real example sources (03/06/07/09/23) base-vs-post — identical error/warning code sets.
- No language decision required: SPEC §10.7/§17.6.2 govern if-as-value; the decl path already
  attempted the lift (wrong var), the derived path was simply unimplemented.
