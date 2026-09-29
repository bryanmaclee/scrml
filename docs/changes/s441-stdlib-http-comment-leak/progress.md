# progress — s441-stdlib-http-comment-leak

- startup verified; base a18a157b1 (origin/main); bun install + pretest OK
- REPRO: direct compile of stdlib/http puts `export function multipart` in index.html
  (2x E-CTX-001). Importer path: client import uses the hand-written shim
  (compiler/runtime/stdlib/http.js), which HAS multipart — so `import { multipart }`
  itself worked. The real consequence is STDLIB-EXPORT-SEED (api.js): TAB-only parse of
  index.scrml dropped `multipart` + `uploadFile` from the export table → a client
  `const r = uploadFile(url, f)` was NOT auto-awaited (retry was).
- FIX http: doc example rewritten without the nested `/* */`.
- SWEEP found a second live leak: stdlib/cron `"*/15 * * * *"` in a doc comment →
  all 3 exports lost (standalone compile: E-CODEGEN-INVALID-LOGIC "compiler defect").
  Doc block converted to `//` lines. stdlib/router has a nested `/*` (`/files/*`) with no
  early `*/` → harmless. All other repo hits (md shell globs, CSS `* {`, SPEC `* => *`)
  are false positives of the heuristic scan.
- TEST: compiler/tests/unit/stdlib-source-no-logic-leak.test.js (export parity + no page
  text for every stdlib module; importer auto-await; instrument-integrity controls).
  Verified 4 fail against pre-fix sources, 59 pass after.
- within-node allowlist rows for http + cron raised to new raw counts (newly-parsed code).
- committed 196e85ac2 (hook green on 2nd try; 1st hit a load flake in
  standalone-tool-target, passes alone).
- GAP filed: g-block-comment-early-close-leaks-logic-as-page-text (MED, open) in §S441;
  state.ts --write regenerated counts (MED 381 → 382).
