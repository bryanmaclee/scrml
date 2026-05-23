# Progress: r4-u1-wire-translate-expr-ride-throughs

- [start] WORKTREE_PATH = /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-ac03bdf7bd4e509b6
- [start] BRANCH = changes/r4-u1-wire-translate-expr-ride-throughs
- [start] HEAD (initial) = 136678e5 (S121 wrap) — but main HEAD was a15c86ff (R4 survey)
- [rebase] rebased branch onto a15c86ff to pick up M6.1/M6.2a/M6.3/M6.4a wave
- [start] BASELINE = compiler/tests/unit/translate-stmt-bridge.test.js + translate-expr-bridge.test.js → 182 pass / 0 fail (656 expect calls)
- [post-rebase] BASELINE = 196 pass / 0 fail (M6.2a added 7 to §5b; R4-U1 added 7 to §5c)

## Files touched

- compiler/native-parser/translate-stmt.js — 3 sites wired + 1 import + 3 header-comment refreshes
- compiler/tests/unit/translate-stmt-bridge.test.js — 1 existing assertion updated (§1 L59) + 7 new tests in §5c

## Plan execution

| Step | File | Status | Commit |
|------|------|--------|--------|
| Branch + pre-snapshot | progress.md | done | 37d4faab (post-rebase: WIP start) |
| Wire makeBareExpr L371 + test §1 | translate-stmt.js + bridge test | done | afe5c2c7 |
| Wire makeReturnStmt L1054 + makeThrowStmt L1192 | translate-stmt.js | done | a4516bb7 |
| Add §5c regression tests + R4-U2 lock test | translate-stmt-bridge.test.js | done | 77739b42 |
| Bug-5 verification with wip-patch | (in-worktree apply, then revert) | done | (no commit) |
| Full bun test sweep | unit + integration + conformance | done | 13927 / 0 fail |

## Per-site wrap shape (before / after)

**Site 1 — makeBareExpr (translate-stmt.js L371):**
```
- exprNode: nativeExpr === undefined ? null : nativeExpr,
+ exprNode: nativeExpr === undefined ? null : translateExpr(nativeExpr),
```

**Site 2 — makeReturnStmt (translate-stmt.js L1054):**
```
- node.exprNode = stmt.argument;
+ node.exprNode = translateExpr(stmt.argument);
```

**Site 3 — makeThrowStmt (translate-stmt.js L1192):**
```
- node.exprNode = stmt.argument;
+ node.exprNode = translateExpr(stmt.argument);
```

Plus 1 import added at top of translate-stmt.js (no circular import risk — verified
translate-expr.js imports nothing from translate-stmt.js):
```
+ import { translateExpr } from "./translate-expr.js";
```

Plus 3 header comments on makeBareExpr / makeReturnStmt / makeThrowStmt refreshed to
reflect the LIVE lowercase exit and the R4-U1 closure note.

## Bug-5 verification

- BASELINE (no wip-patch, R4-U1 wired): 5/5 — bug-5 is live-path, R4-U1 doesn't change it
- WITH wip-patch + R4-U1 + M6.2a (THIS BRANCH): **5/5 PASS** ← survey predicted 4/5 → 5/5 after R4-U1 + U2 + U3 + U4 + U5; actual: 5/5 with JUST R4-U1
- Wip-patch APPLIED via `git apply`; tested; REVERTED via `git checkout --`
- Wip-patch NOT committed on this branch (per brief)

Conclusion: R4-U1 closed bug-5 5/5 sub-failure independently of R4-U2/U3/U4/U5.
The U2-U5 work is still required for OTHER downstream consumers (12 failing tests
in f-component-004-substituteProps-logic-block.test.js + component-prop-substitution-call-ref.test.js
under wip-patch — component-expander prop-substitution machinery that walks
expression nodes via for-stmt iterExpr / let-decl initExpr / etc., all R4-U2/U4 scope).

## Tests

- Pre-rebase: 13819 pass / 0 fail (656 expect for the 2 bridge files)
- Post-R4-U1 + rebase: **13927 pass / 0 fail** (711 expect for the 2 bridge files)
- Net: +108 (M6 wave brought in +101, R4-U1 added +7)
- Regressions: 0
- New tests added (R4-U1): 7 in §5c (translate-stmt-bridge.test.js)
- 1 LOCK test (for-of iterExpr) confirms R4-U2 scope is still required

## Maps load-bearing finding

primary.map.md key facts about M5-swap C2 (`--parser=scrml-native` ROUTES via nativeParseFile)
informed where to look for the bridge — the route from `nativeParseFile` to `synthLogicNode`
to `translateStmtList`. The survey was the load-bearing artifact for line ranges (L371 /
L1054 / L1192 sites).

## Deferred (R4-U2 / U3 / U4 / U5 — still needed for M6.2b)

The R4 survey's decomposition still applies for the remaining sites NOT touched by R4-U1:

- **R4-U2:** for-stmt iterExpr + cStyleParts.{init,cond,update}Expr (L993-1041)
- **R4-U3:** if-stmt / while-stmt / do-while-stmt condExpr (L936, L950, L970)
- **R4-U4:** let-decl / const-decl / lin-decl / tilde-decl initExpr (L651, L674, L712)
- **R4-U5:** lift-expr (non-MV) / propagate-expr / guarded-expr / fail-expr expression fields
  (L558, L604, L627, L584)
- **R4-U6:** re-apply wip-migration.patch + close M6.2b → 5/5 bug-5 (gated on U2-U5)

The R4-U2 LOCK test in §5c proves the for-stmt iterExpr path is still leaking PascalCase
(asserts `out[0].iterExpr.kind === "Ident"`). When R4-U2 ships, that lock test should be
removed / inverted.

## STOP-condition check

NOT triggered. The work was exactly 3 one-line wraps + 1 import + 1 existing test update
+ 7 new tests. No new translation logic needed (translate-expr.js handles all 40 native
ExprKind cases). No cascade into other translation work.

## Source files inspected (read-only)

- compiler/native-parser/translate-expr.js (1041 LOC) — header L1-131, translateExpr signature L149
- compiler/native-parser/translate-stmt.js (1248 LOC; +6 lines after R4-U1) — header L1-87, sites at L366/L876/L1184
- compiler/tests/unit/translate-stmt-bridge.test.js (520 LOC; +63 after R4-U1) — §1 test L54-60 (updated), §5c new (L520-570)
- docs/changes/r4-expression-catalog-continuation-survey/progress.md — survey (240 lines)
- docs/changes/m6-2-component-expander/wip-migration.patch — applied + reverted for verification
