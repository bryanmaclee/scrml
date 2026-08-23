/**
 * select-request-onion — §40.3/§40.8: which `handle()` onion does a compiled
 * server mount?
 *
 * THE RULE. The request onion is APPLICATION-scope, not per-module:
 *
 *   - §40.3.4 — `handle()` "applies to all HTTP requests handled by the compiled
 *     server — including statically-served assets". It is one onion around ALL
 *     dispatch, not one per module.
 *   - §40.8 — the `<program>` middleware attributes (`cors=` / `log=` /
 *     `headers=` / `ratelimit=` / `idempotency-*` / `channel-reconnect=`) are
 *     "app-scope (not per-route)", and an application "SHALL declare its
 *     top-level `<program>` element exactly ONCE, in the application's entry
 *     file".
 *
 * So a compiled server mounts EXACTLY ONE onion, and it runs exactly once per
 * request. In the canonical v0.3 shape the question never arises: the entry file
 * declares `<program>` (with the middleware attributes and/or `handle()`) and the
 * `pages/*.scrml` route files declare `<page>`, which emits no onion at all.
 *
 * WHY NOT COMPOSE THEM. Composing every module's onion means (a) every module's
 * `handle()` PRE runs on every other module's page — measured: two modules, two
 * requests, four log lines, alpha's `handle()` stamping beta's document — and
 * (b) the composition order is the module-discovery order, which is sorted by
 * FILENAME. Renaming `api.scrml` to `zapi.scrml` would silently change which
 * `handle()` wins a contested path. Precedence has to be something an author
 * reads off the source, and `<program>` is exactly that.
 *
 * MORE THAN ONE CANDIDATE is more than one application emitted into one server.
 * The server cannot know which application governs a request that belongs to
 * neither, and guessing by filename is the thing this rule exists to prevent —
 * so it is `E-MW-007`, reported against every competing source. (§40.8 already
 * reserves `E-PROGRAM-002` for the underlying shape: a second top-level
 * `<program>` in another file of the same application.)
 */

/**
 * @typedef {object} OnionModule
 * @property {string} filename          dist-relative `*.server.js` path
 * @property {string[]} [middlewareNames] `_scrml_mw_pipeline` when the module hosts an onion
 * @property {string|null} [middlewareDeclaredIn] the `.scrml` source that declares it
 */

/**
 * Pick the single application onion out of a build's server modules.
 *
 * @param {OnionModule[]} serverModules
 * @returns {{ onion: OnionModule|null, error: null|{ code: string, message: string, sources: string[] } }}
 */
export function selectRequestOnion(serverModules) {
  const candidates = (serverModules ?? []).filter(
    (m) => (m.middlewareNames ?? []).length > 0,
  );

  if (candidates.length === 0) return { onion: null, error: null };
  if (candidates.length === 1) return { onion: candidates[0], error: null };

  const sources = candidates.map(
    (m) => m.middlewareDeclaredIn || m.filename,
  );
  return {
    onion: null,
    error: {
      code: "E-MW-007",
      sources,
      message:
        `this build declares the request pipeline in ${sources.length} different sources ` +
        `(${sources.join(", ")}), but a compiled server has exactly ONE request onion.\n` +
        `  \`handle()\` and the <program> middleware attributes (cors= / log= / headers= / ` +
        `ratelimit= / idempotency-* / channel-reconnect=) are APPLICATION-scope: §40.3.4 applies ` +
        `the onion to every HTTP request the server handles, and §40.8 declares the top-level ` +
        `<program> exactly once per application, in the entry file.\n` +
        `  Two of them means two applications emitted into one server, and the server cannot know ` +
        `which one governs a request that belongs to neither. Composing them by module order would ` +
        `let a RENAME decide, and would run every module's handle() PRE on every other module's page.\n` +
        `  Fix: build one application per output directory, or move the app-scope middleware into ` +
        `the single entry <program> (a pages/*.scrml route file declares <page> and emits no onion).`,
    },
  };
}

/**
 * Format `E-MW-007` the way both hosts print a fatal diagnostic.
 * @param {{ code: string, message: string, sources: string[] }} error
 * @returns {string}
 */
export function formatOnionConflict(error) {
  return `${error.code}: ${error.message}`;
}
