import { genVar } from "./var-counter.ts";
import { routePath } from "./utils.ts";
import { emitLogicNode, emitLogicBody, emitFnShortcutBody } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import { isServerOnlyNode, collectFunctions } from "./collect.ts";
import { hasServerCallees, scheduleStatements } from "./scheduling.js";
import { buildMachineBindingsMap } from "./emit-reactive-wiring.js";
// A1c C16 — §53.9.1/§53.4.3 client-side function-param boundary check (Locus 3).
import { parsePredicateAnnotation, emitRuntimeCheck } from "./emit-predicates.ts";
import type { CompileContext } from "./context.ts";

/**
 * A1c C16 — Helper: emit per-param boundary checks for a client-side function.
 *
 * For each parameter whose typeAnnotation parses as a refinement-type predicate
 * (§53.2), emit a runtime check at function entry. Mirrors the server-side
 * §53.9.4 `emitServerParamCheck` path, but produces a client-side `throw`
 * (E-CONTRACT-001-RT) instead of a 400 Response.
 *
 * Per §53.4.3 condition 1: function param is a boundary zone whenever the
 * caller's constraint does not imply the callee's. The simplest correct
 * strategy (correctness floor) is "always check on entry"; §53.4.2/§53.9.2
 * caller-site elision is an OPTIMIZATION not implemented in v0.2.0 (deferred
 * with the rest of static-zone elision optimization to v0.3.0+).
 *
 * Returns an array of indented JS lines.
 */
function emitClientParamChecks(
  params: Param[],
  paramNames: string[],
  fnName: string,
  indent: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const annot = (typeof p === "object" && p !== null) ? ((p as any).typeAnnotation as string | undefined) : undefined;
    if (!annot) continue;
    const parsed = parsePredicateAnnotation(annot);
    if (!parsed) continue;
    // Use emitRuntimeCheck — same shape as boundary-zone let/state checks.
    // Pass paramName as both valueExpr and varName so the error message
    // identifies the parameter cleanly.
    const checkLines = emitRuntimeCheck(
      parsed.predicate,
      paramNames[i],
      paramNames[i],
      parsed.label,
      `fn ${fnName}, parameter '${paramNames[i]}'`,
    );
    for (const l of checkLines) out.push(`${indent}${l}`);
  }
  return out;
}

/** A loosely-typed AST node from the pipeline. */
type ASTNode = Record<string, unknown>;

/** A route map entry for a function. */
interface RouteEntry {
  boundary: string;
  generatedRouteName?: string;
  explicitRoute?: string;
  explicitMethod?: string;
  isSSE?: boolean;
  cpsSplit?: CpsSplit;
  functionName?: string;
}

/** CPS split descriptor from RI stage. */
interface CpsSplit {
  serverStmtIndices: number[];
  returnVarName?: string;
}

/** A param node (either a string or a structured param). */
type Param = string | { name?: string; [key: string]: unknown };

/**
 * Emit fetch stubs, CPS wrappers, and client-boundary function bodies.
 *
 * Returns both the emitted JS lines and the fnNameMap so event wiring
 * can resolve original function names to generated names without scanning
 * the emitted lines.
 *
 * Security invariant: SQL nodes, transaction blocks, and server-context meta nodes
 * MUST NOT appear in client-boundary function bodies. If found, emit E-CG-006.
 */
export function emitFunctions(ctx: CompileContext): { lines: string[]; fnNameMap: Map<string, string> } {
  const { filePath, routeMap, depGraph, errors, csrfEnabled } = ctx;
  const fnNodes: ASTNode[] = (ctx.analysis?.fnNodes ?? collectFunctions(ctx.fileAST)) as ASTNode[];
  const machineBindings = buildMachineBindingsMap(ctx.fileAST);
  // C13 (§51.0.F + §51.0.G): mirror machineBindings wiring for new <engine>
  // form. Function bodies that write to engine variables or call .advance()
  // need both maps threaded through the same emit path.
  const { buildEngineBindingsMap, collectEngineVarNames, collectEnginesWithHooks, collectEnginesWithOnTimeout, collectEnginesWithIdleWatchdog, collectEnginesWithInternalRules } = require("./emit-engine.ts");
  const engineBindings = buildEngineBindingsMap(ctx.fileAST);
  const engineVarNames: Set<string> = collectEngineVarNames(ctx.fileAST);
  // B17.4 (§51.0.H): the subset of engines that have at least one effect=/
  // <onTransition> arm. Threaded through scheduling/CPS opts to enable hook-
  // firing wraps on `.advance()` calls inside function bodies.
  const enginesWithHooks: Set<string> = collectEnginesWithHooks(ctx.fileAST);
  // A5-4 (§51.0.M): the subset of engines that have at least one <onTimeout>
  // element. Threaded alongside enginesWithHooks so .advance() and direct-
  // write call sites inside function bodies get the timer-table arg.
  const enginesWithOnTimeout: Set<string> = collectEnginesWithOnTimeout(ctx.fileAST);
  // A5-6 (§51.0.R, S77): the subset of engines that declare <onIdle>. Threaded
  // alongside enginesWithOnTimeout so .advance() and direct-write call sites
  // inside function bodies get the watchdog-config arg.
  const enginesWithIdleWatchdog: Set<string> = collectEnginesWithIdleWatchdog(ctx.fileAST);
  // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix): the subset of engines that have at
  // least one state-child carrying `internal:rule=`. Threaded so .advance()
  // and direct-write call sites inside function bodies get the internal
  // transition table identifier as the trailing arg.
  const enginesWithInternalRules: Set<string> = collectEnginesWithInternalRules(ctx.fileAST);
  const lines: string[] = [];

  // Map from original function name → generated var name.
  // Built here and returned to avoid scanning emitted lines later.
  const fnNameMap = new Map<string, string>();

  // Map from original function name → generated fetch stub var name.
  // Used by CPS wrapper generation.
  const serverFnStubs = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Step 1: Generate fetch/EventSource stubs for server-boundary functions
  //
  // §36: SSE generator functions (route.isSSE) emit EventSource stubs.
  //       Standard server functions emit fetch() stubs.
  // -------------------------------------------------------------------------
  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${(fnNode.span as ASTNode)?.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (!route || route.boundary !== "server") continue;

    if (!route.generatedRouteName) continue; // error already recorded in server gen

    const name = (fnNode.name as string) ?? "anon";
    const routeName = route.generatedRouteName;
    // Use explicit route path if specified, otherwise use generated path
    const path = route.explicitRoute ? route.explicitRoute : routePath(routeName);

    // -----------------------------------------------------------------------
    // §36: SSE EventSource stub for server function* generators
    // -----------------------------------------------------------------------
    if (route.isSSE) {
      const sseStubName = genVar(`sse_${name}`);
      serverFnStubs.set(name, sseStubName);
      fnNameMap.set(name, sseStubName);

      lines.push(`function ${sseStubName}(_scrml_onMessage, _scrml_onEvent) {`);
      lines.push(`  const _scrml_es = new EventSource(${JSON.stringify(path)});`);
      lines.push(`  _scrml_es.onmessage = function(_scrml_e) {`);
      lines.push(`    try {`);
      lines.push(`      const _scrml_data = JSON.parse(_scrml_e.data);`);
      lines.push(`      if (typeof _scrml_onMessage === 'function') _scrml_onMessage(_scrml_data);`);
      lines.push(`    } catch (_scrml_err) { /* malformed SSE data */ }`);
      lines.push(`  };`);
      lines.push(`  _scrml_es.onerror = function() { /* EventSource auto-reconnects */ };`);
      lines.push(`  // Auto-cleanup: close EventSource when scope is destroyed (§36.5)`);
      lines.push(`  if (typeof _scrml_cleanup_register === 'function') {`);
      lines.push(`    _scrml_cleanup_register(() => _scrml_es.close());`);
      lines.push(`  }`);
      lines.push(`  return _scrml_es;`);
      lines.push(`}`);
      lines.push('');
      continue; // Skip standard fetch() stub for this function
    }

    const httpMethod = route.explicitMethod ?? "POST";
    const params = (fnNode.params as Param[]) ?? [];
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario")
    const paramNames = params.map((p: Param, i: number) =>
      typeof p === "string" ? p.split(":")[0].trim() : ((p as { name?: string }).name ?? `_scrml_arg_${i}`)
    );

    const stubName = genVar(`fetch_${name}`);
    serverFnStubs.set(name, stubName);
    // Map original name → fetch stub as the default rewrite target.
    // If this function also has a CPS split, Step 2 will override this
    // with the CPS wrapper name (which is the correct call target).
    fnNameMap.set(name, stubName);

    lines.push(`async function ${stubName}(${paramNames.join(", ")}) {`);
    const usesCsrfRetry = csrfEnabled && httpMethod !== "GET" && httpMethod !== "HEAD";
    // A9 Ext 5 (§19.9.6): non-monotone CPS batches receive a per-invocation
    // UUIDv4 idempotency key transmitted via the `Idempotency-Key` header
    // (IETF-draft standard). Server stub (emit-server.ts) consults the
    // configured store before executing the batch, returning the stored
    // result on key-hit. Monotone / machine-intrinsic batches and non-CPS
    // server functions skip key emission.
    const cpsMonotonicity = route.cpsSplit?.monotonicity;
    const emitIdempotencyKey = cpsMonotonicity === "non-monotone";
    if (emitIdempotencyKey) {
      lines.push(`  // A9 Ext 5: idempotency key (non-monotone CPS batch)`);
      lines.push(`  const _scrml_idempotency_key = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + '-' + Date.now();`);
    }
    if (usesCsrfRetry) {
      // GITI-010: route through _scrml_fetch_with_csrf_retry so a cookie-less
      // first POST receives a Set-Cookie 403, then automatically retries with
      // the freshly-planted token.
      lines.push(`  const _scrml_body = JSON.stringify({`);
      for (const p of paramNames) {
        lines.push(`    ${JSON.stringify(p)}: ${p},`);
      }
      lines.push(`  });`);
      if (emitIdempotencyKey) {
        // _scrml_fetch_with_csrf_retry's signature is (path, method, body);
        // it does not currently accept extra headers. Fall back to direct
        // fetch with manual CSRF retry inlined when the idempotency key is
        // required, so the header rides along with the body. Mirrors the
        // !usesCsrfRetry branch with manual CSRF retry semantics.
        lines.push(`  // A9 Ext 5: bypass _scrml_fetch_with_csrf_retry to add Idempotency-Key header`);
        lines.push(`  const _scrml_csrf_token = (typeof document !== 'undefined' && document.querySelector) ? (document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') ?? '') : '';`);
        lines.push(`  const _scrml_resp_initial = await fetch(${JSON.stringify(path)}, {`);
        lines.push(`    method: ${JSON.stringify(httpMethod)},`);
        lines.push(`    headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_csrf_token, "Idempotency-Key": _scrml_idempotency_key },`);
        lines.push(`    body: _scrml_body,`);
        lines.push(`  });`);
        lines.push(`  let _scrml_resp;`);
        lines.push(`  if (_scrml_resp_initial.status === 403) {`);
        lines.push(`    // CSRF token may have been minted on the 403; retry with the freshly-planted token.`);
        lines.push(`    const _scrml_csrf_retry_token = (typeof document !== 'undefined' && document.querySelector) ? (document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') ?? '') : '';`);
        lines.push(`    _scrml_resp = await fetch(${JSON.stringify(path)}, {`);
        lines.push(`      method: ${JSON.stringify(httpMethod)},`);
        lines.push(`      headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_csrf_retry_token, "Idempotency-Key": _scrml_idempotency_key },`);
        lines.push(`      body: _scrml_body,`);
        lines.push(`    });`);
        lines.push(`  } else {`);
        lines.push(`    _scrml_resp = _scrml_resp_initial;`);
        lines.push(`  }`);
      } else {
        lines.push(`  const _scrml_resp = await _scrml_fetch_with_csrf_retry(${JSON.stringify(path)}, ${JSON.stringify(httpMethod)}, _scrml_body);`);
      }
    } else {
      lines.push(`  const _scrml_resp = await fetch(${JSON.stringify(path)}, {`);
      lines.push(`    method: ${JSON.stringify(httpMethod)},`);
      if (emitIdempotencyKey) {
        lines.push(`    headers: { "Content-Type": "application/json", "Idempotency-Key": _scrml_idempotency_key },`);
      } else {
        lines.push(`    headers: { "Content-Type": "application/json" },`);
      }
      lines.push(`    body: JSON.stringify({`);
      for (const p of paramNames) {
        lines.push(`      ${JSON.stringify(p)}: ${p},`);
      }
      lines.push(`    }),`);
      lines.push(`  });`);
    }
    lines.push(`  return _scrml_resp.json();`);
    lines.push(`}`);
    lines.push("");
  }

  // -------------------------------------------------------------------------
  // Step 2: Generate CPS client wrappers for server functions with cpsSplit
  // -------------------------------------------------------------------------
  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${(fnNode.span as ASTNode)?.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (!route || route.boundary !== "server" || !route.cpsSplit) continue;

    const name = (fnNode.name as string) ?? "anon";
    const stubName = serverFnStubs.get(name);
    const cpsSplit = route.cpsSplit;
    const body = (fnNode.body as ASTNode[]) ?? [];
    const params = (fnNode.params as Param[]) ?? [];
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario")
    const paramNames = params.map((p: Param, i: number) =>
      typeof p === "string" ? p.split(":")[0].trim() : ((p as { name?: string }).name ?? `_scrml_arg_${i}`)
    );

    // The CPS wrapper is always async (it calls the server stub).
    const wrapperName = genVar(`cps_${name}`);
    // Map original name → CPS wrapper so event wiring and post-process regex
    // rewrite bare call sites (e.g. onclick=login() → _scrml_cps_login_X()).
    fnNameMap.set(name, wrapperName);
    lines.push(`async function ${wrapperName}(${paramNames.join(", ")}) {`);

    // A9-Ext-4 D1 (2026-05-08): always-`!`-wrap CPS stubs.
    // Wrap the entire CPS body in try/catch so failures route through scrml's
    // §19 structural error system instead of silently throwing JS exceptions.
    // - On caught error: return a tagged scrml-error variant
    //   ({ __scrml_error: true, type: "CpsError", variant: "NetworkError"|"ServerError", data: {...} }).
    // - On server-side serialized error shape (server CPS handler returned a
    //   tagged scrml-error JSON payload — see emit-server.ts D1 site): pass
    //   through as-is so caller's `?` propagation / `!{}` handler / `<errorBoundary>`
    //   markup wrapper observes the same shape regardless of failure mode.
    // - Existing behavior preserved when no failure occurs.
    // Per integration design dive Q4 (2026-05-08): this is deprecation cycle
    // stage 1 (warn-only at compile time via W-CPS-NEEDS-FAILABLE).
    lines.push(`  try {`);

    // Emit statements in original order, replacing server-trigger statements
    // with a call to the server stub.
    let serverCallEmitted = false;
    // C5: CPS wrapper bodies are function bodies — `state-decl` nodes here
    // are reassignments (the cell's true declaration site lives at module
    // top-level). Suppress _scrml_init_set emission so the reset-to-init
    // thunk preserves the canonical declaration-time init expression.
    const cpsOpts: any = {
      declaredNames: new Set<string>(),
      insideFunctionBody: true,
      ...(machineBindings ? { machineBindings } : {}),
      ...(engineBindings ? { engineBindings } : {}),
      ...(engineVarNames.size > 0 ? { engineVarNames } : {}),
      ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
      ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
      ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
      ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
    };
    for (let i = 0; i < body.length; i++) {
      const stmt = body[i];
      if (!stmt) continue;

      if (cpsSplit.serverStmtIndices.includes(i)) {
        // This is a server statement — replace with a call to the server stub.
        if (!serverCallEmitted && stubName) {
          if (cpsSplit.returnVarName) {
            // The reactive assignment that receives the server result will reference
            // this variable. Emit: const _result = await serverStub(args);
            lines.push(`    const _scrml_server_result = await ${stubName}(${paramNames.join(", ")});`);
            // A9-Ext-4 D1: detect server-serialized error shape (per §19.9.1)
            // and propagate as-is. The server endpoint (emit-server.ts D1 site)
            // wraps thrown exceptions in this tagged shape with status 500.
            lines.push(`    if (_scrml_server_result && typeof _scrml_server_result === 'object' && _scrml_server_result.__scrml_error) {`);
            lines.push(`      return _scrml_server_result;`);
            lines.push(`    }`);
          } else {
            lines.push(`    await ${stubName}(${paramNames.join(", ")});`);
          }
          serverCallEmitted = true;
        }
        // BUG-R14-007 fix: if this server statement is a state-decl whose init
        // was extracted to the server, emit the reactive_set on the client using
        // the server result. This handles `@entries = ?{SELECT...}` where the SQL
        // runs on the server and the result is passed back via the fetch response.
        if (cpsSplit.returnVarName && (stmt as ASTNode).kind === "state-decl" && (stmt as ASTNode).name === cpsSplit.returnVarName) {
          lines.push(`    _scrml_reactive_set(${JSON.stringify((stmt as ASTNode).name)}, _scrml_server_result);`);
        }
        // Skip additional server statements — they are batched into one server call.
      } else {
        // Client statement — emit it directly.
        // Security guard: server-only nodes must not appear in client CPS wrapper.
        if (isServerOnlyNode(stmt)) {
          errors.push(new CGError(
            "E-CG-006",
            `E-CG-006: ${(stmt as ASTNode).kind} node found in CPS client wrapper for \`${name}\`. ` +
            `This code uses server-only features (${(stmt as ASTNode).kind}) but is marked to run in the browser. ` +
            `Move it to a server function or remove the client boundary.`,
            ((stmt as ASTNode).span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Parameters<typeof CGError>[2],
          ));
          continue;
        }
        // If this is the reactive assignment that receives the server result,
        // rewrite it to use the server result variable.
        if (cpsSplit.returnVarName && (stmt as ASTNode).kind === "state-decl" && (stmt as ASTNode).name === cpsSplit.returnVarName) {
          lines.push(`    _scrml_reactive_set(${JSON.stringify((stmt as ASTNode).name)}, _scrml_server_result);`);
        } else {
          const code = emitLogicNode(stmt, cpsOpts);
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`    ${line}`);
            }
          }
        }
      }
    }

    // A9-Ext-4 D1 catch arm: surface fetch / network failures as a tagged
    // scrml-error variant (NetworkError variant of CpsError synthetic enum).
    // Existing scrml `?` propagation, `!{}` handler, and `<errorBoundary>`
    // markup all observe the same `{ __scrml_error: true, ... }` shape.
    // If a `__scrml_error`-shaped value is thrown directly (rare but valid),
    // pass it through unchanged so the original variant identity is preserved.
    lines.push(`  } catch (_scrml_cps_err) {`);
    lines.push(`    if (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error) {`);
    lines.push(`      return _scrml_cps_err;`);
    lines.push(`    }`);
    lines.push(`    return {`);
    lines.push(`      __scrml_error: true,`);
    lines.push(`      type: "CpsError",`);
    lines.push(`      variant: "NetworkError",`);
    lines.push(`      data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} },`);
    lines.push(`    };`);
    lines.push(`  }`);

    lines.push(`}`);
    lines.push("");
  }

  // -------------------------------------------------------------------------
  // Step 3: Generate client-side function bodies for client-boundary functions
  // -------------------------------------------------------------------------
  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${(fnNode.span as ASTNode)?.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (route && route.boundary === "server") continue; // handled by server JS + fetch stub
    if (fnNode.isHandleEscapeHatch) continue; // handle() is server-only middleware — no client body

    const name = (fnNode.name as string) ?? "anon";
    const params = (fnNode.params as Param[]) ?? [];
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario")
    const paramNames = params.map((p: Param, i: number) =>
      typeof p === "string" ? p.split(":")[0].trim() : ((p as { name?: string }).name ?? `_scrml_arg_${i}`)
    );

    // Check if this function has any server-call callees that need async
    const hasServerCalls = hasServerCallees(fnNode, routeMap, filePath);
    const asyncPrefix = hasServerCalls ? "async " : "";

    const generatedName = genVar(name);
    fnNameMap.set(name, generatedName);

    lines.push(`${asyncPrefix}function ${generatedName}(${paramNames.join(", ")}) {`);

    // A1c C16 — §53.9.1 client-side param boundary checks (Locus 3).
    // Mirrors emit-server.ts §53.9.4 wiring, but throws E-CONTRACT-001-RT
    // (client-side execution halts) instead of returning a 400 Response.
    const _paramCheckLines = emitClientParamChecks(params, paramNames, name, "  ");
    for (const _l of _paramCheckLines) lines.push(_l);

    const body = (fnNode.body as ASTNode[]) ?? [];
    // §48: `fn` shorthand uses tail-expression implicit return. Bypass scheduleStatements
    // (which has no notion of implicit return); `fn` bodies can't contain server calls
    // (E-FN-005 prohibits async/await), so the Promise.all scheduler is never needed here.
    // Bug H fix: also route `function` declarations with return-type annotations through
    // emitFnShortcutBody so match/switch tail expressions get implicit return.
    const fnKind = (fnNode as { fnKind?: string }).fnKind;
    const hasRetType = (fnNode as { hasReturnType?: boolean }).hasReturnType;
    // A1c C16 — thread the function's returnTypeAnnotation so return-stmt
    // can fire §53.9.3 boundary checks for refinement-typed returns.
    const _returnTypeAnnotation = (fnNode as { returnTypeAnnotation?: string }).returnTypeAnnotation;
    if (fnKind === "fn" || hasRetType) {
      // C5: function-shortcut bodies are function bodies — `state-decl` nodes
      // within are reassignments, not declaration sites. Suppress
      // _scrml_init_set sidecar emission via insideFunctionBody:true.
      const fnOpts = {
        boundary: "client" as const,
        declaredNames: new Set<string>(),
        insideFunctionBody: true,
        ...(machineBindings ? { machineBindings } : {}),
        ...(engineBindings ? { engineBindings } : {}),
        ...(engineVarNames.size > 0 ? { engineVarNames } : {}),
      ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}),
        ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}),
        ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}),
        ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}),
        ...(_returnTypeAnnotation ? { returnTypeAnnotation: _returnTypeAnnotation, enclosingFnName: name } : {}),
      };
      const shortcutLines = emitFnShortcutBody(body, fnOpts, fnKind, hasRetType);
      for (const code of shortcutLines) {
        for (const line of code.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      const scheduled = scheduleStatements(body, fnNode, routeMap, depGraph, filePath, errors, machineBindings, engineBindings, engineVarNames, enginesWithHooks, _returnTypeAnnotation, name, enginesWithOnTimeout, enginesWithIdleWatchdog, enginesWithInternalRules);
      for (const line of scheduled) {
        lines.push(`  ${line}`);
      }
    }

    lines.push(`}`);
    lines.push("");
  }

  return { lines, fnNameMap };
}
