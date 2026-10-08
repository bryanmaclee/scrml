# s459-hgs-thrown-by-name — progress

- Base: origin/main 6fcde7f7e, branch s459-hgs-thrown.
- Baseline full `--check` on base: exit 0, 119 threw (same 119 keys on two independent runs).
- a0ae4b975: THROWN_CEILING replaced by `scripts/host-global-scan.known-throws.txt` (119 keys,
  sorted, `[mode] <unit>  # error class`). Unpinned throw -> exit 2. Pinned key no longer
  throwing -> informational "fixed" line; `--prune` rewrites the file.
- Follow-up: "fixed" scope judged by scanned roots (path prefix), not enumerated units, so a
  pinned unit that was deleted/moved is reported too (the bite run surfaced this).
- Bite proof (executed, subset `--roots samples/compilation-tests,hgs-bite --modes esm`):
  baseline exit 0 / 32 threw; moved error-004-in-logic.scrml out (a known thrower "fixed") and
  added hgs-bite/new-thrower.scrml (copy of it) -> still 32 threw (old count gate: green), new
  gate exit 2 naming `[esm] hgs-bite/new-thrower.scrml`, and reports error-004 as fixed.
  `--prune` removed exactly that line. Restored -> exit 0.
- Final full `--check`: exit 0, 119 threw, 0 fixed, 0 unpinned, 141s (load-dependent; 109-168s seen).
- CI step unchanged (its comment never mentioned the ceiling).
