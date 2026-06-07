# Bug B — structural-compound deep-set codegen mistarget

Change-id: bug-b-structural-compound-deepset-2026-06-06
Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a5b98933a2d8305d3

## 2026-06-06 — startup + survey
- Startup verification PASSED: pwd under .claude/worktrees/agent-, toplevel matches, merge main already up to date, clean, bun install OK, pretest OK.
- Maps read: primary.map.md (full). Routing = compiler-source bug fix (codegen).
  - Load-bearing: structure.map.md:214 confirms Bug B verbatim; emit-logic.ts reactive-nested-assign case + leaf-key convention (a.ref) owned by codegen state-decl case (line 1846 `${qualifiedName}.${childName}`).
- SPEC §6.3.2 (line 2229) confirmed NORMATIVE: `@formRes.name = "Alice"` writes to 'name' (the leaf). Composite reconstructs from fields. Current emit writes composite -> lost mutation. Pure codegen correctness bug.
- Reproducer compiled: lines 7/9 emit `_scrml_reactive_set("a", _scrml_deep_set(get("a"), ["ref"], v))` (WRONG); leaf is `a.ref` (line 12-14 derived composite).

## Fix shape decision: (A) codegen collector + node-stamp hybrid
- Rationale: codegen ALREADY owns the leaf-key naming convention (emit-logic state-decl case emits `${qualifiedName}.${childName}` leaf keys). Putting the retarget in codegen guarantees zero drift (same rationale collectSynthCellKeys cites). opts-threading is NOT universal (cpsOpts at emit-functions.ts:828 lacks synthCellKeys), so a node-stamp pre-walk at codegen entry (index.ts, alongside collectSynthCellKeys) is the robust, low-blast-radius home.
- Plan:
  1. reactive-deps.ts: collectCompoundLeafTargets(fileAST) -> { leafKeys, parentNames }.
  2. reactive-deps.ts: stampCompoundDeepSetTargets(fileAST) -> walk all reactive-nested-assign (incl. fn bodies); stamp _deepSetLeafKey + _deepSetResidualPath when target is a compound parent.
  3. emit-logic.ts reactive-nested-assign case: honor _deepSetLeafKey.
  4. Regression test + R26 empirical verify (3 cases).

## 2026-06-06 — implementation COMPLETE
- reactive-deps.ts: added collectCompoundLeafTargets + stampCompoundDeepSetTargets (+201L). Mirrors collectSynthCellKeys walk; recurses into fn bodies for the stamp.
- index.ts: wired stampCompoundDeepSetTargets(fileAST) at runCG per-file (+import, +8L). In-place on shared AST nodes.
- emit-logic.ts: reactive-nested-assign honors _deepSetLeafKey/_deepSetResidualPath (+~40L). Plain reactive_set to leaf when residual empty; COW residual into leaf otherwise. FLAT cells unchanged.
- NEW tests: structural-compound-deepset.test.js (5 emit-shape, all pass), browser-structural-compound-deepset.test.js (4 happy-dom runtime, all pass — @a.ref===q after click, single-write applies).
- TEST CORRECTIONS (Rule 4 — locked tests were locking the Bug B spec-divergent shape):
  - cow-bracket-write-emit.test.js: 2 STRUCTURAL COMPOUND fixtures (<obj><field>, <b><k>) asserted composite-write; updated to SPEC-correct leaf-target (obj.field / b.k).
  - deepset-write-loss-position.test.js: program() helper switched from <a><ref> structural compound to FLAT <a>={ref:""}; preserves the S167 statement-survival intent and isolates from Bug B (matches sibling browser test FORM NOTE).
- R26 empirical (HEAD dcb7e417):
  - COMPOUND repro: lines 7/9 reactive_set("a.ref","p"/"q") (was composite). node --check OK.
  - FLAT no-regress: reactive_set("a", deep_set(get("a"),["ref"],v)) unchanged.
  - NESTED compound: reactive_set("a.b.ref","p"/"q") (deepest leaf).
  - leafobj (a.cfg.deep): reactive_set("a.cfg", deep_set(get("a.cfg"),["deep"],"p")).
  - computed-index (a.items[@sel]): reactive_set("a.items", deep_set(get("a.items"),[get("sel")],"x")).
- Gate (unit+integration+conformance): 16145 pass / 89 skip / 1 todo / 0 fail / 860 files (baseline 16140 pass / 859 files). Pre-commit hook passed at commit dcb7e417.
- git status clean. Fix FINAL_SHA dcb7e417.
