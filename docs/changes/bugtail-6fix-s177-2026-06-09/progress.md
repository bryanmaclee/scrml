# progress — bugtail-6fix-s177-2026-06-09

WORKTREE: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a19a4331e945385f6
BASE: 0aa54fc2

## 2026-06-09 — startup
- startup verification pass (pwd/toplevel/clean/base==0aa54fc2)
- bun install + bun run pretest done
- read primary.map.md in full; task = compiler-source bug fix (multi-locus)

## next
- Bug 1 (bug-74): block-splitter.js:2558 — /> + :-shorthand should fire E-CLOSER-001

## 2026-06-09 — Bug 2 (bug-4) DONE
- block-splitter.js looksLikeCloser: now fires on EOF OR new-opener `<`; a CLOSE
  tag (`</`) suppresses. Root: `nextNonWs === "<"` false-fired on `/</close>`.
- SURFACED + RESOLVED a conflict the brief flagged ("actually verify"): the genuine
  `<p>hello/</p>` shape the brief said must KEEP firing is STRUCTURALLY IDENTICAL to
  the reproducer (`/` before a close tag). CONF-015 canonical contract is the EOF
  case (`<p>hello/`), which is preserved. The `/</tag>` over-fire was locked ONLY in
  two unit tests (bug-2-markup-text-quote..., gauntlet-s19/tokenizer-slash) — both
  corrected to the refined semantics + added genuine-firing (EOF + new-opener) guards.
- reproducer compiles clean; new-opener + EOF still fire.
- regression test: bare-slash-before-close-tag-bug4.test.js (7 pass).
- parser-shape canary PASS (no allowlist drift).

## next: Bug 3 (bug-48) ast-builder.js — inline `=>` arrow in <match>/<engine>/<machine> opener truncates

## 2026-06-09 — Bug 3 (bug-48) DONE (TWO loci — brief under-scoped)
- ast-builder.js: ported parenDepth+bracketDepth to all 3 sibling opener-finders
  (_findMatchOpenerEnd x2, _findOpenerEnd machine/engine) AND to the 2 `on=expr`
  capture loops (boundary scan also lacked paren/bracket tracking — arrow body
  `c == 1` looked like a `c=` attribute boundary).
- THE BRIEF UNDER-SCOPED: <engine> + <machine> are FULLY fixed by the ast-builder
  port alone (both compile clean). But <match on=arrow> had a SECOND, unnamed locus:
  emit-match.ts resolveOnExpr fall-through (line ~344) emitted the complex on=
  expression VERBATIM, leaking `@nums` + `==` into emitted JS (E-CODEGEN-INVALID-JS).
  Fixed by lowering through parseExprToNode + emitExpr (same helpers the arm-body
  path uses); EmitExprContext = { mode: "client" }; defensive verbatim fallback.
- reproducer (match) now: _scrml_reactive_get("nums").filter((c) => _scrml_structural_eq(c, 1))
- regression test: opener-arrow-truncation-bug48.test.js (4 pass: match/engine/machine + control).
- parser-shape canary PASS. match/engine/machine suites green (121 + 1047).

## next: Bug 4 (r28-7b) type-system.ts predicated primitive base in `| not` union loses recovery

## 2026-06-09 — Bug 4 (r28-7b) DONE
- type-system.ts ~15568: conflict-case `[asIs, not]` recovery now falls back to
  leading-primitive-token recovery (from non-`not` portion of raw clause) when
  `_schemaForRecoverEnumSubset` returns null. Re-synthesizes `[resolvedPrimitive, not]`.
- root confirmed: predicated primitive base (`string req length(<=200)`) has no
  enum-subset head -> subset recovery null -> base stays asIs -> [asIs,not] no-mapping.
- reproducer now compiles clean; control + enum-subset + predicated-int all clean.
- DDL correctness verified via classifyFieldForSql([string,not]) -> ok/text/nullable;
  CHECK constraints ride independently via parseValidatorClauses.
- regression test: schemafor-predicated-base-nullable-r28-7b.test.js (5 pass).
- schema-for suites green (157).

## next: Bug 5 (s169-map-inline-insert) codegen/rewrite.ts inline onclick map-assign RHS not lowered

## 2026-06-09 — Bug 5 (s169-map-inline-insert) DONE
- emit-event-wiring.ts ~480: narrowed the `assign` exclusion. A MAP-VAR assign
  (`@m = …` with m in mapVarNames) now routes through emitExprField (which already
  threads BOTH mapVarNames AND engineBindings) -> emitAssign lowers the RHS via
  emitExpr -> `@m.insert(...)` becomes `_scrml_map_insert(_scrml_reactive_get("m"), ...)`.
- CLEANER than the brief's recommendation (thread mapVarNames into rewriteReactiveAssign):
  emitAssign ALREADY has both map-method RHS lowering AND engine-write-guard interception
  (the line-468 comment claiming "emitAssign has no engine-binding interception" is STALE —
  §51.0.F added it). No rewrite.ts change needed. NON-map assigns keep rewriteBlockBody path.
- inline handler now BYTE-IDENTICAL to named-fn control (verified). `.remove` also lowers.
  Engine assign `@phase = .Loading` unaffected (verified).
- regression test: inline-map-assign-handler-s169.test.js (4 pass).
- value-native-map + event-wiring + engine-write suites green (115 + 44 + 74).

## next: Bug 6 (r27-c6) symbol-table.ts formFor synth-cell unresolvable when nested in engine state-child

## 2026-06-09 — Bug 6 (r27-c6) DONE (root differs from brief hypothesis)
- type-system.ts walkAndSplice (formFor expansion walk): added `bodyChildren`
  recursion so a formFor nested in an engine state-child IS expanded.
- ROOT EMPIRICALLY DIFFERS FROM BRIEF: the brief said the synth cell IS registered
  but lands in the wrong scope (fix in symbol-table.ts B1/B11/B12). NOT TRUE — the
  formFor was NEVER EXPANDED (walkAndSplice recursed .children/.body but NOT
  engine-decl.bodyChildren). The raw <formFor> tag leaked into output + the compound
  cell @newExpense was never hoisted/bound -> bind:value=@newExpense.* -> E-SCOPE-001.
- The hoist target (top-level synth logic node) is FILE scope = ancestor of the
  engine-arm scope the bind site resolves against -> lookup resolves once cell exists.
- nested reproducer now: formFor expanded to <form>, @newExpense wired (validity surface).
  top-level control unchanged.
- DEFERRED (pre-existing, NOT introduced — verified broken pre-fix): formFor nested in
  a <match> block-arm fails E-CODEGEN-INVALID-JS (match-arm formFor expansion is a
  separate codegen path). Out of scope for r27-c6 (engine-state-child / E-SCOPE-001).
- regression test: formfor-nested-in-engine-statechild-r27-c6.test.js (4 pass).
- formFor + engine + validator suites green (211); full suite 23710/0 during exploration.
