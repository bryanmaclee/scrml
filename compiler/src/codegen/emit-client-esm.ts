/**
 * @module codegen/emit-client-esm
 *
 * ESM chunks arc — Unit 2. Transforms a per-file CLASSIC client chunk body
 * (post runtime-slice-strip, PRE the cross-file IIFE wrap) into a valid ES
 * module for `--module-format=esm`.
 *
 * Under the historical CLASSIC path a `.client.js` is a non-module `<script>`
 * that shares one global lexical scope with the runtime `<script>` and every
 * other page chunk. Cross-file `.scrml` linkage is hand-rolled through a global
 * `_scrml_modules` registry (see emit-client.ts `buildModuleRegistryFooter` +
 * the import-emit at the `// known-gaps-#6` site), and every runtime symbol
 * (`_scrml_reactive_get`, `_scrml_stdlib`, …) is referenced BARE, resolved from
 * the runtime `<script>`'s globals. Two chunks declaring the same top-level
 * `const Phase_toEnum` collide in that shared global scope (the
 * `g-nav-chunk-lexical-collision` gap).
 *
 * This module produces the ESM-shaped alternative — mirrors `runtime-esm.ts`
 * (Unit 1), applied ONLY on the esm path so `--module-format=classic` (the
 * default) stays byte-identical. Three transforms:
 *
 *   1. Registration footer → `export`. The exporter's
 *      `_scrml_modules["<key>"] = { publicName: emittedName, … };` becomes a
 *      native `export { emittedName as publicName, … };`.
 *
 *   2. Import header → `import`. Each importer's
 *      `const { a, b } = _scrml_modules["<key>"];` becomes a namespace import
 *      + local destructure:
 *          import * as __scrml_dep_0 from "<relative-url-to-dep.client.js>";
 *          const { a, b } = __scrml_dep_0;
 *      The NAMESPACE form (not `import { a, b }`) is load-bearing: an importer
 *      may name a binding the dependency does NOT export as a JS value — a
 *      cross-file COMPONENT or a type-only name (resolved at markup-mount time,
 *      never registered). Under classic that read yields `undefined` (harmless);
 *      a NAMED import of a non-exported binding is a hard MODULE LINK ERROR that
 *      kills the whole page. A namespace object returns `undefined` for a
 *      missing property, preserving the exact classic semantics. (See the
 *      BRIEF-PREMISE note in this arc's progress.md — the brief said
 *      `import { x }`; that would break every component import.)
 *
 *   3. Runtime `import`. Under classic the runtime symbols are global; under an
 *      ES-module runtime (Unit 1) they are EXPORTS, so the chunk must import the
 *      subset it references:
 *          (runtime-slice-exports ∩ chunk-referenced-idents) − chunk-own-decls
 *      Derived from the file's OWN assembled runtime slice — every name in the
 *      surface is a top-level decl of this file's slice, which is a subset of
 *      the standalone (union) runtime, so it is guaranteed exported there.
 *
 * Enum runtime reps (`const Phase_toEnum` / `_variants` / `Phase`) are left as
 * plain top-level `const` — under ESM they are module-LOCAL, so the cross-chunk
 * lexical collision dissolves for free (no IIFE, no rename).
 *
 * See `docs/changes/esm-chunks/BRIEF.md` for the arc scoping.
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// elsewhere (validate-emit.ts:28, runtime-esm.ts:51) for the same reason.
import * as acorn from "acorn";
import { relative } from "path";
import { deriveTopLevelExportNames, LIFT_TARGET_GLOBAL } from "./runtime-esm.ts";
import { stripPagesPrefix } from "./utils.ts";

/**
 * Runtime symbols that are SHARED MUTABLE GLOBALS — a client chunk WRITES them
 * (a bare `<name> = …`) and the runtime READS them. Under classic scripts the
 * bare binding is the runtime `<script>`'s global; under ESM an imported binding
 * is read-only, so the chunk cannot assign it. These are NOT imported — reads and
 * writes are routed through `globalThis.<name>`, and the esm runtime (runtime-esm.ts
 * R2) reads the same slot. Only `_scrml_lift_target` exists today (verified: an
 * Acorn assignment-target scan across the examples/website corpus finds exactly
 * this one). A NEW such global trips the fail-loud guard in `toEsmClientChunk`.
 */
const SHARED_MUTABLE_RUNTIME_GLOBALS = new Set<string>([LIFT_TARGET_GLOBAL]);

export interface EsmChunkContext {
  /**
   * This file's assembled (post-slice) CLASSIC runtime string. Its top-level
   * declaration names are the runtime-import universe: every name is guaranteed
   * exported by the standalone esm runtime (this slice ⊆ the union runtime).
   */
  runtimeSlice: string;
  /**
   * The runtime-filename placeholder token (`RUNTIME_FILENAME_PLACEHOLDER`).
   * The runtime import URL embeds it; the caller substitutes the final hashed
   * filename in the same post-pass that rewrites the `// Requires:` line and the
   * `<script src>` runtime tag, so the module import URL always matches.
   */
  runtimePlaceholder: string;
  /**
   * The importer's SOURCE-relative directory (POSIX or host sep, `"."` for a
   * root file), i.e. `dirname(relative(outputBaseDir, filePath))` — BEFORE the
   * `pages/` strip. Import URLs are resolved against the ACTUAL dist location, so
   * this module re-applies `stripPagesPrefix` (the same normalization the dist
   * WRITE path `api.js pathFor` uses) to both this dir AND each dependency key:
   * a page source `pages/dispatch/board.scrml` lands at `dispatch/board.client.js`,
   * and the registry key is un-stripped, so the URL must be computed between the
   * two STRIPPED locations to resolve on disk.
   */
  importerDistDir: string;
}

// A `_scrml_modules` registry key is JSON.stringify'd (double-quoted, escaped).
const KEY = `("(?:[^"\\\\]|\\\\.)*")`;

// Exporter footer:   _scrml_modules["<key>"] = { pub: emit, … };
const FOOTER_RE = new RegExp(`^_scrml_modules\\[${KEY}\\] = \\{([^}]*)\\};$`, "gm");
// Importer destructure:   const { a, b } = _scrml_modules["<key>"];
const IMPORT_DESTRUCTURE_RE = new RegExp(`^const \\{([^}]*)\\} = _scrml_modules\\[${KEY}\\];$`, "gm");
// Importer default:   const NAME = _scrml_modules["<key>"].default;
const IMPORT_DEFAULT_RE = new RegExp(`^const (\\S+) = _scrml_modules\\[${KEY}\\]\\.default;$`, "gm");

// The comment line emit-client prepends to the exporter footer.
const FOOTER_COMMENT = "// --- cross-file module registry footer (known-gaps-#6, §21.3) ---";
const FOOTER_COMMENT_ESM = "// --- cross-file module exports (esm-chunks, §21.3) ---";

interface ChunkAnalysis {
  /**
   * Every TOP-LEVEL declaration name. Only plain `function`/`class`/`const/let/var
   * X` identifiers — destructuring patterns (the `const { a } = …` import reads)
   * are excluded, so an imported name is never mistaken for a chunk-own decl.
   */
  topLevelDecls: Set<string>;
  /**
   * Every identifier that appears as an ASSIGNMENT or UPDATE target anywhere in
   * the body (`x = …`, `x += …`, `x++`). Used to detect a chunk WRITING a runtime
   * global — a hard error under ESM unless the global is globalThis-bridged.
   */
  assignedIdents: Set<string>;
}

/**
 * Parse a client chunk body as a MODULE (it may already carry passthrough
 * `import`/`export` for non-`.scrml` `.js` helpers) and collect its top-level
 * declaration names + every assignment/update target identifier.
 */
function analyzeChunk(body: string): ChunkAnalysis {
  let ast: any;
  try {
    ast = acorn.parse(body, { ecmaVersion: 2022 as const, sourceType: "module" as const });
  } catch (e) {
    throw new Error(
      `[scrml emit-client-esm] failed to parse a client chunk as an ES module while ` +
        `computing its runtime-import surface: ${(e as Error).message}. The classic ` +
        `chunk body drifted from a parseable shape — the esm transform cannot proceed.`,
    );
  }
  const topLevelDecls = new Set<string>();
  for (const node of ast.body) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      topLevelDecls.add(node.id.name);
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (decl.id && decl.id.type === "Identifier") topLevelDecls.add(decl.id.name);
      }
    }
  }

  const assignedIdents = new Set<string>();
  const visit = (node: any): void => {
    if (!node || typeof node.type !== "string") return;
    // Every write FORM that binds a BARE identifier target — the guard must see
    // all of them so a future codegen change writing an unbridged runtime global
    // (via ANY of these) is caught at compile time, not shipped as a dead chunk:
    //   x = …   ({ x } = …)   [ x ] = …   x += …   x++   for (x of/in …)
    // `collectAssignmentTargets` walks the destructuring PATTERN recursively;
    // MemberExpression targets (`o.x = …`) bind no bare identifier and are
    // skipped (they never trip the read-only-import hazard).
    if (node.type === "AssignmentExpression") {
      collectAssignmentTargets(node.left, assignedIdents);
    } else if (node.type === "UpdateExpression") {
      collectAssignmentTargets(node.argument, assignedIdents);
    } else if (
      (node.type === "ForOfStatement" || node.type === "ForInStatement") &&
      node.left &&
      node.left.type !== "VariableDeclaration" // `for (const x of …)` = a new local, not a write
    ) {
      collectAssignmentTargets(node.left, assignedIdents);
    }
    for (const key in node) {
      if (key === "type") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === "string") visit(c);
      } else if (child && typeof child.type === "string") {
        visit(child);
      }
    }
  };
  visit(ast);
  return { topLevelDecls, assignedIdents };
}

/**
 * Collect every BARE identifier that an assignment/binding target writes,
 * recursing through destructuring patterns. Used by the assignment-target scan
 * so object/array-destructure and for-of/for-in write forms are covered, not
 * just the plain `x = …` case. MemberExpression / computed targets bind no bare
 * identifier (they write a property) and contribute nothing.
 */
function collectAssignmentTargets(node: any, out: Set<string>): void {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    case "Identifier":
      out.add(node.name);
      break;
    case "ObjectPattern":
      for (const prop of node.properties) {
        if (prop.type === "RestElement") collectAssignmentTargets(prop.argument, out);
        else if (prop.type === "Property") collectAssignmentTargets(prop.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) if (el) collectAssignmentTargets(el, out);
      break;
    case "AssignmentPattern": // a default, e.g. `{ x = 1 }` — the target is `.left`
      collectAssignmentTargets(node.left, out);
      break;
    case "RestElement":
      collectAssignmentTargets(node.argument, out);
      break;
    // MemberExpression and anything else: not a bare binding → ignore.
  }
}

/**
 * Rewrite an exporter footer `{ pub: emit, … }` pair-string into an
 * `export { emit as pub, … }` specifier list. `emit` is the (possibly-mangled)
 * final JS binding — a real top-level declaration in this chunk — and `pub` is
 * the source-level public name the importer reads. When they coincide, the
 * `as` alias is dropped for readability.
 */
function footerPairsToExportSpecifiers(pairs: string): string {
  const specs: string[] = [];
  for (const raw of pairs.split(",")) {
    const pair = raw.trim();
    if (pair === "") continue;
    const colon = pair.indexOf(":");
    if (colon === -1) {
      // Shorthand `{ name }` (pub === emit) — should not occur (emit-client
      // always writes `pub: emit`) but handle defensively.
      specs.push(pair);
      continue;
    }
    const pub = pair.slice(0, colon).trim();
    const emit = pair.slice(colon + 1).trim();
    specs.push(pub === emit ? pub : `${emit} as ${pub}`);
  }
  return specs.join(", ");
}

/**
 * Transform a classic client chunk body into a valid ES module. `body` is the
 * post-runtime-strip, pre-IIFE chunk (its first line is the `// Requires: …`
 * comment). Idempotent-unsafe: call once per compile on the esm path only.
 */
export function toEsmClientChunk(body: string, ctx: EsmChunkContext): string {
  const runtimeExports = new Set(deriveTopLevelExportNames(ctx.runtimeSlice));
  const { topLevelDecls: chunkOwnDecls, assignedIdents } = analyzeChunk(body);

  // A chunk that ASSIGNS a runtime export cannot import it (ES import bindings are
  // read-only). The only legitimate such symbol is a globalThis-bridged shared
  // mutable global (see SHARED_MUTABLE_RUNTIME_GLOBALS + runtime-esm.ts R2). Any
  // OTHER assigned-to runtime export is a new shared-mutable-global that has no
  // bridge yet — fail loud rather than emit a chunk that throws at module eval.
  const assignedRuntimeGlobals = [...assignedIdents].filter((n) => runtimeExports.has(n));
  const unbridged = assignedRuntimeGlobals.filter((n) => !SHARED_MUTABLE_RUNTIME_GLOBALS.has(n));
  if (unbridged.length > 0) {
    throw new Error(
      `[scrml emit-client-esm] client chunk assigns runtime global(s) ` +
        `${unbridged.join(", ")} — an imported ES binding is read-only, so this ` +
        `would throw at module eval. Add a globalThis bridge in codegen/runtime-esm.ts ` +
        `(mirror the R2 _scrml_lift_target pattern) and register the name in ` +
        `SHARED_MUTABLE_RUNTIME_GLOBALS.`,
    );
  }
  // Bridged globals actually present in this chunk → routed through globalThis,
  // never imported.
  const bridgedInChunk = [...SHARED_MUTABLE_RUNTIME_GLOBALS].filter((n) => runtimeExports.has(n));

  // Resolve a registry key (a dist-relative `.client.js` path) to an ES import
  // specifier relative to THIS chunk's ACTUAL dist directory. Both sides are
  // `pages/`-stripped (matching the dist WRITE path) so the URL resolves on
  // disk, and the `./` prefix a relative ES specifier requires is added (a bare
  // `dep.client.js` would be a BARE specifier and fail to resolve in a browser).
  const fromDir = stripPagesPrefix(ctx.importerDistDir || ".");
  const resolveUrl = (registryKey: string): string => {
    const toPath = stripPagesPrefix(registryKey);
    const rel = relative(fromDir, toPath).split(/[\\/]/).join("/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };

  // --- Pass 1: collect the distinct dependency keys, first-appearance order,
  // and assign one deterministic namespace alias per key (deduped so two reads
  // of the same dependency share a single `import * as`). ---
  const keyToAlias = new Map<string, string>();
  const registerKey = (jsonKey: string): void => {
    const key = JSON.parse(jsonKey) as string;
    if (!keyToAlias.has(key)) keyToAlias.set(key, `__scrml_dep_${keyToAlias.size}`);
  };
  for (const m of body.matchAll(IMPORT_DESTRUCTURE_RE)) registerKey(m[2]);
  for (const m of body.matchAll(IMPORT_DEFAULT_RE)) registerKey(m[2]);

  // --- Pass 2: rewrite footer + import reads in place. ---
  let out = body;

  // Exporter footer → `export { … };` (+ retitle its comment line).
  out = out.replace(FOOTER_COMMENT, FOOTER_COMMENT_ESM);
  out = out.replace(FOOTER_RE, (_full, _key, pairs) => {
    const specs = footerPairsToExportSpecifiers(pairs);
    return `export {${specs === "" ? "" : ` ${specs} `}};`;
  });

  // Importer destructure → local destructure off the namespace alias.
  out = out.replace(IMPORT_DESTRUCTURE_RE, (_full, names, jsonKey) => {
    const alias = keyToAlias.get(JSON.parse(jsonKey) as string)!;
    return `const {${names}} = ${alias};`;
  });
  // Importer default → `.default` off the namespace alias.
  out = out.replace(IMPORT_DEFAULT_RE, (_full, name, jsonKey) => {
    const alias = keyToAlias.get(JSON.parse(jsonKey) as string)!;
    return `const ${name} = ${alias}.default;`;
  });

  // Shared-mutable-global routing: rewrite every bare occurrence of a bridged
  // global (a chunk WRITES it; ES imports are read-only) to `globalThis.<name>`,
  // the slot the esm runtime (R2) reads. The negative lookbehind skips member
  // accesses (`x._scrml_lift_target`) and longer identifiers.
  for (const name of bridgedInChunk) {
    out = out.replace(new RegExp(`(?<![.$\\w])${name}\\b`, "g"), `globalThis.${name}`);
  }

  // --- Pass 3: compute the runtime-import surface from the REWRITTEN body (so
  // the now-removed `_scrml_modules` reference is not itself imported), then
  // build the import header. Identifier over-approximation (tokens inside
  // strings/comments) is harmless — an unused import is valid ES; the real
  // hazards — a runtime name shadowed by a chunk-own decl, or a globalThis-routed
  // shared mutable global — are excluded. ---
  const referenced = new Set(out.match(/[$A-Za-z_][$\w]*/g) ?? []);
  const runtimeSurface = [...runtimeExports]
    .filter((n) => referenced.has(n) && !chunkOwnDecls.has(n) && !SHARED_MUTABLE_RUNTIME_GLOBALS.has(n))
    .sort();

  const header: string[] = [];
  if (runtimeSurface.length > 0 || keyToAlias.size > 0) {
    header.push("// --- runtime + cross-file imports (esm-chunks) ---");
  }
  if (runtimeSurface.length > 0) {
    header.push(`import { ${runtimeSurface.join(", ")} } from "${resolveUrl(ctx.runtimePlaceholder)}";`);
  }
  for (const [key, alias] of keyToAlias) {
    header.push(`import * as ${alias} from "${resolveUrl(key)}";`);
  }

  if (header.length === 0) return out;

  // Insert the header right after the `// Requires: …` comment line (the first
  // surviving line of the stripped body). ES imports are hoisted, so position
  // is immaterial to execution — this placement is purely for readability.
  const nl = out.indexOf("\n");
  if (out.startsWith("// Requires: ") && nl !== -1) {
    return out.slice(0, nl + 1) + header.join("\n") + "\n" + out.slice(nl + 1);
  }
  return header.join("\n") + "\n" + out;
}
