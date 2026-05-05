import { genVar } from "./var-counter.ts";
import { extractSqlParams, rewriteTildeRef, buildTaggedTemplate } from "./rewrite.js";
import { emitExpr, emitExprField, type EmitExprContext } from "./emit-expr.ts";
import { stripLeakedComments, isLeakedComment, splitBareExprStatements, splitMergedStatements } from "./compat/parser-workarounds.js";
import { emitIfStmt, emitForStmt, emitWhileStmt, emitDoWhileStmt, emitBreakStmt, emitContinueStmt, emitTryStmt, emitMatchExpr, emitSwitchStmt, rewriteBlockBody, splitMultiArmString, parseMatchArm, matchArmInlineToMatchArm, emitVariantBindingPrelude, hasPayloadBindingOrTaggedVariant, type MatchArm } from "./emit-control-flow.ts";
import { emitLiftExpr } from "./emit-lift.js";
import { extractReactiveDeps, extractReactiveDepsFromExprNode } from "./reactive-deps.ts";
import { emitStringFromTree } from "../expression-parser.ts";
import type { EncodingContext } from "./type-encoding.ts";
import { emitRuntimeCheck } from "./emit-predicates.ts";
import { emitTransitionGuard } from "./emit-machines.ts";

// ---------------------------------------------------------------------------
// Deep reactive wrapping helper (Reactivity Phase 1)
// ---------------------------------------------------------------------------

/**
 * Wrap a rewritten expression with _scrml_deep_reactive() if the original
 * expression looks like it produces an object or array literal.
 *
 * Heuristic: wrap when the raw (pre-rewrite) expression starts with `{`, `[`,
 * `new `, or is a common object-producing pattern. For all other cases, the
 * runtime _scrml_deep_reactive is a no-op on primitives, so wrapping is safe
 * but we avoid it for readability.
 */
function _wrapDeepReactive(rewrittenExpr: string, rawExpr: string, initExpr?: any): string {
  // Phase 4d: ExprNode-first — structural detection of deep-reactive-worthy values
  if (initExpr) {
    const k = initExpr.kind;
    if (k === "object" || k === "array" || k === "new") {
      return `_scrml_deep_reactive(${rewrittenExpr})`;
    }
    if (k === "ident" && (initExpr.name === "Array" || initExpr.name === "Object")) {
      return `_scrml_deep_reactive(${rewrittenExpr})`;
    }
    if (k === "call" && initExpr.callee?.kind === "ident" &&
        (initExpr.callee.name === "Array" || initExpr.callee.name === "Object")) {
      return `_scrml_deep_reactive(${rewrittenExpr})`;
    }
    return rewrittenExpr;
  }
  // String fallback
  const trimmed = rawExpr.trim();
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("new ") ||
    trimmed.startsWith("Array") ||
    trimmed.startsWith("Object")
  ) {
    return `_scrml_deep_reactive(${rewrittenExpr})`;
  }
  return rewrittenExpr;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmitLogicOpts {
  derivedNames?: Set<string> | null;
  encodingCtx?: EncodingContext | null;
  /** §4.12.6: Override DB variable for nested <program db="..."> scopes. */
  dbVar?: string;
  /**
   * §32 Tilde pipeline accumulator context.
   * When set, bare-expr and value-lift nodes assign their result to this variable.
   * The `var` field is mutated by emitLogicNode to reflect the current tilde var name.
   */
  /**
   * §32 tilde mode: "single" (default) assigns once; "array" accumulates push calls
   * into an array declared before the enclosing loop (list comprehension pattern).
   */
  tildeContext?: { var: string | null; mode?: "single" | "array" };
  /**
   * When set to "return", `continue-stmt` nodes emit `return;` instead of `continue;`.
   * Used in reactive-for createItem functions where `continue` is illegal JS.
   */
  continueBehavior?: "continue" | "return";
  /** Track names declared by let-decl/const-decl so tilde-decl can detect reassignment. */
  declaredNames?: Set<string>;
  /** §51.5: Machine binding map for transition guard emission. Keyed by reactive var name. */
  machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null;
  /**
   * Emission boundary. "server" swaps DOM-oriented lowerings for their
   * server-context equivalents (e.g. `lift <expr>` in a server-fn body
   * becomes `return <expr>;` instead of a `_scrml_lift(() =>
   * document.createTextNode(...))` call — GITI-004). Required field
   * (S35 B2) — every entry-point caller SHALL declare context. Missing
   * `boundary` defaults to "client" at emitLogicNode entry with a
   * runtime warning so undeclared sites are loud, not silent.
   */
  boundary: "server" | "client";
}

/** An entry in the captured scope for a runtime ^{} meta block (from meta-checker.ts). */
interface ScopeVarEntry {
  name: string;
  kind: "reactive" | "let" | "const" | "function";
}

/** A serialized type entry from the runtime type registry (from meta-checker.ts). */
interface TypeRegistryEntry {
  name: string;
  kind: string;
  [key: string]: unknown;
}

interface LogicArm {
  pattern?: string;
  binding?: string;
  handler?: string;
}

// ---------------------------------------------------------------------------
// Helper: emit a guarded-expr arm body
// ---------------------------------------------------------------------------

function emitArmBody(arm: LogicArm, errVar: string, machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null): string {
  const handler = (arm.handler ?? "").trim();
  if (!handler) return "";
  // Block bodies `{ @var = expr; ... }` must go through rewriteBlockBody so that
  // reactive assignments (@var = expr) are emitted as _scrml_reactive_set() calls
  // rather than _scrml_reactive_get() on the left side of =.
  // When machineBindings is provided, machine-bound assignments emit transition guards (§51.5).
  if (handler.startsWith("{") && handler.endsWith("}")) {
    const inner = handler.slice(1, -1).trim();
    return inner ? rewriteBlockBody(inner, machineBindings ?? null) : "";
  }
  const rewritten = emitExprField(arm.handlerExpr, handler, _makeExprCtx({}));
  return rewritten.trim().endsWith(";") ? rewritten.trim() : rewritten.trim() + ";";
}

// ---------------------------------------------------------------------------
// Helpers for 4-argument _scrml_meta_effect emission (§22.5)
// ---------------------------------------------------------------------------

/**
 * Emit the capturedBindings argument for _scrml_meta_effect.
 * Reads node.capturedScope (set by meta-checker.ts).
 * Returns "null" if no scope data is available.
 *
 * @var entries produce getter functions (live reactive reads).
 * let/const/function entries produce direct value references.
 */
function emitCapturedBindings(node: any): string {
  const scope: ScopeVarEntry[] | undefined = node.capturedScope;
  if (!Array.isArray(scope) || scope.length === 0) return "null";

  const props: string[] = [];
  for (const entry of scope) {
    const { name, kind } = entry;
    if (!name || typeof name !== "string") continue;
    if (kind === "reactive") {
      // Getter returns live reactive value; auto-tracking intercepts the read
      props.push(`  get ${name}() { return _scrml_reactive_get("${name}"); }`);
    } else {
      // let/const/function — direct reference to the compiled JS variable
      props.push(`  ${name}: ${name}`);
    }
  }

  if (props.length === 0) return "null";
  return ["Object.freeze({", props.join(",\n"), "})"].join("\n");
}

/**
 * Emit the typeRegistry argument for _scrml_meta_effect.
 * Reads node.typeRegistrySnapshot (set by meta-checker.ts).
 * Returns "null" if no type data is available.
 *
 * The emitted object maps type names to reflection entries.
 * meta.types.reflect(name) uses this object for runtime type introspection.
 */
function emitTypeRegistryLiteral(node: any): string {
  const entries: TypeRegistryEntry[] | undefined = node.typeRegistrySnapshot;
  if (!Array.isArray(entries) || entries.length === 0) return "null";

  const typeProps: string[] = [];
  for (const entry of entries) {
    if (!entry.name || typeof entry.name !== "string") continue;
    const typeData = serializeTypeEntry(entry);
    typeProps.push(`  ${JSON.stringify(entry.name)}: ${typeData}`);
  }

  if (typeProps.length === 0) return "null";
  return ["({", typeProps.join(",\n"), "})"].join("\n");
}

/**
 * Serialize a single TypeRegistryEntry to a JavaScript object literal string.
 */
function serializeTypeEntry(entry: TypeRegistryEntry): string {
  const parts: string[] = [`kind: ${JSON.stringify(entry.kind)}`];

  if (entry.kind === "enum") {
    const variants = (entry.variants as Array<{ name: string }> | undefined) ?? [];
    const variantStrings = variants.map(v =>
      `{name: ${JSON.stringify(v.name)}}`
    );
    parts.push(`variants: [${variantStrings.join(", ")}]`);
  } else if (entry.kind === "struct") {
    const fields = (entry.fields as Array<{ name: string; type: string }> | undefined) ?? [];
    const fieldStrings = fields.map(f =>
      `{name: ${JSON.stringify(f.name)}, type: ${JSON.stringify(f.type)}}`
    );
    parts.push(`fields: [${fieldStrings.join(", ")}]`);
  } else if (entry.kind === "state") {
    const attrs = (entry.attributes as Array<{ name: string; type: string }> | undefined) ?? [];
    const attrStrings = attrs.map(a =>
      `{name: ${JSON.stringify(a.name)}, type: ${JSON.stringify(a.type)}}`
    );
    parts.push(`attributes: [${attrStrings.join(", ")}]`);
  }

  return `{${parts.join(", ")}}`;
}


// ---------------------------------------------------------------------------
// §22.4.2 reflect() rewrite for runtime meta blocks
//
// - PascalCase identifiers (type names) are quoted: meta.types.reflect("TypeName")
// - camelCase/@var identifiers (variables) are left unquoted: meta.types.reflect(variable)
// - Already-quoted strings are left as-is: meta.types.reflect("already")
// ---------------------------------------------------------------------------

const REFLECT_CALL_RE = /\breflect\s*\(\s*([^)]*)\s*\)/g;

export function rewriteReflectForRuntime(code: string): string {
  if (!code || typeof code !== "string") return code;
  return code.replace(REFLECT_CALL_RE, (_match, arg) => {
    const trimmed = (arg || "").trim();
    if (!trimmed) return `meta.types.reflect(${trimmed})`;
    // Already a string literal — pass through
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return `meta.types.reflect(${trimmed})`;
    }
    // Bare identifier — check if PascalCase (type name) or variable
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(trimmed)) {
      // PascalCase type name → quote it
      return `meta.types.reflect("${trimmed}")`;
    }
    // camelCase, @var, or complex expression — leave as-is
    return `meta.types.reflect(${trimmed})`;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build an EmitExprContext from the current EmitLogicOpts.
 */
function _makeExprCtx(opts: EmitLogicOpts): EmitExprContext {
  return {
    mode: "client",
    derivedNames: opts.derivedNames ?? null,
    tildeVar: opts.tildeContext?.var ?? null,
    dbVar: opts.dbVar,
  };
}

/**
 * Emit a reactive_set, or a transition guard if the variable is machine-bound.
 * @param rawName — the original variable name (for machineBindings lookup)
 * @param encodedName — the encoded name (for reactive_set key)
 */
function _emitReactiveSet(encodedName: string, valueExpr: string, opts: EmitLogicOpts, rawName?: string, isInit?: boolean): string {
  if (!isInit) {
    const lookupName = rawName ?? encodedName;
    const binding = opts.machineBindings?.get(lookupName) ?? null;
    if (binding) {
      return emitTransitionGuard(encodedName, valueExpr, binding.tableName, binding.engineName, binding.rules, (binding as any).auditTarget ?? null).join("\n");
    }
  }
  // §51.12 — on init of a machine-bound var whose machine has temporal
  // rules, arm the initial-state timer after the reactive is set. The
  // runtime helper resolves the current variant against the rule list.
  // Non-temporal inits fall through to a plain reactive_set.
  if (isInit) {
    const lookupName = rawName ?? encodedName;
    const binding = opts.machineBindings?.get(lookupName) ?? null;
    const temporalRules = binding?.rules?.filter((r: any) => r.afterMs != null) ?? [];
    if (temporalRules.length > 0) {
      // S27 (§51.11): include `label` in the payload and pass the
      // machine's audit target so the runtime can push audit entries
      // on timer expiry. Re-arming of chained temporal rules cascades
      // through `_scrml_machine_arm_initial` which consumes this same
      // payload.
      const rulesPayload = JSON.stringify(
        temporalRules.map((r: any) => ({
          from: r.from,
          afterMs: r.afterMs,
          to: r.to,
          label: r.label ?? null,
        }))
      );
      const auditTarget = (binding as any).auditTarget ?? null;
      const auditArg = auditTarget ? `, ${JSON.stringify(auditTarget)}` : "";
      return [
        `_scrml_reactive_set(${JSON.stringify(encodedName)}, ${valueExpr});`,
        `_scrml_machine_arm_initial(${JSON.stringify(encodedName)}, ${JSON.stringify(rulesPayload)}${auditArg});`,
      ].join("\n");
    }
  }
  return `_scrml_reactive_set(${JSON.stringify(encodedName)}, ${valueExpr});`;
}

/**
 * Ensure boundary is set in EmitLogicOpts. When missing, default to "client"
 * but emit a one-time diagnostic warning. This is a semi-fail-closed approach:
 * the compilation succeeds, but the missing boundary is surfaced.
 *
 * Every function should have a resolved boundary from RI (Stage 5). A missing
 * boundary at CG time is either (a) an internal emit path that inherently runs
 * client-side (legitimate — most CG paths are client), or (b) a boundary
 * propagation bug where server code is silently emitted as client code.
 *
 * In development mode (SCRML_STRICT_BOUNDARY=1), this throws instead of
 * warning, so boundary propagation bugs are caught during compiler testing.
 *
 * Changed from silent fail-open to diagnostic-emitting fail-safe as part of
 * boundary-security-fix (NC-4).
 */
const _boundaryWarnedFor = new Set<string>();
const _strictBoundary = typeof process !== "undefined" && process.env?.SCRML_STRICT_BOUNDARY === "1";
function _ensureBoundary(opts: EmitLogicOpts, context: string): EmitLogicOpts {
  if (!opts.boundary) {
    if (_strictBoundary) {
      throw new Error(
        `[emit-logic] BOUNDARY MISSING: ${context} called without opts.boundary. ` +
        `Every function must have a resolved boundary from Route Inference (RI, Stage 5). ` +
        `A missing boundary is a compiler bug — report this to the scrml team. ` +
        `(SCRML_STRICT_BOUNDARY=1 is set — strict mode.)`
      );
    }
    if (!_boundaryWarnedFor.has(context)) {
      _boundaryWarnedFor.add(context);
      if (typeof process !== "undefined" && process.env?.SCRML_DEBUG) {
        console.warn(
          `[emit-logic] ${context}: EmitLogicOpts.boundary missing — defaulting to "client". ` +
          `Set SCRML_STRICT_BOUNDARY=1 to make this an error.`
        );
      }
    }
    return { ...opts, boundary: "client" };
  }
  return opts;
}

export function emitLogicNode(node: any, opts: EmitLogicOpts = { boundary: "client" }): string {
  if (!node || typeof node !== "object") return "";

  opts = _ensureBoundary(opts, "emitLogicNode");

  // §4.12.6: Inherit dbVar from node annotation if not already set in opts
  if (!opts.dbVar && node._dbVar) {
    opts = { ...opts, dbVar: node._dbVar };
  }

  const derivedNames: Set<string> | null = opts.derivedNames ?? null;

  switch (node.kind) {
    case "html-fragment":
      // Phase 4: HTML fragment tokens are not JS — drop them in logic context.
      // In lift context, emit-lift handles them for tag reconstruction.
      return "";
    case "bare-expr": {
      // Phase 3 fast path: when exprNode is present, skip all string heuristics
      if (node.exprNode) {
        if (opts.tildeContext) {
          const tVar = genVar("tilde");
          opts.tildeContext.var = tVar;
          return `let ${tVar} = ${emitExpr(node.exprNode, _makeExprCtx(opts))};`;
        }
        // §51.5 machine-binding interception: if this bare-expr is a
        // reactive `@var = expr` assignment AND the var is machine-bound,
        // route through _emitReactiveSet so the transition guard + audit
        // clause (§51.11) fire. Without this, emitAssign would emit a
        // plain _scrml_reactive_set and the machine contract is silently
        // bypassed inside function bodies.
        if (opts.machineBindings && node.exprNode.kind === "assign") {
          const assignNode = node.exprNode as { kind: "assign"; op: string; target?: { kind?: string; name?: string }; value: unknown };
          const target = assignNode.target;
          if (target && target.kind === "ident" && typeof target.name === "string" && target.name.startsWith("@") && assignNode.op === "=") {
            const bareName = target.name.slice(1);
            if (opts.machineBindings.get(bareName)) {
              const rhsStr = emitExpr(assignNode.value as any, _makeExprCtx(opts));
              return _emitReactiveSet(bareName, rhsStr, opts, bareName) + ";";
            }
          }
        }
        return `${emitExpr(node.exprNode, _makeExprCtx(opts))};`;
      }
      let bareExpr: string = node.expr ?? "";
      if (bareExpr.trim() === "/" || bareExpr.trim() === "") return "";
      // Skip slot spread placeholder — CE replaces ${...} slots with children; if any survive
      // to codegen (e.g. component with no caller, or CE expansion failed), drop them silently.
      if (bareExpr.trim() === "...") return "";
      // Skip leaked HTML tag fragments (e.g. `/ < / button >`, `/ < span`, `< / div >`).
      // These arise when scrml closers and HTML tags leak through to JS output.
      if (/^\/?\s*<\s*\/?\s*[a-zA-Z]/.test(bareExpr.trim())) return "";

      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(bareExpr.trim())) return "";

      bareExpr = stripLeakedComments(bareExpr);

      // §42 Presence guard: `( identifier ) => { body }` → `if (x !== null && x !== undefined) { body }`
      // Detect before rewriteExpr to avoid appending a trailing semicolon to the if-block.
      const presenceGuardMatch = bareExpr.trim().match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
      if (presenceGuardMatch) {
        const varName = presenceGuardMatch[1];
        const body = presenceGuardMatch[2];
        // Rewrite the body contents through the normal pipeline
        const rewrittenBody = emitExprField(null, body.trim(), _makeExprCtx(opts));
        return `if (${varName} !== null && ${varName} !== undefined) {\n  ${rewrittenBody}\n}`;
      }

      const destructMatch = bareExpr.trim().match(/^\{\s*([a-zA-Z_$][\w$]*(?:\s*,\s*[a-zA-Z_$][\w$]*)*)\s*\}\s*=\s*([\s\S]+)$/);
      if (destructMatch) {
        const vars = destructMatch[1];
        const init = destructMatch[2].trim();
        const initSplit = splitBareExprStatements(init);
        if (initSplit.length > 1) {
          const lines: string[] = [`const { ${vars} } = ${emitExprField(null, initSplit[0].trim(), _makeExprCtx(opts))};`];
          for (let i = 1; i < initSplit.length; i++) {
            const s = initSplit[i].trim();
            if (s) lines.push(`${emitExprField(null, s, _makeExprCtx(opts))};`);
          }
          return lines.filter((l: string) => l !== ";").join("\n");
        }
        return `const { ${vars} } = ${emitExprField(null, init, _makeExprCtx(opts))};`;
      }

      const splitStmts = splitBareExprStatements(bareExpr);
      if (splitStmts.length > 1) {
        return splitStmts
          .map((s: string) => s.trim())
          .filter((s: string) => s && !isLeakedComment(s))
          .map((s: string) => `${emitExprField(null, s, _makeExprCtx(opts))};`)
          .filter((s: string) => s !== ";")
          .join("\n");
      }
      const trimmed = bareExpr.trim();
      if (isLeakedComment(trimmed)) return `// ${trimmed}`;
      // §32: If a tilde context is active, this bare-expr initializes the tilde variable.
      // Emit as `let _scrml_tilde_N = <expr>;` so `~` in subsequent nodes can reference it.
      if (opts.tildeContext) {
        const tVar = genVar("tilde");
        opts.tildeContext.var = tVar;
        return `let ${tVar} = ${emitExprField(null, bareExpr, _makeExprCtx(opts))};`;
      }
      return `${emitExprField(null, bareExpr, _makeExprCtx(opts))};`;
    }

    case "let-decl": {
      if (node._compileTimeOnly) return "";
      if (node.name && opts.declaredNames) opts.declaredNames.add(node.name);
      // If-as-expression: `let a = if (cond) { lift val }`
      if (node.ifExpr) {
        return emitIfExprDecl(node.name, node.ifExpr, "let", opts);
      }
      // For-as-expression: `let names = for (item of items) { lift item.name }`
      if (node.forExpr) {
        return emitForExprDecl(node.name, node.forExpr, "let", opts);
      }
      // Match-as-expression: `let result = match expr { .A => { lift val } }`
      if (node.matchExpr) {
        return emitMatchExprDecl(node.name, node.matchExpr, "let", opts);
      }
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        const rhs = emitExpr(node.initExpr, _makeExprCtx(opts));
        if (node.predicateCheck && node.predicateCheck.zone === "boundary") {
          const _pc = node.predicateCheck;
          const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
          const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
          return [
            `const ${_checkTmpVar} = ${rhs};`,
            ..._checkLines,
            `let ${node.name} = ${_checkTmpVar};`,
          ].join("\n");
        }
        return `let ${node.name} = ${rhs};`;
      }
      // Phase 4 simplified fallback: initExpr is missing (rare — e.g. tilde expressions)
      let letInit: string = node.init ?? "";
      if (opts.tildeContext?.var && letInit.includes("~")) {
        letInit = rewriteTildeRef(letInit, opts.tildeContext.var);
        opts.tildeContext.var = null;
      }
      if (!letInit) return `let ${node.name};`;
      if (node.predicateCheck && node.predicateCheck.zone === "boundary") {
        const _pc = node.predicateCheck;
        const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
        const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
        return [`const ${_checkTmpVar} = ${emitExprField(node.initExpr, letInit, _makeExprCtx(opts))};`, ..._checkLines, `let ${node.name} = ${_checkTmpVar};`].join("\n");
      }
      return `let ${node.name} = ${emitExprField(node.initExpr, letInit, _makeExprCtx(opts))};`;
    }

    case "const-decl":
    case "tilde-decl": {
      if (!node.name) return "";
      if (node._compileTimeOnly) return "";
      // For tilde-decl: if name was already declared by let-decl, emit as reassignment
      if (node.kind === "tilde-decl" && opts.declaredNames?.has(node.name)) {
        const init = node.init ?? "";
        const tildeRhs = emitExprField(node.initExpr, init, _makeExprCtx(opts));
        return `${node.name} = ${tildeRhs};`;
      }
      // For tilde-decl with reactive deps: emit as derived reactive (auto-updates)
      // Phase 4d: ExprNode-first reactive dep extraction, string fallback
      if (node.kind === "tilde-decl") {
        const tildeInit: string = node.init ?? "";
        const tildeDeps = node.initExpr
          ? extractReactiveDepsFromExprNode(node.initExpr)
          : extractReactiveDeps(tildeInit);
        if (tildeDeps.size > 0) {
          const rewrittenBody = emitExprField(node.initExpr, tildeInit, { ..._makeExprCtx(opts), derivedNames });
          const ctx = opts.encodingCtx;
          const encodedName = ctx ? ctx.encode(node.name) : node.name;
          const lines: string[] = [];
          lines.push(`_scrml_derived_declare(${JSON.stringify(encodedName)}, () => ${rewrittenBody});`);
          for (const dep of tildeDeps) {
            const encodedDep = ctx ? ctx.encode(dep) : dep;
            lines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedName)}, ${JSON.stringify(encodedDep)});`);
          }
          return lines.join("\n");
        }
      }
      if (node.kind === "const-decl" && node.name && opts.declaredNames) opts.declaredNames.add(node.name);
      // If-as-expression: `const a = if (cond) { lift val }`
      if (node.ifExpr) {
        return emitIfExprDecl(node.name, node.ifExpr, "const", opts);
      }
      // For-as-expression: `const names = for (item of items) { lift item.name }`
      if (node.forExpr) {
        return emitForExprDecl(node.name, node.forExpr, "const", opts);
      }
      // Match-as-expression: `const result = match expr { .A => { lift val } }`
      if (node.matchExpr) {
        return emitMatchExprDecl(node.name, node.matchExpr, "const", opts);
      }
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        return `const ${node.name} = ${emitExpr(node.initExpr, _makeExprCtx(opts))};`;
      }
      // Phase 4 simplified fallback: initExpr is missing (rare — e.g. tilde expressions)
      let constInit: string = node.init ?? "";
      if (opts.tildeContext?.var && constInit.includes("~")) {
        constInit = rewriteTildeRef(constInit, opts.tildeContext.var);
        opts.tildeContext.var = null;
      }
      if (!constInit) return `const ${node.name};`;
      return `const ${node.name} = ${emitExprField(node.initExpr, constInit, _makeExprCtx(opts))};`;
    }

    case "state-decl": {
      // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the
      // initializer was `?{...}.method()` (or bare `?{...}`), the AST
      // builder attached a structured `sqlNode` and set `init: ""` /
      // omitted `initExpr`. On the SERVER boundary we recurse into case
      // "sql" and wrap as a _scrml_reactive_set call. (E-CG-006 forbids
      // emitting _scrml_sql on the client, so the client path falls through
      // to the legacy emitter which emits the long-standing pre-existing
      // sql-ref placeholder — a sibling bug out of scope for this fix.)
      // This branch covers the rare case where a server function has a
      // non-CPS-final `@x = ?{...}` reactive-decl statement (the CPS-final
      // stmt is intercepted by emit-server.ts:600/684 directly without
      // reaching emit-logic).
      // Mirrors emit-logic case "return-stmt" + case "lift-expr" SQL handling.
      if (opts.boundary === "server" && node.sqlNode && node.sqlNode.kind === "sql") {
        const sqlStmt = emitLogicNode(node.sqlNode, opts);
        // case "sql" emits an expression form ending in ";". Strip the trailing
        // ";" so we can wrap as `_scrml_reactive_set(...);`.
        const sqlExpr = sqlStmt.replace(/;\s*$/, "");
        const ctx2 = opts.encodingCtx;
        const encodedName2 = ctx2 ? ctx2.encode(node.name) : node.name;
        // Honor the same isInit logic used by the legacy path so machine-bound
        // reassignments of SQL-init vars route through the transition guard.
        const hasTypeAnnotation2 = !!(node as any).typeAnnotation;
        const hasMachineBinding2 = !!(node as any).machineBinding;
        const isInit2 = hasTypeAnnotation2 || hasMachineBinding2 || !(opts.machineBindings?.has(node.name));
        return _emitReactiveSet(encodedName2, sqlExpr, opts, node.name, isInit2);
      }
      // fix-cg-mounthydrate-sql-ref-placeholder (S40 follow-up): on the CLIENT
      // boundary a SQL-init reactive-decl (`@x = ?{...}` at top level or in a
      // client logic block) cannot be evaluated — `_scrml_sql` is server-only
      // (E-CG-006). Falling through to the legacy emitter below would produce
      // `_scrml_reactive_set("name", )` (empty arg, parses but ugly) because
      // the AST builder sets `init: ""` and omits `initExpr` for the SQL
      // shape, and `?? "undefined"` does NOT fire on the empty string.
      //
      // The "right" fix here is mount-hydration coalescing (§8.11), but §8.11
      // is scoped to `server @var` declarations only (`isServer === true` —
      // see `collect.ts` `collectServerVarDecls`). Implicitly promoting
      // bare `@var = ?{...}` to server-authoritative semantics is a spec
      // amendment with cascading E-AUTH implications — out of scope for this
      // cosmetic fix.
      //
      // Approach (b) from the intake: emit an explanatory comment instead of
      // the broken `_scrml_reactive_set`. Runtime semantics are identical to
      // the pre-fix behavior — `_scrml_reactive_get("name")` returns
      // `undefined` either way. The variable can still be (re)assigned later
      // (e.g. via a `server function` returning the SQL result through CPS).
      if (node.sqlNode && node.sqlNode.kind === "sql") {
        return `// SQL-init for @${node.name} — client cannot evaluate _scrml_sql (E-CG-006); declare as \`server @${node.name}\` for mount-hydration (§8.11).`;
      }
      // Legacy fallthrough for non-SQL reactive-decl initializers.
      const initStr: string = node.init ?? "undefined";
      const ctx = opts.encodingCtx;
      const encodedName = ctx ? ctx.encode(node.name) : node.name;
      // Historically reactive-decl was treated as the initial declaration
      // site and the machine transition guard was skipped. But the AST
      // builder emits reactive-decl for EVERY `@name = expr` it parses,
      // including re-assignments inside function bodies. Discriminate:
      // a genuine declaration site carries a `typeAnnotation` (and sets
      // `machineBinding`), while a bare reassignment has neither. When
      // the var is machine-bound AND this node is not a declaration,
      // treat as a mutation so _emitReactiveSet fires the transition
      // guard and §51.11 audit clause.
      const hasTypeAnnotation = !!(node as any).typeAnnotation;
      const hasMachineBinding = !!(node as any).machineBinding;
      const isInit = hasTypeAnnotation || hasMachineBinding || !(opts.machineBindings?.has(node.name));
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        const rewrittenInit = emitExpr(node.initExpr, _makeExprCtx(opts));
        const wrappedInit = _wrapDeepReactive(rewrittenInit, initStr, node.initExpr);
        if (node.predicateCheck && node.predicateCheck.zone === "boundary" && initStr !== "undefined") {
          const _pc = node.predicateCheck;
          const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
          const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
          return [
            `const ${_checkTmpVar} = ${rewrittenInit};`,
            ..._checkLines,
            _emitReactiveSet(encodedName, _wrapDeepReactive(_checkTmpVar, initStr, node.initExpr), opts, node.name, isInit),
          ].join("\n");
        }
        return _emitReactiveSet(encodedName, wrappedInit, opts, node.name, isInit);
      }
      // Phase 4 simplified fallback: initExpr is missing (rare)
      const rewrittenInit = emitExprField(node.initExpr, initStr, _makeExprCtx(opts));
      const wrappedInit = _wrapDeepReactive(rewrittenInit, initStr);
      if (node.predicateCheck && node.predicateCheck.zone === "boundary" && initStr !== "undefined") {
        const _pc = node.predicateCheck;
        const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
        const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
        return [`const ${_checkTmpVar} = ${rewrittenInit};`, ..._checkLines, _emitReactiveSet(encodedName, _wrapDeepReactive(_checkTmpVar, initStr), opts, node.name, isInit)].join("\n");
      }
      return _emitReactiveSet(encodedName, wrappedInit, opts, node.name, isInit);
    }

    case "reactive-derived-decl": {
      // const @name = expr → derived reactive value (§6.6)
      // Phase 4d: ExprNode-first reactive dep extraction, string fallback
      const derivedInit: string = node.init ?? "";
      const reactiveDepsFound = node.initExpr
        ? extractReactiveDepsFromExprNode(node.initExpr)
        : extractReactiveDeps(derivedInit);
      const hasReactiveDeps = reactiveDepsFound.size > 0;

      if (!hasReactiveDeps) {
        const derivedRhs = emitExprField(node.initExpr, derivedInit, _makeExprCtx(opts));
        return `/* W-DERIVED-001: const @${node.name} has no reactive dependencies — treating as const */ const ${node.name} = ${derivedRhs};`;
      }

      const rewrittenBody = emitExprField(node.initExpr, derivedInit, { ..._makeExprCtx(opts), derivedNames });
      const ctx = opts.encodingCtx;
      const encodedDeclName = ctx ? ctx.encode(node.name) : node.name;

      const lines: string[] = [];
      lines.push(`_scrml_derived_declare(${JSON.stringify(encodedDeclName)}, () => ${rewrittenBody});`);
      for (const dep of reactiveDepsFound) {
        const encodedDep = ctx ? ctx.encode(dep) : dep;
        lines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedDeclName)}, ${JSON.stringify(encodedDep)});`);
      }
      return lines.join("\n");
    }

    case "return-stmt": {
      // fix-cg-sql-ref-placeholder (S40 follow-up): `return ?{...}.method()` —
      // when the AST builder attached a structured `sqlNode` (because `return` was
      // followed directly by a SQL BLOCK_REF), recurse into `case "sql"` and
      // wrap the resulting expression as a return statement. Mirrors the
      // `lift ?{...}.method()` SQL handling in `case "lift-expr"` above.
      if (node.sqlNode && node.sqlNode.kind === "sql") {
        const sqlStmt = emitLogicNode(node.sqlNode, opts);
        // `case "sql"` always returns an expression form ending in `;`.
        // Strip the trailing `;` so we can wrap as `return …;`.
        const sqlExpr = sqlStmt.replace(/;\s*$/, "");
        return `return ${sqlExpr};`;
      }
      // Phase 3 fast path: when exprNode is present, skip all string splitting
      if (node.exprNode) {
        return `return ${emitExpr(node.exprNode, _makeExprCtx(opts))};`;
      }
      // Phase 4 fallback: exprNode is missing (rare — only for unparseable expressions)
      const retExpr: string = (node.expr ?? node.value ?? "").trim();
      return retExpr ? `return ${emitExprField(node.exprNode, retExpr, _makeExprCtx(opts))};` : "return;";
    }

    case "if-stmt":
      // Thread opts when tilde context or continueBehavior is active so nested nodes
      // (e.g. continue-stmt inside if-body inside reactive-for) receive the flags.
      if (opts.tildeContext || opts.continueBehavior) {
        return _emitIfStmtWithOpts(node, opts);
      }
      // Always thread declaredNames + derivedNames so bare `x = expr`
      // inside if/else body sees outer lets (Bug B + F).
      return emitIfStmt(node, { derivedNames: opts.derivedNames, declaredNames: opts.declaredNames });

    case "for-stmt":
      // §32 array accumulator: when tilde context is active, switch to array-mode before
      // emitting the loop body so lift calls push rather than overwrite.
      if (opts.tildeContext) {
        return _emitForStmtWithTilde(node, opts);
      }
      return emitForStmt(node, { dbVar: opts.dbVar, declaredNames: opts.declaredNames });

    case "while-stmt":
      // §32 array accumulator: same pattern as for-stmt above.
      if (opts.tildeContext) {
        return _emitWhileStmtWithTilde(node, opts);
      }
      return emitWhileStmt(node, { declaredNames: opts.declaredNames });

    case "do-while-stmt":
      return emitDoWhileStmt(node);

    case "break-stmt":
      return emitBreakStmt(node);

    case "continue-stmt":
      // In a reactive-for createItem function, `continue` is illegal JS (no surrounding loop).
      // When continueBehavior is "return", emit `return;` to skip the item instead.
      if (opts.continueBehavior === "return") return "return;";
      return emitContinueStmt(node);

    case "lift-expr": {
      const liftE = node.expr;
      // GITI-004 (giti inbound 2026-04-20): in a server-function body,
      // `lift <expr>` means "return this value from the handler" — NOT
      // "create a DOM text node". The default emitLiftExpr lowering uses
      // `_scrml_lift(() => document.createTextNode(...))` which references
      // `document` and a client-only helper; neither exists in a Bun server
      // handler. Swap to `return <expr>;` when the caller signals server
      // boundary.
      // S35 B2: exhaustive boundary handling. The `never` assignment in the
      // default arm forces a compile-time decision whenever the
      // `"server" | "client"` union grows.
      if (opts.boundary !== "server" && opts.boundary !== "client") {
        const _exhaustive: never = opts.boundary;
        void _exhaustive;
      }
      if (opts.boundary === "server" && liftE) {
        if (liftE.kind === "expr" && typeof liftE.expr === "string") {
          const rhsExpr = emitExprField(liftE.exprNode, liftE.expr.trim(), { mode: "server", dbVar: opts.dbVar });
          return `return ${rhsExpr};`;
        }
        // fix-lift-sql-chained-call (S40): `lift ?{...}.method()` inside a
        // server function — the ast-builder now wraps the SQL block as
        // `expr: { kind: "sql", node: <sqlNode> }`. Reuse the existing
        // `case "sql":` emission by recursing on the SQL child node, then
        // promote the resulting expression to a return statement.
        if (liftE.kind === "sql" && liftE.node) {
          const sqlStmt = emitLogicNode(liftE.node, opts);
          // `case "sql"` always returns an expression form ending in `;`
          // (e.g. `await sql\`SELECT ...\`;` or `(await sql\`SELECT ...\`)[0] ?? null;`).
          // Strip the trailing `;` so we can wrap as `return …;`.
          const sqlExpr = sqlStmt.replace(/;\s*$/, "");
          return `return ${sqlExpr};`;
        }
        // Markup in a server handler is not meaningful — emit a typed
        // compile-time comment so inspection shows the failure cause.
        return `return null; /* server-lift: non-expr form */`;
      }
      // fix-lift-sql-chained-call (S40): non-server boundary — `lift ?{...}`
      // outside a server function is unusual but should emit something
      // parseable. Drop the value and emit the SQL as a statement so the
      // query still runs (matches the bare `?{}` semantics).
      if (liftE && liftE.kind === "sql" && liftE.node) {
        return emitLogicNode(liftE.node, opts);
      }
      // §32 Value-lift: `lift <non-markup-expr>` — if tilde context is active AND the
      // expression does not look like a markup pattern (no leading < tag), treat as
      // a tilde variable assignment rather than a DOM lift.
      if (
        opts.tildeContext &&
        liftE &&
        liftE.kind === "expr" &&
        typeof liftE.expr === "string"
      ) {
        const rawExpr = liftE.expr.trim();
        // Only apply value-lift if the expression does NOT start with a `<` (markup)
        // and does NOT end with `/` (closing tag form)
        if (!rawExpr.startsWith("<") && !rawExpr.endsWith("/")) {
          const liftRhs = emitExprField(liftE.exprNode, rawExpr, _makeExprCtx(opts));
          if (opts.tildeContext.mode === "array" && opts.tildeContext.var) {
            // Array accumulator mode — push onto existing array variable.
            return `${opts.tildeContext.var}.push(${liftRhs});`;
          }
          if (opts.tildeContext.var) {
            // Tilde var already pre-declared (if-as-expression) — reassign, don't redeclare.
            return `${opts.tildeContext.var} = ${liftRhs};`;
          }
          const tVar = genVar("tilde");
          opts.tildeContext.var = tVar;
          return `let ${tVar} = ${liftRhs};`;
        }
      }
      return emitLiftExpr(node);
    }

    case "sql": {
      // SPEC §44 — emit Bun.SQL tagged-template form.
      //   ?{`SQL ${x}`}.all()   → await sql`SQL ${x}`;
      //   ?{`SQL ${x}`}.get()   → const _r = (await sql`SQL ${x}`)[0] ?? null;
      //   ?{`SQL ${x}`}.run()   → await sql`SQL ${x}`;
      //   ?{`SQL ${x}`}.prepare() → E-SQL-006 (compile error + runtime throw)
      //   bare ?{`DDL`}         → await sql.unsafe("DDL");
      // For SQL using bare `?` placeholders with explicit call.args (legacy
      // path), we emit `await sql.unsafe(rawSql, [argList])` — Bun.SQL's
      // unsafe() accepts a bound-params array.
      const rawQuery: string = node.query ?? node.body ?? "";
      const calls: any[] = node.chainedCalls ?? [];
      const { sql, params, segments } = extractSqlParams(rawQuery);
      const db = opts.dbVar ?? "_scrml_sql";

      const taggedFromParams = (): string => {
        const renderedParams = params.map(
          (p: string) => emitExprField(null, p, _makeExprCtx(opts)),
        );
        return buildTaggedTemplate(db, segments, renderedParams);
      };

      if (calls.length > 0) {
        const call = calls[0];
        const method: string = call.method;

        // §44.3: .prepare() is removed.
        if (method === "prepare") {
          // Emit a runtime-throwing IIFE so the JS still parses; CG-level
          // E-SQL-006 emission is handled in rewriteSqlRefs (inline path).
          return `(()=>{throw new Error(${JSON.stringify("E-SQL-006: .prepare() is removed in Bun.SQL (§44.3) — use .all()/.get()/.run() or bare ?{}")})})();`;
        }

        // Branch A: SQL has ${} params — use tagged template form.
        if (params.length > 0) {
          const tagged = taggedFromParams();
          if (method === "get" || method === "first") {
            return `(await ${tagged})[0] ?? null;`;
          }
          return `await ${tagged};`;
        }

        // Branch B: SQL uses bare ? placeholders + explicit call.args.
        // Use sql.unsafe(rawSql, [argArray]) — unsafe() accepts a bound array.
        if (call.args && call.args.trim()) {
          const argList = emitExprField(null, call.args.trim(), _makeExprCtx(opts));
          if (method === "get" || method === "first") {
            return `(await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}]))[0] ?? null;`;
          }
          return `await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}]);`;
        }

        // Branch C: no params, no call.args. Bare tagged template.
        const taggedNoParams = `${db}\`${sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
        if (method === "get" || method === "first") {
          return `(await ${taggedNoParams})[0] ?? null;`;
        }
        return `await ${taggedNoParams};`;
      }

      // No chained call.
      if (params.length > 0) {
        // Defaults to .run() semantics — value dropped.
        return `await ${taggedFromParams()};`;
      }
      // Static DDL — route through unsafe() so the runtime accepts no-param SQL.
      return `await ${db}.unsafe(${JSON.stringify(rawQuery)});`;
    }

    case "fail-expr": {
      const enumType: string = node.enumType ?? "";
      const variant: string = node.variant ?? "";
      const rawArgs: string = (node.args ?? "").trim();
      const args = rawArgs.length > 0
        ? emitExprField(node.argsExpr, rawArgs, _makeExprCtx(opts))
        : "undefined";
      return `return { __scrml_error: true, type: ${JSON.stringify(enumType)}, variant: ${JSON.stringify(variant)}, data: ${args} };`;
    }

    case "propagate-expr": {
      const tmpVar = genVar("_scrml_tmp");
      const expr = emitExprField(node.exprNode, node.expr ?? "", _makeExprCtx(opts));
      const lines: string[] = [];
      lines.push(`const ${tmpVar} = ${expr};`);
      lines.push(`if (${tmpVar}.__scrml_error) return ${tmpVar};`);
      if (node.binding) {
        lines.push(`const ${node.binding} = ${tmpVar};`);
      }
      return lines.join("\n");
    }

    case "throw-stmt": {
      const throwExpr = emitExprField(node.exprNode, node.expr ?? "", _makeExprCtx(opts));
      const cleaned = throwExpr.trim();
      const needsNew = /^[A-Z][A-Za-z0-9_]*\s*\(/.test(cleaned) && !cleaned.startsWith("new ");
      return needsNew ? `throw new ${cleaned};` : `throw ${cleaned};`;
    }

    case "given-guard": {
      // §42.2.3 Presence guard: `given x => { body }` or `given x, y => { body }`
      // Emits: if (x !== null && x !== undefined) { body }
      // Multi-variable: if (x !== null && x !== undefined && y !== null && y !== undefined) { body }
      const vars: string[] = node.variables ?? [];
      const body: object[] = node.body ?? [];
      if (vars.length === 0) return "";

      const conditions = vars
        .map((v: string) => `${v} !== null && ${v} !== undefined`)
        .join(" && ");

      const lines: string[] = [`if (${conditions}) {`];
      for (const stmt of body) {
        const code = emitLogicNode(stmt as Parameters<typeof emitLogicNode>[0], opts);
        if (code) {
          for (const line of code.split("\n")) lines.push(`  ${line}`);
        }
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    case "error-effect": {
      // Standalone `!{ tryBody } catch Type [as binding] { handler }` form
      const arms: LogicArm[] = node.arms ?? [];
      const tryBody: object[] = (node as Record<string, unknown>).body as object[] ?? [];
      const errVar = genVar("_scrml_err");
      const lines: string[] = [];

      lines.push(`try {`);
      for (const bodyNode of tryBody) {
        const code = emitLogicNode(bodyNode as Parameters<typeof emitLogicNode>[0]);
        if (code) {
          for (const line of code.split("\n")) lines.push(`  ${line}`);
        }
      }
      lines.push(`} catch (${errVar}) {`);

      if (arms.length > 0) {
        let isFirst = true;
        for (const arm of arms) {
          if (arm.pattern === "_") {
            lines.push(`  ${isFirst ? "" : "else "}{`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar, opts.machineBindings ?? null);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          } else {
            const typeName = arm.pattern ?? "";
            const cond = `${errVar} instanceof ${typeName} || (${errVar} && ${errVar}.type === ${JSON.stringify(typeName)})`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar, opts.machineBindings ?? null);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          }
          isFirst = false;
        }
      } else {
        lines.push(`  throw ${errVar};`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    case "guarded-expr": {
      // §19.4.3 `!{}` inline catch. `fail` produces a tagged object (not a throw),
      // so we test the guarded expression's result for __scrml_error rather than
      // using try/catch.
      const guardedNode = node.guardedNode;
      const arms: LogicArm[] = node.arms ?? [];
      const lines: string[] = [];
      const resultVar = genVar("_scrml_result");

      let bindingName: string | null = null;
      let initExpr: string | null = null;
      if (guardedNode) {
        if (guardedNode.kind === "let-decl" && guardedNode.name) {
          bindingName = guardedNode.name;
          initExpr = emitExprField(guardedNode.initExpr, guardedNode.init ?? "undefined", _makeExprCtx(opts));
        } else if ((guardedNode.kind === "const-decl" || guardedNode.kind === "tilde-decl") && guardedNode.name) {
          bindingName = guardedNode.name;
          initExpr = emitExprField(guardedNode.initExpr, guardedNode.init ?? "undefined", _makeExprCtx(opts));
        } else {
          const bodyCode = emitLogicNode(guardedNode);
          if (bodyCode) {
            initExpr = bodyCode.replace(/;\s*$/, "").replace(/^\s*return\s+/, "");
          }
        }
      }

      if (initExpr == null) return "";

      lines.push(`let ${resultVar} = ${initExpr};`);
      lines.push(`if (${resultVar} && ${resultVar}.__scrml_error) {`);

      const emitArmAssign = (armBody: string): string[] => {
        const trimmed = armBody.trim();
        if (!trimmed) return [`    ${resultVar} = undefined;`];
        if (trimmed.includes("\n")) {
          // Multi-statement handler: emit body as-is (authors should assign to
          // resultVar themselves for non-trivial bodies).
          return trimmed.split("\n").map((l) => `    ${l}`);
        }
        const bare = trimmed.replace(/;\s*$/, "");
        return [`    ${resultVar} = ${bare};`];
      };

      if (arms.length > 0) {
        const hasWildcard = arms.some((a: LogicArm) => a.pattern === "_");
        let isFirst = true;
        for (const arm of arms) {
          const armCode = emitArmBody(arm, resultVar, opts.machineBindings ?? null);
          if (arm.pattern === "_") {
            lines.push(`  ${isFirst ? "" : "else "}{`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${resultVar}.data;`);
            }
            for (const l of emitArmAssign(armCode)) lines.push(l);
            lines.push(`  }`);
          } else {
            const variantName = (arm.pattern ?? "").replace(/^::/, "").replace(/^\./, "");
            const cond = `${resultVar}.variant === ${JSON.stringify(variantName)}`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${resultVar}.data;`);
            }
            for (const l of emitArmAssign(armCode)) lines.push(l);
            lines.push(`  }`);
          }
          isFirst = false;
        }
        if (!hasWildcard) {
          // No wildcard — propagate the unhandled error variant up.
          lines.push(`  else { return ${resultVar}; }`);
        }
      } else {
        lines.push(`  return ${resultVar};`);
      }

      lines.push(`}`);
      if (bindingName) {
        lines.push(`var ${bindingName} = ${resultVar};`);
      }
      return lines.join("\n");
    }

    case "cleanup-registration": {
      const callback: string = node.callback ?? "() => {}";
      const cleanupRhs = emitExprField(node.callbackExpr, callback, _makeExprCtx(opts));
      return `_scrml_register_cleanup(${cleanupRhs});`;
    }

    case "when-effect": {
      // Filter out leaked comment lines (// stripped by tokenizer, leaving bare text)
      const rawLines = (node.bodyRaw ?? "").split("\n");
      const codeLines = rawLines.filter((line: string) => {
        const t = line.trim();
        if (!t) return false;
        if (/^(?:let|const|var|if|for|while|return|@|function|switch|try|catch|throw)\b/.test(t)) return true;
        if (/^[a-zA-Z_$@][a-zA-Z0-9_$]*\s*[=\(\[.]/.test(t)) return true;
        if (/^[{}\[\]();]/.test(t)) return true;
        return false;
      });
      const body = emitExprField(node.bodyExpr, codeLines.join("\n"), _makeExprCtx(opts));
      return `_scrml_effect(function() { ${body}; });`;
    }

    case "when-worker-message": {
      // §4.12.4: `when message from <#name> (binding) { body }` — parent-side worker message listener
      const workerVar = `_scrml_worker_${node.workerName}`;
      const binding = node.binding ?? "data";
      const body = emitExprField(node.bodyExpr, node.bodyRaw ?? "", _makeExprCtx(opts));
      return `${workerVar}.onmessage = function(event) { const ${binding} = event.data; ${body}; };`;
    }

    case "when-worker-error": {
      // §4.12.4: `when error from <#name> (binding) { body }` — parent-side worker error listener
      const workerVar = `_scrml_worker_${node.workerName}`;
      const binding = node.binding ?? "e";
      const body = emitExprField(node.bodyExpr, node.bodyRaw ?? "", _makeExprCtx(opts));
      return `${workerVar}.onerror = function(${binding}) { ${body}; };`;
    }

    case "upload-call": {
      const file = emitExprField(node.fileExpr, node.file ?? "null", _makeExprCtx(opts));
      const url = emitExprField(node.urlExpr, node.url ?? '""', _makeExprCtx(opts));
      return `_scrml_upload(${file}, ${url});`;
    }

    case "reactive-nested-assign": {
      const ctx = opts.encodingCtx;
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const path = JSON.stringify(node.path ?? []);
      const value = emitExprField(node.valueExpr, node.value ?? "undefined", _makeExprCtx(opts));
      return `_scrml_reactive_set(${target}, _scrml_deep_set(_scrml_reactive_get(${target}), ${path}, ${value}));`;
    }

    case "reactive-array-mutation": {
      const ctx = opts.encodingCtx;
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const method: string = node.method;
      const args = emitExprField(node.argsExpr, node.args ?? "", _makeExprCtx(opts));

      // With Proxy-based reactivity, array mutations go through the Proxy traps
      // which automatically notify fine-grained effects. We still call
      // _scrml_reactive_set afterwards to fire coarse-grained subscribers.
      switch (method) {
        case "push":
          return `{ _scrml_reactive_get(${target}).push(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "unshift":
          return `{ _scrml_reactive_get(${target}).unshift(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "pop":
          return `{ _scrml_reactive_get(${target}).pop(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "shift":
          return `{ _scrml_reactive_get(${target}).shift(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "splice":
          return `{ _scrml_reactive_get(${target}).splice(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "sort":
          return `{ _scrml_reactive_get(${target}).sort(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "reverse":
          return `{ _scrml_reactive_get(${target}).reverse(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "fill":
          return `{ _scrml_reactive_get(${target}).fill(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        default:
          return `_scrml_reactive_set(${target}, _scrml_reactive_get(${target}));`;
      }
    }

    case "reactive-explicit-set": {
      const args = emitExprField(node.argsExpr, node.args ?? "", _makeExprCtx(opts));
      return `_scrml_reactive_explicit_set(${args});`;
    }

    case "reactive-debounced-decl": {
      const delay: number = node.delay ?? 300;
      const init: string = node.init ?? "undefined";
      const ctx = opts.encodingCtx;
      const encodedName = ctx ? ctx.encode(node.name) : node.name;
      const rewrittenDebouncedInit = emitExprField(node.initExpr, init, _makeExprCtx(opts));
      return `_scrml_reactive_debounced(${JSON.stringify(encodedName)}, () => ${rewrittenDebouncedInit}, ${delay});`;
    }

    case "debounce-call": {
      const fn = emitExprField(node.fnExpr, node.fn ?? "() => {}", _makeExprCtx(opts));
      const delay: number = node.delay ?? 300;
      return `_scrml_debounce(${fn}, ${delay});`;
    }

    case "throttle-call": {
      const fn = emitExprField(node.fnExpr, node.fn ?? "() => {}", _makeExprCtx(opts));
      const delay: number = node.delay ?? 100;
      return `_scrml_throttle(${fn}, ${delay});`;
    }

    case "transaction-block": {
      // SPEC §44.6 — transactions are deferred to SPEC-ISSUE-018. The current
      // workaround is to use Bun.SQL `sql.unsafe()` for BEGIN/COMMIT/ROLLBACK
      // on the same connection. Proper `sql.begin(callback)` integration
      // requires a callback-shaped emitter restructure and is out of scope
      // for Phase 1.
      const lines: string[] = [];
      const db = opts.dbVar ?? "_scrml_sql";
      lines.push(`await ${db}.unsafe("BEGIN");`);
      lines.push(`try {`);
      for (const stmt of (node.body ?? [])) {
        const code = emitLogicNode(stmt, opts);
        if (code) {
          for (const line of code.split("\n")) {
            lines.push(`  ${line}`);
          }
          if (stmt.kind === "fail-expr") {
            const lastIdx = lines.length - 1;
            const lastLine = lines[lastIdx];
            if (lastLine.trimStart().startsWith("return {")) {
              lines[lastIdx] = `  await ${db}.unsafe("ROLLBACK");`;
              lines.push(`  ${lastLine.trim()}`);
            }
          }
        }
      }
      lines.push(`  await ${db}.unsafe("COMMIT");`);
      lines.push(`} catch (_scrml_txn_err) {`);
      lines.push(`  await ${db}.unsafe("ROLLBACK");`);
      lines.push(`  throw _scrml_txn_err;`);
      lines.push(`}`);
      return lines.join("\n");
    }

    case "try-stmt":
      return emitTryStmt(node);

    case "match-stmt":
    case "match-expr":
      return emitMatchExpr(node);

    case "switch-stmt":
      return emitSwitchStmt(node);

    case "meta": {
      const metaBody: any[] | undefined = node.body;
      if (!Array.isArray(metaBody) || metaBody.length === 0) return "";

      const metaScopeId = node.id != null
        ? `"_scrml_meta_${node.id}"`
        : JSON.stringify(genVar("meta_scope"));

      const bodyLines: string[] = [];
      for (const stmt of metaBody) {
        const code = emitLogicNode(stmt);
        if (code) {
          // Rewrite reflect() → meta.types.reflect() in runtime meta bodies.
          // PascalCase type names are quoted; variables are left as-is.
          const rewritten = rewriteReflectForRuntime(code);
          for (const line of rewritten.split("\n")) {
            bodyLines.push(`  ${line}`);
          }
        }
      }

      if (bodyLines.length === 0) return "";

      // §22.5: emit 4-argument form with capturedBindings and typeRegistry
      const capturedBindings = emitCapturedBindings(node);
      const typeRegistryLiteral = emitTypeRegistryLiteral(node);

      return [
        `_scrml_meta_effect(${metaScopeId}, function(meta) {`,
        ...bodyLines,
        `}, ${capturedBindings}, ${typeRegistryLiteral});`
      ].join("\n");
    }

    case "function-decl": {
      const fnName: string = node.name ?? "anon";
      const params: any[] = node.params ?? [];
      // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario")
      const paramNames: string[] = params.map((p: any, i: number) =>
        typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? `_scrml_arg_${i}`)
      );
      const generatorStar: string = node.isGenerator ? "*" : "";

      const fnLines: string[] = [];
      fnLines.push(`function${generatorStar} ${fnName}(${paramNames.join(", ")}) {`);

      // Function body has its own scope for declared names
      const fnOpts: EmitLogicOpts = { ...opts, declaredNames: new Set<string>() };
      const body: any[] = node.body ?? [];

      const bodyCodes = emitFnShortcutBody(body, fnOpts, node.fnKind, node.hasReturnType);
      for (const code of bodyCodes) {
        for (const line of code.split("\n")) {
          fnLines.push(`  ${line}`);
        }
      }

      fnLines.push(`}`);
      return fnLines.join("\n");
    }

    case "lin-decl": {
      // §35.2: lin bindings are immutable — emit as `const`.
      if (!node.name) return "";
      const linInit: string = node.init ?? "";
      if (!linInit.trim()) return `const ${node.name};`;
      const linRhs = emitExprField(node.initExpr, linInit, _makeExprCtx(opts));
      return `const ${node.name} = ${linRhs};`;
    }

    default:
      return "";
  }
}

/**
 * §48 implicit-return: emit a `fn` shorthand body with tail-expression return semantics.
 *
 * When `fnKind === "fn"`, the body's last non-compile-time-only statement — if it is
 * an expression-shape (bare-expr, match-stmt, match-expr, switch-stmt) — is wrapped
 * as `return ...;`. This aligns with example 14 (`fn riskBanner(risk) -> string { match risk {...} }`)
 * and Rust/OCaml/Scala/Kotlin tail-expression conventions.
 *
 * `fnKind !== "fn"` (plain `function` keyword) is unchanged UNLESS `hasReturnType` is set,
 * in which case the same tail-expression return semantics apply (Bug H fix).
 *
 * Returns emitted JS code strings (each entry may be multi-line; caller indents).
 */
export function emitFnShortcutBody(body: any[], opts: EmitLogicOpts, fnKind: string | undefined, hasReturnType?: boolean): string[] {
  const TAIL_KINDS = new Set(["bare-expr", "match-stmt", "match-expr", "switch-stmt"]);
  let tailIdx = -1;
  // Bug H fix: apply implicit tail-expression return for both `fn` shorthand and
  // `function` declarations with return-type annotations (`-> T` or `: T`).
  // When a function declares its return type, the tail match/switch/bare-expr is
  // wrapped in `return ...;` so the IIFE result is actually returned.
  if (fnKind === "fn" || hasReturnType) {
    for (let i = body.length - 1; i >= 0; i--) {
      const s = body[i];
      if (!s || s._compileTimeOnly) continue;
      if (TAIL_KINDS.has(s.kind)) tailIdx = i;
      break;
    }
  }
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const stmt = body[i];
    if (!stmt) continue;
    let code: string;
    if (i === tailIdx) {
      if (stmt.kind === "bare-expr") {
        const exprCtx = _makeExprCtx(opts);
        const exprCode = stmt.exprNode
          ? emitExpr(stmt.exprNode, exprCtx)
          : emitExprField(null, stmt.expr ?? "", exprCtx);
        code = exprCode ? `return ${exprCode};` : "";
      } else {
        // match/switch emit as IIFE expression strings — wrap in `return ...;`.
        const rawCode = emitLogicNode(stmt, opts);
        if (rawCode) {
          const stripped = rawCode.replace(/;\s*$/, "");
          code = `return ${stripped};`;
        } else {
          code = "";
        }
      }
    } else {
      code = emitLogicNode(stmt, opts);
    }
    if (code) out.push(code);
  }
  return out;
}

/**
 * Emit an if-stmt, threading EmitLogicOpts through to child nodes.
 * Used when tilde context is active (e.g., inside a for/while loop accumulator)
 * so that nested lift-expr nodes can use the correct .push() form.
 */
function _emitIfStmtWithOpts(node: any, opts: EmitLogicOpts): string {
  const lines: string[] = [];
  const ifCond = emitExprField(node.condExpr, node.condition ?? node.test ?? "true", _makeExprCtx(opts));
  lines.push(`if (${ifCond}) {`);
  for (const child of (node.consequent ?? node.body ?? [])) {
    const code = emitLogicNode(child, opts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push("}");
  if (node.alternate) {
    const alternate = Array.isArray(node.alternate) ? node.alternate : [node.alternate];
    lines.push("else {");
    for (const child of alternate) {
      const code = emitLogicNode(child, opts);
      if (code) {
        for (const line of code.split("\n")) lines.push(`  ${line}`);
      }
    }
    lines.push("}");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// §32 loop-aware tilde helpers — for-stmt and while-stmt with array accumulation
// ---------------------------------------------------------------------------

/**
 * Emit a for-stmt when the tilde accumulator is active.
 *
 * For non-reactive, non-C-style for-of loops: initializes the tilde variable as an
 * array before the loop, then emits the loop body with mode="array" so each lift
 * call inside the body appends with .push() instead of overwriting.
 *
 * Falls back to emitForStmt (no tilde modification) for:
 *   - Reactive iterables (@varName) — those use DOM reconciliation, not ~
 *   - C-style for (init; cond; update) loops
 */
function _emitForStmtWithTilde(node: any, opts: EmitLogicOpts): string {
  let iterable: string = node.iterable ?? node.collection ?? "[]";
  let varName: string = node.variable ?? node.name ?? "item";

  if (typeof iterable === "string") {
    // C-style for loop: fall back to plain emitForStmt (tilde not applicable)
    const cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
    if (cStyleMatch) return emitForStmt(node);

    // Reactive @varName iterable: fall back (reactive loops use DOM reconciliation)
    const reactiveMatch = iterable.trim().match(/^@([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (reactiveMatch) return emitForStmt(node);

    // For-of: parse out varName and iterable from "( [let|const|var] VAR of EXPR )"
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === "item" && forOfMatch[1] !== "item") varName = forOfMatch[1];
      iterable = forOfMatch[2].trim();
    }
  }

  const lines: string[] = [];
  const tildeCtx = opts.tildeContext!;

  // Initialize tilde var as array if not yet initialized
  if (!tildeCtx.var) {
    const tVar = genVar("tilde");
    tildeCtx.var = tVar;
    tildeCtx.mode = "array";
    lines.push(`let ${tVar} = [];`);
  } else if (tildeCtx.mode !== "array") {
    // Entering a loop when mode was "single" — switch to array (rare edge case)
    tildeCtx.mode = "array";
  }

  const rewrittenIterable = emitExprField(node.iterExpr, iterable, _makeExprCtx(opts));
  lines.push(`for (const ${varName} of ${rewrittenIterable}) {`);

  const body: any[] = node.body ?? [];
  for (const child of body) {
    const code = emitLogicNode(child, opts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Emit a while-stmt when the tilde accumulator is active.
 *
 * Initializes the tilde variable as an array before the loop, then emits the loop
 * body with mode="array" so each lift call appends with .push().
 */
function _emitWhileStmtWithTilde(node: any, opts: EmitLogicOpts): string {
  const lines: string[] = [];
  const tildeCtx = opts.tildeContext!;

  // Initialize tilde var as array if not yet initialized
  if (!tildeCtx.var) {
    const tVar = genVar("tilde");
    tildeCtx.var = tVar;
    tildeCtx.mode = "array";
    lines.push(`let ${tVar} = [];`);
  } else if (tildeCtx.mode !== "array") {
    tildeCtx.mode = "array";
  }

  const condition = emitExprField(node.condExpr, node.condition ?? "true", _makeExprCtx(opts));
  lines.push(`while (${condition}) {`);

  const body: any[] = node.body ?? [];
  for (const child of body) {
    const code = emitLogicNode(child, opts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitIfExprDecl — if-as-expression: `const a = if (cond) { lift val }`
// ---------------------------------------------------------------------------

/**
 * Count direct (top-level) lift-expr nodes in an arm body.
 * Used for E-LIFT-002 detection: multiple lift statements on the same
 * linear execution path in a value-lift arm are a compile error (§10).
 */
function countTopLevelLifts(body: any[]): number {
  return body.filter((n: any) => n?.kind === "lift-expr").length;
}

/**
 * Emit the alternate (else/else-if) chain of an if-as-expression inline,
 * handling else-if chains without extra braces per §17.6.8.
 */
function emitIfExprAltChain(alternate: any[], bodyOpts: EmitLogicOpts, lines: string[]): void {
  if (alternate.length === 1 && alternate[0]?.kind === "if-stmt") {
    // else if — emit without extra braces (§17.6.8)
    const nestedIf = alternate[0];
    const nestedCond = emitExprField(nestedIf.condExpr, (nestedIf.condition ?? "true").trim(), _makeExprCtx({}));
    const nestedConsequent: any[] = nestedIf.consequent ?? [];
    // E-LIFT-002: multiple lifts on same path in a value-lift arm
    if (countTopLevelLifts(nestedConsequent) > 1) {
      lines.push(`/* E-LIFT-002: multiple lift statements on same execution path in value-lift arm */`);
    }
    lines.push(`else if (${nestedCond}) {`);
    for (const stmt of nestedConsequent) {
      const code = emitLogicNode(stmt, bodyOpts);
      if (code) {
        for (const line of code.split("\n")) lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
    // Continue chaining for further else-if / else
    if (nestedIf.alternate) {
      const nextAlternate: any[] = Array.isArray(nestedIf.alternate) ? nestedIf.alternate : [nestedIf.alternate];
      emitIfExprAltChain(nextAlternate, bodyOpts, lines);
    }
  } else {
    // plain else
    // E-LIFT-002: multiple lifts in else arm
    if (countTopLevelLifts(alternate) > 1) {
      lines.push(`/* E-LIFT-002: multiple lift statements on same execution path in value-lift arm */`);
    }
    lines.push(`else {`);
    for (const stmt of alternate) {
      const code = emitLogicNode(stmt, bodyOpts);
      if (code) {
        for (const line of code.split("\n")) lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
  }
}

/**
 * Emit an if-as-expression declaration. Pre-declares a tilde variable,
 * emits the if/else body with lift assigning to that variable, then
 * assigns the result to the declared name.
 *
 * §17.6.4: When no arm executes, result is `not` (compiled to null in JS per §42).
 * §17.6.8: Uses variable-assign-in-branches pattern with else-if chain support.
 */
function emitIfExprDecl(name: string, ifExpr: any, keyword: "let" | "const", opts: EmitLogicOpts): string {
  const tildeVar = genVar("tilde");
  const lines: string[] = [];
  // §17.6.4: default is `not` (compiled to null in JS — §42: `not` => null)
  lines.push(`let ${tildeVar} = null;`);

  // Create a tilde context so lift-expr inside the if body assigns to tildeVar
  const tildeCtx = { var: tildeVar, mode: "single" as "single" | "array" };
  const bodyOpts: EmitLogicOpts = { ...opts, tildeContext: tildeCtx };

  // Emit the if condition
  const condition = emitExprField(ifExpr.condExpr, (ifExpr.condition ?? "true").trim(), _makeExprCtx(opts));

  // E-LIFT-002: multiple lifts on same linear path in a value-lift arm
  const consequent: any[] = ifExpr.consequent ?? [];
  if (countTopLevelLifts(consequent) > 1) {
    lines.push(`/* E-LIFT-002: multiple lift statements on same execution path in value-lift arm */`);
  }
  lines.push(`if (${condition}) {`);

  for (const stmt of consequent) {
    const code = emitLogicNode(stmt, bodyOpts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push(`}`);

  // Emit alternate body if present (§17.6.8 — else-if chain optimization)
  if (ifExpr.alternate) {
    const alternate: any[] = Array.isArray(ifExpr.alternate) ? ifExpr.alternate : [ifExpr.alternate];
    emitIfExprAltChain(alternate, bodyOpts, lines);
  }

  lines.push(`${keyword} ${name} = ${tildeVar};`);

  // Propagate tilde var to parent context so `~` after this decl resolves correctly
  if (opts.tildeContext) {
    opts.tildeContext.var = tildeVar;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitForExprDecl — for-as-expression: `const names = for (item of items) { lift item.name }`
// ---------------------------------------------------------------------------

/**
 * Emit a for-as-expression declaration. Pre-declares a tilde variable as an array,
 * emits the for loop body with lift pushing to that array, then assigns the array
 * to the declared name.
 */
function emitForExprDecl(name: string, forExpr: any, keyword: "let" | "const", opts: EmitLogicOpts): string {
  const tildeVar = genVar("tilde");
  const lines: string[] = [];
  lines.push(`let ${tildeVar} = [];`);

  // Create an array-mode tilde context so lift-expr inside the for body uses .push()
  const tildeCtx = { var: tildeVar, mode: "array" as "single" | "array" };
  const bodyOpts: EmitLogicOpts = { ...opts, tildeContext: tildeCtx };

  // Parse iterable and variable from the forExpr node
  let iterable: string = forExpr.iterable ?? forExpr.collection ?? "[]";
  let varName: string = forExpr.variable ?? forExpr.name ?? "item";

  // Handle for-of form stored as "( let x of iterable )" — extract parts
  if (typeof iterable === "string") {
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === "item" && forOfMatch[1] !== "item") varName = forOfMatch[1];
      iterable = forOfMatch[2].trim();
    }
  }

  const rewrittenIterable = emitExprField(forExpr.iterExpr, iterable, _makeExprCtx(opts));
  lines.push(`for (const ${varName} of ${rewrittenIterable}) {`);

  const body: any[] = forExpr.body ?? [];
  for (const stmt of body) {
    const code = emitLogicNode(stmt, bodyOpts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push("}");

  lines.push(`${keyword} ${name} = ${tildeVar};`);

  // Propagate tilde var to parent context so `~` after this decl resolves correctly
  if (opts.tildeContext) {
    opts.tildeContext.var = tildeVar;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitMatchExprDecl — match-as-expression: `const result = match expr { arms }`
// ---------------------------------------------------------------------------

/**
 * Emit a match-as-expression declaration. Pre-declares a tilde variable,
 * emits the match arms as if/else-if blocks with lift assigning to that
 * variable, then assigns the result to the declared name.
 *
 * §18.3: match is an expression — may appear on the RHS of let/const.
 */
function emitMatchExprDecl(name: string, matchExpr: any, keyword: "let" | "const", opts: EmitLogicOpts): string {
  const tildeVar = genVar("tilde");
  const tmpVar = genVar("match");
  const lines: string[] = [];
  lines.push(`let ${tildeVar} = null;`);

  // Emit the match header into a temporary variable
  const header = emitExprField(matchExpr.headerExpr, (matchExpr.header ?? "").trim(), _makeExprCtx(opts));
  lines.push(`const ${tmpVar} = ${header};`);

  // Create a tilde context so lift-expr inside match arms assigns to tildeVar
  const tildeCtx = { var: tildeVar, mode: "single" as "single" | "array" };
  const bodyOpts: EmitLogicOpts = { ...opts, tildeContext: tildeCtx };

  // Collect all arms — same two-path logic as emitMatchExpr in emit-control-flow.ts
  const arms: MatchArm[] = [];
  const body: any[] = matchExpr.body ?? [];
  for (const child of body) {
    if (!child) continue;
    // Structured match-arm-block nodes (from `. Variant => { ... }` arms)
    if (child.kind === "match-arm-block") {
      arms.push({
        kind: child.isWildcard ? "wildcard" : child.isNotArm ? "not" : "variant",
        test: child.variant ?? null,
        binding: null,
        result: "",
        structuredBody: Array.isArray(child.body) ? child.body : null,
      });
      continue;
    }
    // Structured match-arm-inline nodes (from `. Variant => result` arms)
    if (child.kind === "match-arm-inline") {
      const arm = matchArmInlineToMatchArm(child);
      if (arm) arms.push(arm);
      continue;
    }
    // Raw expression arms — parse via shared arm splitter/parser
    // Prefer string `expr`: match arm text (e.g. `.Variant :> result`) is inherently
    // a multi-part pattern the expression parser can only partially represent.
    // exprNode captures only the first parseable chunk, losing the arrow + result.
    let armExpr: string = child.expr ?? child.header ?? "";
    if (!armExpr && child.exprNode) {
      try { armExpr = emitStringFromTree(child.exprNode); } catch { armExpr = ""; }
    }
    if (typeof armExpr !== "string") continue;
    const trimmed = armExpr.trim();
    if (!trimmed) continue;
    const armStrings = splitMultiArmString(trimmed);
    for (const armStr of armStrings) {
      const arm = parseMatchArm(armStr);
      if (arm) arms.push(arm);
    }
  }

  // S22 §1a slice 2: normalize tagged-object variants the same way as emitMatchExpr.
  const needsTagNormalization = hasPayloadBindingOrTaggedVariant(arms);
  const tagVar = needsTagNormalization ? genVar("tag") : tmpVar;
  if (needsTagNormalization) {
    lines.push(
      `const ${tagVar} = (${tmpVar} != null && typeof ${tmpVar} === "object") ? ${tmpVar}.variant : ${tmpVar};`,
    );
  }

  // Emit arms as if/else-if chain with tilde assignment
  let conditionIndex = 0;
  for (const arm of arms) {
    const bindingPrelude = arm.kind === "variant" ? emitVariantBindingPrelude(arm, tmpVar) : "";
    // Structured body: emit each statement via emitLogicNode (handles lift via tildeContext)
    if (arm.structuredBody) {
      const bodyCode: string[] = [];
      for (const stmt of arm.structuredBody) {
        const code = emitLogicNode(stmt, bodyOpts);
        if (code) {
          for (const line of code.split("\n")) bodyCode.push(`  ${line}`);
        }
      }
      if (arm.kind === "wildcard") {
        lines.push(`else {`);
      } else if (arm.kind === "not") {
        const prefix = conditionIndex === 0 ? "if" : "else if";
        lines.push(`${prefix} (${tmpVar} === null || ${tmpVar} === undefined) {`);
        conditionIndex++;
      } else {
        const prefix = conditionIndex === 0 ? "if" : "else if";
        // arm.test for variant arms is a bare name; for string arms it already
        // includes the surrounding quotes. Compare against the appropriate var.
        const cmp = arm.kind === "variant"
          ? `${tagVar} === "${arm.test}"`
          : `${tmpVar} === ${arm.test}`;
        lines.push(`${prefix} (${cmp}) {`);
        conditionIndex++;
      }
      if (bindingPrelude) lines.push(`  ${bindingPrelude.trimEnd()}`);
      for (const line of bodyCode) lines.push(line);
      lines.push(`}`);
      continue;
    }

    // Raw result: assign rewritten expression to tilde var
    if (arm.kind === "wildcard") {
      lines.push(`else {`);
      if (arm.binding) lines.push(`  const ${arm.binding} = ${tmpVar};`);
      lines.push(`  ${tildeVar} = ${emitExprField(null, arm.result, _makeExprCtx(opts))};`);
      lines.push(`}`);
    } else if (arm.kind === "not") {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      lines.push(`${prefix} (${tmpVar} === null || ${tmpVar} === undefined) {`);
      lines.push(`  ${tildeVar} = ${emitExprField(null, arm.result, _makeExprCtx(opts))};`);
      lines.push(`}`);
      conditionIndex++;
    } else {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      const cmp = arm.kind === "variant"
        ? `${tagVar} === "${arm.test}"`
        : `${tmpVar} === ${arm.test}`;
      lines.push(`${prefix} (${cmp}) {`);
      if (bindingPrelude) lines.push(`  ${bindingPrelude.trimEnd()}`);
      lines.push(`  ${tildeVar} = ${emitExprField(null, arm.result, _makeExprCtx(opts))};`);
      lines.push(`}`);
      conditionIndex++;
    }
  }

  lines.push(`${keyword} ${name} = ${tildeVar};`);

  // Propagate tilde var to parent context so `~` after this decl resolves correctly
  if (opts.tildeContext) {
    opts.tildeContext.var = tildeVar;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitLogicBody — sequence emission with §32 tilde tracking
// ---------------------------------------------------------------------------

/**
 * Emit a sequence of logic nodes with tilde pipeline accumulator tracking (§32).
 *
 * Pre-scans the node list to detect whether `~` is referenced anywhere in the
 * sequence. If so, enables tilde context and passes it through each emitLogicNode
 * call so that:
 *   - `bare-expr` nodes emit `let _scrml_tilde_N = <expr>;`
 *   - value-lift nodes (`lift <non-markup-expr>`) emit `let _scrml_tilde_N = <expr>;`
 *   - `const-decl` / `tilde-decl` nodes with `~` in their init substitute the tilde var
 *
 * When `~` is not referenced in the sequence, falls back to plain emitLogicNode calls
 * (preserving existing behavior and avoiding unnecessary tilde variable declarations).
 *
 * @param nodes - array of AST nodes in a logic body
 * @param opts  - emit options (derivedNames, encodingCtx, dbVar)
 * @returns array of emitted code strings (one per non-empty node)
 */
export function emitLogicBody(nodes: any[], opts: EmitLogicOpts = {}): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  // Track declared names so tilde-decl can distinguish first declaration from reassignment.
  const declaredNames = opts.declaredNames ?? new Set<string>();

  // Pre-scan: does `~` appear in any expression in this sequence?
  const tildeUsed = nodeListContainsTildeRef(nodes);

  if (!tildeUsed) {
    // No tilde references — use plain emission (no overhead, no behavior change)
    return nodes
      .map((n: any) => emitLogicNode(n, { ...opts, declaredNames }))
      .filter((s: string) => s.trim() !== "");
  }

  // Tilde context: a shared mutable object threaded through each emitLogicNode call.
  // `var` holds the current tilde variable name (null = no active tilde).
  const tildeCtx: { var: string | null; mode?: "single" | "array" } = { var: null };
  const optsWithTilde: EmitLogicOpts = { ...opts, tildeContext: tildeCtx, declaredNames };

  return nodes
    .map((n: any) => emitLogicNode(n, optsWithTilde))
    .filter((s: string) => s.trim() !== "");
}

/**
 * Return true if any node (or descendant) in the list contains a `~` reference.
 * Used by emitLogicBody to decide whether tilde tracking is needed.
 */
function nodeListContainsTildeRef(nodes: any[]): boolean {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (nodeContainsTildeRef(node)) return true;
  }
  return false;
}

function nodeContainsTildeRef(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  // Check string fields that hold expressions
  for (const field of ["expr", "init", "value"]) {
    const val = node[field];
    if (typeof val === "string" && hasTildeToken(val)) return true;
    // lift-expr has expr.expr for the inner expression string
    if (field === "expr" && val && typeof val === "object" && typeof val.expr === "string") {
      if (hasTildeToken(val.expr)) return true;
    }
  }
  // Recurse into body arrays
  if (Array.isArray(node.body) && nodeListContainsTildeRef(node.body)) return true;
  if (Array.isArray(node.children) && nodeListContainsTildeRef(node.children)) return true;
  return false;
}

/**
 * Return true if the string contains a standalone `~` (not preceded/followed by word chars).
 */
function hasTildeToken(s: string): boolean {
  return /(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/.test(s);
}
