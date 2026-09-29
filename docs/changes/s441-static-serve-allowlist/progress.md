# s441-static-serve-allowlist — progress

- [x] Reproduced. A `scrml build` dist contains app.html, app.<h>.css, app.client.<h>.js,
      scrml-runtime.<h>.js, app.server.js, and _server.js. The static loops in both
      `_server.js` (build.js `generateServerEntry`) and `dev.js` `devDispatch` served
      any existing file under the dist root. The same hole exposed
      `.scrml-sessions.db` (the session store sits in the dist root), the MCP sidecars
      (`serverfns.json`), `chunks.json`, and `*.map` files. A client map embeds the
      whole .scrml source as sourcesContent.
- [x] Serving sites found:
  1. `generateServerEntry` in compiler/src/commands/build.js, which emits `_server.js`;
  2. `devDispatch` in compiler/src/commands/dev.js.
  `scrml serve` (commands/serve.js) is a compile-RPC server, not a static server.
  The emit-tool serve harness serves only endpoints. The emit-server SSR path reads
  its own fixed .html.
- [x] Design, in compiler/src/static-serve-policy-emitted.js: one self-contained policy
      source. Dev imports it. Build copies its TEXT verbatim into `_server.js`.
      `Function#toString` was rejected because Bun returns transpiled source.
      Allow = not denied AND (in the build's client-asset manifest OR passive
      media/font extension). compileScrml computes `clientAssets`: the emitted client
      artifacts plus their relative-import closure. It writes
      `.scrml-client-assets.json`, a dotfile and so itself unservable. Build bakes the
      set into `_server.js`. Dev re-reads the manifest file whenever its mtime or
      size changes.
- [x] Commit 1 (3333cc763): code, gate-tier integration test, commands-tier dev
      HTTP test, and two fixtures updated to pass clientAssets.
      - The gate-tier test runs the real `_server.js` and the real dev app child
        (`scrml dev --__dev-child`) in child processes and probes them over raw
        sockets. The first attempt used in-process `fetch`. It failed in the gate
        because a leaked happy-dom `fetch` issued CORS OPTIONS requests, which is
        exactly the hazard the brief warned about.
      - RED-verified: with the denied-class check disabled, 5 of 15 tests fail.
- [x] SPEC §47.13 added (normative allowlist + SHALL NOT serve server modules,
      databases, dotfiles, sources). SPEC-INDEX §47 row + regen.
- [x] known-gaps resolved entry `g-static-server-serves-db-and-server-source`;
      state.ts / facts.ts regenerated.
- [x] Sweep of examples/ and samples/: no app relies on serving a non-client file.
      The only static refs are `logo.png` / `/example.png` / `/logo.png` in three
      compilation-test samples, and media is still served. Example 23 dist: 83
      client files served; 34 refused (every `*.server.js`, `_server.js`, the
      manifest, and 7 `_scrml/*.js` shims, all imported only by server modules).
