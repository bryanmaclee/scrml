# U4 premise check — does ES-module scope dissolve the S279 cross-chunk collision?

Answer: **no.** See `../progress-u4.md` for the full finding.

Re-run (from the repo root):

```sh
bun run compiler/bin/scrml.js compile docs/changes/esm-chunks/u4-premise-check/fx \
  -o /tmp/fx-esm --module-format=esm
bun docs/changes/esm-chunks/u4-premise-check/premise-check.mjs /tmp/fx-esm
```

The harness serves the real emitted artifacts, loads `alpha.html` in a real Chromium (puppeteer),
then performs exactly the `import()` a nav-time chunk loader would perform for a cross-chunk target
(`await import("./beta.client.js")`) and re-reads the DOM.

`executablePath` is pinned to the installed Chromium — puppeteer's bundled default resolves to a
version that is not installed on this machine. Update the path if the local cache changes.

Expected output:

```
alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
VERDICT: alpha's rendered rows WERE CLOBBERED by beta's chunk (module scope did NOT isolate)
```
