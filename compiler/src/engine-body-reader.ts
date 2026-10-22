// ---------------------------------------------------------------------------
// engine-body-reader.ts — S469 (s469-engine-effect-failable, SECURITY): THE one
// parse of an engine body the compiler keeps as RAW TEXT until codegen.
//
// An engine's statement bodies (a state-child `effect=${…}`, the opener
// `effect=${…}`, an `<onTransition>` body, a `(state × message)` arm) and its
// expression slots (an `<onTransition if=…>` guard, a computed
// `<onTimeout after=${…}>` / `<onIdle after=${…}>` delay) are captured as text by
// `engine-statechild-parser.ts` / the engine opener parse and lowered by
// `codegen/emit-engine.ts`. Before S469 the type system never parsed them, so the
// §19.4.3 failable walk (E-ERROR-002) never saw a `check(p)` in one: a wrong
// password logged in through `effect=${ @msg = check(p) ? "IN" : "OUT" }`.
//
// This module parses such a body ONCE — the block splitter + AST builder over the
// body wrapped as a `${ … }` logic block, the parse emit-engine always lowered
// from — and caches the result on the body's OWNER object (the state-child entry,
// the `<onTransition>` entry, the arm, the engine metadata) under a slot name. The
// type system walks the cached statements (type-system `checkEngineRawBodies`) and
// codegen lowers THE SAME statement objects, so what runs is what was walked —
// including the stamps the walk leaves (a `match` on a failable result). A body
// that does not parse to statements has `stmts: null`; the walk refuses it and
// codegen never emits it.
// ---------------------------------------------------------------------------

import { soleLogicBlockPayload } from "./logic-block-extent.ts";

export interface EngineBodyRead {
  /** The AST builder's output for the wrapped body (`{ ast, errors, … }`), or null when it threw. */
  built: any;
  /** The body's statement list, or null when it does not parse to one. */
  stmts: any[] | null;
}

const _cache = new WeakMap<object, Map<string, { src: string; file: string; read: EngineBodyRead }>>();

function parseBody(src: string, filePath: string): EngineBodyRead {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bs = require("./block-splitter.js") as {
      runBlockSplitter: (i: { filePath: string; source: string }) => any;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tab = require("./ast-builder.js") as { buildAST: (bsOut: any) => any };
    const wrapped = "${\n" + src + "\n}";
    const built = tab.buildAST(bs.runBlockSplitter({ filePath, source: wrapped }));
    let stmts: any[] | null = null;
    const nodes: any[] = built?.ast?.nodes ?? [];
    // FAIL CLOSED — the wrapped body must parse to exactly ONE logic block: the block splitter
    // ending the `${` before the wrapper's own `}` (a reader that disagrees with acorn's extent,
    // e.g. at a `}` in a comment) leaves the rest of the body outside it, as text the walk would
    // never read. Such a body is unreadable (null), never a partial statement list.
    const significant = nodes.filter((n) => !(n?.kind === "text" && String(n.value ?? "").trim() === ""));
    if (significant.length !== 1) return { built, stmts: null };
    const n = significant[0];
    if (n?.kind === "logic" && Array.isArray(n.body) && n.body.length > 0) stmts = n.body;
    else if (Array.isArray(n?.body) && n.body.length > 0) stmts = n.body;
    else if (Array.isArray(n?.children) && n.children.length > 0) stmts = n.children;
    return { built, stmts };
  } catch {
    return { built: null, stmts: null };
  }
}

/**
 * The parse of `src` — the raw body text `owner[slot]` holds — as a statement list. The first
 * call for `(owner, slot)` parses; later calls with the same text return the SAME objects.
 * `filePath` is the synthetic file name the parse runs under (it names the body kind in
 * emit-engine's refusals). Without an owner the body is parsed afresh (no sharing).
 */
export function readEngineBody(owner: object | null | undefined, slot: string, src: string, filePath: string): EngineBodyRead {
  if (!owner || typeof owner !== "object") return parseBody(src, filePath);
  let m = _cache.get(owner);
  if (!m) { m = new Map(); _cache.set(owner, m); }
  const hit = m.get(slot);
  if (hit && hit.src === src && hit.file === filePath) return hit.read;
  const read = parseBody(src, filePath);
  m.set(slot, { src, file: filePath, read });
  return read;
}

/** Synthetic file names, one per body kind (emit-engine keys its refusal handling on them). */
export const ENGINE_BODY_FILE = {
  openerEffect: "__opener_effect__.scrml",
  messageArm: "__msg_arm__.scrml",
  stateEffect: "__state_effect__.scrml",
  onTransition: "__on_transition__.scrml",
  guard: "__engine_guard__.scrml",
  delay: "__engine_delay__.scrml",
} as const;

// ---------------------------------------------------------------------------
// The SOURCE of each body kind — one definition, read by the walk and by codegen.
// `null` = no body; `{ unreadable }` = a body the compiler cannot bound (refused).
// ---------------------------------------------------------------------------

export type BodySource = { src: string } | { unreadable: string } | null;

/** A `(state × message)` arm's body: a block body without its braces, or the bare target. */
export function messageArmSource(arm: { bodyRaw?: unknown; isBlockBody?: unknown }): string {
  let inner = (typeof arm?.bodyRaw === "string" ? arm.bodyRaw : "").trim();
  if (arm?.isBlockBody && inner.startsWith("{") && inner.endsWith("}")) inner = inner.slice(1, -1).trim();
  return inner;
}

/**
 * An `<onTransition>` body: the payload of its ONE `${ … }` block (bounded by acorn), or its
 * `:`-shorthand expression. A body that holds `${` but is not exactly one readable block
 * (`${a}${b}`, `${ … }` beside text, a block acorn cannot bound) is unreadable. A body with no
 * `${` is a code-default body (§4.18) and is read as statements.
 */
export function onTransitionBodySource(entry: { bodyRaw?: unknown; isColonShorthand?: unknown }): BodySource {
  const raw = typeof entry?.bodyRaw === "string" ? entry.bodyRaw.trim() : "";
  if (raw.length === 0) return null;
  if (entry?.isColonShorthand === true) return { src: raw };
  const payload = soleLogicBlockPayload(raw);
  if (payload !== null) return payload.trim().length > 0 ? { src: payload } : null;
  if (raw.includes("${")) return { unreadable: raw };
  return { src: raw };
}

/**
 * An `<onTransition if=…>` guard's expression: `if=${expr}` → the block's payload (bounded by
 * acorn); `if=(expr)` / `if=expr` → the text as written (a parenthesized expression is one).
 */
export function guardSource(ifExprRaw: unknown): BodySource {
  const raw = typeof ifExprRaw === "string" ? ifExprRaw.trim() : "";
  if (raw.length === 0) return null;
  if (raw.startsWith("${")) {
    const payload = soleLogicBlockPayload(raw);
    if (payload === null || payload.trim().length === 0) return { unreadable: raw };
    return { src: payload.trim() };
  }
  if (raw.includes("${")) return { unreadable: raw };
  return { src: raw };
}
