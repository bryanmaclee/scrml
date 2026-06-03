import { emitExprField } from "./emit-expr.ts";
import { rewriteExprArrowBody } from "./rewrite.js";
import { emitStringFromTree } from "../expression-parser.ts";
import { emitLogicNode } from "./emit-logic.js";
import { genVar } from "./var-counter.ts";
import { VOID_ELEMENTS } from "./utils.ts";
import { iterableHasReactiveRefs } from "./reactive-deps.ts";
import { isDestructurePattern, emitDestructurePatternText } from "./emit-destructure-pattern.ts";
import { detectPredicateShapeBind } from "./predicate-bind-detector.js";

// ---------------------------------------------------------------------------
// Bug 65 (S157) — Tier-0 `${for…lift}` engine-transition handler lowering.
//
// SIBLING of Bug 62 (the Tier-1 `<each>` fix in emit-each.ts). A lifted event
// handler that calls `@engine.advance(.X)` or assigns `@engine = .X` used to be
// lowered through `emitExprField` with NO engine codegen ctx, so the call
// resolved against the bare reactive cell:
//   `_scrml_reactive_get("phase").advance("Active")`
// `_scrml_reactive_get("phase")` returns the engine's bare variant STRING (no
// `.advance` method) → `TypeError` on click. Compile exits 0 and `node --check`
// passes — a SILENT miscompile (distinct from Bug 62's loud E-CODEGEN-INVALID-JS).
//
// The fix THREADS the file's engine codegen ctx (`EachEngineCtx`, built ONCE via
// the shared `buildEachEngineCtx` from emit-each.ts) down to the lifted-handler
// emitters and routes engine references through the SAME canonical machinery the
// each path uses — NO duplicated `.advance` logic:
//   - `.advance(.X)` → emitExprField C13 arm → `_scrml_engine_advance(...)`
//                      (state plane) / `_scrml_engine_dispatch_message(...)`
//                      (message plane, §51.0.G.1 — `accepts=` engines).
//   - `@engine = .X` → rewriteBlockBody(engineRewriteCtx) → `_scrml_engine_direct_set(...)`.
// Tree-shaken: when the file declares no engine the ctx is null and every
// handler emission is byte-identical to pre-fix.
//
// emit-each.ts loads its cross-module deps via `require()` (no eager static-
// import cycle); mirror that here so emit-lift ↔ emit-each stays init-order safe.
// ---------------------------------------------------------------------------

/**
 * Build the per-file engine codegen ctx for Tier-0 lift handlers. Shares the
 * Bug 62 helper — returns null when the file declares no `<engine>` (tree-shake).
 *
 * @param {any} fileAST — the SAME processed file AST the codegen stage feeds the
 *   non-lift path (engine vars are registered by the name resolver upstream).
 * @returns {object|null} the EachEngineCtx carrier, or null.
 */
function buildLiftEngineCtx(fileAST) {
  if (!fileAST) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const each = require("./emit-each.ts");
  if (!each || typeof each.buildEachEngineCtx !== "function") return null;
  return each.buildEachEngineCtx(fileAST);
}

/**
 * Bug 65 (S157) — assemble the `EachEngineCtx` carrier from engine codegen
 * extras ALREADY threaded through the codegen opts (the non-lift path computes
 * `engineVarNames` / `engineBindings` / `enginesWith*` / `engineMessage*` from
 * the file AST upstream and threads them via emit-logic). This is a thin
 * RE-PACK adapter — it does NOT re-walk the AST and does NOT duplicate any
 * `.advance` lowering (that lives in the SHARED `emitEngineHandlerBody`). The
 * carrier shape mirrors `buildEachEngineCtx`'s output exactly so the shared
 * interceptor consumes it identically.
 *
 * Returns null when the file declares no engine (no `engineVarNames` AND no
 * `engineBindings`) → tree-shaken, byte-identical pre-fix emission.
 *
 * @param {object} extras — the engine ctx extras from codegen opts.
 * @returns {object|null} the EachEngineCtx carrier, or null.
 */
export function buildLiftEngineCtxFromExtras(extras) {
  if (!extras) return null;
  const engineVarNames = extras.engineVarNames ?? null;
  const engineBindings = extras.engineBindings ?? null;
  if ((!engineVarNames || engineVarNames.size === 0) &&
      (!engineBindings || engineBindings.size === 0)) {
    return null;
  }
  // Mirror buildEachEngineCtx's exprCtxExtras spread (already gated to null
  // when empty by the emit-logic `...(opts.X ? {X} : {})` threading).
  const exprCtxExtras = {
    engineVarNames: engineVarNames,
    enginesWithHooks: extras.enginesWithHooks ?? null,
    enginesWithOnTimeout: extras.enginesWithOnTimeout ?? null,
    enginesWithIdleWatchdog: extras.enginesWithIdleWatchdog ?? null,
    enginesWithInternalRules: extras.enginesWithInternalRules ?? null,
    enginesWithHistory: extras.enginesWithHistory ?? null,
    enginesWithMessageArms: extras.enginesWithMessageArms ?? null,
    engineMessageVariants: extras.engineMessageVariants ?? null,
    engineBindings: engineBindings,
  };
  return {
    engineRewriteCtx: { engineBindings, exprCtxExtras },
    engineExprCtxExtras: exprCtxExtras,
    engineVarNames: (engineVarNames && engineVarNames.size > 0) ? engineVarNames : null,
  };
}

/**
 * Lower one lifted event-handler expression that may reference an engine var.
 * Delegates to the SHARED `emitEngineHandlerBody` (emit-each.ts) so the Tier-0
 * lift path and the Tier-1 each path agree byte-for-byte on engine lowering.
 *
 * @param {string} rawHandlerText — the handler expression source (e.g.
 *   `@phase.advance(.Active)` or `@phase = .Active`). For lift handlers the
 *   engine var is file-scope (not iter-local), so the `@engineVar` sigil is
 *   intact in the raw source — no iter-scope prelowering is required here.
 * @param {object|null} engineCtx — the EachEngineCtx carrier (null = no engines).
 * @returns {string|null} the lowered JS statement (NO trailing `;`), or null
 *   when the handler is NOT a recognised engine transition (caller keeps its
 *   existing non-engine emission — no regression).
 */
function tryLowerLiftEngineHandler(rawHandlerText, engineCtx) {
  if (!engineCtx || typeof rawHandlerText !== "string" || rawHandlerText.length === 0) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const each = require("./emit-each.ts");
  if (!each || typeof each.emitEngineHandlerBody !== "function") return null;
  return each.emitEngineHandlerBody(rawHandlerText, engineCtx);
}

// ---------------------------------------------------------------------------
// Bug 72 (S158) — nested `<each>` inside Tier-0 `${for…lift}` lifted markup.
//
// A `<each>` that is a CHILD of lifted markup arrives at codegen as a GENERIC
// `markup` node (`tag="each"`), NOT a structural `each-block`: `parseLiftTag`
// (ast-builder.js) produces generic markup recursively and never promotes
// `<each>` (the each-block transform lives only in the BS-structural buildBlock
// path). Pre-fix, `emitCreateElementFromMarkup` rendered the `<each>` as a
// LITERAL `<each>` DOM element and its `${@.}` body reached the bare-expr
// text-node path with NO iter-scope rewrite — the inner sigil leaked RAW
// (`createTextNode(String((@ .) ?? ""))`) → E-CODEGEN-INVALID-JS.
//
// FIX (the each-nesting analog of the Bug 65 / 63fcba72 engine-ctx gap — reuse
// the SHARED emit-each machinery, no fork): route the `<each>` markup child
// through emit-each's `emitNestedEachFromMarkup`, which converts it to the
// each-block shape and emits it INLINE via the SAME `emitEachReconcileLines`
// helper the Tier-1 nested-each branch uses. The enclosing-scope var is the
// Tier-0 `for`-loop variable (threaded down as `scopeVar`), so the inner source
// (`row.cells`) resolves in that scope and the inner `@.` lowers to the inner
// each's iter var (innermost-scope-wins per SPEC §17.7.3 — legal in any markup
// context incl. lifted markup per §17.4; E-SYNTAX-064 correctly does NOT fire).
//
// `scopeVar` is null at the top markup level (no enclosing `for`); a nested
// `<each>` there is malformed markup the caller still renders literally (no
// regression). emit-each is loaded via `require()` to stay init-order safe
// (mirrors the engine-handler helper above).
// ---------------------------------------------------------------------------

/**
 * Lower a nested `<each>` markup child to inline reconcile JS via the SHARED
 * emit-each machinery. Returns the emitted JS lines, or null when the node is
 * NOT a usable `<each>` (caller keeps its existing literal-markup emission).
 *
 * @param {object} eachMarkupNode — the generic `{kind:"markup", tag:"each"}` node.
 * @param {string|null} scopeVar — the enclosing `for`-loop variable name.
 * @param {string} fragmentVar — the element/fragment to append the inner list to.
 * @param {object|null} engineCtx — the EachEngineCtx carrier (null = no engines).
 * @returns {string[]|null}
 */
function tryEmitNestedLiftEach(eachMarkupNode, scopeVar, fragmentVar, engineCtx) {
  if (!scopeVar || typeof scopeVar !== "string") return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const each = require("./emit-each.ts");
  if (!each || typeof each.emitNestedEachFromMarkup !== "function") return null;
  return each.emitNestedEachFromMarkup(eachMarkupNode, scopeVar, fragmentVar, "", engineCtx);
}

// ---------------------------------------------------------------------------
// Render keyword rewriter (§16.6)
// ---------------------------------------------------------------------------

/**
 * Transform `render name(args)` → `name(args)` in expressions within component bodies.
 * The `render` keyword is a scrml sigil for invoking snippet-typed props. Inside a
 * component body (after CE expansion), `render row(i)` should compile to `row(i)` — a
 * direct call to the snippet prop lambda. This transform runs before rewriteExpr so the
 * resulting function call is visible to subsequent expression passes.
 *
 * @param {string} expr
 * @returns {string}
 */
function rewriteRenderCall(expr) {
  if (!expr || typeof expr !== 'string' || !expr.includes('render')) return expr;
  return expr.replace(/(?<![A-Za-z0-9_$])render\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, '$1(');
}

/**
 * Clean __scrml_render_NAME__() placeholders from emitted code.
 * The expression preprocessor (S39 commit 1e304c8) rewrites `render name(...)` to
 * `__scrml_render_name__(...)` so the structural ExprNode parser can recognize it.
 * When the ExprNode path emits a preprocessed render call, the placeholder leaks
 * through verbatim — this helper strips it back to `name(...)`.
 *
 * @param {string} code — emitted JS code
 * @returns {string} — cleaned code
 */
function cleanRenderPlaceholder(code) {
  if (!code || typeof code !== 'string' || !code.includes('__scrml_render_')) return code;
  return code.replace(/__scrml_render_([A-Za-z_$][A-Za-z0-9_$]*)__/g, '$1');
}

// ---------------------------------------------------------------------------
// Attribute string parser
// ---------------------------------------------------------------------------

/**
 * Parse a tokenizer-spaced attribute string into an array of {name, value} pairs.
 *
 * The tokenizer produces attribute strings with spaces around `=` and around
 * attribute values. Examples:
 *   `class = "card"`  →  [{name: "class", value: "card"}]
 *   `href = "#"`      →  [{name: "href", value: "#"}]
 *   `checked`         →  [{name: "checked", value: null}]
 *   `src = "${img}" alt = "Photo"` → [{name:"src",value:"${img}"},{name:"alt",value:"Photo"}]
 *
 * Attribute values may contain `${expr}` interpolations — preserve them as-is.
 *
 * @param {string} attrsStr — raw attribute string
 * @returns {Array<{name: string, value: string|null}>}
 */
function parseAttrs(attrsStr) {
  if (!attrsStr || !attrsStr.trim()) return [];
  const attrs = [];
  let i = 0;
  const s = attrsStr.trim();

  while (i < s.length) {
    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    // Skip trailing / (self-closer marker)
    if (s[i] === '/') { i++; continue; }

    // Read attribute name (alphanumeric, -, :, .)
    let nameStart = i;
    while (i < s.length && /[A-Za-z0-9_:\-.]/.test(s[i])) i++;
    let name = s.slice(nameStart, i).trim();
    if (!name) { i++; continue; }

    // BUG-4 fix: handle tokenizer-spaced hyphenated names like `data - id`.
    // After reading "data", if whitespace is followed by `-` then more name chars,
    // merge them into a single hyphenated attribute name.
    //
    // S96 Bug 10 fix — extend the merge logic on TWO axes:
    //   (a) Also accept `:` as a separator. The tokenizer spaces `class:opacity`
    //       to `class : opacity`; without this branch, `class:opacity-40` parses
    //       as 5 separate empty attributes (`class`, `:`, `opacity`, `-`, `40`).
    //       Spec §5.5.2 `class-name ::= [a-zA-Z][a-zA-Z0-9_-]*` admits the form.
    //   (b) Accept digit-starting continuation chunks. `bg-blue-500`, `opacity-40`,
    //       `text-2xl` are canonical Tailwind utility class names; the leading
    //       segment is alpha (line 76 gate) but subsequent `-N` chunks may start
    //       with a digit. Relaxing the inner gate from `[A-Za-z]` to `[A-Za-z0-9]`
    //       admits all spec-grammar-legal class-names.
    while (true) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && (s[j] === '-' || s[j] === ':')) {
        const sep = s[j];
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k < s.length && /[A-Za-z0-9]/.test(s[k])) {
          // Check this isn't actually an = sign coming (not a hyphenated continuation)
          let nameEnd = k;
          while (nameEnd < s.length && /[A-Za-z0-9_:\-.]/.test(s[nameEnd])) nameEnd++;
          let afterName = nameEnd;
          while (afterName < s.length && /\s/.test(s[afterName])) afterName++;
          // Only merge if the next part is NOT followed by = (which would mean
          // this is a separate attribute like `- id = "val"`)
          // Actually for hyphenated attrs like data-id, the merged name IS followed by =
          // So always merge when we see name-space-sep-space-name pattern
          const nextPart = s.slice(k, nameEnd);
          name = name + sep + nextPart;
          i = nameEnd;
          continue;
        }
      }
      break;
    }

    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;

    // Check for = sign
    if (i < s.length && s[i] === '=') {
      i++; // consume =
      // Skip whitespace
      while (i < s.length && /\s/.test(s[i])) i++;

      let value = "";
      if (i < s.length && (s[i] === '"' || s[i] === "'")) {
        // Quoted value
        const quote = s[i];
        i++; // consume opening quote
        const valueStart = i;
        while (i < s.length && s[i] !== quote) {
          if (s[i] === '\\') i++; // skip escaped char
          i++;
        }
        value = s.slice(valueStart, i);
        if (i < s.length) i++; // consume closing quote
      } else {
        // Unquoted value — read until whitespace, but track paren depth
        // so that spaced expressions like `deleteTodo ( todo . id )` are
        // captured as a single value instead of being split at the first space.
        //
        // The tokenizer inserts spaces around parens, so we must look ahead
        // through whitespace: if the next non-whitespace char is `(`, continue
        // reading (it's a function call argument list, not a new attribute).
        const valueStart = i;
        let depth = 0;
        while (i < s.length) {
          if (s[i] === '(' || s[i] === '{') depth++;
          else if (s[i] === ')' || s[i] === '}') {
            depth--;
            if (depth < 0) break;
            // After closing delimiter at depth 0, stop — value is complete
            if (depth === 0) { i++; break; }
          } else if (/\s/.test(s[i]) && depth === 0) {
            // At depth 0, whitespace normally ends the value — but peek ahead
            // to see if a `(` or `{` follows (tokenizer-spaced call or expression block).
            let peek = i;
            while (peek < s.length && /\s/.test(s[peek])) peek++;
            if (peek < s.length && (s[peek] === '(' || s[peek] === '{')) {
              // It's a paren group or brace block — keep reading
              i++;
              continue;
            }
            break;
          }
          i++;
        }
        value = s.slice(valueStart, i);
      }
      attrs.push({ name, value });
    } else {
      // Boolean attribute (no value)
      attrs.push({ name, value: null });
    }
  }

  return attrs;
}

// ---------------------------------------------------------------------------
// Content text parser (for interpolation segments)
// ---------------------------------------------------------------------------

/**
 * Parse lift content text that may contain `$$ { expr }` (literal $ + interpolation)
 * or `$ { expr }` interpolation patterns from the tokenizer.
 * Pushes { type: "text" | "expr", value } items into the parts array.
 */
export function parseLiftContentParts(text, parts) {
  let i = 0;
  let literalStart = 0;

  while (i < text.length) {
    // Check for $$ { pattern — literal $ followed by ${ interpolation
    if (text[i] === '$' && text[i + 1] === '$' && i + 2 < text.length) {
      let j = i + 2;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length && text[j] === '{') {
        let depth = 1;
        let k = j + 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '{') depth++;
          else if (text[k] === '}') depth--;
          k++;
        }
        if (depth === 0) {
          if (i > literalStart) {
            parts.push({ type: "text", value: text.slice(literalStart, i) });
          }
          parts.push({ type: "text", value: "$" });
          const exprInside = text.slice(j + 1, k - 1).trim();
          parts.push({ type: "expr", value: exprInside });
          literalStart = k;
          i = k;
          continue;
        }
      }
    }
    // Check for ${ pattern — interpolation (compact form)
    if (text[i] === '$' && text[i + 1] === '{') {
      let j = i + 2;
      let depth = 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      if (depth === 0) {
        if (i > literalStart) {
          parts.push({ type: "text", value: text.slice(literalStart, i) });
        }
        const exprInside = text.slice(i + 2, j - 1).trim();
        parts.push({ type: "expr", value: exprInside });
        literalStart = j;
        i = j;
        continue;
      }
    }
    // Check for `$ { expr }` (tokenizer spaces $ away from {)
    if (text[i] === '$' && i + 1 < text.length && /\s/.test(text[i + 1])) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length && text[j] === '{') {
        let depth = 1;
        let k = j + 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '{') depth++;
          else if (text[k] === '}') depth--;
          k++;
        }
        if (depth === 0) {
          if (i > literalStart) {
            parts.push({ type: "text", value: text.slice(literalStart, i) });
          }
          const exprInside = text.slice(j + 1, k - 1).trim();
          parts.push({ type: "expr", value: exprInside });
          literalStart = k;
          i = k;
          continue;
        }
      }
    }
    i++;
  }

  // Push remaining literal
  if (literalStart < text.length) {
    const remaining = text.slice(literalStart);
    if (remaining.trim()) {
      parts.push({ type: "text", value: remaining });
    }
  }
}

// ---------------------------------------------------------------------------
// Nested tag detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string contains a tokenizer-spaced opening tag like `< div` or `< a`.
 * The tokenizer separates `<` from the tag name with a space.
 * @param {string} s
 * @returns {boolean}
 */
function hasNestedTag(s) {
  return /<\s*[A-Za-z]/.test(s);
}

/**
 * Check if a string is a tokenizer-spaced closing tag like `< / a >` or `< / li >`.
 * @param {string} s
 * @returns {boolean}
 */
function isClosingTagFragment(s) {
  return /^<\s*\//.test(s);
}

/**
 * Check if a string contains a tokenizer-spaced closing tag like `< / div >`.
 * Unlike isClosingTagFragment, this checks anywhere in the string, not just the start.
 * @param {string} s
 * @returns {boolean}
 */
function containsClosingTag(s) {
  return /<\s*\/\s*[A-Za-z]/.test(s);
}

/**
 * Split a content string containing multiple tokenizer-spaced tags into segments.
 * Each segment is { type: "text"|"open-tag"|"close-tag", ... }.
 *
 * Example: `< / span > < span class = "date" >`
 * → [{ type: "close-tag", tag: "span" }, { type: "open-tag", tag: "span", attrsStr: "class = \"date\"" }]
 *
 * @param {string} s — content that may contain tokenizer-spaced tags
 * @returns {Array<{type: string, tag?: string, attrsStr?: string, text?: string}>}
 */
function splitTagSegments(s) {
  const segments = [];
  let i = 0;
  let textStart = 0;

  while (i < s.length) {
    // Check for tag opening `<`
    if (s[i] === '<') {
      // Flush preceding text
      if (i > textStart) {
        const text = s.slice(textStart, i).trim();
        if (text) segments.push({ type: "text", text });
      }

      // Determine if closing tag or opening tag
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;

      if (j < s.length && s[j] === '/') {
        // Closing tag: `< / tagname >`
        j++;
        while (j < s.length && /\s/.test(s[j])) j++;
        let tagStart = j;
        while (j < s.length && /[A-Za-z0-9-]/.test(s[j])) j++;
        const tag = s.slice(tagStart, j);
        // Skip to >
        while (j < s.length && s[j] !== '>') j++;
        if (j < s.length) j++; // consume >
        segments.push({ type: "close-tag", tag });
        textStart = j;
        i = j;
        continue;
      } else if (j < s.length && /[A-Za-z]/.test(s[j])) {
        // Opening tag: `< tagname attrs >`
        let tagStart = j;
        while (j < s.length && /[A-Za-z0-9-]/.test(s[j])) j++;
        const tag = s.slice(tagStart, j);

        // Read attributes until >
        const attrsStart = j;
        while (j < s.length) {
          if (s[j] === '>') break;
          if (s[j] === '"' || s[j] === "'") {
            const q = s[j]; j++;
            while (j < s.length && s[j] !== q) {
              if (s[j] === '\\') j++;
              j++;
            }
            if (j < s.length) j++;
            continue;
          }
          j++;
        }
        const attrsStr = s.slice(attrsStart, j).trim();
        if (j < s.length && s[j] === '>') j++; // consume >
        segments.push({ type: "open-tag", tag, attrsStr });
        textStart = j;
        i = j;
        continue;
      }
    }
    i++;
  }

  // Flush remaining text
  if (textStart < s.length) {
    const text = s.slice(textStart).trim();
    if (text) segments.push({ type: "text", text });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// createElement emission helpers
// ---------------------------------------------------------------------------

/**
 * Emit setAttribute calls for a parsed attrs array.
 * Returns lines like: `_el.setAttribute("class", "card");`
 * For attrs that have `${expr}` values, uses a template literal.
 *
 * @param {string} elVar — the variable name of the element
 * @param {Array<{name: string, value: string|null}>} attrs
 * @returns {string[]}
 */
function emitSetAttrs(elVar, attrs, engineCtx = null) {
  const lines = [];
  for (const attr of attrs) {
    if (attr.value === null) {
      // Boolean attribute
      lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, "");`);
    } else if (/^bind:(value|checked|files|group)$/.test(attr.name)) {
      // LIFT-2 fix (S88) — two-way bind:* wiring inside lift template, parity
      // with top-level bind:* dispatch per §5.4.1 + emit-bindings.ts:268.
      //
      // Pre-fix: emitted literal setAttribute("bind:value", _scrml_reactive_get(...))
      // which gave NO two-way wiring (no addEventListener, no subscription).
      //
      // This fix wires:
      //   1. Initial sync — set the DOM property from the reactive cell.
      //   2. User-input → cell — addEventListener fires _scrml_reactive_set.
      //   3. Cell → DOM — _scrml_reactive_subscribe fires reverse sync.
      //
      // Simplifications vs top-level: no numeric coercion (Number/Range), no
      // enum coercion (<select> + EnumType_toEnum), no compound-path support.
      // Lift template bind:* in v1 is text-shape only; enrich as friction surfaces.
      const flavor = attr.name.split(":")[1]; // value | checked | files | group
      const eventName = flavor === "value" ? "input" : "change";
      // Extract the reactive var name. attr.value may be "@editText" (tokenized
      // form may include leading whitespace). Strip the @-prefix.
      const varRef = attr.value.trim().replace(/^@/, "");
      const varJSON = JSON.stringify(varRef);
      lines.push(`${elVar}.${flavor} = _scrml_reactive_get(${varJSON});`);
      lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function() { _scrml_reactive_set(${varJSON}, ${elVar}.${flavor}); });`);
      lines.push(`_scrml_reactive_subscribe(${varJSON}, function() { ${elVar}.${flavor} = _scrml_reactive_get(${varJSON}); });`);
    } else if (attr.name === "if") {
      // LIFT-3 fix (S88) — conditional display toggle inside lift template,
      // parity with top-level if= attribute conditional rendering.
      //
      // Pre-fix: emitted literal setAttribute("if", String(expr ?? "")) which
      // attached the raw expression as an HTML attribute with NO display
      // toggle, NO conditional rendering.
      //
      // This fix emits:
      //   1. An updater function that toggles style.display based on expr.
      //   2. An initial call to apply the predicate at element-build time.
      //   3. _scrml_reactive_subscribe for each @-prefixed cell referenced in
      //      the expression, so changes re-evaluate the predicate.
      //
      // The for-loop iterable identifier (e.g. `item` in `if=@editingId == item.id`)
      // is captured by the per-item factory closure — no subscription needed
      // because the factory rebuilds per item.
      const exprJS = emitExprField(null, attr.value, { mode: "client" });
      const updaterVar = `_scrml_if_${genVar()}`;
      lines.push(`function ${updaterVar}() { ${elVar}.style.display = (${exprJS}) ? "" : "none"; }`);
      lines.push(`${updaterVar}();`);
      // Extract @-prefixed reactive var names from the raw expression. Strip
      // any dotted-path tail so `@form.field` subscribes to the compound root
      // `form` (matches the top-level if= subscription granularity).
      const refMatches = attr.value.match(/@([A-Za-z_$][A-Za-z0-9_$.]*)/g) || [];
      const uniqueRefs = [...new Set(refMatches.map(r => r.replace(/^@/, "").split(".")[0]))];
      // S103 Phase 3 select-row chip-away — value-indexed subscription
      // dispatch. When the bind expression is a STRICTEST-scope predicate
      // shape (cell == literal-or-closure-expr), register the updater under
      // the value-indexed sub-registry so writes fire only the OLD-value +
      // NEW-value buckets (O(2) per write instead of O(N) over all rows).
      // Falls back to LEGACY for any non-predicate shape.
      const predicate = detectPredicateShapeBind(attr.value);
      if (predicate.matched && uniqueRefs.length === 1 && uniqueRefs[0] === predicate.cellName) {
        lines.push(`_scrml_reactive_subscribe_when(${JSON.stringify(predicate.cellName)}, ${predicate.valueExprJS}, ${updaterVar});`);
      } else {
        for (const ref of uniqueRefs) {
          lines.push(`_scrml_reactive_subscribe(${JSON.stringify(ref)}, ${updaterVar});`);
        }
      }
    } else if (attr.name.startsWith("class:")) {
      // §5.5.2 conditional class directive — see the parity branch in
      // emitCreateElementFromMarkup for the value-kind-AST equivalent.
      // attr.value here is the raw source string (e.g. "@isActive",
      // "todo.done", "(item.id == @selected)", "isPicked()"). emitExprField
      // rewrites @-prefixed refs to _scrml_reactive_get(...) and passes
      // closure-captured identifiers (loop iterables) through unchanged.
      const className = attr.name.slice(6);
      const raw = (attr.value ?? "").trim();
      const condExpr = emitExprField(null, raw, { mode: "client" });
      lines.push(`_scrml_effect(() => { ${elVar}.classList.toggle(${JSON.stringify(className)}, !!(${condExpr})); });`);
    } else if (/^on[a-z]/.test(attr.name)) {
      // BUG-6 fix: event attributes like onclick, ondblclick, onsubmit
      // must use addEventListener, not setAttribute
      const eventName = attr.name.replace(/^on/, "");
      // Bug 65 (S157) — engine transition `@engine.advance(.X)` / `@engine = .X`
      // in a lifted handler: lower through the SHARED engine machinery (state /
      // message plane / direct-set) BEFORE the generic emitExprField path, which
      // has no engine ctx and would emit `_scrml_reactive_get(...).advance(...)`
      // on the bare variant string (silent TypeError on click). Null engineCtx
      // (engine-free file) skips this — byte-identical to pre-fix.
      const engineLoweredAttr = tryLowerLiftEngineHandler(String(attr.value ?? "").trim(), engineCtx);
      if (engineLoweredAttr !== null) {
        lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${engineLoweredAttr}; });`);
        continue;
      }
      // SPEC §5.2.2 normative: `onclick=fn()` SHALL emit
      // `function(event) { fn(); }` — `fn` is invoked with the user's
      // declared args, NOT auto-threaded `event`. The pre-S96 LIFT-4 fix
      // (S88) replaced `fn()` with `fn(event)` here to match a locked test
      // citing "tutorial §1.5: passes the native event implicitly". Per
      // pa.md Rule 4 (SPEC normative; tutorials and tests do NOT override
      // SPEC), this auto-thread was wrong. S96 Bug 14 user-decision: spec
      // wins, restore the bare-call shape. Escape-hatch for "needs event"
      // is `onclick=${(e) => fn(e)}` (§5.2.2 expression form).
      const handlerSource = attr.value;
      // S140 Bug 59 — string-form sibling of the AST `val.kind==="expr"` fix
      // below (~L760). A synth arrow-string handler `(evt) => { … }` routed
      // through `emitExprField` here falls into Pass 1 `rewritePresenceGuard`,
      // which rewrites it to `if (evt !== null && evt !== undefined) { … }` —
      // no longer callable, so the `function(event) { … }` wrapper applies and
      // `evt` becomes a free var. Mirror the Bug-50 (S138) fix: when the
      // non-interpolated source is an arrow/function-expression, use
      // `rewriteExprArrowBody` (skips presence-guard). The `${…}` interpolation
      // branch keeps its part-splitting escape-hatch behavior unchanged.
      const isSynthCallableHandlerSource =
        typeof handlerSource === "string" &&
        (/^\s*function\s*\(/.test(handlerSource) ||
          /^\s*(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.test(handlerSource));
      // The value may be a function call like "toggleTodo(todo.id)" or just a name
      const handlerExpr = handlerSource.includes('${') || /\$\s*\{/.test(handlerSource)
        ? (() => {
            const parts = [];
            parseLiftContentParts(handlerSource, parts);
            return parts.map(p => p.type === "expr" ? emitExprField(null, p.value, { mode: "client" }) : p.value).join("");
          })()
        : isSynthCallableHandlerSource
          ? rewriteExprArrowBody(handlerSource)
          : emitExprField(null, handlerSource, { mode: "client" });
      // S96 Bug 11+12 fix — when handlerExpr is already a callable (arrow
      // function `(x) => ...` / `x => ...` / function expression
      // `function(...) {...}`), emit it DIRECTLY as the handler. The
      // pre-fix code unconditionally wrapped in `function(event) { ${expr}; }`
      // which made the inner arrow a dead expression-statement — the spec
      // §5.2.1 escape-hatch `onclick=${(e) => fn(e)}` never invoked. Bug 12
      // (closure-capture-in-iteration: `ondragstart=${() => startDrag(task.id)}`)
      // shared this root cause; the FOLLOWUPS framing as a BS-layer parser
      // issue was misdiagnosed. Mirrors the emit-event-wiring.ts Case A/B
      // dispatch for top-level event handlers.
      const trimmedHandler = handlerExpr.trim();
      const isCallable =
        /^function\s*\(/.test(trimmedHandler) ||
        /^(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.test(trimmedHandler);
      if (isCallable) {
        lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, ${handlerExpr});`);
      } else {
        lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${handlerExpr}; });`);
      }
    } else {
      // Check if the value contains interpolation (compact or tokenizer-spaced)
      if (attr.value.includes('${') || /\$\s*\{/.test(attr.value)) {
        // Rebuild as template literal with rewritten expressions
        const parts = [];
        parseLiftContentParts(attr.value, parts);
        let tpl = "`";
        for (const p of parts) {
          if (p.type === "expr") {
            tpl += "${" + emitExprField(null, rewriteRenderCall(p.value), { mode: "client" }) + "}";
          } else {
            tpl += p.value.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
          }
        }
        tpl += "`";
        lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${tpl});`);
      } else {
        lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`);
      }
    }
  }
  return lines;
}

/**
 * Emit JS statements that set the text content of an element from a list of parts.
 * Pure text → textContent assignment. Mixed content → appendChild(createTextNode(`...`)).
 *
 * @param {string} elVar — the variable name of the element
 * @param {Array<{type: string, value: string}>} parts — text/expr parts
 * @returns {string[]} — JS lines
 */
function emitSetContent(elVar, parts) {
  if (!parts || parts.length === 0) return [];

  const hasExpr = parts.some(p => p.type === "expr");

  if (!hasExpr) {
    const combined = parts.map(p => p.value).join("");
    if (!combined.trim()) return [];
    return [`${elVar}.textContent = ${JSON.stringify(combined)};`];
  }

  // Build a template literal for mixed text/expression content
  let tpl = "`";
  for (const p of parts) {
    if (p.type === "expr") {
      tpl += "${" + emitExprField(null, rewriteRenderCall(p.value), { mode: "client" }) + "}";
    } else {
      tpl += p.value.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    }
  }
  tpl += "`";
  return [`${elVar}.appendChild(document.createTextNode(${tpl}));`];
}

/**
 * Walk a markup AST node recursively and emit createElement chains.
 * Returns the variable name of the root element.
 *
 * @param {object} node — markup AST node { kind:"markup", tag, attributes, children }
 * @param {string[]} lines — accumulator for JS lines
 * @returns {string} — the variable name of the created element
 */
export function emitCreateElementFromMarkup(node, lines, engineCtx = null, scopeVar = null) {
  const tag = node.tag ?? node.tagName ?? "div";
  const attrs = node.attributes ?? node.attrs ?? [];
  const children = node.children ?? [];
  const isVoid = VOID_ELEMENTS.has(tag);

  const elVar = genVar(`lift_el`);
  lines.push(`const ${elVar} = document.createElement(${JSON.stringify(tag)});`);

  // Emit setAttribute calls
  for (const attr of attrs) {
    if (!attr) continue;
    const name = attr.name;
    const val = attr.value;

    // LIFT-2 fix (S88) — bind:* two-way wiring (parity with top-level §5.4.1).
    // Recognized before kind-dispatch because the wiring is name-driven, not
    // value-kind-driven. attr.value here is one of: variable-ref (@cell),
    // expr (@compound.field or general expr).
    if (val && (val.kind === "variable-ref" || val.kind === "expr") && /^bind:(value|checked|files|group)$/.test(name)) {
      const flavor = name.split(":")[1]; // value | checked | files | group
      const eventName = flavor === "value" ? "input" : "change";
      // For variable-ref: name is the raw "@cell" form (strip the @).
      // For expr: use raw form to extract the @-prefixed reference. We only
      // support single-cell bind:* in v1; complex expr forms (e.g.
      // `bind:value=@cell ?? default`) are forbidden by spec and surfaced
      // elsewhere — here we just take the first @-ref.
      const rawRef = val.kind === "variable-ref"
        ? (val.name || "").replace(/^@/, "")
        : ((val.raw || "").match(/@([A-Za-z_$][A-Za-z0-9_$.]*)/) || [, ""])[1];
      if (rawRef) {
        const varJSON = JSON.stringify(rawRef.split(".")[0]); // compound root if dotted
        // For dotted paths use _scrml_deep_get/_scrml_deep_set patterns; for v1
        // single-cell, emit direct get/set. Compound-path bind:value is a
        // follow-on extension.
        if (rawRef.includes(".")) {
          // Dotted compound — defer to existing setAttribute path (no fix in v1).
          lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, _scrml_reactive_get(${varJSON}));`);
        } else {
          lines.push(`${elVar}.${flavor} = _scrml_reactive_get(${varJSON});`);
          lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function() { _scrml_reactive_set(${varJSON}, ${elVar}.${flavor}); });`);
          lines.push(`_scrml_reactive_subscribe(${varJSON}, function() { ${elVar}.${flavor} = _scrml_reactive_get(${varJSON}); });`);
        }
        continue;
      }
    }

    // LIFT-3 fix (S88) — if= conditional display toggle (parity with top-level).
    if (val && (val.kind === "variable-ref" || val.kind === "expr") && name === "if") {
      // Get the predicate expression in emitted form.
      const raw = val.kind === "variable-ref"
        ? (val.name || "").replace(/^@/, "")
        : (val.raw || "");
      const exprJS = emitExprField(val.exprNode, raw, { mode: "client" });
      const updaterVar = `_scrml_if_${genVar()}`;
      lines.push(`function ${updaterVar}() { ${elVar}.style.display = (${exprJS}) ? "" : "none"; }`);
      lines.push(`${updaterVar}();`);
      // Subscribe to each @-prefixed reactive var in the raw expression. The
      // for-loop iterable identifier is captured by the per-item factory
      // closure — not a reactive cell, no subscription needed.
      const rawText = val.kind === "variable-ref" ? (val.name || "") : (val.raw || "");
      const refMatches = rawText.match(/@([A-Za-z_$][A-Za-z0-9_$.]*)/g) || [];
      const uniqueRefs = [...new Set(refMatches.map(r => r.replace(/^@/, "").split(".")[0]))];
      // S103 Phase 3 select-row chip-away — value-indexed dispatch (parity
      // with the attrs-string path above). See that branch for the rationale.
      const predicate = detectPredicateShapeBind(rawText);
      if (predicate.matched && uniqueRefs.length === 1 && uniqueRefs[0] === predicate.cellName) {
        lines.push(`_scrml_reactive_subscribe_when(${JSON.stringify(predicate.cellName)}, ${predicate.valueExprJS}, ${updaterVar});`);
      } else {
        for (const ref of uniqueRefs) {
          lines.push(`_scrml_reactive_subscribe(${JSON.stringify(ref)}, ${updaterVar});`);
        }
      }
      continue;
    }

    // class:NAME=expr conditional class directive (§5.5.2). Must run BEFORE the
    // generic value-kind dispatch — otherwise `class:dragging` falls through to
    // `setAttribute("class:dragging", ...)`, which is a literal HTML attribute
    // and does nothing useful at runtime.
    //
    // Top-level (non-lift) emission handles this via a stamped marker attribute
    // (`data-scrml-class-NAME`) + querySelector lookup. Inside a lift factory
    // we already have a direct reference to the element (`elVar`), so we wire
    // the reactive effect directly on `elVar` and skip the marker.
    if (val && name.startsWith("class:") && (
      val.kind === "variable-ref" || val.kind === "expr" || val.kind === "call-ref"
    )) {
      const className = name.slice(6);
      let condExpr;
      if (val.kind === "variable-ref") {
        const rawRef = (val.name || "").replace(/^@/, "");
        condExpr = emitExprField(val.exprNode, rawRef, { mode: "client" });
      } else if (val.kind === "expr") {
        const raw = val.raw ?? "";
        condExpr = emitExprField(val.exprNode, raw, { mode: "client" });
      } else {
        const rawArgs = val.argExprNodes
          ? val.argExprNodes.map(n => emitExprField(n, "", { mode: "client" })).join(", ")
          : (val.args || []).map(a => emitExprField(null, a.trim(), { mode: "client" })).join(", ");
        const rewrittenName = emitExprField(null, val.name, { mode: "client" });
        condExpr = `${rewrittenName}(${rawArgs})`;
      }
      lines.push(`_scrml_effect(() => { ${elVar}.classList.toggle(${JSON.stringify(className)}, !!(${condExpr})); });`);
      continue;
    }

    if (!val || val.kind === "absent") {
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, "");`);
    } else if (val.kind === "string-literal") {
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(val.value)});`);
    } else if (val.kind === "variable-ref") {
      // Bug 65 (S157) — a bare `@engineVar` reference is NOT an engine transition
      // (no `.advance` / no assign); it stays a plain handler ref. Engine
      // transitions arrive as `call-ref` (`.advance(.X)`) or `expr` (`@e = .X` /
      // `@e.advance(.X)`), handled below. No engine path needed here.
      const varName = (val.name || "").replace(/^@/, "");
      const rewritten = emitExprField(val.exprNode, varName, { mode: "client" });
      if (/^on[a-z]/.test(name)) {
        const eventName = name.replace(/^on/, "");
        lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${rewritten}(event); });`);
      } else {
        lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, ${rewritten});`);
      }
    } else if (val.kind === "call-ref") {
      // Function call in attribute — reconstruct full call with arguments.
      // SPEC §5.2.2: `onclick=fn()` emits `function(event) { fn(); }`; declared
      // args forwarded verbatim, NOT auto-threaded with `event`. The S88 LIFT-4
      // fix used to auto-inject `event` for empty-args; S96 Bug 14 reverted
      // that per Rule 4 + user decision. See companion fix at line ~480 (the
      // legacy-attrs path) for the same restoration.
      const rewrittenArgs = val.argExprNodes
        ? val.argExprNodes.map(n => emitExprField(n, "", { mode: "client" })).join(", ")
        : (val.args || []).map(a => emitExprField(null, a.trim(), { mode: "client" })).join(", ");
      const rewrittenName = emitExprField(null, val.name, { mode: "client" });
      if (/^on[a-z]/.test(name)) {
        const eventName = name.replace(/^on/, "");
        // Bug 65 (S157) — engine `.advance(.X)` parses as a call-ref
        // `{ name:"@engine.advance", args:[".X"] }`. Reconstruct the call text and
        // route it through the SHARED engine machinery (state / message plane);
        // otherwise the plain-call emission stands (no regression to fn-call handlers).
        const callTextForEngine = `${val.name}(${(val.args || []).map((a) => String(a).trim()).join(", ")})`;
        const engineLoweredCall = tryLowerLiftEngineHandler(callTextForEngine, engineCtx);
        if (engineLoweredCall !== null) {
          lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${engineLoweredCall}; });`);
        } else {
        const callExpr = `${rewrittenName}(${rewrittenArgs})`;
        lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${callExpr}; });`);
        }
      } else {
        const callExpr = `${rewrittenName}(${rewrittenArgs})`;
        lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, String(${callExpr} ?? ""));`);
      }
    } else if (typeof val === "string") {
      // Raw string value
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(val)});`);
    } else if (val.kind === "expr" || val.kind === "props-block") {
      // Inline expression from ${...} attribute (e.g. oninput=${@var = event.target.value})
      // or props-block. For event attrs, use addEventListener; otherwise setAttribute.
      const raw = val.raw ?? val.propsDecl ?? "";
      if (/^on[a-z]/.test(name)) {
        const eventName = name.replace(/^on/, "");
        // Bug 65 (S157) — engine transition `${@engine.advance(.X)}` (CallExpr) /
        // `${@engine = .X}` (AssignExpr) in a lifted handler: lower through the
        // SHARED engine machinery (state / message plane / direct-set) BEFORE the
        // generic emitExprField path, which has no engine ctx and would emit
        // `_scrml_reactive_get(...).advance(...)` against the bare variant string
        // (silent TypeError on click — `node --check` passes). Null engineCtx
        // (engine-free file) skips this — byte-identical to pre-fix.
        const engineLoweredExpr = tryLowerLiftEngineHandler(String(raw).trim(), engineCtx);
        if (engineLoweredExpr !== null) {
          lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${engineLoweredExpr}; });`);
          continue;
        }
        // S140 Bug 59 — when this onevent value is a synth arrow-string with
        // NO structured exprNode (the emit-table-for per-row checkbox onchange
        // builds `{ kind:"expr", raw:"(evt) => { … }" }` directly), routing the
        // raw string through `emitExprField` falls into `rewriteExprWithDerived`
        // → Pass 1 `rewritePresenceGuard`, which matches `( ident ) => { body }`
        // as a §42 presence-guard and rewrites it to `if (evt !== null && evt
        // !== undefined) { body }`. That `if`-statement is no longer callable,
        // so the `function(event) { … }` wrapper below applies and `evt`
        // becomes a free var → `ReferenceError: evt is not defined` at runtime
        // (silent miscompile; `node --check` passes). This is the per-row
        // RESIDUAL of Bug 50 (RESOLVED S138 `c89f1176`), which patched only the
        // delegated master-checkbox path in emit-event-wiring.ts. Mirror that
        // fix here: when there is no structured exprNode AND the source is an
        // arrow/function-expression, use `rewriteExprArrowBody` (skips Pass 1
        // presence-guard). When `val.exprNode` IS present, the structured
        // emitExprField → emitLambda path already handles arrows correctly.
        const isSynthCallableSource =
          !val.exprNode &&
          typeof raw === "string" &&
          (/^\s*function\s*\(/.test(raw) ||
            /^\s*(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.test(raw));
        const rewritten = isSynthCallableSource
          ? rewriteExprArrowBody(raw)
          : emitExprField(val.exprNode, raw, { mode: "client" });
        // S96 Bug 11+12 fix — if the expression IS a callable (arrow
        // function or function expression), use it directly per SPEC §5.2.2:
        //   `onclick=${(e) => fn(e, arg)}` — `${}` expression used as-is.
        // Pre-fix wrapped in `function(event) { ${expr}; }`, making the inner
        // arrow a dead expression-statement that never runs. Bug 12
        // (closure-capture-in-iteration) is the same root cause as Bug 11;
        // both collapsed to this single fix at the AST-attrs path.
        const trimmedExpr = rewritten.trim();
        const isCallable =
          /^function\s*\(/.test(trimmedExpr) ||
          /^(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.test(trimmedExpr);
        if (isCallable) {
          lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, ${rewritten});`);
        } else {
          lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${rewritten}; });`);
        }
      } else {
        const rewritten = emitExprField(val.exprNode, raw, { mode: "client" });
        lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, String(${rewritten} ?? ""));`);
      }
    } else if (val && val.kind) {
      // Exhaustiveness guard — surface unhandled attribute value kinds
      console.warn(`[emit-lift] unhandled attribute value kind: ${val.kind} for attr "${name}"`);
    }
  }

  if (!isVoid) {
    for (const child of children) {
      if (!child) continue;

      if (child.kind === "text") {
        const text = child.value ?? child.text ?? "";
        if (text.trim()) {
          lines.push(`${elVar}.appendChild(document.createTextNode(${JSON.stringify(text)}));`);
        }
      } else if (child.kind === "markup") {
        // Bug 72 (S158) — a nested `<each>` child: route through the SHARED
        // emit-each machinery (inner `@.` lowers to the inner iter var) instead
        // of rendering a literal `<each>` element with a raw-`@.` body. Falls
        // through to the generic recurse when not a usable each (scopeVar null
        // at top level, or no in=/of= source).
        const childTag = child.tag ?? child.tagName ?? child.name ?? "";
        if (childTag === "each") {
          const eachLines = tryEmitNestedLiftEach(child, scopeVar, elVar, engineCtx);
          if (eachLines !== null) {
            for (const l of eachLines) lines.push(l);
            continue;
          }
        }
        const childVar = emitCreateElementFromMarkup(child, lines, engineCtx, scopeVar);
        lines.push(`${elVar}.appendChild(${childVar});`);
      } else if (child.kind === "logic") {
        // Logic block in markup — dispatch each body node by kind:
        //   - bare-expr      → text-node interpolation (${expr})
        //   - lift-expr      → nested lift, routed to elVar as container
        //   - for-stmt       → for-of loop with inner lift routed to elVar (S87 Bug-6 fix)
        //   - if-stmt        → ${if (cond) { lift ... }} routed to elVar
        //   - bare statements → emitted via emitLogicNode (e.g. const/let decls
        //                      inside ${ ... } such as `${ const x = f() }`)
        //
        // Bug-6 fix: previously, only bare-expr was handled and for-stmt/if-stmt
        // children were silently dropped, causing `lift <ul>${ for (r of rows) {
        // lift <li>${r.name}/ }}</ul>` to emit a bare <ul> with NO <li> children.
        if (child.body) {
          for (const logicChild of child.body) {
            if (!logicChild) continue;
            // Phase 4d Step 8: ExprNode-only (bare-expr.expr deleted)
            if (logicChild.kind === "bare-expr" && (logicChild.exprNode || logicChild.expr)) {
              const rewritten = cleanRenderPlaceholder(emitExprField(logicChild.exprNode, rewriteRenderCall(logicChild.expr ?? ""), { mode: "client" }));
              // gate-found-invalid-js-fix-wave (S141): a `${...}` interpolation whose
              // expression lowers to the EMPTY string emits `String(() ?? "")` — invalid
              // JS (`()` is empty parens, the gate's E-CODEGEN-INVALID-JS). This happens
              // when a render-slot (`${render header()}`) is substituted away to nothing
              // by the component-expander, leaving a `bare-expr` with an empty escape-hatch
              // node (example 12-snippets-slots shipped invalid .client.js this way). An
              // empty interpolation has no text to render, so SKIP the text-node append
              // entirely rather than emit a malformed `String(() ?? "")`.
              if (rewritten.trim() === "") continue;
              // GITI-019: parenthesize the source expr before the `?? ""` coalesce guard.
              // ES2020 forbids mixing `??` with a top-level `||`/`&&` operand without
              // explicit parens (e.g. `a || b ?? ""` is a SyntaxError). Wrapping the
              // inner expr unconditionally is safe for every shape and is the simplest
              // lowering. Scope: lift-loop/markup-embedded text interpolation only.
              lines.push(`${elVar}.appendChild(document.createTextNode(String((${rewritten}) ?? "")));`);
            } else if (logicChild.kind === "lift-expr") {
              // Nested ${ lift <inner/> } inside markup — route to current element
              const code = emitLiftExpr(logicChild, { containerVar: elVar });
              if (code) lines.push(code);
            } else if (logicChild.kind === "for-stmt") {
              // ${ for (r of @rows) { lift <li>...</li> } } — route inner lifts to elVar
              const code = emitForStmtWithContainer(logicChild, elVar);
              if (code) lines.push(code);
            } else if (logicChild.kind === "if-stmt") {
              // ${ if (cond) { lift <inner/> } } — recurse with elVar as container.
              // Walk consequent/alternate, routing lift-expr/for-stmt to elVar;
              // emit a JS if/else around the result.
              const code = emitIfStmtWithContainer(logicChild, elVar);
              if (code) lines.push(code);
            } else {
              // Bare statement (e.g. `const x = f()` inside ${...}) — pass through
              const code = emitLogicNode(logicChild, {});
              if (code) lines.push(code);
            }
          }
        }
      }
    }
  }

  return elVar;
}

// ---------------------------------------------------------------------------
// Tag expression string parser (for tokenizer-fragmented lift expressions)
// ---------------------------------------------------------------------------

/**
 * @deprecated S14 Lift Approach C — parseLiftTag in ast-builder.js now produces
 * structured {kind: "markup"} nodes for inline lift markup. This string parser
 * is only reached via legacy test fixtures that hard-code {kind: "expr"} with
 * bare-`/` closer syntax. Can be deleted once all test fixtures are migrated.
 *
 * Parse a tokenizer-spaced tag expression string into { tag, attrsStr, content }.
 *
 * Input: `< div class = "card" > content /`
 * or:    `< li > Step content /`
 * or:    `< img src = "x.jpg" alt = "Photo" /`   (self-closing void element)
 *
 * The tokenizer separates `<` from the tag name and `=` from attribute values with spaces.
 * This parser handles that spacing correctly.
 *
 * @param {string} expr
 * @returns {{ tag: string, attrsStr: string, content: string } | null}
 */
function parseTagExprString(expr) {
  if (!expr) return null;
  const s = expr.trim();
  if (s[0] !== '<') return null;

  let i = 1;

  // Skip whitespace after <
  while (i < s.length && /\s/.test(s[i])) i++;

  // Skip if next char is / (closing tag)
  if (i < s.length && s[i] === '/') return null;

  // Read tag name
  const tagStart = i;
  while (i < s.length && /[A-Za-z0-9-]/.test(s[i])) i++;
  if (i === tagStart) return null; // No tag name
  const tag = s.slice(tagStart, i);

  // Read attributes — everything up to (but not including) the first unquoted >
  const attrsStart = i;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '>') break;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') i++;
        i++;
      }
      if (i < s.length) i++; // consume closing quote
      continue;
    }
    i++;
  }
  const attrsStr = s.slice(attrsStart, i).trim();

  // Consume the > if present
  if (i < s.length && s[i] === '>') i++;

  // Skip whitespace after >
  while (i < s.length && /\s/.test(s[i])) i++;

  // Content is everything after the `>`, with the trailing `/` (lift closer) stripped
  let content = s.slice(i);
  content = content.replace(/\s*\/\s*$/, "").trim();

  return { tag, attrsStr, content };
}

/**
 * Emit createElement JS from a tokenizer-spaced tag expression string.
 * Returns { lines: string[], varName: string } or null if not a tag expression.
 *
 * Only handles simple content (text + interpolations).
 * Content containing nested tags (tokenizer-spaced `< tag`) is left to the caller.
 *
 * @deprecated S14 Lift Approach C — real code uses emitCreateElementFromMarkup
 * via the structured {kind: "markup"} path. Only legacy test fixtures reach here.
 *
 * @param {string} expr — raw tokenizer string like `< li > ${item} /`
 * @returns {{ lines: string[], varName: string } | null}
 */
function emitCreateElementFromExprString(expr) {
  const parsed = parseTagExprString(expr);
  if (!parsed) return null;

  const { tag, attrsStr, content } = parsed;
  const isVoid = VOID_ELEMENTS.has(tag);
  const lines = [];
  const elVar = genVar(`lift_el`);

  lines.push(`const ${elVar} = document.createElement(${JSON.stringify(tag)});`);

  // Parse and emit attributes
  if (attrsStr) {
    const attrs = parseAttrs(attrsStr);
    const attrLines = emitSetAttrs(elVar, attrs);
    for (const l of attrLines) lines.push(l);
  }

  // Emit content
  if (content && !isVoid) {
    if (hasNestedTag(content)) {
      // Content contains nested child elements — split into child segments and recurse.
      // Each child is either a `< tag ... /` element or text between elements.
      const childSegments = splitChildTagSegments(content);
      for (const seg of childSegments) {
        const trimmed = seg.trim();
        if (!trimmed) continue;
        if (hasNestedTag(trimmed) || /^<\s*[A-Za-z]/.test(trimmed)) {
          // Child element — recurse
          const childResult = emitCreateElementFromExprString(trimmed);
          if (childResult) {
            for (const l of childResult.lines) lines.push(l);
            lines.push(`${elVar}.appendChild(${childResult.varName});`);
          }
        } else {
          // Text content between child elements
          const textParts = [];
          parseLiftContentParts(trimmed, textParts);
          if (textParts.length > 0) {
            const textLines = emitSetContent(elVar, textParts);
            for (const l of textLines) lines.push(l);
          }
        }
      }
    } else {
      const parts = [];
      parseLiftContentParts(content, parts);
      if (parts.length > 0) {
        const contentLines = emitSetContent(elVar, parts);
        for (const l of contentLines) lines.push(l);
      }
    }
  }

  return { lines, varName: elVar };
}

/**
 * Split a content string containing multiple child elements into segments.
 * Each segment is either a complete `< tag ... /` element or text between elements.
 * Uses `/` as the element closer, tracking `<` depth to handle nesting.
 */
function splitChildTagSegments(content) {
  const segments = [];
  let i = 0;
  let segStart = 0;

  while (i < content.length) {
    // Look for a tag open: `< letter` (tokenizer-spaced)
    if (content[i] === '<') {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) j++;
      if (j < content.length && /[A-Za-z]/.test(content[j])) {
        // Found a child tag start — push any text before it
        const textBefore = content.slice(segStart, i).trim();
        if (textBefore) segments.push(textBefore);

        // Find the matching closer `/` for this tag, tracking nesting
        let depth = 1;
        let k = j;
        // Skip past tag name
        while (k < content.length && /[A-Za-z0-9-]/.test(content[k])) k++;
        // Scan for the matching `/` closer
        let inString = null;
        while (k < content.length && depth > 0) {
          const ch = content[k];
          if (inString) {
            if (ch === '\\') { k++; }
            else if (ch === inString) { inString = null; }
          } else if (ch === '"' || ch === "'") {
            inString = ch;
          } else if (ch === '<') {
            // Check if it's another tag open (not closing tag)
            let peek = k + 1;
            while (peek < content.length && /\s/.test(content[peek])) peek++;
            if (peek < content.length && /[A-Za-z]/.test(content[peek])) {
              depth++;
            }
          } else if (ch === '/') {
            depth--;
            if (depth === 0) {
              // Found the closer — include it in the segment
              segments.push(content.slice(i, k + 1).trim());
              segStart = k + 1;
              i = k + 1;
              break;
            }
          }
          k++;
        }
        if (depth > 0) {
          // No closer found — push remainder as text
          segments.push(content.slice(i).trim());
          segStart = content.length;
          i = content.length;
        }
        continue;
      }
    }
    i++;
  }

  // Push any trailing text
  const trailing = content.slice(segStart).trim();
  if (trailing) segments.push(trailing);

  return segments;
}

// ---------------------------------------------------------------------------
// Fragmented for-loop body detection
// ---------------------------------------------------------------------------

/**
 * Check if a for-loop body contains a lift-expr followed by fragmented HTML/logic nodes.
 * This pattern arises from the parser fragmenting `lift <tag>content</tag>` across multiple nodes.
 *
 * Two fragmentation patterns are detected:
 * 1. bare-expr with HTML chars (<, >, /) — explicit HTML fragment tokens
 * 2. tilde-decl with lowercase HTML attribute name — attribute tokens (e.g. `onclick = handler()`)
 *    misparsed as variable assignments when they appeared after a BLOCK_REF split the attribute
 *    stream. For example, `checked=${todo.completed}` causes a BLOCK_REF boundary; the following
 *    `onclick = toggleTodo(id)` tokens fire the tilde-decl rule in parseOneStatement because
 *    IDENT followed by `=` at depth 0 is treated as a variable assignment.
 */
export function hasFragmentedLiftBody(body) {
  if (!body || body.length < 2) return false;
  const hasLift = body.some(n => n && n.kind === "lift-expr");
  // Pattern 1: html-fragment node (Phase 4) or legacy bare-expr with HTML chars
  const hasBareHtmlFragment = body.some(n => n && (
    n.kind === "html-fragment" ||
    (n.kind === "bare-expr" && (
      (typeof n.expr === "string" && /[<>/]/.test(n.expr)) ||
      (n.exprNode && n.exprNode.kind === "escape-hatch")
    ))
  ));
  // Pattern 2: tilde-decl with lowercase HTML attribute name — attribute tokens misparsed
  // as variable assignments. e.g. `onclick = toggleTodo(id)` → tilde-decl{name:"onclick"}
  const hasTildeDeclFragment = body.some(n => n && n.kind === "tilde-decl" &&
    typeof n.name === "string" && /^[a-z][a-z0-9\-_:]*$/.test(n.name));
  return hasLift && (hasBareHtmlFragment || hasTildeDeclFragment);
}

// ---------------------------------------------------------------------------
// emitForStmtWithContainer — for-loop emitter that routes inner lift to parent
// ---------------------------------------------------------------------------

/**
 * Emit a for-of loop where inner lift-expr calls target containerElVar instead
 * of calling _scrml_lift() globally. Used by emitConsolidatedLift to correctly
 * scope nested lift inside a lifted element (§10.6 nested lift scoping rule).
 *
 * Without this helper, a for-loop body's lift-expr nodes call emitLiftExpr()
 * with no containerVar, which emits _scrml_lift(factory) — targeting the global
 * lift accumulator (document.body fallback) instead of the nearest enclosing
 * lifted element.
 *
 * @param {object} forNode — for-stmt AST node
 * @param {string} containerElVar — variable name of the enclosing element to
 *   append to (e.g. the <li> being built by the outer lift)
 * @returns {string}
 */
export function emitForStmtWithContainer(forNode, containerElVar, opts = {}) {
  const lines = [];
  // Bug 65 (S157) — engine codegen ctx threaded to inner lifted handlers
  // (null = engine-free file → tree-shaken, byte-identical pre-fix emission).
  const engineCtx = opts.engineCtx ?? null;
  // A5 (2026-05-17) — destructuring LHS: render structured pattern to JS text.
  let varName;
  if (isDestructurePattern(forNode.variable)) {
    varName = emitDestructurePatternText(forNode.variable);
  } else {
    varName = (typeof forNode.variable === "string" && forNode.variable) || forNode.name || 'item';
  }
  let iterable = forNode.iterable ?? forNode.collection ?? '[]';

  if (typeof iterable === 'string') {
    // C-style for loop: pass through to emitLogicNode (containerVar not needed for C-style)
    const cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
    if (cStyleMatch) {
      return emitLogicNode(forNode, opts.continueBehavior ? { continueBehavior: opts.continueBehavior } : {});
    }
    // Match "( [let|const|var] VAR of EXPR )" or "( VAR of EXPR )"
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === 'item' && forOfMatch[1] !== 'item') {
        varName = forOfMatch[1];
      }
      iterable = forOfMatch[2].trim();
    }
  }

  const rewrittenIterable = emitExprField(forNode.iterExpr, iterable, { mode: "client" });

  // S96 Issue C — Option A nested-in-lift reactive emit.
  //
  // When the iterable contains an @-prefix ref (direct or transitive),
  // emit the reconcile_list shape per-outer-iteration. Mirrors the
  // top-level reactive emit at emit-control-flow.ts:330-408 but appends
  // the wrapper to `containerElVar` instead of using the ambient
  // `_scrml_lift()` (the outer for-stmt already established the container).
  //
  // Pre-S96 the nested codepath always emitted plain `for` regardless of
  // reactivity. Real-code precedent: examples/25-triage-board.scrml has
  // `for (let col of columns) { lift <section> for (let task of @tasks.filter(...)) ... </section> }`
  // — outer is non-reactive (columns is const), inner is reactive (`@tasks`
  // direct ref). Without this branch, the inner list rendered once at
  // module-init and never reactively updated on `@tasks` mutation — the
  // canonical adopter-shape footgun Option A is designed to close.
  //
  // fnBodyRegistry is null here (emit-lift's recursive calls don't thread
  // it). Direct @-refs still resolve via `extractReactiveDeps`; only the
  // transitive-through-fn-call case requires the registry. The triage-board
  // shape is direct, so the predicate fires correctly without registry.
  const iterIsReactive = iterableHasReactiveRefs(forNode, opts.fnBodyRegistry ?? null);
  const body = forNode.body ?? [];

  if (iterIsReactive) {
    const wrapperVar = genVar('list_wrapper');
    const renderFn = genVar('render_list');
    const createFnVar = genVar('create_item');
    const tmpContainerVar = genVar('tmp');

    lines.push(`const ${wrapperVar} = document.createElement("div");`);
    lines.push(`${containerElVar}.appendChild(${wrapperVar});`);

    lines.push(`function ${createFnVar}(${varName}, _scrml_idx) {`);
    lines.push(`  const ${tmpContainerVar} = document.createDocumentFragment();`);

    for (const child of body) {
      if (!child) continue;
      if (child.kind === 'lift-expr') {
        const code = emitLiftExpr(child, { containerVar: tmpContainerVar, engineCtx, scopeVar: varName });
        if (code) {
          for (const line of code.split('\n')) lines.push('  ' + line);
        }
      } else if (child.kind === 'for-stmt') {
        const code = emitForStmtWithContainer(child, tmpContainerVar, { ...opts, continueBehavior: "return" });
        if (code) {
          for (const line of code.split('\n')) lines.push('  ' + line);
        }
      } else if (child.kind === 'if-stmt') {
        const code = emitIfStmtWithContainer(child, tmpContainerVar, { ...opts, continueBehavior: "return", scopeVar: varName });
        if (code) {
          for (const line of code.split('\n')) lines.push('  ' + line);
        }
      } else {
        const code = emitLogicNode(child, { continueBehavior: "return" });
        if (code) lines.push('  ' + code);
      }
    }

    lines.push(`  return ${tmpContainerVar}.firstChild;`);
    lines.push(`}`);

    lines.push(`function ${renderFn}() {`);
    lines.push(`  _scrml_reconcile_list(${wrapperVar}, ${rewrittenIterable}, (item, i) => item?.id != null ? item.id : i, ${createFnVar});`);
    lines.push(`}`);
    lines.push(`${renderFn}();`);
    lines.push(`_scrml_effect_static(${renderFn});`);
    return lines.join('\n');
  }

  // Non-reactive path — plain for loop (pre-S96 behavior, preserved).
  lines.push(`for (const ${varName} of ${rewrittenIterable}) {`);

  for (const child of body) {
    if (!child) continue;
    if (child.kind === 'lift-expr') {
      // Route inner lift to the container element — NOT to _scrml_lift() globally
      const code = emitLiftExpr(child, { containerVar: containerElVar, engineCtx, scopeVar: varName });
      if (code) {
        for (const line of code.split('\n')) lines.push('  ' + line);
      }
    } else if (child.kind === 'for-stmt') {
      // Doubly-nested for-of with inner lift — route to same container
      const code = emitForStmtWithContainer(child, containerElVar, opts);
      if (code) {
        for (const line of code.split('\n')) lines.push('  ' + line);
      }
    } else if (child.kind === 'if-stmt') {
      const code = emitIfStmtWithContainer(child, containerElVar, { ...opts, scopeVar: varName });
      if (code) {
        for (const line of code.split('\n')) lines.push('  ' + line);
      }
    } else {
      const code = emitLogicNode(child, opts.continueBehavior ? { continueBehavior: opts.continueBehavior } : {});
      if (code) lines.push('  ' + code);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// emitIfStmtWithContainer — if-stmt emitter that routes inner lift to parent
// ---------------------------------------------------------------------------

/**
 * Emit an if-statement where inner lift-expr calls target containerElVar instead
 * of calling _scrml_lift() globally. Used by emitCreateElementFromMarkup and
 * emitForStmtWithContainer to correctly scope nested lift inside a lifted
 * element when the source shape is `${ if (cond) { lift <inner/> } }`.
 *
 * Body children are dispatched recursively by kind so for-stmt / if-stmt /
 * lift-expr inside the consequent or alternate all flow to containerElVar.
 *
 * @param {object} ifNode — if-stmt AST node
 * @param {string} containerElVar — variable name of the enclosing element to
 *   append to
 * @returns {string}
 */
export function emitIfStmtWithContainer(ifNode, containerElVar, opts = {}) {
  const lines = [];
  // Bug 65 (S157) — engine codegen ctx threaded to inner lifted handlers.
  const engineCtx = opts.engineCtx ?? null;
  const cond = ifNode.condition ?? ifNode.test ?? "true";
  const rewrittenCond = emitExprField(ifNode.condExpr, cond, { mode: "client" });

  const emitBody = (body) => {
    const out = [];
    const arr = Array.isArray(body) ? body : (body ? [body] : []);
    for (const child of arr) {
      if (!child) continue;
      if (child.kind === 'lift-expr') {
        const code = emitLiftExpr(child, { containerVar: containerElVar, engineCtx, scopeVar: opts.scopeVar ?? null });
        if (code) for (const line of code.split('\n')) out.push('  ' + line);
      } else if (child.kind === 'for-stmt') {
        const code = emitForStmtWithContainer(child, containerElVar, opts);
        if (code) for (const line of code.split('\n')) out.push('  ' + line);
      } else if (child.kind === 'if-stmt') {
        const code = emitIfStmtWithContainer(child, containerElVar, opts);
        if (code) for (const line of code.split('\n')) out.push('  ' + line);
      } else {
        const code = emitLogicNode(child, opts.continueBehavior ? { continueBehavior: opts.continueBehavior } : {});
        if (code) out.push('  ' + code);
      }
    }
    return out;
  };

  lines.push(`if (${rewrittenCond}) {`);
  for (const l of emitBody(ifNode.consequent ?? ifNode.body)) lines.push(l);
  lines.push('}');
  if (ifNode.alternate) {
    lines.push('else {');
    for (const l of emitBody(ifNode.alternate)) lines.push(l);
    lines.push('}');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// emitConsolidatedLift — fragmented for-loop body path
// ---------------------------------------------------------------------------

/**
 * Emit createElement JS from a fragmented for-loop body.
 * Handles the pattern where `lift <tag>content</tag>` is fragmented across multiple
 * AST nodes due to BLOCK_REF boundaries (interpolations like `${expr}`).
 *
 * Body structure example (for `lift <li>${link}/`):
 *   [lift-expr{expr="< li >"}, logic{bare-expr:"link"}, bare-expr("< / a > < / li >")]
 *
 * Returns JS string with createElement chains wrapped in `_scrml_lift(() => {...})`.
 *
 * @param {object[]} body
 * @param {object} [opts] — optional context
 * @param {string} [opts.containerVar] — when set, emit `containerVar.appendChild(factory())`
 *   instead of `_scrml_lift(factory)`. Used by reactive list render functions (§6.5.3).
 */
export function emitConsolidatedLift(body, opts = {}) {
  // Find the first lift-expr
  const liftIdx = body.findIndex(n => n && n.kind === "lift-expr");
  if (liftIdx === -1) return "";

  const containerVar = opts.containerVar ?? null;
  const directReturn = opts.directReturn ?? false;
  // Bug 65 (S157) — engine codegen ctx for lifted engine-transition handlers
  // (null = engine-free file → tree-shaken, byte-identical pre-fix emission).
  const engineCtx = opts.engineCtx ?? null;
  // Bug 72 (S158) — enclosing `for`-loop variable threaded down so a nested
  // `<each>` inside the lifted markup lowers its inner `@.` to the inner each's
  // iter var (§17.7.3 innermost-scope rule). null = no enclosing for (top-level
  // lift) → byte-identical pre-fix emission; the markup walker treats a `<each>`
  // child as a generic element when scopeVar is null.
  const scopeVar = opts.scopeVar ?? null;

  // Pre-statements (before the lift)
  const preStatements = [];
  for (let i = 0; i < liftIdx; i++) {
    const child = body[i];
    if (!child) continue;
    const code = emitLogicNode(child, opts);
    if (code) preStatements.push(code);
  }

  // Check if the lift-expr has a full markup AST — emit directly
  const firstLift = body[liftIdx];
  if (firstLift && firstLift.kind === "lift-expr" && firstLift.expr) {
    const liftExpr = firstLift.expr;
    if (liftExpr.kind === "markup" && liftExpr.node) {
      const lines = [];
      const rootVar = emitCreateElementFromMarkup(liftExpr.node, lines, engineCtx, scopeVar);
      const factoryBody = lines.join("\n    ");
      let factoryCode;
      if (directReturn) {
        factoryCode = `${factoryBody}\n  return ${rootVar};`;
      } else if (containerVar) {
        factoryCode = `${containerVar}.appendChild((() => {\n    ${factoryBody}\n    return ${rootVar};\n  })());`;
      } else {
        factoryCode = `_scrml_lift(() => {\n    ${factoryBody}\n    return ${rootVar};\n  });`;
      }
      const allLines = [...preStatements, factoryCode];
      return allLines.join("\n  ");
    }
  }

  // -----------------------------------------------------------------------
  // Nested element tree builder
  //
  // Instead of creating a single flat element, we build a proper tree by
  // tracking an element stack. Nested opening tags push new elements onto
  // the stack; closing tags pop them. Content and interpolations go into
  // the current top-of-stack element. Logic blocks (for-loops, if-stmts)
  // that contain lift children get their output appended to the current
  // parent element.
  // -----------------------------------------------------------------------

  const lines = [];
  // Element stack: [{ varName, tag }]
  const elementStack = [];

  // pendingAttrName: tracks when a BLOCK_REF splits an attribute (e.g. checked=${expr})
  // When attrsStr ends with `attrname =`, the next logic node is the attribute VALUE,
  // not text content of the element.
  let pendingAttrName = null;

  /** Get the current parent element variable (top of stack) */
  function currentParent() {
    return elementStack.length > 0 ? elementStack[elementStack.length - 1].varName : null;
  }

  /** Get the current element entry (top of stack). */
  function currentElement() {
    return elementStack.length > 0 ? elementStack[elementStack.length - 1] : null;
  }

  /**
   * Create a new element, emit setAttribute calls, and optionally
   * appendChild to the current parent.
   *
   * FIX (toggle-checkbox-trace): Detect and strip a trailing incomplete attribute
   * BEFORE calling parseAttrs. This prevents spurious empty-value entries like
   * setAttribute("data-id", "") when the tokenizer fragments `data-id=${expr}` as
   * `data - id =` (raw text) followed by a BLOCK_REF for the value.
   * The trailing regex also matches tokenizer-spaced hyphenated names like `data - id`.
   */
  function pushElement(tag, attrsStr) {
    pendingAttrName = null;
    const elVar = genVar(`lift_el`);
    lines.push(`const ${elVar} = document.createElement(${JSON.stringify(tag)});`);
    if (attrsStr) {
      // Detect and strip a trailing incomplete attribute (e.g. `checked =` or `data - id =`)
      // BEFORE calling parseAttrs. This happens when a BLOCK_REF splits the attribute value
      // from its name. The tokenizer spaces hyphens: `data-id` becomes `data - id`.
      // Stripping prevents parseAttrs from emitting a spurious empty-value entry like
      // setAttribute("data-id", "") followed by a separate setAttribute("id", todo.id).
      let cleanAttrsStr = attrsStr.trim();
      const trailingMatch = /([a-z][a-z0-9_]*(?:\s*-\s*[a-z][a-z0-9_]*)*)\s*=\s*$/.exec(cleanAttrsStr);
      if (trailingMatch) {
        // Remove the trailing `name =` (including tokenizer-spaced forms like `data - id =`)
        cleanAttrsStr = cleanAttrsStr.slice(0, cleanAttrsStr.length - trailingMatch[0].length).trim();
        // Normalize the name: collapse tokenizer spaces around hyphens (`data - id` → `data-id`)
        pendingAttrName = trailingMatch[1].replace(/\s*-\s*/g, "-");
      }
      const attrs = parseAttrs(cleanAttrsStr);
      const attrLines = emitSetAttrs(elVar, attrs, engineCtx);
      for (const l of attrLines) lines.push(l);
    }
    const parent = currentParent();
    if (parent) {
      lines.push(`${parent}.appendChild(${elVar});`);
    }
    elementStack.push({ varName: elVar, tag });
    return elVar;
  }

  /** Pop element stack on closing tag. */
  function popElement(tag) {
    pendingAttrName = null;
    if (elementStack.length > 1) {
      // Pop the top element — it's already been appended to its parent
      const top = elementStack[elementStack.length - 1];
      // Only pop if the tag matches (or if it's a mismatched close, still pop to recover)
      elementStack.pop();
    }
  }

  /** Add text/expression content to the current element. */
  function addContentToCurrentElement(parts) {
    const parent = currentParent();
    if (!parent || parts.length === 0) return;
    // Do not add text content to void elements (e.g. <input>, <br>, <img>)
    const curEl = currentElement();
    if (curEl && VOID_ELEMENTS.has(curEl.tag)) return;
    const contentLines = emitSetContent(parent, parts);
    for (const l of contentLines) lines.push(l);
  }

  /**
   * Process a content string that may contain multiple nested tags.
   * Handles: text, opening tags (push element), closing tags (pop element).
   */
  function processContentWithTags(content) {
    if (!content || !content.trim()) return;

    // If no HTML tags at all, treat as plain content
    if (!hasNestedTag(content) && !containsClosingTag(content)) {
      const parts = [];
      // Strip trailing / (lift closer)
      const cleaned = content.replace(/\s*\/\s*$/, "").trim();
      if (cleaned) {
        parseLiftContentParts(cleaned, parts);
        addContentToCurrentElement(parts);
      }
      return;
    }

    const segments = splitTagSegments(content);
    for (const seg of segments) {
      if (seg.type === "open-tag") {
        pushElement(seg.tag, seg.attrsStr || "");
      } else if (seg.type === "close-tag") {
        popElement(seg.tag);
      } else if (seg.type === "text") {
        let text = seg.text;
        // Strip trailing / (lift closer)
        text = text.replace(/\s*\/\s*$/, "").trim();
        // Skip bare > fragments (tag closers that got separated from the tag)
        if (!text || text === ">") continue;
        const parts = [];
        parseLiftContentParts(text, parts);
        addContentToCurrentElement(parts);
      }
    }
  }

  // Parse the root element from the lift-expr
  let rootTag = "div";
  let rootAttrsStr = "";
  let rootContent = "";

  const liftNode = body[liftIdx];
  if (liftNode && liftNode.kind === "lift-expr" && liftNode.expr) {
    const liftExpr = liftNode.expr;
    if (liftExpr.kind === "expr" && typeof liftExpr.expr === "string") {
      const expr = liftExpr.expr.trim();
      const parsed = parseTagExprString(expr);
      if (parsed) {
        rootTag = parsed.tag;
        rootAttrsStr = parsed.attrsStr;
        rootContent = parsed.content || "";
      }
    }
  }

  // Create the root element
  const rootVar = pushElement(rootTag, rootAttrsStr);

  // Process any content/nested tags from the lift-expr itself
  if (rootContent) {
    processContentWithTags(rootContent);
  }

  // Walk remaining body nodes after the lift-expr
  for (let i = liftIdx + 1; i < body.length; i++) {
    const child = body[i];
    if (!child) continue;

    if (child.kind === "logic" && child.body) {
      // Logic block: ${expr} interpolation or ${for loop} or ${if stmt}
      // Check if the logic body contains only bare-expr nodes (simple interpolation)
      const hasComplexChildren = child.body.some(n => n && (
        n.kind === "for-stmt" || n.kind === "if-stmt" || n.kind === "while-stmt" ||
        n.kind === "lift-expr" || n.kind === "function-decl"
      ));

      if (hasComplexChildren) {
        // Complex logic block — emit each child, routing lift output to current parent
        const parent = currentParent();
        for (const logicChild of child.body) {
          if (!logicChild) continue;
          if (logicChild.kind === "lift-expr") {
            const code = emitLiftExpr(logicChild, { containerVar: parent, scopeVar });
            if (code) lines.push(code);
          } else if (logicChild.kind === "for-stmt" && parent) {
            // FIX (b2-nested-lift): route inner for-loop's lift-exprs to the current
            // parent element instead of emitting _scrml_lift() globally. Without this,
            // lift <span> inside for (item of group.items) targets document.body, not <li>.
            const code = emitForStmtWithContainer(logicChild, parent);
            if (code) lines.push(code);
          } else {
            // Other nodes (if-stmt, while-stmt, function-decl) — emit via emitLogicNode
            const code = emitLogicNode(logicChild, opts);
            if (code) lines.push(code);
          }
        }
      } else {
        // Simple interpolation — extract bare-expr values as content or attribute values
        for (const logicChild of child.body) {
          // Phase 4d Step 8: ExprNode-only guard (bare-expr.expr deleted)
          if (logicChild && logicChild.kind === "bare-expr" && (logicChild.exprNode || logicChild.expr)) {
            if (pendingAttrName !== null) {
              // This logic node is the value for a BLOCK_REF-split attribute
              // e.g. `checked = ${todo.completed}` — the `todo.completed` part
              // For event attributes (e.g. oninput, onclick), use addEventListener.
              const elVar = currentParent();
              if (elVar) {
                const attrName = pendingAttrName;
                pendingAttrName = null;
                const rewritten = emitExprField(logicChild.exprNode, logicChild.expr ?? "", { mode: "client" });
                if (/^on[a-z]/.test(attrName)) {
                  const eventName = attrName.replace(/^on/, "");
                  lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${rewritten}; });`);
                } else {
                  lines.push(`${elVar}.setAttribute(${JSON.stringify(attrName)}, String(${rewritten} ?? ""));`);
                }
              }
            } else {
              // Phase 4d Step 8: ExprNode-only (bare-expr.expr deleted)
              const _exprStr = logicChild.exprNode ? emitStringFromTree(logicChild.exprNode) : (logicChild.expr ?? "");
              const parts = [{ type: "expr", value: _exprStr }];
              addContentToCurrentElement(parts);
            }
          }
        }
      }
    } else if (child.kind === "html-fragment" && typeof child.content === "string") {
      // Phase 4: html-fragment nodes carry the same content that bare-expr.expr had
      let expr = child.content.trim();
      if (!expr) continue;
      if (/^\/\s*$/.test(expr)) continue;
      if (expr === ">") continue;
      const isAttrContinuation = !expr.startsWith("<") &&
        /^[a-z][a-z0-9\-_:]*\s*=/.test(expr);
      if (isAttrContinuation) {
        const elEntry = currentElement();
        if (elEntry) {
          const firstTagIdx = expr.search(/<\s*[A-Za-z/]/);
          const attrPart = firstTagIdx === -1 ? expr : expr.slice(0, firstTagIdx);
          const remainder = firstTagIdx === -1 ? "" : expr.slice(firstTagIdx);
          const attrs = parseAttrs(attrPart);
          const attrLines = emitSetAttrs(elEntry.varName, attrs, engineCtx);
          for (const l of attrLines) lines.push(l);
          pendingAttrName = null;
          if (remainder.trim()) {
            processContentWithTags(remainder);
          }
        }
        continue;
      }
      if (hasNestedTag(expr) || isClosingTagFragment(expr) || containsClosingTag(expr)) {
        processContentWithTags(expr);
      } else {
        expr = expr.replace(/\s*\/\s*$/, "").trim();
        if (expr) {
          const parts = [];
          parseLiftContentParts(expr, parts);
          addContentToCurrentElement(parts);
        }
      }
    } else if (child.kind === "bare-expr" && (child.expr || child.exprNode)) {
      // Phase 4d: ExprNode-first, string fallback
      let expr = (child.exprNode ? emitStringFromTree(child.exprNode) : (child.expr || "")).trim();
      if (!expr) continue;
      // Skip bare / (lift closer)
      if (/^\/\s*$/.test(expr)) continue;
      // Skip bare >
      if (expr === ">") continue;

      // Detect attribute continuation: a fragment that starts with an attribute name
      // followed by `=` (without a leading `<`). This happens when a void element's
      // remaining attributes are flushed as a text fragment after a BLOCK_REF split.
      // Examples: `onclick = toggleTodo ( todo . id ) / >` or `type = "checkbox"`
      const isAttrContinuation = !expr.startsWith("<") &&
        /^[a-z][a-z0-9\-_:]*\s*=/.test(expr);
      if (isAttrContinuation) {
        const elEntry = currentElement();
        if (elEntry) {
          // Split: attr part is before the first `<` tag marker (if any)
          const firstTagIdx = expr.search(/<\s*[A-Za-z/]/);
          const attrPart = firstTagIdx === -1 ? expr : expr.slice(0, firstTagIdx);
          const remainder = firstTagIdx === -1 ? "" : expr.slice(firstTagIdx);
          const attrs = parseAttrs(attrPart);
          const attrLines = emitSetAttrs(elEntry.varName, attrs, engineCtx);
          for (const l of attrLines) lines.push(l);
          pendingAttrName = null;
          if (remainder.trim()) {
            processContentWithTags(remainder);
          }
        }
        continue;
      }

      // Process content that may contain opening/closing tags
      if (hasNestedTag(expr) || isClosingTagFragment(expr) || containsClosingTag(expr)) {
        processContentWithTags(expr);
      } else {
        // Plain text/expression content
        expr = expr.replace(/\s*\/\s*$/, "").trim();
        if (expr) {
          const parts = [];
          parseLiftContentParts(expr, parts);
          addContentToCurrentElement(parts);
        }
      }
    }
    // tilde-decl: an HTML attribute assignment that the AST builder misidentified as a
    // variable declaration. This happens when attribute tokens like `onclick = toggleTodo(id)`
    // appear after a BLOCK_REF split the attribute stream (e.g. `checked=${expr}` causes a
    // BLOCK_REF; the following `onclick =` tokens fire the tilde-decl rule because IDENT
    // followed by `=` at depth 0 is parsed as a variable assignment by parseOneStatement).
    // Guard: only treat as attr if the name matches the HTML attribute pattern (all lowercase).
    else if (child.kind === "tilde-decl" && /^[a-z][a-z0-9\-_:]*$/.test(child.name || "")) {
      const elEntry = currentElement();
      if (elEntry) {
        const attrName = child.name;
        // Phase 4d: ExprNode-first, string fallback
        const rawInit = (child.initExpr ? emitStringFromTree(child.initExpr) : (child.init || "")).trim();

        // Split the init at the first ` / >` self-closer, respecting paren depth.
        // Example: `toggleTodo ( todo . id ) / > < label ondblclick = startEdit ( ... ) >`
        //   → attrValue = `toggleTodo ( todo . id )`, remainder = `< label ondblclick = ... >`
        let attrValue = rawInit;
        let remainder = "";
        let depth = 0;
        let selfCloserIdx = -1;
        for (let ci = 0; ci < rawInit.length; ci++) {
          if (rawInit[ci] === "(") depth++;
          else if (rawInit[ci] === ")") depth--;
          else if (depth === 0 && rawInit[ci] === "/") {
            let j = ci + 1;
            while (j < rawInit.length && /\s/.test(rawInit[j])) j++;
            if (j < rawInit.length && rawInit[j] === ">") {
              selfCloserIdx = ci;
              break;
            }
          }
        }
        if (selfCloserIdx !== -1) {
          attrValue = rawInit.slice(0, selfCloserIdx).trim();
          // Advance past `/ >` — skip `/`, optional whitespace, `>`
          let afterSelfCloser = selfCloserIdx + 1;
          while (afterSelfCloser < rawInit.length && /\s/.test(rawInit[afterSelfCloser])) afterSelfCloser++;
          afterSelfCloser++; // skip `>`
          while (afterSelfCloser < rawInit.length && /\s/.test(rawInit[afterSelfCloser])) afterSelfCloser++;
          remainder = rawInit.slice(afterSelfCloser).trim();
        }

        // Apply the attribute to the current element using the existing attr/event emitter
        const syntheticAttrsStr = attrName + " = " + attrValue;
        const attrs = parseAttrs(syntheticAttrsStr);
        const attrLines = emitSetAttrs(elEntry.varName, attrs, engineCtx);
        for (const l of attrLines) lines.push(l);
        pendingAttrName = null;

        // Pop void elements that are now fully closed (self-closer was present in the init)
        if (selfCloserIdx !== -1 && VOID_ELEMENTS.has(elEntry.tag)) {
          popElement(elEntry.tag);
        }

        // Process any content following the self-closer (sibling tags and text)
        if (remainder) {
          processContentWithTags(remainder);
        }
      }
    }
    // Other node kinds (for-stmt, if-stmt at top level of body) —
    // emit as JS inside the factory
    else if (child.kind === "for-stmt") {
      // FIX (b2-nested-lift): route inner lift-exprs to the current element (§10.6).
      // Top-level for-stmt in the body loop means we're inside a lifted element;
      // currentParent() returns that element. Route lift-exprs there, not globally.
      const parent = currentParent();
      if (parent) {
        const code = emitForStmtWithContainer(child, parent, { engineCtx });
        if (code) lines.push(code);
      } else {
        const code = emitLogicNode(child, opts);
        if (code) lines.push(code);
      }
    } else if (child.kind === "if-stmt" || child.kind === "while-stmt") {
      const code = emitLogicNode(child, opts);
      if (code) lines.push(code);
    }
  }

  const factoryBody = lines.join("\n    ");
  let factoryCode;
  if (directReturn) {
    factoryCode = `${factoryBody}\n  return ${rootVar};`;
  } else if (containerVar) {
    factoryCode = `${containerVar}.appendChild((() => {\n    ${factoryBody}\n    return ${rootVar};\n  })());`;
  } else {
    factoryCode = `_scrml_lift(() => {\n    ${factoryBody}\n    return ${rootVar};\n  });`;
  }
  const allLines = [...preStatements, factoryCode];
  return allLines.join("\n  ");
}

// ---------------------------------------------------------------------------
// emitLiftExpr — main entry point
// ---------------------------------------------------------------------------

/**
 * Emit a lift expression — generates a _scrml_lift(() => element) runtime call.
 *
 * Lift expressions come in two forms:
 * 1. { kind: "markup", node: MarkupAST } — inline markup block
 * 2. { kind: "expr", expr: string } — text expression like "<li>${item}/"
 *
 * For markup nodes, we walk the AST and emit createElement chains.
 * For expr strings, we parse `< tag > content /` patterns and generate
 * createElement chains. Event handlers become real closures via addEventListener.
 *
 * If no tag pattern is found, we emit _scrml_lift(() => document.createTextNode(expr)).
 *
 * @param {object} node — lift-expr AST node
 * @param {object} [opts] — optional context
 * @param {string} [opts.containerVar] — when set, emit `containerVar.appendChild(factory())`
 *   instead of `_scrml_lift(factory)`. Used by reactive list render functions (§6.5.3).
 * @returns {string}
 */
export function emitLiftExpr(node, opts = {}) {
  if (!node || !node.expr) return "";

  const containerVar = opts.containerVar ?? null;
  // Bug 65 (S157) — engine codegen ctx for lifted engine-transition handlers.
  const engineCtx = opts.engineCtx ?? null;
  // Bug 72 (S158) — the enclosing `for`-loop variable (threaded from
  // emitForStmtWithContainer); enables a nested `<each>` in the lifted markup
  // to resolve its iteration source against the for-loop scope. Null at the top
  // markup level (no enclosing for) — a nested each there falls back to literal.
  const scopeVar = opts.scopeVar ?? null;
  const liftExpr = node.expr;

  if (liftExpr.kind === "markup" && liftExpr.node) {
    // Full markup AST node — walk recursively and emit createElement chains
    const lines = [];
    const rootVar = emitCreateElementFromMarkup(liftExpr.node, lines, engineCtx, scopeVar);
    const factoryBody = lines.join("\n  ");
    if (containerVar) {
      return `${containerVar}.appendChild((() => {\n  ${factoryBody}\n  return ${rootVar};\n})());`;
    }
    return `_scrml_lift(() => {\n  ${factoryBody}\n  return ${rootVar};\n});`;
  }

  if (liftExpr.kind === "expr" && typeof liftExpr.expr === "string") {
    const expr = liftExpr.expr.trim();

    // LIFT APPROACH C (S18 cleanup): the BS+TAB re-parse fork that lived here
    // was confirmed dead by S14 instrumentation (0 hits across 14 examples +
    // 275 samples + compilation-tests). Real inline-markup lifts take the
    // `{kind: "markup"}` branch above. Remaining `{kind: "expr"}` inputs are
    // either:
    //   - Bare tags like `< ComponentName >` → handled by emitCreateElementFromExprString below
    //   - Non-markup text (identifier, @var, expression) → createTextNode fallback
    // The BS+TAB re-parse was redundant with emitCreateElementFromMarkup for
    // the first group and never reached for the second. Deleted.

    // Bare/short-form tag (e.g. `< ComponentName >` without closer) — string parser.
    const result = emitCreateElementFromExprString(expr);
    if (result) {
      const { lines, varName } = result;
      const factoryBody = lines.join("\n  ");
      if (containerVar) {
        return `${containerVar}.appendChild((() => {\n  ${factoryBody}\n  return ${varName};\n})());`;
      }
      return `_scrml_lift(() => {\n  ${factoryBody}\n  return ${varName};\n});`;
    }

    // No tag pattern at all — emit as text node
    const rewritten = emitExprField(liftExpr.exprNode, expr, { mode: "client" });
    if (containerVar) {
      return `${containerVar}.appendChild(document.createTextNode(String(${rewritten} ?? "")));`;
    }
    return `_scrml_lift(() => document.createTextNode(String(${rewritten} ?? "")));`;
  }

  return "";
}
