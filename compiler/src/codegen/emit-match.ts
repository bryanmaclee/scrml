/* SPDX-License-Identifier: MIT
 *
 * S108 Phase 3 — Match block-form codegen (SPEC §18.0.1).
 *
 * Mirrors `emit-engine.ts` (Phase A10 engine state-child render dispatch).
 * Consumes Phase 1's `kind: "match-block"` AST node (with `bodyChildren`
 * retrofit S108 — mirror of engine-decl.bodyChildren / Phase A10 precedent).
 *
 * Pipeline integration:
 *   - `emit-html.ts` dispatch:     `emitMatchMountHtml(node, ctx)` → emits
 *                                  the `<div data-scrml-match-mount=...>`
 *                                  slot at the match-block's source position.
 *   - `emit-client.ts` aggregator: `emitMatchBodyRenderForFile(fileAST, ctx)`
 *                                  → returns `{ renderFunctions, dispatchers }`
 *                                  appended next to the C12/C14 engine
 *                                  body-render block.
 *
 * Variant-source-agnostic helper reuse: passes match-block arms to
 * `emit-variant-guard.ts:emitVariantGuardedRender` — the SAME helper the
 * engine consumer uses. The helper's JSDoc explicitly anticipates this
 * second consumer ("future match-block-form consumer will populate from
 * its own opener parser").
 *
 * Phase 3 v1 scope (this landing):
 *   - Walks every `kind: "match-block"` AST node in the file (recursive).
 *   - Resolves `on=` to a JS accessor:
 *       - `on=@cell`             → Shape A (subscribe-only); cellName drives
 *                                  the dispatcher's `_scrml_reactive_subscribe`.
 *       - `on=${expr}`           → Shape B (effect mode); expr emitted as-is.
 *       - `on="literal"` / other → Shape B (effect mode).
 *       - `on=` absent + engine  → look up `<engine for=<forType>>` in file
 *         in scope               → use engine's varName, Shape A.
 *   - Unit variants + parenthesized payload bindings supported.
 *   - Body markup (text, interp, nested tags, delegable + non-delegable
 *     events) walked through standard `generateHtml` via the helper's
 *     `emitArmRenderFunction` + per-arm wire functions.
 *   - Wildcard `<_>` arms: S109 Phase 5 — explicit render. The wildcard
 *     arm (parser tag `_`) is built like any other arm; the consumer
 *     passes `defaultArmTag: "_"` to emitVariantGuardedRender so the
 *     dispatcher renders the wildcard body as its catch-all `else { ... }`
 *     branch (fires whenever no named arm matched the current variant).
 *     Pre-S109 the wildcard was skipped in codegen — the mount slot stayed
 *     untouched for unmatched variants.
 *
 * Tree-shake: when ALL arms have empty body, helper returns the empty
 * triple and this module emits nothing for that match-block (mount slot
 * is also skipped per emit-html.ts dispatch).
 *
 * **Not in Phase 3 v1 scope** (deferred to follow-on phases):
 *   - `:`-shorthand arm body codegen (Phase 4 — typer + body-walker path)
 *   - Per-arm reactive re-wire for `${@cell}` interp INSIDE non-initial
 *     arm bodies (matches engine v1 limitation per PRIMER §7 — fall-through
 *     to file-level reactive-wiring at module-init; subsequent arm changes
 *     produce correct static HTML but in-arm `${@cell}` re-subscribes only
 *     on the initial-arm mount cycle).
 *   - Bare-variant inference (§18.0.3) — Phase 4 typer integration.
 *
 * See `docs/changes/match-block-form-scoping/SCOPING.md` for the 5-phase
 * arc + ratified OQs.
 */

import type { CompileContext } from "./context.ts";

interface MatchBlockAstNode {
  id: number;
  kind: "match-block";
  forType: string;
  onExprRaw: string | null;
  armsRaw: string;
  bodyChildren?: any[];
  span: any;
  /** R28-1 (S143) — set by collectMatchBlocks when this match-block is
   *  nested inside an `<each>` body scope: the enclosing each's current-
   *  iteration variable (`asName` or the synthetic `_scrml_each_item`).
   *  Used by resolveOnExpr to lower an `on=@.field` sigil to the iter var,
   *  matching the `on=alias.field` form per SPEC §17.7.3 (identical
   *  codegen). Null/absent when the match-block is not inside an each. */
  enclosingEachIterVar?: string | null;
}

// ---------------------------------------------------------------------------
// Walker — collect match-block nodes from anywhere in the file AST
// ---------------------------------------------------------------------------

/**
 * Recursive walker that returns every match-block AST node in the file.
 * Match-blocks can appear inside pages, components, engine arm bodies,
 * other match-blocks (nested case-analysis is legal per §18.0.1 — the
 * cross-cutting concern is that an inner match-block consumes its OWN
 * `on=` cell independent of the outer match-block's cell).
 *
 * R28-1 (S143) — the walker also threads the enclosing `<each>` body's
 * current-iteration variable: when it descends into an each-block's
 * `templateChildren` (the per-item template — the iter-scoped child set),
 * it carries the each's iter var (`asName` or the synthetic
 * `_scrml_each_item`) and stamps it onto every match-block found beneath.
 * resolveOnExpr then lowers an `on=@.field` sigil to that iter var (SPEC
 * §17.7.3 — `@.field` and `alias.field` produce identical codegen). The
 * `<empty>` sub-element body is NOT iter-scoped, so it descends with a
 * null iter var. Nested `<each>` scopes resolve to the INNERMOST scope
 * automatically (each descent overrides the carried iter var).
 */
function collectMatchBlocks(fileAST: any): MatchBlockAstNode[] {
  const found: MatchBlockAstNode[] = [];
  const seen = new WeakSet<object>();
  function walk(node: any, eachIterVar: string | null): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) walk(n, eachIterVar);
      return;
    }
    if (node.kind === "match-block") {
      // Stamp the enclosing each's iter var (null when not inside an each)
      // so resolveOnExpr can lower an `on=@.field` sigil. Always set it
      // (idempotent across re-walks).
      (node as MatchBlockAstNode).enclosingEachIterVar = eachIterVar;
      found.push(node as MatchBlockAstNode);
      // Recurse into bodyChildren so nested match-blocks inside arm bodies
      // surface too. Arm bodies are NOT a new iteration scope, so the
      // enclosing each iter var carries through unchanged.
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren, eachIterVar);
      return;
    }
    // R28-1 — entering an each-block: its per-item template (templateChildren)
    // is the iter-scoped child set; the iter var is `asName` or the synthetic
    // `_scrml_each_item` (mirrors emit-each.ts iterVarName resolution). The
    // <empty> body (emptyChild) is NOT iter-scoped. Visit templateChildren
    // FIRST so the iter-var stamp wins (templateChildren shares node refs
    // with bodyChildren; the `seen` set blocks the later bodyChildren re-walk).
    if (node.kind === "each-block") {
      const innerIterVar = (typeof node.asName === "string" && node.asName.length > 0)
        ? node.asName
        : "_scrml_each_item";
      if (Array.isArray(node.templateChildren)) walk(node.templateChildren, innerIterVar);
      if (node.emptyChild) walk(node.emptyChild, null);
      // Fall through to the generic descent for any other container fields
      // (bodyChildren is now seen-guarded; descend with the OUTER iter var so
      // a match-block reachable only via a non-template field still resolves).
    }
    // Recurse into known container fields. Mirror engine-decl + match-block
    // descent shape — children / body / bodyChildren / nodes / arms.
    for (const key of ["children", "body", "bodyChildren", "nodes", "arms"]) {
      if (Array.isArray(node[key])) walk(node[key], eachIterVar);
    }
  }
  // The pipeline passes the OUTER file-result object whose AST nodes live
  // under `fileAST.ast.nodes` — NOT a bare AST with top-level `.nodes`.
  // (Unit tests pass `tab.ast` directly, which DOES have top-level `.nodes`.)
  // Mirror emit-engine.ts:collectC12EngineDecls — accept BOTH shapes.
  // S109: this `.ast?.nodes` fallback was MISSING pre-S109; full-pipeline
  // compiles found 0 match-blocks here (emitMatchMountHtml still emitted the
  // mount slot because it receives the node directly from emit-html's walk)
  // — the dispatcher + render fns were silently never emitted. Match
  // block-form Phase 5 integration gap; see docs/changes/match-block-form-scoping/.
  walk(fileAST.nodes ?? fileAST.ast?.nodes ?? fileAST.children ?? fileAST);
  return found;
}

// ---------------------------------------------------------------------------
// Engine var lookup — for auto-implied `on=` resolution
// ---------------------------------------------------------------------------

/**
 * Find an in-scope engine declaration matching `forType`. Used when match-
 * block has no explicit `on=` (auto-implied per §18.0.1: "Auto-implied
 * ONLY when an `<engine for=Type>` for the same `Type` is in scope").
 *
 * Returns the engine's varName when a match is found; null otherwise.
 * SYM PASS 20 already fires E-MATCH-ON-REQUIRED when no `on=` + no engine
 * is in scope — codegen returns null in that case and skips emission for
 * the match-block (the diagnostic is the user-facing surface).
 */
function findEngineVarForType(forType: string, fileAST: any): string | null {
  if (!forType) return null;
  const seen = new WeakSet<object>();
  let result: string | null = null;
  function walk(node: any): void {
    if (result !== null) return;
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) {
        walk(n);
        if (result !== null) return;
      }
      return;
    }
    if (node.kind === "engine-decl") {
      const meta = node._record?.engineMeta;
      if (meta && meta.forType === forType && typeof meta.varName === "string") {
        result = meta.varName;
        return;
      }
    }
    for (const key of ["children", "body", "bodyChildren", "nodes", "arms"]) {
      if (Array.isArray(node[key])) {
        walk(node[key]);
        if (result !== null) return;
      }
    }
  }
  // Accept both the bare-AST shape (`.nodes`) and the pipeline's outer
  // file-result wrapper (`.ast.nodes`) — see collectMatchBlocks note.
  walk(fileAST.nodes ?? fileAST.ast?.nodes ?? fileAST.children ?? fileAST);
  return result;
}

// ---------------------------------------------------------------------------
// `on=` expression resolution
// ---------------------------------------------------------------------------

interface OnExprResolution {
  /** JS expression that evaluates to the CURRENT variant value at runtime.
   *  Used by Shape B (effect mode). Ignored by Shape A (subscribe path
   *  reads the cell directly via `_scrml_reactive_get(varName)`). */
  variantExprAccessor: string;
  /** Reactive cell name when on= is a single `@ident` ref (Shape A) OR
   *  when on= is auto-implied to an engine variable (Shape A). Null when
   *  on= is a non-cell expression (Shape B effect mode). */
  variantSubscribeName: string | null;
  /** Member-access sub-path suffix applied to the subscribed cell, e.g.
   *  ".state" for `on=@cell.state`. Empty string for a bare `@cell` ref or
   *  an auto-implied engine var. GITI-031 (2026-06-23) — Shape A subscribe
   *  fires the callback with the WHOLE cell value, so the dispatch must
   *  apply this sub-path to reach the enum-variant discriminant. */
  subscribeSubPath: string;
}

/**
 * Rewrite the `@.` contextual iteration sigil to the enclosing `<each>`'s
 * current-iteration variable inside an `on=` expression's raw text.
 *
 * R28-1 (S143) — a block-form `<match for=T on=@.field>` nested inside an
 * `<each ... as alias>` body. Per SPEC §17.7.3 the `@.field` form and the
 * `as`-bound `alias.field` form are ALIASES that "produce identical codegen";
 * the match `on=` lowering must therefore resolve `@.field` to the same
 * iter-var member-access that the `alias.field` form already produces.
 * Without this, the raw `@.` survives into the module-scope dispatcher call
 * (`_scrml_match_match_NNN_dispatch(@.field)`) — invalid JS, gate-caught by
 * E-CODEGEN-INVALID-JS.
 *
 * Mirror of emit-table-for.ts:rewriteAtDotInExprText (Bug 32 prior art) and
 * emit-each.ts:rewriteContextualSigil — `@.field` -> `<iterVar>.field`,
 * bare `@.` -> `<iterVar>`. The BS tokenizer space-pads `.` operators
 * (`@.status` -> `@ . status`); the regex tolerates surrounding whitespace.
 * Conservative — does not touch `@cell` (no dot follows the sigil).
 *
 * NOTE (R28-1 surfaced, OUT OF SCOPE): the match dispatcher is emitted at
 * MODULE scope, not per-iteration inside the each render fn — so referencing
 * the loop var (whether via `@.field` lowered here or via the author-written
 * `alias.field`) produces a module-scope reference that is not the live
 * per-item value. This lowering closes the parse-gate fire and achieves the
 * SPEC-mandated "identical codegen" parity with the `alias.field` form; the
 * deeper per-item-match-inside-each runtime-correctness gap is pre-existing
 * and identical for BOTH forms (see report).
 */
function rewriteAtDotInOnExpr(text: string, iterVar: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/@\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g, (_m, member) => `${iterVar}.${member}`)
    .replace(/@\s*\.\s*(?![A-Za-z_$])/g, iterVar);
}

/**
 * Resolve a match-block's `on=` expression text to:
 *   - the JS accessor expression for the helper's effect-mode dispatcher
 *   - the reactive cell name for the helper's subscribe-mode dispatcher
 *     (when on= is a bare `@cell` ref OR when on= is auto-implied to an
 *      engine variable, both of which are subscribe-eligible)
 *
 * Returns null when on= is missing AND no engine for forType is in scope
 * — that case fires E-MATCH-ON-REQUIRED at SYM time; codegen skips
 * emission cleanly.
 */
function resolveOnExpr(
  matchBlock: MatchBlockAstNode,
  fileAST: any,
): OnExprResolution | null {
  // Explicit on= form.
  if (matchBlock.onExprRaw) {
    // R28-1 (S143) — when this match-block sits inside an `<each>` body,
    // lower the `@.` contextual iteration sigil to the each's iter var
    // FIRST, so the remaining branch logic sees a plain identifier member-
    // access (`alias.field`) — identical to the author-written
    // `on=alias.field` form (SPEC §17.7.3). Outside an each, iterVar is
    // null/absent and the raw text passes through unchanged.
    const _eachIterVar = matchBlock.enclosingEachIterVar;
    const _onRaw = (typeof _eachIterVar === "string" && _eachIterVar.length > 0)
      ? rewriteAtDotInOnExpr(matchBlock.onExprRaw, _eachIterVar)
      : matchBlock.onExprRaw;
    const expr = _onRaw.trim();
    // Bare cell ref `@ident` — Shape A subscribe.
    const cellRefMatch = expr.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (cellRefMatch) {
      const cellName = cellRefMatch[1];
      return {
        variantExprAccessor: `_scrml_reactive_get(${JSON.stringify(cellName)})`,
        variantSubscribeName: cellName,
        subscribeSubPath: "",
      };
    }
    // `${expr}` interpolation form — strip wrapping + use inner as JS expr.
    // Shape B (effect mode).
    let innerExpr = expr;
    const dollarMatch = expr.match(/^\$\{([\s\S]*)\}$/);
    if (dollarMatch) {
      innerExpr = dollarMatch[1].trim();
    } else {
      // Strip surrounding quotes for string-literal form.
      if ((expr.startsWith('"') && expr.endsWith('"')) ||
          (expr.startsWith("'") && expr.endsWith("'"))) {
        innerExpr = expr;
      }
    }
    // Bare `@ident.path` (member-access) ref — lower to `_scrml_reactive_get`
    // on the root ident; subscribe to root cell. Phase 3 v1 limitation:
    // member-access via subscribe captures changes to the root cell only,
    // not deep cell changes — acceptable for the typical case where a
    // compound state's reactive field is read via dotted path.
    const memberMatch = innerExpr.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)((?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)$/);
    if (memberMatch) {
      const rootCell = memberMatch[1];
      const path = memberMatch[2];
      return {
        variantExprAccessor: `(_scrml_reactive_get(${JSON.stringify(rootCell)}))${path}`,
        variantSubscribeName: rootCell,
        subscribeSubPath: path,
      };
    }
    // S138 Bug 52 — bare-variant `.Variant` form (§14.10 / §18.0.3 lowering).
    // Mirrors the canonical bare-variant lowering at `emit-expr.ts:emitIdent`
    // (lines 291-303): unit variants store as bare string tags at runtime
    // (`Phase.Idle === "Idle"`), so `.High` lowers to `"High"`. The dispatch
    // helper's `_tag` extraction handles string `_v` directly:
    //   `_tag = (typeof _v === "object" ...) ? _v.variant : _v`
    // → for the string form, `_tag = _v = "High"` matches the `_tag === "High"`
    // dispatch branch. No reactive subscription — constant `on=` is a
    // shape-degenerate case (always dispatches to one branch) that adopters
    // typically wouldn't write deliberately, but the form is syntactically
    // legal per SPEC §18.0.1 and the compiler must produce valid output.
    const bareVariantMatch = innerExpr.match(/^\.([A-Z][A-Za-z0-9_$]*)$/);
    if (bareVariantMatch) {
      return {
        variantExprAccessor: JSON.stringify(bareVariantMatch[1]),
        variantSubscribeName: null,
        subscribeSubPath: "",
      };
    }
    // Fall-through: complex expression (calls, arrows, operators — e.g.
    // `@nums.filter(c => c == 1)`) → Shape B effect mode. S177 bug-48: lower
    // the raw scrml expression through the ExprNode pipeline so `@cell` sigils
    // become `_scrml_reactive_get(...)` and scrml operators (`==`, etc.) lower
    // to their JS forms — previously this branch emitted `innerExpr` VERBATIM,
    // leaking the `@` sigil + scrml operators into the dispatch call and
    // tripping E-CODEGEN-INVALID-JS. The simple regex shapes above (`@ident`,
    // `@ident.path`, `${...}`, `.Variant`) are unchanged; only this complex
    // fall-through is now lowered. parseExprToNode + emitExpr are the same
    // helpers the arm-body path uses (below). On parse failure, fall back to the
    // verbatim text (defensive — preserves prior behavior for unparseable input).
    let loweredAccessor = innerExpr;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parseExprToNode } = require("../expression-parser.ts") as {
        parseExprToNode: (raw: string, filePath: string, offset: number, opts?: { tildeActive?: boolean }) => any;
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitExpr } = require("./emit-expr.ts") as {
        emitExpr: (node: any, ctx: { mode: string; requestIds?: Set<string> | null; synthCellKeys?: Set<string> | null }) => string;
      };
      // §6.7.7 / §60.4 — route a `<#id>` request ref in the `on=` expr to the
      // reactive `_scrml_request_<id>` object (the deep-reactive Proxy the match
      // dispatch effect auto-tracks), not the §36 input-state registry.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { collectRequestIds, collectSynthCellKeys } = require("./reactive-deps.ts") as {
        collectRequestIds: (fileAST: any) => Set<string>;
        collectSynthCellKeys: (fileAST: any) => Set<string>;
      };
      const _requestIds = fileAST ? collectRequestIds(fileAST) : new Set<string>();
      // §55.10 L4 — the scrutinee often reads a SYNTHESIZED validity-surface cell
      // (`@signup.name.errors[0]` for the `<match for=ValidationError>` escape
      // hatch). Those `.errors` / `.isValid` / `.touched` leaves are FLAT derived
      // cells keyed by the whole dotted path (`signup.name.errors`), NOT nested
      // properties on the compound value. Thread `synthCellKeys` so `emitMember`
      // collapses `@signup.name.errors` to `_scrml_reactive_get("signup.name.errors")`
      // (the universal accessor, which delegates to the derived cache) instead of
      // `_scrml_reactive_get("signup").name.errors` — the latter reads the derived
      // compound (undefined for a reactive_get) and crashes on `.name` at init.
      const _synthCellKeys = fileAST ? collectSynthCellKeys(fileAST) : new Set<string>();
      const filePath = (fileAST?.filePath as string | undefined) ?? `<match-on:${matchBlock.id}>`;
      const onNode = parseExprToNode(innerExpr, filePath, 0);
      if (onNode) loweredAccessor = emitExpr(onNode, {
        mode: "client",
        ...(_requestIds.size > 0 ? { requestIds: _requestIds } : {}),
        ...(_synthCellKeys.size > 0 ? { synthCellKeys: _synthCellKeys } : {}),
      });
    } catch (_e) {
      // Leave loweredAccessor = innerExpr (verbatim fallback).
    }
    return {
      variantExprAccessor: loweredAccessor,
      variantSubscribeName: null,
      subscribeSubPath: "",
    };
  }
  // Auto-implied — find engine in scope.
  const engineVar = findEngineVarForType(matchBlock.forType, fileAST);
  if (engineVar) {
    return {
      variantExprAccessor: `_scrml_reactive_get(${JSON.stringify(engineVar)})`,
      variantSubscribeName: engineVar,
      subscribeSubPath: "",
    };
  }
  // No on=, no engine — E-MATCH-ON-REQUIRED fires upstream; codegen skips.
  return null;
}

// ---------------------------------------------------------------------------
// Variant field-name resolution (for positional payload binding)
// ---------------------------------------------------------------------------

/**
 * Parse declared field names per variant from a type-decl's raw enum body.
 * Mirrors the engine-side `variantFields` resolution at
 * `emit-engine.ts:buildEngineArms` (which itself mirrors
 * `symbol-table.ts:parseEnumVariantPayloadFieldsFromRaw`).
 *
 * Returns a Map<variantTag, fieldNames[]> for the named enum type, or
 * null when the type is unresolvable (e.g., not declared in this file,
 * cross-file types not yet resolved at codegen time).
 *
 * Used to resolve POSITIONAL payload bindings per SPEC §18.0.1 →
 * §51.0.B.1 normative statement: "Positional binding ... SHALL assign
 * fields left-to-right in declaration order, regardless of the chosen
 * local name."
 */
function resolveVariantFields(forType: string, fileAST: any): Map<string, string[]> | null {
  if (!fileAST) return null;
  const typeDecls = (fileAST as any).typeDecls ?? (fileAST as any).ast?.typeDecls;
  if (!Array.isArray(typeDecls)) return null;
  for (const td of typeDecls) {
    if (!td || td.kind !== "type-decl") continue;
    if (td.name !== forType) continue;
    if (td.typeKind !== "enum") return null;
    const out = new Map<string, string[]>();
    let body = (td.raw || "").trim();
    if (body.startsWith("{")) body = body.slice(1);
    if (body.endsWith("}")) body = body.slice(0, -1);
    body = body.trim();
    if (!body) return out;
    // Strip transitions block (legacy `<machine>` form).
    let vsection = body;
    {
      let depth = 0;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i]!;
        if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
        if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
        if (depth === 0 && body.slice(i).startsWith("transitions")) {
          const after = body.slice(i + 11).trimStart();
          if (after.startsWith("{")) { vsection = body.slice(0, i).trim(); break; }
        }
      }
    }
    // Split on \n, comma, pipe at depth 0.
    const segments: string[] = [];
    let depth = 0;
    let buf = "";
    for (let i = 0; i < vsection.length; i++) {
      const ch = vsection[i]!;
      if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
      if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
        if (buf.trim()) segments.push(buf.trim());
        buf = "";
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) segments.push(buf.trim());
    for (const seg of segments) {
      let text = seg.trim();
      if (text.startsWith(".")) text = text.slice(1).trim();
      const parenIdx = text.indexOf("(");
      if (parenIdx < 0) {
        const rendersIdx = text.indexOf(" renders ");
        const name = rendersIdx >= 0 ? text.slice(0, rendersIdx).trim() : text;
        if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) out.set(name, []);
        continue;
      }
      const name = text.slice(0, parenIdx).trim();
      const closeParen = text.lastIndexOf(")");
      const fieldList = closeParen > parenIdx ? text.slice(parenIdx + 1, closeParen).trim() : "";
      const fields: string[] = [];
      if (fieldList) {
        let d = 0;
        let fbuf = "";
        const parts: string[] = [];
        for (let j = 0; j < fieldList.length; j++) {
          const ch = fieldList[j]!;
          if (ch === "(" || ch === "[" || ch === "{") { d++; fbuf += ch; continue; }
          if (ch === ")" || ch === "]" || ch === "}") { d--; fbuf += ch; continue; }
          if (d === 0 && ch === ",") {
            if (fbuf.trim()) parts.push(fbuf.trim());
            fbuf = "";
            continue;
          }
          fbuf += ch;
        }
        if (fbuf.trim()) parts.push(fbuf.trim());
        for (const p of parts) {
          const colon = p.indexOf(":");
          if (colon >= 0) {
            const fn = p.slice(0, colon).trim();
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fn)) fields.push(fn);
          }
        }
      }
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) out.set(name, fields);
    }
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build VariantArm[] for a single match-block
// ---------------------------------------------------------------------------

/**
 * Map a match-block AST node + Phase 2 arm structural entries to
 * `VariantArm[]` consumed by `emitVariantGuardedRender`.
 *
 * Returns null when the match-block's armsRaw is empty (parse failure or
 * empty body; codegen skips).
 *
 * **Body parsing.** Match-block bodies are captured by BS as a single raw
 * text run (per Phase 2's STRUCTURAL_RAW_BODY_ELEMENTS gate that avoided
 * the `:`-shorthand vs bare-body BS-shape confusion). The `bodyChildren`
 * field on the match-block AST node consequently holds only that raw text
 * — not walkable arm-body AST. Phase 3 codegen bridges the gap by
 * re-parsing each arm's `bodyRaw` (from Phase 2's parseMatchArms output)
 * through the BS+TAB pipeline as a synthetic fragment. The resulting AST
 * nodes are the arm's `body` for VariantArm.
 *
 * This re-parse runs once per match-block per arm at codegen time. Cost is
 * minimal: arm bodies are small + the pipeline is fast on tiny inputs.
 * The synthetic fragment parse runs without typeDecls / imports / engine
 * context — fine because arm bodies don't declare those (they consume
 * file-scope state via canonical `@cell` access which is resolved at
 * codegen-time emission, not at AST construction).
 */
/**
 * g-shorthand-interp-match-arm-codegen (S195 MED / S196 prereq-bug Bucket 4) —
 * recognise a `:`-shorthand arm body that is a §4.18.3 DISPLAY-TEXT LITERAL
 * (`"..."`, possibly carrying `${...}` interpolation per §4.18.4). Returns the
 * literal's INNER content with the three §4.18.3 escapes decoded (`\"` -> `"`,
 * `\\` -> `\`, `\${` -> `${`), or `null` when the body is NOT a single
 * well-formed display-text literal (a value-expression `@cell` / `fn()` /
 * `.Variant` / a markup-as-value `<p>` element — those take their own paths).
 *
 * The inner content is then routed through the SAME free-text fragment lowering
 * the bare-body form uses (nativeParseFile) so the literal segments are
 * HTML-escaped (§4.18.6) and the `${...}` interpolations are wired (§4.18.4) —
 * byte-equivalent display to `<Variant ...><p>${...}</p></>`. Pre-fix the body
 * went through parseExprToNode, which parsed `"Failed: ${reason}"` as a plain JS
 * string literal and emitted `return "Failed: ${reason}"` LITERALLY (the `${...}`
 * dead text, no `data-scrml-logic` wire) — silent wrong output.
 *
 * A display-text literal is `"` ... `"` with the ONLY unescaped `"` being the
 * delimiters. We require the FIRST char to be `"` and the matching close `"` to
 * be the LAST char (a single literal, not `"a" + "b"` concatenation — that is a
 * value-expression, handled by parseExprToNode). Backtick / apostrophe are
 * ordinary interior chars (§4.18.3) and need no special handling here.
 */
export function displayTextLiteralInner(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 2 || s[0] !== '"') return null;
  // Scan for the matching close `"`, honouring the three §4.18.3 escapes. The
  // close must be the LAST non-trailing-whitespace char — otherwise this is a
  // concatenation / larger expression, not a single display-text literal.
  let i = 1;
  const out: string[] = [];
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const next = s[i + 1];
      if (next === '"' || next === "\\") { out.push(next); i += 2; continue; }
      // `\${` -> literal `${` (the interpolation-opener escape, §4.18.3/§4.18.4).
      if (next === "$" && s[i + 2] === "{") { out.push("${"); i += 3; continue; }
      // Any other backslash escape is malformed inside a display-text literal —
      // bail out (not our shape; let the existing path surface a diagnostic).
      return null;
    }
    if (c === '"') {
      // Found the close. It must terminate the literal (only trailing whitespace
      // may follow). Otherwise it is not a single display-text literal.
      if (i === s.length - 1) return out.join("");
      return null;
    }
    out.push(c);
    i++;
  }
  // Unterminated — not a well-formed display-text literal; let the existing path
  // surface E-CTX-001 / the diagnostic.
  return null;
}

function buildMatchArms(
  matchBlock: MatchBlockAstNode,
  fileAST: any,
): import("./emit-variant-guard.ts").VariantArm[] | null {
  if (!matchBlock.armsRaw || typeof matchBlock.armsRaw !== "string") return null;

  // Memoize on the match-block node. buildMatchArms runs once per HTML-mount
  // pass (emitMatchMountHtml) AND once per client-render pass
  // (emitMatchBodyRenderForFile) over the SAME node references walked from
  // ctx.fileAST. The each-in-arm fix (below) re-parses arm bodies into real
  // `each-block` nodes whose `id` drives both the `<div data-scrml-each-mount=
  // "each_<id>">` slot AND the `_scrml_each_render_<id>` fn name — those ids
  // MUST be identical across passes, and the each-block nodes MUST be the SAME
  // object refs that get attached to matchBlock.bodyChildren (so emit-each's
  // collectEachBlocks(fileAST) finds them). Caching on the node guarantees both.
  if (Array.isArray((matchBlock as any).__scrmlCachedArms)) {
    return (matchBlock as any).__scrmlCachedArms;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseMatchArms } = require("../match-statechild-parser.ts") as {
    parseMatchArms: (armsRaw: string) => {
      arms: Array<{
        variantName: string;
        isWildcard: boolean;
        payloadBindingsRaw: string;
        attrs: Array<{ name: string; valueRaw: string; spanStart: number; spanEnd: number }>;
        bodyForm: "self-closing" | "shorthand" | "bare-body";
        bodyRaw: string;
        spanStart: number;
        spanEnd: number;
        openerStart: number;
      }>;
      diagnostics: Array<{ code: string; message: string; spanStart: number; spanEnd: number }>;
    };
  };

  // M6.3 (M6 Wave 1, S122) — bare-body arm re-parse routes through
  // `nativeParseFile`, the C1 drop-in analogue of `buildAST` (returns
  // `{ filePath, ast: FileAST, errors }` with identical `ast.nodes` shape).
  // Pre-M6.3 this site lazy-required `splitBlocks` + `buildAST` (one of the
  // 5 hard-bound BS synthesis re-invocations per the M6 cutover plan); the
  // arm's bodyRaw is markup-shape (nested tags, text, `${...}` interp,
  // event handlers — all consumed downstream by `generateHtml`), squarely
  // within `nativeParseFile`'s remit. The synth filePath label
  // `<match:${matchBlock.id}:${tag}>` is opaque (span-attribution only).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nativeParseFile } = require("../../native-parser/parse-file.js") as {
    nativeParseFile: (filePath: string, src: string) => { filePath: string; ast: any; errors: any[] };
  };
  // each-in-block-form-match (S153) — when an arm body contains an `<each>`,
  // `nativeParseFile` produces a generic `markup` node (tag "each"), NOT the
  // `each-block` AST node that emit-each + generateHtml's each-block branch
  // require: the each-block transform lives in `buildAST` (ast-builder.js), not
  // in the native parser. The legacy BS+TAB path DOES apply that transform, so
  // for each-bearing arm bodies we re-parse via splitBlocks+buildAST (this is
  // exactly the pre-M6.3 synthesis route, scoped to the each case). Without it
  // the each renders as a LITERAL `<each>` string and its `${@.name}` lowers to
  // an unscoped logic binding → `el.textContent = .name;` (invalid JS,
  // E-CODEGEN-INVALID-JS).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { splitBlocks } = require("../block-splitter.js") as {
    splitBlocks: (filePath: string, src: string) => any;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildAST } = require("../ast-builder.js") as {
    buildAST: (bsOutput: any) => { filePath: string; ast: any; errors: any[] };
  };
  // S108 Phase 4 — `:`-shorthand body codegen uses parseExprToNode directly
  // to treat the bodyRaw as an expression (not as markup). The synthesized
  // logic-node + bare-expr shape routes through generateHtml's existing
  // interpolation path → either folds inline (constants) or emits placeholder
  // + reactive binding (cells / non-constants).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseExprToNode } = require("../expression-parser.ts") as {
    parseExprToNode: (raw: string, filePath: string, offset: number, opts?: { tildeActive?: boolean }) => any;
  };

  const result = parseMatchArms(matchBlock.armsRaw);
  const variantFields = resolveVariantFields(matchBlock.forType, fileAST);
  const arms: import("./emit-variant-guard.ts").VariantArm[] = [];
  // each-in-block-form-match (S153) — each-block nodes lifted out of arm bodies
  // during the bare-body re-parse, attached to matchBlock.bodyChildren after the
  // loop so emit-each's collectEachBlocks(fileAST) emits their render fns.
  const collectedEachBlocks: any[] = [];
  // g-each-over-arm-payload-binding-unbound (2026-06-17) — the reactive cell
  // driving this match (its `on=` cell, or the auto-implied engine var). When an
  // arm's `<each in=BINDING>` iterates the arm PAYLOAD binding, emit-each must
  // resolve the iterable from THIS cell at runtime (the each render fn is a
  // top-level no-arg fn — the arm-render-fn param `rows`/`items` is not in its
  // scope). Null when the cell is not subscribe-eligible (constant `.Variant`
  // on=, or an unresolved complex expression — those shapes don't carry a live
  // variant payload to iterate, so no stamp).
  const _armCellResolution = resolveOnExpr(matchBlock, fileAST);
  const _armCellName: string | null =
    _armCellResolution && _armCellResolution.variantSubscribeName
      ? _armCellResolution.variantSubscribeName
      : null;

  for (const entry of result.arms) {
    // Wildcard arm `<_>` — S109 Match block-form Phase 5: explicit render.
    // Pre-S109 the wildcard was SKIPPED in codegen (the helper's
    // no-default-branch semantic left the mount slot unchanged for
    // unmatched variants). S109 emits the wildcard as a real arm with the
    // sentinel tag `_`; emitMatchBodyRenderForFile passes `defaultArmTag: "_"`
    // so emitVariantGuardedRender renders it as the dispatcher's catch-all
    // `else { ... }` branch (SPEC §18.0.1 — `<_>` matches any remaining
    // variant). The wildcard carries NO payload bindings — it does not name
    // a specific variant, so there is no variant payload to bind.
    const tag = entry.variantName; // `_` for the wildcard; PascalCase otherwise

    // Payload bindings — §18.0.1 supports TWO block-form shapes:
    //   1. PAREN form `<Ready(rows)>` — Phase 2's parser captures the bindings
    //      in `payloadBindingsRaw` (comma-joined raw text). Comma-split here.
    //   2. SPACE form `<Done count>` / `<Conflict field detail>` — POSITIONAL
    //      bareword opener attrs, mirroring the engine state-child shape
    //      (`<Error msg>`). The bindings land in `entry.attrs` as bareword
    //      (empty-value) attrs. (Gap 2, payload-binding-gaps-2026-06-11 / S184 —
    //      before this, the space form bound nothing: the arm render/wire fns
    //      took no payload param and the body referenced a FREE variable
    //      `count` -> runtime ReferenceError. The typer mirrors this same
    //      extraction so the two stages agree on the bound names.)
    // Reserved arm attrs (`rule`/`effect`) are NEVER bindings (they drive
    // W-MATCH-RULE-INERT / E-MATCH-EFFECT-FORBIDDEN). Skipped for the wildcard
    // arm (no variant -> no payload). Order is positional (paren first, then
    // bareword attrs in opener order) to align with the variant field order.
    const MATCH_ARM_RESERVED_ATTRS = new Set<string>(["rule", "effect"]);
    const payloadBindings: string[] = [];
    if (!entry.isWildcard) {
      if (entry.payloadBindingsRaw) {
        for (const part of entry.payloadBindingsRaw.split(",")) {
          const name = part.trim();
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
            payloadBindings.push(name);
          }
        }
      }
      if (Array.isArray(entry.attrs)) {
        for (const attr of entry.attrs) {
          const name = attr && typeof attr.name === "string" ? attr.name : "";
          if (!name || MATCH_ARM_RESERVED_ATTRS.has(name)) continue;
          // Only bareword (empty-value) attrs are positional payload bindings;
          // a `name=value` attr is a user attribute, not a binding.
          if (attr.valueRaw && attr.valueRaw.length > 0) continue;
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !payloadBindings.includes(name)) {
            payloadBindings.push(name);
          }
        }
      }
    }

    // Body: shape varies by Phase 2 bodyForm classification.
    //
    //   - self-closing      → empty arm (render fn returns "")
    //   - bare-body         → re-parse bodyRaw via BS+TAB as markup fragment
    //                         (Phase 3 path — works for full markup like
    //                         `<p>Idle</p>` + `${@count}` interpolation +
    //                         nested tags + event handlers)
    //   - shorthand (`:expr`) → parse bodyRaw as EXPRESSION via parseExprToNode,
    //                         synthesize a `logic > bare-expr` AST node
    //                         (Phase 4 — S108 add). The expression flows
    //                         through generateHtml's logic-node case which
    //                         either folds inline (constants per Bug 5 P3
    //                         §7.4.2) or emits placeholder + binding (cells /
    //                         non-foldable expressions).
    //
    // The shorthand path is the v1 adopter-visible gap that S108 Phase 4
    // closes — pre-Phase-4 the bodyRaw flowed through the bare-body re-parse
    // path, producing literal-text nodes including quotes (e.g., `"Press to
    // load"` rendered as `"Press to load"` with the quotes). The expression-
    // parser path resolves bare identifiers, literals, member access,
    // function calls — anything `${expr}` accepts inside markup.
    let body: any[] = [];

    // g-formfor-in-match-arm (S177) — when the arm body hosted a `<formFor>` or
    // a user-component USE-SITE, the markup-expansion passes (CE + the
    // type-system formFor walker) have already expanded it IN PLACE inside the
    // ast-builder-built `matchBlock.armBodyChildren` wrapper for this variant
    // (mirrors the engine state-child `bodyChildren` path). Consume that
    // EXPANDED wrapper body — re-parsing `entry.bodyRaw` here would re-introduce
    // the RAW `<formFor>` / `<Badge>` tag (silent non-render; for an empty
    // `onsubmit=${}` also invalid JS). Gate: bare-body arm, an armBodyChildren
    // wrapper exists for this variant, AND the raw body actually contained a
    // formFor or a (PascalCase) component opener — so plain arms + the
    // each-in-arm path (which needs codegen's each-block id-restamping below)
    // keep the existing `armsRaw` re-parse. `<each>` bodies stay on the
    // re-parse path even when they also carry a formFor/component (rare) so the
    // each id-restamping is not lost; such a combination is not in the v1
    // adopter surface and degrades to the prior (each-correct) behavior.
    let consumedExpandedArmBody = false;
    if (
      entry.bodyForm === "bare-body" &&
      entry.bodyRaw &&
      Array.isArray((matchBlock as any).armBodyChildren) &&
      !/<\s*each\b/.test(entry.bodyRaw) &&
      (/<\s*(?:formFor|tableFor)\b/i.test(entry.bodyRaw) || /<\s*[A-Z][A-Za-z0-9_]*[\s/>]/.test(entry.bodyRaw))
    ) {
      const wrapper = ((matchBlock as any).armBodyChildren as any[]).find(
        (w) => w && w.kind === "markup" && w.tag === entry.variantName,
      );
      if (wrapper && Array.isArray(wrapper.children) && wrapper.children.length > 0) {
        // Raw `<formFor>` / un-expanded component would still be present if
        // expansion did NOT run (e.g. CE short-circuited) — only consume the
        // wrapper when expansion actually landed (no residual user-component
        // markup; formFor lowered to a `<form data-scrml-formfor>` element).
        body = wrapper.children;
        consumedExpandedArmBody = true;
      }
    }

    if (consumedExpandedArmBody) {
      // body already set from the expanded armBodyChildren wrapper.
    } else if (entry.bodyForm === "shorthand" && entry.bodyRaw && entry.bodyRaw.trim().length > 0) {
      const trimmed = entry.bodyRaw.trim();
      // S138 Bug 53 — markup-as-value `:`-shorthand body (e.g., `<Idle> : <p>Idle</p>`)
      // routes through the bare-body markup parser instead of parseExprToNode.
      // parseExprToNode treats markup tokens (`<p>`, `</p>`) as JS-expression
      // input — acorn rejects them, the EscapeHatchExpr falls through to
      // emitEscapeHatch's verbatim emit, and `generateHtml > bare-expr`
      // ultimately produces `el.textContent = <p>Idle</p>;` — invalid JS.
      // SPEC §4.18 / §1.4 markup-as-value pillar says markup is a first-class
      // value; the `:`-shorthand body's single-expression discipline admits
      // markup as one of those values. Detection: trimmed body starts with
      // `<` followed by a tag-name char (letter / `_`) — distinguishes from
      // less-than comparison (which has `<` followed by space / digit /
      // identifier-starting-with-`@`).
      const looksLikeMarkupStart = /^<[A-Za-z_]/.test(trimmed);
      if (looksLikeMarkupStart) {
        // Route through bare-body markup parser. Same shape as the bare-body
        // arm-body branch below.
        try {
          const synthLabel = `<match:${matchBlock.id}:${tag}>`;
          const synthResult = nativeParseFile(synthLabel, trimmed);
          if (synthResult && Array.isArray(synthResult.ast?.nodes)) {
            body = synthResult.ast.nodes;
          }
        } catch (_e) {
          // Defensive — leave body empty on parse failure.
        }
      } else if (displayTextLiteralInner(trimmed) !== null) {
        // g-shorthand-interp-match-arm-codegen (S196 Bucket 4) — a §4.18.3
        // display-text literal (`"Failed: ${reason}"`). Route its INNER content
        // through the SAME free-text fragment lowering the bare-body form uses,
        // so literal segments HTML-escape (§4.18.6) and `${...}` interpolations
        // wire (§4.18.4) — byte-equivalent to the bare-body `<Variant ...>...</>`
        // form. (Pre-fix parseExprToNode parsed it as a plain JS string literal
        // and emitted `return "Failed: ${reason}"` literally — silent wrong output.)
        const inner = displayTextLiteralInner(trimmed) as string;
        try {
          const synthLabel = `<match:${matchBlock.id}:${tag}>`;
          const synthResult = nativeParseFile(synthLabel, inner);
          if (synthResult && Array.isArray(synthResult.ast?.nodes)) {
            body = synthResult.ast.nodes;
          }
        } catch (_e) {
          // Defensive — leave body empty on parse failure.
        }
      } else {
        try {
          const filePath = (fileAST?.filePath as string | undefined) ?? `<match:${matchBlock.id}:${tag}>`;
          const exprNode = parseExprToNode(entry.bodyRaw, filePath, 0);
          // Synthesize `logic` > `bare-expr` AST node so generateHtml's
          // existing interpolation handling fires unchanged.
          const span = matchBlock.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          body = [{
            kind: "logic",
            body: [{
              kind: "bare-expr",
              exprNode,
              expr: entry.bodyRaw.trim(),
              span,
            }],
            span,
          }];
        } catch (_e) {
          // Defensive — leave body empty on parse failure; SYM PASS 20 surfaces
          // an explicit diagnostic at adopter side.
        }
      }
    } else if (entry.bodyForm !== "self-closing" && entry.bodyRaw && entry.bodyRaw.trim().length > 0) {
      // bare-body: re-parse as markup fragment (Phase 3 path).
      // M6.3 — native-parser route (see import above for rationale).
      try {
        const synthSrc = entry.bodyRaw;
        const synthLabel = `<match:${matchBlock.id}:${tag}>`;
        // each-in-block-form-match (S153) — when the arm body contains an
        // `<each>`, route through splitBlocks+buildAST so the each-block
        // transform runs (nativeParseFile yields a generic markup tag="each"
        // that generateHtml renders as literal text + leaks `${@.}`). Cheap
        // pre-check on the raw text gates the heavier re-parse to the each case
        // only — every other arm body keeps the M6.3 native-parser route.
        if (/<\s*each\b/.test(synthSrc)) {
          const bsOutput = splitBlocks(synthLabel, synthSrc);
          const tabResult = buildAST(bsOutput);
          const tabNodes = tabResult?.ast?.nodes;
          if (Array.isArray(tabNodes)) {
            // Re-stamp each-block ids (and any nested each-block ids) to a
            // globally-unique namespace derived from the match-block id + arm
            // tag, so the `each_<id>` mount-attr / render-fn name cannot collide
            // with a file-level each-block. `restampEachBlockIds` mutates in
            // place and returns the each-blocks it found (for fileAST
            // attachment). The bare match.id alone is not enough — multiple
            // arms could each hold an each, so we mix in a per-arm offset.
            const found = restampEachBlockIds(tabNodes, matchBlock.id, tag);
            collectedEachBlocks.push(...found);
            body = tabNodes;
          }
        } else {
          const synthResult = nativeParseFile(synthLabel, synthSrc);
          if (synthResult && Array.isArray(synthResult.ast?.nodes)) {
            body = synthResult.ast.nodes;
          }
        }
      } catch (_e) {
        // Defensive: same recovery shape as the shorthand path.
      }
    }

    // Positional payload field-name resolution — mirror engine-side
    // §51.0.B.1 logic. When variantFields is available, the i-th payload
    // binding's runtime data key is the variant's i-th declared field name
    // (position-determined, not name-determined per SPEC). When unavailable,
    // payloadFieldNames is left undefined so the helper falls back to
    // assuming binding name = field name (legacy heuristic).
    let payloadFieldNames: string[] | undefined;
    if (payloadBindings.length > 0 && variantFields) {
      const declaredFields = variantFields.get(tag);
      if (declaredFields && declaredFields.length >= payloadBindings.length) {
        payloadFieldNames = payloadBindings.map((_, i) => declaredFields[i]);
      }
    }

    // g-each-over-arm-payload-binding-unbound (2026-06-17) — stamp any
    // `<each in=BINDING>` in THIS arm's body whose iterable is one of this
    // arm's payload bindings. The each-block nodes were just restamped + are
    // shared refs (attached to matchBlock.bodyChildren below), so the stamp
    // reaches the node emit-each's collectEachBlocks(fileAST) later finds.
    if (_armCellName && payloadBindings.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { stampArmPayloadEaches } = require("./emit-each.ts") as {
        stampArmPayloadEaches: typeof import("./emit-each.ts").stampArmPayloadEaches;
      };
      stampArmPayloadEaches(body, _armCellName, tag, payloadBindings, payloadFieldNames);
    }
    if (payloadFieldNames) {
      arms.push({ tag, payloadBindings, payloadFieldNames, body });
    } else {
      arms.push({ tag, payloadBindings, body });
    }
  }

  // each-in-block-form-match (S153) — attach the lifted each-block nodes to the
  // match-block's bodyChildren so emit-each's collectEachBlocks(fileAST) walks
  // them and emits each render fn + registry entry. The match-block IS in
  // fileAST and collectEachBlocks recurses into bodyChildren; the SAME node
  // refs render the mount div (generateHtml each-block branch, via arm.body)
  // and the render fn (emit-each), so the `each_<id>` ids line up. Idempotent:
  // we only append refs not already present (memoization makes this run once,
  // but guard anyway). The arm body is NOT an iteration scope, so the each's
  // own `@.` correctly binds to the each's own iter var.
  if (collectedEachBlocks.length > 0) {
    if (!Array.isArray((matchBlock as any).bodyChildren)) {
      (matchBlock as any).bodyChildren = [];
    }
    const bc = (matchBlock as any).bodyChildren as any[];
    for (const eb of collectedEachBlocks) {
      if (!bc.includes(eb)) bc.push(eb);
    }
  }

  // Cache so the second pass (HTML-mount vs client-render) reuses the same
  // each-block node refs + ids.
  (matchBlock as any).__scrmlCachedArms = arms;
  return arms;
}

// ---------------------------------------------------------------------------
// each-in-block-form-match (S153) — id re-stamping for arm-body each-blocks
// ---------------------------------------------------------------------------

/**
 * Re-stamp every `each-block` node's `id` (recursively, including nested
 * each-blocks) under a namespace derived from the enclosing match-block id and
 * arm tag, so the `each_<id>` mount-attr / render-fn name is globally unique
 * and cannot collide with a file-level each-block id (which comes from the
 * ast-builder's per-file counter and could overlap with the arm-fragment's
 * fresh counter). Mutates in place; returns the each-block nodes found (in
 * document order) for fileAST attachment.
 *
 * The id scheme: `matchId * 1_000_000 + armHash * 1000 + localIndex`. matchId
 * is unique per match-block in the file; armHash disambiguates arms within one
 * match; localIndex disambiguates multiple / nested each-blocks within one arm.
 * The 1e6 / 1e3 bases keep the components non-overlapping for realistic node
 * counts (< 1000 each-blocks per arm, < 1000 arms per match).
 */
function restampEachBlockIds(nodes: any[], matchId: number, armTag: string): any[] {
  const found: any[] = [];
  let local = 0;
  let armHash = 0;
  for (let i = 0; i < armTag.length; i++) {
    armHash = (armHash * 31 + armTag.charCodeAt(i)) % 1000;
  }
  const seen = new WeakSet<object>();
  function walk(node: any): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node.kind === "each-block") {
      node.id = matchId * 1_000_000 + armHash * 1000 + local;
      local += 1;
      found.push(node);
    }
    for (const key of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren", "emptyChild"]) {
      const v = node[key];
      if (Array.isArray(v)) walk(v);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(nodes);
  return found;
}

// ---------------------------------------------------------------------------
// Public — emit mount HTML for one match-block (called from emit-html.ts)
// ---------------------------------------------------------------------------

/**
 * Emit the mount slot HTML for a match-block at its source position.
 *
 * Returns:
 *   - `<div data-scrml-match-mount="<idPrefix>"></div>` when the match-
 *     block has at least one non-empty arm body
 *   - `""` (empty string) when ALL arm bodies are empty (tree-shake)
 *   - `null` when the match-block has no bodyChildren OR no resolvable
 *     `on=` (auto-implied with no engine in scope — E-MATCH-ON-REQUIRED
 *     fires upstream; nothing to emit)
 *
 * Per SPEC §18.0.1 the static initial-arm body is NOT seeded in the mount
 * slot at module-init — match-block's dispatcher fires at DOMContentLoaded
 * with the current cell value (Shape A subscribe) OR via _scrml_effect
 * (Shape B). Either path produces the correct initial HTML at module
 * activation. Contrast engine-decl: engine-decl seeds the initial-variant
 * HTML in the static mount because engines have an explicit `initial=`
 * attribute selecting that variant deterministically at parse time.
 * Match-blocks have no such selector — the current cell value at module
 * load is the runtime authority.
 */
export function emitMatchMountHtml(
  matchBlock: MatchBlockAstNode,
  ctx: CompileContext,
): string | null {
  const arms = buildMatchArms(matchBlock, ctx.fileAST);
  if (!arms) return null;
  if (arms.length === 0) return "";
  const allEmpty = arms.every((a) => !a.body || a.body.length === 0);
  if (allEmpty) return "";

  const onResolved = resolveOnExpr(matchBlock, ctx.fileAST);
  if (!onResolved) return null;

  const idPrefix = `match_${matchBlock.id}`;
  return `<div data-scrml-match-mount="${idPrefix}"></div>`;
}

// ---------------------------------------------------------------------------
// Public — emit render functions + dispatchers for every match-block in file
// ---------------------------------------------------------------------------

/**
 * Walk the file AST, collect all match-blocks, emit per-arm render fns +
 * variant-guarded dispatcher for each. Returns `{ renderFunctions: [],
 * dispatchers: [] }` when the file has no match-blocks OR when all match-
 * blocks have empty arm bodies (tree-shake).
 *
 * Adjacent emission to engine body-render in `emit-client.ts`:
 *
 *   ```ts
 *   const c12BodyRender = emitEngineBodyRenderForFile(fileAST, ctx);
 *   const c14BodyRender = emitDerivedEngineBodyRenderForFile(fileAST, ctx);
 *   const matchBodyRender = emitMatchBodyRenderForFile(fileAST, ctx);
 *   const allRenderFns = [
 *     ...c12BodyRender.renderFunctions,
 *     ...c14BodyRender.renderFunctions,
 *     ...matchBodyRender.renderFunctions,
 *   ];
 *   const allDispatchers = [
 *     ...c12BodyRender.dispatchers,
 *     ...c14BodyRender.dispatchers,
 *     ...matchBodyRender.dispatchers,
 *   ];
 *   ```
 */
export function emitMatchBodyRenderForFile(
  fileAST: any,
  ctx: CompileContext,
): { renderFunctions: string[]; dispatchers: string[] } {
  const matchBlocks = collectMatchBlocks(fileAST);
  const renderFunctions: string[] = [];
  const dispatchers: string[] = [];
  if (matchBlocks.length === 0) return { renderFunctions, dispatchers };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitVariantGuardedRender } = require("./emit-variant-guard.ts") as {
    emitVariantGuardedRender: typeof import("./emit-variant-guard.ts").emitVariantGuardedRender;
  };

  for (const matchBlock of matchBlocks) {
    const arms = buildMatchArms(matchBlock, fileAST);
    if (!arms || arms.length === 0) continue;
    const allEmpty = arms.every((a) => !a.body || a.body.length === 0);
    if (allEmpty) continue;

    const onResolved = resolveOnExpr(matchBlock, fileAST);
    if (!onResolved) continue;

    const idPrefix = `match_${matchBlock.id}`;
    // S109 Phase 5 — when a wildcard `<_>` arm is present (tag `_`), pass
    // `defaultArmTag: "_"` so the helper renders it as the dispatcher's
    // catch-all `else` branch. When absent, `defaultArmTag` stays undefined
    // and the helper emits no default branch (pre-S109 behavior).
    const hasWildcard = arms.some((a) => a.tag === "_");
    // R28-1b (S143) — block-form `<match>` that is a child of `<each>`. The
    // walker stamped `enclosingEachIterVar` (the each's iter var, e.g.
    // "article") on this match-block. In that case the match has ONE instance
    // PER ITEM and its discriminant (`@.status` → `<iterVar>.status`) is only
    // defined in the each per-item factory scope. Emit the dispatch fn in
    // item-scoped mode: it takes the per-item mount element as a parameter and
    // self-triggers NOTHING — emit-each.ts wires the per-item call inside the
    // factory (where the iter var IS defined). Without this, the module-scope
    // dispatcher fires `_scrml_effect(() => dispatch(article.status))` at top
    // level where `article` is undefined (the R28-1b defect).
    const isInEach =
      typeof (matchBlock as MatchBlockAstNode).enclosingEachIterVar === "string" &&
      ((matchBlock as MatchBlockAstNode).enclosingEachIterVar as string).length > 0;
    const out = emitVariantGuardedRender(
      () => onResolved.variantExprAccessor,
      arms,
      ctx,
      {
        idPrefix,
        mountAttr: "data-scrml-match-mount",
        renderFnPrefix: "_scrml_match",
        // Shape A (subscribe) when on= is a bare cell ref or auto-implied
        // engine var; Shape B (effect) when on= is a complex expression.
        // The helper's DOMContentLoaded initial-fire bridges Shape A's
        // "subscribe doesn't fire at init" gap.
        variantSubscribeName: onResolved.variantSubscribeName,
        // GITI-031 (2026-06-23) -- when on= is a member-access (`@cell.state`)
        // the subscribe path fires the callback with the WHOLE cell value, so
        // the dispatch + DOMContentLoaded-init paths apply this sub-path to
        // reach the enum-variant discriminant. Empty for a bare `@cell` ref.
        ...(onResolved.subscribeSubPath ? { subscribeSubPath: onResolved.subscribeSubPath } : {}),
        ...(hasWildcard ? { defaultArmTag: "_" } : {}),
        ...(isInEach ? { itemScopedDispatch: true } : {}),
      },
    );
    if (out.renderFunctionsJs) renderFunctions.push(out.renderFunctionsJs);
    if (out.dispatcherJs) dispatchers.push(out.dispatcherJs);
  }

  return { renderFunctions, dispatchers };
}
