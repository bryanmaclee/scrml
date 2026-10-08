/**
 * Phase A1c Step C8 — Validity surface synthesis emission (compound-level
 * rollup + per-field touched + compound submitted).
 *
 * For every COMPOUND state-decl (`_cellKind === "compound-parent"`), emits:
 *
 *   - `@compound.errors`    — derived cell, object map `{fieldName: [...errorTags]}`
 *                             keyed in declaration order.
 *   - `@compound.isValid`   — derived cell, `Object.values(errors).every(arr => arr.length === 0)`.
 *   - `@compound.touched`   — derived cell, object map `{fieldName: bool}`.
 *   - `@compound.submitted` — reactive cell (init `false`), set true by document-level
 *                             submit listener.
 *
 * For every PER-FIELD scope (each non-synth, non-compound-typed compound child), emits:
 *
 *   - `@compound.field.errors`  — trivial-default `[]` derived (only when C7 did NOT
 *                                 emit a runner — i.e. the field has no validators
 *                                 per §55.6 line 25139-25142 predictability rule).
 *   - `@compound.field.isValid` — trivial-default `true` derived (same condition).
 *   - `@compound.field.touched` — reactive cell (init `false`); event listeners wired
 *                                 by emit-bindings.ts when the field has a render-by-tag
 *                                 binding.
 *
 * Per the BRIEF + §55.5 / §55.6 / §55.7 / §55.13 + B11/B12 spec.
 *
 * Cross-references:
 *   - SPEC §55.5 (lines 25085-25120) — compound-level synth surface (4 properties)
 *   - SPEC §55.6 (lines 25122-25142) — per-field synth surface (3 properties; no submitted)
 *   - SPEC §55.7 (lines 25144-25156) — synth-property semantics + timing table
 *   - SPEC §55.13                    — reset(@compound) clears synth state
 *   - PA-SCRML-PRIMER §8 + §13.7 B11/B12
 *   - compiler/src/codegen/emit-validators.ts — C7 per-field validator runner
 *     (consumer of `<compound>.<field>.errors`/`isValid` derivations from C7)
 *   - compiler/src/codegen/emit-bindings.ts — C8 EXTENDS render-by-tag listener
 *     with per-field touched-event wiring
 *   - compiler/src/symbol-table.ts — B11/B12 synth-cell registry +
 *     `getSynthRecords(compoundDecl)` / `getPerFieldSynthRecords(fieldDecl)`
 *
 * # Scope (IN)
 *
 *   1. Compound-level rollup emission (errors, isValid).
 *   2. Per-field `touched` reactive cell + compound-level `touched` rollup.
 *   3. Compound-level `submitted` reactive cell + document submit listener.
 *   4. Per-field trivial defaults (errors=[], isValid=true) for no-validator fields.
 *   5. Reset integration via `_scrml_init_set` registration so `_scrml_reset(@compound)`
 *      walks the synth cells too (§55.13).
 *
 * # Scope (OUT)
 *
 *   - Per-field/compound `touched` event-wiring on the DOM elements (lives in
 *     emit-bindings.ts — render-by-tag dispatch is the natural extension point).
 *   - Cross-field reactive deps refinement — C9.
 *   - Error message rendering (`messageFor` 4-level chain) — C10.
 *   - `<errors of=>` element — C11.
 *   - Engine-state-cell validators (§55.14) — out of Wave 3.
 *   - Top-level non-compound cells: no synth surface (§55.5 L11 Edge A).
 *
 * # Skip rules
 *
 * Returns `null` (no emission) when any of:
 *   1. `node._cellKind !== "compound-parent"` (and `Array.isArray(children)` is false).
 *   2. `opts.boundary === "server"` — synth surface is client-side.
 *   3. `opts.insideFunctionBody` — reassignments don't re-register the surface.
 *
 * # Form-detection / submit-handler approach (per SURVEY)
 *
 * The "form" surface in scrml is conventionally `<form onsubmit=submit()>`. C8 does
 * NOT statically map a compound to its form element (no compile-time form-binding
 * inference exists). Instead, for each compound parent with a `submitted` synth,
 * C8 emits ONE `document.addEventListener("submit", ...)` listener that sets
 * `<compound>.submitted = true` on first submit anywhere in the document.
 *
 * This is the spec-conforming "predictability over selectivity" reading of §55.7
 * line 25153 — `submitted` becomes true on FIRST submit attempt. Multi-form
 * discrimination (one form per compound) can be refined in C11+ without breaking
 * C8's contract. For Wave 3 foundational, this is acceptable; documented in BRIEF
 * + SURVEY.
 */

import type { EncodingContext } from "./type-encoding.ts";

// ---------------------------------------------------------------------------
// Local types — minimal shape needed for emission. Full types live in
// compiler/src/types/ast.ts; emit-synth-surface consumes them structurally.
// ---------------------------------------------------------------------------

interface EmitSynthSurfaceOpts {
  /** Boundary (client/server). Server boundary skips emission. */
  boundary: "server" | "client";
  /** Inside-fn-body suppresses emission. */
  insideFunctionBody?: boolean;
  /** Encoding context for storage-key encoding (mirrors C5/C7). */
  encodingCtx?: EncodingContext | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit the compound-level validity-surface synthesis for a compound parent decl,
 * plus per-field trivial defaults for fields C7 didn't cover.
 *
 * Returns one or more newline-separated JS statements (no trailing newline), OR
 * `null` if the cell does not satisfy emission preconditions (skip rules).
 *
 * Caller (`_appendSidecar` in emit-logic.ts compound-parent arm) joins this with
 * the existing per-field validator-runner output (C7) and the parent-derived-
 * declare statements.
 *
 * @param node — the compound-parent state-decl AST node
 * @param qualifiedName — the compound's storage key (e.g. `"signup"` or `"outer.inner"`)
 * @param opts — emission options
 */
export function emitCompoundSynthSurface(
  node: any,
  qualifiedName: string,
  opts: EmitSynthSurfaceOpts,
): string | null {
  // Skip rule 1: not a compound parent.
  const isCompound =
    node?._cellKind === "compound-parent" || Array.isArray(node?.children);
  if (!isCompound) return null;

  // Skip rule 2: server boundary.
  if (opts.boundary === "server") return null;

  // Skip rule 3: inside function body.
  if (opts.insideFunctionBody) return null;

  const children: any[] = Array.isArray(node?.children) ? node.children : [];
  // Filter to NON-SYNTH, NON-COMPOUND-TYPED children — these are the ones with
  // a per-field synth surface per B12. Compound-typed children get their own
  // (recursive) compound-level surface via emit-logic.ts's recursive walk.
  const fieldChildren = children.filter((c: any) => {
    if (!c || typeof c !== "object") return false;
    if (c.kind !== "state-decl") return false;
    // Compound-typed children: B12 SKIPS per-field surface for them; their
    // compound-scope synth records (B11) on a recursive emission ARE the
    // per-field surface from the parent's perspective. Don't double-key here.
    if (c._cellKind === "compound-parent" || Array.isArray(c.children)) return false;
    // Markup-typed and derived children are not validatable per §55.14 +
    // §55.5 L11 Edge A — exclude from rollup.
    if (c._cellKind === "markup-typed") return false;
    if (c.shape === "derived" && c.isConst === true) return false;
    return true;
  });

  const ctx = opts.encodingCtx ?? null;
  const encodeKey = (k: string): string => (ctx ? ctx.encode(k) : k);

  const parentKey = encodeKey(qualifiedName);
  const errorsKey = encodeKey(`${qualifiedName}.errors`);
  const isValidKey = encodeKey(`${qualifiedName}.isValid`);
  const touchedKey = encodeKey(`${qualifiedName}.touched`);
  const submittedKey = encodeKey(`${qualifiedName}.submitted`);

  const lines: string[] = [];

  // -------------------------------------------------------------------------
  // Phase 0: per-field trivial-default emission (§55.6 L11 Edge B)
  //
  // Per §55.6 lines 25139-25142: per-field surface exists EVEN when the field
  // has no validators — `errors` is `[]`, `isValid` is `true`. C7 emits the
  // runner ONLY for fields with non-empty validators[]; C8 emits trivial
  // defaults for the rest. Predictability over selectivity.
  //
  // Per-field `touched` reactive cell is emitted unconditionally (every field
  // gets the touched surface; the event listener wiring is emit-bindings.ts's
  // territory).
  // -------------------------------------------------------------------------
  for (const child of fieldChildren) {
    const childName: string = child.name;
    if (!childName) continue;
    const childQName = `${qualifiedName}.${childName}`;
    const childErrorsKey = encodeKey(`${childQName}.errors`);
    const childIsValidKey = encodeKey(`${childQName}.isValid`);
    const childTouchedKey = encodeKey(`${childQName}.touched`);

    // Per-field errors/isValid — only emit trivial defaults when C7 did NOT
    // emit a runner (i.e. validators array is empty). Same predicate C7 uses.
    const hasValidators =
      Array.isArray(child.validators) && child.validators.length > 0;
    if (!hasValidators) {
      lines.push(
        `_scrml_derived_declare(${JSON.stringify(childErrorsKey)}, () => []);`,
      );
      lines.push(
        `_scrml_derived_declare(${JSON.stringify(childIsValidKey)}, () => true);`,
      );
    }

    // Per-field touched — reactive cell, init false. Event listeners wired by
    // emit-bindings.ts's render-by-tag dispatch loop. Init-thunk registered so
    // `_scrml_reset(@compound)` clears it back to false (§55.13).
    lines.push(
      `_scrml_reactive_set(${JSON.stringify(childTouchedKey)}, false);`,
    );
    lines.push(
      `_scrml_init_set(${JSON.stringify(childTouchedKey)}, () => false);`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1: compound-level `errors` derived rollup
  //
  // Reads each field's `<compound>.<field>.errors` derivation and reduces to
  // an object map keyed by field name. Subscribes to each field-errors so the
  // rollup re-fires when any field's errors change.
  //
  // For fields that aren't validatable (compound/markup-typed/derived — already
  // filtered out of `fieldChildren`), they don't appear in the map. This
  // matches §55.5's "object map keyed by field name" — only fields with a
  // validator surface are keyed.
  //
  // Edge case: empty `fieldChildren` (compound with only compound-typed/derived
  // children) — emit `() => ({})`. Trivially-valid.
  // -------------------------------------------------------------------------
  const errorsMapEntries: string[] = [];
  for (const child of fieldChildren) {
    const childName: string = child.name;
    if (!childName) continue;
    const childErrorsKey = encodeKey(`${qualifiedName}.${childName}.errors`);
    errorsMapEntries.push(
      `${JSON.stringify(childName)}: _scrml_derived_get(${JSON.stringify(childErrorsKey)})`,
    );
  }
  const errorsBody =
    errorsMapEntries.length === 0 ? "({})" : `({ ${errorsMapEntries.join(", ")} })`;
  lines.push(
    `_scrml_derived_declare(${JSON.stringify(errorsKey)}, () => ${errorsBody});`,
  );
  for (const child of fieldChildren) {
    const childName: string = child.name;
    if (!childName) continue;
    const childErrorsKey = encodeKey(`${qualifiedName}.${childName}.errors`);
    lines.push(
      `_scrml_derived_subscribe(${JSON.stringify(errorsKey)}, ${JSON.stringify(childErrorsKey)});`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 2: compound-level `isValid` derived
  //
  // Reads `<compound>.errors` (the rollup map) and tests every value array is
  // empty. Subscribes to the errors derivation only.
  //
  // For empty fieldChildren: trivially `true` (Object.values({}).every(...) is
  // `true` per JS spec).
  // -------------------------------------------------------------------------
  lines.push(
    `_scrml_derived_declare(${JSON.stringify(isValidKey)}, () => _scrml_g.Object.values(_scrml_derived_get(${JSON.stringify(errorsKey)})).every(arr => arr.length === 0));`,
  );
  lines.push(
    `_scrml_derived_subscribe(${JSON.stringify(isValidKey)}, ${JSON.stringify(errorsKey)});`,
  );

  // -------------------------------------------------------------------------
  // Phase 3: compound-level `touched` derived rollup
  //
  // Reads each field's `<compound>.<field>.touched` reactive cell and reduces
  // to object map. Subscribes per-field.
  // -------------------------------------------------------------------------
  const touchedMapEntries: string[] = [];
  for (const child of fieldChildren) {
    const childName: string = child.name;
    if (!childName) continue;
    const childTouchedKey = encodeKey(`${qualifiedName}.${childName}.touched`);
    touchedMapEntries.push(
      `${JSON.stringify(childName)}: _scrml_reactive_get(${JSON.stringify(childTouchedKey)})`,
    );
  }
  const touchedBody =
    touchedMapEntries.length === 0
      ? "({})"
      : `({ ${touchedMapEntries.join(", ")} })`;
  lines.push(
    `_scrml_derived_declare(${JSON.stringify(touchedKey)}, () => ${touchedBody});`,
  );
  for (const child of fieldChildren) {
    const childName: string = child.name;
    if (!childName) continue;
    const childTouchedKey = encodeKey(`${qualifiedName}.${childName}.touched`);
    lines.push(
      `_scrml_derived_subscribe(${JSON.stringify(touchedKey)}, ${JSON.stringify(childTouchedKey)});`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 4: compound-level `submitted` reactive cell + document submit
  // listener
  //
  // Init `false`. Listener at document level (bubble phase) sets to `true`
  // on first submit. Once `true`, never reverts (until reset). Init-thunk
  // registered so `_scrml_reset(@compound)` clears it.
  //
  // The listener runs on EVERY submit anywhere in the document. Per the
  // SURVEY decision, multi-form discrimination is a refinement deferred
  // to a later step. Document-level listener is wrapped in a guard that
  // skips when already-true to avoid redundant reactive triggers.
  //
  // §53 read-only invariant: callers cannot programmatically set `submitted`
  // (E-SYNTHESIZED-WRITE catches at parse time). This emit-time listener is
  // the ONLY writer.
  // -------------------------------------------------------------------------
  lines.push(
    `_scrml_reactive_set(${JSON.stringify(submittedKey)}, false);`,
  );
  lines.push(
    `_scrml_init_set(${JSON.stringify(submittedKey)}, () => false);`,
  );
  // Defensive: only wire the listener when running in a browser context. The
  // server-boundary skip already triggered at the top of this function, but
  // detectRuntimeChunks may include this module's emission for tree-shaking
  // edge cases — guarding `typeof document !== "undefined"` is harmless.
  lines.push(`if (typeof _scrml_g.document !== "undefined") {`);
  lines.push(
    `  _scrml_g.document.addEventListener("submit", () => {`,
  );
  lines.push(
    `    if (_scrml_reactive_get(${JSON.stringify(submittedKey)}) !== true) {`,
  );
  lines.push(
    `      _scrml_reactive_set(${JSON.stringify(submittedKey)}, true);`,
  );
  lines.push(`    }`);
  lines.push(`  });`);
  lines.push(`}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-field touched event wiring helpers (consumed by emit-bindings.ts).
// ---------------------------------------------------------------------------

/**
 * Build the JS statements that wire per-field `touched` event listeners on a
 * single DOM element. Called from emit-bindings.ts's render-by-tag dispatch
 * loop after the bind:* listener is established.
 *
 * Listens to:
 *   - the bind-dispatch's `inputEvent` (input/change) per §55.7 timing table
 *   - `focusout` per §55.7 ("first focus-out" trigger)
 *
 * Once `touched=true`, never reverts (until reset). Each listener is a
 * fire-once-style; we still register both to cover both interaction paths.
 *
 * @param qualifiedFieldName — encoded storage key for the field cell
 *   (e.g. `"signup.email"`)
 * @param elemVarName — the JS variable name holding the DOM element
 *   (caller provides; this is `bElemId` in emit-bindings.ts)
 * @param inputEvent — the "input" or "change" event used by the bind:*
 *   wiring; we listen on the same event to match per-bind semantics
 * @param ctx — encoding context (encodes `<field>.touched`)
 */
export function emitTouchedEventListenerLines(
  qualifiedFieldName: string,
  elemVarName: string,
  inputEvent: "input" | "change",
  ctx: EncodingContext | null,
): string[] {
  const touchedKey = ctx ? ctx.encode(`${qualifiedFieldName}.touched`) : `${qualifiedFieldName}.touched`;
  const lines: string[] = [];
  lines.push(`// C8: per-field touched event wiring (§55.7)`);
  lines.push(
    `${elemVarName}.addEventListener(${JSON.stringify(inputEvent)}, () => {`,
  );
  lines.push(
    `  if (_scrml_reactive_get(${JSON.stringify(touchedKey)}) !== true) {`,
  );
  lines.push(
    `    _scrml_reactive_set(${JSON.stringify(touchedKey)}, true);`,
  );
  lines.push(`  }`);
  lines.push(`});`);
  lines.push(
    `${elemVarName}.addEventListener("focusout", () => {`,
  );
  lines.push(
    `  if (_scrml_reactive_get(${JSON.stringify(touchedKey)}) !== true) {`,
  );
  lines.push(
    `    _scrml_reactive_set(${JSON.stringify(touchedKey)}, true);`,
  );
  lines.push(`  }`);
  lines.push(`});`);
  return lines;
}
