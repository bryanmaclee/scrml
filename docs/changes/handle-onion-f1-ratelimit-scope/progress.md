# F1 — ratelimit= scope restoration (per-route, not per-request)

Branch: `handle-onion-top-level-dispatch`
Base at dispatch: `b70db793bfcbca8f0adf0ee5bb1a3763b5e70db0`

## Status
- [x] Startup gate passed (5/5)
- [ ] SPEC §40 read in full
- [ ] Locus verified (hypothesis: emit-server.ts:3045-3047, build.js:503, dev.js:1070)
- [ ] Fix shape chosen
- [ ] Fix landed in all three dispatchers
- [ ] Reproducer flips (req #4 -> 200)
- [ ] Cross-module bleed flips
- [ ] Limiter still fires on real route requests
- [ ] Executing regression test added
- [ ] Gate run + new-failure name set compared

## Log
- Startup gate: pwd/toplevel/branch/status/HEAD all as briefed. Clean.
- Crash anchor committed (BRIEF.md verbatim + this file).
