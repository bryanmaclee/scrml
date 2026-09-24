/**
 * host-import.js — `import:host` (SPEC §21.3.1) + the `[capabilities]
 * host-import` manifest entry (SPEC §22.13).
 *
 * `import:host { a, b as c } from "./mod.ts"` is the ONE named carve-out that
 * lets a scrml file bind names from a host-language (TypeScript / JavaScript)
 * module. It is a file-top declaration, manifest-gated, and otherwise behaves
 * exactly like a plain `import { ... } from "..."` (the bindings enter the
 * file's logic scope; codegen emits a static ES import).
 *
 * Division of labour:
 *
 *   - BOTH front-ends (the live block-splitter + ast-builder path and the
 *     native parser) recognise the form and produce an ordinary `import-decl`
 *     node carrying one extra field, `hostTag` (the identifier after `import:`).
 *     Nothing downstream needs to know it was a host import except the gate
 *     below and the module resolver's host-module record.
 *
 *   - This module owns the rules that are identical for both front-ends:
 *       * reading the manifest (`scrml.toml`) — BEFORE any parse begins
 *         (§22.13); `api.js` calls `readHostImportCapability` for every input
 *         file ahead of the block splitter;
 *       * the post-parse gate `validateHostImports`, run immediately after the
 *         per-file parse and before any other stage consumes the AST:
 *           E-IMPORT-003  not at file top level (inside a `${}` block, a
 *                         `<program>` / `<page>` / `<channel>` body, or any
 *                         nested scope);
 *           E-IMPORT-009  host-tag other than `host`, OR a `host` target that
 *                         is not a TypeScript / JavaScript module;
 *           E-IMPORT-008  file outside the manifest allow-list.
 *       * the host-module record (`scanHostModule`) the module resolver uses
 *         for E-IMPORT-006 / E-IMPORT-004 / E-IMPORT-002 on host imports.
 *
 * A rejected host import keeps its bindings in scope (no cascading
 * E-SCOPE-001 on every use) but is marked `_hostImportRejected` so the module
 * resolver does not load the host module for it.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";

// ---------------------------------------------------------------------------
// Manifest — `[capabilities] host-import` (§22.13)
// ---------------------------------------------------------------------------

/** The project manifest file name (§22.13, §58.4, §62.6). */
export const MANIFEST_FILE_NAME = "scrml.toml";

/** The v1 `host-import` values (§22.13). Anything else is E-MANIFEST-001. */
export const HOST_IMPORT_VALUES = Object.freeze(["disabled", "self-host-only"]);

/**
 * The canonical bootstrap-stdlib path pattern `"self-host-only"` admits
 * (§22.13 — "canonical: `scrml/stdlib/compiler/**`"). Matched against the
 * importing file's path RELATIVE TO THE MANIFEST'S DIRECTORY (the project
 * root). The SPEC's leading `scrml/` names the repository directory itself,
 * which is the project root, so it is not part of the relative path. v1 has no
 * override key ("project-specific overrides via additional capability subkeys
 * reserved for future SPEC extension"), so this is the ONLY admitted pattern.
 */
export const SELF_HOST_PATH_PREFIX = "stdlib/compiler/";

/** The only host-tag v1 recognises (§21.3.1). */
export const HOST_TAG = "host";

/**
 * Host-module file extensions the `host` tag binds (§21.3.1 — "a host-language
 * module (TypeScript or JavaScript)").
 */
const HOST_MODULE_LOADERS = Object.freeze({
  ".js": "js",
  ".mjs": "js",
  ".ts": "ts",
  ".mts": "ts",
});

function extensionOf(p) {
  const m = /\.[A-Za-z0-9]+$/.exec(p);
  return m ? m[0].toLowerCase() : "";
}

/**
 * Find the manifest that governs `filePath`: walk up from the file's directory
 * to the nearest directory holding `scrml.toml`. The walk stops at a project
 * boundary — a directory holding `.git` (a directory for a clone, a file for a
 * worktree/submodule) — so a manifest that belongs to an ENCLOSING project is
 * never borrowed. Same marker set and precedence as `resolveProjectRoot`
 * (codegen/chunk-namespace.ts), without its process-lifetime memo: the manifest
 * is re-read on every compile so an edit takes effect on the next one.
 *
 * @param {string} filePath
 * @returns {{ projectRoot: string, manifestPath: string|null }|null}
 */
export function findManifest(filePath) {
  if (!filePath) return null;
  let dir = dirname(resolve(filePath));
  for (;;) {
    const candidate = join(dir, MANIFEST_FILE_NAME);
    if (existsSync(candidate)) return { projectRoot: dir, manifestPath: candidate };
    if (existsSync(join(dir, ".git"))) return { projectRoot: dir, manifestPath: null };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Parse a manifest's `[capabilities] host-import` entry.
 *
 * @param {string} manifestPath
 * @returns {{ value: "disabled"|"self-host-only", error: object|null, note: string|null }}
 *   `error` is an E-MANIFEST-001 diagnostic when the value is present but not a
 *   recognised v1 value. `note` explains a fail-closed read (unreadable /
 *   unparseable manifest) for inclusion in any E-IMPORT-008 message.
 */
export function parseHostImportEntry(manifestPath) {
  let text;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (e) {
    return { value: "disabled", error: null, note: `\`${manifestPath}\` could not be read (${e && e.message ? e.message : e}), so \`host-import\` is treated as "disabled"` };
  }
  if (typeof Bun === "undefined" || !Bun.TOML || typeof Bun.TOML.parse !== "function") {
    return { value: "disabled", error: null, note: `no TOML reader is available in this runtime, so \`${manifestPath}\` could not be read and \`host-import\` is treated as "disabled"` };
  }
  let doc;
  try {
    doc = Bun.TOML.parse(text);
  } catch (e) {
    return { value: "disabled", error: null, note: `\`${manifestPath}\` is not valid TOML (${e && e.message ? e.message : e}), so \`host-import\` is treated as "disabled"` };
  }
  const caps = doc && typeof doc === "object" ? doc.capabilities : undefined;
  if (caps === undefined) return { value: "disabled", error: null, note: null };
  if (caps === null || typeof caps !== "object" || Array.isArray(caps)) {
    return {
      value: "disabled",
      error: manifestError(manifestPath, `\`capabilities\` in \`${manifestPath}\` must be a table (\`[capabilities]\`).`),
      note: null,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(caps, "host-import")) {
    return { value: "disabled", error: null, note: null };
  }
  const raw = caps["host-import"];
  if (typeof raw === "string" && HOST_IMPORT_VALUES.includes(raw)) {
    return { value: raw, error: null, note: null };
  }
  return {
    value: "disabled",
    error: manifestError(
      manifestPath,
      `\`[capabilities] host-import = ${JSON.stringify(raw)}\` in \`${manifestPath}\` is not a recognised value. ` +
      `v1 recognises only "disabled" and "self-host-only" (§22.13). Until it is corrected, \`import:host\` is disabled for this project.`,
    ),
    note: null,
  };
}

function manifestError(manifestPath, detail) {
  return {
    code: "E-MANIFEST-001",
    message: `E-MANIFEST-001: ${detail}`,
    span: { file: manifestPath, start: 0, end: 0, line: 1, col: 1 },
    severity: "error",
    filePath: manifestPath,
  };
}

/**
 * The `host-import` capability that governs one source file.
 *
 * @param {string} filePath — absolute path of the scrml source file
 * @param {Map<string, object>} [cache] — per-compile memo keyed by manifest path
 * @returns {{
 *   value: "disabled"|"self-host-only",
 *   projectRoot: string|null,
 *   manifestPath: string|null,
 *   error: object|null,
 *   note: string|null,
 * }}
 */
export function readHostImportCapability(filePath, cache = null) {
  const found = findManifest(filePath);
  if (!found || !found.manifestPath) {
    return {
      value: "disabled",
      projectRoot: found ? found.projectRoot : null,
      manifestPath: null,
      error: null,
      note: null,
    };
  }
  let entry = cache ? cache.get(found.manifestPath) : undefined;
  if (!entry) {
    entry = parseHostImportEntry(found.manifestPath);
    if (cache) cache.set(found.manifestPath, entry);
  }
  return {
    value: entry.value,
    projectRoot: found.projectRoot,
    manifestPath: found.manifestPath,
    error: entry.error,
    note: entry.note,
  };
}

/**
 * Read the capability for every input file BEFORE any parse begins (§22.13).
 * Returns the per-file capability map plus the E-MANIFEST-001 diagnostics,
 * de-duplicated so one bad manifest reports once per compile.
 *
 * @param {string[]} filePaths — absolute paths
 * @returns {{ byFile: Map<string, object>, errors: object[] }}
 */
export function readHostImportCapabilities(filePaths) {
  const cache = new Map();
  const byFile = new Map();
  const errors = [];
  const reported = new Set();
  for (const fp of filePaths) {
    const cap = readHostImportCapability(fp, cache);
    byFile.set(fp, cap);
    if (cap.error && !reported.has(cap.manifestPath)) {
      reported.add(cap.manifestPath);
      errors.push(cap.error);
    }
  }
  return { byFile, errors };
}

/**
 * Is `filePath` inside the capability's allow-list?
 * @returns {boolean}
 */
export function isHostImportPermitted(filePath, cap) {
  if (!cap || cap.value !== "self-host-only" || !cap.projectRoot) return false;
  const rel = relative(cap.projectRoot, resolve(filePath)).split(sep).join("/");
  return rel.startsWith(SELF_HOST_PATH_PREFIX);
}

// ---------------------------------------------------------------------------
// Post-parse gate (both front-ends)
// ---------------------------------------------------------------------------

/**
 * The live nested-statement parser has no `import` branch, so an `import:host`
 * inside a nested statement list (an `if` / loop body) survives only as a
 * `bare-expr` whose text begins `import :`. The text IS the only structure
 * the AST carries for it at that position (the same reason
 * gauntlet-phase1-checks.js keys its E-IMPORT-003 bare-expr limb on text).
 */
const HOST_IMPORT_BARE_EXPR_RE = /^\s*import\s*:/;

function hostImportSpanKey(node) {
  const s = node && node.span;
  return s && typeof s.start === "number" ? s.start : null;
}

function describeCapability(cap) {
  if (!cap || !cap.manifestPath) {
    return `No \`${MANIFEST_FILE_NAME}\` governs this file, so \`[capabilities] host-import\` defaults to "disabled" (§22.13).`;
  }
  if (cap.note) return `In this project ${cap.note} (§22.13).`;
  if (cap.value === "disabled") {
    return `\`${cap.manifestPath}\` sets (or defaults) \`[capabilities] host-import\` to "disabled" (§22.13).`;
  }
  return `\`${cap.manifestPath}\` sets \`[capabilities] host-import = "self-host-only"\`, which admits only files under \`${SELF_HOST_PATH_PREFIX}**\` relative to \`${cap.projectRoot}\` (§22.13).`;
}

/**
 * Validate every `import:host` declaration in one parsed file.
 *
 * Placement: an `import:host` is at FILE TOP LEVEL iff it is a direct statement
 * of a logic node that is (a) a direct child of the file's root node list and
 * (b) `_synthetic` — i.e. the §40.8 lift of a bare file-top text run, which
 * both front-ends mark `_synthetic`. A user-written `${ }` block is a logic
 * context (§21.3.1: "inside a `${}` block ... SHALL be ... E-IMPORT-003"), and
 * a `<program>` / `<page>` / `<channel>` body is a nested scope.
 *
 * An `import:host` inside a function body is left to the existing
 * gauntlet-phase1 E-IMPORT-003 function-body check (which already catches
 * both the `import-decl` and the bare-expr shape), so it is not double-fired.
 *
 * @param {object} ast — FileAST
 * @param {string} filePath
 * @param {object} cap — from readHostImportCapability
 * @returns {object[]} diagnostics ({ code, message, span, severity })
 */
export function validateHostImports(ast, filePath, cap) {
  const errors = [];
  if (!ast || typeof ast !== "object") return errors;

  /** @type {Map<number, { node: object, fileTop: boolean }>} */
  const found = new Map();
  const misplacedBare = [];
  const seen = new WeakSet();

  const record = (node, fileTop) => {
    const key = hostImportSpanKey(node);
    const prev = key !== null ? found.get(key) : undefined;
    if (prev) {
      prev.fileTop = prev.fileTop || fileTop;
      (prev.twins || (prev.twins = [])).push(node);
      return;
    }
    found.set(key !== null ? key : -1 - found.size, { node, fileTop });
  };

  // Generic total walk: node containers differ between the two front-ends and
  // across node kinds (body / children / branches[].element / arms / ...), so
  // descend every object-valued field rather than an enumerated list.
  const walk = (value, insideFunction) => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const v of value) walk(v, insideFunction);
      return;
    }
    const kind = value.kind;
    if (kind === "import-decl" && typeof value.hostTag === "string") {
      if (!insideFunction) record(value, false);
      return;
    }
    if (
      !insideFunction &&
      kind === "bare-expr" &&
      typeof value.expr === "string" &&
      HOST_IMPORT_BARE_EXPR_RE.test(value.expr)
    ) {
      misplacedBare.push(value);
      return;
    }
    const nextInside = insideFunction || kind === "function-decl";
    for (const k of Object.keys(value)) {
      if (k === "span" || k === "parent") continue;
      walk(value[k], nextInside);
    }
  };

  // Root-level synthetic logic nodes: their DIRECT body statements are the only
  // file-top position.
  const rootNodes = Array.isArray(ast.nodes) ? ast.nodes : [];
  for (const n of rootNodes) {
    if (n && n.kind === "logic" && n._synthetic === true && Array.isArray(n.body)) {
      for (const stmt of n.body) {
        if (stmt && stmt.kind === "import-decl" && typeof stmt.hostTag === "string") {
          record(stmt, true);
        }
      }
    }
  }
  walk(rootNodes, false);
  // Hoisted import list (the native front-end synthesises separate objects for
  // it; the live one shares references). Anything here not already placed is
  // matched by span to its body twin.
  for (const imp of Array.isArray(ast.imports) ? ast.imports : []) {
    if (imp && imp.kind === "import-decl" && typeof imp.hostTag === "string") {
      const key = hostImportSpanKey(imp);
      const prev = key !== null ? found.get(key) : undefined;
      if (prev) {
        if (prev.node !== imp) (prev.twins || (prev.twins = [])).push(imp);
      } else {
        record(imp, false);
      }
    }
  }

  const reject = (entry) => {
    entry.node._hostImportRejected = true;
    for (const t of entry.twins || []) t._hostImportRejected = true;
  };

  const spanOf = (node) =>
    node && node.span ? { ...node.span, file: node.span.file || filePath } : { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  for (const b of misplacedBare) {
    errors.push({
      code: "E-IMPORT-003",
      message:
        "E-IMPORT-003: `import:host` appears inside a nested scope. `import:host` SHALL appear only at file top level, " +
        "outside any `${}` logic context (§21.3.1). Move it to the top of the file, before any markup.",
      span: spanOf(b),
      severity: "error",
    });
  }

  for (const entry of found.values()) {
    const node = entry.node;
    const tag = node.hostTag;
    const shown = `import:${tag}`;
    let rejected = false;

    if (!entry.fileTop) {
      rejected = true;
      errors.push({
        code: "E-IMPORT-003",
        message:
          `E-IMPORT-003: \`${shown}\` is not at file top level. \`import:host\` SHALL appear only at file top level, ` +
          "outside any `${}` logic context — not inside a `${}` block, a `<program>` / `<page>` / `<channel>` body, " +
          "or any nested scope (§21.3.1). Move it to the top of the file, before any markup.",
        span: spanOf(node),
        severity: "error",
      });
    }

    if (tag !== HOST_TAG) {
      rejected = true;
      errors.push({
        code: "E-IMPORT-009",
        message:
          `E-IMPORT-009: \`${shown}\` uses the host-tag \`${tag}\`. v1 recognises only \`host\` (the TypeScript / ` +
          "JavaScript named-export bridge, §21.3.1); other host languages are reserved for a future SPEC amendment.",
        span: spanOf(node),
        severity: "error",
      });
    } else if (typeof node.source === "string" && !(extensionOf(node.source) in HOST_MODULE_LOADERS)) {
      rejected = true;
      errors.push({
        code: "E-IMPORT-009",
        message:
          `E-IMPORT-009: \`import:host\` target \`${node.source}\` is not a TypeScript / JavaScript module. ` +
          "The v1 `host` tag binds named exports of a `.ts` / `.mts` / `.js` / `.mjs` module only (§21.3.1); " +
          "import scrml modules with a plain `import`.",
        span: spanOf(node),
        severity: "error",
      });
    }

    if (!isHostImportPermitted(filePath, cap)) {
      rejected = true;
      errors.push({
        code: "E-IMPORT-008",
        message:
          `E-IMPORT-008: \`${shown}\` is used in a file outside the project's \`[capabilities] host-import\` allow-list. ` +
          describeCapability(cap) +
          " Adopter code imports scrml modules with a plain `import`; `import:host` is the self-host bootstrap bridge (§21.3.1).",
        span: spanOf(node),
        severity: "error",
      });
    }

    if (rejected) reject(entry);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Host-module record (module resolver)
// ---------------------------------------------------------------------------

/**
 * A host module's re-export-all marker. `Bun.Transpiler.scan` lists the names
 * a module declares but not the names an `export * from "..."` forwards, so
 * the export list is incomplete when one is present and a missing name cannot
 * be reported without traversing into the host module's own imports (which
 * §21.3.1 forbids). Matched on the host module's TEXT because the scan result
 * carries no such marker.
 */
const EXPORT_STAR_RE = /(^|[;{}\s])export\s*\*/;

/**
 * Load a host module's named-export record WITHOUT evaluating it (§21.3.1:
 * "The compiler SHALL NOT inline or evaluate the host-language module's body
 * during scrml parse. The host module is loaded and named exports are
 * extracted at compile time only.").
 *
 * @param {string} absPath
 * @returns {{
 *   ok: boolean,
 *   exports: Set<string>|null,   // null when the list is not authoritative
 *   imports: string[],           // the module's own static import specifiers
 *   error: string|null,
 * }}
 */
export function scanHostModule(absPath) {
  let text;
  try {
    text = readFileSync(absPath, "utf8");
  } catch (e) {
    return { ok: false, exports: null, imports: [], error: e && e.message ? e.message : String(e) };
  }
  if (typeof Bun === "undefined" || typeof Bun.Transpiler !== "function") {
    return { ok: true, exports: null, imports: [], error: null };
  }
  const loader = HOST_MODULE_LOADERS[extensionOf(absPath)] || "js";
  let scanned;
  try {
    scanned = new Bun.Transpiler({ loader }).scan(text);
  } catch (e) {
    return { ok: true, exports: null, imports: [], error: e && e.message ? e.message : String(e) };
  }
  const exports = EXPORT_STAR_RE.test(text) ? null : new Set(scanned.exports || []);
  const imports = (scanned.imports || [])
    .map((i) => (i && typeof i.path === "string" ? i.path : null))
    .filter((p) => p !== null);
  return { ok: true, exports, imports, error: null };
}
