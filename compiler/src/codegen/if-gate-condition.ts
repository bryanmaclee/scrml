/**
 * §17.1 / §17.1.2 — the ONE lowering of an `if=` predicate to a JS condition.
 *
 * Three callers, one implementation:
 *   - the §17.1 mount/unmount controller (emit-event-wiring.ts, `isMountToggle`),
 *   - the display toggle and the descendant-effect guard (emit-event-wiring.ts, `ifGuard`),
 *   - a structural element gated INSIDE an `<each>` row — a nested `<each if=…>` — whose
 *     gate is evaluated by the row's own effect rather than a `<template>`+marker
 *     controller (emit-each.ts). The row can only differ in SCOPE (a row alias or `@.`
 *     names the enclosing item); it rewrites those names on a copy of the fields and then
 *     calls `lowerMountToggleCondition` like every other `if=` site.
 *
 * Moved out of `emitEventWiring` (S469) unchanged except that the file-scoped inputs it
 * closed over (`ctx.derivedNames`, `ctx.synthCellKeys`, `encodingCtx`, `requestIds`) are a
 * parameter — so the row-scoped caller cannot drift into a second lowering.
 */
import { emitExprField, reparseRequestRefEscapeHatch, resolveSynthCellPrefix } from "./emit-expr.ts";
import type { ExprNode } from "../types/ast.ts";
import type { EncodingContext } from "./type-encoding.ts";

/** The condition fields an `if=` binding carries (the LogicBinding / ifGuard shape). */
export interface IfGateConditionFields {
  condExpr?: string;
  condExprNode?: any;
  refs?: string[];
  varName?: string;
  dotPath?: string;
}

/** The file-scoped inputs the lowering reads. */
export interface IfGateLoweringEnv {
  derivedNames?: Set<string>;
  synthCellKeys?: Set<string>;
  encodingCtx?: EncodingContext | null;
  requestIds: Set<string>;
}

/**
 * §17.1 — the condition fields of an `if=` attribute VALUE, for the three value kinds the
 * mount gate accepts (`isGateableIfValue`): `expr`, `call-ref`, `variable-ref`. Null for
 * any other kind. ONE derivation shared by the mount-gate registration and the
 * descendant-effect guard (emit-html.ts) and the row-scoped structural gate (emit-each.ts).
 */
export function ifGateConditionFields(attrValue: any): IfGateConditionFields | null {
  if (!attrValue) return null;
  if (attrValue.kind === "expr") {
    return { condExpr: attrValue.raw, condExprNode: attrValue.exprNode, refs: attrValue.refs };
  }
  if (attrValue.kind === "call-ref") {
    const condRaw = `${attrValue.name}(${(attrValue.args ?? []).join(", ")})`;
    const condRefs = (attrValue.args ?? [])
      .filter((a: any) => typeof a === "string" && a.startsWith("@"))
      .map((a: any) => a.replace(/^@/, "").split(/[.[(]/)[0]);
    return { condExpr: condRaw, refs: condRefs };
  }
  if (attrValue.kind === "variable-ref") {
    const ifVarName = (attrValue.name ?? "").replace(/^@/, "");
    const ifBaseVar = ifVarName.split(".")[0];
    return { varName: ifBaseVar, ...(ifVarName.includes(".") ? { dotPath: ifVarName } : {}) };
  }
  return null;
}

// ss20 item-1 — lower an `if=` DISPLAY-TOGGLE predicate to its JS condition
// string. Shared by the display-toggle emission AND the inner-effect gating
// (binding.ifGuard) so the toggle and the effects it guards stay in lockstep
// (identical encoding + lowering — do not re-lower independently). Accepts the
// toggle binding OR a stamped ifGuard sub-object (same field shape). Returns
// null when neither a condExpr nor a varName is present.
export function lowerDisplayToggleCondition(
  b: IfGateConditionFields,
  env: IfGateLoweringEnv,
): { conditionCode: string; subscribeVars: string[] } | null {
  if (b.condExpr) {
    // g-request-data-is-some-misroute (S312) — a `<request>`-ref member as an
    // `is`-predicate LHS in an `if=`/`show=` ATTRIBUTE (`if=<#r>.data is some`)
    // reaches here with condExprNode an ESCAPE-HATCH: `shouldSkipExprParse` skips
    // any `<`-leading expr (HTML-fragment guard), so the attribute parser never
    // built a structured node. The escape-hatch → string fallback both mis-routes
    // the ref (§36 registry) AND mangles the `is some` LHS (→ E-CODEGEN-INVALID-
    // LOGIC, stale client). Re-parse the raw with the (now sigil-aware) parser to
    // get a real node, then emit via the SAME structured path the `${...}` text-
    // interpolation uses. Scoped to `<#`-bearing exprs so every other escape-hatch
    // condition keeps its existing string lowering byte-identical.
    // S312 `if=`/`show=` toggle regime — reparse ANY `<#`-leading escape-hatch
    // (request OR §36 input-state), UNGATED. An input-state `if=<#field>.value
    // is some` toggle MUST reparse or the string fallback mangles its `is some`
    // LHS → E-CODEGEN-INVALID-LOGIC; `requestIds` (below) still routes a
    // registered id to `_scrml_request_<id>` and an input-state id to the
    // registry. Gating this to registered-only broke input-state toggles (S239
    // round-3 regression), so pass `false`.
    const condNode = reparseRequestRefEscapeHatch(
      b.condExprNode as ExprNode | undefined,
      b.condExpr,
      "<if-request-ref>",
      env.requestIds,
      /* gateToRegisteredRequests */ false,
    ) as ExprNode | undefined;
    // Bug 61 — thread synthCellKeys + derivedNames so `if=@form.isValid`
    // conditional-display reads route to the dotted synth cell. `requestIds` routes
    // a reparsed `<#r>` ref to the reactive `_scrml_request_<r>` object (§6.7.7).
    const compiled = emitExprField(condNode, b.condExpr, { mode: "client", derivedNames: env.derivedNames, synthCellKeys: env.synthCellKeys, requestIds: env.requestIds });
    return { conditionCode: `(${compiled})`, subscribeVars: b.refs ?? [] };
  } else if (b.varName) {
    const condVarName = b.varName;
    const encodedCondVar = env.encodingCtx && env.encodingCtx.enabled ? env.encodingCtx.encode(condVarName) : condVarName;
    let conditionCode: string;
    if (b.dotPath) {
      const memberTail = b.dotPath.slice(condVarName.length + 1);
      // g-if-attr-per-field-synth-cell-crashes-boot (S372) — §55 synth-surface
      // collapse, the SAME rule the `condExpr` branch above gets for free by
      // threading `synthCellKeys` into `emitExprField` (the Bug 61 comment at
      // the top of that branch). This branch consulted NOTHING, so the two
      // spellings of ONE predicate lowered two different ways:
      //
      //   if=(@signup.isValid)   -> _scrml_reactive_get("signup.isValid")   correct
      //   if=@signup.isValid     -> _scrml_reactive_get("signup").isValid   wrong
      //
      // and the second is wrong in two distinct ways, BOTH measured on
      // b0abcbc6 against the SHIPPED runtime chunk:
      //
      //   COMPOUND-LEVEL scalars (`@signup.isValid`, `.submitted`) — the
      //   compound is a §6.3 Variant C NAMESPACE whose value object carries
      //   only its field keys, so the member read is permanently `undefined`.
      //   Falsy, no throw, boot survives, exit 0, zero diagnostics — and the
      //   gated subtree NEVER MOUNTS however the cell moves. Silent-wrong.
      //
      //   PER-FIELD, three-level (`@signup.name.touched` / `.isValid` /
      //   `.errors`) — that same value object holds `name: null` (the field's
      //   value lives in the flat cell `signup.name`), so the chain
      //   DEREFERENCES NULL. The TypeError lands inside `_scrml_nav_rewire`
      //   under `_scrml_boot`, so it does not merely break this element:
      //   EVERY `${...}` interpolation on the page never wires. A dead page,
      //   also at exit 0.
      //
      // NOT fixed with `?.`: optional chaining stops the throw while leaving
      // the condition permanently false, which converts the loud failure into
      // the silent one rather than resolving either.
      const synth = resolveSynthCellPrefix([condVarName, ...memberTail.split(".")], env.synthCellKeys);
      // ⚑ S372 REVIEW FINDING 1 — THE COLLAPSE IS GATED ON THE CELL'S SHAPE,
      // AND THE GATE IS NOT OPTIONAL.
      //
      // §55 does NOT give every synth cell a scalar. The COMPOUND-LEVEL
      // `errors` and `touched` rollups are OBJECT MAPS keyed by field name:
      //
      //   _scrml_derived_declare("signup.errors",  () => ({ name: get("signup.name.errors") }));
      //   _scrml_derived_declare("signup.touched", () => ({ name: get("signup.name.touched") }));
      //
      // An object literal is ALWAYS TRUTHY. Collapsing those two would take a
      // gate that read `undefined` (never mounts) to one that is
      // unconditionally true — so a pristine, untouched form would render its
      // error block at boot. MEASURED: base `mount@boot=false`, naive-collapse
      // `mount@boot=true`, on `<div if=@signup.touched>` and `if=@signup.errors`
      // with no interaction. That is a visible REGRESSION on the §55 flagship,
      // so those two rows stay on the pre-existing lowering and remain
      // BYTE-IDENTICAL to main.
      //
      // ⚑ The cell shape is NOT the bug and must not be "fixed" here. §6.11's
      // table says `touched` is `boolean` and `errors` is `string[]`, and the
      // implementation disagrees — but PRIMER §13.7 B11 records the object-map
      // shape as INTENTIONAL per §55 and calls §6.11 a non-blocking spec-prose
      // drift for a separate amendment. So truthiness over a rollup map is
      // simply MEANINGLESS, and the broken lowering was masking that. Which of
      // {always-true, never-true, diagnose} is right is an OPERATOR RULING.
      // This lowering declines to invent one.
      //
      // ⚑ PER-FIELD `.errors` DOES NOT COLLAPSE EITHER, AND THE REASON IS A
      // METHOD LESSON WORTH MORE THAN THE RULE. Two review rounds justified
      // collapsing it on "base is a DEAD PAGE there, so there is no working
      // behaviour to preserve." That was measured on ONE field-declaration
      // form — the MARKUP-TYPED field, whose compound value is `{name: null}`,
      // so a 3-level read dereferences null and throws. Vary the declaration
      // form and the premise evaporates:
      //
      //     <name req length(>=2)> = <input type="text"/>   (markup-typed)
      //     <name req length(>=2)> = ""                     (literal-init)
      //
      // With the literal-init form the compound value is `{name: ""}`, so
      // `get("signup").name.errors` is merely `undefined` — NO crash, boot
      // alive, gate correctly false. MEASURED base, literal-init:
      // `ctl="true"`, gate false. Collapsing there takes a CORRECT gate to a
      // permanently-visible error block. Fatal→wrong on one declaration form
      // does not license correct→wrong on another, so it declines with the
      // rollups and is carried under the SAME open ruling.
      //
      // ⚑ RESIDUAL, NAMED NOT HIDDEN: `if=@field.errors` on a MARKUP-TYPED
      // field is still a dead page, exactly as on main. That is an open limb
      // of the filed HIGH, not something this lowering closed.
      //
      // HOW COMPOUND-LEVEL IS DETECTED, without a second hand-maintained list:
      // `collectSynthCellKeys` gives a compound parent FOUR keys
      // (errors/isValid/touched/submitted) and a field child THREE (no
      // `submitted` — §55.7). So `<prefix>.submitted ∈ synthCellKeys` IS the
      // "prefix is a compound parent" test, derived from the same artifact the
      // collapse itself reads, so gate and outcome cannot drift (invariant 65).
      // ⚑ EVERYTHING BELOW IS COMPUTED INSIDE `if (synth)`. The previous cut
      // dereferenced `synth.tail` one line ABOVE its own null guard and was
      // safe only by short-circuit accident — `types-gate` caught it as
      // TS18047 "'synth' is possibly 'null'". Reordering a term or adding any
      // leaf test true for "" would have made every `if=@x.y` toggle with no
      // synth hit throw at COMPILE time.
      if (synth) {
        const synthLeaf = synth.dotted.slice(synth.dotted.lastIndexOf(".") + 1);
        const synthPrefix = synth.dotted.slice(0, synth.dotted.lastIndexOf("."));
        // `<prefix>.submitted ∈ synthCellKeys` IS the "prefix is a compound
        // parent" test — §55.7 gives `submitted` to parents only.
        const isCompoundParent = env.synthCellKeys?.has(`${synthPrefix}.submitted`) === true;

        // ⚑ THE TAIL MUST LAND ON A SCALAR, NOT MERELY BE NON-EMPTY. A tail
        // INTO a rollup's value space is still always truthy, and the value
        // space differs per rollup — measured on the shipped chunk against a
        // PRISTINE, FULLY-VALID form (`<signup> <name> = "" </>`):
        //
        //   errors  maps field -> ARRAY    `@signup.errors.name`  -> []    TRUTHY
        //   touched maps field -> BOOLEAN  `@signup.touched.name` -> false scalar
        //
        // so a field-key tail is fatal on `errors` and CORRECT on `touched`.
        // A tail that is NOT a field key is a container property
        // (`.length`) and is scalar on both.
        //
        // DERIVED, not enumerated. Same artifact the collapse reads, so gate
        // and outcome cannot drift (invariant 65); no scalar-tail allow-list
        // to fall out of date.
        //
        // ⚑ TWO TERMS, AND THE SECOND IS NOT OPTIONAL — `<prefix>.<seg>.errors
        // ∈ keys` ALONE DOES NOT MEAN "seg is a field". `collectSynthCellKeys`
        // also emits `<compound>.<nestedCompound>.errors`, because a nested
        // compound gets its own full surface. But the compound-level `errors`
        // ROLLUP keys only `fieldChildren` — emit-synth-surface.ts:220-232
        // iterates `fieldChildren`, which EXCLUDES compound-typed children. So
        // a nested compound name is registered yet is NOT a key of the rollup,
        // and `get("signup.errors").addr` is `undefined` — a correct false
        // gate, i.e. exactly the case where collapsing is the right answer.
        //
        // The one-term test declined it and fell back to
        // `get("signup").errors.addr` → `undefined.addr` → TypeError in
        // `_scrml_boot` → whole page unwired. Inert vs base (base emits the
        // identical chain — verified) but a fixable dead page.
        //
        // `submitted` is the discriminator, and it is compound-ONLY (§55.7):
        // a nested compound gets `<prefix>.<seg>.submitted` registered, a
        // field child never does. PA-VERIFIED on a nested fixture:
        // `signup.addr.submitted` IS in the key set, `signup.name.submitted`
        // is NOT. So:
        //
        //   seg names a FIELD  iff  <prefix>.<seg>.errors ∈ keys
        //                      AND  <prefix>.<seg>.submitted ∉ keys
        const tailFirstSeg = synth.tail ? synth.tail.slice(1).split(".")[0] : "";
        const tailLandsOnFieldValue =
          tailFirstSeg !== "" &&
          env.synthCellKeys?.has(`${synthPrefix}.${tailFirstSeg}.errors`) === true &&
          env.synthCellKeys?.has(`${synthPrefix}.${tailFirstSeg}.submitted`) !== true;

        // The ALWAYS-TRUTHY set. Truthiness over these is MEANINGLESS, so the
        // collapse declines and the pre-existing lowering stands — see the
        // open operator ruling in the block comment above.
        //   `errors` — the rollup map / the array itself, OR any read that
        //              lands on a field's error ARRAY. `[]` is as truthy as `{}`.
        //   `touched` at COMPOUND level — the rollup map itself. A field-key
        //              tail off it is a plain boolean and DOES collapse.
        const isAlwaysTruthyGate =
          (synthLeaf === "errors" && (synth.tail === "" || tailLandsOnFieldValue)) ||
          (synthLeaf === "touched" && isCompoundParent && synth.tail === "");

        if (!isAlwaysTruthyGate) {
          // The emitted key is PLAIN, not `encode()`d — byte-identical to what
          // `emitMember` and the `condExpr` branch produce for the same
          // predicate, which is the entire point (one predicate, one lowering).
          //
          // ⚑ This is safe under a chunk encoding context, but NOT for the
          // reason a reader might assume: the membership test runs on the
          // PLAIN `condVarName` + `dotPath`, so it still HITS and the collapse
          // still fires. What makes the plain key correct is that `encode()`
          // is a pass-through for unregistered names and only TOP-LEVEL
          // state-decl names are ever registered (codegen/index.ts) — a DOTTED
          // synth key never is. If dotted keys are ever registered, this site
          // must encode and so must `emitMember`, together, or the two
          // spellings diverge again.
          return {
            conditionCode: `(_scrml_reactive_get(${JSON.stringify(synth.dotted)})${synth.tail})`,
            // ⚑ NOT LOAD-BEARING, AND SAYING SO IS THE POINT. Nothing reads
            // this VALUE: its sole consumer (the display-toggle block below)
            // tests `subscribeVars !== undefined` and discards it, and
            // `computeMountToggleCondition` / the `ifGuard` path drop it
            // entirely. The dependency that actually re-fires the toggle is
            // `_scrml_effect`, which DYNAMICALLY TRACKS whatever
            // `conditionCode` reads when it runs — so the subscription follows
            // the collapse for free. Reported as the honest field value (the
            // synth cell IS the dependency; the root compound is not — a write
            // to `signup.name.touched` notifies nothing keyed `signup`), but do
            // not add a reader on the strength of this comment, and do not
            // treat `_scrml_effect` as redundant with it.
            subscribeVars: [synth.dotted],
          };
        }
      }
      conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${memberTail})`;
    } else {
      conditionCode = `_scrml_reactive_get(${JSON.stringify(encodedCondVar)})`;
    }
    return { conditionCode, subscribeVars: [encodedCondVar] };
  }
  return null;
}

// §17.1 Phase 2 — lower an `if=` MOUNT/UNMOUNT predicate to its JS condition
// string. Delegates to `computeDisplayToggleCondition` so the mount controller
// and the display toggle lower a condition IDENTICALLY.
//
// Before Phase 2 these two were separate code paths and had silently diverged:
// the mount controller called `emitExprField(node, raw, { mode: "client" })`
// with NEITHER `derivedNames` NOR `synthCellKeys`, so `if=@form.isValid` on a
// mount-path element lowered to a member read on the compound VALUE
// (`undefined` → falsy → never mounts) instead of the dotted synth cell — the
// GH #262 / #275 defect class, in a second location. Phase 2 routes ~2/3 more
// `if=` sites through this controller, so the two lowerings must be one.
//
// The one thing the mount path needs that the display path does not: §6.7.7
// `if=<#id>.loading` lowers (TAB) to varName `_scrml_input_<id>_` with a
// dotPath; when `<id>` names a `<request>`, that must route to the reactive
// `_scrml_request_<id>` object (the deep-reactive Proxy `_scrml_effect`
// auto-tracks), NOT a nonexistent reactive cell named `_scrml_input_<id>_`.
export function lowerMountToggleCondition(
  b: IfGateConditionFields,
  env: IfGateLoweringEnv,
): string | undefined {
  if (!b.condExpr && b.varName) {
    const condVarName = b.varName;
    const reqRefMatch = condVarName.match(/^_scrml_input_([A-Za-z_$][A-Za-z0-9_$]*)_$/);
    if (reqRefMatch && env.requestIds.has(reqRefMatch[1])) {
      const reqId = reqRefMatch[1];
      const tail = b.dotPath ? b.dotPath.slice(condVarName.length + 1) : "";
      return tail ? `(_scrml_request_${reqId}.${tail})` : `(_scrml_request_${reqId})`;
    }
  }
  const lowered = lowerDisplayToggleCondition(b, env);
  return lowered ? lowered.conditionCode : undefined;
}
