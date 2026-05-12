import { SCRML_RUNTIME } from "../runtime-template.js";
import { exprNodeContainsCall } from "../expression-parser.ts";
import { assembleRuntime } from "./runtime-chunks.ts";
import { CGError } from "./errors.ts";
import { escapeRegex } from "./utils.ts";
import { emitFunctions } from "./emit-functions.ts";
import { emitBindings } from "./emit-bindings.ts";
import { emitReactiveWiring } from "./emit-reactive-wiring.ts";
import { emitEventWiring } from "./emit-event-wiring.ts";
import { emitEngineSubstrate, emitDerivedEngineSubstrateForFile, emitCrossFileEngineMountsForFile, emitEngineHookFiringFunctionsForFile, emitEngineInitialArmsForFile, emitEngineBodyRenderForFile, emitDerivedEngineBodyRenderForFile } from "./emit-engine.ts";
import { setVariantFieldsForFile } from "./emit-control-flow.ts";
import { EncodingContext, emitDecodeTable, emitRuntimeReflect } from "./type-encoding.ts";
import type { CompileContext } from "./context.ts";
export type { EncodingContext } from "./type-encoding.ts";
export type { CompileContext } from "./context.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnumVariant {
  name?: string;
  payload?: any;
}

interface TypeDecl {
  kind: string;
  typeKind?: string;
  name?: string;
  variants?: EnumVariant[];
  raw?: string;
}

// ---------------------------------------------------------------------------
// hasRuntimeMetaBlocks — detect ^{} blocks with capturedScope (§22.5)
// ---------------------------------------------------------------------------

/**
 * Walk the AST and return true if any meta node has a capturedScope set,
 * indicating it is a runtime meta block that requires the decode table.
 */
function hasRuntimeMetaBlocks(fileAST: any): boolean {
  const nodes: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  function visit(nodeList: any[]): boolean {
    for (const node of nodeList) {
      if (!node) continue;
      if (node.kind === "meta" && node.capturedScope) return true;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        if (visit(node.body)) return true;
      }
      if (Array.isArray(node.children)) {
        if (visit(node.children)) return true;
      }
    }
    return false;
  }
  return visit(nodes);
}

// ---------------------------------------------------------------------------
// detectRuntimeChunks — walk the AST and register needed runtime chunks.
//
// Populates ctx.usedRuntimeChunks based on what the compiled file uses.
// 'core', 'scope', and 'errors' are always included (pre-populated in
// makeCompileContext). This function adds conditionally-needed chunks.
//
// Detection is conservative: when in doubt, include the chunk. A false
// positive (chunk included but not used) adds a few KB. A false negative
// (chunk omitted but needed) causes a runtime crash.
//
// Chunk → triggering AST node kinds / features:
//   derived       state-decl with shape:"derived" + structuralForm:false
//                 (formerly reactive-derived-decl; folded in Phase A1a Step 11.5)
//   lift          lift-expr, or markup children containing lift bodies
//   timers        markup tag "timer", "poll", or "timeout"
//   animation     markup tag with animationFrame body, or direct animationFrame call
//   reconciliation for-stmt with @reactive iterable
//   utilities     reactive-nested-assign, debounce-call, throttle-call,
//                 upload-call, reactive-explicit-set, bare navigate call,
//                 state-decl with reactivity (debounced= / throttled= per §6.13).
//   meta          meta node
//   transitions   logic binding or event binding with transitionEnter/transitionExit
//   input         markup tag "keyboard", "mouse", or "gamepad"
//   deep_reactive state-decl (uses _scrml_deep_reactive), when-effect, bind: directives,
//                 CSS variable bridge with reactive refs, bind-props wiring
//   equality      match-stmt with enum arms, == / != binary ops (uses _scrml_structural_eq)
// ---------------------------------------------------------------------------

/**
 * Detect which runtime chunks are needed for the given fileAST and add them
 * to ctx.usedRuntimeChunks.
 *
 * Called before assembling the runtime in generateClientJs().
 */
function detectRuntimeChunks(fileAST: any, ctx: CompileContext): void {
  const chunks = ctx.usedRuntimeChunks;
  const allNodes: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];

  // Check if an ExprNode tree contains == or != (structural equality)
  function exprNeedsEquality(expr: any): boolean {
    if (!expr || typeof expr !== "object") return false;
    if (expr.kind === "binary" && (expr.op === "==" || expr.op === "!=")) return true;
    for (const key of Object.keys(expr)) {
      const v = expr[key];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) { for (const el of v) { if (exprNeedsEquality(el)) return true; } }
        else if (exprNeedsEquality(v)) return true;
      }
    }
    return false;
  }

  // C5 (§6.8): check if an ExprNode tree contains a reset(@cell) call. Triggers
  // the `reset` runtime chunk so `_scrml_reset` and the default+init thunk
  // registries are present at runtime.
  function exprContainsResetExpr(expr: any): boolean {
    if (!expr || typeof expr !== "object") return false;
    if (expr.kind === "reset-expr") return true;
    for (const key of Object.keys(expr)) {
      const v = expr[key];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) { for (const el of v) { if (exprContainsResetExpr(el)) return true; } }
        else if (exprContainsResetExpr(v)) return true;
      }
    }
    return false;
  }

  // Walk the full AST tree recursively
  function walkNodes(nodes: any[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      detectFromNode(node);
      if (Array.isArray(node.children)) walkNodes(node.children);
      if (Array.isArray(node.body)) walkBody(node.body);
    }
  }

  function walkBody(body: any[]): void {
    if (!Array.isArray(body)) return;
    for (const stmt of body) {
      if (!stmt || typeof stmt !== "object") continue;
      detectFromNode(stmt);
      if (Array.isArray(stmt.body)) walkBody(stmt.body);
      if (Array.isArray(stmt.consequent)) walkBody(stmt.consequent);
      if (Array.isArray(stmt.alternate)) walkBody(stmt.alternate);
      if (Array.isArray(stmt.children)) walkNodes(stmt.children);
    }
  }

  function detectFromNode(node: any): void {
    const kind: string = node.kind ?? "";

    // Check all ExprNode-valued fields for structural equality ops (== / !=)
    // and C5's reset-expr (triggers `reset` chunk).
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (v && typeof v === "object" && typeof v.kind === "string") {
        if (exprNeedsEquality(v)) chunks.add("equality");
        if (exprContainsResetExpr(v)) chunks.add("reset");
      }
    }

    switch (kind) {
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl
      // (the `case "state-decl"` below handles the post-fold representation
      // and gates the `derived` chunk on shape:"derived").

      // lift — DOM lift expressions
      case "lift-expr":
        chunks.add("lift");
        break;

      // state-decl — @x = value. Uses _scrml_deep_reactive for object/array wrapping.
      // Phase A1a Step 11.5 — fold: state-decl with shape:"derived" AND
      // structuralForm:false is the post-fold representation of legacy
      // `const @x = expr` (formerly reactive-derived-decl). Triggers the
      // `derived` chunk in addition to `deep_reactive`.
      // C5 (§6.8): a state-decl with `defaultExpr !== null` triggers the
      // `reset` chunk (default= storage helper). Plain Shape 1/Shape 2 cells
      // also emit an init-thunk via `_scrml_init_set` so reset can re-evaluate
      // the init expression — but that's also part of the `reset` chunk.
      // Conservative trigger: if any state-decl has `defaultExpr` set, we
      // need the chunk. The companion trigger (a `reset-expr` AST node anywhere
      // in the file) is handled by the ExprNode walker below.
      case "state-decl":
        chunks.add("deep_reactive");
        if (
          (node as any).shape === "derived" &&
          (node as any).structuralForm === false
        ) {
          chunks.add("derived");
        }
        if ((node as any).defaultExpr) {
          chunks.add("reset");
        }
        // S79 / §6.13: a state-decl with `reactivity` set (debounced= /
        // throttled=) triggers the `utilities` chunk — that's where the
        // _scrml_reactive_debounced / _scrml_reactive_throttled / register
        // helpers live. The cancel-on-reset path lives in `_scrml_reset`
        // ('reset' chunk), so trigger that too — but only when a rule is
        // actually present (a future write may reset() the cell, and the
        // reset chunk's call into _scrml_reactivity_cancel needs the
        // utilities chunk to be present so the lookup resolves).
        if ((node as any).reactivity) {
          chunks.add("utilities");
        }
        // C7 (§55.2 + §55.6): a state-decl with non-empty validators[] triggers
        // the `validators` runtime chunk (14 fire functions + VALIDATOR_RUNTIME
        // map + _scrml_validator_fire dispatch). C7 codegen emits the per-cell
        // runner as a derived computation, so the `derived` chunk is also
        // required. Top-level non-compound cells with validators technically
        // hit this trigger too — they include the chunk even though C7 emits
        // no runner (no per-field synth surface to write to per §55.5 L11
        // Edge A). Conservative tree-shaking — a few KB cost over correctness.
        if (
          Array.isArray((node as any).validators) &&
          (node as any).validators.length > 0
        ) {
          chunks.add("validators");
          chunks.add("derived");
          // C10 (§55.10 L12): Level-1 inline override emission. When ANY
          // validator on this cell carries a non-null `inlineOverride`, the
          // emitted code calls `_scrml_messages_register_inline` from the
          // `messages` chunk. Tree-shaken when no inline overrides exist
          // and (future, C11) no `<errors of=>` element appears.
          for (const v of (node as any).validators as any[]) {
            if (v && typeof v.inlineOverride === "string") {
              chunks.add("messages");
              break;
            }
          }
        }
        // C8 (§55.5/§55.6/§55.7): every compound-parent state-decl triggers
        // the validity-surface synth emission (compound-level rollup +
        // per-field touched + compound submitted + per-field trivial defaults).
        // The emission uses:
        //   - `derived` chunk — _scrml_derived_declare/get/subscribe for the
        //     compound errors/isValid/touched derivations + per-field trivial
        //     defaults.
        //   - `reset` chunk — _scrml_init_set registrations for per-field
        //     touched + compound submitted (so reset(@compound) clears them
        //     per §55.13).
        // Predictability rule (§55.5): unconditional for every compound
        // parent — even compounds with no validator-bearing fields get the
        // surface with trivially-true isValid + empty errors.
        if (
          (node as any)._cellKind === "compound-parent" ||
          Array.isArray((node as any).children)
        ) {
          chunks.add("derived");
          chunks.add("reset");
        }
        break;

      // timers — <timer> and <poll> markup elements
      case "markup": {
        const tag: string = node.tag ?? "";
        if (tag === "timer" || tag === "poll" || tag === "timeout") {
          chunks.add("timers");
          chunks.add("deep_reactive"); // emitLifecycleNode uses _scrml_effect for running=@var
        }
        if (tag === "keyboard" || tag === "mouse" || tag === "gamepad") {
          chunks.add("input");
        }
        if (tag === "channel") {
          // <channel> generates inline WebSocket code (no runtime chunk needed)
          // but uses _scrml_register_cleanup — already in 'scope' (always included)
        }
        // Check for reactive for-loop (iterable is @varName) — within children
        if (Array.isArray(node.children)) {
          walkNodes(node.children);
        }
        break;
      }

      // for-stmt — reactive for-loops use _scrml_reconcile_list + _scrml_effect_static + _scrml_lift
      case "for-stmt": {
        // Phase 4d: ExprNode-first — check iterExpr for reactive @var, string fallback
        const _iterExpr = node.iterExpr;
        const iterIsReactive = _iterExpr
          ? (_iterExpr.kind === "ident" && typeof _iterExpr.name === "string" && _iterExpr.name.startsWith("@"))
          : /^@[A-Za-z_$][A-Za-z0-9_$]*$/.test((node.iterable ?? node.collection ?? "").trim());
        if (iterIsReactive) {
          chunks.add("reconciliation");
          chunks.add("lift");
          chunks.add("deep_reactive"); // _scrml_effect_static
        }
        if (Array.isArray(node.body)) walkBody(node.body);
        break;
      }

      // meta — ^{} runtime meta blocks use _scrml_meta_effect
      case "meta":
        chunks.add("meta");
        break;

      // when-effect — uses _scrml_effect
      case "when-effect":
        chunks.add("deep_reactive");
        break;

      // register-cleanup — uses _scrml_register_cleanup (already in 'scope')
      // No extra chunk needed.

      // utilities — various utility function calls
      case "reactive-nested-assign":
        chunks.add("utilities"); // _scrml_deep_set
        break;
      // S79 — case "reactive-debounced-decl" RETIRED (state-decl with
      // reactivity field handles the chunk-trigger now).
      // S81 OQ-2 (2026-05-11) — `case "debounce-call"` + `case "throttle-call"`
      // RETIRED. Imperative form replaced by stdlib `scrml:time.debounce`/
      // `throttle` imports (regular function calls; chunk-trigger inferred
      // from the import + the importing module's chunk needs).
      case "upload-call":
        chunks.add("utilities"); // _scrml_upload
        break;
      case "reactive-explicit-set":
        chunks.add("utilities"); // _scrml_reactive_explicit_set
        break;

      // C13 (§51.0.F + §51.0.G): engine-decl in scope → enable the `engine`
      // runtime chunk for C13 hooks (_scrml_engine_check_transition / advance /
      // direct_set). Conservative trigger: any engine-decl AST node — even
      // derived ones (C14 surface) currently have no helper hookups, but a
      // future direct-write hook on derived projection results would reuse
      // this same chunk. Tree-shaken when no engines appear in the file.
      //
      // C14 (§51.0.J): derived engine-decl ALSO needs the `derived` chunk
      // (`_scrml_derived_declare`/`_scrml_derived_subscribe`/`_scrml_derived_get`)
      // — emit-engine.ts:emitDerivedEngineSubstrateForFile uses these helpers
      // to register the engine variant cell as a read-only derived cell. The
      // tightest gate is `engineMeta.derivedExpr != null` which mirrors C14's
      // emission gate exactly.
      case "engine-decl": {
        chunks.add("engine");
        // C14: derived engine (non-legacy `<machine>` keyword) needs the
        // `derived` chunk. Mirror the gate used by
        // `isC14DerivedEngineDecl` (`derivedExpr != null` AND
        // `legacyMachineKeyword !== true`).
        const engineMeta = (node as any)._record?.engineMeta;
        const isLegacyMachine = (node as any).legacyMachineKeyword === true;
        if (!isLegacyMachine && engineMeta && engineMeta.derivedExpr != null) {
          chunks.add("derived");
        }
        break;
      }

      // match-stmt with enum arms — uses _scrml_structural_eq for enum comparison
      case "match-stmt": {
        const arms: any[] = node.arms ?? [];
        const hasEnumArm = arms.some((arm: any) =>
          arm && (arm.enumType || arm.pattern?.includes("."))
        );
        if (hasEnumArm) {
          chunks.add("equality");
        }
        break;
      }

      // Recurse into logic body nodes
      case "logic":
        if (Array.isArray(node.body)) walkBody(node.body);
        break;
    }

    // Check for animationFrame calls in bare-expr nodes
    // Phase 4d Step 8: ExprNode-only (bare-expr.expr TS field deleted; production AST always has exprNode)
    if (kind === "bare-expr") {
      const exprNode = (node as any).exprNode;
      if (exprNode) {
        if (exprNodeContainsCall(exprNode, "animationFrame")) chunks.add("animation");
        if (exprNodeContainsCall(exprNode, "navigate") || exprNodeContainsCall(exprNode, "_scrml_navigate")) chunks.add("utilities");
      } else if ((node as any).expr) {
        // Runtime-only fallback for synthetic test nodes
        const expr: string = (node as any).expr ?? "";
        if (expr.includes("animationFrame(")) chunks.add("animation");
        if (expr.includes("navigate(") || expr.includes("_scrml_navigate(")) chunks.add("utilities");
      }
    }

    // Recurse into function declarations
    if (kind === "function-decl" && Array.isArray(node.body)) {
      walkBody(node.body);
    }
  }

  walkNodes(allNodes);

  // Check for bind: directives and reactive display bindings in the binding registry.
  // These use _scrml_effect for reactive wiring.
  const eventBindings: any[] = (ctx.registry as any).eventBindings ?? [];
  const logicBindings: any[] = (ctx.registry as any).logicBindings ?? [];

  if (logicBindings.length > 0) {
    chunks.add("deep_reactive"); // _scrml_effect for reactive display
    // Check for transition directives
    for (const binding of logicBindings) {
      if (binding.transitionEnter || binding.transitionExit) {
        chunks.add("transitions");
        break;
      }
    }
  }

  if (eventBindings.length > 0) {
    // Event wiring itself doesn't use runtime functions directly,
    // but if there are logic bindings with reactive refs, those use _scrml_effect
    chunks.add("deep_reactive");
  }

  // Check for bind: directives — these use _scrml_effect and _scrml_deep_set
  const allAstNodes: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  function hasBoundDirectives(nodes: any[]): boolean {
    for (const node of nodes) {
      if (!node) continue;
      const attrs: any[] = node.attributes ?? node.attrs ?? [];
      for (const attr of attrs) {
        if (attr?.name?.startsWith("bind:")) return true;
        if (attr?.name?.startsWith("class:")) return true;
        if (attr?.name === "ref") return true;
      }
      if (Array.isArray(node.children) && hasBoundDirectives(node.children)) return true;
    }
    return false;
  }

  if (hasBoundDirectives(allAstNodes)) {
    chunks.add("deep_reactive"); // _scrml_effect for bind: wiring
    chunks.add("utilities");     // _scrml_deep_set for path bindings (bind:x.y)
  }

  // CSS variable bridges — use _scrml_effect when there are reactive refs
  const allNodes2: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  function hasCssBridges(nodes: any[]): boolean {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "css" && Array.isArray(node.rules)) {
        for (const rule of node.rules) {
          if ((rule as any).reactiveRefs?.length > 0 || (rule as any).isExpression) return true;
        }
      }
      if (Array.isArray(node.children) && hasCssBridges(node.children)) return true;
    }
    return false;
  }
  if (hasCssBridges(allNodes2)) {
    chunks.add("deep_reactive"); // _scrml_effect for CSS variable bridge
  }

  // Bind-props wiring — uses _scrml_effect
  function hasBindProps(nodes: any[]): boolean {
    for (const node of nodes) {
      if (!node) continue;
      if (Array.isArray(node._bindProps) && node._bindProps.length > 0) return true;
      if (Array.isArray(node.children) && hasBindProps(node.children)) return true;
    }
    return false;
  }
  if (hasBindProps(allAstNodes)) {
    chunks.add("deep_reactive");
  }
}

// ---------------------------------------------------------------------------
// generateClientJs
// ---------------------------------------------------------------------------

/**
 * Generate client-side JS for a file.
 */
export function generateClientJs(ctx: CompileContext): string {
  const { fileAST, protectedFields, errors, encodingCtx, workerNames } = ctx;
  const authMiddlewareEntry = ctx.authMiddleware;
  const csrfEnabled = ctx.csrfEnabled;
  const filePath: string = fileAST.filePath;
  const lines: string[] = [];

  // S22 §1a slice 2: publish the file's variant→payload-field lookup so that
  // emitMatchExpr can resolve positional bindings `.Circle(r)` to field names.
  // Cleared at end of this function so state does not leak between files.
  const { fields, collisions } = buildVariantFieldsRegistry(fileAST);
  setVariantFieldsForFile(fields, collisions);

  lines.push("// Generated client-side JS for scrml");
  lines.push("// This file is executable browser JavaScript.");
  lines.push("");

  // Detect which runtime chunks are needed and assemble only those.
  // 'core', 'scope', and 'errors' are always included (pre-populated in ctx).
  // detectRuntimeChunks() adds additional chunks based on AST feature usage.
  //
  // Note: The registry (binding registry) is populated during HTML emission
  // which runs before client JS generation. By the time we reach here,
  // ctx.registry has event/logic bindings available for detection.
  detectRuntimeChunks(fileAST, ctx);
  const runtimeSource = assembleRuntime(ctx.usedRuntimeChunks);
  lines.push(runtimeSource);
  lines.push("// --- end scrml reactive runtime ---");
  lines.push("");

  // Emit JS imports from use-decl and import-decl nodes (§40, §21.3, §41.3).
  // Local .scrml imports are rewritten to .client.js (compiled browser output).
  // scrml: and vendor: prefixed imports pass through unchanged — they are valid
  // Bun module specifiers and resolve at runtime against the bundled stdlib.
  const allImports: any[] = fileAST?.ast?.imports ?? fileAST?.imports ?? [];
  for (const stmt of allImports) {
    if ((stmt.kind === "import-decl" || stmt.kind === "use-decl") && stmt.source && stmt.names?.length > 0) {
      let jsSource: string = stmt.source;
      // Rewrite local .scrml imports to point to the compiled browser JS output.
      // scrml: and vendor: prefixed imports pass through unchanged — they are valid Bun module specifiers.
      if (jsSource.endsWith(".scrml")) {
        jsSource = jsSource.replace(/\.scrml$/, ".client.js");
      }
      const names: string = stmt.names.join(", ");
      if (stmt.isDefault) {
        lines.push(`import ${names} from ${JSON.stringify(jsSource)};`);
      } else {
        lines.push(`import { ${names} } from ${JSON.stringify(jsSource)};`);
      }
    }
  }
  lines.push("");

  // Enum toEnum() lookup tables (SPEC §14.4.1)
  const enumLookupLines = emitEnumLookupTables(fileAST);
  if (enumLookupLines.length > 0) {
    lines.push("// --- enum toEnum() lookup tables (compiler-generated) ---");
    for (const line of enumLookupLines) lines.push(line);
    lines.push("");
  }

  // Enum variant objects — `const Status = Object.freeze({ Loading: "Loading", ... })`
  // Allows `@status = Status.Loading` at runtime (§14.4)
  const enumObjectLines = emitEnumVariantObjects(fileAST);
  if (enumObjectLines.length > 0) {
    lines.push("// --- enum variant objects (compiler-generated) ---");
    for (const line of enumObjectLines) lines.push(line);
    lines.push("");
  }

  // C12 engine substrate — per `<engine for=Type initial=.X>` declaration:
  // (1) static transition table const, (2) auto-declared variant cell init.
  // SPEC §51.0.A-G. Emitted AFTER enum variant objects (so the variant tag
  // names map to defined runtime constants) and BEFORE reactive-wiring +
  // event-wiring (so the engine's auto-declared cell exists before any
  // user-authored code reads `@<varName>`).
  //
  // Direct-write rule= validation hook + `.advance()` method emission +
  // `<onTransition>` hook firing + body rendering are DEFERRED to C13/C14/
  // C15. See `compiler/src/codegen/emit-engine.ts` and the C12 SURVEY
  // (`docs/changes/phase-a1c-step-c12-engine-state-machine-runtime/SURVEY.md`)
  // for the full hand-off contract.
  const engineLines = emitEngineSubstrate(fileAST);
  if (engineLines.length > 0) {
    lines.push("// --- engine substrate (compiler-generated, §51.0) ---");
    for (const line of engineLines) lines.push(line);
    lines.push("");
  }

  // B17.4 (§51.0.H) — per-engine hook-firing functions + once-flag declarations
  // for `effect=` + `<onTransition>` arms. Emitted AFTER C12's variant cell
  // init (so the cell exists when the function is called) and BEFORE
  // reactive wiring (so write sites can reference the function via JS function
  // hoisting at module-init time). Also covers derived engines (per §51.0.J
  // line 20640 — `<onTransition>` and `effect=` are LEGAL on derived state-
  // children and fire on derived state changes).
  //
  // Tree-shake: when no engine in the file has hooks, this returns an empty
  // array and no section header is emitted. When some engines have hooks and
  // others don't, hookless engines emit no hook-firing function (the wrap
  // emitters at the write-site call sites gate on `enginesWithHooks` /
  // `EngineBindingInfo.hasHooks`).
  const engineHookLines = emitEngineHookFiringFunctionsForFile(fileAST);
  if (engineHookLines.length > 0) {
    lines.push("// --- engine hook-firing functions (compiler-generated, §51.0.H) ---");
    for (const line of engineHookLines) lines.push(line);
    lines.push("");
  }

  // C14 derived engine substrate — per `<engine for=Type derived=expr>` decl:
  // (1) `_scrml_derived_declare` registering a read-only variant cell with
  // a projection closure, (2) one `_scrml_derived_subscribe` per upstream
  // dependency, (3) forced initial `_scrml_derived_get` so init-time
  // E-DERIVED-ENGINE-INITIAL-UNDEFINED throws fire loudly per §51.0.J line
  // 20640 + §34 line 14460.
  //
  // SPEC §51.0.J. Emitted AFTER the C12 (non-derived) engine substrate so
  // any derived engine projecting from a non-derived engine variant cell
  // sees the upstream's initial value during init-time forced eval. NO
  // transition table (rule= rejected at A1b/B16); NO direct-write hook
  // (writes rejected at A1b/B16); NO `.advance()` (derived engines are
  // read-only per §51.0.J). `<onTransition>`/`effect=` firing on derived
  // state-children remains DEFERRED — same parser blocker as C13. See
  // `compiler/src/codegen/emit-engine.ts` C14 section + the C14 SURVEY
  // (`docs/changes/phase-a1c-step-c14-derived-engines/SURVEY.md`).
  const derivedEngineLines = emitDerivedEngineSubstrateForFile(fileAST);
  if (derivedEngineLines.length > 0) {
    lines.push("// --- derived engine substrate (compiler-generated, §51.0.J) ---");
    for (const line of derivedEngineLines) lines.push(line);
    lines.push("");
  }

  // Phase A10 (S78, 2026-05-10) — engine state-child body render.
  //
  // Emit per-arm render functions + dispatcher per in-scope engine.
  // Render functions are top-level fn decls (JS-hoisted). Dispatcher
  // subscribes to the engine variable via `_scrml_reactive_subscribe`,
  // firing on `set` only — initial-arm HTML emitted by emit-html.ts at
  // the engine's source position is left intact at module init so
  // file-level reactive-wiring can bind to its placeholders.
  //
  // Tree-shake: when no engine has any non-empty arm body, both arrays
  // are empty and no section header emits. The C12/C14 mount-position
  // marker comments are preserved as documented debug aids (Q4 RATIFIED).
  //
  // See SCOPE-AND-DECOMPOSITION.md §3.4 (Option C-prime, RATIFIED) and
  // PHASE-0-SURVEY §7.3 finalized helper signature.
  const c12BodyRender = emitEngineBodyRenderForFile(fileAST, ctx);
  const c14BodyRender = emitDerivedEngineBodyRenderForFile(fileAST, ctx);
  const allRenderFns = [...c12BodyRender.renderFunctions, ...c14BodyRender.renderFunctions];
  const allDispatchers = [...c12BodyRender.dispatchers, ...c14BodyRender.dispatchers];
  if (allRenderFns.length > 0 || allDispatchers.length > 0) {
    lines.push("// --- engine body render (Phase A10, §51.0.D) ---");
    for (const fn of allRenderFns) {
      lines.push(fn);
      lines.push("");
    }
    for (const disp of allDispatchers) {
      lines.push(disp);
      lines.push("");
    }
  }

  // C15 cross-file engine mount markers — per §21.8 + §51.0.D.
  // For each `<engineVarName/>` use-site in the importer's markup whose
  // source export is `category: "engine"`, emit a mount-position marker
  // comment. The singleton mechanism is the page-shared `_scrml_state`
  // table — exporter's `_scrml_reactive_set("appPhase", ...)` writes to
  // the same map all importers read from. The JS module-import side is
  // already handled by the existing import-rewriter at line 498-514 above
  // (`import { Phase } from './engines.scrml'` → `import { Phase } from
  // "./engines.client.js"`). The `.client.js` import is preserved by the
  // GITI-003 prune (line 869) so the exporter's module-init code runs at
  // page load even when no symbol from the import is referenced in the
  // importer's body.
  //
  // Body rendering at the use-site DOM position is DEFERRED — same parser
  // blocker as C12/C13/C14. The marker documents WHERE the imported
  // engine renders; a follow-on body-render emitter fills the slot.
  //
  // See `compiler/src/codegen/emit-engine.ts` C15 section + the C15 SURVEY
  // (`docs/changes/phase-a1c-step-c15-cross-file-engine-mount/SURVEY.md`).
  const crossFileEngineMountLines = emitCrossFileEngineMountsForFile(fileAST, ctx.exportRegistry ?? null);
  if (crossFileEngineMountLines.length > 0) {
    lines.push("// --- cross-file engine mounts (compiler-generated, §21.8 + §51.0.D) ---");
    for (const line of crossFileEngineMountLines) lines.push(line);
    lines.push("");
  }

  // §4.12.4: Worker instantiation — new Worker() + Promise-based .send()
  if (workerNames && workerNames.length > 0) {
    lines.push("// --- worker instantiation (compiler-generated, §4.12.4) ---");
    for (const name of workerNames) {
      lines.push(`const _scrml_worker_${name} = new Worker("${name}.worker.js");`);
      lines.push(`_scrml_worker_${name}.send = function(data) {`);
      lines.push(`  return new Promise(function(resolve) {`);
      lines.push(`    _scrml_worker_${name}.onmessage = function(e) { resolve(e.data); };`);
      lines.push(`    _scrml_worker_${name}.postMessage(data);`);
      lines.push(`  });`);
      lines.push(`};`);
    }
    lines.push("");
  }

  // @session reactive projection (Option C hybrid)
  if (authMiddlewareEntry) {
    const { loginRedirect } = authMiddlewareEntry;

    lines.push("// --- @session reactive projection (compiler-generated) ---");
    lines.push("let _scrml_session = null;");
    lines.push("");
    lines.push("async function _scrml_session_init() {");
    lines.push("  try {");
    lines.push("    const resp = await fetch('/_scrml/session', { credentials: 'include' });");
    lines.push("    if (resp.ok) {");
    lines.push("      _scrml_session = await resp.json();");
    lines.push("    } else {");
    lines.push("      _scrml_session = null;");
    lines.push("    }");
    lines.push("  } catch {");
    lines.push("    _scrml_session = null;");
    lines.push("  }");
    lines.push("}");
    lines.push("");
    lines.push("const session = {");
    lines.push("  get current() { return _scrml_session; },");
    lines.push("  async destroy() {");
    lines.push("    await fetch('/_scrml/session/destroy', {");
    lines.push("      method: 'POST',");
    lines.push("      credentials: 'include',");
    lines.push("    });");
    lines.push("    _scrml_session = null;");
    lines.push(`    window.location.href = ${JSON.stringify(loginRedirect)};`);
    lines.push("  },");
    lines.push("};");
    lines.push("");
    lines.push("_scrml_session_init();");
    lines.push("");
  }

  // Baseline CSRF token helper
  if (csrfEnabled && !authMiddlewareEntry) {
    lines.push("// --- CSRF token helper (compiler-generated, double-submit cookie) ---");
    lines.push("function _scrml_get_csrf_token() {");
    lines.push("  const match = document.cookie.match(/(?:^|;\\s*)scrml_csrf=([^;]+)/);");
    lines.push("  return match ? decodeURIComponent(match[1]) : '';");
    lines.push("}");
    lines.push("");
    // GITI-010: fetch-with-retry wrapper. Only emitted when at least one
    // CSRF-gated mutating route exists — otherwise the helper would be dead
    // code (an SSE-only file uses EventSource, not fetch).
    let hasMutatingCsrfServerFn = false;
    const routeMap = ctx.routeMap;
    if (routeMap?.functions) {
      for (const [, route] of routeMap.functions) {
        if (!route || route.boundary !== "server") continue;
        const method = route.explicitMethod ?? "POST";
        if (method !== "GET" && method !== "HEAD") {
          hasMutatingCsrfServerFn = true;
          break;
        }
      }
    }
    if (hasMutatingCsrfServerFn) {
      // Cookie-less first POST receives a 403 with Set-Cookie (server plants
      // a fresh token). We retry exactly once, re-reading document.cookie
      // for the fresh X-CSRF-Token. Single-shot retry — if the second
      // attempt also 403s, it's a real mismatch (stale token, actual CSRF
      // attempt) and propagates to the caller.
      lines.push("async function _scrml_fetch_with_csrf_retry(path, method, body) {");
      lines.push("  let _scrml_resp = await fetch(path, {");
      lines.push("    method,");
      lines.push('    headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_get_csrf_token() },');
      lines.push("    body,");
      lines.push("  });");
      lines.push("  if (_scrml_resp.status === 403) {");
      lines.push("    _scrml_resp = await fetch(path, {");
      lines.push("      method,");
      lines.push('      headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_get_csrf_token() },');
      lines.push("      body,");
      lines.push("    });");
      lines.push("  }");
      lines.push("  return _scrml_resp;");
      lines.push("}");
      lines.push("");
    }
  }

  // Emit fetch stubs, CPS wrappers, and client-boundary function bodies
  const { lines: fnLines, fnNameMap } = emitFunctions(ctx);
  for (const line of fnLines) lines.push(line);

  // Emit top-level logic statements and CSS variable bridge
  const reactiveLines = emitReactiveWiring(ctx);
  for (const line of reactiveLines) lines.push(line);

  // A5-4 (§51.0.M) — Initial-arm for engines with <onTimeout>. Emitted AFTER
  // emitReactiveWiring so the user reactive cells (which a computed-form
  // <onTimeout after=${@var}<unit>/> may read at arm time) are initialized
  // first. Tree-shake: empty when no engine in the file has <onTimeout>.
  const engineInitArmLines = emitEngineInitialArmsForFile(fileAST);
  if (engineInitArmLines.length > 0) {
    lines.push("");
    lines.push("// --- engine onTimeout initial-arms (compiler-generated, §51.0.M) ---");
    for (const line of engineInitArmLines) lines.push(line);
  }

  // Emit ref= and bind:/class: directive wiring
  const bindingLines = emitBindings(ctx);
  for (const line of bindingLines) lines.push(line);

  // Emit event handler wiring and reactive display wiring
  const eventLines = emitEventWiring(ctx, fnNameMap);
  for (const line of eventLines) lines.push(line);

  // Emit type decode table + runtime reflect when encoding is enabled
  // and runtime meta blocks exist (§47.2, tree-shaking per §47.2.3)
  if (encodingCtx?.enabled && hasRuntimeMetaBlocks(fileAST)) {
    lines.push("");
    lines.push("// --- type decode table (§47.2) ---");
    lines.push(emitDecodeTable(encodingCtx));
    lines.push(emitRuntimeReflect());
    lines.push("");
  }

  // Post-process to mangle function call sites.
  //
  // Negative lookbehind `(?<!\.)` excludes property-access positions: the user's
  // fn `toggle()` must NOT rewrite `classList.toggle(...)`, `arr.forEach(...)`,
  // etc. Those are DOM / stdlib method calls on runtime values, unrelated to
  // the user symbol.
  //
  // Bug D (6nz inbound 2026-04-20): user fn `toggle()` → `_scrml_toggle_7`
  // corrupted the compiler-generated `classList.toggle("active", ...)` emitted
  // by the `class:active=@active` binding template. Any user fn sharing a name
  // with a DOM method (toggle, add, remove, append, replace, forEach, ...) hit
  // this bug silently.
  //
  // Bug I (adopter inbound 2026-04-22): user fn `lines()` corrupted
  // `n . lines` in record literal values because the emitter outputs
  // spaces around `.`, so the fixed-width `(?<!\.)` lookbehind saw a
  // space instead of a dot. Extended to variable-length `(?<!\.\s*)`.
  let clientCode = lines.join("\n");
  if (fnNameMap && fnNameMap.size > 0) {
    for (const [originalName, mangledName] of fnNameMap) {
      const callSiteRegex = new RegExp(
        `(?<!\\.\\s*)\\b${escapeRegex(originalName)}\\b(?=\\s*[(;,}\\]\\n)]|$)`,
        "g",
      );
      clientCode = clientCode.replace(callSiteRegex, mangledName);
    }

    // GITI-001 (giti inbound 2026-04-20): `@data = serverFn(args)` emits
    // `_scrml_reactive_set("data", _scrml_fetch_serverFn_N(args));` — storing
    // the UNAWAITED Promise. Readers then see `[object Promise]` instead of
    // the resolved value. Wrap each such statement in an async IIFE that
    // awaits the fetch stub before setting the reactive. Scoped by fnNameMap
    // so only server-fn call sites (fetch stubs / CPS wrappers) are touched.
    for (const [, mangledName] of fnNameMap) {
      if (!/^_scrml_(fetch|cps)_/.test(mangledName)) continue;
      // Match _scrml_reactive_set("NAME", <mangledName>( ... );) at statement level.
      // Body args may themselves contain `(`; count parens to find the matching close.
      const callPrefix = `${mangledName}(`;
      const setHead = "_scrml_reactive_set(";
      let i = 0;
      const parts: string[] = [];
      while (i < clientCode.length) {
        const setIdx = clientCode.indexOf(setHead, i);
        if (setIdx < 0) {
          parts.push(clientCode.slice(i));
          break;
        }
        // Locate the "," separating name and value.
        let depth = 1;
        let j = setIdx + setHead.length;
        while (j < clientCode.length && depth > 0) {
          if (clientCode[j] === "," && depth === 1) break;
          if (clientCode[j] === "(") depth++;
          else if (clientCode[j] === ")") depth--;
          j++;
        }
        if (j >= clientCode.length || clientCode[j] !== ",") {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        const nameArg = clientCode.slice(setIdx + setHead.length, j);
        // Skip whitespace after the comma.
        let valStart = j + 1;
        while (valStart < clientCode.length && /\s/.test(clientCode[valStart])) valStart++;
        // Value must begin with the mangled fetch-stub call.
        if (clientCode.slice(valStart, valStart + callPrefix.length) !== callPrefix) {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        // Walk through the call args to find its matching `)`.
        let cdepth = 1;
        let k = valStart + callPrefix.length;
        while (k < clientCode.length && cdepth > 0) {
          if (clientCode[k] === "(") cdepth++;
          else if (clientCode[k] === ")") cdepth--;
          if (cdepth === 0) break;
          k++;
        }
        if (k >= clientCode.length) {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        // k is the index of the closing `)` of the call. The outer
        // _scrml_reactive_set should close right after.
        let outerClose = k + 1;
        while (outerClose < clientCode.length && /\s/.test(clientCode[outerClose])) outerClose++;
        if (clientCode[outerClose] !== ")") {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        let stmtEnd = outerClose + 1;
        // S84 fix-lift-async-iife-paren: detect statement vs expression context.
        // The original `_scrml_reactive_set(name, fetchStub(args))` may appear in
        // EXPRESSION position (e.g. inside `el.textContent = await (...)` at
        // emit-event-wiring.ts:826/854/855 — markup that renders an `@var = serverFn()`
        // assignment). Always appending a trailing `;` to the IIFE wrap there
        // produces invalid `await ((async () => ...)();)` — a `;)` token sequence.
        // Preserve the trailing `;` only if the source had one (statement context).
        const hadTrailingSemi = clientCode[stmtEnd] === ";";
        if (hadTrailingSemi) stmtEnd++;
        const args = clientCode.slice(valStart + callPrefix.length, k);
        parts.push(clientCode.slice(i, setIdx));
        parts.push(`(async () => _scrml_reactive_set(${nameArg}, await ${mangledName}(${args})))()${hadTrailingSemi ? ";" : ""}`);
        i = stmtEnd;
      }
      clientCode = parts.join("");
    }
  }

  // GITI-003 (giti inbound 2026-04-20): prune imports that are only used by
  // server-fn bodies. Client emission unconditionally writes every import-
  // decl from the source file; when a name like `getGreeting` is referenced
  // only inside a `server function` body (which gets lowered to a fetch stub
  // that doesn't reference the original JS helper), the import in
  // `.client.js` points at a server-only module and 500s the browser load.
  //
  // Strategy: after all rewrites have run, parse out the top-of-file import
  // statements, check each imported name for any usage in the REMAINING body
  // of clientCode, and drop imports with no remaining usage. This is a
  // conservative post-pass — if a name is used anywhere in client output,
  // the import is preserved verbatim.
  //
  // testMode skip: unit tests that assert import-source passthrough with
  // minimal (empty-body) fixtures would see their imports pruned (correctly
  // unused) without this carve-out. Real compilations always go through
  // testMode: false.
  clientCode = ctx.testMode ? clientCode : (function pruneUnusedClientImports(code: string): string {
    const importRe = /^import\s+(?:\{([^}]*)\}|([A-Za-z_$][A-Za-z0-9_$]*))\s+from\s+(['"])([^'"]+)\3\s*;?\s*$/gm;
    const imports: Array<{ match: string; start: number; end: number; names: string[]; isDefault: boolean; src: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(code)) !== null) {
      const namedList = m[1];
      const defaultName = m[2];
      const src = m[4];
      const names = namedList
        ? namedList.split(",").map(s => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)
        : [defaultName];
      imports.push({
        match: m[0],
        start: m.index,
        end: m.index + m[0].length,
        names,
        isDefault: !namedList,
        src,
      });
    }
    // Build the "body" of the code (everything NOT in an import stmt), so
    // usage checks don't match the import statement itself.
    let body = code;
    // Strip each import from the body view (from the end so offsets don't shift)
    for (let i = imports.length - 1; i >= 0; i--) {
      const imp = imports[i];
      body = body.slice(0, imp.start) + " ".repeat(imp.end - imp.start) + body.slice(imp.end);
    }
    // Decide which imports to drop.
    //
    // Narrow targeting: only prune imports where the source is a plain
    // external module specifier — i.e. a path to user-written JS/TS that
    // might be server-only. Specifically preserve:
    //   - cross-file scrml outputs  (`.client.js` — always keep; scrml
    //     type decls and components are resolved at runtime via their
    //     compiled files)
    //   - scrml: stdlib imports     (runtime-provided)
    //   - vendor: external packages (resolved by bundler/runtime)
    //
    // The common prune target is a hand-written JS helper that's only
    // called from server fns — GITI-003.
    const toDrop: Set<number> = new Set();
    for (let i = 0; i < imports.length; i++) {
      const imp = imports[i];
      const src = imp.src;
      // Preserve imports whose source is managed by the scrml runtime.
      if (src.startsWith("scrml:") || src.startsWith("vendor:") || src.endsWith(".client.js")) continue;
      const usedInBody = imp.names.some(name => {
        const useRe = new RegExp(`(?<![.\\w$])${escapeRegex(name)}(?![\\w$])`, "");
        return useRe.test(body);
      });
      if (!usedInBody) toDrop.add(i);
    }
    if (toDrop.size === 0) return code;
    // Rebuild the file with dropped imports removed.
    let result = "";
    let cursor = 0;
    for (let i = 0; i < imports.length; i++) {
      if (toDrop.has(i)) {
        result += code.slice(cursor, imports[i].start);
        // skip the import itself; also skip a following newline if present
        let endCursor = imports[i].end;
        if (code[endCursor] === "\n") endCursor++;
        cursor = endCursor;
      }
    }
    result += code.slice(cursor);
    return result;
  })(clientCode);
  for (const field of protectedFields) {
    const fieldRegex = new RegExp(`\\.${escapeRegex(field)}\\b`);
    if (fieldRegex.test(clientCode)) {
      errors.push(new CGError(
        "E-CG-001",
        `E-CG-001: Protected field \`${field}\` found in client JS output. ` +
        `This indicates an upstream invariant violation.`,
        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }

  // Security validation: client JS must not contain SQL execution calls.
  // §44 Bun.SQL identifier `_scrml_sql` (and scoped `_scrml_sql_<n>` for
  // nested <program db="..."> contexts) must never reach the client.
  // Detected forms: `_scrml_sql.method(`, `_scrml_sql\``, `_scrml_sql_2.unsafe(`
  const SQL_LEAK_PATTERNS: RegExp[] = [
    /_scrml_sql_exec\s*\(/,                 // legacy helper name (defensive)
    /_scrml_db\s*\./,                       // legacy bun:sqlite db var (defensive)
    /\b_scrml_sql(?:_\d+)?\s*[.`]/,         // §44 Bun.SQL tag/method calls
    /\bprocess\.env\b/,
    /\bBun\.env\b/,
    /\bbun\.eval\s*\(/,
    /\?\{`/,
  ];
  for (const pattern of SQL_LEAK_PATTERNS) {
    if (pattern.test(clientCode)) {
      errors.push(new CGError(
        "E-CG-006",
        `E-CG-006: Server-only pattern (${pattern}) detected in client JS output. ` +
        `This is a security violation. Indicates a failure in the server-only node guard.`,
        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }

  // S22 §1a slice 2: release the per-file variant registry.
  setVariantFieldsForFile(null, null);

  return clientCode;
}

// ---------------------------------------------------------------------------
// buildVariantFieldsRegistry (S22 §1a slice 2)
//
// Scan fileAST.typeDecls once and produce:
//   - fields: Map<variantName, declaredFieldNames[]>
//   - collisions: Set<variantName> — names that appear in more than one enum,
//     flagging positional-binding ambiguity for emitMatchExpr.
// Uses the same decl.variants / decl.raw fallback logic as emitEnumVariantObjects
// (the type system may not attach .variants back onto the AST node).
// ---------------------------------------------------------------------------

export function buildVariantFieldsRegistry(fileAST: any): {
  fields: Map<string, string[]>;
  collisions: Set<string>;
} {
  const fields = new Map<string, string[]>();
  const collisions = new Set<string>();
  const typeDecls: TypeDecl[] = fileAST?.typeDecls ?? fileAST?.ast?.typeDecls ?? [];

  for (const decl of typeDecls) {
    if (decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;
    const info = getAllVariantInfo(decl);
    for (const v of info) {
      if (v.fieldNames === null) continue; // unit variants have no bindings
      if (fields.has(v.name)) {
        // Same variant name used in a second enum → positional ambiguity.
        collisions.add(v.name);
      } else {
        fields.set(v.name, v.fieldNames);
      }
    }
  }
  return { fields, collisions };
}

// ---------------------------------------------------------------------------
// emitEnumLookupTables
// ---------------------------------------------------------------------------

/**
 * Generate enum toEnum() lookup table declarations for all enum type
 * declarations in a FileAST.
 */
export function emitEnumLookupTables(fileAST: any): string[] {
  const lines: string[] = [];
  const typeDecls: TypeDecl[] = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [];

  for (const decl of typeDecls) {
    if (decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;

    const unitVariants = getUnitVariantNames(decl);
    if (unitVariants.length > 0) {
      const entries = unitVariants.map((name: string) => `"${name}": "${name}"`).join(", ");
      lines.push(`const ${decl.name}_toEnum = { ${entries} };`);
    }

    // §14.4.2 — variants array (all variant names in declaration order)
    const allVariants = getAllVariantNames(decl);
    if (allVariants.length > 0) {
      const variantsArray = allVariants.map((name: string) => `"${name}"`).join(", ");
      lines.push(`const ${decl.name}_variants = [${variantsArray}];`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// getUnitVariantNames
// ---------------------------------------------------------------------------

function stripTransitionsBlock(body: string): string {
  // §51.2: Remove `transitions { ... }` block from enum raw body
  const idx = body.indexOf("transitions");
  if (idx < 0) return body;
  const braceStart = body.indexOf("{", idx);
  if (braceStart < 0) return body;
  let depth = 0;
  let i = braceStart;
  while (i < body.length) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  return body.slice(0, idx) + body.slice(i);
}

function getUnitVariantNames(decl: TypeDecl): string[] {
  if (Array.isArray(decl.variants)) {
    return decl.variants
      .filter((v: EnumVariant) => v.payload === null || v.payload === undefined)
      .map((v: EnumVariant) => v.name ?? "")
      .filter((name: string) => typeof name === "string" && /^[A-Z]/.test(name));
  }

  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = stripTransitionsBlock(body);
  body = body.trim();

  if (!body) return [];

  const parts = body.split(/[\n,|]+/);
  const names: string[] = [];
  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    if (!trimmed) continue;
    if (trimmed.includes("(")) continue;
    const name = trimmed.split(/\s+/)[0];
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// getAllVariantNames
// ---------------------------------------------------------------------------

/**
 * Returns ALL variant names (unit and payload) for an enum type declaration,
 * in declaration order. Used by the .variants built-in array (§14.4.2).
 * For payload variants like Found(id: number), only the tag name is returned.
 */
function getAllVariantNames(decl: TypeDecl): string[] {
  if (Array.isArray(decl.variants)) {
    return decl.variants
      .map((v: EnumVariant) => v.name ?? "")
      .filter((name: string) => typeof name === "string" && /^[A-Z]/.test(name));
  }

  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = stripTransitionsBlock(body);
  body = body.trim();

  if (!body) return [];

  const parts = body.split(/[\n,|]+/);
  const names: string[] = [];
  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    if (!trimmed) continue;
    // For payload variants like Found(id: number), extract the name before '(' or whitespace.
    const name = trimmed.split(/[\s(]/)[0];
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// getAllVariantInfo — name + field ordering per variant (unit vs payload)
// ---------------------------------------------------------------------------

interface VariantInfo {
  name: string;
  fieldNames: string[] | null; // null → unit variant; [] → payload with no fields
}

/**
 * Returns ALL variants for an enum type declaration with their payload field
 * ordering when present. Prefers the structured `decl.variants` array (populated
 * by the type system's parseEnumBody) and falls back to parsing `decl.raw`
 * directly — the type system may not always populate `decl.variants` back onto
 * the AST node (the registry is the canonical store).
 */
function getAllVariantInfo(decl: TypeDecl): VariantInfo[] {
  const out: VariantInfo[] = [];

  if (Array.isArray(decl.variants) && decl.variants.length > 0) {
    for (const v of decl.variants) {
      const name = v.name ?? "";
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
      if (v.payload == null) {
        out.push({ name, fieldNames: null });
      } else if (v.payload instanceof Map) {
        out.push({ name, fieldNames: Array.from(v.payload.keys()) });
      } else if (typeof v.payload === "object") {
        // Some paths may leave payload as a plain object — keep insertion order.
        out.push({ name, fieldNames: Object.keys(v.payload) });
      } else {
        out.push({ name, fieldNames: null });
      }
    }
    if (out.length > 0) return out;
  }

  // Fallback: parse from decl.raw. Mirrors type-system.ts parseEnumBody:
  //   Name                  → unit variant
  //   Name(f1:T1, f2:T2)    → payload variant with ordered field names
  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = stripTransitionsBlock(body);
  body = body.trim();
  if (!body) return out;

  // Top-level split on newline AND comma AND `|` at depth 0 — matches the
  // looser style accepted by the existing getAllVariantNames helper.
  // Walking char-by-char avoids splitting inside `(... , ...)`.
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
      if (buf.trim()) parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    if (!trimmed) continue;

    const parenIdx = trimmed.indexOf("(");
    if (parenIdx === -1) {
      // Unit variant. Strip any trailing `renders ...` so we only keep the name.
      const name = trimmed.split(/\s+/)[0];
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
        out.push({ name, fieldNames: null });
      }
      continue;
    }

    // Payload variant
    const name = trimmed.slice(0, parenIdx).trim();
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
    const closeParenIdx = trimmed.lastIndexOf(")");
    if (closeParenIdx <= parenIdx) continue;
    const payloadStr = trimmed.slice(parenIdx + 1, closeParenIdx).trim();
    const fieldNames: string[] = [];
    if (payloadStr) {
      // Split on commas at depth 0 (payload types can contain generics/parens).
      let d = 0;
      let fb = "";
      const pieces: string[] = [];
      for (const ch of payloadStr) {
        if (ch === "(" || ch === "[" || ch === "{" || ch === "<") d++;
        else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") d--;
        if (d === 0 && ch === ",") {
          if (fb.trim()) pieces.push(fb);
          fb = "";
        } else {
          fb += ch;
        }
      }
      if (fb.trim()) pieces.push(fb);
      for (const p of pieces) {
        const colonIdx = p.indexOf(":");
        if (colonIdx === -1) continue;
        const fname = p.slice(0, colonIdx).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(fname)) fieldNames.push(fname);
      }
    }
    out.push({ name, fieldNames });
  }

  return out;
}

// ---------------------------------------------------------------------------
// emitEnumVariantObjects (§14.4)
// ---------------------------------------------------------------------------

/**
 * Generate frozen enum objects so developers can write `@status = Status.Loading`
 * for unit variants or `Shape.Circle(10)` for payload variants (§51.3.2).
 *
 * Unit variant   → `Square: "Square"`
 * Payload variant → `Circle: function(radius) { return { variant: "Circle", data: { radius } }; }`
 *
 * The tagged-object shape `{ variant, data }` aligns with §19.3.2 `fail` objects
 * (which add a `__scrml_error` sentinel) so one runtime can dispatch both.
 *
 * The `variants` property (§14.4.2) provides an ordered array of all variant
 * names, enabling iteration: `for (v of Status.variants) { ... }`.
 */
export function emitEnumVariantObjects(fileAST: any): string[] {
  const lines: string[] = [];
  const typeDecls: TypeDecl[] = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [];

  for (const decl of typeDecls) {
    if (decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;

    const info = getAllVariantInfo(decl);
    if (info.length === 0) continue;

    const entries: string[] = [];
    for (const v of info) {
      if (v.fieldNames === null) {
        entries.push(`${v.name}: "${v.name}"`);
      } else {
        const params = v.fieldNames.join(", ");
        const dataInit = v.fieldNames.length === 0 ? "{}" : `{ ${params} }`;
        entries.push(`${v.name}: function(${params}) { return { variant: "${v.name}", data: ${dataInit} }; }`);
      }
    }
    const variantsArray = info.map(v => `"${v.name}"`).join(", ");
    lines.push(`const ${decl.name} = Object.freeze({ ${entries.join(", ")}, variants: [${variantsArray}] });`);
  }

  return lines;
}
