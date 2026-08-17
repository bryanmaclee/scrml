/**
 * §61.3 / §40 — the bounded, fail-closed JSON request-body read (dpa-030 D4).
 *
 * THREE server prologues decoded a foreign request body with one unguarded line:
 *
 *     const _scrml_body = await _scrml_req.json();
 *
 * — the baseline-CSRF server-fn RPC handler, the non-CSRF one, and the §61
 * `<endpoint>` handler. That single line carries two defects, both MEASURED by
 * executing the emitted artifact (`examples/33-endpoint.scrml`, POST /fsp):
 *
 *   1. NO CEILING. A 10 MiB body was read in full and processed. Nothing in the
 *      emitted server bounds an inbound body at any size — a live DoS that
 *      predates uploads and is reachable by any unauthenticated foreign client on
 *      an `<endpoint>` (§61.7: JSON+bearer routes are CSRF-exempt BY DESIGN).
 *
 *   2. MALFORMED JSON THROWS.
 *          `{not json at all`  -> THREW SyntaxError: Failed to parse JSON
 *          `` (empty body)     -> THREW SyntaxError: Unexpected end of JSON input
 *      §61.3 promises a COMPILER-OWNED `{ error: { kind, message } }` 400 for a
 *      decode failure. That envelope was structurally unreachable for the input
 *      class a foreign client is MOST likely to send: `parseVariant` never ran,
 *      because `req.json()` threw one line above it. The decode-failure envelope
 *      existed and could not be reached from the outside.
 *
 * THE CEILING IS ENFORCEABLE, NOT ADVISORY — this is measured, not assumed. Bun
 * can stream-count-abort `req.body` without materializing it: 10 MiB offered
 * against a 1 MiB ceiling returned 413, aborted early, never fully read, peak
 * buffered 1088 KiB (one 64 KiB chunk of overshoot — the floor), and only 20 of
 * 160 chunks were ever pulled from the client, so backpressure held.
 *
 * ⚠ WHERE THE LIMIT LIVES IS DELIBERATELY *NOT* A LANGUAGE SURFACE YET.
 * A `<program maxBodySize="…">` attribute is the obvious ergonomic home and it is
 * a LANGUAGE-SURFACE addition, so it is NOT invented here — it needs ratification
 * (Rule 4: SPEC is normative, and §40's `<program>` attribute registry is a
 * ratified surface). The ceiling is a single compiler-owned constant below, named
 * and emitted as a named `const` in the generated helper, so a future
 * `<program>` attribute or `scrml.toml` key has exactly ONE site to feed and the
 * current value is greppable in the adopter's own server bundle.
 */

/**
 * The default inbound JSON body ceiling, in bytes.
 *
 * 1 MiB. These three prologues decode a JSON RPC / `<endpoint>` body — a
 * structured argument list, not a payload. For scale: nginx defaults to 1 MiB
 * (`client_max_body_size 1m`) and Express's `json()` to 100 KiB. FILE UPLOADS DO
 * NOT PASS THROUGH HERE — they arrive as `multipart/form-data` through
 * `request.formData()` in a `handle()` body (§40.3), which is a different read
 * path and is NOT bounded by this constant. Bounding uploads is a separate
 * question with a different right answer, and conflating the two would either
 * cripple uploads or un-bound RPC.
 */
export const SERVER_JSON_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * The server-bundle runtime helper (§61.3 / dpa-030 D4). Injected into the server
 * module IFF `_scrml_read_json_body` is referenced. Server-only.
 *
 * Returns `{ ok: true, value }` on success or `{ ok: false, response }` carrying
 * the compiler-owned envelope — so the caller never has to distinguish a decoded
 * `null` body from a failure, and every early exit is an ordinary `return`
 * OUTSIDE any transaction envelope or capture IIFE.
 */
export const SERVER_JSON_BODY_GUARD_HELPER: string = [
  "",
  "// --- §61.3 Bounded, fail-closed inbound JSON body read (compiler-owned) ---",
  "// Two guarantees the bare `await req.json()` did not give:",
  "//   1. a body larger than the ceiling is REFUSED with 413, stream-aborted, and",
  "//      never fully read into memory (backpressure holds — measured);",
  "//   2. a malformed body yields the §61.3 `{ error: { kind, message } }` 400",
  "//      envelope instead of an uncaught SyntaxError.",
  `const _SCRML_JSON_BODY_LIMIT = ${SERVER_JSON_BODY_LIMIT_BYTES};`,
  "function _scrml_body_error(kind, message, status) {",
  "  return new Response(JSON.stringify({ error: { kind, message } }), {",
  "    status,",
  "    headers: { \"Content-Type\": \"application/json\" },",
  "  });",
  "}",
  "async function _scrml_read_json_body(_scrml_req) {",
  "  // Fast reject on a declared length. `Content-Length` is advisory (it can be",
  "  // absent on a chunked body and it can lie), so the streaming count below is",
  "  // the authority — this only avoids reading a body that already admits it is",
  "  // too large.",
  "  const declared = Number(_scrml_req.headers.get(\"Content-Length\"));",
  "  if (Number.isFinite(declared) && declared > _SCRML_JSON_BODY_LIMIT) {",
  "    return { ok: false, response: _scrml_body_error(",
  "      \"PayloadTooLarge\",",
  "      \"request body is \" + declared + \" bytes; the limit is \" + _SCRML_JSON_BODY_LIMIT,",
  "      413,",
  "    ) };",
  "  }",
  "  if (!_scrml_req.body) {",
  "    return { ok: false, response: _scrml_body_error(",
  "      \"MalformedBody\", \"request has no body; a JSON object was expected\", 400,",
  "    ) };",
  "  }",
  "  // Stream-count against the ceiling. On overflow the reader is CANCELLED, so",
  "  // the remainder is never pulled from the client and peak memory is bounded by",
  "  // the ceiling plus one chunk.",
  "  const chunks = [];",
  "  let total = 0;",
  "  const reader = _scrml_req.body.getReader();",
  "  try {",
  "    while (true) {",
  "      const { done, value } = await reader.read();",
  "      if (done) break;",
  "      total += value.byteLength;",
  "      if (total > _SCRML_JSON_BODY_LIMIT) {",
  "        await reader.cancel();",
  "        return { ok: false, response: _scrml_body_error(",
  "          \"PayloadTooLarge\",",
  "          \"request body exceeds \" + _SCRML_JSON_BODY_LIMIT + \" bytes\",",
  "          413,",
  "        ) };",
  "      }",
  "      chunks.push(value);",
  "    }",
  "  } catch (streamErr) {",
  "    return { ok: false, response: _scrml_body_error(",
  "      \"MalformedBody\", \"request body could not be read: \" + String(streamErr && streamErr.message || streamErr), 400,",
  "    ) };",
  "  }",
  "  const merged = new Uint8Array(total);",
  "  let at = 0;",
  "  for (const c of chunks) { merged.set(c, at); at += c.byteLength; }",
  "  const text = new TextDecoder().decode(merged);",
  "  try {",
  "    return { ok: true, value: JSON.parse(text) };",
  "  } catch (parseErr) {",
  "    // §61.3's compiler-owned envelope. `kind` joins the §41.13 ParseError",
  "    // family the decode path already reports (MissingDiscriminator /",
  "    // UnknownVariant / InvalidPayload) — this is the one that fires BEFORE",
  "    // parseVariant can run at all.",
  "    return { ok: false, response: _scrml_body_error(",
  "      \"MalformedBody\",",
  "      \"request body is not valid JSON: \" + String(parseErr && parseErr.message || parseErr),",
  "      400,",
  "    ) };",
  "  }",
  "}",
  "",
].join("\n");

/**
 * The three emitted lines every JSON prologue now uses in place of the bare
 * `const _scrml_body = await _scrml_req.json();`. `indent` matches the call site.
 *
 * Emitted OUTSIDE any `BEGIN DEFERRED` transaction envelope and outside the
 * result-capture IIFE, on purpose: the early exits are plain `return`s of a real
 * `Response`, so they cannot leave a transaction open and cannot be swallowed by
 * the envelope that `JSON.stringify`s the IIFE's value.
 */
export function emitJsonBodyRead(indent: string): string[] {
  return [
    `${indent}// §61.3 — bounded, fail-closed body read (413 over the ceiling, 400 on malformed).`,
    `${indent}const _scrml_body_read = await _scrml_read_json_body(_scrml_req);`,
    `${indent}if (!_scrml_body_read.ok) return _scrml_body_read.response;`,
    `${indent}const _scrml_body = _scrml_body_read.value;`,
  ];
}
