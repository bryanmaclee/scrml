# §19.10.5 implicit per-handler transaction — conformance coverage notes

This dir covers the ONE source-reachable §19.10.5 / §8.9.2 diagnostic: **W-BATCH-001**
(explicit `?{BEGIN}` suppresses the implicit envelope). Two related surfaces are
DELIBERATELY UNCOVERED here (flagged, not faked — per the ss58 harness gate):

1. **E-BATCH-001 (implicit envelope + explicit `transaction { }`) — NOT source-reachable
   in impl#1.** impl#1's own `compiler/tests/unit/batch-planner.test.js` (§11) documents:
   *"Parser produces a bare-expr from `transaction { ... }` in some function-body
   configurations, so we invoke runBatchPlanner directly against a hand-built AST."*
   A source-level `transaction { ?{…}.run() }` inside a function body yields E-SCOPE-001 +
   a "statement boundary not detected" parse-drop, never E-BATCH-001. The conformance
   harness compiles from SOURCE, so E-BATCH-001 cannot be authored until the parser lands
   `transaction { <sql> }` in function-body position. → ss58 ESCALATION #2 (PA ruling).

2. **The SQL-rollback RUNTIME (implicit `?{ROLLBACK}` on handler re-throw, §8.9.2) —
   harness-gated.** The conformance harness mocks only `fetch` (no `?{}` DB adapter), so the
   rollback-on-fail runtime effect cannot be exercised. Needs a real-DB adapter (track B).

Naming: the ss58 list named an `@nosql-tx` opt-out; no such annotation exists. The real
per-query opt-out is **`.nobatch()`** (§8.9.5). Its effect (excluding a query from the
coalescing candidate set) is a silent compile-time marker with no positive diagnostic, and
its E-BATCH-001-resolving path shares gap #1 above — so it too is not codes-assertable from
source today.
