/**
 * @module tool-program
 *
 * SPEC §64 — Standalone Tool Target (`<program kind="tool">`) shared helpers.
 *
 * A `kind="tool"` top-level `<program>` re-targets the emit from a web
 * application (html + client.js + CSRF + server routes; §40.8) to a plain
 * runnable ES module — a CLI tool or long-running server runnable as
 * `bun <emitted>.js`. These helpers are the single source of truth for
 * "is this file a tool?" so the typer (E-TOOL-* validation, §23.2.4 bare-`_{}`
 * admission) and codegen (the tool-emit path) agree.
 *
 * `kind=` is a TOP-LEVEL output-shape selector (orthogonal to §43's nested
 * execution-context inference). The ONLY legal value in v1 is `"tool"`
 * (closed vocabulary; §23.5.3 discipline). Value/placement validation lives in
 * the typer (E-TOOL-002); these helpers only READ the attribute.
 */

import { isForeignLangLibDecl } from "./library-shape.js";

/** A loosely-typed AST node. */
type ASTNodeLike = Record<string, unknown>;

/** Extract the top-level nodes array from a FileAST (tolerates the nested shape). */
export function getToolNodes(fileAST: unknown): ASTNodeLike[] {
  if (!fileAST || typeof fileAST !== "object") return [];
  const f = fileAST as ASTNodeLike;
  const direct = f.nodes as ASTNodeLike[] | undefined;
  if (Array.isArray(direct)) return direct;
  const nested = (f.ast as ASTNodeLike | undefined)?.nodes as ASTNodeLike[] | undefined;
  return Array.isArray(nested) ? nested : [];
}

function isProgramMarkup(node: unknown): node is ASTNodeLike {
  if (!node || typeof node !== "object") return false;
  const n = node as ASTNodeLike;
  return n.kind === "markup" && n.tag === "program";
}

/**
 * The top-level `<program>` node — the FIRST program markup node in the root
 * nodes array (§40.8: one-program-per-app; the entry file declares it). Returns
 * null when the file has no top-level `<program>` (a §21.5 library file).
 */
export function findTopLevelProgramNode(fileAST: unknown): ASTNodeLike | null {
  for (const n of getToolNodes(fileAST)) {
    if (isProgramMarkup(n)) return n;
  }
  return null;
}

/**
 * Every `<program>` node in the file (top-level + any nested). Deep-walk; used
 * to detect a `kind=` on a NESTED `<program>` (E-TOOL-002 — §43 infers nested
 * kinds, so an explicit `kind=` there is invalid).
 */
export function findAllProgramNodes(fileAST: unknown): ASTNodeLike[] {
  const out: ASTNodeLike[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (isProgramMarkup(node)) out.push(node as ASTNodeLike);
    const n = node as ASTNodeLike;
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v === "object") walk(v);
    }
  };
  for (const n of getToolNodes(fileAST)) walk(n);
  return out;
}

/**
 * True when the file is a §21.5 pure-fn LIBRARY file: no top-level `<program>`,
 * exports-bearing, and its top-level nodes are all declarations (no page markup
 * beyond a §23.6 `<foreign lang>` / §44.7.1 `<db src>` library-context decl).
 *
 * Mirrors the W5a auto-detect (api.js) + `isPureModuleFile` (ast-builder.js), so
 * codegen can route such a file to the LIBRARY emit (`<base>.js`) when the BUILD
 * contains a `kind="tool"` entry: a tool emits a plain runnable module whose
 * `.scrml` deps must resolve to REAL `.js` modules (not browser client/server
 * artifacts). Browser-app builds (no tool entry) are untouched — a lib there is
 * still consumed via the client `_scrml_modules` registry (emit-client.ts).
 */
export function isLibraryShapedFile(fileAST: unknown): boolean {
  if (!fileAST || typeof fileAST !== "object") return false;
  const f = fileAST as ASTNodeLike;
  // The AST fields (`hasProgramRoot` / `exports`) sit on the inner FileAST at the
  // codegen stage (the file is a `{ filePath, ast, ... }` wrapper there) but at
  // top level pre-codegen. Read whichever holds them (same fallback getToolNodes
  // uses for `nodes`).
  const inner = (f.ast as ASTNodeLike | undefined) ?? f;
  if (inner.hasProgramRoot === true) return false;
  const nodes = getToolNodes(fileAST);
  if (nodes.length === 0) return false;
  const exportsList = (inner.exports as unknown[] | undefined) ?? [];
  if (exportsList.length === 0) return false;
  return nodes.every((n) => n && (n.kind !== "markup" || isForeignLangLibDecl(n)));
}

/**
 * Read the literal string value of an attribute (`{name, value}`), tolerating
 * both the bare-string and the `{kind:"string-literal", value}` node shapes.
 */
function attrString(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/^["']|["']$/g, "").trim();
  if (value && typeof value === "object") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string") return inner.replace(/^["']|["']$/g, "").trim();
  }
  return null;
}

/**
 * True when a program node carries a `kind=` attribute AT ALL (regardless of
 * value shape). Distinguishes "no kind declared" (a normal web app) from
 * "kind declared but not a valid `"tool"` string" (e.g. a bare `<program kind>`
 * with an absent value, or `kind="service"`) — the latter is E-TOOL-002.
 */
export function programHasKindAttr(programNode: ASTNodeLike | null | undefined): boolean {
  if (!programNode) return false;
  const attrs = programNode.attrs as Array<{ name?: string }> | undefined;
  if (!Array.isArray(attrs)) return false;
  return attrs.some((a) => a && a.name === "kind");
}

/** The `kind=` attribute value of a program node, or null if absent. */
export function getProgramKind(programNode: ASTNodeLike | null | undefined): string | null {
  if (!programNode) return null;
  const attrs = programNode.attrs as Array<{ name?: string; value?: unknown }> | undefined;
  if (!Array.isArray(attrs)) return null;
  const kindAttr = attrs.find((a) => a && a.name === "kind");
  if (!kindAttr) return null;
  return attrString(kindAttr.value);
}

/**
 * True when the file's TOP-LEVEL `<program>` declares `kind="tool"` (§64). This
 * is the single predicate the typer + codegen consult to switch to the tool
 * emit path / relax the §23.2.4 bare-`_{}` rule.
 */
export function isToolProgram(fileAST: unknown): boolean {
  return getProgramKind(findTopLevelProgramNode(fileAST)) === "tool";
}

/**
 * Collect the top-level `function-decl` nodes of the tool program (the entry
 * `function main` + helper `fn`/`function` declarations). Walks the logic
 * block(s) that are direct descendants of the top-level `<program>`.
 */
export function collectTopLevelFunctionDecls(fileAST: unknown): ASTNodeLike[] {
  const fns: ASTNodeLike[] = [];
  const collectFromBody = (body: unknown): void => {
    if (!Array.isArray(body)) return;
    for (const stmt of body) {
      if (stmt && typeof stmt === "object" && (stmt as ASTNodeLike).kind === "function-decl") {
        fns.push(stmt as ASTNodeLike);
      }
    }
  };
  const walkForLogic = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as ASTNodeLike;
    if (n.kind === "logic" && Array.isArray(n.body)) collectFromBody(n.body);
    for (const key of ["children", "body", "nodes"]) {
      const v = n[key];
      if (Array.isArray(v)) for (const c of v) walkForLogic(c);
    }
  };
  const prog = findTopLevelProgramNode(fileAST);
  if (prog) walkForLogic(prog);
  // Flat FileAST shape: the logic block may be a sibling of <program> at root.
  for (const n of getToolNodes(fileAST)) {
    if (n && typeof n === "object" && (n as ASTNodeLike).kind === "logic") {
      collectFromBody((n as ASTNodeLike).body);
    }
  }
  return fns;
}

/** The top-level `main` entry function-decl of the tool program, or null. */
export function findToolMainFn(fileAST: unknown): ASTNodeLike | null {
  for (const fn of collectTopLevelFunctionDecls(fileAST)) {
    if (fn.name === "main") return fn;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §64 (Fork 1A, Unit 2) — the `serve=` LISTENER surface.
//
// A `kind="tool" serve=PORT` program is a LISTENER-OWNING headless serve-target
// (NOT a "server shell"/"persistent shell" — those alias §20.8's SPA client
// shell): the compiler emits a `Bun.serve({ port, fetch, websocket? })` mounting
// the program's `<endpoint>` / SSE `server function* route=` children, replacing
// the §64.7 hand-rolled `_{}` `Bun.serve` gap. These helpers only READ the
// `serve=`/`cors=` attributes; placement/port-shape/auth validation lives in the
// typer, the harness emit in codegen/emit-tool.ts.
// ---------------------------------------------------------------------------

/** A resolved `serve=PORT` value. `literal` = an integer literal (`serve=7878`
 *  or `serve="7878"`); `expr` = a `${expr}` runtime port (the lowered-at-emit
 *  scrml expression `raw`); `invalid` = neither (→ E-TOOL-SERVE-PORT-INVALID). */
export type ServePortSpec =
  | { kind: "literal"; value: number }
  | { kind: "expr"; raw: string }
  | { kind: "invalid"; raw: string };

/** The resolved serve-config of a `kind="tool" serve=` program. */
export interface ToolServeConfig {
  port: ServePortSpec;
  /** The raw `cors=` string-literal value (`"*"`, an origin), or null. */
  cors: string | null;
  /** The `serve=` attribute node span (for diagnostic anchoring). */
  serveSpan: unknown;
}

/** True when a program node carries a `serve=` attribute AT ALL. */
export function programHasServeAttr(programNode: ASTNodeLike | null | undefined): boolean {
  if (!programNode) return false;
  const attrs = programNode.attrs as Array<{ name?: string }> | undefined;
  if (!Array.isArray(attrs)) return false;
  return attrs.some((a) => a && a.name === "serve");
}

/** Read the `cors=` string-literal value of a program node, or null. */
export function getProgramCors(programNode: ASTNodeLike | null | undefined): string | null {
  if (!programNode) return null;
  const attrs = programNode.attrs as Array<{ name?: string; value?: unknown }> | undefined;
  if (!Array.isArray(attrs)) return null;
  const a = attrs.find((x) => x && x.name === "cors");
  if (!a) return null;
  return attrString(a.value);
}

/**
 * Resolve a `serve=` attribute VALUE node into a `ServePortSpec` (§64.7). The
 * two canonical forms are an integer literal (`serve=7878` / `serve="7878"`) and
 * a `${expr}` runtime port (`serve=${port}`); anything else is `invalid`.
 *
 * Value-node shapes (verified against the parser):
 *   - bare integer `serve=7878`  → `{ kind:"variable-ref", exprNode:{ kind:"lit", litType:"number", value } }`
 *   - quoted `serve="7878"`      → `{ kind:"string-literal", value:"7878" }`
 *   - `serve=${port}`            → `{ kind:"expr", raw:"port", exprNode }`
 *   - bare ident `serve=port`    → `{ kind:"variable-ref", exprNode:{ kind:"ident" } }` (neither form → invalid)
 */
export function resolveServePort(value: unknown): ServePortSpec {
  const v = value as
    | { kind?: string; value?: unknown; raw?: unknown; name?: unknown; exprNode?: { kind?: string; litType?: string; value?: unknown; raw?: unknown } }
    | null
    | undefined;
  if (!v || typeof v !== "object") return { kind: "invalid", raw: "" };

  // `${expr}` runtime port — a bounded interpolation, lowered at emit.
  if (v.kind === "expr") {
    const raw = typeof v.raw === "string" ? v.raw.trim() : "";
    return raw ? { kind: "expr", raw } : { kind: "invalid", raw: "" };
  }

  // Bare integer literal (`serve=7878`) — a numeric `lit` exprNode. Port range is
  // 0–65535: 0 is the OS-assigned EPHEMERAL port (valid for `Bun.serve`; the
  // in-process boot / fsp-wire-smoke harness uses it), consistent with the
  // `${0}` runtime-port form (§64.9).
  if (v.kind === "variable-ref" && v.exprNode && v.exprNode.kind === "lit" && v.exprNode.litType === "number") {
    const n = v.exprNode.value;
    if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 65535) return { kind: "literal", value: n };
    return { kind: "invalid", raw: String(v.exprNode.raw ?? n ?? "") };
  }

  // Quoted numeric string (`serve="7878"` / `serve="0"`).
  if (v.kind === "string-literal" && typeof v.value === "string") {
    const s = v.value.trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= 0 && n <= 65535) return { kind: "literal", value: n };
    }
    return { kind: "invalid", raw: s };
  }

  // A bare identifier / any other shape is NOT one of the two canonical forms.
  const raw = (typeof v.name === "string" ? v.name : typeof v.raw === "string" ? v.raw : "");
  return { kind: "invalid", raw: String(raw) };
}

/**
 * All `<channel>` (§38) markup nodes anywhere inside the file's TOP-LEVEL
 * `<program>` — the WS-transport surface a `serve=` tool hosts. Used by the
 * cookie-session AUTH GUARDRAIL, which must enumerate EVERY cookie-auth locus
 * (program `auth=` AND per-channel `<channel auth=…>`), not just the program.
 */
export function collectToolProgramChannels(fileAST: unknown): ASTNodeLike[] {
  const prog = findTopLevelProgramNode(fileAST);
  if (!prog) return [];
  const out: ASTNodeLike[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as ASTNodeLike;
    if (n.kind === "markup" && n.tag === "channel") out.push(n);
    const kids = n.children as unknown;
    if (Array.isArray(kids)) for (const c of kids) walk(c);
  };
  walk(prog);
  return out;
}

/**
 * The resolved serve-config of the file's TOP-LEVEL `<program>` when it carries a
 * `serve=` attribute, else null. Reads `serve=` (→ ServePortSpec) + optional
 * `cors=`. Placement (top-level `kind="tool"` only) is validated separately by
 * the typer; this reads the top-level program unconditionally so the typer can
 * distinguish "serve= present here" from "serve= absent."
 */
export function getToolServeConfig(fileAST: unknown): ToolServeConfig | null {
  const prog = findTopLevelProgramNode(fileAST);
  if (!prog || !programHasServeAttr(prog)) return null;
  const attrs = prog.attrs as Array<{ name?: string; value?: unknown; span?: unknown }> | undefined;
  const serveAttr = Array.isArray(attrs) ? attrs.find((a) => a && a.name === "serve") : undefined;
  return {
    port: resolveServePort(serveAttr?.value),
    cors: getProgramCors(prog),
    serveSpan: serveAttr?.span ?? null,
  };
}
