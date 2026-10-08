# progress — s457-string-url-executable-schemes

- 2026-10-07 start: worktree verified, base = origin/main d5875e972, brief committed (fcda22ade).
- Locus verified: static judge `type-system.ts SHAPE_STATIC_PREDICATES["url"]` (new URL parse) + runtime twin
  `codegen/emit-predicates.ts NAMED_SHAPE_RUNTIME.url` (inline new URL IIFE). Hypothesis held (§53 url predicate).
- Impl: `_scrml_url_shape_ok` added to runtime-url-guard.js (URL parse + shared reader + §5.2 safe set). Static zone
  imports it; runtime template calls it; client 'urlguard' chunk gated on the call (emit-client post-emit gate);
  server bundle / value-only bundle / tool / library inline the guard source once (`needsUrlShapeHelper`).
- Empirical: compiled probe app — server param check 400 for every refused shape, 200 for safe schemes; client
  runtime judge agrees; SSR first-paint + url param bundle defines the source exactly once.
- Tests: new compiler/tests/unit/s457-string-url-executable-schemes.test.js (66); predicate-codegen url test updated.
- 2026-10-07 SPEC §53.6.1 amended (normative url scheme rule + Provenance) — 3546eef53. §55 carries no `url` predicate
  (it lists `url` as a stdlib `scrml:data` builder), so no §55 text changed. SPEC-INDEX line count now stale (PA-owned).
- 2026-10-07 conformance: refinement/url-executable-scheme-literal-pos + -reject-rt — df109eb67. `bun conformance/run.ts`
  1344/1394 pass + 50 xfail. Gate 32086 pass / 0 fail. types-gate OK unchanged.
- Corpus: the one `string(url)` declaration (samples/.../predicate-url-001.scrml, "https://example.com") compiles clean.
- 2026-10-07 review N1 fixed: emit-worker.ts inlines the judge source (header) when the worker body calls it; worker
  test executes self.onmessage (https replies, javascript: throws E-CONTRACT-001-RT). SPEC sentence scoped to enforced
  positions. Other worker helper gaps (pre-existing): `_scrml_structural_eq(`, `_scrml_map_from_entries(` undefined.
- Observed (not fixed; CORRECTED — a refined LOCAL in a worker fn IS checked; a refined PARAM is not): nested worker `<program name=>` bodies emit NO §53 refinement checks at all (pre-existing);
  stdlib `scrml:data` `url()` validator still admits javascript: (separate surface).
