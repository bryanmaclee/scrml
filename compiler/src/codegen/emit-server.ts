import { CGError } from "./errors.ts";
import { genVar } from "./var-counter.ts";
import { routePath } from "./utils.ts";
import { collectFunctions, collectServerVarDecls, callableServerVarDecls } from "./collect.ts";
import { emitLogicNode } from "./emit-logic.ts";
import { getNodes } from "./collect.ts";
import { collectChannelNodes, emitChannelServerJs, emitChannelWsHandlers, collectChannelFunctionMap } from "./emit-channel.ts";
import { serverRewriteEmitted } from "./rewrite.ts";
import { emitExpr, emitExprField, type EmitExprContext } from "./emit-expr.ts";
import type { CompileContext } from "./context.ts";
import { emitServerParamCheck, parsePredicateAnnotation } from "./emit-predicates.ts";

/**
 * S79 audit fix C.1 — parse `<program idempotency-ttl="...">` raw value into
 * a millisecond integer, or `null` for fall-back-to-default-24h.
 *
 * Accepted shapes:
 *   - bare integer ("3600000")  → that many millis
 *   - duration string with unit suffix:
 *       "Nms" / "Ns" / "Nm" / "Nh" / "Nd"
 *     where N is a non-negative decimal integer (no float, no leading sign).
 *   - whitespace + quoting tolerated by the caller's getMWAttr (already
 *     stripped). This helper trims defensively.
 *
 * Returns the resolved millisecond value, OR `null` when the value is null/
 * empty/malformed (caller falls back to 24h default). Silent fallback
 * matches the audit's documented v1 scope; future v2 may add a
 * W-MIDDLEWARE-TTL-INVALID lint.
 *
 * Distinct from `parseAfterDuration` (engine-side `<onTimeout after=>`),
 * which uses a different unit set (no `d`) and handles a `${expr}<unit>`
 * computed form. idempotency-ttl is a plain attribute — no computed-form.
 */
function parseIdempotencyTtl(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Bare integer (millis).
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Duration with unit suffix.
  const m = trimmed.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const mult = multipliers[unit];
  return mult !== undefined ? n * mult : null;
}

/**
 * Generate server-side route handler code for all server-boundary functions
 * in a file.
 */
export function generateServerJs(
  ctxOrFileAST: CompileContext | any,
  routeMapLegacy?: any,
  errorsLegacy?: CGError[],
  authMiddlewareLegacy?: any | null,
  middlewareConfigLegacy?: any | null,
  batchPlan?: any,
  batchPlannerErrors?: Array<{ code: string; message: string; span?: any }>,
): string {
  // Support both new (ctx) and legacy (fileAST, routeMap, errors, authMW, mwConfig) signatures
  let fileAST: any;
  let routeMap: any;
  let errors: CGError[];
  let authMiddlewareEntry: any | null;
  let middlewareConfig: any | null;
  const ctxForCache: CompileContext | null =
    (ctxOrFileAST && "fileAST" in ctxOrFileAST && "registry" in ctxOrFileAST)
      ? ctxOrFileAST as CompileContext : null;
  if (ctxForCache) {
    fileAST = ctxForCache.fileAST;
    routeMap = ctxForCache.routeMap;
    errors = ctxForCache.errors;
    authMiddlewareEntry = ctxForCache.authMiddleware;
    middlewareConfig = ctxForCache.middlewareConfig;
  } else {
    fileAST = ctxOrFileAST;
    routeMap = routeMapLegacy;
    errors = errorsLegacy ?? [];
    authMiddlewareEntry = authMiddlewareLegacy ?? null;
    middlewareConfig = middlewareConfigLegacy ?? null;
  }
  const filePath: string = fileAST.filePath;
  const fnNodes: any[] = ctxForCache?.analysis?.fnNodes ?? collectFunctions(fileAST);

  // §8.9.2 / §19.10.5: determine whether a handler receives an implicit
  // per-handler transaction envelope. Applies iff:
  //   - the Batch Planner (Stage 7.5) recorded ≥ 1 CoalescingGroup with
  //     envelopeKind === "implicit-handler-tx" for this handler, AND
  //   - no E-BATCH-001 composition error fired for this handler.
  function needsImplicitEnvelope(funcName: string): boolean {
    if (!batchPlan || !(batchPlan as any).coalescedHandlers) return false;
    const groups = (batchPlan as any).coalescedHandlers.get(funcName);
    if (!groups || groups.length === 0) return false;
    const hasImplicit = groups.some((g: any) => g.envelopeKind === "implicit-handler-tx");
    if (!hasImplicit) return false;
    const suppressed = (batchPlannerErrors ?? []).some(
      (e) => e.code === "E-BATCH-001" && typeof e.message === "string" && e.message.includes(`'${funcName}'`),
    );
    return !suppressed;
  }
  const serverFns: Array<{ fnNode: any; route: any }> = [];

  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${fnNode.span.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (!route || route.boundary !== "server") continue;

    if (!route.generatedRouteName) {
      errors.push(new CGError(
        "E-CG-002",
        `E-CG-002: Server-boundary function \`${fnNode.name ?? "<anonymous>"}\` has no ` +
        `generated route name. This indicates an RI invariant violation.`,
        fnNode.span,
      ));
      continue;
    }

    serverFns.push({ fnNode, route });
  }

  const _scrml_handleNodeEarly: any | null = fnNodes.find((fn: any) => fn.isHandleEscapeHatch) ?? null;

  const channelNodes: any[] = ctxForCache?.analysis?.channelNodes ?? collectChannelNodes(getNodes(fileAST));
  // C18 (§38.6): map function-name → owning-channel-name. Server functions
  // declared inside a `<channel>` body get `broadcast(data)` / `disconnect()`
  // auto-injected as locals; functions outside the map don't.
  const channelFnMap: Map<string, string> = collectChannelFunctionMap(getNodes(fileAST));
  // C18 (§38.6): per-channel topic resolution map. Keyed by channel name; the
  // value is a JS expression-string evaluating to the topic at runtime. For
  // string-literal topics this is `JSON.stringify(value)`; for `topic=@var`
  // we currently fall back to the channel's `name` attribute (matches the
  // client IIFE topic-default behavior; dynamic `topic=@var` server-side is
  // §38.6.2 territory and is deferred per C18 SURVEY).
  const channelTopicMap: Map<string, string> = new Map();
  for (const chNode of channelNodes) {
    const attrs: any[] = chNode.attrs ?? chNode.attributes ?? [];
    const nameAttr = attrs.find((a: any) => a && a.name === "name");
    let chName = "channel";
    if (nameAttr) {
      const v = nameAttr.value;
      if (v?.kind === "string-literal") chName = v.value;
      else if (typeof v === "string") chName = v;
    }
    const topicAttr = attrs.find((a: any) => a && a.name === "topic");
    let topicExpr = JSON.stringify(chName);
    if (topicAttr) {
      const v = topicAttr.value;
      if (v?.kind === "string-literal") topicExpr = JSON.stringify(v.value);
      // dynamic topic=@var: leave as channel name fallback; §38.6.2 deferred
    }
    channelTopicMap.set(chName, topicExpr);
  }

  // C18 (§38.6): emit `broadcast(data)` / `disconnect()` injection lines for
  // a channel-owned server function. Returns indented JS lines that define
  // both as locals so the user's body can call them directly.
  //
  // - `broadcast(d)` publishes JSON-serialized `d` to the channel topic via
  //   the global server handle (`globalThis._scrml_active_server`), set by
  //   build.js / dev.js after `Bun.serve()`. Falls back to a no-op when no
  //   server is registered (test paths, isolated module imports, etc.).
  // - `disconnect()` from an HTTP-routed channel-owned server function has
  //   no "current client" identity (the call originates from an HTTP POST,
  //   not a WS connection). It is therefore a no-op in this context. The
  //   `onserver:close` / `onserver:message` paths that DO have `ws` in
  //   scope inject a different `disconnect()` shape inside emit-channel's
  //   _scrml_ws_handlers handler bodies (deferred per C18 SURVEY).
  function emitBroadcastInjection(channelName: string, indent: string): string[] {
    const topicExpr = channelTopicMap.get(channelName) ?? JSON.stringify(channelName);
    return [
      `${indent}// §38.6 broadcast/disconnect built-ins for channel "${channelName}"`,
      `${indent}const broadcast = (_scrml_data) => {`,
      `${indent}  const _scrml_srv = (typeof globalThis !== "undefined" && globalThis._scrml_active_server) || null;`,
      `${indent}  if (_scrml_srv && typeof _scrml_srv.publish === "function") {`,
      `${indent}    _scrml_srv.publish(${topicExpr}, JSON.stringify(_scrml_data));`,
      `${indent}  }`,
      `${indent}};`,
      `${indent}const disconnect = () => { /* §38.6: no-op from HTTP-routed server fn (no current client) */ };`,
    ];
  }

  // §8.11: detect if this file needs a synthetic __mountHydrate route
  // (≥2 `server @var` decls with callable initExprs → coalesce initial loads).
  const _mhAllServerVars = collectServerVarDecls(fileAST);
  const _mhCallableDecls = callableServerVarDecls(_mhAllServerVars);
  const _needsMountHydrate = _mhCallableDecls.length >= 2;

  if (
    serverFns.length === 0 &&
    !authMiddlewareEntry &&
    channelNodes.length === 0 &&
    !middlewareConfig &&
    !_scrml_handleNodeEarly &&
    !_needsMountHydrate
  ) return "";

  const lines: string[] = [];
  lines.push("// Generated server route handlers");
  lines.push("// This file is compiler IR — not meant for direct consumption.");
  lines.push("");

  // Emit JS imports from use-decl and import-decl nodes (§40).
  // Local .scrml imports are rewritten to .server.js (compiled server output);
  // mirrors emit-client.ts handling but targets server-side artefacts. scrml:
  // and vendor: prefixed imports pass through unchanged — they are valid Bun
  // module specifiers handled by rewriteStdlibImports() / Bun's vendor resolution.
  const allImports: any[] = fileAST?.ast?.imports ?? fileAST?.imports ?? [];
  for (const stmt of allImports) {
    if ((stmt.kind === "import-decl" || stmt.kind === "use-decl") && stmt.source && stmt.names?.length > 0) {
      let jsSource: string = stmt.source;
      if (jsSource.endsWith(".scrml")) {
        jsSource = jsSource.replace(/\.scrml$/, ".server.js");
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

  // Session/auth middleware (Option C hybrid)
  if (authMiddlewareEntry) {
    const { loginRedirect, csrf, sessionExpiry } = authMiddlewareEntry;

    lines.push("// --- Session middleware (compiler-generated) ---");
    lines.push(`const _scrml_session_expiry = ${JSON.stringify(sessionExpiry)};`);
    lines.push("");
    lines.push("function _scrml_session_middleware(req) {");
    lines.push("  const cookieHeader = req.headers.get('Cookie') || '';");
    lines.push("  const sessionId = cookieHeader.match(/scrml_sid=([^;]+)/)?.[1] || null;");
    lines.push("  return { sessionId, isAuth: !!sessionId };");
    lines.push("}");
    lines.push("");

    lines.push("// --- Auth check middleware ---");
    lines.push(`function _scrml_auth_check(req) {`);
    lines.push(`  const session = _scrml_session_middleware(req);`);
    lines.push(`  if (!session.isAuth) {`);
    lines.push(`    return new Response(null, {`);
    lines.push(`      status: 302,`);
    lines.push(`      headers: { Location: ${JSON.stringify(loginRedirect)} },`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push(`  return null;`);
    lines.push(`}`);
    lines.push("");

    if (csrf === "auto") {
      lines.push("// --- CSRF token generation and validation ---");
      lines.push("function _scrml_generate_csrf() {");
      lines.push("  return crypto.randomUUID();");
      lines.push("}");
      lines.push("");
      lines.push("function _scrml_validate_csrf(req, session) {");
      lines.push("  const token = req.headers.get('X-CSRF-Token') || '';");
      lines.push("  return token === session.csrfToken;");
      lines.push("}");
      lines.push("");
    }

    lines.push("// --- session.destroy() handler ---");
    lines.push("export const _scrml_session_destroy = {");
    lines.push(`  path: "/_scrml/session/destroy",`);
    lines.push(`  method: "POST",`);
    lines.push("  handler: async function(_scrml_req) {");
    lines.push("    return new Response(JSON.stringify({ ok: true }), {");
    lines.push("      status: 200,");
    lines.push("      headers: {");
    lines.push(`        'Set-Cookie': 'scrml_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',`);
    lines.push("        'Content-Type': 'application/json',");
    lines.push("      },");
    lines.push("    });");
    lines.push("  },");
    lines.push("};");
    lines.push("");
  }

  // Baseline CSRF protection
  const hasStateMutatingRoutes = serverFns.some(({ route }) => {
    const m: string = route.explicitMethod ?? "POST";
    return m !== "GET" && m !== "HEAD";
  });

  if (!authMiddlewareEntry && hasStateMutatingRoutes) {
    lines.push("// --- Baseline CSRF protection (compiler-generated, double-submit cookie) ---");
    lines.push("function _scrml_ensure_csrf_cookie(req) {");
    lines.push("  const cookieHeader = req.headers.get('Cookie') || '';");
    lines.push("  const existing = cookieHeader.match(/scrml_csrf=([^;]+)/)?.[1] || null;");
    lines.push("  return existing || crypto.randomUUID();");
    lines.push("}");
    lines.push("");
    lines.push("function _scrml_validate_csrf(req) {");
    lines.push("  const cookieHeader = req.headers.get('Cookie') || '';");
    lines.push("  const cookieToken = cookieHeader.match(/scrml_csrf=([^;]+)/)?.[1] || '';");
    lines.push("  const headerToken = req.headers.get('X-CSRF-Token') || '';");
    lines.push("  return cookieToken.length > 0 && cookieToken === headerToken;");
    lines.push("}");
    lines.push("");
  }

  // §39 Compiler-auto middleware infrastructure
  const _scrml_hasMW: boolean = middlewareConfig != null;
  const _scrml_hasCors: boolean = _scrml_hasMW && middlewareConfig.cors != null;
  const _scrml_hasLog: boolean = _scrml_hasMW && middlewareConfig.log != null && middlewareConfig.log !== 'off';
  const _scrml_hasRatelimit: boolean = _scrml_hasMW && middlewareConfig.ratelimit != null;
  const _scrml_hasSecureHeaders: boolean = _scrml_hasMW && middlewareConfig.headers === 'strict';
  const _scrml_handleNode: any | null = _scrml_handleNodeEarly;

  if (_scrml_hasMW || _scrml_handleNode) {
    lines.push("// --- §39 Compiler-auto middleware infrastructure ---");
    lines.push("");

    if (_scrml_hasCors) {
      const corsOrigin = JSON.stringify(middlewareConfig.cors);
      lines.push("// §39.2.1 CORS helpers");
      lines.push("function _scrml_cors_headers() {");
      lines.push("  return {");
      lines.push(`    'Access-Control-Allow-Origin': ${corsOrigin},`);
      lines.push("    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',");
      lines.push("    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Authorization',");
      lines.push("    'Access-Control-Max-Age': '86400',");
      lines.push("  };");
      lines.push("}");
      lines.push("export const _scrml_cors_options_route = {");
      lines.push("  path: '/*',");
      lines.push("  method: 'OPTIONS',");
      lines.push("  handler: function(_scrml_req) {");
      lines.push("    return new Response(null, { status: 204, headers: _scrml_cors_headers() });");
      lines.push("  },");
      lines.push("};");
      lines.push("");
    }

    if (_scrml_hasRatelimit) {
      const parts: string[] = middlewareConfig.ratelimit.split('/');
      const limit: number = parseInt(parts[0], 10);
      const unit: string = parts[1];
      const windowMs: number = unit === 'sec' ? 1000 : unit === 'min' ? 60000 : 3600000;
      lines.push("// §39.2.4 Rate limiter (in-memory sliding window, per IP)");
      lines.push("const _scrml_rate_map = new Map();");
      lines.push(`const _scrml_rate_limit = ${limit};`);
      lines.push(`const _scrml_rate_window = ${windowMs};`);
      lines.push("function _scrml_check_ratelimit(req) {");
      lines.push("  const forwarded = req.headers.get('x-forwarded-for');");
      lines.push("  const ip = forwarded ? forwarded.split(',')[0].trim()");
      lines.push("    : (typeof Bun !== 'undefined' && Bun.requestIP ? (Bun.requestIP(req)?.address ?? 'unknown') : 'unknown');");
      lines.push("  const now = Date.now();");
      lines.push("  const windowStart = now - _scrml_rate_window;");
      lines.push("  const hits = (_scrml_rate_map.get(ip) ?? []).filter(t => t > windowStart);");
      lines.push("  hits.push(now);");
      lines.push("  _scrml_rate_map.set(ip, hits);");
      lines.push("  if (hits.length > _scrml_rate_limit) {");
      lines.push(`    const retryAfter = Math.ceil(_scrml_rate_window / 1000);`);
      lines.push("    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {");
      lines.push("      status: 429,");
      lines.push("      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },");
      lines.push("    });");
      lines.push("  }");
      lines.push("  return null;");
      lines.push("}");
      lines.push("");
    }

    if (_scrml_hasSecureHeaders) {
      lines.push("// §39.2.5 Security headers");
      lines.push("function _scrml_apply_security_headers(response) {");
      lines.push("  response.headers.set('X-Content-Type-Options', 'nosniff');");
      lines.push("  response.headers.set('X-Frame-Options', 'SAMEORIGIN');");
      lines.push("  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');");
      lines.push("  response.headers.set('Content-Security-Policy', \"default-src 'self'\");");
      lines.push("  return response;");
      lines.push("}");
      lines.push("");
    }

    if (_scrml_hasLog) {
      const logMode: string = middlewareConfig.log;
      lines.push("// §39.2.2 Request/response logging");
      lines.push("function _scrml_log_request(method, path, status, ms) {");
      if (logMode === 'structured') {
        lines.push("  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), method, path, status, ms }) + '\\n');");
      } else {
        lines.push("  process.stdout.write(method + ' ' + path + ' ' + status + ' ' + ms + 'ms\\n');");
      }
      lines.push("}");
      lines.push("");
    }

    lines.push("// §39 Middleware pipeline wrapper");
    lines.push("// Pipeline: CORS → rate-limit → handle() PRE → CSRF → route → handle() POST → headers → logging");
    lines.push("function _scrml_mw_wrap(routeHandler) {");
    lines.push("  return async function _scrml_mw_handler(_scrml_mw_req) {");

    if (_scrml_hasLog) {
      lines.push("    const _scrml_mw_t0 = Date.now();");
    }

    if (_scrml_hasRatelimit) {
      lines.push("    const _scrml_rl = _scrml_check_ratelimit(_scrml_mw_req);");
      lines.push("    if (_scrml_rl) return _scrml_rl;");
    }

    if (_scrml_handleNode) {
      const handleBody: any[] = _scrml_handleNode.body ?? [];

      let resolveIdx = -1;
      for (let i = 0; i < handleBody.length; i++) {
        const code = emitLogicNode(handleBody[i], { boundary: "server" });
        if (code && code.includes('resolve(')) {
          resolveIdx = i;
          break;
        }
      }

      lines.push("    // handle() escape hatch body (§39.3) — wrapped in IIFE for return capture");
      lines.push("    const _scrml_mw_result = await (async () => {");

      lines.push("      // resolve() = route dispatch (CSRF check is per-route)");
      lines.push("      const resolve = async (_scrml_resolve_req) => {");
      lines.push("        return routeHandler(_scrml_resolve_req);");
      lines.push("      };");

      const handleParams: any[] = _scrml_handleNode.params ?? [];
      const requestParamName: string = typeof handleParams[0] === 'string' ? handleParams[0] : 'request';

      if (requestParamName !== '_scrml_mw_req') {
        lines.push(`      const ${requestParamName} = _scrml_mw_req;`);
      }

      for (const stmt of handleBody) {
        const code = emitLogicNode(stmt, { boundary: "server" });
        if (code) {
          for (const line of code.split('\n')) lines.push('      ' + line);
        }
      }

      lines.push("    })();");
    } else {
      lines.push("    // No handle() — direct route dispatch (CSRF check is per-route)");
      lines.push("    const _scrml_mw_result = await routeHandler(_scrml_mw_req);");
    }

    if (_scrml_hasSecureHeaders) {
      lines.push("    if (_scrml_mw_result instanceof Response) _scrml_apply_security_headers(_scrml_mw_result);");
    }

    if (_scrml_hasCors) {
      lines.push("    if (_scrml_mw_result instanceof Response) {");
      lines.push("      const _scrml_cors_h = _scrml_cors_headers();");
      lines.push("      for (const [k, v] of Object.entries(_scrml_cors_h)) {");
      lines.push("        _scrml_mw_result.headers.set(k, v);");
      lines.push("      }");
      lines.push("    }");
    }

    if (_scrml_hasLog) {
      lines.push("    const _scrml_mw_status = _scrml_mw_result instanceof Response ? _scrml_mw_result.status : 200;");
      lines.push("    _scrml_log_request(_scrml_mw_req.method, new URL(_scrml_mw_req.url, 'http://localhost').pathname, _scrml_mw_status, Date.now() - _scrml_mw_t0);");
    }

    lines.push("    return _scrml_mw_result;");
    lines.push("  };");
    lines.push("}");
    lines.push("");
  }

  for (const { fnNode, route } of serverFns) {
    const name: string = fnNode.name ?? "anon";
    const routeName: string = route.generatedRouteName;
    const path: string = route.explicitRoute ? route.explicitRoute : routePath(routeName);
    const params: any[] = fnNode.params ?? [];
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario")
    const paramNames: string[] = params.map((p: any, i: number) =>
      typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? `_scrml_arg_${i}`)
    );

    // §36: SSE handler — server function* generators emit text/event-stream GET
    if (route.isSSE) {
      const handlerName = genVar(`handler_${name}`);
      const body: any[] = fnNode.body ?? [];

      lines.push(`async function ${handlerName}(_scrml_req) {`);

      lines.push(`  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');`);
      lines.push(`  const route = {`);
      lines.push(`    query: Object.fromEntries(_scrml_url.searchParams),`);
      lines.push(`    lastEventId: _scrml_req.headers.get('Last-Event-ID') ?? null,`);
      lines.push(`  };`);

      if (authMiddlewareEntry) {
        lines.push(`  // Auth check for SSE endpoint (compiler-generated)`);
        lines.push(`  const _scrml_authResult = _scrml_auth_check(_scrml_req);`);
        lines.push(`  if (_scrml_authResult) return _scrml_authResult;`);
      }

      lines.push(`  const _scrml_enc = new TextEncoder();`);
      lines.push(`  const _scrml_stream = new ReadableStream({`);
      lines.push(`    async start(_scrml_ctrl) {`);
      lines.push(`      try {`);
      lines.push(`        async function* _scrml_gen() {`);

      for (const stmt of body) {
        const code = emitLogicNode(stmt, { boundary: "server" });
        if (code) {
          for (const line of code.split("\n")) {
            lines.push(`          ${line}`);
          }
        }
      }

      lines.push(`        }`);
      lines.push(`        for await (const _scrml_val of _scrml_gen()) {`);
      lines.push(`          const _scrml_hasEvent = _scrml_val && typeof _scrml_val === 'object' && 'event' in _scrml_val && 'data' in _scrml_val;`);
      lines.push(`          let _scrml_chunk = '';`);
      lines.push(`          if (_scrml_hasEvent) {`);
      lines.push(`            _scrml_chunk += \`event: \${_scrml_val.event}\\n\`;`);
      lines.push(`            if (_scrml_val.id != null) _scrml_chunk += \`id: \${_scrml_val.id}\\n\`;`);
      lines.push(`            _scrml_chunk += \`data: \${JSON.stringify(_scrml_val.data)}\\n\\n\`;`);
      lines.push(`          } else {`);
      lines.push(`            if (_scrml_val && typeof _scrml_val === 'object' && 'id' in _scrml_val) {`);
      lines.push(`              _scrml_chunk += \`id: \${_scrml_val.id}\\n\`;`);
      lines.push(`            }`);
      lines.push(`            _scrml_chunk += \`data: \${JSON.stringify(_scrml_val)}\\n\\n\`;`);
      lines.push(`          }`);
      lines.push(`          _scrml_ctrl.enqueue(_scrml_enc.encode(_scrml_chunk));`);
      lines.push(`        }`);
      lines.push(`      } catch (_scrml_err) {`);
      lines.push(`        // Stream error — close the controller`);
      lines.push(`      } finally {`);
      lines.push(`        _scrml_ctrl.close();`);
      lines.push(`      }`);
      lines.push(`    },`);
      lines.push(`    cancel() { /* client disconnected — cleanup handled in finally */ },`);
      lines.push(`  });`);
      lines.push(`  return new Response(_scrml_stream, {`);
      lines.push(`    headers: {`);
      lines.push(`      'Content-Type': 'text/event-stream',`);
      lines.push(`      'Cache-Control': 'no-cache',`);
      lines.push(`      'Connection': 'keep-alive',`);
      lines.push(`    },`);
      lines.push(`  });`);
      lines.push(`}`);
      lines.push("");

      lines.push(`export const ${routeName} = {`);
      lines.push(`  path: ${JSON.stringify(path)},`);
      lines.push(`  method: "GET",`);
      lines.push(`  handler: ${(_scrml_hasMW || _scrml_handleNode != null) ? `_scrml_mw_wrap(${handlerName})` : handlerName},`);
      lines.push(`};`);
      lines.push("");

      continue;
    }

    const httpMethod: string = route.explicitMethod ?? "POST";
    const isStateMutating: boolean = httpMethod !== "GET" && httpMethod !== "HEAD";
    const useBaselineCsrf: boolean = !authMiddlewareEntry && isStateMutating;

    const handlerName = genVar(`handler_${name}`);
    lines.push(`async function ${handlerName}(_scrml_req) {`);

    lines.push(`  // route.query injection (SPEC §20.3)`);
    lines.push(`  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');`);
    lines.push(`  const route = { query: Object.fromEntries(_scrml_url.searchParams) };`);

    if (authMiddlewareEntry && isStateMutating) {
      lines.push(`  // Auth check (compiler-generated)`);
      lines.push(`  const _scrml_authResult = _scrml_auth_check(_scrml_req);`);
      lines.push(`  if (_scrml_authResult) return _scrml_authResult;`);
    }

    if (authMiddlewareEntry?.csrf === "auto" && isStateMutating) {
      lines.push(`  // CSRF validation (compiler-generated, auth path)`);
      lines.push(`  const _scrml_sessionForCsrf = _scrml_session_middleware(_scrml_req);`);
      lines.push(`  if (!_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)) {`);
      lines.push(`    return new Response(JSON.stringify({ error: "CSRF validation failed" }), {`);
      lines.push(`      status: 403,`);
      lines.push(`      headers: { "Content-Type": "application/json" },`);
      lines.push(`    });`);
      lines.push(`  }`);
    }

    if (useBaselineCsrf) {
      lines.push(`  // Baseline CSRF: get or generate cookie token`);
      lines.push(`  const _scrml_csrf_token = _scrml_ensure_csrf_cookie(_scrml_req);`);
      lines.push(`  // CSRF validation (compiler-generated, baseline double-submit cookie)`);
      lines.push(`  if (!_scrml_validate_csrf(_scrml_req)) {`);
      // GITI-010: mint-on-403 bootstrap — include Set-Cookie so a cookie-less
      // first POST receives a token; client retries once with the new cookie.
      // _scrml_csrf_token is always valid here (existing or freshly-minted by
      // _scrml_ensure_csrf_cookie above). Re-emitting it on valid-cookie
      // requests is a no-op refresh.
      lines.push(`    return new Response(JSON.stringify({ error: "CSRF validation failed" }), {`);
      lines.push(`      status: 403,`);
      lines.push(`      headers: {`);
      lines.push(`        "Content-Type": "application/json",`);
      lines.push(`        "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\`,`);
      lines.push(`      },`);
      lines.push(`    });`);
      lines.push(`  }`);
    }

    if (useBaselineCsrf) {
      // §8.9.2: implicit per-handler transaction envelope (Tier 1 coalescing).
      // §44.6: transactions deferred to SPEC-ISSUE-018 — use sql.unsafe()
      // for BEGIN/COMMIT/ROLLBACK on the same Bun.SQL connection.
      const _envelope = needsImplicitEnvelope(name);
      // A9-Ext-4 D1 (2026-05-08): always-`!`-wrap CPS server endpoints.
      // For CPS-split functions, wrap the body in an outer try/catch that
      // serializes any thrown exception as a tagged scrml-error variant
      // (per §19.9.1 shape) with HTTP status 500. The CPS client wrapper
      // (emit-functions.ts D1 site) detects this shape and propagates it.
      const _ext4Wrap = !!route.cpsSplit;
      // A9 Ext 5 (§19.9.6): non-monotone CPS batches read the Idempotency-Key
      // header and consult the configured storage backend. On key-hit: return
      // the stored response without re-executing the body. On key-miss:
      // execute the body, store key+result, return. Monotone /
      // machine-intrinsic batches and non-CPS functions skip this layer.
      const _ext5Dedup = !!route.cpsSplit && route.cpsSplit.monotonicity === "non-monotone";
      if (_ext5Dedup) {
        lines.push(`  // A9 Ext 5: idempotency-key dedup middleware (non-monotone CPS batch)`);
        lines.push(`  const _scrml_idem_key = _scrml_req.headers.get('Idempotency-Key');`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    const _scrml_idem_hit = await _scrml_idempotency_lookup(_scrml_idem_key);`);
        lines.push(`    if (_scrml_idem_hit) {`);
        lines.push(`      return new Response(_scrml_idem_hit.response_body, {`);
        lines.push(`        status: _scrml_idem_hit.response_status,`);
        lines.push(`        headers: { "Content-Type": "application/json", "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\` },`);
        lines.push(`      });`);
        lines.push(`    }`);
        lines.push(`  }`);
      }
      if (_ext4Wrap) {
        lines.push(`  // A9-Ext-4 D1: CPS server-side error envelope`);
        lines.push(`  try {`);
      }
      if (_envelope) {
        lines.push(`  // §8.9.2 implicit per-handler transaction`);
        lines.push(`  await _scrml_sql.unsafe("BEGIN DEFERRED");`);
        lines.push(`  try {`);
      }

      lines.push(`  const _scrml_result = await (async () => {`);

      lines.push(`    const _scrml_body = await _scrml_req.json();`);

      for (let i = 0; i < paramNames.length; i++) {
        lines.push(`    const ${paramNames[i]} = _scrml_body[${JSON.stringify(paramNames[i])}];`);
      }

      // §53.9.4: Emit server-side boundary checks for predicated params (baseline CSRF path).
      for (let i = 0; i < params.length; i++) {
        const _pParam = params[i];
        const _pAnnotation = (typeof _pParam === "object" && _pParam !== null) ? (_pParam as any).typeAnnotation : null;
        if (_pAnnotation) {
          const _pParsed = parsePredicateAnnotation(_pAnnotation);
          if (_pParsed) {
            const _pLines = emitServerParamCheck(paramNames[i], _pParsed.predicate, _pParsed.label, name, "    ");
            for (const l of _pLines) lines.push(l);
          }
        }
      }

      // C18 (§38.6): if this server function is declared inside a channel
      // body, inject `broadcast(data)` / `disconnect()` as locals so the
      // user's body can call them. Functions outside any channel scope get
      // no injection — references to broadcast/disconnect there fire
      // E-CHANNEL-004 (or, today, the typer's E-SCOPE-001 fallback).
      const _ownerChannel = channelFnMap.get(name);
      if (_ownerChannel) {
        for (const l of emitBroadcastInjection(_ownerChannel, "    ")) lines.push(l);
      }

      const body: any[] = fnNode.body ?? [];
      const cpsSplit = route.cpsSplit;

      if (cpsSplit) {
        for (const idx of cpsSplit.serverStmtIndices) {
          if (idx < body.length) {
            const stmt = body[idx];
            if (stmt && stmt.kind === "state-decl" && cpsSplit.returnVarName === stmt.name) {
              // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the
              // continuation is `@x = ?{...}.method()`, the AST builder attached
              // a structured `sqlNode` so we can route through emit-logic case
              // "sql" instead of `emitExprField(initExpr, init, ...)` — which
              // would otherwise produce `/_* sql-ref:N *_/` from the SQL-placeholder
              // ExprNode that safeParseExprToNode preprocesses `?{}` into.
              if (stmt.sqlNode && stmt.sqlNode.kind === "sql") {
                const sqlStmt = serverRewriteEmitted(emitLogicNode(stmt.sqlNode, { boundary: "server" })) ?? "";
                const sqlExpr = sqlStmt.replace(/;\s*$/, "");
                lines.push(`    const _scrml_cps_return = ${sqlExpr};`);
                continue;
              }
              const initExpr = emitExprField(stmt.initExpr, stmt.init ?? "undefined", { mode: "server" });
              lines.push(`    const _scrml_cps_return = ${initExpr};`);
              continue;
            }
            const code = serverRewriteEmitted(emitLogicNode(stmt, { boundary: "server" }));
            if (code) {
              for (const line of code.split("\n")) {
                lines.push(`    ${line}`);
              }
            }
          }
        }
        if (cpsSplit.returnVarName && cpsSplit.serverStmtIndices.length > 0) {
          const lastServerIdx = cpsSplit.serverStmtIndices[cpsSplit.serverStmtIndices.length - 1];
          const lastStmt = body[lastServerIdx];
          if (lastStmt && lastStmt.kind === "state-decl" && lastStmt.name === cpsSplit.returnVarName) {
            lines.push(`    return _scrml_cps_return;`);
          } else if (lastStmt && (lastStmt.kind === "let-decl" || lastStmt.kind === "const-decl")) {
            lines.push(`    return ${lastStmt.name};`);
          } else if (lastStmt && lastStmt.kind === "bare-expr") {
            const emitted = serverRewriteEmitted(emitLogicNode(lastStmt, { boundary: "server" }));
            if (emitted) {
              const returnExpr = emitted.replace(/;$/, "");
              lines.push(`    return ${returnExpr};`);
            }
          }
        }
      } else {
        for (const stmt of body) {
          const code = serverRewriteEmitted(emitLogicNode(stmt, { boundary: "server" }));
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`    ${line}`);
            }
          }
        }
      }

      lines.push(`  })();`);
      if (_envelope) {
        lines.push(`  await _scrml_sql.unsafe("COMMIT");`);
      }
      // A9 Ext 5: store the success result under the idempotency key so a
      // retry returns the same payload without re-executing the body.
      if (_ext5Dedup) {
        lines.push(`  // A9 Ext 5: store success response under idempotency key`);
        lines.push(`  const _scrml_resp_body = JSON.stringify(_scrml_result ?? null);`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    await _scrml_idempotency_store(_scrml_idem_key, _scrml_resp_body, 200);`);
        lines.push(`  }`);
        lines.push(`  return new Response(_scrml_resp_body, {`);
      } else {
        lines.push(`  return new Response(JSON.stringify(_scrml_result ?? null), {`);
      }
      lines.push(`    status: 200,`);
      lines.push(`    headers: {`);
      lines.push(`      "Content-Type": "application/json",`);
      lines.push(`      "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\`,`);
      lines.push(`    },`);
      lines.push(`  });`);
      if (_envelope) {
        lines.push(`  } catch (_scrml_batch_err) {`);
        lines.push(`    await _scrml_sql.unsafe("ROLLBACK");`);
        lines.push(`    throw _scrml_batch_err;`);
        lines.push(`  }`);
      }
      // A9-Ext-4 D1 close: catch any thrown error from the CPS body and
      // serialize as a tagged scrml-error variant (per §19.9.1).
      if (_ext4Wrap) {
        lines.push(`  } catch (_scrml_cps_err) {`);
        lines.push(`    const _scrml_error_payload = (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error)`);
        lines.push(`      ? _scrml_cps_err`);
        lines.push(`      : { __scrml_error: true, type: "CpsError", variant: "ServerError", data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} } };`);
        lines.push(`    return new Response(JSON.stringify(_scrml_error_payload), {`);
        lines.push(`      status: 500,`);
        lines.push(`      headers: {`);
        lines.push(`        "Content-Type": "application/json",`);
        lines.push(`        "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\`,`);
        lines.push(`      },`);
        lines.push(`    });`);
        lines.push(`  }`);
      }
    } else {
      lines.push(`  const _scrml_body = await _scrml_req.json();`);

      for (let i = 0; i < paramNames.length; i++) {
        lines.push(`  const ${paramNames[i]} = _scrml_body[${JSON.stringify(paramNames[i])}];`);
      }

      // §53.9.4: Emit server-side boundary checks for predicated params (non-CSRF path).
      for (let i = 0; i < params.length; i++) {
        const _pParam = params[i];
        const _pAnnotation = (typeof _pParam === "object" && _pParam !== null) ? (_pParam as any).typeAnnotation : null;
        if (_pAnnotation) {
          const _pParsed = parsePredicateAnnotation(_pAnnotation);
          if (_pParsed) {
            const _pLines = emitServerParamCheck(paramNames[i], _pParsed.predicate, _pParsed.label, name, "  ");
            for (const l of _pLines) lines.push(l);
          }
        }
      }

      // C18 (§38.6): broadcast/disconnect injection for channel-owned server
      // functions on the non-CSRF (auth-managed) path. Mirror of the CSRF
      // path injection above.
      const _ownerChannelNonCsrf = channelFnMap.get(name);
      if (_ownerChannelNonCsrf) {
        for (const l of emitBroadcastInjection(_ownerChannelNonCsrf, "  ")) lines.push(l);
      }

      const body: any[] = fnNode.body ?? [];
      const cpsSplit = route.cpsSplit;

      // A9-Ext-4 D1 (2026-05-08): always-`!`-wrap CPS server endpoints (non-CSRF path).
      // Mirror of the useBaselineCsrf=true site above. For CPS-split functions,
      // wrap the body in an outer try/catch that returns a tagged scrml-error
      // shape on any throw (network/SQL/validation/etc).
      const _ext4WrapNonCsrf = !!cpsSplit;
      // A9 Ext 5 (§19.9.6): non-monotone CPS batches read the Idempotency-Key
      // header and consult the configured storage backend (mirror of CSRF
      // path above).
      const _ext5DedupNonCsrf = !!cpsSplit && cpsSplit.monotonicity === "non-monotone";
      if (_ext5DedupNonCsrf) {
        lines.push(`  // A9 Ext 5: idempotency-key dedup middleware (non-monotone CPS batch)`);
        lines.push(`  const _scrml_idem_key = _scrml_req.headers.get('Idempotency-Key');`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    const _scrml_idem_hit = await _scrml_idempotency_lookup(_scrml_idem_key);`);
        lines.push(`    if (_scrml_idem_hit) {`);
        lines.push(`      return new Response(_scrml_idem_hit.response_body, {`);
        lines.push(`        status: _scrml_idem_hit.response_status,`);
        lines.push(`        headers: { "Content-Type": "application/json" },`);
        lines.push(`      });`);
        lines.push(`    }`);
        lines.push(`  }`);
      }
      if (_ext4WrapNonCsrf) {
        lines.push(`  // A9-Ext-4 D1: CPS server-side error envelope`);
        lines.push(`  try {`);
      }

      // A9 Ext 5: when dedup is active, wrap body in an inner async IIFE so we
      // can capture the return value and store it under the idempotency key
      // before sending the response.
      if (_ext5DedupNonCsrf) {
        lines.push(`  const _scrml_result = await (async () => {`);
      }

      if (cpsSplit) {
        for (const idx of cpsSplit.serverStmtIndices) {
          if (idx < body.length) {
            const stmt = body[idx];
            if (stmt && stmt.kind === "state-decl" && cpsSplit.returnVarName === stmt.name) {
              // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): mirror of
              // the useBaselineCsrf=true CPS site above. Route SQL-init reactive
              // decls through emit-logic case "sql" via the structured sqlNode.
              if (stmt.sqlNode && stmt.sqlNode.kind === "sql") {
                const sqlStmt = serverRewriteEmitted(emitLogicNode(stmt.sqlNode, { boundary: "server" })) ?? "";
                const sqlExpr = sqlStmt.replace(/;\s*$/, "");
                lines.push(`    const _scrml_cps_return = ${sqlExpr};`);
                continue;
              }
              const initExpr = emitExprField(stmt.initExpr, stmt.init ?? "undefined", { mode: "server" });
              lines.push(`    const _scrml_cps_return = ${initExpr};`);
              continue;
            }
            const code = serverRewriteEmitted(emitLogicNode(stmt, { boundary: "server" }));
            if (code) {
              for (const line of code.split("\n")) {
                lines.push(`    ${line}`);
              }
            }
          }
        }
        if (cpsSplit.returnVarName && cpsSplit.serverStmtIndices.length > 0) {
          const lastServerIdx = cpsSplit.serverStmtIndices[cpsSplit.serverStmtIndices.length - 1];
          const lastStmt = body[lastServerIdx];
          if (lastStmt && lastStmt.kind === "state-decl" && lastStmt.name === cpsSplit.returnVarName) {
            lines.push(`    return _scrml_cps_return;`);
          } else if (lastStmt && (lastStmt.kind === "let-decl" || lastStmt.kind === "const-decl")) {
            lines.push(`    return ${lastStmt.name};`);
          } else if (lastStmt && lastStmt.kind === "bare-expr") {
            const emitted = serverRewriteEmitted(emitLogicNode(lastStmt, { boundary: "server" }));
            if (emitted) {
              const returnExpr = emitted.replace(/;$/, "");
              lines.push(`    return ${returnExpr};`);
            }
          }
        }
      } else {
        for (const stmt of body) {
          const code = serverRewriteEmitted(emitLogicNode(stmt, { boundary: "server" }));
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }

      // A9 Ext 5: close the inner IIFE, store the result, return as Response.
      if (_ext5DedupNonCsrf) {
        lines.push(`  })();`);
        lines.push(`  // A9 Ext 5: store success response under idempotency key`);
        lines.push(`  const _scrml_resp_body = JSON.stringify(_scrml_result ?? null);`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    await _scrml_idempotency_store(_scrml_idem_key, _scrml_resp_body, 200);`);
        lines.push(`  }`);
        lines.push(`  return new Response(_scrml_resp_body, {`);
        lines.push(`    status: 200,`);
        lines.push(`    headers: { "Content-Type": "application/json" },`);
        lines.push(`  });`);
      }

      // A9-Ext-4 D1 close: serialize any thrown error as a tagged scrml-error
      // shape so the client CPS wrapper observes a consistent §19.9.1 envelope.
      if (_ext4WrapNonCsrf) {
        lines.push(`  } catch (_scrml_cps_err) {`);
        lines.push(`    const _scrml_error_payload = (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error)`);
        lines.push(`      ? _scrml_cps_err`);
        lines.push(`      : { __scrml_error: true, type: "CpsError", variant: "ServerError", data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} } };`);
        lines.push(`    return new Response(JSON.stringify(_scrml_error_payload), {`);
        lines.push(`      status: 500,`);
        lines.push(`      headers: { "Content-Type": "application/json" },`);
        lines.push(`    });`);
        lines.push(`  }`);
      }
    }

    lines.push(`}`);
    lines.push("");

    lines.push(`export const ${routeName} = {`);
    lines.push(`  path: ${JSON.stringify(path)},`);
    lines.push(`  method: ${JSON.stringify(httpMethod)},`);
    lines.push(`  handler: ${(_scrml_hasMW || _scrml_handleNode != null) ? `_scrml_mw_wrap(${handlerName})` : handlerName},`);
    lines.push(`};`);
    lines.push("");
  }

  // §8.11 Mount-Hydration Coalescing — synthetic __mountHydrate route.
  // Emitted iff ≥2 `server @var` decls carry callable initExprs. Body awaits
  // all loaders in parallel (Promise.all) and returns a keyed JSON object.
  // Tier 1 coalescing (§8.9.2) applies automatically when the loaders share
  // this handler (sibling DGNodes) — see §8.11.2.
  if (_needsMountHydrate) {
    const mhHandlerName = "_scrml_mountHydrate_handler";
    const mhRouteName = "_scrml_route___mountHydrate";
    lines.push("// --- §8.11 synthetic __mountHydrate route (compiler-generated) ---");
    lines.push(`async function ${mhHandlerName}(_scrml_req) {`);
    // Build the list of (name, server-rewritten initExpr) pairs.
    const mhEntries: Array<{ name: string; expr: string }> = [];
    for (const decl of _mhCallableDecls) {
      const name = decl.name as string;
      const expr = emitExprField((decl as any).initExpr, (decl as any).init ?? "undefined", { mode: "server" });
      mhEntries.push({ name, expr });
    }
    // Parallel await via Promise.all — matches §8.11.2 intent.
    lines.push(`  const [${mhEntries.map((_, i) => `_scrml_mh_v${i}`).join(", ")}] = await Promise.all([`);
    for (const e of mhEntries) {
      lines.push(`    Promise.resolve(${e.expr}),`);
    }
    lines.push(`  ]);`);
    lines.push(`  return new Response(JSON.stringify({`);
    mhEntries.forEach((e, i) => {
      lines.push(`    ${JSON.stringify(e.name)}: _scrml_mh_v${i},`);
    });
    lines.push(`  }), {`);
    lines.push(`    status: 200,`);
    lines.push(`    headers: { "Content-Type": "application/json" },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
    lines.push(`export const ${mhRouteName} = {`);
    lines.push(`  path: "/__mountHydrate",`);
    lines.push(`  method: "POST",`);
    lines.push(`  handler: ${mhHandlerName},`);
    lines.push(`};`);
    lines.push("");
  }

  // Channel WebSocket infrastructure (§35)
  if (channelNodes.length > 0) {
    const wsHandlerLines = emitChannelWsHandlers(channelNodes, errors, filePath ?? "");
    for (const l of wsHandlerLines) lines.push(l);

    for (const chNode of channelNodes) {
      const chServerLines = emitChannelServerJs(
        chNode,
        errors,
        filePath ?? "",
        !!authMiddlewareEntry,
      );
      for (const l of chServerLines) lines.push(l);
    }
  }

  // S35 insight 22 — per-file WinterCG fetch handler + aggregate `routes`
  // array. Scans the just-emitted route manifest exports and appends:
  //   export const routes = [__ri_route_X, ...];
  //   export async function fetch(request) { ... }
  // Returns null on no match so the output composes with other handlers
  // via `scrml(req) ?? myApi(req)`. Does not touch CSRF inlining — Move 1
  // of Q4, CSRF stays per-handler until the scrml-server wrapper ships.
  const emitted = lines.join("\n");
  const routeNameRe = /^export const (_scrml_[A-Za-z0-9_]+|__ri_route_[A-Za-z0-9_]+) = \{\s*\n\s*path:/gm;
  const collected: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = routeNameRe.exec(emitted)) !== null) {
    collected.push(m[1]);
  }
  if (collected.length > 0) {
    lines.push("// --- S35 insight 22: aggregate routes + WinterCG fetch handler ---");
    lines.push(`export const routes = [${collected.join(", ")}];`);
    lines.push("");
    lines.push("export async function fetch(request) {");
    lines.push("  const url = new URL(request.url, 'http://localhost');");
    lines.push("  for (const r of routes) {");
    lines.push("    if (r.path === url.pathname && r.method === request.method) {");
    lines.push("      return r.handler(request);");
    lines.push("    }");
    lines.push("  }");
    lines.push("  return null;");
    lines.push("}");
    lines.push("");
  }

  // A9 Ext 5 (§19.9.6): idempotency-key storage helper inlining. When
  // `_scrml_idempotency_lookup(` / `_scrml_idempotency_store(` callsites
  // survive in the server output (they appear iff a CPS-eligible function
  // was classified non-monotone by Stage 5.5), inline the runtime helpers
  // at the top of the server module. SQL backend default; Bun.SQL via
  // _scrml_sql tag. Mirror of structural-equality inliner below; runs
  // FIRST so it's hoisted above the structural-equality block (no
  // ordering dependency, but cleaner).
  let finalEmitted = lines.join("\n");
  if (finalEmitted.includes("_scrml_idempotency_lookup(") || finalEmitted.includes("_scrml_idempotency_store(")) {
    // S79 audit fix C.1: idempotency TTL is overridable via
    // <program idempotency-ttl="..."> attribute. Default 24h (Stripe
    // convention; pre-S79 hardcoded value, preserved as default).
    // Accepted shapes: bare millis ("3600000"), or duration string with
    // ms/s/m/h/d unit suffix ("1h", "7d", "300s"). Invalid → fall back
    // to default with no diagnostic (current scope: silent fallback;
    // future v2 may add a W-MIDDLEWARE-TTL-INVALID lint).
    const ttlRaw = (middlewareConfig as { idempotencyTTL?: string | null } | null)
      ?.idempotencyTTL ?? null;
    const ttlMs = parseIdempotencyTtl(ttlRaw);
    const ttlComment = ttlRaw && ttlMs !== null
      ? `// TTL ${ttlMs}ms (overridden via <program idempotency-ttl=${JSON.stringify(ttlRaw)}>). Lazy eviction on read.`
      : "// TTL 24h (Stripe convention). Lazy eviction on read.";
    const ttlLine = ttlMs !== null
      ? `const _SCRML_IDEMPOTENCY_TTL_MS = ${ttlMs};`
      : "const _SCRML_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;";
    const helper = [
      "",
      "// --- A9 Ext 5: idempotency-key storage helpers (SPEC §19.9.6) ---",
      "// Backend: SQL shadow table _scrml_idempotency_keys via Bun.SQL (_scrml_sql).",
      ttlComment,
      ttlLine,
      "let _scrml_idempotency_table_ready = false;",
      "async function _scrml_idempotency_ensure_table() {",
      "  if (_scrml_idempotency_table_ready) return;",
      "  await _scrml_sql.unsafe(`CREATE TABLE IF NOT EXISTS _scrml_idempotency_keys (key TEXT PRIMARY KEY, response_body TEXT NOT NULL, response_status INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);",
      "  _scrml_idempotency_table_ready = true;",
      "}",
      "async function _scrml_idempotency_lookup(key) {",
      "  if (!key) return null;",
      "  await _scrml_idempotency_ensure_table();",
      "  const now = Date.now();",
      "  const rows = await _scrml_sql`SELECT response_body, response_status, expires_at FROM _scrml_idempotency_keys WHERE key = ${key} LIMIT 1`;",
      "  if (!rows || rows.length === 0) return null;",
      "  const row = rows[0];",
      "  if (row.expires_at <= now) return null;",
      "  return { response_body: row.response_body, response_status: row.response_status };",
      "}",
      "async function _scrml_idempotency_store(key, body, status) {",
      "  if (!key) return;",
      "  await _scrml_idempotency_ensure_table();",
      "  const now = Date.now();",
      "  const expires = now + _SCRML_IDEMPOTENCY_TTL_MS;",
      "  try {",
      "    await _scrml_sql`INSERT INTO _scrml_idempotency_keys (key, response_body, response_status, created_at, expires_at) VALUES (${key}, ${body}, ${status}, ${now}, ${expires})`;",
      "  } catch (_e) {",
      "    await _scrml_sql`UPDATE _scrml_idempotency_keys SET response_body = ${body}, response_status = ${status}, created_at = ${now}, expires_at = ${expires} WHERE key = ${key}`;",
      "  }",
      "}",
      "",
    ].join("\n");
    const headerEndIdx = finalEmitted.indexOf("\n\n");
    if (headerEndIdx === -1) {
      finalEmitted = helper + finalEmitted;
    } else {
      finalEmitted = finalEmitted.slice(0, headerEndIdx) + helper + finalEmitted.slice(headerEndIdx);
    }
  }

  // GITI-012 / fix-server-eq-helper-import: structural-equality helper inlining.
  // SPEC §45 emits \`_scrml_structural_eq(a, b)\` for any \`==\`/\`!=\` whose operands
  // aren't statically primitive (see emit-expr.ts). The helper lives in the
  // client runtime; .server.js never imports it. If any callsite survived the
  // primitive shortcut, inline the helper at the top of the server module so
  // the reference resolves at runtime.
  if (finalEmitted.includes("_scrml_structural_eq(")) {
    const helper = [
      "",
      "// --- §45 Structural equality helper (inlined for server, no client runtime here) ---",
      "function _scrml_structural_eq(a, b) {",
      "  if (a === b) return true;",
      "  if (a === null || b === null || a === undefined || b === undefined) return false;",
      "  if (typeof a !== typeof b) return false;",
      "  if (typeof a !== \"object\") return a === b;",
      "  if (Array.isArray(a)) {",
      "    if (!Array.isArray(b) || a.length !== b.length) return false;",
      "    for (let i = 0; i < a.length; i++) {",
      "      if (!_scrml_structural_eq(a[i], b[i])) return false;",
      "    }",
      "    return true;",
      "  }",
      "  if (a._tag !== undefined && b._tag !== undefined) {",
      "    if (a._tag !== b._tag) return false;",
      "    const aKeys = Object.keys(a);",
      "    const bKeys = Object.keys(b);",
      "    if (aKeys.length !== bKeys.length) return false;",
      "    for (const key of aKeys) {",
      "      if (key === \"_tag\") continue;",
      "      if (!_scrml_structural_eq(a[key], b[key])) return false;",
      "    }",
      "    return true;",
      "  }",
      "  const aKeys = Object.keys(a);",
      "  const bKeys = Object.keys(b);",
      "  if (aKeys.length !== bKeys.length) return false;",
      "  for (const key of aKeys) {",
      "    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;",
      "    if (!_scrml_structural_eq(a[key], b[key])) return false;",
      "  }",
      "  return true;",
      "}",
      "",
    ].join("\n");
    // Inject AFTER the file header + imports block so the helper is hoisted
    // above any function that might call it. The marker we insert at is the
    // first blank line that follows the imports (which the emitter places at
    // line 123-ish via \`lines.push("")\` after the import loop).
    const headerEndIdx = finalEmitted.indexOf("\n\n");
    if (headerEndIdx === -1) {
      return helper + finalEmitted;
    }
    return finalEmitted.slice(0, headerEndIdx) + helper + finalEmitted.slice(headerEndIdx);
  }
  return finalEmitted;
}
