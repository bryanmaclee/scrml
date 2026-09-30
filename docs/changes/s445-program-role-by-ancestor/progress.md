# progress — s445-program-role-by-ancestor (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a92d7cfc42e15dd09, base c53b297a7
- base corpus capture taken (scratch basecopy of c53b297a7 + brief commit): 2180 sources, 1370 compile OK.
- NEW compiler/src/program-role.ts (forEachProgramWithRole / findTopLevelPrograms / findTopLevelProgram / hasTopLevelProgram).
- consumers switched: codegen/index.ts (E-PROGRAM-NESTED-AUTH + E-PROGRAM-002 one walk; W-PROGRAM-TITLE-NESTED; head docAttrs), compute-program-config.ts, tool-program.ts findTopLevelProgramNode (-> route-inference rootCandidates/redirect, type-system, isToolProgram), compute-pgo-flags computeFileShape (re-stamps hasProgramRoot at PRECG), ast-builder.js (hasProgramRoot, E-MW-002/005 programNode, W-PROGRAM-SPA-INFERRED), library-shape.js guard, route-inference collectFileAuthDecls, auth-graph findProgramNode, reachability entry-points findRootProgram, api.js idempotency db fallback.
- refusal-gate: E-PROGRAM-002 + E-PROGRAM-NESTED-AUTH refuse the write (build + compile).
- tests: unit program-role-by-ancestor (20), integration program-role-by-ancestor (20; 16 RED on base), 4 conformance cases (3 RED on base).
- SPEC: §4.12 one definition (+Provenance S445 b), §4.12.2/§4.12.9/§34 rows, §40.2 app-program, §40.8 definition bullet + E-PROGRAM-002 bullet corrected (first/last-wins history, no-write), §20.5.1 carve-out note rewritten (nested residual MEASURED). SPEC-INDEX + FACTS regenerated.
- stale 'E-PROGRAM-002 reserved-not-implemented' comments/E-MW-008 message scoped to the CROSS-FILE case (codegen/index.ts x6, library-shape.js, session-config-resolve.ts).
- Phase 3 EMPIRICAL (scrml build + bun _server.js, ports 4741-4743, real login via <page auth=none> session.set): (i) anon POST 200 s3cret -> 302 /login; anon doc 200 -> 302; authed POST 200 s3cret both. (ii) before: builds, anon POST 200 s3cret; after: E-PROGRAM-002 exit 1, no dist. known-gaps updated (wrapped resolved; last-wins narrowed, nested residual measured); gap-counts regen (HIGH 218->217).
