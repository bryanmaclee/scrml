# W2 — thread RouteMap into RS entry-point enumeration (S221)

Agent: scrml-js-codegen-engineer (a6c38d4, isolation:worktree, opus). Arc: Approach-A splitter
(`docs/changes/feel-of-performance-approach-a-impl-2026-06-26/SCOPE.md`).

W1 (DG markup-reads edge-lift §40.9.3) verified ALREADY BUILT (S88). The real first-buildable gap:
`enumerateEntryPoints(files)` (reachability/entry-points.ts:76, called reachability-solver.ts:170)
takes only `files`, finds the root `<program>` + inline `<page>` children, and SKIPS filesystem-routed
page files (no `<program>` root → `:82 continue`). So a real multi-page app (trucking) gets EMPTY
closures. routeMap is at api.js (~L1847) but unthreaded; entry-points.ts:31-34 docstring falsely claims
it reads RouteMap (doc/code mismatch).

W2 = thread routeMap into enumerateEntryPoints so filesystem-routed pages become RS entry points per
§40.8 + fix the doc mismatch. Phase 0 confirms (routeMap shape · §40.8 · whether the emit-path also
needs DG/AuthGraph wiring). Acceptance: trucking --emit-reachability → non-empty per-page closures
(≥2 pages before/after) + per-role finding + FULL suite + determinism suite green. STOP-if-balloons
(SPEC ruling / large emit-path refactor).

(Full verbatim prompt: this dispatch's Agent call, S221 transcript.)
