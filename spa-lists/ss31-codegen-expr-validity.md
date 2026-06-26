# ss31 — codegen expression / JS-validity

**Fill-note:** three emitted-expression bugs that produce invalid JS (loud `E-CODEGEN-INVALID-JS` or a wrong token). All live in the expression serializers + enum lowering — one shared ingestion surface → **SEQUENTIAL within-list** (do NOT parallel-dispatch; they edit the same files). Built S222 over the post-S221 open board.

**Shared ingestion:** the two expression serializers — `emit-expr.ts` (`binaryOperandNeedsParens` + the AST→JS path) AND its `emitStringFromTree` twin — plus the client-side enum-lowering bypass in `emit-logic.ts`/`emit-expr.ts`. The symptom class is "emitted JS is syntactically invalid / semantically wrong."

**coreFiles:** `compiler/src/codegen/emit-expr.ts` · the `emitStringFromTree` serializer twin · `compiler/src/codegen/emit-logic.ts` (enum path) · regression fixtures under `compiler/tests/`.

**Brief reminders:** R26 empirical reproduce on real-shaped source (S138). For any paren-insertion, watch the over-paren blast radius (S215 — the ss21 #4 review flagged this class). Re-baseline the within-node parity allowlist IN THE SAME LANDING if a fixture AST shifts + run the FULL `bun run test` before DONE (S198 brief-template).

## Items

1. **g-unary-left-of-exponent-no-paren** (MED) `[status=open]`
   - Symptom: `-@a ** 2` emits `- get("a") ** 2` — a unary left-operand of `**` is invalid JS, needs parens. The `(-@a)**2` half (Bug A) landed S221; this is **Bug B** `-@a ** 2`, PARKED at S221 as an acorn parse-error → regex-fallback. NEEDS: parser accept-or-reject of the bare `-@a**2` form + a diagnostic-improve (verified-LOUD `E-CODEGEN-INVALID-JS`, not silent). This is the legacy **acorn** expr path, NOT the native parser → NOT held by the parser fork.
   - Footprint: acorn-fallback recognition + `emit-expr` paren insertion for the `**`-left-unary case (mirror the Bug-A guard).

2. **g-enum-toenum-client-structured-decl** (MED) `[status=open]`
   - Symptom: `Enum.toEnum()` is un-lowered CLIENT-side for a structured `<cell> = Enum.toEnum(...)` decl — same `emitExpr`-bypass root as the server case fixed in ss22. (ss22 #5 deferred.)
   - Footprint: the client decl-RHS emit path that bypasses enum lowering; mirror the server-side `toEnum` lowering.

3. **g-double-unary-minus-emit-decrement** (LOW) `[status=open]`
   - Symptom: `Unary(-, Unary(-, a))` serializes as `--a` (decrement token) in BOTH serializers → invalid JS for a numeric arg. (ss21 #4 deferred finding; pre-existing.)
   - Footprint: insert a space/paren between adjacent unary `-` in `emit-expr` + the `emitStringFromTree` twin.
