/**
 * @module codegen/cell-accessor-rename
 *
 * BUG-6 of chunk-namespacing: rewrite every cell-accessor CALL in an emitted
 * chunk body from the bare runtime name to the chunk-local `_scrml_cs_` wrapper
 * the prologue defines (`_scrml_reactive_get("rows")` → `_scrml_cs_reactive_get("rows")`).
 *
 * ## Why a rename, not the earlier key-argument rewrite
 *
 * The reverted N2 attempt namespaced the STORE KEY inside the string argument
 * (`"rows"` → `"<token>$rows"`). That works but rewrites ~1200 test assertions
 * that pin the bare key as the lowering contract. The ruled mechanism keeps the
 * key bare and instead renames the FUNCTION: the body calls a chunk-local
 * wrapper whose prologue applies the namespace via `_scrml_cs_key`. Only the
 * callee identifier moves; the `"rows"` argument stays byte-identical.
 *
 * ## Why a post-hoc pass, not per-emitter edits
 *
 * The accessor calls are minted at ~959 sites across 37 codegen modules. Editing
 * each is unfinishable — the next emitter anyone adds re-opens the hole silently,
 * and a half-renamed chunk calls a wrapper that is never defined (ReferenceError)
 * or leaves a call bound to the un-namespaced global (a scope leak). One pass over
 * the assembled body is exhaustive BY CONSTRUCTION, and its accessor set is the
 * SAME `CELL_SCOPE_ACCESSORS` the prologue wraps, so the two cannot drift.
 *
 * ## Why Acorn, not a regex
 *
 * A regex over generated JS cannot tell `_scrml_reactive_get("rows")` — the call
 * — from the same characters inside a doc comment or an author's string literal.
 * Both occur (the runtime documents accessors in comments; nothing stops an
 * author writing that text in a `<p>`). The pass PARSES the body and rewrites
 * only real identifier REFERENCES, by SPLICING the located ranges — never by
 * regenerating source (a round-trip would reflow every line and destroy the
 * comments that make generated JS readable).
 *
 * ## Ordering (load-bearing)
 *
 * This pass runs on the chunk BODY *before* the prologue is prepended. The
 * prologue's own wrappers reference the REAL accessors (`_scrml_cs_reactive_get =
 * (n, ...r) => _scrml_reactive_get(_scrml_cs_key(n), ...r)`); if the pass saw
 * those it would rename the impl and the wrapper would call itself. Because the
 * prologue is added afterwards, its references are never in scope of this pass.
 */

import * as acorn from "acorn";

/** The `_scrml_cs_` (cell-scope) prefix the renamed wrappers carry. */
export const CS_PREFIX = "_scrml_cs_";
const RUNTIME_PREFIX = "_scrml_";

type AnyNode = Record<string, unknown> & { type: string; start?: number; end?: number };

export interface AccessorRenameResult {
  /** The body with every cell-accessor reference renamed to its `_scrml_cs_` form. */
  code: string;
  /** The runtime accessor names actually renamed — the exact set the prologue must wrap. */
  used: Set<string>;
  /**
   * References renamed that were NOT a `CallExpression.callee` (an accessor
   * passed as a VALUE, not called). Zero on the whole corpus today; tracked so a
   * future emitter that passes an accessor as a callback is caught rather than
   * silently leaking the un-namespaced global.
   */
  valueReferences: number;
}

/**
 * Rename every cell-accessor reference in `body` to its `_scrml_cs_` form.
 *
 * @param body      the assembled chunk body (post-runtime-strip / post-embedded-
 *                  runtime, pre-prologue, pre-IIFE, pre-esm-transform).
 * @param accessors the runtime accessor names to rename — `CELL_SCOPE_ACCESSORS`.
 * @throws when `body` does not parse. This pass is ALWAYS-ON for a namespaced
 *   chunk, so a parse failure means the compiler emitted invalid JS — a defect to
 *   surface, never to silently skip (a skipped pass leaves calls bound to the
 *   un-namespaced global, a runtime clobber no test shape can see).
 */
export function renameCellAccessors(
  body: string,
  accessors: readonly string[],
): AccessorRenameResult {
  const used = new Set<string>();
  if (!body || !body.includes(RUNTIME_PREFIX)) {
    return { code: body, used, valueReferences: 0 };
  }

  const accessorSet = new Set(accessors);
  const ast = parseChunk(body);

  interface Hit {
    start: number;
    end: number;
    name: string;
  }
  const hits: Hit[] = [];
  let valueReferences = 0;

  walk(ast, null, null, (node, parent, key) => {
    if (node.type !== "Identifier") return;
    const name = node.name as string;
    if (!accessorSet.has(name)) return;
    if (isShieldedPosition(parent, key)) return;

    used.add(name);
    hits.push({ start: node.start as number, end: node.end as number, name });
    const isCallee = parent?.type === "CallExpression" && key === "callee";
    if (!isCallee) valueReferences++;
  });

  if (hits.length === 0) return { code: body, used, valueReferences: 0 };

  // Splice back-to-front so earlier ranges stay valid.
  hits.sort((a, b) => b.start - a.start);
  let out = body;
  for (const h of hits) {
    const renamed = CS_PREFIX + h.name.slice(RUNTIME_PREFIX.length);
    out = out.slice(0, h.start) + renamed + out.slice(h.end);
  }
  return { code: out, used, valueReferences };
}

/**
 * True when an Identifier sits in a NAME position rather than a REFERENCE —
 * a non-computed member property (`obj._scrml_reactive_get`), a non-computed
 * object-literal key (`{ _scrml_reactive_get: … }`), or a binding id / param.
 * None of these name the runtime accessor, so none may be renamed.
 *
 * Emitted chunk bodies never DECLARE an accessor, so the binding/param guards
 * are defensive; the member/key guards are the ones that matter.
 */
function isShieldedPosition(parent: AnyNode | null, key: string | null): boolean {
  if (!parent) return false;
  if (parent.type === "MemberExpression" && key === "property" && parent.computed !== true) return true;
  if (parent.type === "Property" && key === "key" && parent.computed !== true) return true;
  if (key === "id") return true; // VariableDeclarator / Function / Class binding id
  if (key === "params") return true; // a function parameter
  if (parent.type === "MethodDefinition" && key === "key" && parent.computed !== true) return true;
  return false;
}

/**
 * Parse an emitted chunk. Classic chunks are scripts; the pre-esm shape still
 * parses as a module (the strictly larger grammar for our purposes). Module
 * first, script fallback — matching the deleted N2 pass this resurrects.
 */
function parseChunk(js: string): AnyNode {
  try {
    return acorn.parse(js, {
      ecmaVersion: 2022,
      sourceType: "module",
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch {
    try {
      return acorn.parse(js, {
        ecmaVersion: 2022,
        sourceType: "script",
        allowReturnOutsideFunction: true,
      }) as unknown as AnyNode;
    } catch (e) {
      throw new Error(
        `[scrml cell-accessor-rename] failed to parse a client chunk body while ` +
          `renaming cell accessors: ${(e as Error).message}. The chunk drifted from a ` +
          `parseable shape — the always-on rename cannot proceed, and skipping it would ` +
          `leave calls bound to the un-namespaced global (a silent runtime clobber).`,
      );
    }
  }
}

/**
 * Depth-first walk carrying (parent, key). Generic — walk anything with a
 * `type` — rather than a per-node visitor: a hand-written visitor silently skips
 * node types it was never taught, and a skipped subtree here is an un-renamed
 * accessor call (the exact failure this pass exists to close).
 */
function walk(
  node: unknown,
  parent: AnyNode | null,
  key: string | null,
  visit: (n: AnyNode, parent: AnyNode | null, key: string | null) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent, key, visit);
    return;
  }
  const n = node as AnyNode;
  if (typeof n.type === "string") visit(n, parent, key);
  for (const k of Object.keys(n)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
    walk(n[k], n, k, visit);
  }
}
