# s469-bootstrap-cli — progress

Brief: `scrml-boot compile <file.scrml>` over the bootstrap (compiler/self-host-v2/), per
scrml-support/docs/workability/today-scrml-distance-2026-10-18.md §4 row 1 + Appendix A.

## Done
- [x] `compiler/self-host-v2/slice-m1/harness.js`: `loadBundle` split into `buildBundleChunks` (impl#1
      build → plain `{name, deps, src}` chunks) + `evaluateChunks` (load), + `bundleInputFiles`. Same
      behaviour for every existing caller. No `*.scrml` touched.
- [x] `scripts/scrml-boot.ts`: `compile` and `dev`. Disk cache of the built bundle, keyed on a sha256
      of the bundle inputs + every self-host-v2/*.scrml + every compiler/src file + the package version
      + harness.js.
- [x] Package scripts `boot`, `boot:compile`, `boot:dev`. Not a published `bin` (the `files`
      allowlist excludes self-host*).
- [x] Fixtures `compiler/self-host-v2/slice-m4/src/acceptance/{b-tapes,b-refused-shift}.scrml` and
      test `slice-m4/scrml-boot.test.js` (subprocess CLI: success + run in happy-dom; refusal → exit
      1 + E-WRITE-NOT-GRANTED at 12:9; `--format line`; dev serve + recompile; usage error).
- [x] README "Write it today: the bootstrap compiler" section.

## Measured (this machine)
- cold (empty cache, bundle built by impl#1): ~10.0 s
- warm (cached bundle): ~0.16–0.18 s wall for b-tapes.scrml (bundle load ~125 ms, compile ~30–70 ms)

## Decisions
- `scripts/` not `compiler/bin/`: compiler/bin is the published impl#1 `scrml` bin, and the published
  package excludes self-host-v2.
- dev server is a small Bun.serve inside scrml-boot.ts, not impl#1's `scrml dev` (dev.js is wired to
  impl#1's compileScrml + its output layout + route map). It serves the output dir, answers
  `/_scrml/call/*` with the program's own server artifact (`createServer`, default host = Bun.SQL),
  and pushes reload / error-overlay over SSE.
