# progress — s456-one-statement-per-sql-block

- startup: worktree verified; FF-merged origin/land/s456-tenant-undeclared-table (bef93f984; #1334 not yet in origin/main); bun install + pretest OK.
- PHASE 0 (scratch .tmp/phase0.mjs: splitBlocks+buildAST, every sql/sql-ref outside <schema>, statements counted by programStatementVerdicts): 2581 .scrml files (samples examples stdlib conformance benchmarks compiler/self-host-v2 compiler/tests + ../flogence/src), 417 DB files, 1331 program-body ?{} bodies → 0 hold more than one statement (1 unreadable body, single-stmt). Probe control (.tmp/probe set_config;select) detected (n=2). NEWLY REFUSED: 0. Proceeding to build.
