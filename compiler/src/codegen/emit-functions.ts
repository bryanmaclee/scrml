import { genVar } from "./var-counter.ts";
import { routePath } from "./utils.ts";
import { emitLogicNode, emitLogicBody, emitFnShortcutBody } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import { isServerOnlyNode, collectFunctions } from "./collect.ts";
import { hasServerCallees, scheduleStatements } from "./scheduling.js";
import { buildMachineBindingsMap } from "./emit-reactive-wiring.js";
import type { CompileContext } from "./context.ts";

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
    if (usesCsrfRetry) {
      // GITI-010: route through _scrml_fetch_with_csrf_retry so a cookie-less
      // first POST receives a Set-Cookie 403, then automatically retries with
      // the freshly-planted token.
      lines.push(`  const _scrml_body = JSON.stringify({`);
      for (const p of paramNames) {
        lines.push(`    ${JSON.stringify(p)}: ${p},`);
      }
      lines.push(`  });`);
      lines.push(`  const _scrml_resp = await _scrml_fetch_with_csrf_retry(${JSON.stringify(path)}, ${JSON.stringify(httpMethod)}, _scrml_body);`);
    } else {
      lines.push(`  const _scrml_resp = await fetch(${JSON.stringify(path)}, {`);
      lines.push(`    method: ${JSON.stringify(httpMethod)},`);
      lines.push(`    headers: { "Content-Type": "application/json" },`);
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

    // Emit statements in original order, replacing server-trigger statements
    // with a call to the server stub.
    let serverCallEmitted = false;
    const cpsOpts = { declaredNames: new Set<string>(), ...(machineBindings ? { machineBindings } : {}) };
    for (let i = 0; i < body.length; i++) {
      const stmt = body[i];
      if (!stmt) continue;

      if (cpsSplit.serverStmtIndices.includes(i)) {
        // This is a server statement — replace with a call to the server stub.
        if (!serverCallEmitted && stubName) {
          if (cpsSplit.returnVarName) {
            // The reactive assignment that receives the server result will reference
            // this variable. Emit: const _result = await serverStub(args);
            lines.push(`  const _scrml_server_result = await ${stubName}(${paramNames.join(", ")});`);
          } else {
            lines.push(`  await ${stubName}(${paramNames.join(", ")});`);
          }
          serverCallEmitted = true;
        }
        // BUG-R14-007 fix: if this server statement is a reactive-decl whose init
        // was extracted to the server, emit the reactive_set on the client using
        // the server result. This handles `@entries = ?{SELECT...}` where the SQL
        // runs on the server and the result is passed back via the fetch response.
        if (cpsSplit.returnVarName && (stmt as ASTNode).kind === "state-decl" && (stmt as ASTNode).name === cpsSplit.returnVarName) {
          lines.push(`  _scrml_reactive_set(${JSON.stringify((stmt as ASTNode).name)}, _scrml_server_result);`);
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
          lines.push(`  _scrml_reactive_set(${JSON.stringify((stmt as ASTNode).name)}, _scrml_server_result);`);
        } else {
          const code = emitLogicNode(stmt, cpsOpts);
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }
    }

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

    const body = (fnNode.body as ASTNode[]) ?? [];
    // §48: `fn` shorthand uses tail-expression implicit return. Bypass scheduleStatements
    // (which has no notion of implicit return); `fn` bodies can't contain server calls
    // (E-FN-005 prohibits async/await), so the Promise.all scheduler is never needed here.
    // Bug H fix: also route `function` declarations with return-type annotations through
    // emitFnShortcutBody so match/switch tail expressions get implicit return.
    const fnKind = (fnNode as { fnKind?: string }).fnKind;
    const hasRetType = (fnNode as { hasReturnType?: boolean }).hasReturnType;
    if (fnKind === "fn" || hasRetType) {
      const fnOpts = { boundary: "client" as const, declaredNames: new Set<string>(), ...(machineBindings ? { machineBindings } : {}) };
      const shortcutLines = emitFnShortcutBody(body, fnOpts, fnKind, hasRetType);
      for (const code of shortcutLines) {
        for (const line of code.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      const scheduled = scheduleStatements(body, fnNode, routeMap, depGraph, filePath, errors, machineBindings);
      for (const line of scheduled) {
        lines.push(`  ${line}`);
      }
    }

    lines.push(`}`);
    lines.push("");
  }

  return { lines, fnNameMap };
}
