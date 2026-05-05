import { genVar } from "./var-counter.ts";
import { emitStringFromTree } from "../expression-parser.ts";
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
 *   3. Walking all logic block bodies to find reactive-decl nodes.
 *   4. For each reactive-decl, checking if the init expression matches a known
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

  // Step 2: walk all nodes in the file to find reactive-decl nodes inside logic blocks
  const topNodes: any[] = fileAST.nodes ?? (fileAST.ast ? fileAST.ast.nodes : []);
  walkForReactiveDecls(topNodes, variantToEnum, result);

  return result;
}

/**
 * Recursively walk nodes, descend into logic block bodies, and collect
 * reactive-decl nodes whose init expression matches a known enum variant.
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
        if (stmt.kind === "state-decl" || stmt.kind === "reactive-derived-decl") {
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
 * logic block bodies and finding reactive-decl nodes.
 * Used to detect predicated types for bind:value runtime validation (§53.7.2).
 */
function buildReactiveTypeMap(fileAST: any): Map<string, string> {
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
        const dotIndex = bVarRaw.indexOf(".");
        const isPath = dotIndex !== -1;
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
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name === "bind:files") {
          lines.push(`// bind:files=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.files")});`);
          lines.push(`    _scrml_effect(() => { /* files are read-only from DOM — effect tracks @${bVarRaw} */ ${readExpr}; });`);
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
          // Rewrite @var references to _scrml_reactive_get("var") calls.
          // Subscribe to each reactive variable referenced in the expression.
          const rawExpr = (bAttr.value.raw ?? "") as string;
          const exprRefs = (bAttr.value.refs ?? []) as string[];
          const rewrittenExpr = rewriteReactiveRefs(rawExpr) as string;
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

  return lines;
}
