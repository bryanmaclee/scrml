// ===========================================================================
// SECTION: emit-functions (from emit-functions.ts)
// ===========================================================================
//
// emitFunctions — client-side function stubs + CPS split wrappers
//
// Generates fetch/EventSource stubs for server-boundary functions,
// CPS client wrappers for split functions, and client-side function bodies.

export function emitFunctions(ctx) {
    const { filePath, routeMap, depGraph, errors, csrfEnabled } = ctx
    const fnNodes = (ctx.analysis?.fnNodes ?? collectFunctions(ctx.fileAST))
    const lines = []

    // Map from original function name -> generated var name.
    const fnNameMap = new Map()

    // Map from original function name -> generated fetch stub var name.
    const serverFnStubs = new Map()

    // -------------------------------------------------------------------------
    // Step 1: Generate fetch/EventSource stubs for server-boundary functions
    // -------------------------------------------------------------------------
    for (const fnNode of fnNodes) {
        const fnNodeId = filePath + "::" + (fnNode.span?.start)
        const route = routeMap.functions.get(fnNodeId)
        if (!route || route.boundary != "server") continue

        if (!route.generatedRouteName) continue // error already recorded in server gen

        const name = fnNode.name ?? "anon"
        const routeName = route.generatedRouteName
        const path = route.explicitRoute ? route.explicitRoute : routePath(routeName)

        // §36: SSE EventSource stub for server function* generators
        if (route.isSSE) {
            const sseStubName = genVar("sse_" + name)
            serverFnStubs.set(name, sseStubName)
            fnNameMap.set(name, sseStubName)

            lines.push("function " + sseStubName + "(_scrml_onMessage, _scrml_onEvent) {")
            lines.push("  const _scrml_es = new EventSource(" + JSON.stringify(path) + ");")
            lines.push("  _scrml_es.onmessage = function(_scrml_e) {")
            lines.push("    try {")
            lines.push("      const _scrml_data = JSON.parse(_scrml_e.data);")
            lines.push("      if (typeof _scrml_onMessage === 'function') _scrml_onMessage(_scrml_data);")
            lines.push("    } catch (_scrml_err) { /* malformed SSE data */ }")
            lines.push("  };")
            lines.push("  _scrml_es.onerror = function() { /* EventSource auto-reconnects */ };")
            lines.push("  // Auto-cleanup: close EventSource when scope is destroyed (§36.5)")
            lines.push("  if (typeof _scrml_cleanup_register === 'function') {")
            lines.push("    _scrml_cleanup_register(() => _scrml_es.close());")
            lines.push("  }")
            lines.push("  return _scrml_es;")
            lines.push("}")
            lines.push("")
            continue
        }

        const httpMethod = route.explicitMethod ?? "POST"
        const params = fnNode.params ?? []
        // Strip :Type annotations from string params (e.g. "mario:Mario" -> "mario")
        const paramNames = params.map(function(p, i) {
            return typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? ("_scrml_arg_" + i))
        })

        const stubName = genVar("fetch_" + name)
        serverFnStubs.set(name, stubName)
        // Map original name -> fetch stub (CPS step 2 may override)
        fnNameMap.set(name, stubName)

        lines.push("async function " + stubName + "(" + paramNames.join(", ") + ") {")
        lines.push("  const _scrml_resp = await fetch(" + JSON.stringify(path) + ", {")
        lines.push("    method: " + JSON.stringify(httpMethod) + ",")
        if (csrfEnabled && httpMethod != "GET" && httpMethod != "HEAD") {
            lines.push("    headers: { \"Content-Type\": \"application/json\", \"X-CSRF-Token\": _scrml_get_csrf_token() },")
        } else {
            lines.push("    headers: { \"Content-Type\": \"application/json\" },")
        }
        lines.push("    body: JSON.stringify({")
        for (const p of paramNames) {
            lines.push("      " + JSON.stringify(p) + ": " + p + ",")
        }
        lines.push("    }),")
        lines.push("  });")
        lines.push("  return _scrml_resp.json();")
        lines.push("}")
        lines.push("")
    }

    // -------------------------------------------------------------------------
    // Step 2: Generate CPS client wrappers for server functions with cpsSplit
    // -------------------------------------------------------------------------
    for (const fnNode of fnNodes) {
        const fnNodeId = filePath + "::" + (fnNode.span?.start)
        const route = routeMap.functions.get(fnNodeId)
        if (!route || route.boundary != "server" || !route.cpsSplit) continue

        const name = fnNode.name ?? "anon"
        const stubName = serverFnStubs.get(name)
        const cpsSplit = route.cpsSplit
        const body = fnNode.body ?? []
        const params = fnNode.params ?? []
        const paramNames = params.map(function(p, i) {
            return typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? ("_scrml_arg_" + i))
        })

        const wrapperName = genVar("cps_" + name)
        fnNameMap.set(name, wrapperName)
        lines.push("async function " + wrapperName + "(" + paramNames.join(", ") + ") {")

        let serverCallEmitted = false
        const cpsOpts = { declaredNames: new Set() }
        for (let i = 0; i < body.length; i++) {
            const stmt = body[i]
            if (!stmt) continue

            if (cpsSplit.serverStmtIndices.includes(i)) {
                if (!serverCallEmitted && stubName) {
                    if (cpsSplit.returnVarName) {
                        lines.push("  const _scrml_server_result = await " + stubName + "(" + paramNames.join(", ") + ");")
                    } else {
                        lines.push("  await " + stubName + "(" + paramNames.join(", ") + ");")
                    }
                    serverCallEmitted = true
                }
                if (cpsSplit.returnVarName && stmt.kind == "state-decl" && stmt.name == cpsSplit.returnVarName) {
                    lines.push("  _scrml_reactive_set(" + JSON.stringify(stmt.name) + ", _scrml_server_result);")
                }
            } else {
                if (isServerOnlyNode(stmt)) {
                    errors.push(new CGError(
                        "E-CG-006",
                        "E-CG-006: " + stmt.kind + " node found in CPS client wrapper for `" + name + "`. " +
                        "Server-only constructs must not reach client output. RI invariant violation.",
                        (stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }),
                    ))
                    continue
                }
                if (cpsSplit.returnVarName && stmt.kind == "state-decl" && stmt.name == cpsSplit.returnVarName) {
                    lines.push("  _scrml_reactive_set(" + JSON.stringify(stmt.name) + ", _scrml_server_result);")
                } else {
                    const code = emitLogicNode(stmt, cpsOpts)
                    if (code) {
                        for (const line of code.split("\n")) {
                            lines.push("  " + line)
                        }
                    }
                }
            }
        }

        lines.push("}")
        lines.push("")
    }

    // -------------------------------------------------------------------------
    // Step 3: Generate client-side function bodies for client-boundary functions
    // -------------------------------------------------------------------------
    for (const fnNode of fnNodes) {
        const fnNodeId = filePath + "::" + (fnNode.span?.start)
        const route = routeMap.functions.get(fnNodeId)
        if (route && route.boundary == "server") continue
        if (fnNode.isHandleEscapeHatch) continue

        const name = fnNode.name ?? "anon"
        const params = fnNode.params ?? []
        const paramNames = params.map(function(p, i) {
            return typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? ("_scrml_arg_" + i))
        })

        const hasServerCalls = hasServerCallees(fnNode, routeMap, filePath)
        const asyncPrefix = hasServerCalls ? "async " : ""

        const generatedName = genVar(name)
        fnNameMap.set(name, generatedName)

        lines.push(asyncPrefix + "function " + generatedName + "(" + paramNames.join(", ") + ") {")

        const body = fnNode.body ?? []
        const scheduled = scheduleStatements(body, fnNode, routeMap, depGraph, filePath, errors)
        for (const line of scheduled) {
            lines.push("  " + line)
        }

        lines.push("}")
        lines.push("")
    }

    return { lines, fnNameMap }
}

// ===========================================================================
// SECTION: emit-server (from emit-server.ts)
// ===========================================================================
//
// generateServerJs — server-side route handler emission
//
// Generates Bun/Node route handler modules for all server-boundary functions,
// SSE generators, auth/CSRF middleware, §39 compiler-auto middleware, and
// channel WebSocket infrastructure.

export function generateServerJs(ctxOrFileAST, routeMapLegacy, errorsLegacy, authMiddlewareLegacy, middlewareConfigLegacy) {
    // Support both new (ctx) and legacy (fileAST, routeMap, errors, authMW, mwConfig) signatures
    let fileAST
    let routeMap
    let errors
    let authMiddlewareEntry
    let middlewareConfig
    const ctxForCache =
        (ctxOrFileAST && "fileAST" in ctxOrFileAST && "registry" in ctxOrFileAST)
            ? ctxOrFileAST : null
    if (ctxForCache) {
        fileAST = ctxForCache.fileAST
        routeMap = ctxForCache.routeMap
        errors = ctxForCache.errors
        authMiddlewareEntry = ctxForCache.authMiddleware
        middlewareConfig = ctxForCache.middlewareConfig
    } else {
        fileAST = ctxOrFileAST
        routeMap = routeMapLegacy
        errors = errorsLegacy ?? []
        authMiddlewareEntry = authMiddlewareLegacy ?? null
        middlewareConfig = middlewareConfigLegacy ?? null
    }
    const filePath = fileAST.filePath
    const fnNodes = ctxForCache?.analysis?.fnNodes ?? collectFunctions(fileAST)
    const serverFns = []

    for (const fnNode of fnNodes) {
        const fnNodeId = filePath + "::" + fnNode.span.start
        const route = routeMap.functions.get(fnNodeId)
        if (!route || route.boundary != "server") continue

        if (!route.generatedRouteName) {
            errors.push(new CGError(
                "E-CG-002",
                "E-CG-002: Server-boundary function `" + (fnNode.name ?? "<anonymous>") + "` has no " +
                "generated route name. This indicates an RI invariant violation.",
                fnNode.span,
            ))
            continue
        }

        serverFns.push({ fnNode, route })
    }

    const _scrml_handleNodeEarly = fnNodes.find(function(fn) { return fn.isHandleEscapeHatch }) ?? null

    const channelNodes = ctxForCache?.analysis?.channelNodes ?? collectChannelNodes(getNodes(fileAST))
    if (serverFns.length == 0 && !authMiddlewareEntry && channelNodes.length == 0 && !middlewareConfig && !_scrml_handleNodeEarly) return ""

    const lines = []
    lines.push("// Generated server route handlers")
    lines.push("// This file is compiler IR — not meant for direct consumption.")
    lines.push("")

    // Emit JS imports from use-decl and import-decl nodes (§40)
    const allImports = fileAST?.ast?.imports ?? fileAST?.imports ?? []
    for (const stmt of allImports) {
        if ((stmt.kind == "import-decl" || stmt.kind == "use-decl") && stmt.source && stmt.names?.length > 0) {
            const names = stmt.names.join(", ")
            if (stmt.isDefault) {
                lines.push("import " + names + " from " + JSON.stringify(stmt.source) + ";")
            } else {
                lines.push("import { " + names + " } from " + JSON.stringify(stmt.source) + ";")
            }
        }
    }
    lines.push("")

    // Session/auth middleware (Option C hybrid)
    if (authMiddlewareEntry) {
        const { loginRedirect, csrf, sessionExpiry } = authMiddlewareEntry

        lines.push("// --- Session middleware (compiler-generated) ---")
        lines.push("const _scrml_session_expiry = " + JSON.stringify(sessionExpiry) + ";")
        lines.push("")
        lines.push("function _scrml_session_middleware(req) {")
        lines.push("  const cookieHeader = req.headers.get('Cookie') || '';")
        lines.push("  const sessionId = cookieHeader.match(/scrml_sid=([^;]+)/)?.[1] || null;")
        lines.push("  return { sessionId, isAuth: !!sessionId };")
        lines.push("}")
        lines.push("")

        lines.push("// --- Auth check middleware ---")
        lines.push("function _scrml_auth_check(req) {")
        lines.push("  const session = _scrml_session_middleware(req);")
        lines.push("  if (!session.isAuth) {")
        lines.push("    return new Response(null, {")
        lines.push("      status: 302,")
        lines.push("      headers: { Location: " + JSON.stringify(loginRedirect) + " },")
        lines.push("    });")
        lines.push("  }")
        lines.push("  return null;")
        lines.push("}")
        lines.push("")

        if (csrf == "auto") {
            lines.push("// --- CSRF token generation and validation ---")
            lines.push("function _scrml_generate_csrf() {")
            lines.push("  return crypto.randomUUID();")
            lines.push("}")
            lines.push("")
            lines.push("function _scrml_validate_csrf(req, session) {")
            lines.push("  const token = req.headers.get('X-CSRF-Token') || '';")
            lines.push("  return token === session.csrfToken;")
            lines.push("}")
            lines.push("")
        }

        lines.push("// --- session.destroy() handler ---")
        lines.push("export const _scrml_session_destroy = {")
        lines.push("  path: \"/_scrml/session/destroy\",")
        lines.push("  method: \"POST\",")
        lines.push("  handler: async function(_scrml_req) {")
        lines.push("    return new Response(JSON.stringify({ ok: true }), {")
        lines.push("      status: 200,")
        lines.push("      headers: {")
        lines.push("        'Set-Cookie': 'scrml_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',")
        lines.push("        'Content-Type': 'application/json',")
        lines.push("      },")
        lines.push("    });")
        lines.push("  },")
        lines.push("};")
        lines.push("")
    }

    // Baseline CSRF protection
    const hasStateMutatingRoutes = serverFns.some(function(sf) {
        const m = sf.route.explicitMethod ?? "POST"
        return m != "GET" && m != "HEAD"
    })

    if (!authMiddlewareEntry && hasStateMutatingRoutes) {
        lines.push("// --- Baseline CSRF protection (compiler-generated, double-submit cookie) ---")
        lines.push("function _scrml_ensure_csrf_cookie(req) {")
        lines.push("  const cookieHeader = req.headers.get('Cookie') || '';")
        lines.push("  const existing = cookieHeader.match(/scrml_csrf=([^;]+)/)?.[1] || null;")
        lines.push("  return existing || crypto.randomUUID();")
        lines.push("}")
        lines.push("")
        lines.push("function _scrml_validate_csrf(req) {")
        lines.push("  const cookieHeader = req.headers.get('Cookie') || '';")
        lines.push("  const cookieToken = cookieHeader.match(/scrml_csrf=([^;]+)/)?.[1] || '';")
        lines.push("  const headerToken = req.headers.get('X-CSRF-Token') || '';")
        lines.push("  return cookieToken.length > 0 && cookieToken === headerToken;")
        lines.push("}")
        lines.push("")
    }

    // §39 Compiler-auto middleware infrastructure
    const _scrml_hasMW = middlewareConfig != null
    const _scrml_hasCors = _scrml_hasMW && middlewareConfig.cors != null
    const _scrml_hasLog = _scrml_hasMW && middlewareConfig.log != null && middlewareConfig.log != 'off'
    const _scrml_hasCsrfMW = _scrml_hasMW && middlewareConfig.csrf == 'on'
    const _scrml_hasRatelimit = _scrml_hasMW && middlewareConfig.ratelimit != null
    const _scrml_hasSecureHeaders = _scrml_hasMW && middlewareConfig.headers == 'strict'
    const _scrml_handleNode = _scrml_handleNodeEarly

    if (_scrml_hasMW || _scrml_handleNode) {
        lines.push("// --- §39 Compiler-auto middleware infrastructure ---")
        lines.push("")

        if (_scrml_hasCors) {
            const corsOrigin = JSON.stringify(middlewareConfig.cors)
            lines.push("// §39.2.1 CORS helpers")
            lines.push("function _scrml_cors_headers() {")
            lines.push("  return {")
            lines.push("    'Access-Control-Allow-Origin': " + corsOrigin + ",")
            lines.push("    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',")
            lines.push("    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Authorization',")
            lines.push("    'Access-Control-Max-Age': '86400',")
            lines.push("  };")
            lines.push("}")
            lines.push("export const _scrml_cors_options_route = {")
            lines.push("  path: '/*',")
            lines.push("  method: 'OPTIONS',")
            lines.push("  handler: function(_scrml_req) {")
            lines.push("    return new Response(null, { status: 204, headers: _scrml_cors_headers() });")
            lines.push("  },")
            lines.push("};")
            lines.push("")
        }

        if (_scrml_hasRatelimit) {
            const parts = middlewareConfig.ratelimit.split('/')
            const limit = parseInt(parts[0], 10)
            const unit = parts[1]
            const windowMs = unit == 'sec' ? 1000 : unit == 'min' ? 60000 : 3600000
            lines.push("// §39.2.4 Rate limiter (in-memory sliding window, per IP)")
            lines.push("const _scrml_rate_map = new Map();")
            lines.push("const _scrml_rate_limit = " + limit + ";")
            lines.push("const _scrml_rate_window = " + windowMs + ";")
            lines.push("function _scrml_check_ratelimit(req) {")
            lines.push("  const forwarded = req.headers.get('x-forwarded-for');")
            lines.push("  const ip = forwarded ? forwarded.split(',')[0].trim()")
            lines.push("    : (typeof Bun !== 'undefined' && Bun.requestIP ? (Bun.requestIP(req)?.address ?? 'unknown') : 'unknown');")
            lines.push("  const now = Date.now();")
            lines.push("  const windowStart = now - _scrml_rate_window;")
            lines.push("  const hits = (_scrml_rate_map.get(ip) ?? []).filter(t => t > windowStart);")
            lines.push("  hits.push(now);")
            lines.push("  _scrml_rate_map.set(ip, hits);")
            lines.push("  if (hits.length > _scrml_rate_limit) {")
            lines.push("    const retryAfter = Math.ceil(_scrml_rate_window / 1000);")
            lines.push("    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {")
            lines.push("      status: 429,")
            lines.push("      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },")
            lines.push("    });")
            lines.push("  }")
            lines.push("  return null;")
            lines.push("}")
            lines.push("")
        }

        if (_scrml_hasSecureHeaders) {
            lines.push("// §39.2.5 Security headers")
            lines.push("function _scrml_apply_security_headers(response) {")
            lines.push("  response.headers.set('X-Content-Type-Options', 'nosniff');")
            lines.push("  response.headers.set('X-Frame-Options', 'SAMEORIGIN');")
            lines.push("  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');")
            lines.push("  response.headers.set('Content-Security-Policy', \"default-src 'self'\");")
            lines.push("  return response;")
            lines.push("}")
            lines.push("")
        }

        if (_scrml_hasLog) {
            const logMode = middlewareConfig.log
            lines.push("// §39.2.2 Request/response logging")
            lines.push("function _scrml_log_request(method, path, status, ms) {")
            if (logMode == 'structured') {
                lines.push("  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), method, path, status, ms }) + '\\n');")
            } else {
                lines.push("  process.stdout.write(method + ' ' + path + ' ' + status + ' ' + ms + 'ms\\n');")
            }
            lines.push("}")
            lines.push("")
        }

        lines.push("// §39 Middleware pipeline wrapper")
        lines.push("// Pipeline: CORS -> rate-limit -> handle() PRE -> CSRF -> route -> handle() POST -> headers -> logging")
        lines.push("function _scrml_mw_wrap(routeHandler) {")
        lines.push("  return async function _scrml_mw_handler(_scrml_mw_req) {")

        if (_scrml_hasLog) {
            lines.push("    const _scrml_mw_t0 = Date.now();")
        }

        if (_scrml_hasRatelimit) {
            lines.push("    const _scrml_rl = _scrml_check_ratelimit(_scrml_mw_req);")
            lines.push("    if (_scrml_rl) return _scrml_rl;")
        }

        if (_scrml_handleNode) {
            const handleBody = _scrml_handleNode.body ?? []

            lines.push("    // handle() escape hatch body (§39.3) — wrapped in IIFE for return capture")
            lines.push("    const _scrml_mw_result = await (async () => {")

            lines.push("      // resolve() = CSRF check + route dispatch")
            lines.push("      const resolve = async (_scrml_resolve_req) => {")
            if (_scrml_hasCsrfMW) {
                lines.push("        const _scrml_m = _scrml_resolve_req.method.toUpperCase();")
                lines.push("        const _scrml_is_mut = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(_scrml_m);")
                lines.push("        if (_scrml_is_mut) {")
                lines.push("          const _scrml_ck = _scrml_resolve_req.headers.get('Cookie') ?? '';")
                lines.push("          const _scrml_ct = (_scrml_ck.match(/scrml_csrf=([^;]+)/)?.[1]) ?? '';")
                lines.push("          const _scrml_ch = _scrml_resolve_req.headers.get('X-CSRF-Token') ?? '';")
                lines.push("          if (!_scrml_ct || _scrml_ct !== _scrml_ch) {")
                lines.push("            return new Response(JSON.stringify({ error: 'CSRF validation failed' }), {")
                lines.push("              status: 403,")
                lines.push("              headers: { 'Content-Type': 'application/json' },")
                lines.push("            });")
                lines.push("          }")
                lines.push("        }")
            }
            lines.push("        return routeHandler(_scrml_resolve_req);")
            lines.push("      };")

            const handleParams = _scrml_handleNode.params ?? []
            const requestParamName = typeof handleParams[0] === 'string' ? handleParams[0] : 'request'

            if (requestParamName != '_scrml_mw_req') {
                lines.push("      const " + requestParamName + " = _scrml_mw_req;")
            }

            for (const stmt of handleBody) {
                const code = emitLogicNode(stmt)
                if (code) {
                    for (const line of code.split('\n')) lines.push('      ' + line)
                }
            }

            lines.push("    })();")
        } else {
            lines.push("    // No handle() — direct route dispatch")
            if (_scrml_hasCsrfMW) {
                lines.push("    const _scrml_m = _scrml_mw_req.method.toUpperCase();")
                lines.push("    const _scrml_is_mut = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(_scrml_m);")
                lines.push("    if (_scrml_is_mut) {")
                lines.push("      const _scrml_ck = _scrml_mw_req.headers.get('Cookie') ?? '';")
                lines.push("      const _scrml_ct = (_scrml_ck.match(/scrml_csrf=([^;]+)/)?.[1]) ?? '';")
                lines.push("      const _scrml_ch = _scrml_mw_req.headers.get('X-CSRF-Token') ?? '';")
                lines.push("      if (!_scrml_ct || _scrml_ct !== _scrml_ch) {")
                lines.push("        return new Response(JSON.stringify({ error: 'CSRF validation failed' }), {")
                lines.push("          status: 403,")
                lines.push("          headers: { 'Content-Type': 'application/json' },")
                lines.push("        });")
                lines.push("      }")
                lines.push("    }")
            }
            lines.push("    const _scrml_mw_result = await routeHandler(_scrml_mw_req);")
        }

        if (_scrml_hasSecureHeaders) {
            lines.push("    if (_scrml_mw_result instanceof Response) _scrml_apply_security_headers(_scrml_mw_result);")
        }

        if (_scrml_hasCors) {
            lines.push("    if (_scrml_mw_result instanceof Response) {")
            lines.push("      const _scrml_cors_h = _scrml_cors_headers();")
            lines.push("      for (const [k, v] of Object.entries(_scrml_cors_h)) {")
            lines.push("        _scrml_mw_result.headers.set(k, v);")
            lines.push("      }")
            lines.push("    }")
        }

        if (_scrml_hasLog) {
            lines.push("    const _scrml_mw_status = _scrml_mw_result instanceof Response ? _scrml_mw_result.status : 200;")
            lines.push("    _scrml_log_request(_scrml_mw_req.method, new URL(_scrml_mw_req.url, 'http://localhost').pathname, _scrml_mw_status, Date.now() - _scrml_mw_t0);")
        }

        lines.push("    return _scrml_mw_result;")
        lines.push("  };")
        lines.push("}")
        lines.push("")
    }

    for (const { fnNode, route } of serverFns) {
        const name = fnNode.name ?? "anon"
        const routeName = route.generatedRouteName
        const path = route.explicitRoute ? route.explicitRoute : routePath(routeName)
        const params = fnNode.params ?? []
        const paramNames = params.map(function(p, i) {
            return typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? ("_scrml_arg_" + i))
        })

        // §36: SSE handler — server function* generators emit text/event-stream GET
        if (route.isSSE) {
            const handlerName = genVar("handler_" + name)
            const body = fnNode.body ?? []

            lines.push("async function " + handlerName + "(_scrml_req) {")

            lines.push("  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');")
            lines.push("  const route = {")
            lines.push("    query: Object.fromEntries(_scrml_url.searchParams),")
            lines.push("    lastEventId: _scrml_req.headers.get('Last-Event-ID') ?? null,")
            lines.push("  };")

            if (authMiddlewareEntry) {
                lines.push("  // Auth check for SSE endpoint (compiler-generated)")
                lines.push("  const _scrml_authResult = _scrml_auth_check(_scrml_req);")
                lines.push("  if (_scrml_authResult) return _scrml_authResult;")
            }

            lines.push("  const _scrml_enc = new TextEncoder();")
            lines.push("  const _scrml_stream = new ReadableStream({")
            lines.push("    async start(_scrml_ctrl) {")
            lines.push("      try {")
            lines.push("        async function* _scrml_gen() {")

            for (const stmt of body) {
                const code = emitLogicNode(stmt)
                if (code) {
                    for (const line of code.split("\n")) {
                        lines.push("          " + line)
                    }
                }
            }

            lines.push("        }")
            lines.push("        for await (const _scrml_val of _scrml_gen()) {")
            lines.push("          const _scrml_hasEvent = _scrml_val && typeof _scrml_val === 'object' && 'event' in _scrml_val && 'data' in _scrml_val;")
            lines.push("          let _scrml_chunk = '';")
            lines.push("          if (_scrml_hasEvent) {")
            lines.push("            _scrml_chunk += `event: ${_scrml_val.event}\\n`;")
            lines.push("            if (_scrml_val.id != null) _scrml_chunk += `id: ${_scrml_val.id}\\n`;")
            lines.push("            _scrml_chunk += `data: ${JSON.stringify(_scrml_val.data)}\\n\\n`;")
            lines.push("          } else {")
            lines.push("            if (_scrml_val && typeof _scrml_val === 'object' && 'id' in _scrml_val) {")
            lines.push("              _scrml_chunk += `id: ${_scrml_val.id}\\n`;")
            lines.push("            }")
            lines.push("            _scrml_chunk += `data: ${JSON.stringify(_scrml_val)}\\n\\n`;")
            lines.push("          }")
            lines.push("          _scrml_ctrl.enqueue(_scrml_enc.encode(_scrml_chunk));")
            lines.push("        }")
            lines.push("      } catch (_scrml_err) {")
            lines.push("        // Stream error — close the controller")
            lines.push("      } finally {")
            lines.push("        _scrml_ctrl.close();")
            lines.push("      }")
            lines.push("    },")
            lines.push("    cancel() { /* client disconnected — cleanup handled in finally */ },")
            lines.push("  });")
            lines.push("  return new Response(_scrml_stream, {")
            lines.push("    headers: {")
            lines.push("      'Content-Type': 'text/event-stream',")
            lines.push("      'Cache-Control': 'no-cache',")
            lines.push("      'Connection': 'keep-alive',")
            lines.push("    },")
            lines.push("  });")
            lines.push("}")
            lines.push("")

            const mwWrap = (_scrml_hasMW || _scrml_handleNode != null)
                ? "_scrml_mw_wrap(" + handlerName + ")"
                : handlerName
            lines.push("export const " + routeName + " = {")
            lines.push("  path: " + JSON.stringify(path) + ",")
            lines.push("  method: \"GET\",")
            lines.push("  handler: " + mwWrap + ",")
            lines.push("};")
            lines.push("")

            continue
        }

        const httpMethod = route.explicitMethod ?? "POST"
        const isStateMutating = httpMethod != "GET" && httpMethod != "HEAD"
        const useBaselineCsrf = !authMiddlewareEntry && isStateMutating

        const handlerName = genVar("handler_" + name)
        lines.push("async function " + handlerName + "(_scrml_req) {")

        lines.push("  // route.query injection (SPEC §20.3)")
        lines.push("  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');")
        lines.push("  const route = { query: Object.fromEntries(_scrml_url.searchParams) };")

        if (authMiddlewareEntry && isStateMutating) {
            lines.push("  // Auth check (compiler-generated)")
            lines.push("  const _scrml_authResult = _scrml_auth_check(_scrml_req);")
            lines.push("  if (_scrml_authResult) return _scrml_authResult;")
        }

        if (authMiddlewareEntry?.csrf == "auto" && isStateMutating) {
            lines.push("  // CSRF validation (compiler-generated, auth path)")
            lines.push("  const _scrml_sessionForCsrf = _scrml_session_middleware(_scrml_req);")
            lines.push("  if (!_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)) {")
            lines.push("    return new Response(JSON.stringify({ error: \"CSRF validation failed\" }), {")
            lines.push("      status: 403,")
            lines.push("      headers: { \"Content-Type\": \"application/json\" },")
            lines.push("    });")
            lines.push("  }")
        }

        if (useBaselineCsrf) {
            lines.push("  // Baseline CSRF: get or generate cookie token")
            lines.push("  const _scrml_csrf_token = _scrml_ensure_csrf_cookie(_scrml_req);")
            lines.push("  // CSRF validation (compiler-generated, baseline double-submit cookie)")
            lines.push("  if (!_scrml_validate_csrf(_scrml_req)) {")
            lines.push("    return new Response(JSON.stringify({ error: \"CSRF validation failed\" }), {")
            lines.push("      status: 403,")
            lines.push("      headers: { \"Content-Type\": \"application/json\" },")
            lines.push("    });")
            lines.push("  }")
        }

        if (useBaselineCsrf) {
            lines.push("  const _scrml_result = await (async () => {")
            lines.push("    const _scrml_body = await _scrml_req.json();")

            for (let i = 0; i < paramNames.length; i++) {
                lines.push("    const " + paramNames[i] + " = _scrml_body[" + JSON.stringify(paramNames[i]) + "];")
            }

            const body = fnNode.body ?? []
            const cpsSplit = route.cpsSplit

            if (cpsSplit) {
                for (const idx of cpsSplit.serverStmtIndices) {
                    if (idx < body.length) {
                        const stmt = body[idx]
                        if (stmt && stmt.kind == "state-decl" && cpsSplit.returnVarName == stmt.name) {
                            const initExpr = rewriteServerExpr(stmt.init ?? "undefined")
                            lines.push("    const _scrml_cps_return = " + initExpr + ";")
                            continue
                        }
                        const code = serverRewriteEmitted(emitLogicNode(stmt))
                        if (code) {
                            for (const line of code.split("\n")) {
                                lines.push("    " + line)
                            }
                        }
                    }
                }
                if (cpsSplit.returnVarName && cpsSplit.serverStmtIndices.length > 0) {
                    const lastServerIdx = cpsSplit.serverStmtIndices[cpsSplit.serverStmtIndices.length - 1]
                    const lastStmt = body[lastServerIdx]
                    if (lastStmt && lastStmt.kind == "state-decl" && lastStmt.name == cpsSplit.returnVarName) {
                        lines.push("    return _scrml_cps_return;")
                    } else if (lastStmt && (lastStmt.kind == "let-decl" || lastStmt.kind == "const-decl")) {
                        lines.push("    return " + lastStmt.name + ";")
                    } else if (lastStmt && lastStmt.kind == "bare-expr") {
                        const emitted = serverRewriteEmitted(emitLogicNode(lastStmt))
                        if (emitted) {
                            const returnExpr = emitted.replace(/;$/, "")
                            lines.push("    return " + returnExpr + ";")
                        }
                    }
                }
            } else {
                for (const stmt of body) {
                    const code = serverRewriteEmitted(emitLogicNode(stmt))
                    if (code) {
                        for (const line of code.split("\n")) {
                            lines.push("    " + line)
                        }
                    }
                }
            }

            lines.push("  })();")
            lines.push("  return new Response(JSON.stringify(_scrml_result ?? null), {")
            lines.push("    status: 200,")
            lines.push("    headers: {")
            lines.push("      \"Content-Type\": \"application/json\",")
            // NOTE: template literal with ${ in output — must escape the $ to avoid interpolation
            lines.push("      \"Set-Cookie\": `scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict`,")
            lines.push("    },")
            lines.push("  });")
        } else {
            lines.push("  const _scrml_body = await _scrml_req.json();")

            for (let i = 0; i < paramNames.length; i++) {
                lines.push("  const " + paramNames[i] + " = _scrml_body[" + JSON.stringify(paramNames[i]) + "];")
            }

            const body = fnNode.body ?? []
            const cpsSplit = route.cpsSplit

            if (cpsSplit) {
                for (const idx of cpsSplit.serverStmtIndices) {
                    if (idx < body.length) {
                        const stmt = body[idx]
                        if (stmt && stmt.kind == "state-decl" && cpsSplit.returnVarName == stmt.name) {
                            const initExpr = rewriteServerExpr(stmt.init ?? "undefined")
                            lines.push("  const _scrml_cps_return = " + initExpr + ";")
                            continue
                        }
                        const code = serverRewriteEmitted(emitLogicNode(stmt))
                        if (code) {
                            for (const line of code.split("\n")) {
                                lines.push("  " + line)
                            }
                        }
                    }
                }
                if (cpsSplit.returnVarName && cpsSplit.serverStmtIndices.length > 0) {
                    const lastServerIdx = cpsSplit.serverStmtIndices[cpsSplit.serverStmtIndices.length - 1]
                    const lastStmt = body[lastServerIdx]
                    if (lastStmt && lastStmt.kind == "state-decl" && lastStmt.name == cpsSplit.returnVarName) {
                        lines.push("  return _scrml_cps_return;")
                    } else if (lastStmt && (lastStmt.kind == "let-decl" || lastStmt.kind == "const-decl")) {
                        lines.push("  return " + lastStmt.name + ";")
                    } else if (lastStmt && lastStmt.kind == "bare-expr") {
                        const emitted = serverRewriteEmitted(emitLogicNode(lastStmt))
                        if (emitted) {
                            const returnExpr = emitted.replace(/;$/, "")
                            lines.push("  return " + returnExpr + ";")
                        }
                    }
                }
            } else {
                for (const stmt of body) {
                    const code = serverRewriteEmitted(emitLogicNode(stmt))
                    if (code) {
                        for (const line of code.split("\n")) {
                            lines.push("  " + line)
                        }
                    }
                }
            }
        }

        lines.push("}")
        lines.push("")

        const mwWrap = (_scrml_hasMW || _scrml_handleNode != null)
            ? "_scrml_mw_wrap(" + handlerName + ")"
            : handlerName
        lines.push("export const " + routeName + " = {")
        lines.push("  path: " + JSON.stringify(path) + ",")
        lines.push("  method: " + JSON.stringify(httpMethod) + ",")
        lines.push("  handler: " + mwWrap + ",")
        lines.push("};")
        lines.push("")
    }

    // Channel WebSocket infrastructure (§35)
    if (channelNodes.length > 0) {
        const wsHandlerLines = emitChannelWsHandlers(channelNodes, errors, filePath ?? "")
        for (const l of wsHandlerLines) lines.push(l)

        for (const chNode of channelNodes) {
            const chServerLines = emitChannelServerJs(
                chNode,
                errors,
                filePath ?? "",
                !!authMiddlewareEntry,
            )
            for (const l of chServerLines) lines.push(l)
        }
    }

    return lines.join("\n")
}

// ===========================================================================
// SECTION: emit-overloads (from emit-overloads.ts)
// ===========================================================================
//
// emitOverloads — function overload dispatch emission

export function emitOverloads(ctx) {
    const overloadRegistry = ctx.fileAST.overloadRegistry
    const lines = []

    if (!overloadRegistry || overloadRegistry.size == 0) {
        return lines
    }

    lines.push("// State-type overload dispatch functions")
    lines.push("")

    for (const [fnName, overloads] of overloadRegistry) {
        const dispatchName = genVar("dispatch_" + fnName)
        lines.push("function " + dispatchName + "(_scrml_arg) {")
        lines.push("  const _scrml_type = _scrml_arg?.__scrml_state_type;")

        let first = true
        for (const [stateType, fnNode] of overloads) {
            const prefix = first ? "if" : "} else if"
            first = false
            genVar(fnName + "_" + stateType)
            lines.push("  " + prefix + " (_scrml_type === " + JSON.stringify(stateType) + ") {")

            const body = fnNode.body ?? []
            for (const stmt of body) {
                const code = emitLogicNode(stmt)
                if (code) {
                    for (const line of code.split("\n")) {
                        lines.push("    " + line)
                    }
                }
            }
        }

        lines.push("  } else {")
        lines.push("    throw new Error(`No overload of '" + fnName + "' matches state type '${_scrml_type ?? \"unknown\"}'`);")
        lines.push("  }")
        lines.push("}")
        lines.push("")
    }

    return lines
}

// ===========================================================================
// SECTION: emit-library (from emit-library.ts)
// ===========================================================================
//
// generateLibraryJs — library mode ES module export generation

function _stripInlineMeta(text) {
    let result = ""
    let i = 0
    while (i < text.length) {
        if (text[i] === "^" && i + 1 < text.length && text[i + 1] === "{") {
            i += 2 // skip ^{
            let depth = 1
            let body = ""
            while (i < text.length && depth > 0) {
                if (text[i] === "{") depth++
                else if (text[i] === "}") {
                    depth--
                    if (depth === 0) { i++; break }
                }
                body += text[i]
                i++
            }
            result += body.trim()
        } else {
            result += text[i]
            i++
        }
    }
    return result
}

export function generateLibraryJs(ctxOrFileAST, routeMapLegacy, errorsLegacy) {
    let fileAST
    let routeMap
    let errors
    if ("fileAST" in ctxOrFileAST) {
        const ctx = ctxOrFileAST
        fileAST = ctx.fileAST
        routeMap = ctx.routeMap
        errors = ctx.errors
    } else {
        fileAST = ctxOrFileAST
        routeMap = routeMapLegacy ?? {}
        errors = errorsLegacy ?? []
    }
    const filePath = fileAST.filePath
    const sourceText = (fileAST._sourceText ?? null)
    const lines = []

    lines.push("// Generated library module — scrml compiler output")
    lines.push("// ES module: import { name } from './this-file.js'")
    lines.push("")

    // Collect logic blocks from the AST
    const logicBlocks = []
    const nodes = getNodes(fileAST)
    function collectLogicBlocks(nodeList) {
        for (const node of nodeList) {
            if (!node || typeof node !== "object") continue
            const n = node
            if (n.kind == "logic" && Array.isArray(n.body)) {
                logicBlocks.push(n)
            }
            if (Array.isArray(n.children)) collectLogicBlocks(n.children)
        }
    }
    collectLogicBlocks(nodes)

    // Source-text path: extract the logic block's content directly from source
    if (sourceText && logicBlocks.length > 0) {
        for (const logic of logicBlocks) {
            const body = (logic.body ?? [])

            const regions = []
            let lastSkippedEnd = -1

            const logicSpan = logic.span
            if (logicSpan && typeof logicSpan.start === "number" && typeof logicSpan.end === "number") {
                let blockText = sourceText.slice(logicSpan.start, logicSpan.end)
                if (blockText.startsWith("${")) blockText = blockText.slice(2)
                if (blockText.endsWith("}")) blockText = blockText.slice(0, -1)
                blockText = blockText.trim()
                if (blockText) {
                    blockText = blockText.replace(/\btype\s*:\s*(?:enum|struct)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\{[^]*?\n\s*\}/g, "")
                    blockText = blockText.replace(/\bfn\s+([A-Za-z_$])/g, "function $1")
                    blockText = _stripInlineMeta(blockText)
                    const importRe = /const\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g
                    let m
                    while ((m = importRe.exec(blockText)) !== null) {
                        const names = m[1].trim().replace(/(\w+)\s*:\s*(\w+)/g, "$1 as $2")
                        lines.push("import { " + names + " } from \"" + m[2] + "\";")
                    }
                    const nsImportRe = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g
                    while ((m = nsImportRe.exec(blockText)) !== null) {
                        lines.push("import * as " + m[1] + " from \"" + m[2] + "\";")
                    }
                    blockText = _stripInlineMeta(blockText)
                    blockText = blockText.replace(/const\s*\{[^}]+\}\s*=\s*await\s+import\s*\([^)]+\)\s*;?/g, "")
                    blockText = blockText.replace(/const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*await\s+import\s*\([^)]+\)\s*;?/g, "")
                    blockText = blockText.trim()
                    if (blockText) {
                        lines.push(blockText)
                        lines.push("")
                    }
                }
                continue
            }

            // Fallback: node-by-node processing (when logic block has no span)
            for (let i = 0; i < body.length; i++) {
                const stmt = body[i]
                if (!stmt) continue

                if (stmt.kind == "meta") {
                    if (sourceText && stmt.span) {
                        const span = stmt.span
                        const metaText = sourceText.slice(span.start, span.end)
                        const importRe = /const\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g
                        let m
                        while ((m = importRe.exec(metaText)) !== null) {
                            const names = m[1].trim().replace(/(\w+)\s*:\s*(\w+)/g, "$1 as $2")
                            const source = m[2]
                            lines.push("import { " + names + " } from \"" + source + "\";")
                        }
                        const nsImportRe = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g
                        while ((m = nsImportRe.exec(metaText)) !== null) {
                            const name = m[1]
                            const source = m[2]
                            lines.push("import * as " + name + " from \"" + source + "\";")
                        }
                    }
                    if (stmt.span) {
                        const sp = stmt.span
                        lastSkippedEnd = Math.max(lastSkippedEnd, sp.end)
                    }
                    continue
                }

                if (stmt.kind == "component-def" && (stmt.template || stmt.props)) {
                    if (stmt.span) {
                        const sp = stmt.span
                        lastSkippedEnd = Math.max(lastSkippedEnd, sp.end)
                    }
                    continue
                }

                if (stmt.kind == "type-decl") {
                    if (stmt.span) {
                        const sp = stmt.span
                        lastSkippedEnd = Math.max(lastSkippedEnd, sp.end)
                    }
                    const next = body[i + 1]
                    if (next?.kind == "bare-expr" && next.span) {
                        const nextSp = next.span
                        lastSkippedEnd = Math.max(lastSkippedEnd, nextSp.end)
                        i++
                    }
                    continue
                }

                if (isServerOnlyNode(stmt)) {
                    errors.push(new CGError(
                        "E-CG-006",
                        "E-CG-006: Server-only node (" + stmt.kind + ") found in library JS output.",
                        (stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }),
                    ))
                    continue
                }

                const stmtSpan = stmt.span
                if (stmtSpan && typeof stmtSpan.start === "number" && typeof stmtSpan.end === "number") {
                    let start = stmtSpan.start
                    if (stmt.kind == "export-decl") {
                        const lookback = sourceText.slice(Math.max(0, start - 20), start)
                        const exportIdx = lookback.lastIndexOf("export")
                        if (exportIdx >= 0) {
                            start = Math.max(0, start - 20) + exportIdx
                        }
                    }
                    if (stmt.kind == "component-def") {
                        const lookback = sourceText.slice(Math.max(0, start - 20), start)
                        const constIdx = lookback.lastIndexOf("const")
                        const letIdx = lookback.lastIndexOf("let")
                        const declIdx = Math.max(constIdx, letIdx)
                        if (declIdx >= 0) {
                            start = Math.max(0, start - 20) + declIdx
                        }
                    }

                    if (regions.length > 0) {
                        const prevEnd = Math.max(regions[regions.length - 1].end, lastSkippedEnd)
                        if (start > prevEnd) {
                            const gap = sourceText.slice(prevEnd, start).trim()
                            if (gap) {
                                regions.push({ start: prevEnd, end: start, isGap: true })
                            }
                        }
                    } else if (i > 0) {
                        const firstMeta = body.find(function(s) { return s?.kind == "meta" && s.span })
                        let gapStart = -1
                        if (firstMeta?.span) {
                            const fmSpan = firstMeta.span
                            gapStart = fmSpan.end
                        }
                        gapStart = Math.max(gapStart, lastSkippedEnd)
                        if (gapStart >= 0 && start > gapStart) {
                            const gap = sourceText.slice(gapStart, start).trim()
                            if (gap) {
                                regions.push({ start: gapStart, end: start, isGap: true })
                            }
                        }
                    }

                    regions.push({ start, end: stmtSpan.end, isGap: false, kind: stmt.kind })
                }
            }

            // Emit all regions
            for (const region of regions) {
                let text = sourceText.slice(region.start, region.end).trim()
                if (!text) continue

                if (region.isGap) {
                    text = text.replace(/\btype\s*:\s*(?:enum|struct)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\{[^]*?\n\s*\}/g, "")
                    text = text.replace(/\bfn\s+([A-Za-z_$])/g, "function $1")
                    text = text.replace(/\bfn\s*$/gm, "")
                    text = text.trim()
                    if (!text) continue
                }

                if (!region.isGap) {
                    text = text.replace(/\bfn\s+([A-Za-z_$])/g, "function $1")
                    text = text.replace(/\bfn\s*$/g, "").trimEnd()
                }

                text = _stripInlineMeta(text)

                lines.push(text)
                lines.push("")
            }
        }

        return lines.join("\n")
    }

    // Fallback path: emit from AST nodes (no source text available)
    for (const logic of logicBlocks) {
        const body = (logic.body ?? [])
        for (const stmt of body) {
            if (!stmt) continue
            if (stmt.kind == "meta") continue

            if (isServerOnlyNode(stmt)) {
                errors.push(new CGError(
                    "E-CG-006",
                    "E-CG-006: Server-only node (" + stmt.kind + ") found in library JS output.",
                    (stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }),
                ))
                continue
            }

            if (stmt.kind == "export-decl") {
                const raw = (stmt.raw ?? "").trim()
                if (raw) {
                    lines.push(raw)
                    lines.push("")
                }
                continue
            }

            if (stmt.kind == "function-decl") {
                const name = (stmt.name ?? "anon")
                const params = (stmt.params ?? [])
                const paramNames = params.map(function(p, i) {
                    return typeof p === "string" ? p : (p.name ?? ("_scrml_arg_" + i))
                })
                const generatorStar = stmt.isGenerator ? "*" : ""
                const asyncPrefix = stmt.isAsync ? "async " : ""
                lines.push(asyncPrefix + "function" + generatorStar + " " + name + "(" + paramNames.join(", ") + ") {")
                const bodyStmts = (stmt.body ?? [])
                for (const bodyStmt of bodyStmts) {
                    if (!bodyStmt) continue
                    if (isServerOnlyNode(bodyStmt)) continue
                    const code = emitLogicNode(bodyStmt)
                    if (code) {
                        for (const line of code.split("\n")) {
                            lines.push("  " + line)
                        }
                    }
                }
                lines.push("}")
                lines.push("")
                continue
            }

            const code = emitLogicNode(stmt)
            if (code) {
                lines.push(code)
            }
        }
    }

    return lines.join("\n")
}

// ===========================================================================
// SECTION: emit-test (from emit-test.ts)
// ===========================================================================
//
// generateTestJs — Bun test output from ~{} blocks
//
// Note: basename is imported at the top of the index section below as _basename.
// For emit-test we use a local wrapper to avoid duplication.

function _assertOpToExpect(lhs, op, rhs) {
    switch (op) {
        case "==":  return "expect(" + lhs + ").toEqual(" + rhs + ")"
        case "!=":  return "expect(" + lhs + ").not.toEqual(" + rhs + ")"
        case ">":   return "expect(" + lhs + ").toBeGreaterThan(" + rhs + ")"
        case ">=":  return "expect(" + lhs + ").toBeGreaterThanOrEqual(" + rhs + ")"
        case "<":   return "expect(" + lhs + ").toBeLessThan(" + rhs + ")"
        case "<=":  return "expect(" + lhs + ").toBeLessThanOrEqual(" + rhs + ")"
        default:    return "expect(" + lhs + ").toEqual(" + rhs + ")"
    }
}

function _emitAssert(stmt, indent) {
    if (stmt.op !== null && stmt.lhs !== null && stmt.rhs !== null) {
        return indent + _assertOpToExpect(stmt.lhs, stmt.op, stmt.rhs) + ";"
    }
    return indent + "expect(" + stmt.raw + ").toBeTruthy();"
}

export function generateTestJs(filePath, testGroups, scopeSnapshot) {
    scopeSnapshot = scopeSnapshot ?? []
    if (testGroups.length == 0) return null

    const fileName = _basename(filePath)
    const lines = []

    const needsBeforeEach = testGroups.some(function(g) {
        return (g.before !== null && g.before.length > 0) || scopeSnapshot.length > 0
    })
    const importParts = ["test", "expect", "describe"]
    if (needsBeforeEach) importParts.push("beforeEach")
    lines.push("import { " + importParts.join(", ") + " } from \"bun:test\";")
    lines.push("")

    lines.push("describe(" + JSON.stringify(fileName) + ", () => {")

    for (const group of testGroups) {
        const groupLabel = group.name
            ? group.name + " (line " + group.line + ")"
            : "(line " + group.line + ")"

        lines.push("  describe(" + JSON.stringify(groupLabel) + ", () => {")

        for (const v of scopeSnapshot) {
            lines.push("    let " + v.name + " = " + v.initValue + ";")
        }

        const hasBeforeEach = scopeSnapshot.length > 0 || (group.before !== null && group.before.length > 0)
        if (hasBeforeEach) {
            lines.push("    beforeEach(() => {")
            for (const v of scopeSnapshot) {
                lines.push("      " + v.name + " = " + v.initValue + ";")
            }
            if (group.before !== null) {
                for (const stmt of group.before) {
                    if (stmt) lines.push("      " + stmt)
                }
            }
            lines.push("    });")
        }

        for (const testCase of group.tests) {
            const caseName = testCase.name || "(anonymous)"
            lines.push("    test(" + JSON.stringify(caseName) + ", () => {")

            for (const stmt of testCase.body) {
                if (!stmt.startsWith("assert ")) {
                    lines.push("      " + stmt)
                }
            }

            for (const assertStmt of testCase.asserts) {
                lines.push(_emitAssert(assertStmt, "      "))
            }

            lines.push("    });")
        }

        lines.push("  });")
    }

    lines.push("});")
    lines.push("")

    return lines.join("\n")
}

// ===========================================================================
// SECTION: emit-worker (from emit-worker.ts)
// ===========================================================================
//
// generateWorkerJs, rewriteSendToPostMessage — worker bundle generation

export function generateWorkerJs(name, children, whenMessage) {
    const lines = []
    lines.push("// Generated worker: " + name)

    for (const child of children) {
        if (!child || typeof child !== "object") continue

        if (child.kind == "logic") {
            for (const stmt of (child.body ?? [])) {
                if (stmt?.kind == "function-decl") {
                    const fnCode = emitLogicNode(stmt)
                    if (fnCode) {
                        lines.push(fnCode)
                    }
                }
            }
        }
    }

    if (whenMessage) {
        const binding = whenMessage.binding ?? "data"
        let body = whenMessage.bodyRaw ?? ""

        body = rewriteSendToPostMessage(body)

        lines.push("self.onmessage = function(event) {")
        lines.push("  var " + binding + " = event.data;")

        for (const bodyLine of body.split("\n")) {
            lines.push("  " + bodyLine)
        }

        lines.push("};")
    }

    return lines.join("\n")
}

export function rewriteSendToPostMessage(body) {
    return body.replace(/\bsend\s*\(/g, "self.postMessage(")
}

// ===========================================================================
// SECTION: emit-client (from emit-client.ts)
// ===========================================================================
//
// generateClientJs, emitEnumLookupTables, emitEnumVariantObjects,
// hasRuntimeMetaBlocks, detectRuntimeChunks

function hasRuntimeMetaBlocks(fileAST) {
    const nodes = fileAST?.ast?.nodes ?? fileAST?.nodes ?? []
    function visit(nodeList) {
        for (const node of nodeList) {
            if (!node) continue
            if (node.kind == "meta" && node.capturedScope) return true
            if (node.kind == "logic" && Array.isArray(node.body)) {
                if (visit(node.body)) return true
            }
            if (Array.isArray(node.children)) {
                if (visit(node.children)) return true
            }
        }
        return false
    }
    return visit(nodes)
}

function detectRuntimeChunks(fileAST, ctx) {
    const chunks = ctx.usedRuntimeChunks
    const allNodes = fileAST?.ast?.nodes ?? fileAST?.nodes ?? []

    function walkNodes(nodes) {
        for (const node of nodes) {
            if (!node || typeof node !== "object") continue
            detectFromNode(node)
            if (Array.isArray(node.children)) walkNodes(node.children)
        }
    }

    function walkBody(body) {
        if (!Array.isArray(body)) return
        for (const stmt of body) {
            if (!stmt || typeof stmt !== "object") continue
            detectFromNode(stmt)
            if (Array.isArray(stmt.body)) walkBody(stmt.body)
            if (Array.isArray(stmt.consequent)) walkBody(stmt.consequent)
            if (Array.isArray(stmt.alternate)) walkBody(stmt.alternate)
            if (Array.isArray(stmt.children)) walkNodes(stmt.children)
        }
    }

    function detectFromNode(node) {
        const kind = node.kind ?? ""

        switch (kind) {
            case "reactive-derived-decl":
                chunks.add("derived")
                break

            case "lift-expr":
                chunks.add("lift")
                break

            case "state-decl":
                chunks.add("deep_reactive")
                break

            case "markup": {
                const tag = node.tag ?? ""
                if (tag == "timer" || tag == "poll" || tag == "timeout") {
                    chunks.add("timers")
                    chunks.add("deep_reactive")
                }
                if (tag == "keyboard" || tag == "mouse" || tag == "gamepad") {
                    chunks.add("input")
                }
                if (Array.isArray(node.children)) {
                    walkNodes(node.children)
                }
                break
            }

            case "for-stmt": {
                const iterable = (node.iterable ?? node.collection ?? "").trim()
                if (/^@[A-Za-z_$][A-Za-z0-9_$]*$/.test(iterable)) {
                    chunks.add("reconciliation")
                    chunks.add("lift")
                    chunks.add("deep_reactive")
                }
                if (Array.isArray(node.body)) walkBody(node.body)
                break
            }

            case "meta":
                chunks.add("meta")
                break

            case "when-effect":
                chunks.add("deep_reactive")
                break

            case "reactive-nested-assign":
                chunks.add("utilities")
                break
            case "reactive-debounced-decl":
                chunks.add("utilities")
                break
            case "debounce-call":
                chunks.add("utilities")
                break
            case "throttle-call":
                chunks.add("utilities")
                break
            case "upload-call":
                chunks.add("utilities")
                break
            case "reactive-explicit-set":
                chunks.add("utilities")
                break

            case "match-stmt": {
                const arms = node.arms ?? []
                const hasEnumArm = arms.some(function(arm) {
                    return arm && (arm.enumType || arm.pattern?.includes("."))
                })
                if (hasEnumArm) {
                    chunks.add("equality")
                }
                break
            }

            case "logic":
                if (Array.isArray(node.body)) walkBody(node.body)
                break
        }

        if (kind == "bare-expr") {
            const expr = node.expr ?? ""
            if (expr.includes("animationFrame(")) {
                chunks.add("animation")
            }
            if (expr.includes("navigate(") || expr.includes("_scrml_navigate(")) {
                chunks.add("utilities")
            }
        }

        if (kind == "function-decl" && Array.isArray(node.body)) {
            walkBody(node.body)
        }
    }

    walkNodes(allNodes)

    const eventBindings = (ctx.registry).eventBindings ?? []
    const logicBindings = (ctx.registry).logicBindings ?? []

    if (logicBindings.length > 0) {
        chunks.add("deep_reactive")
        for (const binding of logicBindings) {
            if (binding.transitionEnter || binding.transitionExit) {
                chunks.add("transitions")
                break
            }
        }
    }

    if (eventBindings.length > 0) {
        chunks.add("deep_reactive")
    }

    const allAstNodes = fileAST?.ast?.nodes ?? fileAST?.nodes ?? []
    function hasBoundDirectives(nodes) {
        for (const node of nodes) {
            if (!node) continue
            const attrs = node.attributes ?? node.attrs ?? []
            for (const attr of attrs) {
                if (attr?.name?.startsWith("bind:")) return true
                if (attr?.name?.startsWith("class:")) return true
                if (attr?.name == "ref") return true
            }
            if (Array.isArray(node.children) && hasBoundDirectives(node.children)) return true
        }
        return false
    }

    if (hasBoundDirectives(allAstNodes)) {
        chunks.add("deep_reactive")
        chunks.add("utilities")
    }

    function hasCssBridges(nodes) {
        for (const node of nodes) {
            if (!node) continue
            if (node.kind == "css" && Array.isArray(node.rules)) {
                for (const rule of node.rules) {
                    if (rule.reactiveRefs?.length > 0 || rule.isExpression) return true
                }
            }
            if (Array.isArray(node.children) && hasCssBridges(node.children)) return true
        }
        return false
    }
    if (hasCssBridges(allAstNodes)) {
        chunks.add("deep_reactive")
    }

    function hasBindProps(nodes) {
        for (const node of nodes) {
            if (!node) continue
            if (Array.isArray(node._bindProps) && node._bindProps.length > 0) return true
            if (Array.isArray(node.children) && hasBindProps(node.children)) return true
        }
        return false
    }
    if (hasBindProps(allAstNodes)) {
        chunks.add("deep_reactive")
    }
}

export function generateClientJs(ctx) {
    const { fileAST, protectedFields, errors, encodingCtx, workerNames } = ctx
    const authMiddlewareEntry = ctx.authMiddleware
    const csrfEnabled = ctx.csrfEnabled
    const filePath = fileAST.filePath
    const lines = []

    lines.push("// Generated client-side JS for scrml")
    lines.push("// This file is executable browser JavaScript.")
    lines.push("")

    detectRuntimeChunks(fileAST, ctx)
    const runtimeSource = assembleRuntime(ctx.usedRuntimeChunks)
    lines.push(runtimeSource)
    lines.push("// --- end scrml reactive runtime ---")
    lines.push("")

    // Emit JS imports from use-decl and import-decl nodes (§40)
    const allImports = fileAST?.ast?.imports ?? fileAST?.imports ?? []
    for (const stmt of allImports) {
        if ((stmt.kind == "import-decl" || stmt.kind == "use-decl") && stmt.source && stmt.names?.length > 0) {
            const jsSource = stmt.source
            if (jsSource.startsWith("scrml:") || jsSource.startsWith("vendor:")) {
                lines.push("// " + stmt.kind + ": " + (stmt.raw ?? stmt.source))
            } else {
                const names = stmt.names.join(", ")
                if (stmt.isDefault) {
                    lines.push("import " + names + " from " + JSON.stringify(jsSource) + ";")
                } else {
                    lines.push("import { " + names + " } from " + JSON.stringify(jsSource) + ";")
                }
            }
        }
    }
    lines.push("")

    // Enum toEnum() lookup tables (SPEC §14.4.1)
    const enumLookupLines = emitEnumLookupTables(fileAST)
    if (enumLookupLines.length > 0) {
        lines.push("// --- enum toEnum() lookup tables (compiler-generated) ---")
        for (const line of enumLookupLines) lines.push(line)
        lines.push("")
    }

    // Enum variant objects
    const enumObjectLines = emitEnumVariantObjects(fileAST)
    if (enumObjectLines.length > 0) {
        lines.push("// --- enum variant objects (compiler-generated) ---")
        for (const line of enumObjectLines) lines.push(line)
        lines.push("")
    }

    // §4.12.4: Worker instantiation
    if (workerNames && workerNames.length > 0) {
        lines.push("// --- worker instantiation (compiler-generated, §4.12.4) ---")
        for (const name of workerNames) {
            lines.push("const _scrml_worker_" + name + " = new Worker(\"" + name + ".worker.js\");")
            lines.push("_scrml_worker_" + name + ".send = function(data) {")
            lines.push("  return new Promise(function(resolve) {")
            lines.push("    _scrml_worker_" + name + ".onmessage = function(e) { resolve(e.data); };")
            lines.push("    _scrml_worker_" + name + ".postMessage(data);")
            lines.push("  });")
            lines.push("};")
        }
        lines.push("")
    }

    // @session reactive projection (Option C hybrid)
    if (authMiddlewareEntry) {
        const { loginRedirect } = authMiddlewareEntry

        lines.push("// --- @session reactive projection (compiler-generated) ---")
        lines.push("let _scrml_session = null;")
        lines.push("")
        lines.push("async function _scrml_session_init() {")
        lines.push("  try {")
        lines.push("    const resp = await fetch('/_scrml/session', { credentials: 'include' });")
        lines.push("    if (resp.ok) {")
        lines.push("      _scrml_session = await resp.json();")
        lines.push("    } else {")
        lines.push("      _scrml_session = null;")
        lines.push("    }")
        lines.push("  } catch {")
        lines.push("    _scrml_session = null;")
        lines.push("  }")
        lines.push("}")
        lines.push("")
        lines.push("const session = {")
        lines.push("  get current() { return _scrml_session; },")
        lines.push("  async destroy() {")
        lines.push("    await fetch('/_scrml/session/destroy', {")
        lines.push("      method: 'POST',")
        lines.push("      credentials: 'include',")
        lines.push("    });")
        lines.push("    _scrml_session = null;")
        lines.push("    window.location.href = " + JSON.stringify(loginRedirect) + ";")
        lines.push("  },")
        lines.push("};")
        lines.push("")
        lines.push("_scrml_session_init();")
        lines.push("")
    }

    // Baseline CSRF token helper
    if (csrfEnabled && !authMiddlewareEntry) {
        lines.push("// --- CSRF token helper (compiler-generated, double-submit cookie) ---")
        lines.push("function _scrml_get_csrf_token() {")
        lines.push("  const match = document.cookie.match(/(?:^|;\\s*)scrml_csrf=([^;]+)/);")
        lines.push("  return match ? decodeURIComponent(match[1]) : '';")
        lines.push("}")
        lines.push("")
    }

    // Emit fetch stubs, CPS wrappers, and client-boundary function bodies
    const { lines: fnLines, fnNameMap } = emitFunctions(ctx)
    for (const line of fnLines) lines.push(line)

    // Emit top-level logic statements and CSS variable bridge
    const reactiveLines = emitReactiveWiring(ctx)
    for (const line of reactiveLines) lines.push(line)

    // Emit ref= and bind:/class: directive wiring
    const bindingLines = emitBindings(ctx)
    for (const line of bindingLines) lines.push(line)

    // Emit state-type overload dispatch functions
    const overloadLines = emitOverloads(ctx)
    for (const line of overloadLines) lines.push(line)

    // Emit event handler wiring and reactive display wiring
    const eventLines = emitEventWiring(ctx, fnNameMap)
    for (const line of eventLines) lines.push(line)

    // Emit type decode table + runtime reflect when encoding is enabled
    if (encodingCtx?.enabled && hasRuntimeMetaBlocks(fileAST)) {
        lines.push("")
        lines.push("// --- type decode table (§47.2) ---")
        lines.push(emitDecodeTable(encodingCtx))
        lines.push(emitRuntimeReflect())
        lines.push("")
    }

    // Post-process to mangle function call sites
    let clientCode = lines.join("\n")
    if (fnNameMap && fnNameMap.size > 0) {
        for (const [originalName, mangledName] of fnNameMap) {
            // NOTE: The regex pattern below has no literal { or } so no escaping needed
            const callSiteRegex = new RegExp("\\b" + escapeRegex(originalName) + "\\b(?=\\s*[(;,}\\]\\n)]|$)", "g")
            clientCode = clientCode.replace(callSiteRegex, mangledName)
        }
    }
    for (const field of protectedFields) {
        const fieldRegex = new RegExp("\\." + escapeRegex(field) + "\\b")
        if (fieldRegex.test(clientCode)) {
            errors.push(new CGError(
                "E-CG-001",
                "E-CG-001: Protected field `" + field + "` found in client JS output. " +
                "This indicates an upstream invariant violation.",
                { file: filePath, start: 0, end: 0, line: 1, col: 1 },
            ))
        }
    }

    // Security validation: client JS must not contain SQL execution calls
    // NOTE: these regex patterns are built via string concatenation to avoid
    // having literal /\?{`/ etc. in the source that might confuse brace counters
    const SQL_LEAK_PATTERNS = [
        /_scrml_sql_exec\s*\(/,
        /_scrml_db\s*\./,
        /\bprocess\.env\b/,
        /\bBun\.env\b/,
        /\bbun\.eval\s*\(/,
        new RegExp("\\?" + String.fromCharCode(123) + "`"),
    ]
    for (const pattern of SQL_LEAK_PATTERNS) {
        if (pattern.test(clientCode)) {
            errors.push(new CGError(
                "E-CG-006",
                "E-CG-006: Server-only pattern (" + pattern + ") detected in client JS output. " +
                "This is a security violation. Indicates a failure in the server-only node guard.",
                { file: filePath, start: 0, end: 0, line: 1, col: 1 },
            ))
        }
    }

    return clientCode
}

// ---------------------------------------------------------------------------
// emitEnumLookupTables
// ---------------------------------------------------------------------------

export function emitEnumLookupTables(fileAST) {
    const lines = []
    const typeDecls = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? []

    for (const decl of typeDecls) {
        if (decl.kind != "type-decl" || decl.typeKind != "enum") continue

        const unitVariants = _getUnitVariantNames(decl)
        if (unitVariants.length > 0) {
            const entries = unitVariants.map(function(name) { return "\"" + name + "\": \"" + name + "\"" }).join(", ")
            lines.push("const " + decl.name + "_toEnum = { " + entries + " };")
        }

        const allVariants = _getAllVariantNames(decl)
        if (allVariants.length > 0) {
            const variantsArray = allVariants.map(function(name) { return "\"" + name + "\"" }).join(", ")
            lines.push("const " + decl.name + "_variants = [" + variantsArray + "];")
        }
    }

    return lines
}

function _getUnitVariantNames(decl) {
    if (Array.isArray(decl.variants)) {
        return decl.variants
            .filter(function(v) { return v.payload === null || v.payload === undefined })
            .map(function(v) { return v.name ?? "" })
            .filter(function(name) { return typeof name === "string" && /^[A-Z]/.test(name) })
    }

    const raw = decl.raw ?? ""
    let body = raw.trim()
    if (body.startsWith("{")) body = body.slice(1)
    if (body.endsWith("}")) body = body.slice(0, -1)
    body = body.trim()

    if (!body) return []

    const parts = body.split(/[\n,]+/)
    const names = []
    for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue
        if (trimmed.includes("(")) continue
        const name = trimmed.split(/\s+/)[0]
        if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
            names.push(name)
        }
    }
    return names
}

function _getAllVariantNames(decl) {
    if (Array.isArray(decl.variants)) {
        return decl.variants
            .map(function(v) { return v.name ?? "" })
            .filter(function(name) { return typeof name === "string" && /^[A-Z]/.test(name) })
    }

    const raw = decl.raw ?? ""
    let body = raw.trim()
    if (body.startsWith("{")) body = body.slice(1)
    if (body.endsWith("}")) body = body.slice(0, -1)
    body = body.trim()

    if (!body) return []

    const parts = body.split(/[\n,]+/)
    const names = []
    for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const name = trimmed.split(/[\s(]/)[0]
        if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
            names.push(name)
        }
    }
    return names
}

export function emitEnumVariantObjects(fileAST) {
    const lines = []
    const typeDecls = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? []

    for (const decl of typeDecls) {
        if (decl.kind != "type-decl" || decl.typeKind != "enum") continue

        const unitVariants = _getUnitVariantNames(decl)
        if (unitVariants.length == 0) continue

        const allVariants = _getAllVariantNames(decl)
        const entries = unitVariants.map(function(name) { return name + ": \"" + name + "\"" }).join(", ")
        const variantsArray = allVariants.map(function(name) { return "\"" + name + "\"" }).join(", ")
        lines.push("const " + decl.name + " = Object.freeze({ " + entries + ", variants: [" + variantsArray + "] });")
    }

    return lines
}

// ===========================================================================
// SECTION: index (from index.ts)
// ===========================================================================
//
// runCG — MAIN ENTRY POINT for the Code Generator (Stage 8)
//
// Orchestrates: analyze -> HTML -> CSS -> server JS -> client JS / library JS
// -> test JS -> worker JS -> CgOutput

// External imports needed by runCG — loaded at module init time.
// scanClassesFromHtml and getAllUsedCSS come from the tailwind helper.
// SCRML_RUNTIME and RUNTIME_FILENAME come from the runtime template.
// _basename comes from Node's built-in 'path' module.
const { scanClassesFromHtml, getAllUsedCSS } = await import("../../src/tailwind-classes.js")
// SCRML_RUNTIME and RUNTIME_FILENAME already loaded by section-core.js
const { basename: _basename } = await import("path")

export function runCG(input) {
    const {
        files,
        routeMap,
        depGraph,
        protectAnalysis,
        sourceMap = false,
        embedRuntime = false,
        mode = "browser",
        testMode = false,
        encoding: encodingInput = false,
    } = input

    // Resolve encoding configuration (§47)
    const encodingOpts = typeof encodingInput === "object"
        ? encodingInput
        : { enabled: encodingInput ?? false }

    resetVarCounter()

    const outputs = new Map()
    const errors = []

    // Validate inputs
    if (!files || files.length == 0) {
        return { outputs, errors }
    }

    const safeRouteMap = routeMap ?? { functions: new Map() }
    const safeDepGraph = depGraph ?? { nodes: new Map(), edges: [] }

    // Analysis pass: collect all data from AST before emission begins.
    const { fileAnalyses, protectedFields } = analyzeAll({
        files,
        routeMap: safeRouteMap,
        depGraph: safeDepGraph,
        protectAnalysis,
    })

    // Validate dependency graph edges reference known node IDs
    if (safeDepGraph.nodes && safeDepGraph.edges) {
        for (const edge of safeDepGraph.edges) {
            if (!safeDepGraph.nodes.has(edge.from)) {
                errors.push(new CGError(
                    "E-CG-003",
                    "E-CG-003: Dependency graph edge references unknown source node `" + edge.from + "`.",
                    { file: "", start: 0, end: 0, line: 0, col: 0 },
                ))
            }
            if (!safeDepGraph.nodes.has(edge.to)) {
                errors.push(new CGError(
                    "E-CG-003",
                    "E-CG-003: Dependency graph edge references unknown target node `" + edge.to + "`.",
                    { file: "", start: 0, end: 0, line: 0, col: 0 },
                ))
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Worker extraction pre-pass (§4.12.4): find nested <program name="...">
    // nodes, extract them from parent ASTs, and compile as separate bundles.
    // ---------------------------------------------------------------------------
    const workerBundlesPerFile = new Map()

    for (const fileAST of files) {
        const filePath = fileAST.filePath
        const nodes = fileAST.ast?.nodes ?? fileAST.nodes ?? []

        const workerDefs = new Map()

        function extractWorkerPrograms(parentChildren) {
            for (let i = parentChildren.length - 1; i >= 0; i--) {
                const node = parentChildren[i]
                if (!node || typeof node !== "object") continue

                if (node.kind == "markup" && node.tag == "program") {
                    const attrs = node.attributes ?? node.attrs ?? []
                    const nameAttr = attrs.find(function(a) { return a.name == "name" })
                    if (nameAttr) {
                        const nameVal = nameAttr.value
                        let workerName = null
                        if (nameVal?.kind == "string-literal") {
                            workerName = nameVal.value
                        } else if (nameVal?.kind == "variable-ref") {
                            workerName = (nameVal.name ?? "").replace(/^@/, "")
                        }
                        if (workerName) {
                            const children = node.children ?? []
                            let whenMessage = null
                            for (const child of children) {
                                if (child?.kind == "logic") {
                                    for (const stmt of (child.body ?? [])) {
                                        if (stmt?.kind == "when-message") {
                                            whenMessage = stmt
                                            break
                                        }
                                    }
                                }
                                if (whenMessage) break
                            }
                            workerDefs.set(workerName, { name: workerName, children, whenMessage })
                            parentChildren.splice(i, 1)
                            continue
                        }
                    }
                }

                if (node.kind == "markup" && (node.children?.length > 0)) {
                    extractWorkerPrograms(node.children)
                }
            }
        }

        extractWorkerPrograms(nodes)

        if (workerDefs.size > 0) {
            const bundles = new Map()
            for (const [name, def] of workerDefs) {
                bundles.set(name, generateWorkerJs(name, def.children, def.whenMessage))
            }
            workerBundlesPerFile.set(filePath, bundles)
        }

        // §4.12.6: DB scope annotation
        let dbScopeCounter = 0
        function annotateDbScopes(parentChildren) {
            for (const node of parentChildren) {
                if (!node || typeof node !== "object") continue
                if (node.kind == "markup" && node.tag == "program") {
                    const attrs = node.attributes ?? node.attrs ?? []
                    const dbAttr = attrs.find(function(a) { return a.name == "db" })
                    const nameAttr = attrs.find(function(a) { return a.name == "name" })
                    if (dbAttr && !nameAttr) {
                        const dbVal = dbAttr.value?.value ?? dbAttr.value?.name ?? ""
                        const scopedDbVar = "_scrml_db_" + (++dbScopeCounter)
                        node._dbScope = { dbVar: scopedDbVar, connectionString: dbVal }
                        function tagDescendants(children) {
                            for (const child of children) {
                                if (!child) continue
                                child._dbVar = scopedDbVar
                                if (child.children) tagDescendants(child.children)
                                if (child.body && Array.isArray(child.body)) {
                                    for (const stmt of child.body) {
                                        if (stmt) stmt._dbVar = scopedDbVar
                                    }
                                }
                            }
                        }
                        tagDescendants(node.children ?? [])
                    }
                }
                if (node.kind == "markup" && node.children?.length > 0) {
                    annotateDbScopes(node.children)
                }
            }
        }
        annotateDbScopes(nodes)
    }

    // Process each file
    for (const fileAST of files) {
        const filePath = fileAST.filePath
        const analysis = fileAnalyses.get(filePath)
        const nodes = analysis ? analysis.nodes : []

        // Check for unknown types in nodeTypes
        if (fileAST.nodeTypes) {
            for (const [nodeId, type] of fileAST.nodeTypes) {
                if (type && type.kind == "unknown") {
                    errors.push(new CGError(
                        "E-CG-001",
                        "E-CG-001: Node `" + nodeId + "` has type `{ kind: 'unknown' }`. " +
                        "This indicates a TS invariant violation.",
                        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
                    ))
                }
            }
        }

        // Resolve auth middleware for this file (from RI output)
        const authMW = safeRouteMap.authMiddleware?.get(filePath) ?? null
        // Resolve §39 middleware config from AST (compiler-auto tier)
        const middlewareCfg = fileAST.middlewareConfig ?? null

        // Generate server JS — emitted in both browser and library mode.
        let serverJs = generateServerJs(fileAST, safeRouteMap, errors, authMW, middlewareCfg) || null

        // Generate CSS — emitted in both modes.
        const userCss = generateCss(nodes, analysis?.cssBlocks) || ""

        // LIBRARY MODE — emit ES module exports, skip HTML and browser client JS
        if (mode == "library") {
            const libCtx = {
                filePath,
                fileAST,
                routeMap: safeRouteMap,
                depGraph: safeDepGraph,
                protectedFields,
                authMiddleware: authMW,
                middlewareConfig: middlewareCfg,
                csrfEnabled: false,
                encodingCtx: null,
                mode,
                testMode,
                dbVar: "_scrml_db",
                workerNames: [],
                errors,
                registry: new BindingRegistry(),
                derivedNames: new Set(),
                analysis: analysis ?? null,
            }
            const libraryJs = generateLibraryJs(libCtx) || null

            const css = userCss || null

            let serverJsMap = null
            const base = _basename(filePath, ".scrml")
            if (sourceMap) {
                const sourceBasename = base + ".scrml"
                if (serverJs) {
                    const serverMapFile = base + ".server.js.map"
                    const serverMapBuilder = new SourceMapBuilder(sourceBasename)
                    const serverLines = serverJs.split("\n")
                    for (let i = 0; i < serverLines.length; i++) {
                        serverMapBuilder.addMapping(i, 0, 0)
                    }
                    serverJsMap = serverMapBuilder.generate(base + ".server.js")
                    serverJs = appendSourceMappingUrl(serverJs, serverMapFile)
                }
            }

            const fileWorkerBundles = workerBundlesPerFile.get(filePath)
            const libOutput = {
                sourceFile: filePath,
                libraryJs,
                serverJs,
                css,
                ...(fileWorkerBundles && { workerBundles: fileWorkerBundles }),
                ...(serverJsMap !== null && { serverJsMap }),
            }
            outputs.set(filePath, libOutput)
            continue
        }

        // BROWSER MODE (default) — HTML + client IIFE JS + server JS

        const hasServerFns = [...safeRouteMap.functions.entries()].some(
            function(entry) { return entry[0].startsWith(filePath + "::") && entry[1].boundary == "server" }
        )
        const csrfEnabled = authMW !== null ? authMW.csrf == "auto" : hasServerFns

        const registry = new BindingRegistry()

        const fileWorkerNames = workerBundlesPerFile.has(filePath)
            ? [...workerBundlesPerFile.get(filePath).keys()]
            : []

        // Construct CompileContext early so all emitters can use it.
        const compileCtx = {
            filePath,
            fileAST,
            routeMap: safeRouteMap,
            depGraph: safeDepGraph,
            protectedFields,
            authMiddleware: authMW,
            middlewareConfig: middlewareCfg,
            csrfEnabled,
            encodingCtx: null,
            mode,
            testMode,
            dbVar: "_scrml_db",
            workerNames: fileWorkerNames,
            errors,
            registry,
            derivedNames: new Set(),
            analysis: analysis ?? null,
            usedRuntimeChunks: new Set(['core', 'scope', 'errors', 'transitions']),
        }

        const hasMarkup = analysis?.markupNodes?.length > 0
        const hasRenderableContent = hasMarkup || nodes.some(function(n) {
            return n && typeof n === "object" && (
                (n.kind == "text" && typeof n.value === "string" && n.value.trim() != "") ||
                (n.kind == "text" && typeof n.text === "string" && n.text.trim() != "") ||
                n.kind == "state" ||
                n.kind == "if-chain"
            )
        })
        const htmlBody = hasRenderableContent
            ? generateHtml(nodes, compileCtx)
            : null

        let tailwindCss = ""
        if (htmlBody) {
            const usedClasses = scanClassesFromHtml(htmlBody)
            tailwindCss = getAllUsedCSS(usedClasses)
        }

        const cssParts = []
        if (userCss) cssParts.push(userCss)
        if (tailwindCss) cssParts.push(tailwindCss)
        const css = cssParts.length > 0 ? cssParts.join("\n") : null

        // Create per-file EncodingContext (§47)
        const encodingCtx = new EncodingContext({
            enabled: encodingOpts.enabled,
            debug: encodingOpts.debug,
        })
        compileCtx.encodingCtx = encodingCtx

        // Register reactive variables with the encoding context
        if (encodingCtx.enabled) {
            const topLevelLogic = analysis?.topLevelLogic ?? collectTopLevelLogicStatements(fileAST)
            for (const stmt of topLevelLogic) {
                if (stmt.kind == "state-decl" && stmt.name) {
                    const type = fileAST.nodeTypes?.get(stmt.name) ?? { kind: "asIs", constraint: null }
                    encodingCtx.register(stmt.name, type)
                }
            }
        }

        const clientJsRaw = generateClientJs(compileCtx) || null

        let clientJs = clientJsRaw
        if (clientJsRaw && !embedRuntime) {
            const runtimeEnd = clientJsRaw.indexOf("\n// --- end scrml reactive runtime ---")
            if (runtimeEnd !== -1) {
                const afterRuntime = clientJsRaw.substring(
                    runtimeEnd + "\n// --- end scrml reactive runtime ---".length
                )
                clientJs = "// Requires: " + RUNTIME_FILENAME + "\n" + afterRuntime
            } else {
                const runtimeStart = clientJsRaw.indexOf("// --- scrml reactive runtime ---")
                if (runtimeStart !== -1) {
                    const navigateEnd = clientJsRaw.indexOf("function _scrml_navigate(path) {")
                    if (navigateEnd !== -1) {
                        const closeBrace = clientJsRaw.indexOf("}\n", navigateEnd + 30)
                        if (closeBrace !== -1) {
                            const before = clientJsRaw.substring(0, runtimeStart)
                            const after = clientJsRaw.substring(closeBrace + 2)
                            clientJs = before + "// Requires: " + RUNTIME_FILENAME + "\n" + after
                        }
                    }
                }
            }
        }

        const base = _basename(filePath, ".scrml")
        let html = null
        if (htmlBody) {
            const docParts = []
            docParts.push("<!DOCTYPE html>")
            docParts.push("<html lang=\"en\">")
            docParts.push("<head>")
            docParts.push("  <meta charset=\"UTF-8\">")
            docParts.push("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">")
            docParts.push("  <title>" + escapeHtmlAttr(base) + "</title>")
            if (css) {
                docParts.push("  <link rel=\"stylesheet\" href=\"" + base + ".css\">")
            }
            docParts.push("</head>")
            docParts.push("<body>")
            docParts.push(htmlBody)
            if (clientJs && !embedRuntime) {
                docParts.push("<script src=\"" + RUNTIME_FILENAME + "\"></script>")
            }
            if (clientJs) {
                docParts.push("<script src=\"" + base + ".client.js\"></script>")
            }
            docParts.push("</body>")
            docParts.push("</html>")
            html = docParts.join("\n")
        }

        let clientJsMap = null
        let serverJsMap = null

        if (sourceMap) {
            const sourceBasename = base + ".scrml"

            if (clientJs) {
                const clientMapFile = base + ".client.js.map"
                const clientMapBuilder = new SourceMapBuilder(sourceBasename)
                const clientLines = clientJs.split("\n")
                for (let i = 0; i < clientLines.length; i++) {
                    clientMapBuilder.addMapping(i, 0, 0)
                }
                clientJsMap = clientMapBuilder.generate(base + ".client.js")
                clientJs = appendSourceMappingUrl(clientJs, clientMapFile)
            }

            if (serverJs) {
                const serverMapFile = base + ".server.js.map"
                const serverMapBuilder = new SourceMapBuilder(sourceBasename)
                const serverLines = serverJs.split("\n")
                for (let i = 0; i < serverLines.length; i++) {
                    serverMapBuilder.addMapping(i, 0, 0)
                }
                serverJsMap = serverMapBuilder.generate(base + ".server.js")
                serverJs = appendSourceMappingUrl(serverJs, serverMapFile)
            }
        }

        // Generate test JS when testMode is enabled
        const testJs = testMode
            ? generateTestJs(filePath, analysis?.testGroups ?? [], []) ?? null
            : null

        const fileWorkerBundles = workerBundlesPerFile.get(filePath)
        const browserOutput = {
            sourceFile: filePath,
            html,
            css,
            clientJs,
            serverJs,
            ...(testJs !== null && { testJs }),
            ...(fileWorkerBundles && { workerBundles: fileWorkerBundles }),
            ...(clientJsMap !== null && { clientJsMap }),
            ...(serverJsMap !== null && { serverJsMap }),
        }
        outputs.set(filePath, browserOutput)
    }

    const runtimeJs = embedRuntime ? null : SCRML_RUNTIME

    return { outputs, errors, runtimeJs, runtimeFilename: RUNTIME_FILENAME }
}
