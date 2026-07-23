/**
 * @module codegen/cell-namespace-pass
 *
 * N2 of chunk-namespacing: rewrite every reactive-cell STORE KEY in an emitted
 * chunk to carry the unit's namespace token (`"rows"` → `"a1b2c3d4$rows"`).
 *
 * ## Why a post-pass rather than ~190 emission sites
 *
 * The cell key is minted at 189 lines across 23 codegen modules, in a dozen
 * different string-building shapes. Editing each one is not merely large — it
 * is *unfinishable*: the next emitter anyone adds re-opens the hole silently,
 * and a half-namespaced store is worse than none (half the writes land in one
 * slot, half in another). A single pass over the assembled chunk is exhaustive
 * BY CONSTRUCTION: every cell-store call, whoever emitted it, is rewritten.
 *
 * ## Why Acorn rather than a regex
 *
 * A regex over generated JS cannot tell `_scrml_reactive_get("rows")` — the
 * call — from the same characters sitting inside a doc comment or an author's
 * string literal. Both occur: the runtime template documents the accessor in
 * comments, and nothing stops an author writing that text in a `<p>`. So the
 * pass PARSES the chunk and rewrites only real `CallExpression` /
 * `MemberExpression` / `Property` nodes.
 *
 * Rewriting is done by SPLICING the original text at the located ranges — never
 * by regenerating source from the AST. Generated JS is meant to be read; a
 * round-trip through a code generator would reflow every line and destroy the
 * comments that make it readable.
 *
 * ## Author-facing names are NOT touched
 *
 * Only the STORE KEY is namespaced. Diagnostic labels (`_scrml_error_boundary_log`),
 * validator names and devtools captions keep the bare author name — see
 * `stripCellNamespace` for the inverse when a namespaced key must be shown.
 */

import * as acorn from "acorn";
import { nsCell } from "./chunk-namespace.ts";

/**
 * Runtime entry points whose FIRST argument is a reactive-cell store key.
 *
 * Derived from the runtime's own signatures (`compiler/src/runtime-template.js`)
 * and cross-checked against a corpus scan of emitted chunks — every callee that
 * actually receives a declared cell name as a string literal appears here.
 */
const CELL_KEY_FIRST_ARG = new Set([
  // core store
  "_scrml_reactive_get",
  "_scrml_reactive_set",
  "_scrml_init_set",
  "_scrml_init_get",
  "_scrml_default_set",
  "_scrml_reset",
  "_scrml_propagate_dirty",
  "_scrml_reactive_subscribe",
  "_scrml_reactive_subscribe_when",
  "_scrml_notify_value_indexed",
  "_scrml_reactive_derived",
  "_scrml_reactive_debounced",
  "_scrml_reactive_throttled",
  "_scrml_reactivity_register",
  "_scrml_reactivity_cancel",
  // derived values (§6.6)
  "_scrml_derived_declare",
  "_scrml_derived_get",
  // SSR seed interrogation (§52.8)
  "_scrml_ssr_seeded",
  // §51.14 replay
  "_scrml_replay",
  // §55 inline message registration is keyed by the cell it validates
  "_scrml_messages_register_inline",
  // state machines / engines — `varName` IS the engine's cell
  "_scrml_machine_clear_timer",
  "_scrml_machine_arm_timer",
  "_scrml_machine_arm_initial",
  "_scrml_engine_advance",
  "_scrml_engine_direct_set",
  "_scrml_engine_hydrate_init",
  "_scrml_engine_dispatch_message",
  "_scrml_engine_history_capture_on_exit",
  "_scrml_engine_arm_state_timers",
  "_scrml_engine_clear_state_timers",
  "_scrml_engine_clear_named_timer",
  "_scrml_engine_arm_idle_watchdog",
  "_scrml_engine_reset_idle_watchdog",
]);

/**
 * `_scrml_derived_subscribe(derived, upstream)` — BOTH arguments are cell keys
 * (the dirty-propagation edge runs between two of them), so it gets its own
 * entry rather than riding the first-arg set.
 */
const CELL_KEY_FIRST_TWO_ARGS = new Set(["_scrml_derived_subscribe"]);

/**
 * Objects whose COMPUTED string index is a cell key. The SSR compose handler
 * builds `_scrml_ssr_state["rows"]`, and the client's `_scrml_ssr_seed_apply`
 * feeds those keys straight into `_scrml_reactive_set` — so the seed side must
 * carry the same namespace the client side reads.
 */
const CELL_KEYED_OBJECTS = new Set(["_scrml_ssr_state"]);

/**
 * Variables whose object-literal initializer has cell keys for property names.
 * `_scrml_shell_cells` is the compile-time set the soft-nav rehydrate consults
 * to decide which seeded cells to leave alone.
 */
const CELL_KEYED_OBJECT_LITERALS = new Set(["_scrml_shell_cells"]);

/** A located string literal to rewrite, plus its source range. */
interface Splice {
  start: number;
  end: number;
  raw: string;
}

/**
 * Rewrite every reactive-cell store key in `js` to its namespaced form, using
 * the namespace state currently installed by `chunk-namespace.ts`.
 *
 * Returns `js` unchanged when no namespace is active (synthetic unit-test
 * emission) or when nothing needed rewriting.
 *
 * @throws when `js` does not parse. That is deliberate: this pass is ALWAYS-ON,
 * so a parse failure means the compiler emitted invalid JS — a defect to
 * surface, never to silently skip (a skipped pass leaves a half-namespaced
 * store, which fails at runtime in a way no test shape can see).
 */
export function namespaceCellKeys(js: string): string {
  if (!js) return js;
  // Cheap bail: nothing to do if the chunk touches no cell-store entry point.
  if (!js.includes("_scrml_")) return js;

  const ast = parseChunk(js);
  const splices: Splice[] = [];

  walk(ast, (node: AnyNode) => {
    if (node.type === "CallExpression") {
      const callee = node.callee as AnyNode;
      if (callee?.type !== "Identifier") return;
      const name = callee.name as string;
      const args = (node.arguments ?? []) as AnyNode[];
      if (CELL_KEY_FIRST_ARG.has(name)) {
        pushIfStringLiteral(splices, args[0]);
      } else if (CELL_KEY_FIRST_TWO_ARGS.has(name)) {
        pushIfStringLiteral(splices, args[0]);
        pushIfStringLiteral(splices, args[1]);
      }
      return;
    }
    if (node.type === "MemberExpression" && node.computed) {
      const obj = node.object as AnyNode;
      if (obj?.type === "Identifier" && CELL_KEYED_OBJECTS.has(obj.name as string)) {
        pushIfStringLiteral(splices, node.property as AnyNode);
      }
      return;
    }
    if (node.type === "VariableDeclarator") {
      const id = node.id as AnyNode;
      const init = node.init as AnyNode;
      if (
        id?.type === "Identifier" &&
        CELL_KEYED_OBJECT_LITERALS.has(id.name as string) &&
        init?.type === "ObjectExpression"
      ) {
        for (const prop of (init.properties ?? []) as AnyNode[]) {
          if (prop.type === "Property" && !prop.computed) pushIfStringLiteral(splices, prop.key as AnyNode);
        }
      }
    }
  });

  if (splices.length === 0) return js;

  // Splice back-to-front so earlier ranges stay valid.
  splices.sort((a, b) => b.start - a.start);
  let out = js;
  for (const s of splices) {
    const namespaced = nsCell(s.raw);
    if (namespaced === s.raw) continue; // no active namespace — leave the bytes alone
    out = out.slice(0, s.start) + JSON.stringify(namespaced) + out.slice(s.end);
  }
  return out;
}

/** Record `node` for rewriting when it is a plain string literal. */
function pushIfStringLiteral(splices: Splice[], node: AnyNode | undefined): void {
  if (!node || node.type !== "Literal" || typeof node.value !== "string") return;
  // Idempotence guard — an already-namespaced key (`a1b2c3d4$rows`) must never
  // be namespaced twice. Tokens are exactly 8 lowercase base36 chars.
  if (/^[0-9a-z]{8}\$/.test(node.value)) return;
  splices.push({ start: node.start as number, end: node.end as number, raw: node.value });
}

/**
 * Parse an emitted chunk. Classic chunks are scripts; the `--module-format=esm`
 * shape and the server bundle are modules. Try module first (it is the strictly
 * larger grammar for our purposes), fall back to script for the classic chunks
 * whose top-level `return`/`with`-free body still parses either way.
 */
function parseChunk(js: string): AnyNode {
  try {
    return acorn.parse(js, { ecmaVersion: 2022, sourceType: "module", allowReturnOutsideFunction: true }) as unknown as AnyNode;
  } catch {
    return acorn.parse(js, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true }) as unknown as AnyNode;
  }
}

/** Minimal structural node shape — the pass reads generic ESTree fields. */
type AnyNode = Record<string, unknown> & { type: string; start?: number; end?: number };

/**
 * Depth-first walk over every ESTree node. Deliberately generic (walk anything
 * with a `type`) rather than a per-node-type visitor: a hand-written visitor
 * silently skips node types it was never taught, and a skipped subtree here is
 * an un-namespaced cell key — the exact failure mode this pass exists to close.
 */
function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as AnyNode;
  if (typeof n.type === "string") visit(n);
  for (const key of Object.keys(n)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    walk(n[key], visit);
  }
}
