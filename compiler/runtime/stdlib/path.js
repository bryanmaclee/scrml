// scrml:path — runtime shim
//
// Hand-written ES module mirroring stdlib/path/index.scrml. Cross-platform
// path utilities backed by Node's built-in `node:path` module. Pure string
// manipulation — no I/O. Safe wherever `node:path` is available (server
// runtimes: Bun + Node). A browser-side caller will fail at the `require`
// resolution, which mirrors the SERVER_ONLY_SCRML_MODULES classification
// in route-inference (§12.2 Trigger 3).
//
// Surface (must match stdlib/path/index.scrml exports):
//   - join(...segments)        → string
//   - resolve(...segments)     → string
//   - dirname(filePath)        → string
//   - basename(filePath, ext?) → string
//   - extname(filePath)        → string
//   - relative(from, to)       → string
//   - normalize(filePath)      → string
//   - sep                      → "/"

import nodePath from "node:path";

// Normalize OS path separators to POSIX forward-slash form. Node emits NATIVE
// separators — `\` on Windows, `/` on POSIX. scrml:path is a deterministic,
// host-independent path library: its output is consumed as route keys, import
// specifiers, and URL fragments, all of which MUST be `/`-separated regardless
// of the host OS. Without this every re-joining function silently leaks `\` on
// Windows (`join("src","a.js")` → `src\a.js`). On POSIX this is a no-op.
function toPosixSep(p) {
  if (p === null || p === undefined) return p;
  return p.split("\\").join("/");
}

export function join(...segments) {
  const filtered = segments.filter((s) => s !== null && s !== undefined);
  if (filtered.length === 0) return ".";
  return toPosixSep(nodePath.join(...filtered));
}

export function resolve(...segments) {
  // POSIX resolver on every host: native nodePath.resolve() drive-roots a
  // `/`-leading path on Windows (`/usr` → `C:\usr`), breaking the documented
  // contract `resolve("/usr","local","bin") → "/usr/local/bin"`.
  // nodePath.posix.resolve keeps `/`-rooted paths `/`-rooted deterministically;
  // on POSIX it is identical to nodePath.resolve. toPosixSep flips the native
  // separators the captured cwd carries when no absolute segment is given.
  const filtered = segments.filter((s) => s !== null && s !== undefined);
  if (filtered.length === 0) return toPosixSep(nodePath.posix.resolve());
  return toPosixSep(nodePath.posix.resolve(...filtered));
}

export function dirname(filePath) {
  if (filePath === null || filePath === undefined) return ".";
  return toPosixSep(nodePath.dirname(filePath));
}

export function basename(filePath, ext) {
  if (filePath === null || filePath === undefined) return "";
  if (ext !== null && ext !== undefined) return nodePath.basename(filePath, ext);
  return nodePath.basename(filePath);
}

export function extname(filePath) {
  if (filePath === null || filePath === undefined) return "";
  return nodePath.extname(filePath);
}

export function relative(from, to) {
  if (from === null || from === undefined) from = ".";
  if (to === null || to === undefined) to = ".";
  return toPosixSep(nodePath.relative(from, to));
}

export function normalize(filePath) {
  if (filePath === null || filePath === undefined) return ".";
  return toPosixSep(nodePath.normalize(filePath));
}

export const sep = "/";
