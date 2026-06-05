# Progress — native-attrvalue-exprnode-population-2026-06-04

Append-only, timestamped.

## 2026-06-05T03:39:56Z — startup
- WORKTREE_ROOT=/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a248a17853e47f8eb
- pwd verified under .claude/worktrees/agent- ; toplevel == WORKTREE_ROOT ; status clean
- merge 0aa94d2f: clean fast-forward (f11db672..0aa94d2f). HEAD now 0aa94d2f. confirmed.
- bun install OK ; bun run pretest OK (13 test samples compiled to dist)
- maps read in full: primary.map.md (Task-Shape Routing -> native-parser swap-grind),
  domain.map.md "Native-Parser Swap Orientation" (L158-227), structure.map.md
  "Native-Parser File Table" (L211-251). Maps LOAD-BEARING — named THIS dispatch with
  exact loci + consumer list + live anchors (ast-builder.js:1834/1857/1878/2217;
  emit-html.ts:1735/1718/1756/1015; tag-frame.js ~L1079..1153).

## 2026-06-05T03:39:56Z — PHASE 0 survey + placement decision

### Parse function (the shape emit-html expects)
- LIVE uses `safeParseExprToNodeGlobal(raw, filePath, valSpan?.start ?? 0, errors)`
  (ast-builder.js:227) which wraps `parseExprToNode(raw, filePath, offset)`
  exported from compiler/src/expression-parser.ts:1993.
- This is the CANONICAL live ExprNode producer (also imported by emit-event-wiring,
  emit-bindings, emit-table-for, type-system, etc). Native MUST produce the IDENTICAL
  shape — NOT native's own parse-expr.js AST.
- Decision: reuse `safeParseExprToNodeGlobal` itself (handles escape-hatch / SQL E-SQL-008 /
  §6.8.2 reset diagnostics / try-catch — byte-identical to live's behavior).

### WHERE to populate — site decision
- Candidate (a) tag-frame.js construction: REJECTED. tag-frame.js (and all of native-parser/)
  imports ONLY from native-parser/ primitives (cursor/span/block-context/error-recovery/
  body-mode). Importing the live acorn-backed parseExprToNode INTO native-parser would
  INVERT the self-host layering (native-parser is a .js bootstrap mirror of .scrml; it must
  not depend on compiler/src/ live pipeline). Architecturally wrong.
- Candidate (b) compiler/src/-resident post-AST pass: CHOSEN. Mirrors the existing
  native->live fixup pattern (native-walker/engine-statechild-walker.ts is a compiler/src/
  walker LIVE code calls on native-produced blocks). api.js already runs pipeline-agnostic
  post-AST passes (PRECG: computePGOFlags / computeProgramConfig) that MUTATE the native
  FileAST. A native-only exprNode-population pass slots into the same seam.

### Offset source
- Native attr-value carries `span: makeSpan(valStart, end, line, col)` => `{start,end,line,col}`
  (span.js:15). `val.span.start` == live's `valSpan.start`. No multi-stage offset threading
  needed — the base offset is already on the node.

### Scope (per-kind, mirror live exactly)
- exprNode SET on: kind "expr" (raw = expr text) + kind "variable-ref" (name = ident).
  Live sets it at 1834 (variable-ref), 1857 (expr/block), 1878 (expr), 2217 (variable-ref).
- exprNode NOT set on: string-literal, props-block, call-ref (uses argExprNodes), absent,
  dotted-ident, wildcard (native-specific, no live equivalent). Matches live.

### DECISION GATE: PROCEED
- Localized population at ONE compiler/src/ pass, reusing the live parse fn, offset already
  carried on node (val.span.start). NOT a multi-stage infra change. Gate -> PROCEED.

## 2026-06-05T03:54:39Z — implementation + R26 (B) PASS

### What changed
1. compiler/src/ast-builder.js — EXPORT `safeParseExprToNodeGlobal` (was module-internal).
   Enables reuse of the EXACT live parse path for byte-parity. Commit b6242cf9.
2. compiler/src/native-walker/attrvalue-exprnode-walker.ts (NEW) —
   `populateNativeAttrValueExprNodes(ast, filePath, errors)`: iterative FileAST walk
   (mirrors normalizeNativeFileAST discipline) that stamps the live parsed-expr fields
   on native attr values that lack them:
   - kind "expr" / "variable-ref" -> `exprNode` (ast-builder.js 1834/1857/1878/2217).
   - kind "call-ref" -> `argExprNodes` (ast-builder.js 1831-1832): map every arg through
     safeParseExprToNodeGlobal, set ONLY when every arg parsed (else undefined).
   - Idempotent (hasOwnProperty guards); never touches string-literal/props-block/
     absent/dotted-ident/wildcard (matches live).
3. compiler/src/api.js — import the walker; native `_buildAST` branch runs it on
   result.ast right after nativeParseFile, pushing parse diagnostics into result.errors
   (collectErrors("TAB", ...) picks them up exactly as live does). Native-path-ONLY.

### KEY DISCOVERY (refines Phase-0 scope)
The headline R26 fixture's handler `onclick=@dragPhase.advance(.Drop("done"))` parses as
`kind:"call-ref"` (name "@dragPhase.advance", args [".Drop(\"done\")"]) on BOTH live and
native — NOT `expr`/`variable-ref`. Live populates `argExprNodes` (1831-1832); native
did not. So the SAME parsed-expr-field gap spans TWO live fields: `exprNode` (expr/
variable-ref) AND `argExprNodes` (call-ref). The walker covers both. Verified: live probe
shows call-ref + argExprNodes(1); native probe pre-fix shows call-ref + argExprNodes=undefined.

### R26 (B) — engine-message-dispatch-s6.scrml (the headline)
- default exit 0 ; native exit 0
- diff -r /tmp/r26-exprnode/{default,native}  => BYTE-IDENTICAL
- dispatch markers (_scrml_engine_dispatch_message|_msg_arms): native 4 == default 4
- node --check native *.client.js => exit 0 (native JS parses)
- grep -cE 'E-CODEGEN-INVALID-JS|E-UNQUOTED' native.log => 0
- The message-dispatch family is now FULLY native-parity end-to-end (S164 message-arm
  fix + this exprNode/argExprNodes fix).

## within-node parity (canary) — analysis + rebump + FLAG

### Canary was UNDER-measuring (raw nativeParseFile, not the pipeline)
The within-node canary (parser-conformance-within-node.test.js runBothPipelines) drove
RAW `nativeParseFile` — it did NOT run the api.js-level populateNativeAttrValueExprNodes
pass. So pre-change it never saw the populated AST. Wired the pass into runBothPipelines
(mirrors api.js) so the canary compares what the pipeline actually feeds codegen.

### Aggregate deltas (with pass wired in)
  MISSING-FIELD : 31790 -> 30569  (-1221)   <- convergence (native now carries exprNode/argExprNodes)
  SPAN-COORD    : 38004 -> 38102  (+98)      <- benign, see below
  EXTRA-FIELD   : 12584 -> 12585  (+1)       <- benign, see below
  KIND-NAME     : 3018  -> 3018   (0)        <- UNCHANGED (no shape divergence)
  FIELD-SHAPE   : 10577 -> 10577  (0)        <- UNCHANGED (no shape divergence)

### Root-cause of the +98 SPAN-COORD / +1 EXTRA-FIELD (proven benign)
The exprNode/argExprNodes SUBTREE is byte-identical to live in NON-lift contexts:
  - 08-chat top-level `if=(@draft.trim().length > 0)`: live value.span.start == native
    value.span.start (5357 == 5357) -> exprNode deep span-diff = 0 (verified).
The residuals cluster in LIFT/EACH markup-as-value subtrees, where native's value.span
carries a LOCAL offset, not the file-absolute offset live uses:
  - customers.scrml `onclick=toggle(c.id)` (inside an each over customers): live
    value.span.start = 5224, native value.span.start = 168 (LOCAL). The argExprNode for
    `c.id` is structurally identical (kind:member, object:ident c, property:id) but its
    span inherits the wrong base (168 vs 5224).
This value.span LOCAL-offset divergence is PRE-EXISTING (identical with AND without the
pass) — independent of exprNode population. My pass merely makes it VISIBLE in the parsed
subtree (previously the absent exprNode was a short-circuiting MISSING-FIELD). I faithfully
pass `val.span.start` exactly as live passes `valSpan.start`; I do NOT introduce the gap.

### REBUMP (S163 precedent — benign SPAN-COORD/EXTRA-FIELD only)
18 files rebumped to their new raw counts (17 SPAN-COORD small increases + 1 EXTRA-FIELD).
ZERO FIELD-SHAPE / KIND-NAME / MISSING-FIELD-increase bumps. within-node 1005/0 after.

### FLAG (surfaced, NOT masked — for PA)
Native's markup attr-VALUE `span.start` is a LOCAL (block-relative) offset, not the
file-absolute offset live carries, inside LIFT/EACH markup-as-value subtrees. This is a
separate pre-existing native span-fidelity gap (NOT introduced here). It now propagates
into the populated exprNode/argExprNodes spans in those contexts. Out of scope for this
dispatch (the task is exprNode PRESENCE + shape parity, both achieved); recommend a
follow-up native-parser ticket to thread the file-absolute offset for attr values inside
lift/each subtrees. Top-level (non-lift) attr-value exprNodes are byte-identical to live.
