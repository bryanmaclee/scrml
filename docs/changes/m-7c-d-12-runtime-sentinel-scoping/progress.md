## M-7C-D-12 Runtime Absence-Sentinel — SCOPING Progress

- 2026-05-13T16:00Z — Dispatch received. Verified worktree base, rebased onto main `78555f6`. `bun install` + `bun run pretest` clean.
- 2026-05-13T16:05Z — Read primary/structure/schema/error maps. Read null-audit (410L) + undefined-audit (485L). Cross-checked SPEC §42 (L18222-18567).
- 2026-05-13T16:10Z — Key finding: SPEC §42.5 + §42.8 explicitly state `not` literal compiles to `null` (compiled JS) with a "Rationale for null over undefined" subsection. The audit calls this "drift", but the SPEC currently NAMES it as the canonical runtime representation. This pivots the framing of Option α vs β/γ.
- 2026-05-13T16:15Z — Read pa.md Rule 3 + self-host-is-from-scratch rule. Confirmed scaffold framing: TS impl will be discarded; choose option that minimizes scaffold investment while honoring scrml-observable surfaces.
- 2026-05-13T16:25Z — Reading load-bearing code sites: emit-expr.ts L294-301 (`not` → `null`), emit-server.ts L928/934 (wire format `?? null`), emit-logic.ts L2138/2148 (SQL absence `?? null`), emit-engine.ts L985 (history cell init `null`), runtime-template.js L1709-1711 (structural-eq null/undefined paired check).
- 2026-05-13T16:40Z — SCOPING.md drafted: §1-§7 per dispatch spec. Surfaced options α/β/γ/δ + ε (hybrid). Recommendation: α-with-fences (SPEC §42.5/§42.8 are already-ratified canonical; runtime null IS scrml absence; tighten scrml-author surfaces only where leaks observably break scrml semantics — wire format encoding is the single load-bearing migration, NOT a runtime sentinel rebuild).
- 2026-05-13T16:50Z — Committing SCOPING + progress. Final report follows.
