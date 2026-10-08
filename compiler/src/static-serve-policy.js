/**
 * @module static-serve-policy
 *
 * SPEC §47.13 — what a scrml server may hand out as a static file.
 *
 * The decision itself lives in `static-serve-policy-emitted.js`, and both
 * static-serving sites use it, so `scrml dev` and the production `_server.js`
 * cannot drift:
 *
 *   - `scrml dev` (commands/dev.js `devDispatch`) imports the functions;
 *   - `scrml build` (commands/build.js `generateServerEntry`) copies their SOURCE
 *     TEXT into `_server.js` (`STATIC_POLICY_EMIT_SOURCE`), because the generated
 *     server is a standalone file that must not import the compiler. The text is
 *     read from disk rather than taken from `Function.prototype.toString`, which
 *     under Bun returns TRANSPILED source (comments dropped, `false` → `!1`).
 *
 * THE RULE (fail-closed). A file under the serve root is served iff
 *
 *     NOT denied  AND  ( it is in the build's client-asset manifest
 *                        OR it is a passive media / font asset )
 *
 * This module adds the build-side half: `collectClientAssets` computes the
 * manifest — the artifacts the compiler wrote for the browser (documents, CSS,
 * client bundles, the shared runtime, per-route chunks) plus everything those
 * bundles import. `compileScrml` writes it to `<outputDir>/.scrml-client-assets.json`
 * (a dotfile, so the manifest is itself unservable) and returns it as
 * `clientAssets`; `scrml build` bakes it into `_server.js` as `_SCRML_CLIENT_ASSETS`.
 *
 * Before this module (g-static-server-serves-db-and-server-source, S441) both
 * servers served ANY existing file under the output dir: the SQLite database, the
 * session store (`.scrml-sessions.db`), every `*.server.js`, `_server.js` itself,
 * and the MCP sidecars.
 */

import { readFileSync, statSync } from "fs";
import { dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { _scrml_static_denied } from "./static-serve-policy-emitted.js";

export {
  _scrml_static_request_path,
  _scrml_static_denied,
  _scrml_static_servable,
} from "./static-serve-policy-emitted.js";

/** The manifest filename, written beside the build output (a dotfile: never served). */
export const CLIENT_ASSET_MANIFEST = ".scrml-client-assets.json";

/**
 * The policy functions' source text as emitted into `_server.js`: the file
 * verbatim, with `export` dropped from each declaration.
 */
export const STATIC_POLICY_EMIT_SOURCE = readFileSync(
  fileURLToPath(new URL("./static-serve-policy-emitted.js", import.meta.url)),
  "utf8",
).replace(/^export function /gm, "function ").trimEnd();

/**
 * The serve-root-relative, `/`-separated form of an absolute candidate path.
 *
 * @param {string} root
 * @param {string} abs
 * @returns {string}
 */
export function relFromRoot(root, abs) {
  return relative(root, abs).split(sep).join("/");
}

/**
 * Read a dist directory's client-asset manifest. A missing or malformed manifest
 * yields an EMPTY set — fail closed: with no manifest nothing but passive media is
 * servable.
 *
 * @param {string} outputDir
 * @returns {Set<string>}
 */
export function readClientAssetManifest(outputDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(outputDir, CLIENT_ASSET_MANIFEST), "utf8"));
    if (Array.isArray(parsed.clientAssets)) {
      return new Set(parsed.clientAssets.filter((a) => typeof a === "string"));
    }
  } catch { /* no manifest → nothing but passive media is served */ }
  return new Set();
}

// Relative-module specifiers in a JS file: static `import … from`, `export … from`,
// side-effect `import "x"`, and dynamic `import("x")`.
// `\b` (not `\s`) after the keyword: a production build strips whitespace from the shipped
// bundles (S459, §47.9.9), so an import clause can read `import{a}from"./x.js"` or
// `import*as m from"./x.js"`.
const IMPORT_SPECIFIER_RES = [
  /\b(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/**
 * The client-asset manifest: the artifacts the compiler wrote for the browser,
 * closed over the relative imports of every JavaScript file among them. The
 * closure is what brings in the `_scrml/<name>.js` stdlib shims a client bundle
 * imports (and their own sibling imports), without admitting a shim only the
 * server imports.
 *
 * A closure target is admitted only if it is a real file inside `outputDir` and
 * not in a denied class — a client bundle that imports a `*.server.js` does not
 * make that module servable.
 *
 * @param {string} outputDir
 * @param {Iterable<string>} seeds  outputDir-relative `/`-separated paths
 * @returns {string[]} sorted, deduplicated
 */
export function collectClientAssets(outputDir, seeds) {
  const assets = new Set();
  const queue = [];
  const admit = (rel) => {
    if (assets.has(rel) || _scrml_static_denied(rel)) return;
    try {
      if (!statSync(join(outputDir, rel)).isFile()) return;
    } catch {
      return;
    }
    assets.add(rel);
    if (rel.endsWith(".js") || rel.endsWith(".mjs")) queue.push(rel);
  };
  for (const s of seeds) admit(s);
  while (queue.length > 0) {
    const rel = queue.shift();
    let text;
    try {
      text = readFileSync(join(outputDir, rel), "utf8");
    } catch {
      continue;
    }
    for (const re of IMPORT_SPECIFIER_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const spec = m[1];
        let target;
        if (spec.startsWith("./") || spec.startsWith("../")) {
          target = join(outputDir, dirname(rel), spec);
        } else if (spec.startsWith("/") && !spec.startsWith("//")) {
          target = join(outputDir, spec);
        } else {
          continue; // bare / URL specifier — not a file in this dist
        }
        const targetRel = relFromRoot(outputDir, target);
        if (targetRel.startsWith("..")) continue; // outside the dist root
        admit(targetRel);
      }
    }
  }
  return [...assets].sort();
}
