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

/**
 * Fold the chunk-namespace token out of ENGINE-derived names only.
 *
 * N4 namespaces every per-engine top-level const and the mount attribute, so
 * `__scrml_engine_appMode_transitions` is emitted as
 * `__scrml_engine_0a1b2c3d_appMode_transitions`. A test asserting the former is
 * asserting WHICH ENGINE, not which chunk — the chunk-identity axis has its own
 * dedicated coverage in `compiler/tests/unit/chunk-namespacing.test.js`, which
 * pins the token directly.
 *
 * Deliberately NARROW: it touches only `_scrml_engine_<token>_` /
 * `__scrml_engine_<token>_` and `data-scrml-engine-mount="<token>_"`. A blanket
 * token strip would also eat the N1 each/match tokens that other assertions in
 * the same corpus legitimately pin.
 */
export function unNamespaceEngineNames(js) {
  return String(js ?? "")
    .replace(/(_{1,2}scrml_engine_)0[0-9a-z]{7}_/g, "$1")
    .replace(/(data-scrml-engine-mount=")0[0-9a-z]{7}_/g, "$1");
}

/**
 * Fold the chunk-namespace token out of QUOTED cell-store keys:
 * `"0a1b2c3d$appMode"` -> `"appMode"`.
 *
 * Almost no emitted code needs this — the chunk's scoped accessors keep writing
 * BARE names, which is the point. It exists for the handful of assertions that
 * pin a site indexing `_scrml_state` (or a store-keyed registry) DIRECTLY, where
 * the resolved key really is what lands in the output.
 *
 * The `"0` + 7 base36 + `$` shape is unambiguous: a token always starts `0`
 * (fnv1a is a u32, and 36^7 > 2^32) and `$` is not otherwise used as a key
 * separator.
 */
export function unNamespaceCellKeys(js) {
  return String(js ?? "").replace(/("|')0[0-9a-z]{7}\$/g, "$1");
}

/**
 * The inverse of the chunk wrap: strip the per-chunk IIFE and its cell-scope
 * prologue, leaving the body's declarations at top level.
 *
 * For harnesses that execute an emitted chunk WITHOUT the runtime, to probe pure
 * LOWERING — they build `new Function(shims + clientJs + "return (someFn())")`
 * and read a top-level declaration the chunk makes. Chunk isolation is precisely
 * what hides that declaration from them, and the prologue's `_scrml_cell_scope`
 * call has no runtime to resolve against.
 *
 * This does NOT weaken what those tests assert: they pin the SHAPE of the
 * emitted lowering, and the wrap is not part of that shape. Chunk isolation has
 * its own dedicated coverage in `compiler/tests/unit/chunk-namespacing.test.js`.
 */
export function unwrapChunkScope(js) {
  let out = String(js ?? "");
  // Drop the prologue (comment block + the destructuring const).
  out = out.replace(
    /\n?\/\/ --- chunk cell scope \([0-9a-z]{8}\) ---[\s\S]*?_scrml_cell_scope\([^;]*\);\n/,
    "\n",
  );
  // Drop the IIFE wrapper, keeping the body.
  const open = out.indexOf("(function() {\n");
  const close = out.lastIndexOf("\n})();");
  if (open !== -1 && close > open) {
    out = out.slice(0, open) + out.slice(open + "(function() {\n".length, close) + out.slice(close + "\n})();".length);
  }
  return out;
}

/**
 * Normalize a chunk's namespace token to a fixed placeholder.
 *
 * For BYTE-PARITY comparisons: two compiles of the same source at two different
 * temp paths get two different tokens by construction, since the token is a hash
 * of the path. Those tests compare the two LOWERINGS, not the two paths.
 *
 * Exact rather than pattern-based — it reads the chunk's own token out of the
 * prologue and replaces exactly that string, so it cannot touch anything else
 * that happens to look token-shaped.
 */
export function normalizeChunkToken(js) {
  const src = String(js ?? "");
  const ns = chunkNamespaceToken(src);
  return ns ? src.split(ns).join("NSTOK") : src;
}

/**
 * A view of the raw `_scrml_state` store keyed by AUTHOR cell names.
 *
 * For harnesses that capture the store OBJECT itself rather than an accessor and
 * then index it by bare name. Splicing a capture inside the chunk scope does not
 * help them: the store is the shared singleton, and it is its KEYS that are
 * namespaced.
 *
 * A stripped name that COLLIDES keeps the namespaced key alongside it, so a
 * second chunk's value is surfaced rather than silently overwritten — a snapshot
 * that quietly drops a cell is exactly the hollow evidence this whole arc is
 * about.
 */
export function storeByAuthorName(state) {
  const out = {};
  for (const k of Object.keys(state ?? {})) {
    const name = k.replace(/^0[0-9a-z]{7}\$/, "");
    if (name !== k && Object.prototype.hasOwnProperty.call(out, name)) out[k] = state[k];
    else out[name] = state[k];
  }
  return out;
}
