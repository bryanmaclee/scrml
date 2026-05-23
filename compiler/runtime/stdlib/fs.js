// scrml:fs — runtime shim
//
// Hand-written ES module mirroring stdlib/fs/index.scrml. Server-only:
// scrml:fs is in SERVER_ONLY_SCRML_MODULES (§12.2 Trigger 3) so route
// inference escalates importing functions to server. All operations
// delegate to Node's `node:fs` (also available in Bun).
//
// Surface (must match stdlib/fs/index.scrml exports):
//   - readFileSync(path, encoding?)   → string
//   - writeFileSync(path, content, encoding?)
//   - existsSync(path)                → boolean
//   - mkdirSync(dir, options?)
//   - readdirSync(dir)                → string[]
//   - statSync(path)                  → { isFile, isDirectory, size, mtime } | null
//   - rmSync(path, options?)

import nodeFs from "node:fs";

export function readFileSync(path, encoding) {
  return nodeFs.readFileSync(path, { encoding: encoding || "utf-8" });
}

export function writeFileSync(path, content, encoding) {
  nodeFs.writeFileSync(path, content, { encoding: encoding || "utf-8" });
}

export function existsSync(path) {
  return nodeFs.existsSync(path);
}

export function mkdirSync(dir, options) {
  const opts = options || { recursive: true };
  nodeFs.mkdirSync(dir, opts);
}

export function readdirSync(dir) {
  return nodeFs.readdirSync(dir);
}

export function statSync(path) {
  // Mirrors stdlib/fs/index.scrml: returns `not` (host: null) on ENOENT.
  try {
    const s = nodeFs.statSync(path);
    return {
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      size: s.size,
      mtime: s.mtime,
    };
  } catch (e) {
    return null;
  }
}

export function rmSync(path, options) {
  const opts = options || { recursive: false, force: false };
  nodeFs.rmSync(path, opts);
}
