// SPEC §47.13 — static-serving policy. A file under the serve root is served iff it
// is NOT in a denied class AND it is either a client artifact the build wrote (the
// client-asset manifest) or a passive media/font asset. Everything else is a 404.
//
// This file is the ONE source of that policy. `scrml dev` imports it; `scrml build`
// copies its text into the generated `_server.js` (with `export` removed). Keep it
// self-contained: no imports, no module-level names — each function may reference
// only its parameters, its own locals, and the other functions in this file.

/**
 * Turn a request URL pathname into a normalized `/`-rooted path that is safe to
 * join onto the serve root, or `false` when the request must be refused.
 *
 * The pathname is percent-DECODED first, so an encoded traversal (`%2e%2e`, `%2f`,
 * `%5c`) is judged in the form the filesystem would see. Refused outright:
 *   - undecodable escapes, NUL, backslash (a Windows separator), and `:` (a Windows
 *     drive letter or NTFS alternate-data-stream suffix);
 *   - any segment that begins with `.` — this covers `.`/`..` traversal AND every
 *     dotfile or dot-directory (`.env`, `.git`, `.scrml-sessions.db`);
 *   - any segment that ends in `.` or a space (Windows resolves `app.db.` to
 *     `app.db`, which would slip past an extension check).
 *
 * @param {string} pathname  `new URL(req.url).pathname`
 * @returns {string|false}
 */
export function _scrml_static_request_path(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (/[\0\\:]/.test(decoded)) return false;
  const segments = decoded.split("/").filter((s) => s !== "");
  for (const s of segments) {
    if (s.startsWith(".") || s.endsWith(".") || s.endsWith(" ")) return false;
  }
  return "/" + segments.join("/");
}

/**
 * True when a serve-root-relative path is in a class that is NEVER served, whatever
 * else is true of it. Case-insensitive, because a case-insensitive filesystem
 * resolves `APP.SERVER.JS` to `app.server.js`.
 *
 * Denied: anything outside the root or on a dot-path; server modules and their maps
 * (`*.server.*`, `_server.js`); databases (`*.db`, `*.db-wal`, `*.db-shm`,
 * `*.db-journal`, `*.sqlite*`); `.scrml` sources; and every source map — a client
 * map embeds the WHOLE `.scrml` source (server functions and SQL included) as
 * `sourcesContent`, so it is a source leak under another name.
 *
 * @param {string} rel  serve-root-relative path, `/`-separated
 * @returns {boolean}
 */
export function _scrml_static_denied(rel) {
  const p = rel.toLowerCase();
  if (p === "" || p.startsWith("/") || /[\0\\:]/.test(p)) return true;
  const segments = p.split("/");
  for (const s of segments) {
    if (s === "" || s.startsWith(".") || s.endsWith(".") || s.endsWith(" ")) return true;
  }
  const name = segments[segments.length - 1];
  if (name === "_server.js" || name.includes(".server.")) return true;
  if (/\.(db|db-wal|db-shm|db-journal)$/.test(name)) return true;
  if (name.includes(".sqlite")) return true;
  if (name.endsWith(".scrml") || name.endsWith(".map")) return true;
  return false;
}

/**
 * True when a serve-root-relative path may be served.
 *
 * Passive media is admitted without a manifest entry because the author places it
 * beside the build output by hand (images, icons, fonts, audio/video): none of these
 * types runs as script when a page loads it as media, and none is a compiler output
 * that could carry server code. Anything else the build did not write for the
 * browser is refused.
 *
 * @param {string} rel                serve-root-relative path, `/`-separated
 * @param {Set<string>} clientAssets  the build's client-asset manifest
 * @returns {boolean}
 */
export function _scrml_static_servable(rel, clientAssets) {
  if (_scrml_static_denied(rel)) return false;
  if (clientAssets.has(rel)) return true;
  const dot = rel.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = rel.slice(dot + 1).toLowerCase();
  return [
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp",
    "woff", "woff2", "ttf", "otf", "eot",
    "mp3", "mp4", "webm", "ogg", "wav",
  ].includes(ext);
}
