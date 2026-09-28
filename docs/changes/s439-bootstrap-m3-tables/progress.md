# progress — s439-bootstrap-m3-tables

- startup: worktree verified, base == origin/main 9b2fd2cbd (typer #1117 present: `THE TYPER` hits analyze.scrml:23/152/3051). ingest.scrml / slice-m3 NOT on main at start (no footprint grade yet).
- BASE DIFFERENTIAL built before any edit (scratchpad m3-tables/diff.js; base = a copy of compiler/self-host-v2 at 9b2fd2cbd).
  459 programs: 6 slice programs + fixtures, 6 slice-m1 sources, 9 §66.19 blocks (from SPEC.md), the typer reviewers'
  r3 probe sets (spec/ 26 + spec3/ 9 + linked 66.19.3 + p3/p3a/p3c/p3d/p3e + probesB + p3f + p3g + probesA), and 228
  programs captured from every slice-m2 test's frontEnd call. Compared per program: FULL diag list (code+message+file+span,
  in order), Core (strict JSON, no Sym renumbering allowance), ASTs, every non-fact Tables field, exprType(nid) for every nid.
  base-vs-base: 459 programs, 241 with diagnostics, CHANGED 0. Bite proof: a one-word message edit → CHANGED 5.
- BASELINE: lines analyze 4491 / lower 996 / check 509. Suites (3 runs): slice-m1 1.42/1.52/1.50 s (73 pass);
  slice-m1 SLICE_CORE=lowered 4.07/4.20/4.41 s (73 pass); slice-m2 4.77/4.66/4.82 s (221 pass). Front end over all 459
  differential programs: ~250-270 ms total (the suites' wall is dominated by impl#1 compiling the bundle, not factOf).
