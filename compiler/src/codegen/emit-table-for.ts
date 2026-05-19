/**
 * @module codegen/emit-table-for
 *
 * §41.16 (S105) — tableFor type-driven `<table>` rendering: AST-level expansion.
 *
 * `<tableFor for=StructType rows=@cell ...>` is the FOURTH general-position member
 * of the §53.14 type-as-argument family (after parseVariant §41.13 + formFor §41.14
 * + schemaFor §41.15). What `formFor` does for INPUT (struct → form + validators +
 * submit), `tableFor` does for OUTPUT (struct + rows → table headers + per-row
 * cells + optional sort/select state).
 *
 * The type-system stage recognizes the markup element, validates `for=` /
 * `rows=` / `pick=` / `omit=` / `selectable=` / `selectedBy=` + walks `<column>`
 * slots + validates per-field display-mapping (the 13 normative error codes per
 * §41.16.1-§41.16.9), then calls into this module's `expandTableForElement()`
 * to produce the equivalent `<table>` + `<thead>` + `<tbody>` markup tree.
 *
 * **Approach A — source-level expansion** per SPEC §41.16.11. The expander
 * produces canonical scrml markup (Pillar 5 invariant) — no new runtime hooks,
 * no codegen-stage changes. The synth `@<varName>.sortedBy` cell is a regular
 * state-decl; click handlers are regular event-handler attrs; iteration is
 * regular `${for (row of @rows) { lift <tr>... }}` per §17.4 + §17.4a.
 *
 * Output shape (canonical scrml):
 *
 *   // synth: TableSort state-decl (only when ANY column has sortable=)
 *   <usersSortedBy>: TableSort | not = not
 *
 *   <table data-scrml-tablefor="User">
 *     <thead>
 *       <tr>
 *         [<th>...master-checkbox...</th>]?      // when selectable=
 *         <th [onclick=fn] [class=...] [style="text-align:...]>Header text</th>
 *         ...
 *       </tr>
 *     </thead>
 *     <tbody>
 *       ${for (row of @users) {
 *         lift <tr [data-row-id=row.id]>
 *           [<td><input type="checkbox" ...></td>]?  // when selectable=
 *           <td [class=...] [style="text-align:..."]>${row.field}</td>  // default
 *           or
 *           <td>...slot body with :let={(row) =>}...</td>
 *           ...
 *         </tr>;
 *       } else {
 *         lift <tr><td colspan=N>...empty slot body or default text...</td></tr>;
 *       }}
 *     </tbody>
 *   </table>
 *
 * Cross-references:
 *   §41.16.1   — type argument (E-TABLEFOR-TYPE-NOT-STRUCT)
 *   §41.16.2   — rows argument (E-TABLEFOR-ROWS-MISSING / E-TABLEFOR-ROWS-WRONG-TYPE)
 *   §41.16.3   — column slot grammar
 *   §41.16.4   — header derivation (mechanical title-case)
 *   §41.16.5   — pick/omit field-set transforms
 *   §41.16.6   — per-cell default rendering (display-mapping table)
 *   §41.16.7   — sort surface (auto-synth @<varName>.sortedBy)
 *   §41.16.8   — selection surface (selectable= + checkbox column + PK derivation)
 *   §41.16.9   — empty-state (auto-wrap <tr><td colspan>)
 *   §41.16.10  — wrapper shape (bare <table>; no outer div)
 *   §41.16.11  — codegen contract (Pillar 5 invariant)
 *   §17.4      — for/lift iteration (the row-emission mechanism)
 *   §17.4a     — for/else empty-state (the empty-slot mechanism)
 *   §16.6      — parametric snippet :let={(row) => ...} (the slot scope mechanism)
 *   §6.4       — render-by-tag interpolation (${row.field})
 *   §6.5       — reactive array mutation (rows=@cell reactivity substrate)
 */

import { parseValidatorClauses, mechanicalLabel } from "./emit-form-for.ts";
import { parseExprToNode } from "../expression-parser.ts";

// ---------------------------------------------------------------------------
// Mirror types — accept structurally to avoid a cross-module type dependency.
// Keep these in sync with §41.16.
// ---------------------------------------------------------------------------

/** Resolved struct type — mirror of `StructType` from type-system.ts. */
export interface TableForStructLike {
  kind: "struct";
  name: string;
  /** Map<fieldName, fieldType> — value's `kind` is "primitive"|"predicated"|"struct"|"enum"|... */
  fields: Map<string, unknown>;
}

/**
 * Per-cell display-mapping classification (§41.16.6).
 * Drives the `<td>` default-render emission when no `<column>` slot override.
 */
export type CellDisplayKind =
  | { kind: "string" }
  | { kind: "number" }      // integer or real — bare ${row.field}
  | { kind: "boolean" }     // "true"/"false" via bare ${row.field}
  | { kind: "timestamp" }   // ISO string via bare ${row.field}
  | { kind: "bare-enum"; variants: string[] }  // bare ${row.field} = variant name string
  | { kind: "payload-enum"; enumName: string } // E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1
  | { kind: "nested-struct"; structName: string } // E-TABLEFOR-NESTED-STRUCT-NO-SLOT (when no slot)
  | { kind: "unmappable"; typeKind: string };   // E-TABLEFOR-NO-DISPLAY-MAPPING

/** Per-column metadata as recognized by the type-system pass. */
export interface TableForColumnInfo {
  /** Struct field name — `email`, `name`, `role`, etc. */
  fieldName: string;
  /** Header text — mechanical title-case default OR `<column header="...">` override. */
  headerText: string;
  /** Display-mapping classification per §41.16.6. Drives default <td> body emit. */
  displayKind: CellDisplayKind;
  /** Slot-body override (zero or more AST nodes); null for default-rendered columns. */
  slotBody: unknown[] | null;
  /** Adopter-chosen row-binding name from `:let={(row) => ...}` — defaults to "row". */
  rowBindingName: string;
  /** `<column sortable>` present — drives the click-handler emit on <th>. */
  sortable: boolean;
  /** Optional `align="left"|"right"|"center"`. */
  align: "left" | "right" | "center" | null;
  /** Optional `class="<css>"` applied to BOTH <th> and <td>. */
  cssClass: string | null;
}

/** Top-level metadata produced by the type-system pass, consumed by the expander. */
export interface TableForExpansion {
  /** Original struct type name (for diagnostics + the data-scrml-tablefor attr). */
  structName: string;
  /**
   * The verbatim rows expression — `@users`, `@items.filter(p)`, `@all.slice(0, 10)`, etc.
   * Inserted verbatim into the `for (row of <rowsExpr>) { lift ... }` iteration.
   */
  rowsExpr: string;
  /**
   * The derived cell-name from `rows=@varName(.method)?` — used for sort-state
   * cell synthesis (`@<varName>.sortedBy`). NULL when rowsExpr is not a cell-ref
   * (e.g., literal array, non-cell expression) — in which case sortable= MUST be
   * absent (E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS otherwise).
   */
  rowsCellVarName: string | null;
  /** Ordered column metadata (already filtered by pick/omit per §41.16.5). */
  columns: TableForColumnInfo[];
  /** True iff ANY column has sortable=. Drives `@<varName>.sortedBy` synth + th click-handlers. */
  hasSortable: boolean;
  /** Selection surface — null when `selectable=` absent. */
  selection: TableForSelectionInfo | null;
  /** Empty-slot body — null when `<empty>` slot absent (default text fires). */
  emptySlot: unknown[] | null;
  /** Source span of the original `<tableFor>` node, propagated to every synth sub-node. */
  span: unknown;
}

/** Selection surface metadata (§41.16.8). */
export interface TableForSelectionInfo {
  /** The `@cell` ident from `selectable=@cell` — sans the `@` prefix. */
  cellName: string;
  /** PK field name — default "id"; overridden via `selectedBy="<field>"`. */
  pkFieldName: string;
}

// ---------------------------------------------------------------------------
// Synth ID allocation — must NOT collide with ast-builder's id counter.
// Mirrors emit-form-for.ts pattern — a high-bit offset keeps the synth id space
// disjoint from the construction-pass counter.
// ---------------------------------------------------------------------------

let _synthIdCounter = 0;
function nextSynthId(): number {
  if (_synthIdCounter === 0) _synthIdCounter = 0x50000000;
  return _synthIdCounter++;
}

/** Reset the synth-id counter — TEST USE ONLY. */
export function _resetSynthIdCounter(): void {
  _synthIdCounter = 0x50000000;
}

// ---------------------------------------------------------------------------
// AST builder helpers — mirror emit-form-for.ts construction shapes.
// ---------------------------------------------------------------------------

/** Build a string-literal attribute value: `attr="..."`. */
function strAttr(name: string, value: string, span: unknown): unknown {
  return {
    name,
    value: { kind: "string-literal", value, span },
    span,
  };
}

/** Build a variable-ref attribute value: `attr=@varName.path`. */
function refAttr(name: string, ref: string, span: unknown): unknown {
  return {
    name,
    value: { kind: "variable-ref", name: ref, span },
    span,
  };
}

/** Build an expression attribute value (used for `colspan=N` with raw integer). */
function exprAttr(name: string, raw: string, refs: string[], span: unknown): unknown {
  return {
    name,
    value: { kind: "expr", raw, refs, span },
    span,
  };
}

/** Build a call-ref attribute value: `attr=fn(args)`. */
function callRefAttr(name: string, fnName: string, args: string[], span: unknown): unknown {
  return {
    name,
    value: { kind: "call-ref", name: fnName, args, span },
    span,
  };
}

/** Build a generic markup node. */
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
    _tableForSynth: true,
  };
}

/** Build a text node. */
function textNode(value: string, span: unknown): unknown {
  return {
    id: nextSynthId(),
    kind: "text",
    value,
    span,
    _tableForSynth: true,
  };
}

/**
 * Build an interpolated `${expr}` bare-expr node WRAPPED in a logic node — the
 * shape that downstream emit-lift.js + emit-html dispatch expects when a markup
 * element body carries an interpolation.
 *
 * Real shape (from ast-builder.js for `<td>${row.name}</td>`):
 *   <td>
 *     <logic>
 *       <bare-expr expr="row.name" exprNode={kind:"member",...}/>
 *     </logic>
 *   </td>
 *
 * We parse the raw expression to produce a proper ExprNode so downstream
 * rewriters + emit-* consume the synthesized expression identically to a
 * hand-authored interpolation.
 */
function bareExprNode(raw: string, refs: string[], span: unknown): unknown {
  void refs;  // refs propagate via exprNode tree walk
  let exprNode: unknown;
  try {
    exprNode = parseExprToNode(raw, "<tableFor-synth>", 0);
  } catch {
    exprNode = { kind: "escape-hatch", span, estreeType: "SkippedExpr", raw };
  }
  const inner = {
    id: nextSynthId(),
    kind: "bare-expr",
    expr: raw,
    exprNode,
    span,
    _tableForSynth: true,
  };
  // Wrap in a logic node — the shape emit-lift.js expects for markup-body
  // interpolations.
  return {
    id: nextSynthId(),
    kind: "logic",
    body: [inner],
    span,
    _tableForSynth: true,
  };
}

/**
 * Build a `for (row of <rowsExpr>) { lift <tr>... }` iteration block.
 *
 * The shape mirrors ast-builder.js real for-stmt (line ~5099):
 *   { kind: "for-stmt",
 *     variable: "<rowBindingName>",
 *     iterable: "<rowsExpr raw string>",
 *     iterExpr: <parsed ExprNode>,
 *     body: [<lift-expr nodes>] }
 *
 * Lift-expr shape (line ~4982):
 *   { kind: "lift-expr",
 *     expr: { kind: "markup", node: <markupNode> } }
 *
 * The wrapping `logic` node carries the for-stmt as a body element.
 *
 * Per §17.4a `for/else` empty-state: when `elseBody` is non-empty, an `else`
 * clause is attached carrying the empty-state lift-expr.
 */
function buildForLiftBlock(
  rowBindingName: string,
  rowsExpr: string,
  rowsRefs: string[],
  bodyChild: unknown,
  elseChild: unknown | null,
  span: unknown,
): unknown {
  // Wrap the body markup node in a lift-expr.
  const liftExpr = {
    id: nextSynthId(),
    kind: "lift-expr",
    expr: { kind: "markup", node: bodyChild },
    span,
    _tableForSynth: true,
  };
  const elseLiftExpr = elseChild
    ? {
        id: nextSynthId(),
        kind: "lift-expr",
        expr: { kind: "markup", node: elseChild },
        span,
        _tableForSynth: true,
      }
    : null;
  // Build a parsed iterExpr node — a bare ExprNode tree produced by the same
  // parser the regular path uses. This makes downstream stages (rewrite, reactive-
  // deps, emit-client for-stmt path) see the synthesized iterable identically
  // to a hand-authored `for (row of @users) { lift ... }`.
  let iterExpr: unknown;
  try {
    iterExpr = parseExprToNode(rowsExpr, "<tableFor-synth>", 0);
  } catch {
    // Defensive fallback — produce an escape-hatch with the raw text.
    iterExpr = { kind: "escape-hatch", span, estreeType: "SkippedExpr", raw: rowsExpr };
  }
  void rowsRefs;  // refs propagate naturally via parseExprToNode's @-tracking
  const forStmt: Record<string, unknown> = {
    id: nextSynthId(),
    kind: "for-stmt",
    variable: rowBindingName,
    iterable: rowsExpr,    // raw string — downstream rewriter consumes this
    iterExpr,
    body: [liftExpr],
    span,
    _tableForSynth: true,
  };
  // §17.4a — else body for empty-state.
  if (elseLiftExpr) {
    forStmt.elseBody = [elseLiftExpr];
  }
  const logicNode = {
    id: nextSynthId(),
    kind: "logic",
    body: [forStmt],
    span,
    _tableForSynth: true,
  };
  return logicNode;
}

// ---------------------------------------------------------------------------
// Display-mapping classifier (§41.16.6).
// ---------------------------------------------------------------------------

/**
 * Classify a struct-field's resolved type against the v1.0 display-mapping
 * table per SPEC §41.16.6.
 *
 * Caller's responsibility:
 *   - On `nested-struct` or `payload-enum`: emit the corresponding error CODE
 *     (unless the column has an explicit slot body, in which case the slot's
 *     body owns the rendering and the error is suppressed).
 *   - On `unmappable`: emit E-TABLEFOR-NO-DISPLAY-MAPPING (unless explicit slot).
 *   - On other kinds: thread the displayKind into the column's emit.
 */
export function classifyFieldForCell(fieldType: unknown): CellDisplayKind {
  if (!fieldType || typeof fieldType !== "object") {
    return { kind: "unmappable", typeKind: typeof fieldType };
  }
  const t = fieldType as {
    kind?: string;
    name?: string;
    baseType?: string;
    variants?: Array<{ name?: string; payload?: unknown }>;
    element?: unknown;
  };

  // Nested struct — caller checks for slot-override before emitting error.
  if (t.kind === "struct") {
    return { kind: "nested-struct", structName: t.name ?? "<unnamed-struct>" };
  }

  // Enum — bare-variant renders as text; payload-bearing rejects (unless slot).
  if (t.kind === "enum") {
    const enumName = t.name ?? "<unnamed-enum>";
    const variants = Array.isArray(t.variants) ? t.variants : [];
    let isPayloadBearing = false;
    for (const v of variants) {
      const pl = (v as { payload?: unknown }).payload;
      if (pl && typeof pl === "object") {
        if (pl instanceof Map) {
          if (pl.size > 0) { isPayloadBearing = true; break; }
        } else if (Array.isArray(pl) && pl.length > 0) {
          isPayloadBearing = true;
          break;
        } else if (typeof pl === "object" && Object.keys(pl as Record<string, unknown>).length > 0) {
          isPayloadBearing = true;
          break;
        }
      }
    }
    if (isPayloadBearing) {
      return { kind: "payload-enum", enumName };
    }
    const names: string[] = variants
      .map(v => (v?.name ?? "") as string)
      .filter(n => n.length > 0);
    return { kind: "bare-enum", variants: names };
  }

  // Primitive — direct mapping.
  if (t.kind === "primitive") {
    const cm = mapPrimitiveToCellKind(t.name);
    if (cm) return cm;
    return { kind: "unmappable", typeKind: `primitive:${t.name ?? "<unknown>"}` };
  }

  // Predicated — fall through to baseType.
  if (t.kind === "predicated") {
    const cm = mapPrimitiveToCellKind(t.baseType);
    if (cm) return cm;
    return { kind: "unmappable", typeKind: `predicated:${t.baseType ?? "<unknown>"}` };
  }

  // Array, asIs, union, not, function, snippet, opaque — no v1.0 display mapping.
  return { kind: "unmappable", typeKind: t.kind ?? "<unknown>" };
}

function mapPrimitiveToCellKind(name: string | undefined): CellDisplayKind | null {
  switch (name) {
    case "string":     return { kind: "string" };
    case "int":
    case "integer":    return { kind: "number" };
    case "number":
    case "float":
    case "real":       return { kind: "number" };
    case "boolean":    return { kind: "boolean" };
    case "timestamp":  return { kind: "timestamp" };
    default:           return null;
  }
}

// ---------------------------------------------------------------------------
// Header / cell / sort / selection emitters.
// ---------------------------------------------------------------------------

/**
 * Build the `<th>` for a regular (non-checkbox) column.
 *
 * Per §41.16.4 + §41.16.7:
 *   - When `sortable`: emit `onclick=__tableForSortToggle(...)` click handler that
 *     toggles `@<rowsCellVarName>.sortedBy` per the cycle rule.
 *   - When `align=` / `class=`: emit them on the <th>.
 *
 * The sort handler is emitted as a callRef expression that targets a synthesized
 * helper inline-expression — to keep the runtime hook surface zero, we render the
 * onclick body inline as the assignment to the sort cell.
 */
function buildHeaderCell(
  col: TableForColumnInfo,
  rowsCellVarName: string | null,
  span: unknown,
): unknown {
  const attrs: unknown[] = [];
  if (col.cssClass) attrs.push(strAttr("class", col.cssClass, span));
  if (col.align)    attrs.push(strAttr("style", `text-align:${col.align}`, span));
  if (col.sortable && rowsCellVarName) {
    // Inline event-handler — toggle @<varName>.sortedBy. The expression text is
    // emitted via the call-ref shape with an inline closure body. The runtime
    // dispatcher reads the call-ref as a regular event-handler expression.
    //
    // Toggle rule per §41.16.7:
    //   - If sortedBy is `not` OR sortedBy.field !== "<field>": set to {field, "asc"}.
    //   - Else if sortedBy.direction === "asc": flip to {field, "desc"}.
    //   - Else (already "desc" on this field): flip back to {field, "asc"}.
    //
    // Emitted as an arrow-function-shape inline expr — adopter-readable per Pillar 5.
    const cycleExpr = (
      `() => { ` +
      `if (@${rowsCellVarName}.sortedBy is not || @${rowsCellVarName}.sortedBy.field != "${col.fieldName}") { ` +
      `@${rowsCellVarName}.sortedBy = { field: "${col.fieldName}", direction: "asc" } ` +
      `} else if (@${rowsCellVarName}.sortedBy.direction == "asc") { ` +
      `@${rowsCellVarName}.sortedBy = { field: "${col.fieldName}", direction: "desc" } ` +
      `} else { ` +
      `@${rowsCellVarName}.sortedBy = { field: "${col.fieldName}", direction: "asc" } ` +
      `} }`
    );
    attrs.push({
      name: "onclick",
      value: { kind: "expr", raw: cycleExpr, refs: [rowsCellVarName], span },
      span,
    });
    attrs.push(strAttr("data-scrml-tablefor-sortable", col.fieldName, span));
  }
  return markupNode("th", attrs, [textNode(col.headerText, span)], span, false);
}

/**
 * Build the `<td>` for a regular column on a single row.
 *
 * Per §41.16.3 + §41.16.6:
 *   - When `slotBody` is non-empty: the slot body owns the cell content. We
 *     substitute the `:let={(row) =>}` row-binding name through the AST (the
 *     adopter wrote `${row.X}` or similar — we keep the binding name from
 *     `col.rowBindingName` which the for-loop's binding parameter exposes).
 *     IMPORTANT: when rowBindingName !== "row", we rewrite `${row.X}` →
 *     `${<rowBindingName>.X}` in the slot body's exprs to honor adopter naming.
 *   - When `slotBody` is null/empty: emit the default `${row.field}` bare-expr.
 */
function buildBodyCell(
  col: TableForColumnInfo,
  rowBindingName: string,
  span: unknown,
): unknown {
  const attrs: unknown[] = [];
  if (col.cssClass) attrs.push(strAttr("class", col.cssClass, span));
  if (col.align)    attrs.push(strAttr("style", `text-align:${col.align}`, span));

  let children: unknown[];
  if (col.slotBody && col.slotBody.length > 0) {
    // Slot body — adopter-authored markup. The for-loop's binding parameter
    // is named `<rowBindingName>`, which is what the adopter sees in their
    // `${row.field}` / `${user.name}` interpolations. The slot body is emitted
    // verbatim (we trust the adopter's identifier choice).
    children = col.slotBody;
  } else {
    // Default cell — `${<rowBindingName>.<fieldName>}` bare interpolation.
    children = [
      bareExprNode(
        `${rowBindingName}.${col.fieldName}`,
        [rowBindingName],
        span,
      ),
    ];
  }
  return markupNode("td", attrs, children, span, false);
}

/**
 * Build the leading checkbox `<th>` (the master toggle).
 *
 * Per §41.16.8: master-checkbox is checked when all rows are selected,
 * indeterminate when partial, unchecked otherwise. Click toggles all-on/all-off.
 *
 * The shape uses bind:checked + onchange together — bind:checked drives the
 * derived state read; onchange handles the toggle write.
 *
 * Implementation note: for v1.0 we emit a `<input type="checkbox">` with a
 * computed `checked=` expression and an `onchange=` handler. The indeterminate
 * tri-state visual indicator is left as a v1.next refinement (canonical DOM
 * requires a JS-side `indeterminate` write that scrml's reactivity doesn't
 * surface to attribute-position yet — same gap as formFor's `disabled=` —
 * documented in §41.16.8 FOLLOWUP).
 */
function buildMasterCheckboxCell(
  selection: TableForSelectionInfo,
  rowsExpr: string,
  rowsRefs: string[],
  span: unknown,
): unknown {
  const cellName = selection.cellName;
  // The all-selected check expression: every row's PK is in the cell.
  const allCheckedExpr = `@${cellName}.length > 0 && @${cellName}.length == (${rowsExpr}).length`;
  // The onchange toggle: if current state is "all", set @cell = []; else add all PKs.
  // Use `evt` for the event parameter to avoid colliding with the rewriter's
  // generated `event` binding (the event-handler wrapper produces
  // `function(event) { ... }` and the inner arrow's param would shadow).
  const onchangeExpr = (
    `(evt) => { ` +
    `if (@${cellName}.length == (${rowsExpr}).length) { ` +
    `@${cellName} = [] ` +
    `} else { ` +
    `@${cellName} = (${rowsExpr}).map((r) => r.${selection.pkFieldName}) ` +
    `} }`
  );
  const cb = markupNode(
    "input",
    [
      strAttr("type", "checkbox", span),
      strAttr("data-scrml-tablefor-master", cellName, span),
      {
        name: "checked",
        value: { kind: "expr", raw: allCheckedExpr, refs: [cellName, ...rowsRefs], span },
        span,
      },
      {
        name: "onchange",
        value: { kind: "expr", raw: onchangeExpr, refs: [cellName, ...rowsRefs], span },
        span,
      },
    ],
    [],
    span,
    true,
  );
  return markupNode("th", [strAttr("class", "tableFor-select", span)], [cb], span, false);
}

/**
 * Build the leading checkbox `<td>` for a single row.
 *
 * Per §41.16.8: the cell's `checked` reflects `@cell.includes(row.<pkField>)`;
 * `onchange` toggles the row's PK value in the cell.
 */
function buildRowCheckboxCell(
  selection: TableForSelectionInfo,
  rowBindingName: string,
  span: unknown,
): unknown {
  const cellName = selection.cellName;
  const pk = selection.pkFieldName;
  const checkedExpr = `@${cellName}.includes(${rowBindingName}.${pk})`;
  // Use `evt` for the event parameter (see master-checkbox comment above).
  const onchangeExpr = (
    `(evt) => { ` +
    `if (@${cellName}.includes(${rowBindingName}.${pk})) { ` +
    `@${cellName} = @${cellName}.filter((id) => id != ${rowBindingName}.${pk}) ` +
    `} else { ` +
    `@${cellName} = [...@${cellName}, ${rowBindingName}.${pk}] ` +
    `} }`
  );
  const cb = markupNode(
    "input",
    [
      strAttr("type", "checkbox", span),
      strAttr("data-scrml-tablefor-row-select", "true", span),
      {
        name: "checked",
        value: { kind: "expr", raw: checkedExpr, refs: [cellName, rowBindingName], span },
        span,
      },
      {
        name: "onchange",
        value: { kind: "expr", raw: onchangeExpr, refs: [cellName, rowBindingName], span },
        span,
      },
    ],
    [],
    span,
    true,
  );
  return markupNode("td", [strAttr("class", "tableFor-select", span)], [cb], span, false);
}

/**
 * Build the empty-state `<tr><td colspan=N>...</td></tr>`.
 *
 * Per §41.16.9: when `<empty>` slot is provided, its body content goes inside
 * the wrapped `<td>`. Default content is the bare text "No rows to display".
 *
 * The total column count = N. For colspan we need a numeric attr value.
 */
function buildEmptyStateRow(
  emptySlot: unknown[] | null,
  colCount: number,
  span: unknown,
): unknown {
  const tdChildren: unknown[] =
    (emptySlot && emptySlot.length > 0)
      ? emptySlot
      : [textNode("No rows to display", span)];
  const td = markupNode(
    "td",
    [
      // colspan must be an integer attr. We emit as string-literal — runtime
      // attribute pipelines accept numeric strings on colspan.
      strAttr("colspan", String(colCount), span),
      strAttr("class", "tableFor-empty", span),
    ],
    tdChildren,
    span,
    false,
  );
  return markupNode("tr", [], [td], span, false);
}

// ---------------------------------------------------------------------------
// Top-level expander entry point.
// ---------------------------------------------------------------------------

/**
 * Expand a `<tableFor>` AST node into:
 *   - One synth state-decl AST node FOR EACH sort cell (currently up to one —
 *     @<varName>.sortedBy — only emitted when ANY column is sortable).
 *   - One <table> markup AST node containing the rendered <thead> + <tbody>.
 *
 * Returns `{ sortStateDecl, tableElement }` where `sortStateDecl` may be null
 * when no column is sortable. The caller (type-system stage) is responsible
 * for splicing these into the AST in place of the original `<tableFor>` node.
 *
 * The synth state-decl is a regular `<varName.sortedBy>: TableSort | not = not`
 * Shape 1 state-decl — no special runtime treatment.
 *
 * @param exp — fully-resolved expansion plan built by the type-system pass
 * @returns { sortStateDecl, tableElement } — one or two AST nodes to splice
 */
export function expandTableForElement(exp: TableForExpansion): {
  sortStateDecl: unknown | null;
  tableElement: unknown;
} {
  const span = exp.span;
  const totalColumns = exp.columns.length + (exp.selection ? 1 : 0);

  // Derive the unified row-binding name. When ANY column has a `<column :let>`
  // binding, the for-loop binding matches THAT column's adopter-chosen name.
  // But the for-loop binding is a single name — different columns may want
  // different names (e.g., one wrote `:let={(user) =>}` and another `:let={(row) =>}`).
  // Strategy: use the FIRST non-default binding name encountered. If none, use "row".
  let unifiedRowBinding = "row";
  for (const col of exp.columns) {
    if (col.rowBindingName && col.rowBindingName !== "row") {
      unifiedRowBinding = col.rowBindingName;
      break;
    }
  }
  // Propagate the unified binding back to each column so cell-emit references it.
  // (Slot-bodies that referenced a different name will still use the adopter's
  // text verbatim; for v1.0 we don't rewrite expr text. Adopters using mismatched
  // names across columns will see a runtime reference error — documented
  // FOLLOWUP §41.16.3 P2: cross-column-rebinding is reserved for v1.next.)
  const propagatedColumns: TableForColumnInfo[] = exp.columns.map(c => ({
    ...c,
    rowBindingName: unifiedRowBinding,
  }));

  // 1. Sort-state cell synth.
  //
  // Per §41.16.7 the synth surface is `@<varName>.sortedBy: TableSort | not`.
  // The cleanest v1.0 emit treats `.sortedBy` as a member of the existing
  // rows cell `@<rowsCellVarName>` — the click handler writes
  // `@<rowsCellVarName>.sortedBy = {...}` directly. JS objects (arrays
  // included, which is the rows cell's runtime shape) accept arbitrary
  // property writes, so the runtime behavior is correct without an explicit
  // sibling state-decl. The synth state-decl emit is therefore SUPPRESSED in
  // v1.0 — adopters read `@<rowsCellVarName>.sortedBy` directly.
  //
  // A v1.next refinement could either:
  //   (a) mutate the rows-cell AST to a compound state-decl with a `sortedBy`
  //       child + type annotation `TableSort | not`, OR
  //   (b) emit a sibling cell `<rowsCellVarName>SortedBy` + rewrite the click
  //       handler to reference it.
  //
  // Both are out-of-scope for v1.0. The behavior is correct without either.
  const sortStateDecl: unknown | null = null;
  // If sort-state synth was elected but rowsCellVarName is null, the validator
  // pass should have already fired E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS.

  // 2. <thead><tr>...</tr></thead>
  const headerCells: unknown[] = [];
  if (exp.selection) {
    headerCells.push(
      buildMasterCheckboxCell(
        exp.selection,
        exp.rowsExpr,
        exp.rowsCellVarName ? [exp.rowsCellVarName] : [],
        span,
      ),
    );
  }
  for (const col of propagatedColumns) {
    headerCells.push(buildHeaderCell(col, exp.rowsCellVarName, span));
  }
  const headerRow = markupNode("tr", [], headerCells, span, false);
  const thead = markupNode("thead", [], [headerRow], span, false);

  // 3. <tbody>${for (row of <rowsExpr>) { lift <tr>... } else { lift <tr><td colspan>...</td></tr>; }}</tbody>
  const bodyRowCells: unknown[] = [];
  if (exp.selection) {
    bodyRowCells.push(buildRowCheckboxCell(exp.selection, unifiedRowBinding, span));
  }
  for (const col of propagatedColumns) {
    bodyRowCells.push(buildBodyCell(col, unifiedRowBinding, span));
  }
  const bodyRow = markupNode("tr", [], bodyRowCells, span, false);

  const emptyRow = buildEmptyStateRow(exp.emptySlot, totalColumns, span);

  const rowsRefs = exp.rowsCellVarName ? [exp.rowsCellVarName] : [];
  const forBlock = buildForLiftBlock(
    unifiedRowBinding,
    exp.rowsExpr,
    rowsRefs,
    bodyRow,
    emptyRow,
    span,
  );

  const tbody = markupNode("tbody", [], [forBlock], span, false);

  // 4. Outer <table data-scrml-tablefor="<StructName>">
  const tableAttrs: unknown[] = [
    strAttr("data-scrml-tablefor", exp.structName, span),
  ];
  const tableElement = markupNode("table", tableAttrs, [thead, tbody], span, false);

  return { sortStateDecl, tableElement };
}

// ---------------------------------------------------------------------------
// Header derivation helper — §41.16.4 mechanical title-case.
// Mirrors emit-form-for's mechanicalLabel + adds underscore + dash handling.
// ---------------------------------------------------------------------------

/**
 * Title-case a field name per §41.16.4 mechanical default rule.
 *
 *   "email"           → "Email"
 *   "createdAt"       → "Created At"
 *   "is_admin"        → "Is Admin"
 *   "user-role"       → "User Role"
 *   "URL"             → "URL"         (all-caps preserved)
 *   "URLs"            → "U R Ls"      (degenerate — adopter uses header= override)
 *
 * The implementation:
 *   1. Replace `_` and `-` with single spaces.
 *   2. Insert a space before each upper-case letter that follows a lower-case
 *      letter (camelCase → space).
 *   3. Title-case the first letter of each space-separated word.
 *   4. Preserve all-caps runs by leaving them untouched (a sequence of 2+ caps
 *      indicates an acronym — `URL` stays `URL`, `IDNumber` becomes `ID Number`).
 *
 * Adopter override path: provide `header="..."` on the `<column>` slot to bypass.
 */
export function tableHeaderTitleCase(fieldName: string): string {
  if (!fieldName) return "";
  // Step 1: separators to spaces.
  let s = fieldName.replace(/[_-]+/g, " ");
  // Step 2: camelCase boundary insertion — but preserve all-caps runs.
  // Pattern: lowercase letter followed by uppercase letter → insert space.
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Also handle ACR + word boundaries: `URLPath` → `URL Path`.
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  // Step 3: title-case first letter of each word.
  s = s.replace(/(^|\s)([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  return s;
}

// Re-export mechanicalLabel + parseValidatorClauses for downstream consumers if needed.
export { mechanicalLabel, parseValidatorClauses };
