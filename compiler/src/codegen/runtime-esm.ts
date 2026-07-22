/**
 * @module codegen/runtime-esm
 *
 * ESM chunks arc — Unit 1. Transforms the assembled (post-slice) CLASSIC runtime
 * string into a valid ES module for `--module-format=esm`.
 *
 * The scrml compiler historically emits the client runtime as a classic
 * `<script src>` that shares one global scope with each page chunk. This module
 * produces the ESM-shaped alternative: the runtime becomes a real ES module that
 * `export`s every symbol a client chunk could reference, so chunks compiled under
 * the esm flag can `import { … } from "./scrml-runtime.<hash>.js"` (chunk-side
 * import emit lands in Unit 2).
 *
 * Three transforms, applied ONLY on the esm path — the classic runtime string is
 * never touched, so `--module-format=classic` (the default) stays byte-identical:
 *
 *   1. R1 — meta-block `^{}` dependency-tracking interception (bounded rework).
 *      Under classic scripts a top-level `function _scrml_reactive_get` IS the
 *      same binding as `globalThis._scrml_reactive_get`, so `_scrml_meta_effect`
 *      can intercept every compiled `@var` read by swapping the global property.
 *      Under ESM the module binding and the global property DIVERGE — a chunk's
 *      `import`ed `_scrml_reactive_get` never sees the swap. We route interception
 *      through a distinct, module-visible override slot
 *      (`globalThis.__scrml_reactive_get_override`) that the exported
 *      `_scrml_reactive_get` consults first; `_scrml_meta_effect` sets/restores
 *      that slot (nested-safe) instead of the reactive-get property itself.
 *      Blast radius = exactly `^{}` dep-tracking; normal reactive reads are
 *      unaffected.
 *
 *   2. Redeclare-guard simplification. A module initialises once, in dependency
 *      order, so the classic-script `(typeof _X !== "undefined") ? _X : {}`
 *      double-load self-guards are dead noise under a module. They are harmless
 *      if left (verified: the guarded body parses + imports as a module), but the
 *      readable-output mandate says a module should not carry confusing
 *      self-referential guards. Simplified to the plain initialiser.
 *
 *   3. Export surface. A single trailing `export { … }` block naming every
 *      top-level declaration in the (post-transform, post-slice) runtime. Derived
 *      mechanically via Acorn from the actual declarations — NOT a curated list —
 *      so a future runtime symbol is exported automatically. Deriving from the
 *      SLICED runtime means a tree-shaken-out symbol is never exported (exporting
 *      a shaken-out name would be a link error). Over-exporting an unused symbol
 *      is harmless in ESM; under-exporting is a link error, so the full top-level
 *      set is the safe superset.
 *
 * See `docs/changes/esm-chunks/BRIEF.md` for the arc scoping.
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// elsewhere (validate-emit.ts:28, expression-parser.ts:16) for the same reason.
import * as acorn from "acorn";

/**
 * The module-visible override slot name (R1). Kept in one place so the runtime
 * body transform and any future chunk-side emit reference the same identifier.
 */
export const REACTIVE_GET_OVERRIDE_SLOT = "__scrml_reactive_get_override";

/**
 * The shared lift-target global (R2, esm-chunks Unit 2). `_scrml_lift_target` is
 * a mutable module global that client chunks SET (a bare `_scrml_lift_target =
 * <el>`, emit-reactive-wiring.ts) before calling `_scrml_lift`, which reads it.
 * Under classic scripts the bare binding IS `globalThis._scrml_lift_target`; under
 * ESM a chunk cannot assign this module's binding, so the chunk transform
 * (emit-client-esm.ts) routes its writes through `globalThis._scrml_lift_target`
 * and the runtime read consults the same slot. Kept here so both sides name the
 * identical property. Same-named-on-globalThis (not a `__`-prefixed slot) because
 * it reads as what it is; classic `let _scrml_lift_target` never lands on
 * globalThis, so there is no cross-mode collision.
 */
export const LIFT_TARGET_GLOBAL = "_scrml_lift_target";

// ---------------------------------------------------------------------------
// Anchored string replacement helper.
//
// Each transform below targets a verbatim runtime substring. If the anchor is
// missing (a runtime edit drifted the text) the replacement would silently
// no-op and ship a broken esm module — so every replacement asserts an exact
// occurrence count and throws loudly on drift. `min`/`max` bound the count:
// core-chunk anchors are exactly-once; chunk-gated anchors (meta / registry
// guards) are at-most-once because their chunk may be tree-shaken out of the
// sliced runtime.
// ---------------------------------------------------------------------------

function replaceAnchored(
  src: string,
  find: string,
  repl: string,
  label: string,
  min: number,
  max: number,
): { result: string; count: number } {
  const count = src.split(find).length - 1;
  if (count < min || count > max) {
    throw new Error(
      `[scrml runtime-esm] anchor "${label}" matched ${count} time(s), expected ` +
        `${min === max ? `${min}` : `${min}..${max}`}. The runtime template drifted ` +
        `from the esm transform — update codegen/runtime-esm.ts to match ` +
        `compiler/src/runtime-template.js.`,
    );
  }
  return { result: count === 0 ? src : src.split(find).join(repl), count };
}

// ---------------------------------------------------------------------------
// R1 — meta-block dep-tracking interception via a module-visible override slot.
// ---------------------------------------------------------------------------

const R1_GET_HEADER_FIND =
  `function _scrml_reactive_get(name) {\n  if (__SCRML_PERF) {`;
const R1_GET_HEADER_REPL =
  `function _scrml_reactive_get(name) {\n` +
  `  // R1 (esm-chunks) — meta-block ^{} dep-tracking interception. Under ESM the\n` +
  `  // module binding diverges from globalThis._scrml_reactive_get, so\n` +
  `  // _scrml_meta_effect installs its tracking read here instead. No-op unless a\n` +
  `  // ^{} effect is running (normal reactive reads take the path below).\n` +
  `  if (typeof globalThis !== "undefined" && globalThis.${REACTIVE_GET_OVERRIDE_SLOT}) {\n` +
  `    return globalThis.${REACTIVE_GET_OVERRIDE_SLOT}(name);\n` +
  `  }\n` +
  `  if (__SCRML_PERF) {`;

const R1_META_SET_FIND =
  `    const savedGet = (typeof globalThis !== "undefined" && globalThis._scrml_reactive_get)\n` +
  `      ? globalThis._scrml_reactive_get\n` +
  `      : null;\n` +
  `    if (typeof globalThis !== "undefined") {\n` +
  `      globalThis._scrml_reactive_get = trackingGet;\n` +
  `    }`;
const R1_META_SET_REPL =
  `    // R1 (esm-chunks) — install the tracking read on the module-visible override\n` +
  `    // slot (saving any outer effect's slot for nested-effect restore).\n` +
  `    const savedGet = (typeof globalThis !== "undefined")\n` +
  `      ? globalThis.${REACTIVE_GET_OVERRIDE_SLOT}\n` +
  `      : undefined;\n` +
  `    if (typeof globalThis !== "undefined") {\n` +
  `      globalThis.${REACTIVE_GET_OVERRIDE_SLOT} = trackingGet;\n` +
  `    }`;

const R1_META_FINALLY_FIND =
  `      // Restore the original get function\n` +
  `      if (typeof globalThis !== "undefined") {\n` +
  `        if (savedGet !== null) {\n` +
  `          globalThis._scrml_reactive_get = savedGet;\n` +
  `        } else {\n` +
  `          // savedGet was null, meaning _scrml_reactive_get wasn't on globalThis before.\n` +
  `          // Leave the tracking version since _scrml_reactive_get is defined at module level\n` +
  `          // (not on globalThis) in most environments. The tracking version still returns\n` +
  `          // correct values since it reads _scrml_state directly.\n` +
  `        }\n` +
  `      }`;
const R1_META_FINALLY_REPL =
  `      // R1 (esm-chunks) — restore the override slot to the outer effect's value\n` +
  `      // (undefined when this was the outermost effect).\n` +
  `      if (typeof globalThis !== "undefined") {\n` +
  `        globalThis.${REACTIVE_GET_OVERRIDE_SLOT} = savedGet;\n` +
  `      }`;

function applyR1(src: string): string {
  // reactive_get lives in the always-included `core` chunk → exactly once.
  const a = replaceAnchored(src, R1_GET_HEADER_FIND, R1_GET_HEADER_REPL, "R1 reactive_get header", 1, 1);
  // _scrml_meta_effect lives in the tree-shakeable `meta` chunk → at-most-once.
  const b = replaceAnchored(a.result, R1_META_SET_FIND, R1_META_SET_REPL, "R1 meta savedGet block", 0, 1);
  const c = replaceAnchored(b.result, R1_META_FINALLY_FIND, R1_META_FINALLY_REPL, "R1 meta finally block", 0, 1);
  // The set + finally halves are one logical unit — either both present (meta
  // chunk in the slice) or both absent. A mismatch means the runtime drifted.
  if (b.count !== c.count) {
    throw new Error(
      `[scrml runtime-esm] R1 meta anchors inconsistent (set=${b.count}, finally=${c.count}). ` +
        `The _scrml_meta_effect body drifted from the esm transform.`,
    );
  }
  return c.result;
}

// ---------------------------------------------------------------------------
// R2 — shared lift-target bridge (esm-chunks Unit 2). The `_scrml_lift`
// container read consults `globalThis._scrml_lift_target` first (the slot the
// esm chunk transform writes) before the module-local `let _scrml_lift_target`
// (the classic fallback, always null under ESM). Chunk-gated (`lift` chunk) →
// at-most-once. Both anchors live in the same chunk so their presence is joint.
// ---------------------------------------------------------------------------

const R2_LIFT_TARGET_FIND =
  `  const container = _scrml_lift_target || document.querySelector("[data-scrml-lift-target]") || document.body;`;
const R2_LIFT_TARGET_REPL =
  `  // R2 (esm-chunks) — under ESM a client chunk cannot assign this module's\n` +
  `  // \`_scrml_lift_target\` binding, so it writes globalThis.${LIFT_TARGET_GLOBAL}\n` +
  `  // instead; read that slot first, then fall back to the classic module-local.\n` +
  `  const container = (typeof globalThis !== "undefined" && globalThis.${LIFT_TARGET_GLOBAL})\n` +
  `    || _scrml_lift_target || document.querySelector("[data-scrml-lift-target]") || document.body;`;

function applyR2(src: string): string {
  // `_scrml_lift` lives in the tree-shakeable `lift` chunk → at-most-once.
  return replaceAnchored(src, R2_LIFT_TARGET_FIND, R2_LIFT_TARGET_REPL, "R2 lift-target container read", 0, 1).result;
}

// ---------------------------------------------------------------------------
// Redeclare-guard simplification (chunk-gated → at-most-once each).
// ---------------------------------------------------------------------------

const GUARD_REPLACEMENTS: Array<{ find: string; repl: string; label: string }> = [
  {
    label: "_scrml_modules redeclare guard",
    find:
      `var _scrml_modules = (typeof _scrml_modules !== "undefined")\n` +
      `  ? _scrml_modules\n` +
      `  : {};`,
    repl: `var _scrml_modules = {};`,
  },
  {
    label: "_SCRML_CHUNKS redeclare guard",
    find:
      `var _SCRML_CHUNKS = (typeof _SCRML_CHUNKS !== "undefined")\n` +
      `  ? _SCRML_CHUNKS\n` +
      `  : Object.create(null);`,
    repl: `var _SCRML_CHUNKS = Object.create(null);`,
  },
  {
    label: "_SCRML_MOUNTS redeclare guard",
    find:
      `var _SCRML_MOUNTS = (typeof _SCRML_MOUNTS !== "undefined")\n` +
      `  ? _SCRML_MOUNTS\n` +
      `  : Object.create(null);`,
    repl: `var _SCRML_MOUNTS = Object.create(null);`,
  },
  {
    label: "_SCRML_VENDOR_REFS redeclare guard",
    find:
      `var _SCRML_VENDOR_REFS = (typeof _SCRML_VENDOR_REFS !== "undefined")\n` +
      `  ? _SCRML_VENDOR_REFS\n` +
      `  : Object.create(null);`,
    repl: `var _SCRML_VENDOR_REFS = Object.create(null);`,
  },
];

function simplifyRedeclareGuards(src: string): string {
  let out = src;
  for (const g of GUARD_REPLACEMENTS) {
    out = replaceAnchored(out, g.find, g.repl, g.label, 0, 1).result;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export-surface derivation.
// ---------------------------------------------------------------------------

/**
 * Collect the names of every TOP-LEVEL declaration in a runtime string.
 *
 * Parses as a script (the body has no `import`/`export` yet) and walks only the
 * program body — declarations nested inside functions / IIFEs (e.g. the
 * transitions injector, the stdlib shims) are correctly excluded. Names are
 * de-duplicated (a top-level `var` may legally appear twice across chunks).
 */
export function deriveTopLevelExportNames(runtime: string): string[] {
  const ast = acorn.parse(runtime, { ecmaVersion: 2022 as const, sourceType: "script" as const }) as any;
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };
  for (const node of ast.body) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      add(node.id.name);
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        // Only plain `const/let/var X = …` identifiers. Destructuring patterns
        // do not appear at the runtime's top level, but ignore them defensively
        // rather than emit an un-exportable name.
        if (decl.id && decl.id.type === "Identifier") add(decl.id.name);
      }
    }
  }
  return names;
}

function buildExportBlock(names: string[]): string {
  const body = names.map((n) => `  ${n},`).join("\n");
  return (
    `\n\n` +
    `// --- ESM export surface (esm-chunks Unit 1) ---\n` +
    `// Every top-level runtime declaration is exported so client chunks compiled under\n` +
    `// --module-format=esm can \`import { … } from "./<runtime>.js"\`. Derived mechanically\n` +
    `// from the assembled (sliced) runtime's top-level declarations — a new runtime symbol\n` +
    `// is exported automatically, and a tree-shaken-out symbol is never exported.\n` +
    `export {\n${body}\n};\n`
  );
}

// ---------------------------------------------------------------------------
// toEsmRuntime — the public entry point.
// ---------------------------------------------------------------------------

/**
 * Transform an assembled (post-slice) classic runtime string into a valid ES
 * module: R1 meta-block rework + redeclare-guard simplification + a derived
 * `export { … }` block. Idempotent-safe to call once per compile on the esm
 * path; MUST NOT be called on the classic path (it changes bytes).
 */
export function toEsmRuntime(assembledRuntime: string): string {
  let body = applyR1(assembledRuntime);
  body = applyR2(body);
  body = simplifyRedeclareGuards(body);
  const names = deriveTopLevelExportNames(body);
  return body + buildExportBlock(names);
}
