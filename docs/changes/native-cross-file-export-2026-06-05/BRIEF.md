# DISPATCH BRIEF (verbatim) — native cross-file `export` translation
# change-id: native-cross-file-export-2026-06-05
# agent: scrml-js-codegen-engineer · isolation: worktree · model: opus · agentId a48bf500147b36c24
# dispatched: 2026-06-05 (S166) · base HEAD 6ed518d1 · re-triage #2 pick

Native-parser-swap parity gap: under --parser=scrml-native, cross-file `export` declarations break —
the cross-file component/engine expansion registry gets empty markup → E-COMPONENT-020/035, breaking
the 30-test FX-2 fixture + several cross-file-component cases. .js-only native-parser/translate change.
Entry point: nativeParseFile (parse-file.js:94) → collectHoisted (collect-hoisted.js) + StmtKind.Export
(translate-stmt.js).

DISCIPLINE BLOCKS (full text in S166 transcript / pa.md): F4 startup-verify + path discipline
(S42/S90/S99/S126 — Bash-edit on worktree-absolute paths, no `cd` into main); S112 merge-startup
(`git merge --ff-only main`, confirm HEAD 6ed518d1); MAPS-first-read (S82, watermark e947c924 — current
for the native path; the only post-watermark source change is bare-function-failable in parse-stmt.js,
ORTHOGONAL to the cross-file loci); commit-discipline (S83, per-root commits, clean status before DONE,
echo pwd in first commit); .scrml mirror feature-stale (S162 — .js-only).

PHASE 0 — verify roots, STOP-IF-DIVERGENT. Hypotheses:
- ROOT-2 (dominant): collect-hoisted.js synthExportDecl (~540-621) slices raw from blockText via
  lo/hi = stmt.span.{start,end} - blockSpan.start; for a `${...}` LogicEscape, blockText origin is
  OFFSET by the `${`+ws prefix → hi overshoots → guard fails → raw="" → E-COMPONENT-020/035. Fix:
  align the slice base to the inner-body offset; handle BOTH LogicEscape + file-top WITHOUT regressing
  the working file-top path. walkStmts (193) threads blockText/blockSpan.
- ROOT-1 (secondary): translate-stmt.js StmtKind.Export arm (330-331) pushes only makeExportDecl(stmt);
  the live pipeline ALSO emits the inner decl node (function-decl exported:true — codegen emits the body
  from it). makeExportDecl (1959) already reads stmt.declaration (1964) — verify whether the inner decl
  reaches codegen or is only wrapped-not-emitted. Symptom: example-22 types.client.js badgeColor dropped.
  Fix: ensure the exported inner declaration reaches codegen as emittable, mirroring live.

Reproduce DEFAULT vs --parser=scrml-native on cross-file-expansion-integration.test.js (FX-2 ~30) +
cross-file-components.test.js (C2/C3/C4/C7b/C9/C10/C11) + example-22; byte/shape-diff EMITTED output
(not exit code); probe native AST (raw-len 0 for ROOT-2; export-decl-only vs function-decl+export-decl
for ROOT-1). ROOT-2 and ROOT-1 independent — fix the mechanical one(s), STOP-report any divergent.

PHASE 1 — per-root fix (commit per-root). PHASE 2 — R26 emitted-output (E-COMPONENT-020/035 gone +
exported body present, native==default) + node --check; targeted cross-file suites default+native; full
`bun run test` 0-fail (baseline 23,054/0; within-node 1005/0 — flag any over-budget, do NOT mass-rebump).

Report: Phase-0 verdict per root; WORKTREE_PATH + FINAL_SHA + FILES_TOUCHED; fix per root (line ranges);
emitted-output verification; suite results + within-node delta + cross-file fixtures cleared; maps
feedback; deferred/scope-expansions. DO NOT commit to main / push / clean worktree — PA lands via S67
file-delta after independent verification + user commit-auth.
