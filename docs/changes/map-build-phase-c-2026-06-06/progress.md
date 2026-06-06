# D1 — type-system: MapType + recognition + key-check + E-MAP-BRACKET-WRITE gate

Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a4ee551ea0ba4e873
Branch: worktree-agent-a4ee551ea0ba4e873

## 2026-06-06 startup
- merge main: "Already up to date" (base already had D0 normalizeUnion + §59.8). normalizeUnion count=1.
- bun install OK; bun run pretest OK.

## @ordered / reactive-@ probe (DONE — piece 3 verification)
- Lexer reads `@ordered` after `]` as a SINGLE `AT_IDENT` token (the §6 reactive-sigil token form).
- BUT collectTypeAnnotation (ast-builder.js ~3815) does NOT treat post-`]` `@ordered` as a boundary;
  it appends it after `]` with no space. typeAnnotation string the typer receives is `"[string:Money]@ordered"`.
- VERDICT: NO ast-builder fix needed. resolveTypeExpr's map branch must strip a trailing `@ordered`
  and set ordered:true. The leading `@` is part of the affix spelling, not reactive-@.
- ResolvedType is NOT mirrored in compiler/src/types/ast.ts (the `kind:"array"` there is ArrayExpr,
  an ExprNode). So no ast.ts ResolvedType change is needed.

## Steps — ALL DONE
- [x] Piece 1: MapType interface + ResolvedType union member + tMap ctor (f8c1f176)
- [x] Piece 2+3: resolveTypeExpr [K:V] recognizer (findMapEntryColon, depth-1/ternary-excluded) + @ordered strip (2791b919)
- [x] Piece 4+5: formatTypeForDiagnostic map arm + key-comparability check + isFunctionField asIs sidecar (ae6493a1)
- [x] Piece 6: E-MAP-BRACKET-WRITE gate + surface map type to state-decl scope binding (81167707)
- [x] Tests: 35 typer-unit tests (2fee736d)

## Load-bearing findings during implementation
- ResolvedType is NOT mirrored in compiler/src/types/ast.ts (no ast.ts change needed).
- struct fn-fields resolve to `asIs` (NOT a `function` kind) in the type registry; the resolver
  deliberately keeps them asIs (R28-8 warns against changing the resolver root). To surface the
  function-specific E-EQ-003 (not the general E-MAP-KEY-NOT-COMPARABLE), added an additive
  `isFunctionField` sidecar to AsIsType (R28-8 `bareVariantBase` precedent), stamped in both
  parseStructBody + the inline-struct branch when the raw clause is function-shaped.
- The S168-widened heterogeneous path: a literal index `@m[0]` AND a string-literal key `@m["DAL"]`
  BOTH produce a STRING path segment (`["0"]` / `["DAL"]`) — INDISTINGUISHABLE from a dotted
  deep-set `@m.field` (`["field"]`). Only a COMPUTED index `@m[@k]` produces `[{index}]`. For a MAP
  receiver this is fine: a map has NO struct fields, so ANY reactive-nested-assign on a map cell is a
  forbidden indexed-write regardless of path-segment form. The gate does NOT discriminate the
  segment shape for a map receiver (it does NOT require `{index}`); it fires on any path.
- A map-typed STATE-decl bound `asIs` to the scope (the state-decl surfacing allowlist was
  enum|union|struct|array). Added `map` to that allowlist so the bracket-write gate sees rt.kind==="map".
  (let-decl already surfaced map via `kind !== "asIs"`.)

## DEFERRED (per brief — v1 design defaults, NOT implemented)
- `@m[k]` bracket-READ type-flow (no `case "index"` map arm typing `@m[k]` as `V|not`).
- Deep-nesting E-MAP-BRACKET-WRITE (`@outer[k1][k2]=v`) — v1 shallow receiver check only.

