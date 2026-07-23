/**
 * Test helper — reach a chunk's cell accessors from OUTSIDE the chunk.
 *
 * chunk-namespacing (S282) wraps every emitted client chunk in its own scope:
 *
 *   (function () {
 *     const { _scrml_reactive_get, _scrml_reactive_set } = _scrml_cell_scope("0a1b2c3d");
 *     … body …
 *   })();
 *
 * so the chunk's cells live under `0a1b2c3d$rows` and the accessors that reach
 * them are chunk-LOCAL. A happy-dom harness that appends
 * `globalThis.get = _scrml_reactive_get;` after the chunk therefore captures the
 * GLOBAL accessor, which keys bare and finds nothing.
 *
 * Two ways to fix a harness. Prefer the first:
 *
 *   1. `captureInsideChunkScope(clientJs, src)` — splice the capture lines INSIDE
 *      the chunk's IIFE so they close over the chunk's OWN accessors. Every
 *      existing call site keeps using BARE cell names and needs no edit at all.
 *
 *   2. `chunkCellKey(clientJs)` — read the chunk's token out of its prologue and
 *      build `<token>$name` yourself. Use where a harness cannot inject code
 *      (it loads a pre-built artifact, or drives `_scrml_state` directly).
 *
 * Both READ the token rather than hard-coding one, and both degrade to the bare
 * name when the chunk carries no namespace (a synthetic fixture), so they stay
 * correct if the token shape ever changes.
 */

/** The IIFE closer the chunk wrap emits. */
const CHUNK_CLOSER = "\n})();";

/**
 * Splice `captureSrc` in just before the chunk scope's closing `})();`, so the
 * statements run INSIDE the chunk and see its shadowed accessors.
 *
 * Returns `clientJs + captureSrc` unchanged when the chunk is not wrapped (esm,
 * embed-runtime, or a pre-namespacing artifact) — in that case the accessors are
 * already reachable at the top level and nothing needs relocating.
 */
export function captureInsideChunkScope(clientJs, captureSrc) {
  const at = clientJs.lastIndexOf(CHUNK_CLOSER);
  if (at === -1) return clientJs + "\n" + captureSrc;
  return clientJs.slice(0, at) + "\n" + captureSrc + clientJs.slice(at);
}

/**
 * The chunk's namespace token, or "" when it carries none.
 *
 * Read from the prologue the chunk emits for itself, so a token-shape change
 * cannot silently desynchronise the tests from the compiler.
 */
export function chunkNamespaceToken(clientJs) {
  const m = /_scrml_cell_scope\("([0-9a-z]{8})"/.exec(String(clientJs ?? ""));
  return m ? m[1] : "";
}

/**
 * Build a `name -> storeKey` mapper for a chunk. Bare names pass through
 * unchanged when the chunk has no namespace.
 */
export function chunkCellKey(clientJs) {
  const ns = chunkNamespaceToken(clientJs);
  return (name) => (ns ? `${ns}$${name}` : name);
}
