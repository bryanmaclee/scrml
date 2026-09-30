# progress — s444-csp-inline-chunks

- [start] branch fix/s444-csp-inline-chunks off a83fd90ac; install + pretest OK.
  Gate baseline: 26785 pass / 72 skip / 12 todo / 0 fail.
- [probe] REPRODUCED in headless Chromium (repo Playwright; Bun static server
  sending the compiler's own `default-src 'self'`). Fixture: A-5.1
  multipage-multirole with headers="strict", `--emit-per-route`.
  - before: 2x "Executing inline script violates ... default-src 'self'";
    `_SCRML_CHUNKS` = runtime empty scaffold; no `/index/<Role>.initial.*.js`
    request (cookie scrml_role=Admin). Control w/ 'unsafe-inline': Admin chunk fetched.
  - not fail-open: full per-file client.js loads regardless; <auth role> markup is
    not withheld by the split (W-AUTH-CONTENT-NOT-GATED).
- [fix] 890051c10 — buildChunksBootJs → one content-addressed same-origin
  `scrml-chunks.<hash>.js` (manifest + bootstrap; route via data-scrml-route /
  document.currentScript); pages carry `<script src=… data-scrml-route=…>`.
  api.js writes + gates + clientAssets + hashedAssets. Tests updated/added.
  - after: 0 violations; `_SCRML_CHUNKS` = /admin,/,/loads; Admin chunk fetched.
  - gate: 26792 pass / 72 skip / 0 fail.
- [gaps] §S444e: resolved g-emit-per-route-inline-chunk-scripts-refused-under-strict-csp;
  filed (open, LOW) g-chunk-bootstrap-anonymous-fallback-misses-role-enum-anonymous-key.
- [R26] corpus-emit-differential examples,samples base a83fd90ac vs head — see below.
