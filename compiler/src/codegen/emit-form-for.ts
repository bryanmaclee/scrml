/**
 * @module codegen/emit-form-for
 *
 * §41.14 (S102) — formFor type-driven form generation: AST-level expansion.
 *
 * `<formFor for=StructType .../>` is the second general-position member of
 * the §53.14 type-as-argument family. The type-system stage recognizes the
 * markup element, validates the `for=` attribute against the file's struct
 * typeRegistry (and the other 7 normative error codes per §41.14.1-§41.14.8),
 * then calls into this module's `expandFormFor()` to produce the equivalent
 * Shape 2 + <errors of=> + <form action=> markup tree (§41.14.10).
 *
 * **Approach A — source-level expansion** per the brief's PA recommendation
 * and the Pillar-5 invariant in §41.14.10 ("emitted output is standard scrml
 * — readable as if hand-authored — and rides existing emission pipelines
 * for §6.2 Shape 2 + §55 validity surface + §16 slots + §5.2.3 event
 * handlers"). The expander produces AST nodes that downstream stages
 * (DG / VSS / CG) consume identically to hand-authored Shape 2 + <form>.
 *
 * Two AST nodes are returned:
 *   1. A compound state-decl (Variant C structural form, §6.3.2) named
 *      after the struct (camel-cased) or `as=@varName` override. Per-field
 *      Shape 2 sub-cells (§6.2 Shape 2 decl-with-render-spec) carry their
 *      validators so the §55 auto-validity surface fires.
 *   2. A <form> markup element (with onsubmit=fn wiring + structural-default
 *      `action="/api/<route>" method="POST"` when onsubmit resolves to a
 *      server function per §41.14.3 + §12.5) containing per-field <label>
 *      + <varName/> render-by-tag + <errors of=@cell.field/> blocks +
 *      submit button (or slot override).
 *
 * Cross-references:
 *   §41.14.1   — type argument (E-FORMFOR-TYPE-NOT-STRUCT)
 *   §41.14.2   — auto-synthesized compound state cell + per-field Shape 2
 *   §41.14.3   — onsubmit= wiring + PE-default action= for server fns
 *   §41.14.4   — per-field customization via §16 slots
 *   §41.14.5   — pick=/omit=/partial= field-set transforms
 *   §41.14.6   — error-strategy= attribute
 *   §41.14.7   — label resolution chain (mechanical default + registerLabels)
 *   §41.14.8   — nested struct field handling (slot required; v1.0)
 *   §41.14.10  — codegen contract (Shape 2 + <errors> + <form action=>)
 *   §6.2       — Shape 2 decl-coupled-with-render-spec
 *   §6.3.2     — Variant C structural compound state
 *   §55.5-55.8 — auto-synthesized validity surface + <errors of=> element
 *   §16        — Component Slots (override mechanism)
 *   §5.2.3     — bare-form event handler shape
 *   §12.5      — route inference (PE action= derivation)
 */

// Mirror of the StructType shape from type-system.ts — accept structurally
// to avoid a cross-module type dependency. Keep this in sync with §41.14.2.
export interface FormForStructLike {
  kind: "struct";
  name: string;
  // Map<fieldName, fieldType> — value's `kind` is "primitive"|"predicated"|"struct"|...
  // For v1.0 we only consume `kind` + `name` and (for predicated) `baseType`.
  fields: Map<string, unknown>;
}

/**
 * Per-field metadata used by the expander to decide the input shape +
 * validators. The struct typeRegistry stores ResolvedType per field but
 * not the raw "req length(>=2)" validator tokens that adopters write
 * verbatim in the struct body. We surface both: the resolved field type
 * (for input-tag selection) AND the raw validator-clause text (for
 * Shape 2 validator attachment + §55 auto-synth fire).
 */
export interface FieldInfo {
  name: string;
  /** Underlying primitive type: "string" | "number" | "integer" | "boolean" | "struct" | "enum" | "asIs". */
  baseTypeName: string;
  /** Display label per §41.14.7 mechanical-default fallback (title-case the field name). */
  label: string;
  /** Validators parsed from the struct field body — `req`, `length(...)`, `pattern(...)`, etc. */
  validators: FormForValidator[];
  /** True if this field's resolved type is `struct` — requires slot override per §41.14.8. */
  isNestedStruct: boolean;
}

export interface FormForValidator {
  name: string;            // "req" | "length" | "pattern" | "min" | "max" | "gt" | "lt" | "gte" | "lte" | "eq" | "neq" | "oneOf" | "notIn" | "custom"
  argsRaw: string | null;  // raw text inside parens, or null for arg-less validators like `req`
}

/**
 * Pipeline-input contract for the expander. Built by the type-system stage
 * after all validation passes; if any required validation failed, no expansion
 * happens (the formFor node is left in place so emit-html.ts can still emit a
 * harmless placeholder if codegen runs despite the TS error).
 */
export interface FormForExpansion {
  // Final cell name (camel-cased struct name OR `as=@varName` override).
  cellName: string;
  // Struct name verbatim — used for friendlier error messages downstream.
  structName: string;
  // Ordered list of fields (post-pick/omit/partial transforms).
  includedFields: FieldInfo[];
  // Slot-overrides keyed by field name (+ "submit"). Each value is the raw
  // markup-AST subtree from the original <formFor> body.
  slotOverrides: Map<string, unknown[]>;
  // onsubmit=fn ident + resolved boundary ("server" | "client" | null when absent).
  onsubmitFnName: string | null;
  onsubmitBoundary: "server" | "client" | null;
  // PE-default `action=` URL derived from onsubmit-fn route (§41.14.3 + §12.5).
  // Empty string when onsubmit is client-side OR unresolved.
  peActionUrl: string;
  // Error rendering strategy per §41.14.6 (default "per-field").
  errorStrategy: "per-field" | "summary" | "both";
  // Partial mode (relaxes `req` validators across all fields per §41.14.5).
  partial: boolean;
  // Source span of the original <formFor> node, propagated to every synth
  // sub-node so diagnostics + source-maps point at the original call site.
  span: unknown;
}

// ---------------------------------------------------------------------------
// Validator parsing — extract the bare-token + paren-arg shapes from a raw
// struct field clause like `string req length(>=2) pattern(/^[^@]+@[^@]+$/)`.
// ---------------------------------------------------------------------------

const VALIDATOR_NAMES = new Set([
  "req", "length", "pattern", "min", "max",
  "gt", "lt", "gte", "lte", "eq", "neq",
  "oneOf", "notIn", "custom",
]);

/**
 * Parse the validator tokens out of a raw struct-field clause. The base type
 * portion is dropped (we already have the resolved typeRegistry kind).
 *
 *   "string req length(>=2)"            → [{name:"req"}, {name:"length", argsRaw:">=2"}]
 *   "string req pattern(/^[^@]+@[^@]+$/)"→ [{name:"req"}, {name:"pattern", argsRaw:"/^[^@]+@[^@]+$/"}]
 *   "boolean req"                       → [{name:"req"}]
 *   "string"                            → []
 *   "(string -> string)"                → []   (lifecycle annotation — skip)
 *
 * The parser walks left-to-right, identifies bare-token + paren shapes, and
 * keeps only those whose names are in VALIDATOR_NAMES. Unknown tokens
 * (including the base type itself) are skipped.
 */
export function parseValidatorClauses(raw: string): FormForValidator[] {
  const validators: FormForValidator[] = [];
  if (!raw) return validators;

  let s = raw.trim();
  // Lifecycle annotation `(A -> B)` — no validators inside this form.
  if (s.startsWith("(") && s.includes("->")) return validators;

  let i = 0;
  while (i < s.length) {
    // Skip whitespace.
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    // Read an identifier.
    const identStart = i;
    while (i < s.length && /[A-Za-z_$0-9]/.test(s[i])) i++;
    if (i === identStart) {
      // Non-identifier char — advance and retry.
      i++;
      continue;
    }
    const ident = s.slice(identStart, i);

    // Skip whitespace.
    while (i < s.length && /\s/.test(s[i])) i++;

    // Check for paren-arg form.
    let argsRaw: string | null = null;
    if (i < s.length && s[i] === "(") {
      // Find matching close paren (depth-aware, accounting for slashes / strings).
      let depth = 0;
      let inSQ = false;
      let inDQ = false;
      let inRegex = false;
      let closeIdx = -1;
      for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (inSQ) { if (c === "'" && s[j - 1] !== "\\") inSQ = false; continue; }
        if (inDQ) { if (c === '"' && s[j - 1] !== "\\") inDQ = false; continue; }
        if (inRegex) { if (c === "/" && s[j - 1] !== "\\") inRegex = false; continue; }
        if (c === "'") { inSQ = true; continue; }
        if (c === '"') { inDQ = true; continue; }
        if (c === "/") { inRegex = true; continue; }
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) { closeIdx = j; break; }
        }
      }
      if (closeIdx === -1) {
        // Malformed paren — give up on this clause to avoid corrupting downstream.
        break;
      }
      argsRaw = s.slice(i + 1, closeIdx);
      i = closeIdx + 1;
    }

    if (VALIDATOR_NAMES.has(ident)) {
      validators.push({ name: ident, argsRaw });
    }
    // Unknown token (base type, etc.) — skip and continue.
  }

  return validators;
}

// ---------------------------------------------------------------------------
// Mechanical label default — §41.14.7 step 4.
// ---------------------------------------------------------------------------

/**
 * Title-case a camelCase field name with intra-word boundary detection.
 * Per §41.14.7 mechanical-default fallback:
 *   "email"           → "Email"
 *   "emailAddress"    → "Email Address"
 *   "agreeToTerms"    → "Agree To Terms"
 *   "firstName"       → "First Name"
 */
export function mechanicalLabel(fieldName: string): string {
  if (!fieldName) return "";
  // Insert a space before each upper-case letter that follows a lower-case one.
  const spaced = fieldName.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Title-case the first letter of each word.
  return spaced.replace(/(^|\s)([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
}

// ---------------------------------------------------------------------------
// Camel-case the struct name for the synthesized compound cell.
// ---------------------------------------------------------------------------

/**
 * Lowercase the first character of a struct name (§41.14.2 default cell name).
 *   "Signup"        → "signup"
 *   "UserAccount"   → "userAccount"
 *   "URL"           → "uRL"   (degenerate case — adopters use as=@varName)
 */
export function camelizeStructName(structName: string): string {
  if (!structName) return structName;
  return structName[0].toLowerCase() + structName.slice(1);
}

// ---------------------------------------------------------------------------
// Per-field type → input shape mapping.
// ---------------------------------------------------------------------------

/**
 * Pick the canonical input element shape for a field based on its baseTypeName.
 *
 * For v1.0:
 *   "string"   → <input type="text"/>     (default; refinement-typed string with
 *                                          email/url/tel patterns is REFINED below)
 *   "boolean"  → <input type="checkbox"/>
 *   "number"   → <input type="number"/>
 *   "integer"  → <input type="number" step="1"/>
 *   default    → <input type="text"/>     (conservative fallback)
 *
 * v1.next: extend with smart-type detection (email-pattern → type="email", etc.)
 * — left as a TODO until refinement-type predicates make the call-site obvious.
 */
export function inputShapeForFieldType(baseTypeName: string): InputShape {
  switch (baseTypeName) {
    case "boolean":
      return { tag: "input", type: "checkbox" };
    case "number":
      return { tag: "input", type: "number" };
    case "integer":
      return { tag: "input", type: "number", step: "1" };
    case "string":
    default:
      return { tag: "input", type: "text" };
  }
}

export interface InputShape {
  tag: string;
  type?: string;
  step?: string;
}

/**
 * Pick the canonical `bind:*` attribute name per §5.4 dispatch table.
 *   <input type="checkbox"/> → bind:checked
 *   <input type="file"/>     → bind:files
 *   <input type="number"/>   → bind:valueAsNumber
 *   <textarea> / <select>    → bind:value
 *   default                  → bind:value
 */
export function pickBindAttrName(shape: InputShape): string {
  if (shape.type === "checkbox") return "bind:checked";
  if (shape.type === "file") return "bind:files";
  if (shape.type === "number") return "bind:valueAsNumber";
  return "bind:value";
}

// ---------------------------------------------------------------------------
// AST builder helpers — construct the synthesized AST nodes.
//
// These shapes mirror what ast-builder.js produces for hand-authored Shape 2
// + <form> + <errors> markup. The down-stream pipelines (TS field walker, DG
// validator-arg edges, VSS B11 + B12, CG render-by-tag expansion, emit-html
// + emit-bindings) consume the synthesized shapes identically to hand-
// authored shapes. See §41.14.10 Pillar-5 invariant.
// ---------------------------------------------------------------------------

let _synthIdCounter = 0;
/**
 * Allocate a fresh node id. The expander must be called AFTER ast-builder's
 * counter pass; collisions are avoided by starting at a large offset and
 * monotonically incrementing per expansion. (In practice the type-system
 * stage runs after AST construction so any positive integer below the
 * counter's high-water mark would collide; we go above with a per-process
 * high-bit offset.)
 */
function nextSynthId(): number {
  // Use a deliberately high base so synth ids never collide with real AST ids.
  if (_synthIdCounter === 0) _synthIdCounter = 0x40000000;
  return _synthIdCounter++;
}

/**
 * Reset the synth-id counter — TEST USE ONLY. Production callers should never
 * need this; ids must remain globally unique within a compilation unit.
 */
export function _resetSynthIdCounter(): void {
  _synthIdCounter = 0x40000000;
}

/**
 * Build a string-literal attribute value: `attr="..."`.
 */
function strAttr(name: string, value: string, span: unknown): unknown {
  return {
    name,
    value: { kind: "string-literal", value, span },
    span,
  };
}

/**
 * Build a boolean attribute (presence-only): `attr`.
 */
function boolAttr(name: string, span: unknown): unknown {
  return {
    name,
    value: { kind: "boolean-flag", value: true, span },
    span,
  };
}

/**
 * Build a variable-ref attribute value: `attr=@varName.path`.
 */
function refAttr(name: string, ref: string, span: unknown): unknown {
  return {
    name,
    value: { kind: "variable-ref", name: ref, span },
    span,
  };
}

/**
 * Build an expression attribute value (used for `disabled=!@signup.isValid`).
 */
function exprAttr(name: string, raw: string, refs: string[], span: unknown): unknown {
  return {
    name,
    value: { kind: "expr", raw, refs, span },
    span,
  };
}

/**
 * Build a call-ref attribute value: `attr=fn()` or `attr=fn`.
 */
function callRefAttr(name: string, fnName: string, args: string[], span: unknown): unknown {
  return {
    name,
    value: {
      kind: "call-ref",
      name: fnName,
      args,
      span,
    },
    span,
  };
}

/**
 * Build a generic markup node.
 */
function markupNode(
  tag: string,
  attrs: unknown[],
  children: unknown[],
  span: unknown,
  selfClosing = false,
): unknown {
  return {
    id: nextSynthId(),
    kind: "markup",
    tag,
    attrs,
    attributes: attrs,
    children,
    selfClosing: selfClosing && children.length === 0,
    span,
    // Mark the node as synthesized by formFor for diagnostics + debugging.
    _formForSynth: true,
  };
}

/**
 * Build a text node.
 */
function textNode(value: string, span: unknown): unknown {
  return {
    id: nextSynthId(),
    kind: "text",
    value,
    span,
    _formForSynth: true,
  };
}

/**
 * Build a synthesized `${expr}` logic-interpolation node.
 *
 * S108 — formFor B5 L2 label-store consultation per SPEC §41.14.7. The
 * expander needs to emit a per-label runtime lookup so `registerLabels()`
 * actually shapes the rendered label, not just seeds a dead map.
 *
 * Shape produced (mirrors what `${expr}` in markup body produces during
 * regular parse via ast-builder.js' implicit-logic-wrap path):
 *
 *   { kind: "logic", body: [{ kind: "bare-expr", expr, exprNode, span }], span }
 *
 * generateHtml's `node.kind === "logic"` case routes through:
 *   - constant-fold (Bug 5 P3 §7.4.2) — `_scrml_label_for(...)` is a CallExpr,
 *     not foldable → falls through
 *   - placeholder + binding registry — `${_scrml_label_for("T", "f")}` has
 *     NO reactive deps (no `@`-prefix) → routes through Bug 5 P1's
 *     non-reactive `el.textContent = expr` one-shot binding at
 *     DOMContentLoaded. This is exactly the right shape: registerLabels()
 *     fires at module init (before DOMContentLoaded fires the formFor
 *     bindings), the lookup walks Level 2 → Level 4, label is set once.
 *     No subscription needed (the registry is set-once-at-boot, not
 *     reactive).
 */
function logicInterpolationNode(exprRaw: string, span: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseExprToNode } = require("../expression-parser.ts") as {
    parseExprToNode: (raw: string, filePath: string, offset: number) => unknown;
  };
  const filePath = (span as { file?: string } | undefined)?.file ?? "<formFor-synth>";
  const offset = (span as { start?: number } | undefined)?.start ?? 0;
  const exprNode = parseExprToNode(exprRaw, filePath, offset);
  return {
    id: nextSynthId(),
    kind: "logic",
    body: [{
      kind: "bare-expr",
      expr: exprRaw,
      exprNode,
      span,
    }],
    span,
    _formForSynth: true,
  };
}

/**
 * Build a Shape 2 state-decl (decl-with-render-spec). Per ast-builder.js
 * lines 3958-3993 — `renderSpec` wraps the markup, `validators` carries the
 * validator clauses, `shape: "decl-with-spec"`, `structuralForm: true`.
 *
 * The validator entries match B9's structured ValidatorArg[] shape only
 * loosely — for v1.0 we ship the bare name + raw args; B9 args-decoration is
 * not run here. Down-stream validator emitters that need structured args
 * fall back to the raw-text path (which is what conformance ships today for
 * un-decorated validators).
 */
function buildShape2StateDecl(
  fieldName: string,
  inputShape: InputShape,
  validators: FormForValidator[],
  span: unknown,
): unknown {
  const inputAttrs: unknown[] = [];
  if (inputShape.type) inputAttrs.push(strAttr("type", inputShape.type, span));
  if (inputShape.step) inputAttrs.push(strAttr("step", inputShape.step, span));

  const inputElement = markupNode(inputShape.tag, inputAttrs, [], span, /*selfClosing*/ true);

  const renderSpec = {
    id: nextSynthId(),
    kind: "render-spec",
    element: inputElement,
    span,
  };

  return {
    id: nextSynthId(),
    kind: "state-decl",
    name: fieldName,
    init: "",
    initExpr: null,
    renderSpec,
    validators,
    defaultExpr: null,
    pinned: false,
    structuralForm: true,
    isConst: false,
    shape: "decl-with-spec",
    span,
    _formForSynth: true,
  };
}

/**
 * Build the compound Variant C structural state-decl that holds the per-field
 * Shape 2 sub-cells. Per ast-builder.js lines 3829-3842.
 */
function buildCompoundStateDecl(
  cellName: string,
  fieldDecls: unknown[],
  span: unknown,
): unknown {
  return {
    id: nextSynthId(),
    kind: "state-decl",
    name: cellName,
    init: "",
    initExpr: null,
    structuralForm: true,
    isConst: false,
    shape: "plain",
    defaultExpr: null,
    pinned: false,
    children: fieldDecls,
    span,
    _formForSynth: true,
  };
}

/**
 * Build the per-field render group:
 *   <div class="field" data-scrml-formfor-field="<fieldName>">
 *     <label>${label}</label>
 *     <${cellName}.${fieldName}/>
 *     <errors of=@${cellName}.${fieldName}/>     [if error-strategy includes per-field]
 *   </div>
 *
 * Slot overrides per §41.14.4: if `slotOverride` is non-empty, it REPLACES the
 * <input> position only — the <label> and <errors> still emit (the validity
 * surface is formFor-owned, not slot-owned, per §41.14.4 4th bullet).
 *
 * Render-by-tag note: scrml's V5-strict render-by-tag mechanism uses bare
 * `<varName/>` (§6.4) — for nested compound access we use the structural
 * compound-child render `<cellName><fieldName/></cellName>` form (§6.3.5).
 */
function buildFieldGroup(
  cellName: string,
  structName: string,
  field: FieldInfo,
  slotOverride: unknown[] | undefined,
  errorStrategy: "per-field" | "summary" | "both",
  span: unknown,
): unknown {
  const children: unknown[] = [];

  // <label>${(typeof _scrml_label_for === "function" ? _scrml_label_for("StructName", "fieldName") : "Mechanical Default")}</label>
  //
  // S108 B5 — Level-2 label-store consultation. Per SPEC §41.14.7 the
  // resolution chain walks Level 2 (registerLabels) → Level 4 (mechanical
  // default). Pre-B5, the expander baked the Level-4 mechanical default
  // (`field.label`) directly into the static HTML as a text node — adopters
  // who called `data.registerLabels({...})` saw no effect because the
  // expander never consulted the runtime store. B5 closes that gap by
  // emitting a `${_scrml_label_for(...)}` interpolation that resolves at
  // render time (DOMContentLoaded one-shot binding per Bug 5 P1 β-path).
  //
  // Defensive typeof-guard rationale: `_scrml_label_for` lives in the
  // `messages` runtime chunk (co-located with `_scrml_messages_register` /
  // `_scrml_message_for` per runtime-template.js:2922-2945). The chunk is
  // only auto-activated at emit-client.ts:563 when a Level-1 inline-override
  // validator is present. formFor without inline overrides may compile to a
  // bundle that doesn't include the messages chunk; the typeof-guard makes
  // the lookup safe in that case (fall back to the compile-time mechanical
  // default literal embedded in the JS). Mirrors the existing pattern in
  // emit-event-wiring.ts:667 for `_scrml_message_for` consumption in
  // errors-element wiring.
  //
  // The interpolation flows through generateHtml's logic-node case:
  //   - constant-fold (Bug 5 P3) tries the conditional expression → CallExpr
  //     inside → RUNTIME → no fold
  //   - placeholder + binding registered; no reactive refs → one-shot
  //     textContent write at DOMContentLoaded
  //
  // The runtime helper falls through Level 2 → Level 4 internally so the
  // adopter's unregistered fields still render their mechanical label, and
  // registered fields render the custom label. registerLabels() seeds the
  // map at module init (before DOMContentLoaded) so the lookup hits Level 2
  // when registered.
  const labelExpr =
    `(typeof _scrml_label_for === "function" ` +
    `? _scrml_label_for(${JSON.stringify(structName)}, ${JSON.stringify(field.name)}) ` +
    `: ${JSON.stringify(field.label)})`;
  const labelNode = markupNode(
    "label",
    [],
    [logicInterpolationNode(labelExpr, span)],
    span,
    false,
  );
  children.push(labelNode);

  // Input position — either the slot override or a direct <input> element
  // pre-wired with bind:value (or bind:checked / bind:files per element type
  // per §5.4 dispatch table). We emit the input directly rather than relying
  // on render-by-tag expansion at emit-html.ts because the SYM stage that
  // populates `fileScope` runs BEFORE the type-system rewrite that synthesizes
  // these state-decls (cross-ref pipeline order: NR → SYM → CE → ... → TS).
  // By emitting the canonical Shape 2 expansion shape directly, we sidestep
  // the SYM-population timing issue without needing a re-SYM pass. The
  // emitted shape is identical to what render-by-tag would produce for a
  // hand-authored Shape 2 cell; downstream emit-bindings.ts attaches the
  // reactive subscription on the bind:value attribute.
  //
  // Per §5.4 dispatch table:
  //   <input type="checkbox"/> → bind:checked
  //   <input type="file"/>     → bind:files
  //   <input type="number"/>   → bind:valueAsNumber
  //   default                   → bind:value
  if (slotOverride && slotOverride.length > 0) {
    for (const sn of slotOverride) children.push(sn);
  } else {
    const inputShape = inputShapeForFieldType(field.baseTypeName);
    const bindAttrName = pickBindAttrName(inputShape);
    const inputAttrs: unknown[] = [];
    if (inputShape.type) inputAttrs.push(strAttr("type", inputShape.type, span));
    if (inputShape.step) inputAttrs.push(strAttr("step", inputShape.step, span));
    // bind:value=@cellName.fieldName (or bind:checked for checkbox, etc.)
    inputAttrs.push(refAttr(bindAttrName, `@${cellName}.${field.name}`, span));
    // data-attr for source-mapping back to formFor + the field.
    inputAttrs.push(strAttr("data-scrml-formfor-input", field.name, span));
    const inputElement = markupNode(inputShape.tag, inputAttrs, [], span, true);
    children.push(inputElement);
  }

  // <errors of=@cellName.fieldName/> — per §41.14.4 always emitted, regardless
  // of slot override. Only suppressed when error-strategy="summary".
  if (errorStrategy === "per-field" || errorStrategy === "both") {
    const errorsAttr = refAttr("of", `@${cellName}.${field.name}`, span);
    const errorsNode = markupNode(
      "errors",
      [errorsAttr],
      [],
      span,
      true, /*selfClosing*/
    );
    children.push(errorsNode);
  }

  // Outer <div class="field" data-scrml-formfor-field="fieldName">.
  const groupAttrs: unknown[] = [
    strAttr("class", "field", span),
    strAttr("data-scrml-formfor-field", field.name, span),
  ];
  return markupNode("div", groupAttrs, children, span, false);
}

/**
 * Build the submit `<button>` — or the slot override if one was provided.
 *
 * Default submit shape per §41.14.3 4th bullet:
 *   <button type="submit" disabled=!@<cellName>.isValid>Submit</button>
 */
function buildSubmitButton(
  cellName: string,
  slotOverride: unknown[] | undefined,
  span: unknown,
): unknown {
  if (slotOverride && slotOverride.length > 0) {
    // The slot override is one or more pre-built nodes; return them wrapped
    // in a fragment-equivalent by returning the first node and pushing the
    // rest as siblings on the caller's children array. We collapse here by
    // returning a markup node with empty tag (synthetic fragment). For now,
    // since slot overrides are typically a single button, we return the
    // first node directly when there's only one.
    if (slotOverride.length === 1) return slotOverride[0];
    // Multi-node override: emit each as a sibling inside a wrapper <div>.
    return markupNode(
      "div",
      [strAttr("class", "submit-slot", span)],
      slotOverride,
      span,
      false,
    );
  }

  // §41.14.3 4th bullet — the default submit button SHALL be `disabled` when
  // `!@<cellName>.isValid`.
  //
  // S105 B1 (this commit) wires reactive Boolean attribute expressions for the
  // standard form-control bool attrs (disabled / readonly / required) via
  // emit-html.ts REACTIVE_BOOL_ATTRS dispatch + emit-event-wiring.ts
  // `_scrml_effect` toggle. The attribute is reactively present/absent based
  // on the truthy evaluation of `!@<cellName>.isValid`. Adopters can also
  // target the synth button via the `data-scrml-formfor-submit` selector for
  // CSS styling, OR override the entire submit button via slot.
  const btnAttrs: unknown[] = [
    strAttr("type", "submit", span),
    strAttr("data-scrml-formfor-submit", cellName, span),
    exprAttr(
      "disabled",
      `!@${cellName}.isValid`,
      [cellName],
      span,
    ),
  ];
  return markupNode(
    "button",
    btnAttrs,
    [textNode("Submit", span)],
    span,
    false,
  );
}

/**
 * Build the outer `<form>` element wrapping the per-field groups + submit
 * button + (optionally) a summary `<errors of=@cellName all/>` per §41.14.6.
 *
 * `<form onsubmit=fnName [action="/api/route" method="POST"]>`
 *
 * Per §41.14.3: when `onsubmit=` is a server function, the PE default
 * structural `action=` / `method=` are emitted automatically; the adopter
 * does NOT set `progressive=`. When `onsubmit=` is client-side OR absent,
 * no action= / method= is emitted (pure JS form).
 */
function buildFormElement(
  exp: FormForExpansion,
  perFieldGroups: unknown[],
  submitNode: unknown,
  span: unknown,
): unknown {
  const formAttrs: unknown[] = [];

  // Stable selector for tests + adopter CSS — every formFor-emitted form
  // carries this data-attr.
  formAttrs.push(strAttr("data-scrml-formfor", exp.structName, span));

  // onsubmit=fn — bare-form event handler per §5.2.3.
  if (exp.onsubmitFnName) {
    formAttrs.push(callRefAttr("onsubmit", exp.onsubmitFnName, [], span));
  }

  // Progressive-enhancement structural default for server-fn handlers (§41.14.3).
  if (exp.onsubmitBoundary === "server" && exp.peActionUrl) {
    formAttrs.push(strAttr("action", exp.peActionUrl, span));
    formAttrs.push(strAttr("method", "POST", span));
  }

  const children: unknown[] = [...perFieldGroups];

  // Summary <errors of=@cellName all/> per §41.14.6 when "summary" or "both".
  if (exp.errorStrategy === "summary" || exp.errorStrategy === "both") {
    const summaryErrors = markupNode(
      "errors",
      [
        refAttr("of", `@${exp.cellName}`, span),
        boolAttr("all", span),
      ],
      [],
      span,
      true,
    );
    children.push(summaryErrors);
  }

  children.push(submitNode);
  return markupNode("form", formAttrs, children, span, false);
}

// ---------------------------------------------------------------------------
// Top-level expander entry point.
// ---------------------------------------------------------------------------

/**
 * Expand a `<formFor>` AST node into:
 *   - One compound state-decl AST node (Variant C structural form).
 *   - One <form> markup AST node containing the rendered field groups +
 *     submit button + (optional) summary <errors>.
 *
 * Both are returned in the order they should appear in the parent's
 * children array (state-decl FIRST so it sits in declaration position
 * before the markup that uses it via render-by-tag).
 *
 * The caller (type-system stage) is responsible for splicing these into
 * the AST in place of the original `<formFor>` node.
 *
 * @param exp — fully-resolved expansion plan built by the type-system
 *              validation pass (post-pick/omit/partial, post-slot-walk).
 * @returns [compoundStateDecl, formElement]
 */
export function expandFormFor(exp: FormForExpansion): [unknown, unknown] {
  const span = exp.span;

  // Build per-field Shape 2 sub-cells.
  const fieldDecls: unknown[] = [];
  for (const field of exp.includedFields) {
    const inputShape = inputShapeForFieldType(field.baseTypeName);
    // Partial-mode relaxation: drop `req` validators from each field.
    const fieldValidators = exp.partial
      ? field.validators.filter(v => v.name !== "req")
      : field.validators;
    fieldDecls.push(buildShape2StateDecl(field.name, inputShape, fieldValidators, span));
  }
  const compoundDecl = buildCompoundStateDecl(exp.cellName, fieldDecls, span);

  // Build per-field render groups.
  const fieldGroups: unknown[] = [];
  for (const field of exp.includedFields) {
    const slotOverride = exp.slotOverrides.get(field.name);
    fieldGroups.push(buildFieldGroup(
      exp.cellName,
      exp.structName,
      field,
      slotOverride,
      exp.errorStrategy,
      span,
    ));
  }

  // Build submit button (or slot override).
  const submitOverride = exp.slotOverrides.get("submit");
  const submitNode = buildSubmitButton(exp.cellName, submitOverride, span);

  // Build outer <form>.
  const formElement = buildFormElement(exp, fieldGroups, submitNode, span);

  return [compoundDecl, formElement];
}
