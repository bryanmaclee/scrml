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

export function join(...segments) {
  const filtered = segments.filter((s) => s !== null && s !== undefined);
  if (filtered.length === 0) return ".";
  return nodePath.join(...filtered);
}

export function resolve(...segments) {
  const filtered = segments.filter((s) => s !== null && s !== undefined);
  if (filtered.length === 0) return nodePath.resolve();
  return nodePath.resolve(...filtered);
}

export function dirname(filePath) {
  if (filePath === null || filePath === undefined) return ".";
  return nodePath.dirname(filePath);
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
  return nodePath.relative(from, to);
}

export function normalize(filePath) {
  if (filePath === null || filePath === undefined) return ".";
  return nodePath.normalize(filePath);
}

export const sep = "/";
