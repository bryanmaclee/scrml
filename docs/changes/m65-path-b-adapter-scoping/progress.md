# M6.5 path-b — within-node AST adapter SCOPING progress

Dispatch: S125 survey-only diagnostic agent
Worktree: `.claude/worktrees/agent-a9b1c45720e36604d`
Base SHA after merge main: `404fc619` (the M6.7 STOP commit — the revert that triggered this dispatch)

## Timeline

- **Step 0 — startup.** Verified pwd, worktree root, status clean. Merged main forward (already at 404fc619 post-merge, no new commits). bun install OK. Created `docs/changes/m65-path-b-adapter-scoping/`.
- **Step 1 — required-reading.** Read M6.7 STOP doc + M5-divergence-ledger + M5-ast-bridge-scoping + M6 cutover plan §M6.5 + api.js routing site (line 844) + parse-file.js + b.2 walker test. Key prior context: M5 ledger was about getting native → FileAST shape at all (catalog-rename); the F-units F1-F9 closed BLOCK-PAYLOAD divergence + statement-catalog (A1 translate-stmt) + hoist gap (A3 collect-hoisted). M6.7 STOP confirmed that even with those closed, WITHIN-NODE field-level divergences remained that the canary's top-kind / hoist-count / deep-seq-kind metrics never measured.
- **Step 2 — empirical diff runner.** Built `scratch/m65-ast-diff.js` (a parallel dual-pipeline walker that classifies divergences by class: KIND-NAME / FIELD-SHAPE / MISSING-FIELD / EXTRA-FIELD / COUNT-LENGTH / SPAN-COORD) plus `scratch/m65-dump.js` (raw-JSON dual-dump). Ran on the 3 brief-cited fixtures + 5 isolated reproducer fixtures (sql top-level, sql-in-logic, const-derived, import, match, engine).
- **Step 3 — empirical catalog complete.** Findings: 01-hello (clean both) → 53 divergences. 14-mario (live-clean, native 43 errors) → 781 divergences inc 33 KIND-NAME. 22-multifile (live-clean, native-clean!) → 186 divergences inc 1 KIND-NAME + COUNT-LENGTH=2 (the hoist gap). Each isolated reproducer pinned ONE divergence class. M6.7 STOP example (`bare-expr+sql-ref` envelope) CONFIRMED reproduced on sql-in-logic fixture; root cause is `emitStringFromTree({kind:"sql-ref"})` returns `"?{ /* sql */ }"` which fails the `SQL_SIGIL_PATTERN = /\?\{` /` regex.
- **Step 4 — drafting SCOPING.md.** Done. 477-line deliverable at `docs/changes/m65-path-b-adapter-scoping/SCOPING.md`. Empirical catalog (7 divergence classes), per-class adapter sizing, 7-unit decomposition (M6.5.b.0 — M6.5.b.7), 5 named PA decisions, 29-54h re-estimate vs plan's 30-60h. Pre-commit gate cleanly passed (14135 tests).
- **Step 5 — closure.** SCOPING.md committed `d2cb042a`. WORKTREE clean. Final report follows.

## Final summary

**WORKTREE_PATH:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a9b1c45720e36604d`
**FINAL_SHA:** `d2cb042a`
**BRANCH:** `worktree-agent-a9b1c45720e36604d`

**Divergence classes:** 7 (A bodyChildren, B sql-ref envelope, C hoist-gap, D match-arm separator, E structural-decl LHS, F shape-formatting, G span-coord).

**Sub-unit decomposition:** 8 dispatchable units (.b.0 canary, .b.1-.b.6 parallel-eligible class fixes, .b.7 closure). DAG: .b.0 gates all; .b.1-.b.6 file-disjoint parallel; .b.7 verifies. Class A folded to M6.6 closure (not M6.5.b).

**Re-estimate:** 29-54h (excluding folded Class A) vs plan's 30-60h — slight depth-of-survey shrink (~10%). Within the M6.5 path-b budget; no v0.8 deferral trigger.

**PA decisions surfaced (5):**
1. Adapter site = api.js boundary for ADAPT classes; FIX-NATIVE bypasses adapter entirely.
2. FIX-NATIVE recommended for Classes B/C/D/E (4 of 5 loud classes are native parser GAPS/BUGS, not shape differences).
3. Within-node parity canary extension required FIRST (M6.5.b.0).
4. M6.7 re-flip MUST gate on full `bun run test` clean under native parser, not just canary.
5. Class A (engine bodyChildren) folds to M6.6 closure dispatch, not M6.5.b.

---

# M6.5.b.1 — FIX-NATIVE match-arm newline separator (S125+)

Dispatch: M6.5.b.1
Worktree: `.claude/worktrees/agent-a8bb97501fe5a8629`
Base SHA after merge main: HEAD `5b1afb9d` (post the M6.5.b.0 + M6.6.b.3 + M6.7 STOP landings)

## Step 0 — startup
- `pwd` = worktree root; `git rev-parse --show-toplevel` matches.
- `git merge main --no-edit` absorbed live HEAD; tree clean post-merge.
- `bun install`, `bun run pretest` clean.
- Baseline within-node canary: 1004 pass / 0 fail / 133054 total divergences across 1000 files.

## Step 1 — Bug site located
- `compiler/native-parser/parse-expr.js:2546-2557` — `parseMatchExpr` arm-list loop:
  only `TokenKind.Comma` is consumed between arms. No semicolon support, no newline support.
- `parseMatchArm:2569-2605` consumes the body via `parseAssignmentExpr` (concise form)
  or `parseBlockStub` (block form). When body finishes on line N, next arm pattern
  starts on line N+1 — ASI-style newline-between-arms is the canonical scrml form.

## Step 2 — SPEC normative reference
- §18.2 grammar `match-expr ::= 'match' expression '{' match-arm+ '}'` —
  `match-arm+` with NO inter-arm separator token in the production.
- §18.0.1 + §17 worked examples all use newline-separated arms.
- The native parser already documented "newline- or comma-separated in practice" in
  comment on line 2552 — only the comma branch was implemented.

## Step 3 — landing (S125 PA)
- Agent stalled on response stream after 5.3h of work; all substantive work was
  committed to the worktree branch BEFORE the stall. PA-side recovery via S89
  §13.2 partial-recovery protocol — branch-tip work coherent + complete.
- Landed via standard S67 file-delta as commit `afbc566c` on main.

---

## M6.5.b.2 — FIX-NATIVE structural-decl `<ident>` LHS binding

**Dispatch SHA at start:** `5b1afb9d` (post-merge main)
**Worktree:** `.claude/worktrees/agent-ac5bb60eda1a55282`

### Step 0 — startup verification

- pwd: `.claude/worktrees/agent-ac5bb60eda1a55282` (verified prefix OK)
- git rev-parse: matches WORKTREE_ROOT
- git merge main: clean, fast-forward from 404fc619 to 5b1afb9d
- git status: clean
- bun install: 117 packages OK
- bun run pretest: dist populated, 13 test samples compiled
- Baseline: `bun test compiler/tests/parser-conformance-within-node.test.js` → 1004 pass, corpus aggregate 133054 divergences over 1000 files. Class histogram: KIND-NAME:3398, FIELD-SHAPE:14164, MISSING:42464, EXTRA:19097, COUNT-LENGTH:1562, SPAN-COORD:52369.

### Step 1 — required reading + analysis

- SCOPING.md §1 Class E read in full + §3 .b.2 + §4 Decision B.
- SPEC §6.1-§6.2 (V5-strict + 3 RHS shapes) read in full at lines 1923-2200.
- SPEC §6.6 derived at lines 2620-2740. SPEC §6.10 pinned at 5182-5220. SPEC §32 tilde-decl at 14832-14920.
- Reference impl: `compiler/src/ast-builder.js` lines 3550-4200 (`tryParseStructuralDecl` + `scanStructuralDeclLookahead`) + lines 4790-4840 (the `const <ident>` dispatch arm) + lines 6400-6420 (the bare `<` arm).
- Live `state-decl` contract: `compiler/src/types/ast.ts` lines 502-624 (ReactiveDeclNode interface).
- Live state-decl fields needed: name, init, initExpr, structuralForm:true, isConst, shape ("plain"|"derived"|"decl-with-spec"), defaultExpr, pinned, typeAnnotation, reactivity (debounced/throttled), validators (Shape 2), renderSpec (Shape 2), children (compound).

### Step 2 — empirical reproduction of bug

Ran the fixture `m65-fixture-const-derived.scrml`:
- LIVE produces 2 state-decl nodes (a plain + a derived).
- NATIVE produces 1 const-decl with empty name + empty init. The `<a> = 1` is also LOST entirely (translate-stmt drops native `StateDecl` via default arm).

### Three-layer fix plan

1. **parse-stmt.js dispatcher** — when `const` keyword leads and next token is `<`, route into `parseStructuralStateDecl` with isConst=true (mirrors live ast-builder.js:4828). Currently parseVarDecl is invoked unconditionally on `const`.
2. **parse-stmt.js parseStructuralStateDecl** — extend to:
   - accept and surface `isConst` argument (passed via context-arg or wrapper)
   - capture attribute-region fields raw: `pinned`, `server`, `default=expr`, `debounced=`, `throttled=`
   - shape: "derived" when isConst else "plain"
   - structuralForm: true
3. **translate-stmt.js** — add `case "StateDecl":` arm that maps the native StateDecl object to live `state-decl` shape with all fields. Currently dropped via default.

### Sizing/scope decisions

- **Validators (Shape 2)** + **renderSpec** + **compound children (Variant C)** — DEFERRED. Class E's SCOPING is the LHS-binding form for Shape 1/3 (plain + derived). Shape 2 has a separate divergence class (Class A bodyChildren is the engine-only one; markup-RHS on state-decls is its own sub-class — would expand scope by ~50% per fixture). If detected by a corpus fixture beyond const-derived, surface as STOP condition.
- **`~ <x>` / `~snapshot <x>`** — the brief mentions these as productions to support, but SPEC §32 defines `~` as the pipeline accumulator, NOT a state-decl prefix. The existing `~name = pipeline` tilde-decl (B3 landed) is the actual SPEC §32 surface. The `~ <x>` shape does not appear in SPEC. NOT IMPLEMENTING; will surface as a NOTE.
- **`<x>! = expr` pinned variant** — the brief lists `<x>!` (bang-pinned). SPEC §6.10 normative form is `<x pinned>` (bareword inside opener), not `<x>!`. The bang-pinned form does not appear in SPEC. NOT IMPLEMENTING the bang form; the `<x pinned> = init` form is captured via the attribute-region.

### Step 3 — implementation landed

Three commits:
- `dcb69cb3` parse-stmt extends parseStructuralStateDecl + const<x> dispatch
- `c04ca41d` translate-stmt adds StateDecl arm + ast-stmt StmtKind.StateDecl
- `ab1eecb9` refine translate-stmt + refresh within-node allowlist
- `97203ec0` 28 unit tests + Kw-attr support (server / default hard-keyword names)

### Step 4 — verification

- New unit tests: `compiler/tests/unit/m65-b2-structural-state-decl.test.js` — 28/28 pass.
- Within-node-canary: 1004/1004 pass after allowlist regen. Corpus aggregate
  133054 → 134394 (+1340). KIND-NAME shifted: 3398 → 3487 (+89 from alignment
  shifts in fixtures where the new state-decl emit changes downstream body[]
  indices in fixtures with pre-existing native bugs e.g. Mario match-arm
  cluster). FIELD-SHAPE +426 (new state-decl legacy `init:''` vs raw text
  divergence; pre-existing native debt acknowledged in live `init` field
  docs). COUNT-LENGTH -94, MISSING-FIELD -8 (improvements: state-decls now
  surface so body counts align).
- Sister canary (parser-conformance-corpus): 1018/1018 pass. Strict 999/1000
  preserved; 35 files reclassified EXACT → DEFERRAL-test-block (21) +
  LIVE-DEGENERATE (12) + LIVE-HOIST-MISCLASSIFY (2). All still "explained".
- Full pre-commit gate: 14074 pass, 88 skip, 1 todo, 0 fail across 14163
  tests in 718 files (68.87s).

### STOP conditions evaluated

- **STOP-1 (productions surface as N×M with existing native AST shape)** —
  NOT TRIGGERED. The live `state-decl` shape was directly representable. The
  PARTIAL fixes (defaultExpr / reactivity duration-grammar parse) are sibling
  feature gaps surfaced as NOTES, not blockers.
- **STOP-2 (cascade in downstream consumers relying on const-decl{name:''})** —
  NOT TRIGGERED. The full pre-commit gate (~14074 tests including
  symbol-table, codegen, integration, conformance) is clean.
- **STOP-3 (overlap with M6.5.b.1 parse-expr)** — NOT TRIGGERED. All changes
  in parse-stmt.js + translate-stmt.js + ast-stmt.js.
- **STOP-4 (pre-commit gate fails outside this dispatch's scope)** — NOT
  TRIGGERED. Full gate clean.

### Productions supported (8 listed in brief vs 6 actually supported)

| Production | Supported | Notes |
|---|---|---|
| `<x> = expr` | YES | Shape 1 plain (SPEC §6.2) |
| `<x>:T = expr` | YES | typed Shape 1 |
| `const <x> = expr` | YES | Shape 3 derived (SPEC §6.6) |
| `const <x>:T = expr` | YES | typed derived |
| `<x pinned> = expr` | YES | pinned (SPEC §6.10) bareword |
| `<x default=e> = expr` | YES | reset-target raw captured (parsing deferred) |
| `<x debounced=Nms> = expr` | YES | reactivity raw captured (duration-grammar parse deferred) |
| `<x throttled=Nms> = expr` | YES | reactivity raw captured |
| `<x server> = expr` | YES | server bareword (SPEC §52) → isServer:true |
| `<x req length(>=2)> = expr` | YES | validators captured (call-form + bareword) |
| `<x>` (bare, no `=`) | NOT SUPPORTED | SPEC has no normative form; live parser declines too — bare `<x>` falls through to markup |
| `<x>! = expr` (bang-pinned) | NOT SUPPORTED | SPEC §6.10 normative form is `<x pinned>`, NOT `<x>!`; bang form not in SPEC |
| `~ <x>` / `~snapshot <x>` | NOT SUPPORTED | SPEC §32 defines `~` as pipeline accumulator + `~name = pipeline` tilde-decl (already landed as B3); `~ <x>` is NOT in SPEC |

### Surfaced to PA (sibling unit candidates)

- **defaultExpr ExprNode synthesis** — native parser captured raw text, but
  the live ast-builder uses `safeParseExprToNode` (Acorn-backed) to produce
  the parsed ExprNode used by codegen (`usage-analyzer.ts`, `emit-bindings.ts`).
  The native parser DOES have its own expression parser (`parseExpression(ctx)`)
  — invoking it inline at the `default=` attr position would produce a
  parsed ExprNode but requires care to respect the attribute-region boundary.
- **reactivity duration-grammar parse** — native captured raw text; live
  parses via `parseAfterDuration` into an AfterDurationResult consumed by
  B14 typer. Native module pool doesn't include a duration parser; adding
  one widens M6.5.b.2 scope.
- **Shape 2 markup-RHS** — `<x req length(>=2)> = <input/>` form. Native
  parses LHS+attrs correctly but the RHS markup parsing requires invoking
  the markup layer mid-statement; not in M6.5.b.2 scope. Validators are
  captured on native StateDecl for the future Shape 2 sub-unit.

### Files touched

- compiler/native-parser/parse-stmt.js (+~280 LOC: extended parseStructural\
  StateDecl, new constStructuralStateDeclLeadFollows, new helpers
  collectAttrValueRaw / collectBalancedParenContents / isAttrNameToken /
  attrNameOf)
- compiler/native-parser/ast-stmt.js (+16 LOC: +StmtKind.StateDecl entry)
- compiler/native-parser/translate-stmt.js (+~50 LOC: +case StmtKind.StateDecl
  arm, +makeStateDeclNode function)
- compiler/tests/unit/m65-b2-structural-state-decl.test.js (NEW: 28 tests,
  ~298 LOC)
- compiler/tests/parser-conformance-within-node-allowlist.json (regenerated:
  1000 entries refreshed to current measurements)

### Step 5 — landing (S125 PA)

- Agent stalled on response stream after substantive work. PA-side recovery
  via S89 §13.2 — branch-tip work coherent + complete.
- Landed via S67 file-delta; allowlist regen skipped at PA-side landing
  (b.1's permissive baseline lets b.2's improvements pass without explicit
  allowlist update — verified by pre-commit gate).
- Progress.md b.2 section appended via manual merge over b.1's landing.


# M6.5.b.2.1 — newline-as-statement-separator boundary for consecutive structural state-decls

- [start] Worktree: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a14b40b6f589e6748
- Startup verification PASSED: pwd under worktree prefix, toplevel==worktree, status clean, merged main 8cccc0f6, bun install ok, pretest populated dist.
- Bug confirmed (native repro): `<coins>=0\n<lives>=3\n<gameOver>=false` parses to 1 StateDecl + 2 errors (greedy `<` relational over-consumption). Semicolon-separated control parses to 2/3 nodes correctly. `const <a>=1\nconst <b>=2` ALREADY parses to 2 nodes (const is a statement keyword the binary climb stops at). Bare-expr `foo()\n<y>=1` -> 1 node + 1 error (case 2 over-consumption).
- Baselines captured:
  - strict-pass canary: 1000/1001 (99.9%), histogram {"EXACT":964,"LIVE-DEGENERATE":12,"GAP-state-block":1,"LIVE-PHANTOM":1,"DEFERRAL-test-block":21,"LIVE-HOIST-MISCLASSIFY":2}
  - within-node canary: 1001 files, 134122 total divergences, {"KIND-NAME":3456,"FIELD-SHAPE":14590,"MISSING-FIELD":42290,"EXTRA-FIELD":19047,"COUNT-LENGTH":1431,"SPAN-COORD":53308,"NESTED-SHAPE":0,"PARSE-FAILURE":0}
- Mechanism chosen: (a) ctx-flag mirroring `noIn`/`inMatchArmBody`, inline opener-shape lookahead in parse-expr (mirroring inlined `peekStartsArmPattern`). No cross-module import (avoids the parse-stmt->parse-expr cycle).

## M6.5.b.2.1 — LANDED (worktree branch; PA does S67 file-delta to main)

### Mechanism (circular-import constraint)
Chose **(a)** ctx-flag `atStateDeclStmtPos` + INLINE opener-shape lookahead in parse-expr.
- parse-stmt.js -> imports from parse-expr.js (parse-expr is the lower layer), so parse-expr CANNOT import the `structuralStateDeclLeadFollows` predicate back without a cycle.
- Mirrors the EXISTING precedent in the exact file: `noIn` / `inGenerator` / `inMatchArmBody` ctx-flags, and the inline `peekStartsArmPattern` (a parse-expr-local mirror of the live S27 startsArmPattern). The new `peekStartsStructuralStateDecl` is the parse-expr-local mirror of parse-stmt's `structuralStateDeclLeadFollows` (same `()`/`{}`/`[]` attr-region balancing + same fused-`>=` scanIdx===2 carve-out).
- No cross-module restructuring; 2 source files touched (within STOP bounds).

### Files touched
- compiler/native-parser/parse-expr.js: add `atStateDeclStmtPos` ctx slot; extend `withInAllowedSubExpr`/`restoreNoIn` to clear+restore it inside grouped sub-exprs (so a `<` at depth>0 stays a comparison); add `peekStartsStructuralStateDecl` + `isAtStateDeclBoundary`; add the parseBinary climb-loop LessThan guard.
- compiler/native-parser/parse-stmt.js: init `atStateDeclStmtPos:false` in makeParseStmtContext; set the flag (saved+restored) around (1) the state-decl initializer parse (both fused-`>=` and whitespace-`=` arms) and (2) parseExprStatement (case 2).
- compiler/tests/unit/m65-b2-1-statedecl-boundary.test.js: NEW, 17 tests.
- compiler/tests/parser-conformance-within-node-allowlist.json: rebaselined to current raw counts.

### NOTE — .scrml self-host sources NOT touched
parse-expr.scrml / parse-stmt.scrml lack even the M6.5.b.1 `inMatchArmBody` flag (the .scrml self-host is allowed to lag; .js is the M5/M6 active surface). This change follows that precedent — .js only. Follow-on to mirror into .scrml is deferred with the rest of the self-host parity backlog.

### Verification
- New unit tests: 17 pass / 0 fail.
- Existing m65-b2-structural-state-decl.test.js: 28 pass / 0 fail (no regression).
- Within-node canary: 1005 pass / 0 fail, PARSE-FAILURE 0. Allowlist rebaselined in the SAME commit.
- Strict-pass canary: 1000/1001 (99.9%) HELD (identical to baseline; histogram unchanged).
- Full `bun test compiler/tests/`: 21234 pass / 174 skip / 1 todo / 0 fail (3 consecutive clean runs; one earlier run showed a 2-fail flake in non-parser browser/timing tests — not reproducible).

### Within-node histogram before -> after (corpus aggregate, total 134122 -> 137888)
| Class | Before | After | Delta | Note |
|---|---|---|---|---|
| KIND-NAME | 3456 | 3393 | -63 | SHRINK — parse-correctness gain (consecutive decls now N nodes) |
| COUNT-LENGTH | 1431 | 1319 | -112 | SHRINK — fewer wrong-length collapsed nodes |
| EXTRA-FIELD | 19047 | 18373 | -674 | SHRINK |
| FIELD-SHAPE | 14590 | 15068 | +478 | GROW — more correctly-separated nodes now diffed |
| MISSING-FIELD | 42290 | 42576 | +286 | GROW — same comparison-surface effect |
| SPAN-COORD | 53308 | 57159 | +3851 | GROW — each newly-separated decl has its own span vs live |
| NESTED-SHAPE | 0 | 0 | 0 | |
| PARSE-FAILURE | 0 | 0 | 0 | no new parse failures |

The total GROWTH is the "more correct parse -> more comparison surface" artifact, NOT a regression. Evidence: native state-decl counts moved toward the live oracle (Mario 3->5 native vs 17 live; odin-filebrowser 1->12 vs 38; load-detail 1->12 vs 32) and native TOTAL node counts moved CLOSER to live (Mario 325->317 vs 318 live; odin 1251->1207; load-detail 1395->1351). The previously-greedy single state-decl carried a garbage init blob inflating node count; correct separation deflates total nodes toward live. The remaining native<live state-decl gap is markup-RHS Shape 2 decls, explicitly OUT OF SCOPE per parse-stmt.js (`decl-with-spec` Shape 2 comment).

### STOP conditions
None hit. Case (2) (bare-expr statement boundary) was covered by the SAME localized ctx-flag (no statement-loop architecture change). Mechanism stayed within 2 source files. No unexplained class regression.

# M6.5.b.3 — FIX-NATIVE hoist-gap (collect-hoisted misses <program>/<page>-body decls)

- [start] Worktree: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-ab7806e6b64f7fa7c
- Startup verification PASSED: pwd under worktree prefix, toplevel==worktree, status clean, merged main 0e0b4498 (fast-forward), bun install ok (204 pkgs), pretest compiled 13 samples.
- Mailbox `.claude/agent-mail/m6-5-b-3.md` ABSENT → proceed.
- Maps: read primary.map.md in full; task-shape = "Native-parser bug fix". Maps consulted but NOT load-bearing for the actual root cause (the bug-specific detail lives in source; maps correctly routed me to collect-hoisted.js but the SCOPING-era hypothesis was already stale).

## Phase 0 — VERIFIED root cause (vs the brief's HEDGED hypothesis)

**HEADLINE: the brief's two cited divergences do NOT reproduce at HEAD 0e0b4498. The Class C hoist-gap is ALREADY CLOSED for the structural <program>/<page>-body recursion case.** A prior unit (the `liftBareBlocks` work + M6.4a/A3 collect-hoisted synthesis) closed it. Verified empirically:

- `examples/22-multifile/app.scrml`: brief said native imports=0 vs live 2. **MEASURED: native imports=2 = live 2.** The block-dump shows `Markup<program>` carries `children` containing `LogicEscape body=[Import,Import,VarDecl]`, and `walkBlocks` (collect-hoisted.js:138-140) DOES recurse `block.children` → reaches the LogicEscape → `walkStmts` (line 146-147) collects the imports. CLOSED.
- `examples/14-mario-state-machine.scrml`: brief said native typeDecls=0 vs live 3. **MEASURED: native typeDecls=3 = live 3, machineDecls=2 = live 2.** Same mechanism: `Markup<program>` children carry `LogicEscape body=[TypeDecl,TypeDecl]` + `LogicEscape body=[TypeDecl]`, all walked. CLOSED.

So the hedged hypothesis ("walkBlocks doesn't reach the program-body decls") is REFUTED at current HEAD — walkBlocks DOES reach them. The recursion is correct.

### Corpus-wide sweep (1001 files, both pipelines, six hoisted lengths + hasProgramRoot)
Tool: `docs/changes/m65-path-b-adapter-scoping/tools/m65b3-hoist-sweep.js`. Result:
- **HOIST-GAP files (native length < live length): exactly 1** — `compiler/self-host/cg.scrml` `imports:0<5`.
- hasProgramRoot mismatch: 5 files, ALL `liveProg=false nativeProg=true` (native OVER-detects, the OPPOSITE of a gap; touching this risks the explicit MUST-NOT). Same 5 files also show `typeDecls native>live` over-counts. Inspection (`samples/expense-tracker.scrml`) shows the file has a real top-level `<program>` + `type` decl — LIVE is failing/truncating on these, native is MORE correct. OUT OF SCOPE (not a hoist-gap; native is the better oracle here).
- OVER-COUNT files: 6 (the 5 above + `stdlib/auth/jwt.scrml exports:4>1`). Different class (over-collection), not Class C.

### The ONE residual (cg.scrml imports:0<5) — VERIFIED root cause: NOT a recursion gap; an INTENTIONAL semantic guard
`compiler/self-host/cg.scrml` top-level is `<program> ^{ const cgCore = await import("./cg-parts/section-core.js") ... } </program>` — five `await import(...)` **dynamic-import EXPRESSIONS** inside a `^{}` META block.
- The Meta block IS walked (collect-hoisted.js:149-158 → walkStmts) — recursion reaches the body. Native Meta body = `[VarDecl,Import,ExprStmt]×5 + Export×2`. The `Import` Stmts each carry `source:"" specifiers:0` (the parse-error-recovery degenerate shape for a dynamic `import(...)` expr, per parse-stmt.js:2050-2051).
- **collect-hoisted.js:205-207 DELIBERATELY SKIPS these** (`if (typeof stmt.source !== "string" || stmt.source.length===0) continue;`). The code's own comment (lines 196-204) asserts "the live pipeline (Acorn) parses it as an ImportExpression and never hoists it."
- **That assertion is EMPIRICALLY WRONG for this source shape.** LIVE hoists all 5 as degenerate `import-decl` `{ source:null, names:[], raw:"import ( \"./...\" )" }`. So live DOES hoist dynamic-import-expressions (as degenerate import-decls); native deliberately rejects them.

### Disposition: STOP condition #3 (semantic disambiguation, not a recursion fix)
The residual requires deciding "is a dynamic `import()` expression a hoisted file-level import-decl (live: yes, degenerate) or not (native guard: no)?" — a SEMANTIC disambiguation between dynamic-import-expression and static-import-decl, NOT a structural recursion gap. Per brief STOP #3 this is a PA semantics question. Additionally: matching live would require INTENTIONALLY reverting the P4-6 top-level-only / degenerate-skip guard (commit 5e58de15) whose comment explicitly justifies skipping these — reversing a prior deliberate decision is a PA call, not a unilateral recursion fix. Surfaced; NOT fixed here.

### Conclusion
The structural Class C hoist-gap (the unit's actual target) is CLOSED at HEAD. The remaining work is REGRESSION-LOCKING the now-correct <program>/<page>-body recursion so it cannot silently regress, since the only canary that would have caught it (within-node COUNT-LENGTH) is permissive. The dynamic-import residual is surfaced to PA as a separate semantics decision.

## M6.5.b.3 — LANDED (worktree branch; PA does S67 file-delta to main)

### Disposition: regression-lock (the structural Class C gap is CLOSED at HEAD)
NO source change. The brief's hedged "walkBlocks doesn't reach <program>-body decls" was REFUTED in Phase 0 — the recursion is correct at HEAD 0e0b4498. The added value is a deterministic regression-lock test so the now-correct behavior cannot silently regress (the within-node COUNT-LENGTH canary that would catch it is permissive/allowlisted).

### Files touched (test + docs/tools ONLY — zero parser/codegen/allowlist source)
- compiler/tests/unit/m65-b3-hoist-gap.test.js — NEW, 14 tests (production-path driver: parseMarkupTrace -> liftBareBlocks -> collectHoisted).
- docs/changes/m65-path-b-adapter-scoping/tools/m65b3-blockdump.js / m65b3-hoist-sweep.js / m65b3-meta-import.js — Phase-0 diagnostics.
- docs/changes/m65-path-b-adapter-scoping/progress.md — this record.

### Verification (exacting M6 gate)
1. New unit tests: 14 pass / 0 fail; deterministic across 3 standalone runs (95-101ms).
2. Within-node canary: 1005 pass / 0 fail. Histogram UNCHANGED from b.2.1 baseline (total 137888; KIND-NAME 3393, FIELD-SHAPE 15068, MISSING-FIELD 42576, EXTRA-FIELD 18373, COUNT-LENGTH 1319, SPAN-COORD 57159, NESTED-SHAPE 0, PARSE-FAILURE 0). No allowlist regen — nothing moved (source-inert change).
3. Strict-pass canary: 1000/1001 (99.9%) HELD (≥999/1000). Histogram identical: EXACT 964, LIVE-DEGENERATE 12, GAP-state-block 1, LIVE-PHANTOM 1, DEFERRAL-test-block 21, LIVE-HOIST-MISCLASSIFY 2. 1019 pass / 0 fail.
4. Full `bun run test`: 21248 pass / 174 skip / 1 todo / 0 fail across 773 files (TWO consecutive clean runs, ~52s each). One earlier run showed a non-reproducible 2-fail flake (pass=21247) — same flake class the b.2.1 record documented (non-parser browser/timing); not reproducible on runs 2+3; my test is deterministic.

### STOP conditions hit
- **STOP #3 (semantic disambiguation, not a recursion fix) — HIT, surfaced to PA, NOT fixed.** The ONE corpus residual where native hoisted-length < live (`compiler/self-host/cg.scrml imports:0<5`) is five `await import("./...")` DYNAMIC-import EXPRESSIONS inside a `^{}` meta block. The Meta block IS walked (recursion reaches the body); the degenerate `Import` Stmts (source:"") are DELIBERATELY skipped by the P4-6 top-level-only/degenerate guard (collect-hoisted.js:205-207, commit 5e58de15) whose comment asserts "live never hoists a dynamic import expr." That assertion is EMPIRICALLY WRONG for this shape — live DOES hoist them as degenerate import-decls {source:null,names:[],raw:"import ( ... )"}. Matching live would mean reverting a prior deliberate decision AND deciding the dynamic-import-expr-vs-static-import-decl semantics — a PA call, not a recursion fix.
- **Out-of-scope (NOT touched per the explicit MUST-NOT):** 5 files show `hasProgramRoot` native=true / live=false (native OVER-detects) + typeDecls native>live over-count (samples/expense-tracker.scrml, api-dashboard.scrml, gauntlet-r11-zig-buildconfig.scrml, rust-dev-lin-lift-pipeline.scrml, rust-dev-lin-lift-edge-cases.scrml) and stdlib/auth/jwt.scrml exports:4>1. These are native OVER-collection / live-parse-truncation (native is the MORE-correct oracle on these), NOT a Class C gap. Contaminating hasProgramRoot is the brief's explicit MUST-NOT, so left untouched. Candidate follow-on class (native over-detect on nested/non-root <program>), surfaced to PA.

### PA action requested
- Decide the dynamic-import-expression hoist semantics for `^{}`-meta / `${}` bodies (cg.scrml shape): match live's degenerate-import-decl hoisting, or keep the native skip-guard and instead ADAPT the live oracle? This is the residual that keeps native<live; it is a deliberate prior-decision reversal, hence PA-owned.

### Maps consulted
primary.map.md (full) — task-shape "Native-parser bug fix". Maps consulted but NOT load-bearing for the root cause: they correctly routed to collect-hoisted.js, but the SCOPING-era bug hypothesis was already stale and the verified cause (gap already closed; residual is a dynamic-import semantic guard) came from empirical Phase-0 source tracing, not map content.
