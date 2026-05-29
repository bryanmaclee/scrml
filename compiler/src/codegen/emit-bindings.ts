import { genVar } from "./var-counter.ts";
import { emitStringFromTree, parseExprToNode } from "../expression-parser.ts";
import { emitExprField } from "./emit-expr.ts";
import type { ExprNode } from "../types/ast.ts";
import { collectMarkupNodes } from "./collect.ts";
import { getNodes } from "./collect.ts";
import { rewriteTemplateAttrValue, rewriteReactiveRefs } from "./rewrite.js";
import type { EncodingContext } from "./type-encoding.ts";
import type { CompileContext } from "./context.ts";
import { parsePredicateAnnotation, predicateToJsExpr, deriveHtmlAttrs } from "./emit-predicates.ts";

/** A loosely-typed AST node from the pipeline. */
type ASTNode = Record<string, unknown>;

/** An attribute value node. */
interface AttrValue {
  kind: string;
  name?: string;
  value?: string;
  raw?: string;      // expr kind: raw expression string (e.g. "(@tool === \"select\")")
  refs?: string[];   // expr kind: reactive variable names referenced in the expression
  exprNode?: unknown; // expr kind: pre-parsed ExprNode when the parser attached one (variant-aware lowering)
  [key: string]: unknown;
}

/** An attribute node on a markup element. */
interface Attr {
  name: string;
  value?: AttrValue;
  _bindId?: string;
  _tplId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// buildEnumVarMap
// ---------------------------------------------------------------------------

/**
 * Build a map from reactive variable name → enum type name by:
 *   1. Collecting all enum type declarations from fileAST.typeDecls.
 *   2. Building a set of all known variant names per enum type.
 *   3. Walking all logic block bodies to find state-decl nodes.
 *   4. For each state-decl, checking if the init expression matches a known
 *      enum variant (handles `.Light`, `::Light`, and bare `Light`).
 *
 * This enables bind:value on <select> to auto-coerce via the generated
 * `<EnumTypeName>_toEnum` lookup table (§14.4.1).
 *
 * @param fileAST — the file AST (raw or TypedFileAST)
 * @returns Map<varName, enumTypeName>
 */
function buildEnumVarMap(fileAST: any): Map<string, string> {
  const result = new Map<string, string>();

  // Step 1: build a map from variant name → enum type name from typeDecls
  const typeDecls: any[] = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [];
  const variantToEnum = new Map<string, string>();

  for (const decl of typeDecls) {
    if (!decl || decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;
    const typeName: string = decl.name ?? "";
    if (!typeName) continue;

    // Collect variant names from structured variants array or fall back to raw parse
    const variants = collectEnumVariantNames(decl);
    for (const v of variants) {
      // Only map the first enum that defines a given variant name (no ambiguity for common names)
      if (!variantToEnum.has(v)) {
        variantToEnum.set(v, typeName);
      }
    }
  }

  if (variantToEnum.size === 0) return result;

  // Step 2: walk all nodes in the file to find state-decl nodes inside logic blocks
  const topNodes: any[] = fileAST.nodes ?? (fileAST.ast ? fileAST.ast.nodes : []);
  walkForReactiveDecls(topNodes, variantToEnum, result);

  return result;
}

/**
 * Recursively walk nodes, descend into logic block bodies, and collect
 * state-decl nodes whose init expression matches a known enum variant.
 */
function walkForReactiveDecls(
  nodes: any[],
  variantToEnum: Map<string, string>,
  result: Map<string, string>,
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    if (node.kind === "logic" && Array.isArray(node.body)) {
      for (const stmt of node.body) {
        if (!stmt || typeof stmt !== "object") continue;
        // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
        if (stmt.kind === "state-decl") {
          const varName: string = stmt.name ?? "";
          // Phase 4d: ExprNode-first, string fallback
          const init: string = (stmt as any).initExpr ? emitStringFromTree((stmt as any).initExpr).trim() : (typeof stmt.init === "string" ? stmt.init.trim() : "");
          if (!varName || !init) continue;
          // Match init to a known enum variant:
          //   ".Light"    → "Light"
          //   "::Light"   → "Light"
          //   "Light"     → "Light"  (bare PascalCase — only match if it's a known variant)
          const stripped = init.replace(/^::/, "").replace(/^\./, "");
          const enumTypeName = variantToEnum.get(stripped);
          if (enumTypeName) {
            result.set(varName, enumTypeName);
          }
        }
      }
    }

    // Descend into children (markup elements can contain logic blocks)
    if (Array.isArray(node.children)) {
      walkForReactiveDecls(node.children, variantToEnum, result);
    }
  }
}

/**
 * Extract all variant names from an enum type declaration.
 * Uses structured variants array when present, falls back to raw parse.
 */
function collectEnumVariantNames(decl: any): string[] {
  if (Array.isArray(decl.variants)) {
    return decl.variants
      .map((v: any) => v.name ?? "")
      .filter((name: string) => typeof name === "string" && /^[A-Z]/.test(name));
  }

  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return [];

  const names: string[] = [];
  for (const part of body.split(/[\n,|]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Strip leading :: or . (enum variant prefix forms)
    const clean = trimmed.replace(/^::/, "").replace(/^\./, "");
    // For payload variants like Found(id: number), extract just the name
    const name = clean.split(/[\s(]/)[0];
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Build a map from reactive variable name → { typeAnnotation, tag } by walking
 * logic block bodies and finding state-decl nodes.
 * Used to detect predicated types for bind:value runtime validation (§53.7.2).
 *
 * Exported (C16) for emit-html.ts to derive HTML validation attrs (§53.7.1).
 */
export function buildReactiveTypeMap(fileAST: any): Map<string, string> {
  const result = new Map<string, string>();
  const topNodes: any[] = fileAST.nodes ?? (fileAST.ast ? fileAST.ast.nodes : []);
  walkForReactiveTypes(topNodes, result);
  return result;
}

function walkForReactiveTypes(nodes: any[], result: Map<string, string>): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "logic" && Array.isArray(node.body)) {
      for (const stmt of node.body) {
        if (!stmt) continue;
        if ((stmt.kind === "state-decl") && stmt.name && stmt.typeAnnotation) {
          result.set(stmt.name, stmt.typeAnnotation as string);
        }
      }
    }
    if (Array.isArray(node.children)) {
      walkForReactiveTypes(node.children, result);
    }
  }
}

// ---------------------------------------------------------------------------
// A1c C4 — bind dispatch by render-spec (SPEC §5.4.1, L17)
// ---------------------------------------------------------------------------

/** The bind flavour selected for a given render-spec element shape. */
interface BindDispatch {
  /** `bind:value` | `bind:checked` | `bind:files` | `bind:group` */
  flavour: "value" | "checked" | "files" | "group";
  /** DOM event the listener subscribes to (`input` for text-shape, `change` for the rest). */
  inputEvent: "input" | "change";
  /** True for `<input type="number"/>` and `<input type="range"/>` — apply Number() coercion on write. */
  isNumeric: boolean;
}

// ---------------------------------------------------------------------------
// A1c C8 — per-field `touched` synth event-listener wiring (§55.7).
//
// When a bind:* directive points at a COMPOUND CHILD (dotted path like
// `signup.email`), the corresponding per-field `touched` cell — registered by
// emit-synth-surface.ts at compound-emit time — should be set to `true` on the
// FIRST user interaction with the element. Per §55.7 lines 25148-25152, the
// most-permissive trigger is chosen so the surface "feels right":
//   - `bind:value` change (input event for text/textarea, change for select)
//   - `bind:checked` change (change event for checkbox)
//   - first focus-out (focusout event, fires regardless of value change)
//
// Once `touched=true`, never reverts (until `reset(@compound)`).
//
// **Trigger predicate:** the bound path has a dot (compound.field). Top-level
// cells (no dot) have NO per-field synth surface per §55.5 L11 Edge A —
// `touched` is meaningless there.
//
// **Idempotency:** the listener is wired once per use site; multiple use
// sites for the same field each get their own listener (and each fires on
// its own element's interaction). Internal guard avoids redundant
// reactive-set when already true.
//
// Cross-references:
//   - SPEC §55.6 (per-field `touched` is one of the three per-field synths)
//   - SPEC §55.7 (event timing — input/change OR first focus-out)
//   - emit-synth-surface.ts (registers the `<compound>.<field>.touched` cell
//     with init `false` and `_scrml_init_set` for reset support)
// ---------------------------------------------------------------------------

/**
 * Append per-field `touched` event-listener emission to `lines` for a single
 * bound element. The emission is wrapped in an idempotency guard so repeated
 * input/change events don't trigger redundant reactive-sets.
 *
 * Skips entirely when the path has no dot (top-level cell — no per-field
 * surface per §55.5 L11 Edge A).
 *
 * @param lines — accumulator the caller is writing into; emission appends
 * @param bVarRaw — the bound path string (e.g. "form.email", "outer.inner.leaf")
 * @param elemVar — the JS variable name holding the DOM element (caller's local)
 * @param inputEvent — the bind dispatch's input/change event
 * @param encodingCtx — encoding context for storage-key encoding (mirrors C5/C7)
 */
function _emitTouchedListenerLines(
  lines: string[],
  bVarRaw: string,
  elemVar: string,
  inputEvent: "input" | "change",
  encodingCtx: EncodingContext | null | undefined,
): void {
  // Skip top-level cells (no per-field synth surface).
  if (bVarRaw.indexOf(".") === -1) return;
  const touchedKey = encodingCtx ? encodingCtx.encode(`${bVarRaw}.touched`) : `${bVarRaw}.touched`;
  lines.push(`    // C8: per-field touched event wiring (§55.7)`);
  lines.push(`    ${elemVar}.addEventListener(${JSON.stringify(inputEvent)}, () => {`);
  lines.push(`      if (_scrml_reactive_get(${JSON.stringify(touchedKey)}) !== true) {`);
  lines.push(`        _scrml_reactive_set(${JSON.stringify(touchedKey)}, true);`);
  lines.push(`      }`);
  lines.push(`    });`);
  lines.push(`    ${elemVar}.addEventListener("focusout", () => {`);
  lines.push(`      if (_scrml_reactive_get(${JSON.stringify(touchedKey)}) !== true) {`);
  lines.push(`        _scrml_reactive_set(${JSON.stringify(touchedKey)}, true);`);
  lines.push(`      }`);
  lines.push(`    });`);
}

/**
 * Map a render-spec (tag + attributes) to the bind:* flavour per SPEC §5.4.1.
 *
 * - `<input type="checkbox"/>` → bind:checked / "change"
 * - `<input type="file"/>`     → bind:files   / "change"
 * - `<input type="radio"/>`    → bind:group   / "change"
 * - `<input type="number"/>` or `<input type="range"/>` → bind:value / "input" + numeric coercion
 * - any other `<input>` (text, email, url, password, tel, search, date, time, datetime-local,
 *   color, hidden, …)             → bind:value / "input"
 * - `<textarea/>`                  → bind:value / "input"
 * - `<select>...</>`               → bind:value / "change"
 * - other (defensive fallback; should not arise — B6/C3 already gate non-bindable shapes)
 *                                  → bind:value / "input"
 *
 * Pure function. The caller refines the write-back expression for enum-typed cells
 * (auto-coerce via `<EnumName>_toEnum[...]`) when `tag === "select"`.
 */
function dispatchByRenderSpec(tag: string, attrs: any[]): BindDispatch {
  const typeAttr = ((attrs ?? []).find(
    (a: any) => a && a.name === "type",
  )?.value?.value ?? "") as string;
  if (tag === "input") {
    if (typeAttr === "checkbox") return { flavour: "checked", inputEvent: "change", isNumeric: false };
    if (typeAttr === "file")     return { flavour: "files",   inputEvent: "change", isNumeric: false };
    if (typeAttr === "radio")    return { flavour: "group",   inputEvent: "change", isNumeric: false };
    const isNumeric = typeAttr === "number" || typeAttr === "range";
    return { flavour: "value", inputEvent: "input", isNumeric };
  }
  if (tag === "textarea") return { flavour: "value", inputEvent: "input",  isNumeric: false };
  if (tag === "select")   return { flavour: "value", inputEvent: "change", isNumeric: false };
  // Defensive fallback. B6 (E-CELL-RENDER-SPEC-NOT-BINDABLE) blocks non-bindable shapes
  // at A1b time, and C3 only stamps render-by-tag bindings for `_cellKind === "bindable"`,
  // so this branch is unreachable in well-formed compilations.
  return { flavour: "value", inputEvent: "input", isNumeric: false };
}

/**
 * Emit ref= attribute wiring and bind:/class: directive wiring.
 *
 * These connect markup attributes to reactive state via DOM element references.
 * Wiring happens on module load (before DOMContentLoaded is needed for querySelector
 * on attributes that are injected at render time).
 *
 * @param params.fileAST — the file AST to generate wiring for
 * @returns JS lines to append to the client module
 */
export function emitBindings(ctx: CompileContext): string[] {
  const { fileAST, encodingCtx } = ctx;
  const lines: string[] = [];
  // §53.7.2: Build map of reactive variable name → typeAnnotation for predicate checking.
  const reactiveTypeMap = buildReactiveTypeMap(fileAST);

  // -------------------------------------------------------------------------
  // Step 2.5: Generate ref= attribute wiring (DOM element references)
  // -------------------------------------------------------------------------
  const allMarkupNodes = ctx.analysis?.markupNodes ?? collectMarkupNodes(getNodes(fileAST));
  const refMarkupNodes = allMarkupNodes;
  for (const mkNode of refMarkupNodes as ASTNode[]) {
    const nodeAttrs = (mkNode.attributes ?? mkNode.attrs ?? []) as Attr[];
    for (const rAttr of nodeAttrs) {
      if (!rAttr || rAttr.name !== "ref") continue;
      if (rAttr.value && rAttr.value.kind === "variable-ref") {
        const refVarName = (rAttr.value.name ?? "").replace(/^@/, "");
        const encodedRefName = encodingCtx ? encodingCtx.encode(refVarName) : refVarName;
        lines.push(`// ref=@${refVarName}`);
        lines.push(`_scrml_reactive_set(${JSON.stringify(encodedRefName)}, document.querySelector('[data-scrml-ref="${refVarName}"]'));`);
        lines.push("");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Build enum var map once for this file — used to coerce bind:value on
  // <select> elements when the bound @var is an enum type (§14.4.1 / §5.4).
  // -------------------------------------------------------------------------
  const enumVarMap = buildEnumVarMap(fileAST);

  // -------------------------------------------------------------------------
  // Step 3: Generate bind: directive wiring and class: directives
  // -------------------------------------------------------------------------
  const bindMarkupNodes = allMarkupNodes;
  for (const mkNode of bindMarkupNodes as ASTNode[]) {
    const nodeAttrs = (mkNode.attributes ?? mkNode.attrs ?? []) as Attr[];
    for (const bAttr of nodeAttrs) {
      if (!bAttr || !bAttr.name) continue;

      // bind: directives — two-way binding
      if (bAttr.name.startsWith("bind:") && bAttr.value && bAttr.value.kind === "variable-ref") {
        const bVarRaw = (bAttr.value.name ?? "").replace(/^@/, ""); // e.g. "name" or "form.email"
        const bElemId = genVar(`bind_elem_${(mkNode.tag as string) ?? "el"}`);
        const bindDataAttr = `data-scrml-${bAttr.name.replace(":", "-")}`;
        const bindSelector = bAttr._bindId
          ? `[${bindDataAttr}="${bAttr._bindId}"]`
          : `[${bindDataAttr}]`;

        // Decompose dotted path: "form.email.field" → rootKey="form", pathSegs=["email","field"]
        //
        // Bug 58 (S140): `_flatBindKey` (set by formFor's synth bind) forces the
        // ENTIRE dotted name to be treated as a single flat storage key. The §55
        // validity surface stores per-field state under the dotted key
        // ("signup.name") with the compound parent ("signup") as a DERIVED proxy
        // reading those flat cells. A deep-set on the derived parent is a no-op,
        // so the write MUST target "signup.name" directly. With the flag,
        // isPath=false and rootKey is the full name → direct read/write.
        const _flatBindKey = (bAttr.value as { _flatBindKey?: boolean })._flatBindKey === true;
        const dotIndex = bVarRaw.indexOf(".");
        const isPath = _flatBindKey ? false : dotIndex !== -1;
        const rootKey = isPath ? bVarRaw.slice(0, dotIndex) : bVarRaw;
        const pathSegs = isPath ? bVarRaw.slice(dotIndex + 1).split(".") : [];

        // Build JS expressions for read, write, and subscribe projection.
        //
        // Simple (@var):
        //   read:    _scrml_reactive_get("var")
        //   write:   _scrml_reactive_set("var", newVal)
        //   proj:    _scrml_v  (the full reactive value)
        //
        // Path (@obj.a.b):
        //   read:    _scrml_reactive_get("obj").a.b
        //   write:   _scrml_reactive_set("obj", _scrml_deep_set(_scrml_reactive_get("obj"), ["a","b"], newVal))
        //   sub key: "obj"  (subscribe to root; project path in callback)
        //   proj:    _scrml_v?.a?.b
        const readExpr = isPath
          ? `_scrml_reactive_get(${JSON.stringify(rootKey)})${pathSegs.map(s => `.${s}`).join("")}`
          : `_scrml_reactive_get(${JSON.stringify(rootKey)})`;

        const writeExpr = (newValExpr: string): string => isPath
          ? `_scrml_reactive_set(${JSON.stringify(rootKey)}, _scrml_deep_set(_scrml_reactive_get(${JSON.stringify(rootKey)}), ${JSON.stringify(pathSegs)}, ${newValExpr}))`
          : `_scrml_reactive_set(${JSON.stringify(rootKey)}, ${newValExpr})`;

        if (bAttr.name === "bind:value") {
          // SPEC §5.4: <select> uses "change" event; all other elements use "input"
          const elementTag = (mkNode.tag as string) ?? "";
          const inputEvent = elementTag === "select" ? "change" : "input";

          // §5.4 / §14.4.1: When the bound @var is enum-typed and the element is a <select>,
          // auto-coerce the string from event.target.value back to the enum variant via the
          // compiler-generated lookup table (e.g. Theme_toEnum[event.target.value]).
          // Falls back to the raw string value if no matching variant (defensive).
          const enumTypeName = elementTag === "select" ? enumVarMap.get(rootKey) : undefined;
          // §5.4: Auto-coerce to number for type="number" and type="range" inputs
          const inputType = (mkNode.attributes ?? mkNode.attrs ?? []).find(
            (a: any) => a && a.name === "type" && a.value?.value
          )?.value?.value ?? "";
          const isNumericInput = inputType === "number" || inputType === "range";
          const writeValue = enumTypeName
            ? `(${enumTypeName}_toEnum[event.target.value] ?? event.target.value)`
            : isNumericInput ? "Number(event.target.value)" : "event.target.value";

          // §53.7.2: Check if bound var has a predicated type — if so, gate the write.
          const _bvTypeAnnotation = reactiveTypeMap.get(rootKey);
          const _bvPredInfo = _bvTypeAnnotation ? parsePredicateAnnotation(_bvTypeAnnotation) : null;

          lines.push(`// bind:value=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.value = ${readExpr};`);
          if (_bvPredInfo) {
            // Emit a guarded event listener: validate before writing (§53.7.2)
            const _bvCheckExpr = predicateToJsExpr(_bvPredInfo.predicate, "event.target.value");
            lines.push(`    ${bElemId}.addEventListener(${JSON.stringify(inputEvent)}, (event) => {`);
            lines.push(`      // §53.7.2 runtime predicate check before reactive assignment`);
            lines.push(`      if (${_bvCheckExpr}) { ${writeExpr(writeValue)}; }`);
            lines.push(`    });`);
          } else {
            lines.push(`    ${bElemId}.addEventListener(${JSON.stringify(inputEvent)}, (event) => ${writeExpr(writeValue)});`);
          }
          lines.push(`    _scrml_effect(() => { ${bElemId}.value = ${readExpr}; });`);
          _emitTouchedListenerLines(lines, bVarRaw, bElemId, inputEvent, encodingCtx);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name === "bind:valueAsNumber") {
          // SPEC §5.4 M-3: bind:valueAsNumber coerces event.target.value to Number.
          const elementTag = (mkNode.tag as string) ?? "";
          const inputEvent = elementTag === "select" ? "change" : "input";
          lines.push(`// bind:valueAsNumber=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.value = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener(${JSON.stringify(inputEvent)}, (event) => ${writeExpr("Number(event.target.value)")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.value = ${readExpr}; });`);
          _emitTouchedListenerLines(lines, bVarRaw, bElemId, inputEvent, encodingCtx);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name === "bind:checked") {
          lines.push(`// bind:checked=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.checked = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.checked")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.checked = ${readExpr}; });`);
          _emitTouchedListenerLines(lines, bVarRaw, bElemId, "change", encodingCtx);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name === "bind:selected") {
          lines.push(`// bind:selected=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.value = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.value")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.value = ${readExpr}; });`);
          _emitTouchedListenerLines(lines, bVarRaw, bElemId, "change", encodingCtx);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name === "bind:files") {
          lines.push(`// bind:files=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.files")});`);
          lines.push(`    _scrml_effect(() => { /* files are read-only from DOM — effect tracks @${bVarRaw} */ ${readExpr}; });`);
          _emitTouchedListenerLines(lines, bVarRaw, bElemId, "change", encodingCtx);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name === "bind:group") {
          lines.push(`// bind:group=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.checked = (${readExpr} === ${bElemId}.value);`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.value")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.checked = (${readExpr} === ${bElemId}.value); });`);
          _emitTouchedListenerLines(lines, bVarRaw, bElemId, "change", encodingCtx);
          lines.push(`  }`);
          lines.push(`}`);
        }
        lines.push("");
      }

      // class: directives — conditional class toggling
      // Supports four RHS forms per §5.5.2 (widened from @variable-only):
      //   1. variable-ref @var:   class:active=@isActive (simple reactive variable)
      //   2. variable-ref obj.p:  class:done=todo.completed (property access; subscribes to root key)
      //   3. expr:                class:active=(@tool === "select") (parenthesized boolean expression)
      //   4. call-ref:            class:active=isComplete() (function call)
      if (bAttr.name.startsWith("class:") && bAttr.value && (
        bAttr.value.kind === "variable-ref" ||
        bAttr.value.kind === "expr" ||
        bAttr.value.kind === "call-ref"
      )) {
        const cClassName = bAttr.name.slice(6); // strip "class:"
        const cElemId = genVar(`class_elem_${(mkNode.tag as string) ?? "el"}`);
        const classDataAttr = `data-scrml-${bAttr.name.replace(":", "-")}`;
        const classSelector = bAttr._bindId
          ? `[${classDataAttr}="${bAttr._bindId}"]`
          : `[${classDataAttr}]`;

        if (bAttr.value.kind === "variable-ref") {
          const rawName = (bAttr.value.name ?? "") as string;
          const isReactive = rawName.startsWith("@");

          if (isReactive) {
            // §5.5.2 form 1: class:active=@isActive — reactive variable
            const cVarName = rawName.replace(/^@/, "");
            lines.push(`// class:${cClassName}=@${cVarName}`);
            lines.push(`{`);
            lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
            lines.push(`  if (${cElemId}) {`);
            lines.push(`    if (_scrml_reactive_get(${JSON.stringify(cVarName)})) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!_scrml_reactive_get(${JSON.stringify(cVarName)})); });`);
            lines.push(`  }`);
            lines.push(`}`);
          } else {
            // §5.5.2 form 2: class:done=todo.completed — property access on a reactive root
            // The tokenizer reads dotted paths as a single ATTR_IDENT, e.g. "todo.completed".
            // Subscribe to the root reactive key; project the path on each update.
            const dotIndex = rawName.indexOf(".");
            const rootKey = dotIndex !== -1 ? rawName.slice(0, dotIndex) : rawName;
            const pathStr = dotIndex !== -1 ? rawName.slice(dotIndex) : ""; // e.g. ".completed"
            const readExpr = pathStr
              ? `_scrml_reactive_get(${JSON.stringify(rootKey)})${pathStr}`
              : `_scrml_reactive_get(${JSON.stringify(rootKey)})`;
            lines.push(`// class:${cClassName}=${rawName}`);
            lines.push(`{`);
            lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
            lines.push(`  if (${cElemId}) {`);
            lines.push(`    if (${readExpr}) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!(${readExpr})); });`);
            lines.push(`  }`);
            lines.push(`}`);
          }
        } else if (bAttr.value.kind === "expr") {
          // §5.5.2 form 3: class:active=(@tool === "select")
          // Lower the directive expression the SAME way `if=` / `${}` do —
          // through the variant-aware ExprNode emitter (`emitExprField`), NOT
          // the raw-string `rewriteReactiveRefs` shortcut. The shortcut only
          // rewrites `@var` → `_scrml_reactive_get("var")` and leaves variant
          // literals (`.Home`, `Step::Info`) + `==`/`!=` RAW, which emits
          // invalid JS for `class:active=(@view == .Home)` (the gate's
          // E-CODEGEN-INVALID-JS). `emitExprField` lowers `.Variant` to its
          // string tag and `==`/`!=` to `_scrml_structural_eq(...)`, matching
          // the `if=` markup path (emit-event-wiring.ts:804). Parse failures
          // fall back to the prior raw-string rewrite (regression-preserving).
          const rawExpr = (bAttr.value.raw ?? "") as string;
          const exprRefs = (bAttr.value.refs ?? []) as string[];
          let exprNode = (bAttr.value.exprNode ?? null) as ExprNode | null;
          if (!exprNode && rawExpr) {
            try {
              exprNode = parseExprToNode(rawExpr, "<class-directive>", 0) as ExprNode | null;
            } catch {
              exprNode = null;
            }
          }
          const rewrittenExpr = emitExprField(exprNode, rawExpr, {
            mode: "client",
            derivedNames: ctx.derivedNames,
            synthCellKeys: ctx.synthCellKeys,
          }) as string;
          lines.push(`// class:${cClassName}=${rawExpr}`);
          lines.push(`{`);
          lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
          lines.push(`  if (${cElemId}) {`);
          lines.push(`    if (${rewrittenExpr}) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
          // Auto-tracking effect handles all reactive dependencies automatically
          if (exprRefs.length > 0) {
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!(${rewrittenExpr})); });`);
          } else {
            lines.push(`    // No reactive refs — class toggled once at mount based on initial expression value`);
          }
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.value.kind === "call-ref") {
          // §5.5.2 form 4: class:active=isComplete() — function call
          // Serialize the call to a JS expression string. Scan args for @var reactive deps.
          const fnName = (bAttr.value.name ?? "") as string;
          const fnArgs = (bAttr.value.args ?? []) as string[];
          const rawArgs = fnArgs.join(", ");
          const callExpr = rawArgs ? `${fnName}(${rawArgs})` : `${fnName}()`;
          // Rewrite any @var references in the call args to _scrml_reactive_get() calls
          const rewrittenCall = rewriteReactiveRefs(callExpr) as string;
          // Collect reactive dep names from raw args (before rewrite)
          const callRefs: string[] = [];
          const refRe = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
          let refMatch: RegExpExecArray | null;
          while ((refMatch = refRe.exec(rawArgs)) !== null) {
            if (!callRefs.includes(refMatch[1])) callRefs.push(refMatch[1]);
          }
          lines.push(`// class:${cClassName}=${callExpr}`);
          lines.push(`{`);
          lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
          lines.push(`  if (${cElemId}) {`);
          lines.push(`    if (${rewrittenCall}) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
          if (callRefs.length > 0) {
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!(${rewrittenCall})); });`);
          } else {
            lines.push(`    // No reactive refs in call args — class toggled once at mount`);
          }
          lines.push(`  }`);
          lines.push(`}`);
        }
        lines.push("");
      }

      // template-attr: dynamic attribute from template literal interpolation
      // Detected by _tplId marker set on the attr by emit-html.js.
      // Example: class="item-${@status}" → setAttribute("class", `item-${...}`)
      if (
        bAttr.value &&
        bAttr.value.kind === "string-literal" &&
        bAttr._tplId
      ) {
        const attrName = bAttr.name;
        const rawValue = (bAttr.value.value ?? "") as string;
        const tplSelector = `[data-scrml-attr-tpl-${attrName}="${bAttr._tplId}"]`;
        const tplElemId = genVar(`tpl_elem_${(mkNode.tag as string) ?? "el"}`);

        // Rewrite the template literal value: @var → _scrml_reactive_get("var")
        const { jsExpr, reactiveVars } = rewriteTemplateAttrValue(rawValue) as {
          jsExpr: string;
          reactiveVars: Set<string>;
        };

        lines.push(`// template-attr ${attrName}="${rawValue}"`);
        lines.push(`{`);
        lines.push(`  const ${tplElemId} = document.querySelector('${tplSelector}');`);
        lines.push(`  if (${tplElemId}) {`);
        lines.push(`    ${tplElemId}.setAttribute(${JSON.stringify(attrName)}, ${jsExpr});`);
        // Auto-tracking effect handles all reactive dependencies automatically
        if (reactiveVars.size > 0) {
          lines.push(`    _scrml_effect(() => { ${tplElemId}.setAttribute(${JSON.stringify(attrName)}, ${jsExpr}); });`);
        }
        lines.push(`  }`);
        lines.push(`}`);
        lines.push("");
      }
    }
  }

  // -------------------------------------------------------------------------
  // A1c C4 — render-by-tag bind dispatch (SPEC §5.4.1, L17, Wave 1 closer).
  //
  // C3 stamped a `data-scrml-render-by-tag="<placeholderId>"` attribute on
  // each rendered element when expanding a Shape 2 bindable cell at a
  // `<cellName/>` use site, and recorded a LogicBinding with
  // `kind === "render-by-tag"` carrying the cellName, renderSpecTag, and
  // renderSpecAttrs. C4 walks those bindings and emits the bind:* wiring
  // dispatched by render-spec element type per §5.4.1's table.
  //
  // Reuse: enumVarMap (built above) covers <select>+enum coercion;
  // reactiveTypeMap covers §53.7.2 predicate-gated writes for refinement-
  // typed cells; the wiring shapes mirror the source-level bind:* dispatch
  // above (lines ~269-362) — same `_scrml_reactive_get` / `_scrml_reactive_set`
  // / `_scrml_effect` runtime API.
  //
  // Multi-render correctness (L16): if a cell appears at multiple use sites,
  // C3 records ONE binding per site (each with its own placeholderId). Each
  // binding emits its own JS block; both DOM elements update reactively when
  // the underlying cell is written.
  // -------------------------------------------------------------------------
  const renderByTagBindings = ((ctx as any).registry?.logicBindings ?? [])
    .filter((b: any) => b && b.kind === "render-by-tag");

  for (const binding of renderByTagBindings as any[]) {
    const cellName: string = binding.cellName ?? "";
    const placeholderId: string = binding.placeholderId ?? "";
    const renderSpecTag: string = binding.renderSpecTag ?? "";
    const renderSpecAttrs: any[] = binding.renderSpecAttrs ?? [];
    if (!cellName || !placeholderId || !renderSpecTag) continue;

    const dispatch = dispatchByRenderSpec(renderSpecTag, renderSpecAttrs);
    const selector = `[data-scrml-render-by-tag="${placeholderId}"]`;
    const elemId = genVar(`render_by_tag_elem_${renderSpecTag}`);

    const readExpr = `_scrml_reactive_get(${JSON.stringify(cellName)})`;
    const writeExpr = (val: string): string =>
      `_scrml_reactive_set(${JSON.stringify(cellName)}, ${val})`;

    // §53.7.2 predicate gating — only meaningful for bind:value writes (the
    // checked/files/group flavours produce DOM-typed values that don't carry
    // refinement constraints in v0.next). Mirrors the source-level path.
    const typeAnnotation = reactiveTypeMap.get(cellName);
    const predInfo = typeAnnotation ? parsePredicateAnnotation(typeAnnotation) : null;

    // §5.4 / §14.4.1 enum coercion for <select> + enum-typed cell.
    const enumTypeName = renderSpecTag === "select" ? enumVarMap.get(cellName) : undefined;

    // Build the write-back expression per dispatch flavour.
    let writeValueExpr: string;
    switch (dispatch.flavour) {
      case "value":
        if (enumTypeName) {
          writeValueExpr = `(${enumTypeName}_toEnum[event.target.value] ?? event.target.value)`;
        } else if (dispatch.isNumeric) {
          writeValueExpr = "Number(event.target.value)";
        } else {
          writeValueExpr = "event.target.value";
        }
        break;
      case "checked":
        writeValueExpr = "event.target.checked";
        break;
      case "files":
        writeValueExpr = "event.target.files";
        break;
      case "group":
        writeValueExpr = "event.target.value";
        break;
    }

    lines.push(
      `// render-by-tag bind:${dispatch.flavour}=@${cellName} (cell=${cellName}, tag=${renderSpecTag})`,
    );
    lines.push(`{`);
    lines.push(`  const ${elemId} = document.querySelector('${selector}');`);
    lines.push(`  if (${elemId}) {`);

    // Initial DOM read — synchronise the rendered element with the cell's
    // current value at mount time. Files have no programmatic write path
    // (DOM-readonly), so we skip the initial DOM-write but keep the
    // tracking effect (per source-level bind:files convention).
    if (dispatch.flavour === "value") {
      lines.push(`    ${elemId}.value = ${readExpr};`);
    } else if (dispatch.flavour === "checked") {
      lines.push(`    ${elemId}.checked = ${readExpr};`);
    } else if (dispatch.flavour === "group") {
      lines.push(`    ${elemId}.checked = (${readExpr} === ${elemId}.value);`);
    }

    // Event listener — write back to the cell. Predicate-gate when the
    // cell is refinement-typed (§53.7.2; only for bind:value).
    if (predInfo && dispatch.flavour === "value") {
      const checkExpr = predicateToJsExpr(predInfo.predicate, "event.target.value");
      lines.push(
        `    ${elemId}.addEventListener(${JSON.stringify(dispatch.inputEvent)}, (event) => {`,
      );
      lines.push(`      // §53.7.2 runtime predicate check before reactive assignment`);
      lines.push(`      if (${checkExpr}) { ${writeExpr(writeValueExpr)}; }`);
      lines.push(`    });`);
    } else {
      lines.push(
        `    ${elemId}.addEventListener(${JSON.stringify(dispatch.inputEvent)}, (event) => ${writeExpr(writeValueExpr)});`,
      );
    }

    // Reactive effect — keep the DOM element in sync when the cell is
    // written from anywhere (including programmatic writes from logic).
    if (dispatch.flavour === "value") {
      lines.push(`    _scrml_effect(() => { ${elemId}.value = ${readExpr}; });`);
    } else if (dispatch.flavour === "checked") {
      lines.push(`    _scrml_effect(() => { ${elemId}.checked = ${readExpr}; });`);
    } else if (dispatch.flavour === "group") {
      lines.push(
        `    _scrml_effect(() => { ${elemId}.checked = (${readExpr} === ${elemId}.value); });`,
      );
    } else if (dispatch.flavour === "files") {
      lines.push(
        `    _scrml_effect(() => { /* files are read-only from DOM — effect tracks @${cellName} */ ${readExpr}; });`,
      );
    }

    // C8: per-field touched event wiring (§55.7). Only fires for compound-
    // child paths (cellName contains a dot). Top-level cells have no
    // per-field surface per §55.5 L11 Edge A.
    _emitTouchedListenerLines(lines, cellName, elemId, dispatch.inputEvent, encodingCtx);

    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
  }

  return lines;
}
