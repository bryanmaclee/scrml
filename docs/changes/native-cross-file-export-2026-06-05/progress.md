# native-cross-file-export-2026-06-05 — progress

## Phase 0 — root verification

- 2026-06-05: Startup verified. WORKTREE at agent-a48bf500147b36c24, HEAD 6ed518d1, tree clean, bun install + pretest OK.
- Maps consulted: primary.map.md — native-parser-swap routing section confirms loci (collect-hoisted.js synthExportDecl / translate-stmt.js Export arm) + `.js`-only.

### ROOT-2 (collect-hoisted.js synthExportDecl raw="") — CONFIRMED
- FX-2 fixture: default compile clean (0 fatal); native fires E-COMPONENT-020 + E-COMPONENT-035. Confirmed via /tmp/repro-xfile.mjs.
- Native AST probe: export-decl exportedName="Header" exportKind="const" rawLen=0. Confirmed via /tmp/probe-ast2.mjs.
- Mechanism (precise — diverges from brief's "hi overshoots" framing, but same fix direction):
  - LogicEscape block.span.start = 2012 (the `$` of `${`); block.bodyText starts in host at 2014 (after `${`, len 704).
  - Export Stmt span = {2017, 2717} (HOST-absolute, anchored by parseLogicBodyBestEffort bodyAbsStart=frame.openSpan.end).
  - CURRENT calc subtracts blockSpan.start (2012): lo=5 hi=705; guard hi<=704 FALSE -> raw="".
  - CORRECT: subtract bodyText host-start (frame.openSpan.end=2014): lo=3 hi=703; slice = "export const Header = <nav...".
  - Off-by-openerLen: block.span.start is the opener char; bodyText starts at frame.openSpan.end (opener `${`/`^{`/etc = 2 chars).
  - synthComponentDef ALREADY fixed the analogous bug at M6.7-C1 (uses bodyText-relative init.span, no blockSpan.start subtraction).
  - file-top works because synthLiftedLogicBlock sets block.span = textBlock.span AND bodyText = sliceBlockRaw(source, span) -> bodyTextStart == span.start (openerLen 0).
- FIX PLAN: stamp `block.bodyTextStart` (= bodyAbsStart used by parseLogicBodyBestEffort) at the 4 body-attaching sites in parse-markup.js (LogicEscape, Meta, synthLifted, synthPaired); synthExportDecl subtracts bodyTextStart (fallback blockSpan.start, equal in the lifted case).

### ROOT-1 (translate-stmt.js Export arm — exported body drop) — PENDING VERIFY

## Phase 0 — INDEPENDENT RE-VERIFICATION (agent-a48bf500147b36c24, 2026-06-05)

- Startup re-verified: HEAD 6ed518d1, ff-clean, bun install + pretest OK. Maps consulted: primary.map.md (load-bearing: native-parser-swap routing confirms loci + .js-only + .scrml mirrors FEATURE-stale).
- ROOT-2 RE-CONFIRMED empirically via /tmp/probe-root2.mjs + probe-root2b.mjs on header.scrml:
  - LogicEscape block.span={start:2012} (the `$`); bodyText host-start=2014 (frame.openSpan.end, after `${`); bodyText.len=704.
  - Export Stmt span={2017,2717} HOST-absolute (anchored at parseLogicBodyBestEffort bodyAbsStart=frame.openSpan.end).
  - CURRENT: lo=5 hi=705; guard hi<=704 FALSE -> raw="". CORRECTED (subtract bodyStart=2014): lo=3 hi=703 -> "export const Header = <nav...></>" (full, verified bodyText==src.slice(bodyHostStart,...)).
- INVARIANT discovered: bodyText host-start == bodyAbsStart passed to parseLogicBodyBestEffort at ALL 4 body-attaching sites:
  - emitContextBlock InLogicEscape (parse-markup.js:548): bodyStart=frame.openSpan.end (!=block.span.start).
  - emitContextBlock InMeta (parse-markup.js:611): bodyStart=frame.openSpan.end.
  - synthLiftedLogicBlock (parse-markup.js:2254): anchorStart=span.start (==block.span.start, why file-top works).
  - synthPairedLogicBlock (parse-markup.js:2287): anchorStart=span.start.
- FIX PLAN (minimal): stamp `block.bodyStart` = the bodyAbsStart at all 4 sites; thread through walkStmts; synthExportDecl subtracts block.bodyStart (fallback blockSpan.start — equal in lifted/paired case, so no regression to working file-top path).

### ROOT-2 FIX LANDED (agent-a48bf500147b36c24)
- parse-markup.js: stamp `block.bodyStart` = bodyAbsStart at all 4 body-attach sites (InLogicEscape, InMeta, synthLiftedLogicBlock, synthPairedLogicBlock).
- collect-hoisted.js: thread `bodyStart` through walkStmts -> synthExportDecl; synthExportDecl subtracts `bodyStart` (fallback blockSpan.start). synthComponentDef accepts bodyStart but ignores it (init.span is bodyText-relative).
- VERIFIED: header.scrml native export raw 0 -> 700; FX-2 native compiles 0 E-COMPONENT-020/035 (was firing both); Header markup expands into app.html (was empty). app.server.js + app.css byte-IDENTICAL native==default; app.client.js differs only in id-counter offsets (benign) + app.html differs only in verbatim-vs-token-joined whitespace (documented normalizeTokenizedRaw idempotency). node --check both native JS outputs OK.
- cross-file-expansion-integration.test.js 30/0, cross-file-components.test.js 13/0, m6.4a-native-p2-form1.test.js 4/0 (default-mode suites; native parity via direct probe).

### ROOT-1 FIX LANDED (agent-a48bf500147b36c24)
- translate-stmt.js StmtKind.Export arm: when stmt.declaration is FunctionDecl -> push makeFunctionDecl(d) + {exported:true, fromExport:true}; when TypeDecl -> push makeTypeDeclNode(d) + {fromExport:true}; THEN push makeExportDecl. Mirrors live ast-builder EXPORT branch (L8192-8369) which emits BOTH inner decl + export-decl in source order.
- VERIFIED EMITTED: example-22 types.scrml native `badgeColor` body now reaches types.client.js as `function _scrml_badgeColor_N(role){...}` (was ABSENT); full multifile example-22 native: badgeColor emitted + exported via _scrml_modules + imported in components.client.js + referenced in app.client.js; all native client JS node --check OK.
- SCOPE NOTE (deferred): the native badgeColor IIFE is missing the leading `return` AND drops `hasReturnType`/`returnTypeAnnotation` ("-> string") AND models trailing `match` as `bare-expr` not `match-stmt`. CONFIRMED PRE-EXISTING native-parser FunctionDecl-parser gap (reproduces on a NON-exported function too — /tmp/nonexport-fn.scrml). NOT caused by ROOT-1; NOT in ROOT-1 scope. Surfaced to PA.
- Coupled regression test: m6.4a-native-p2-form1.test.js §B (2 tests, emitted-output level): ROOT-2 Badge markup expands in consumer HTML; ROOT-1 add() body reaches lib clientJs + module registry. 6/6 pass.

### ROOT-1 locked-test updates (were locking the OLD buggy single-node behavior)
- native-parser-core-decl-keywords.test.js §2/§3/§6: `export type` and `export fn`/`export server fn` now translate to BOTH inner decl + export-decl (live-parity); §6 corpus sequence updated 6->8 nodes (export type/fn each gain a sibling decl).
- translate-stmt-bridge.test.js §3: `export function` now 2 nodes (function-decl + export-decl). `export const` + re-export UNAFFECTED (out[0] stays export-decl — no inner FunctionDecl/TypeDecl).
- These tests locked the dropped-inner-decl bug; updated to assert the live ast-builder EXPORT-branch shape (inner decl BEFORE export-decl, source order).

## Phase 2 — within-node gate STOP (ROOT-1 DEFERRED to PA)

- bun run test (full, incl browser/within-node) surfaced 64 fail: ALL in the within-node parity gate (compiler/tests/parser-conformance-within-node.test.js — NOT in the pre-commit scope, which excludes it). Baseline confirmed 1005/0 on base source.
- Isolation (per-root, against base):
  - ROOT-2 alone: 6 over-budget (EXTRA-FIELD +1 on each of 6 channel files). CAUSE: my `block.bodyStart` field leaks into the FileAST via a retained `channelDecls[].children[]` raw LogicEscape (verified /tmp/probe-bodystart.mjs). `bodyStart` is native-parser-internal raw-slice metadata with NO live analogue — the classifier's OWN mechanism for this is STRIP_KEYS (alongside `_nativeEngineBlock`). Added `bodyStart` to STRIP_KEYS. NOT masking — it is pipeline-internal metadata. -> ROOT-2 + STRIP_KEYS = 1005/0 GREEN.
  - ROOT-1 alone: 58 over-budget, 6 classes, ~16k total residual (SPAN-COORD 10930 dominant + FIELD-SHAPE 2159 + EXTRA-FIELD 1655 + MISSING-FIELD 1325 + KIND-NAME 319 + COUNT-LENGTH 114). Concentrated in export-heavy stdlib/* + self-host/* (every exported fn adds a function-decl whose whole body subtree is now walked).
- ROOT-1 ROOT-CAUSE of the within-node surface:
  - SPAN-COORD: native deep child spans are DELIBERATELY body-LOCAL (parse-markup.js parseLogicBodyBestEffort comment L693-696: "Deep shifts are deferred — downstream consumers (M5 codegen) read body[] and re-derive spans"). Only the TOP-LEVEL stmt span is host-shifted. The Export's `declaration.span` (and its subtree) stays body-local. VERIFIED: host = bodyStart + local recovers the EXACT live host span (phase1-function-export-004: 31+12=43=live.start, 31+85=116=live.end). My ROOT-1 promotes these unshifted spans into FileAST.nodes where the classifier compares them to live's host spans -> SPAN-COORD.
  - FIELD-SHAPE/KIND-NAME: the native FunctionDecl subtree is NOT field-identical to live (e.g. native models trailing `match` as `bare-expr` not `match-stmt`; native carries `isAsync` field). This is the broader native-parser FunctionDecl-parity gap (the SAME gap that drops the leading `return` — see ROOT-1 emitted note + /tmp/nonexport-fn.scrml; reproduces on NON-exported fns).
- DECISION: per brief STOP-IF-DIVERGENT ("ROOT-2 and ROOT-1 are independent — if only one is mechanical, fix that one and report the other") + "do NOT mass-rebump the allowlist; flag it (PA decides, convergence-vs-masking)" — ROOT-1 REVERTED. ROOT-1's emitted-output fix IS correct (badgeColor reaches codegen, full cross-file binding chain works, node --check OK) but its within-node surface is a PA convergence-vs-masking design decision that requires (a) deep-shift of the promoted inner-decl subtree (the M5-deferred deep-shift) AND (b) FunctionDecl field-parity reconciliation. Both balloon beyond the mechanical decl-emission ROOT-1 was scoped as.
- LANDED (this dispatch): ROOT-2 (collect-hoisted synthExportDecl bodyStart slice + parse-markup 4-site bodyStart stamp) + STRIP_KEYS(bodyStart) + ROOT-2 §B emitted-output regression. Reverted: translate-stmt.js + the 2 unit-test node-count updates + the m6.4a ROOT-1 §B test.
- ROOT-1 RE-DISPATCH PREREQS (for PA): (1) deep-shift the exported inner-decl span subtree by bodyStart at promotion (deterministic — verified); (2) close the native FunctionDecl-parity gap (trailing-match -> match-stmt + return lowering + hasReturnType/returnTypeAnnotation capture); (3) THEN the within-node residual should converge (allowlist update becomes a true downward/zero shift, not masking). Until then ROOT-1's emitted bug (exported fn body dropped under native) stays OPEN.
