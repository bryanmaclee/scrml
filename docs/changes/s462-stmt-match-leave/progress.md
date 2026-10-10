2026-10-09T17:10:03-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac69154720e046569
2026-10-09T17:17:26-06:00 PA addendum (W1 ruling) appended to BRIEF; mid-refactor emit-control-flow (collectMatchArms extraction)
2026-10-09T step1 impl: emitMatchStmt (inline stmt-position lowering, single + multi-scrutinee) in emit-control-flow.ts; emitLogicNode match-stmt -> emitMatchStmt; fn-shortcut tail keeps emitMatchExpr (value). D2/D3 probes c04b/c06b/c07b/b01b/b03b PASS (bite on base).
2026-10-09T D8: ast-builder collectExpr {armBody} extent (rule-2 continuation) + reportOrphanArmLines E-PARSE-001; D4: markPropagateArms + emitPropagateArm (decl + stmt); D10: symbol-table messageArmBodyHasOwnReturn -> E-STMT-RETURN-OUTSIDE-FUNCTION; D12: bootstrap parse.scrml armEnd continuesLine; given arm: parser armResult at arm level + givenGuardToMatchArm in all 3 collectors.
2026-10-09T conformance/cases/match-leave (11 cases, 10 bite on base; d01 is a bootstrap fix) + unit test s462-stmt-match-leave.test.js; types:check OK. Full suite + corpus differential running.
2026-10-09T17:56:58-06:00 fix round: decl multi-scrutinee inline; raw/propagate-expr arm `?` stamping; emitPropagateArm via expr tree (peer await); IIFE ? arm return-position-only; E-PARSE-001 scoped to match bodies with arms; 4 shape tests updated; full suite: only load-timeout protect case (passes alone). committing step 1.
2026-10-09T22:41:27-06:00 step1 committed e0d7d08b1 (after OOM/timeout retries under sibling load). step2 SPEC edits applied; step3 impl prepared+verified in scratch copy (all dPA probes pass except c15 lift).
2026-10-09T23:21:33-06:00 step3 applied (fix7-12 + mkcases3): all match-leave 27 cases pass impl#1; bootstrap 11 PASS/0 FAIL; related tests 3552/0; slices 2066/0; types OK; corpus diff vs base: only intended (076 drops E-CG-003; inline-lowering artifacts; 0 value-IIFE refusals in corpus). committing.
2026-10-10T00:42:39-06:00 CI gates: s34-census --check-new PASS (after E-PARSE-001 provenance), tiers integration+lsp+commands 5625/0, compiler/tests/*.test.js+e2e 2498/0, slices 2066/0, severity+bootstrap-conformance current.
2026-10-10T10:24:14-06:00 fix round 1: F1/F5/F2/F7 fixed (parsed-statement leave detection; returned multi braced/?; multi ? arms); 3 cases.
2026-10-10T10:42:31-06:00 fix round 1: F3 (given head scope + -> arm sep), F4 (checkTopLevelReturn), F6 (bare break/continue E-LOOP incl. msg arms); 6 cases; corpus: 080/075/076 newly refused (ill-formed samples).
2026-10-10T11:05:34-06:00 merged origin/main (2897ba133); regen SPEC-INDEX + bootstrap report; pinned 6 esm known-throws; host-global-scan --check rc=0; s34 census PASS; types OK; 36/36 match-leave.
2026-10-10T11:32:58-06:00 final: tiers 5630/0; emit-differential vs origin/main 2897ba133: 22 diag-changed (19 new match-leave cases + samples 080/075/076), 44 artifact-changed (inline lowering), nothing else.
2026-10-10T12:16:38-06:00 fix round 2: N1+N4 (arm-body-statements.ts one reader; top-level return all arm forms incl !{}; labels). corpus 0 change.
2026-10-10T12:29:16-06:00 fix round 2: N2/N3 message-arm exits via parsed body.
2026-10-10T12:40:58-06:00 N5: SPEC §42.2.3 note (given heads resolve as reads; newly-rejecting; corpus 2 samples).
2026-10-10T12:47:28-06:00 merged origin/main bbe74c1df (#1392): given-parse conflict resolved (skipGivenComments + arm-level -> accepted by malformed-head check); gates green; 2 esm throws pinned.
2026-10-10T13:05:58-06:00 post-merge: given-head scope check skips rebind/malformed heads (given-rebind-no-presence-lint gained a stray E-SCOPE-001).
2026-10-10T13:50:49-06:00 fix round 3: B2 given-guard case restored in checkTopLevelReturn.
2026-10-10T14:10:23-06:00 fix round 3: M1 expression-position given arms (statement-parser re-read, non-enumerable structured/__nestedMatches); corpus 0 change.
2026-10-10T14:38:25-06:00 fix round 3: B2, M1, DOC, gaps committed; merged origin/main 801419299; facts + state regenerated; 1 esm throw pinned.
2026-10-10T15:34:55-06:00 re-review 4: X1 (no re-read inside lambdas) + 2 cases; wording first-position-only; 5 known-gaps entries; state+facts regenerated.
