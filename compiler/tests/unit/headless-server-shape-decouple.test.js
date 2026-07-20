/**
 * Unit 1 (server-program-shape Fork 2A) — the §61 `<endpoint>` + §37 SSE
 * `server function* route=` route-handler emit + the WinterCG `fetch`-handler
 * assembly are PROGRAM-SHAPE-AGNOSTIC. This file proves SEPARABILITY: the
 * extracted headless-shape emitter emits route handlers + a `fetch` aggregate
 * mounting them (+ opt-in `cors=`), STRUCTURALLY omitting every web-app-only
 * scaffold — session/CSRF middleware, per-route CSRF gate, and the §52.8 SSR
 * HTML-composition route. (html + the client bundle are separate emitters at the
 * orchestration layer and are simply not invoked for a headless program.)
 *
 * Design authority: scrml-support/docs/deep-dives/server-program-shape-2026-07-12.md
 * (Fork 2A "yes: the typed-inbound-route primitive is orthogonal to the UI emit"
 * + Hard Problem H3). Unit 1 is the REFACTOR only — no serve-harness, no `serve=`
 * attribute, no authored surface. The headless shape's real consumer is Unit 2.
 *
 * The shape axis is LOAD-BEARING, proven by compiling the SAME synthetic fileAST
 * + routeMap under both shapes and observing the web-app scaffold FLIP:
 *   §B — baseline double-submit CSRF (a no-auth state-mutating POST route) is
 *        present in "web-app", absent in "headless".
 *   §C — session/CSRF middleware AND the §52.8 SSR CSRF-meta compose route (both
 *        triggered by an `auth=`/`csrf="auto"` middleware entry) are present in
 *        "web-app", absent in "headless" — and the headless output is still VALID
 *        JS (no dangling reference to the suppressed session middleware).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { generateServerJs, generateHeadlessServerJs } from "../../src/codegen/emit-server.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import * as acorn from "acorn";

const FP = "/test/fsp-host.scrml";

function span(start) {
  return { file: FP, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Assert `src` parses as a valid ES module (adversarial-review Finding 5 — use the
 * codebase's acorn parse, not vm.Script + a regex `export`-strip). Throws on a
 * SyntaxError, which is the assertion.
 */
function assertParsesAsModule(src) {
  acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
}

// ---------------------------------------------------------------------------
// SCOPE-AWARE STATIC DANGLING-REFERENCE DETECTOR (adversarial-review Findings 3,2).
//
// A parse (`acorn.parse`) is a SYNTAX check only — an undefined identifier compiles
// clean, so it cannot detect a dangling reference (a call to a helper whose
// definition the shape gate suppressed). This detector does real LEXICAL SCOPE
// resolution: it returns every `_scrml_*` identifier REFERENCED as a value (not a
// member-property or an object-literal key) that resolves to NO binding in its own
// scope chain (its enclosing function/catch scopes up to module scope).
//
// SCOPE-AWARE (Finding 2): a same-name `_scrml_*` local/param inside an UNRELATED
// function does NOT mask a dangling reference elsewhere — each reference resolves
// only against the bindings visible along ITS scope chain. Function-level scoping
// (var/function hoist to the function; let/const over-approximated to the function)
// — sound for dangling detection: a binding in a sibling scope never resolves a
// reference in another.
// ---------------------------------------------------------------------------
function collectPatternNames(pat, out) {
  if (!pat || typeof pat.type !== "string") return;
  switch (pat.type) {
    case "Identifier": out.add(pat.name); break;
    case "ObjectPattern":
      for (const p of pat.properties) {
        if (p.type === "RestElement") collectPatternNames(p.argument, out);
        else collectPatternNames(p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const e of pat.elements) if (e) collectPatternNames(e, out);
      break;
    case "AssignmentPattern": collectPatternNames(pat.left, out); break;
    case "RestElement": collectPatternNames(pat.argument, out); break;
  }
}

const _SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "sourceType"]);
const _isFnScope = (n) =>
  n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";

// The names DECLARED DIRECTLY in a scope node (Program / Function) — params + the
// function's own name + var/let/const/function/class/import declarations in its
// body, WITHOUT descending into nested function bodies (those are separate scopes).
function directBindings(scopeNode) {
  const names = new Set();
  if (Array.isArray(scopeNode.params)) for (const p of scopeNode.params) collectPatternNames(p, names);
  if (scopeNode.type === "FunctionExpression" && scopeNode.id) names.add(scopeNode.id.name);
  const scan = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (_isFnScope(node)) {
      // A nested function: its NAME (declaration) binds in THIS scope; its body is a
      // separate scope — do not descend.
      if (node.type === "FunctionDeclaration" && node.id) names.add(node.id.name);
      return;
    }
    switch (node.type) {
      case "VariableDeclarator": collectPatternNames(node.id, names); break;
      case "ClassDeclaration": if (node.id) names.add(node.id.name); break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        if (node.local) names.add(node.local.name); break;
    }
    for (const k in node) {
      if (_SKIP_KEYS.has(k)) continue;
      const child = node[k];
      if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === "string") scan(c); }
      else if (child && typeof child.type === "string") scan(child);
    }
  };
  const body = scopeNode.type === "Program"
    ? scopeNode.body
    : (scopeNode.body && scopeNode.body.type === "BlockStatement" ? scopeNode.body.body
      : (scopeNode.body ? [scopeNode.body] : []));
  for (const b of body) scan(b);
  return names;
}

function findDanglingScrmlRefs(src) {
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
  const dangling = new Set();
  const scopeStack = []; // Set<string>[] — innermost last.
  const resolved = (name) => scopeStack.some((s) => s.has(name));

  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== "string") return;
    let pushed = false;
    if (node.type === "Program" || _isFnScope(node)) { scopeStack.push(directBindings(node)); pushed = true; }
    else if (node.type === "CatchClause") {
      const s = new Set();
      if (node.param) collectPatternNames(node.param, s);
      scopeStack.push(s); pushed = true;
    }
    if (node.type === "Identifier") {
      const isMemberProp = parent && parent.type === "MemberExpression" && key === "property" && !parent.computed;
      const isPropKey = parent && parent.type === "Property" && key === "key" && parent.value !== node;
      if (!isMemberProp && !isPropKey && node.name.startsWith("_scrml_") && !resolved(node.name)) {
        dangling.add(node.name);
      }
    }
    for (const k in node) {
      if (_SKIP_KEYS.has(k)) continue;
      const child = node[k];
      if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === "string") visit(c, node, k); }
      else if (child && typeof child.type === "string") visit(child, node, k);
    }
    if (pushed) scopeStack.pop();
  };
  visit(ast, null, null);
  return [...dangling];
}

// ---------------------------------------------------------------------------
// The fixture: a program with an `<endpoint>` (POST /fsp, accepts=FspMethod),
// an SSE `server function* route=` (GET /fsp/deltas), and a no-auth state-
// mutating server fn (POST /api/save) — the last one triggers baseline CSRF in
// web-app shape, so the shape gate is observable.
// ---------------------------------------------------------------------------
function makeFixture() {
  const sseFn = {
    kind: "function-decl", name: "fspDeltas", params: [],
    body: [{ kind: "bare-expr", expr: 'yield { event: "delta", id: 1, data: 1 }', span: span(20) }],
    fnKind: "function", isServer: true, isGenerator: true, canFail: false, errorType: null,
    route: "/fsp/deltas", method: null, span: span(10),
  };
  const saveFn = {
    kind: "function-decl", name: "saveThing", params: ["name"],
    body: [], fnKind: "function", isServer: true, isGenerator: false, canFail: false, errorType: null,
    route: "/api/save", method: "POST", span: span(50),
  };

  // A resolved `accepts=` enum (the W3 typer shape: ParseVariantEnumLike).
  const fspEnum = {
    kind: "enum",
    name: "FspMethod",
    variants: [
      { name: "FleetStatus", payload: null },
      {
        name: "Dispatch",
        payload: new Map([
          ["prompt", { kind: "primitive", name: "string" }],
          ["project", { kind: "primitive", name: "string" }],
        ]),
      },
    ],
  };

  const endpointNode = {
    kind: "endpoint-decl",
    id: "fsp1",
    path: "/fsp",
    method: "POST",
    acceptsEnum: fspEnum,
    arms: [
      {
        variantName: "FleetStatus", payloadBindingsRaw: "",
        bodyRaw: '{ jsonrpc: "2.0", result: { active: 3, idle: 1 } }', span: span(200),
      },
      {
        variantName: "Dispatch", payloadBindingsRaw: "prompt, project",
        bodyRaw: '{ jsonrpc: "2.0", result: { accepted: true, project: project, prompt: prompt } }',
        span: span(220),
      },
    ],
    span: span(190),
  };

  const fileAST = {
    filePath: FP,
    nodes: [
      { kind: "logic", body: [sseFn, saveFn], span: span(0) },
      endpointNode,
    ],
    imports: [], exports: [], components: [], typeDecls: [],
    nodeTypes: new Map(), componentShapes: new Map(), scopeChain: null, spans: new Map(),
  };

  const routeMap = {
    functions: new Map([
      [`${FP}::10`, {
        functionNodeId: `${FP}::10`, boundary: "server", escalationReasons: [],
        generatedRouteName: "__ri_route_fspDeltas_1", serverEntrySpan: sseFn.span,
        isSSE: true, explicitMethod: "GET", explicitRoute: "/fsp/deltas", cpsSplit: null,
      }],
      [`${FP}::50`, {
        functionNodeId: `${FP}::50`, boundary: "server", escalationReasons: [],
        generatedRouteName: "__ri_route_saveThing_1", serverEntrySpan: saveFn.span,
        isSSE: false, explicitMethod: "POST", explicitRoute: "/api/save", cpsSplit: null,
      }],
    ]),
  };

  return { fileAST, routeMap };
}

// The COMPLETE cookie-session / CSRF / SSR / serverLoad / mount-hydrate scaffold —
// every symbol the scaffold-rich+channel fixture (below) emits in WEB-APP shape
// with the `csrf="auto"` auth middleware, and every symbol that MUST be uniformly
// absent in headless shape. NOTE: `_scrml_ensure_csrf_cookie` is BASELINE (no-auth)
// CSRF only, so it is NOT in this auth-path list — §B pairs it instead.
const ALL_SCAFFOLD = [
  "_scrml_session_middleware",
  "_scrml_session_store",
  "_scrml_session_expiry",
  "_scrml_auth_check",
  "_scrml_generate_csrf",
  "_scrml_validate_csrf",
  "_scrml_session_destroy",
  "_scrml_session_projection",
  "_scrml_serverload_auth",
  "_scrml_current_user",
  "SSR pre-render",
  "text/html",
  "__scrml_ssr_state",
  "/__serverLoad",
  "/__mountHydrate",
];

// A SCAFFOLD-RICH + CHANNEL fixture (adversarial-review Findings 4,6,1). makeFixture()
// has no auth / no §52 / no mount-hydrate / no channel, so its web-app scaffold is
// EMPTY in BOTH shapes — a `not.toContain` there is VACUOUS. This fixture ACTUALLY
// emits the ENTIRE scaffold under WEB-APP shape (with the auth middleware): a §52.3
// server-authority `<var server>` cell (→ `/__serverLoad`), two §8.11 callable
// server-var decls (→ `/__mountHydrate`), a §38 `<channel>` (→ WS upgrade route +
// its cookie-auth guard), and authMw drives the session/CSRF middleware + the §52.8
// SSR compose route (csrf="auto"). Every marker in ALL_SCAFFOLD is present in
// web-app and absent in headless — the PAIR that proves the gate; one-sided absence
// proves nothing. The channel ALSO exercises the §38 WS auth-reference gate (the
// round-1 regression): its WS route emits in BOTH shapes, but the cookie-auth
// reference is present in web-app and ABSENT in headless.
function makeScaffoldRichFixture() {
  const saveFn = {
    kind: "function-decl", name: "saveThing", params: ["name"], body: [],
    fnKind: "function", isServer: true, isGenerator: false, canFail: false, errorType: null,
    route: "/api/save", method: "POST", span: span(50),
  };
  // §52.3 Tier-1 server-authority instance → a `/__serverLoad/usersCell` route.
  const serverAuthDecl = {
    kind: "state-decl", name: "usersCell", isServer: true,
    serverAuthorityTable: "users", init: "", span: span(70),
  };
  // §52.15.5 (S255) — a PUBLIC (auth="none") Tier-1 cell. Under the auth
  // middleware, the auth-scoped cells (usersCell/aCell/bCell) are AUTO-OMITTED
  // from the SSR seed (they hydrate client-side behind their gate), so a public
  // cell is what exercises the `__scrml_ssr_state` seed marker in web-app shape —
  // present here, absent in headless (the whole compose route is web-app-only).
  const publicAuthDecl = {
    kind: "state-decl", name: "publicCell", isServer: true, auth: "none",
    serverAuthorityTable: "widgets", init: "", span: span(75),
  };
  // Two §8.11 callable server-var decls → the synthetic `/__mountHydrate` route.
  const mh1 = { kind: "state-decl", name: "aCell", isServer: true, init: "loadA()", span: span(80) };
  const mh2 = { kind: "state-decl", name: "bCell", isServer: true, init: "loadB()", span: span(90) };
  // §38 channel → a `/_scrml_ws/private` WS upgrade route (shape-invariant) whose
  // cookie-auth guard is web-app-only.
  const channelNode = {
    kind: "markup", tag: "channel",
    attrs: [
      { name: "name", value: { kind: "string-literal", value: "private" } },
      { name: "topic", value: { kind: "string-literal", value: "secret" } },
    ],
    children: [], span: span(300),
  };

  const fileAST = {
    filePath: FP,
    nodes: [{ kind: "logic", body: [saveFn, serverAuthDecl, publicAuthDecl, mh1, mh2], span: span(0) }, channelNode],
    imports: [], exports: [], components: [], typeDecls: [],
    nodeTypes: new Map(), componentShapes: new Map(), scopeChain: null, spans: new Map(),
  };
  const routeMap = {
    functions: new Map([
      [`${FP}::50`, {
        functionNodeId: `${FP}::50`, boundary: "server", escalationReasons: [],
        generatedRouteName: "__ri_route_saveThing_1", serverEntrySpan: saveFn.span,
        isSSE: false, explicitMethod: "POST", explicitRoute: "/api/save", cpsSplit: null,
      }],
    ]),
  };
  return { fileAST, routeMap };
}

// ---------------------------------------------------------------------------
// §A — the headless entry emits routes + fetch + the endpoint & SSE handlers;
//      the web-app scaffold is present in web-app shape and OMITTED in headless.
// ---------------------------------------------------------------------------
describe("§A generateHeadlessServerJs: routes + fetch, NO html/client/CSRF/SSR", () => {
  beforeEach(() => resetVarCounter());

  test("emits the §61 endpoint handler + §37 SSE route + the WinterCG fetch aggregate", () => {
    const { fileAST, routeMap } = makeFixture();
    const headless = generateHeadlessServerJs(fileAST, routeMap, []);

    // The endpoint handler + its author-stable route (§61.7).
    expect(headless).toContain("async function _scrml_endpoint_fsp1(");
    expect(headless).toContain("export const __ri_route_endpoint_fsp1 = {");
    expect(headless).toContain('path: "/fsp"');
    // The SSE route mounts at the author path (§37).
    expect(headless).toContain('path: "/fsp/deltas"');
    // The state-mutating server-fn route.
    expect(headless).toContain('path: "/api/save"');
    // The WinterCG aggregate (§35 insight 22) — routes + fetch, shape-invariant.
    expect(headless).toContain("export const routes = [");
    expect(headless).toContain("export async function fetch(request) {");
    // Valid JS + no dangling reference (Finding 3 static detector).
    expect(() => assertParsesAsModule(headless)).not.toThrow();
    expect(findDanglingScrmlRefs(headless)).toEqual([]);
  });

  test("NON-VACUOUS PAIR: every cookie-session/CSRF/SSR/serverLoad/mount-hydrate marker present web-app, absent headless (incl. the §38 channel)", () => {
    const { fileAST, routeMap } = makeScaffoldRichFixture();
    const authMw = { auth: "required", csrf: "auto", loginRedirect: "/login", sessionExpiry: "2h" };

    resetVarCounter();
    const webApp = generateServerJs(fileAST, routeMap, [], authMw);
    resetVarCounter();
    const headless = generateServerJs(
      fileAST, routeMap, [], authMw, null, undefined, undefined, "browser", null, null, "headless",
    );

    // The PAIR: each scaffold marker MUST be present in web-app (else the absence
    // assertion is vacuous) AND absent in headless (the gate did its job). The
    // whole cookie-session machinery is UNIFORMLY absent in headless — definitions
    // AND references, HTTP routes AND the §38 WS auth guard.
    for (const marker of ALL_SCAFFOLD) {
      expect(webApp).toContain(marker);       // present in web-app — proves non-vacuity
      expect(headless).not.toContain(marker); // absent in headless — proves the gate
    }

    // The §38 channel WS upgrade route emits in BOTH shapes (channels are shape-
    // invariant) — but the cookie-auth guard reference is present in web-app and
    // ABSENT in headless (the round-1 regression, fixed the subtractive way).
    expect(webApp).toContain("_scrml_route_ws_private");
    expect(headless).toContain("_scrml_route_ws_private");
    expect(webApp).toContain("_scrml_auth_check(req)");     // cookie-auth guard present in web-app
    expect(headless).not.toContain("_scrml_auth_check(req)"); // …and gated OFF in headless

    // The headless `routes` array contains ONLY the app's declared routes (the POST
    // server-fn + the WS channel) — ZERO `_scrml_session_*` reserved HTTP routes.
    const headlessRoutes = (headless.match(/export const routes = \[[^\]]*\]/) || [""])[0];
    expect(headlessRoutes).toContain("__ri_route_saveThing_1");
    expect(headlessRoutes).toContain("_scrml_route_ws_private");
    expect(headlessRoutes).not.toContain("_scrml_session_destroy");
    expect(headlessRoutes).not.toContain("_scrml_session_projection");
    expect(headlessRoutes).not.toContain("_scrml_route___serverLoad");
    expect(headlessRoutes).not.toContain("_scrml_route___mountHydrate");

    // Headless still emits fetch, and has NO dangling reference.
    expect(headless).toContain("export async function fetch(request) {");
    expect(findDanglingScrmlRefs(headless)).toEqual([]);
    expect(() => assertParsesAsModule(headless)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §B — LOAD-BEARING gate proof (baseline CSRF). SAME inputs, shape flips.
// ---------------------------------------------------------------------------
describe("§B shape gate is load-bearing: baseline CSRF present web-app / absent headless", () => {
  beforeEach(() => resetVarCounter());

  test("no-auth state-mutating POST route: web-app emits baseline CSRF, headless suppresses it", () => {
    const { fileAST, routeMap } = makeFixture();

    resetVarCounter();
    const webApp = generateServerJs(fileAST, routeMap, [], null);
    resetVarCounter();
    // Same inputs, only programShape differs (positional #11).
    const headless = generateServerJs(
      fileAST, routeMap, [], null, null, undefined, undefined, "browser", null, null, "headless",
    );

    // Web-app: the POST /api/save handler carries the double-submit cookie CSRF.
    expect(webApp).toContain("_scrml_validate_csrf");
    expect(webApp).toContain("_scrml_ensure_csrf_cookie");
    // Headless: the SAME route emits with NO CSRF.
    expect(headless).not.toContain("_scrml_validate_csrf");
    expect(headless).not.toContain("_scrml_ensure_csrf_cookie");

    // The ROUTES are shape-invariant — both shapes mount the same handlers.
    for (const out of [webApp, headless]) {
      expect(out).toContain("export const __ri_route_endpoint_fsp1 = {");
      expect(out).toContain('path: "/fsp/deltas"');
      expect(out).toContain('path: "/api/save"');
      expect(out).toContain("export async function fetch(request) {");
    }
    expect(() => assertParsesAsModule(headless)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §C — LOAD-BEARING gate proof (session/CSRF middleware + §52.8 SSR compose).
//      An `auth=`/`csrf="auto"` middleware entry triggers BOTH the session store
//      + CSRF middleware AND the SSR CSRF-meta HTML-composition route in web-app
//      shape; the headless shape suppresses both — and stays valid JS (no dangling
//      reference to the suppressed `_scrml_session_middleware`).
// ---------------------------------------------------------------------------
describe("§C shape gate is load-bearing: session/CSRF + SSR compose present web-app / absent headless", () => {
  beforeEach(() => resetVarCounter());

  const authMw = { auth: "required", csrf: "auto", loginRedirect: "/login", sessionExpiry: "2h" };

  test("auth+csrf: web-app emits session middleware + SSR compose route; headless emits neither", () => {
    const { fileAST, routeMap } = makeFixture();

    resetVarCounter();
    const webApp = generateServerJs(fileAST, routeMap, [], authMw);
    resetVarCounter();
    const headless = generateServerJs(
      fileAST, routeMap, [], authMw, null, undefined, undefined, "browser", null, null, "headless",
    );

    // The PAIR — each cookie-session / CSRF / SSR-compose symbol this endpoint+SSE
    // fixture emits under authMw: PRESENT in web-app (non-vacuous) AND ABSENT in
    // headless (the gate). (serverLoad/mount-hydrate/@currentUser need §52 decls
    // this fixture lacks — those are paired on the scaffold-rich fixture in §A.)
    const SESSION_SCAFFOLD = [
      "_scrml_session_middleware", "_scrml_session_store", "_scrml_session_expiry",
      "_scrml_auth_check", "_scrml_generate_csrf", "_scrml_validate_csrf",
      "_scrml_session_destroy", "_scrml_session_projection",
      "SSR pre-render", "text/html",
    ];
    for (const sym of SESSION_SCAFFOLD) {
      expect(webApp).toContain(sym);       // present in web-app — proves non-vacuity
      expect(headless).not.toContain(sym); // absent in headless — proves the gate
    }

    // Routes still present in BOTH shapes.
    expect(webApp).toContain("export async function fetch(request) {");
    expect(headless).toContain("export async function fetch(request) {");
    expect(headless).toContain("export const __ri_route_endpoint_fsp1 = {");

    // The critical no-dangling-reference guard: suppressing the session infra
    // must not leave a reference to an undefined symbol (Finding 3 — the SCOPE-AWARE
    // static detector, not a syntax-only parse which cannot see this).
    expect(() => assertParsesAsModule(headless)).not.toThrow();
    expect(findDanglingScrmlRefs(headless)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §D — the §38 channel-WS auth-check regression (adversarial-review Finding 1).
//
// The §38 channel WS upgrade gate references the cookie-session `_scrml_auth_check`
// guard when a program carries route-auth (`hasAuth = !!authMiddlewareEntry`). The
// CORRECT model (round-3 design correction): a headless listener-owning program has
// NO cookie-session auth AT ALL — bearer is the (later-unit) headless auth story. So
// in headless the WS route emits WITHOUT the cookie-auth reference (gated off in
// lockstep with the suppressed definition) — uniformly absent, no dangling. The
// round-2 "emit the chain for the channel" was wrong (it dragged cookie auth into
// headless); this asserts the subtractive result.
// ---------------------------------------------------------------------------
function makeChannelAuthFixture() {
  const channelNode = {
    kind: "markup", tag: "channel",
    attrs: [
      { name: "name", value: { kind: "string-literal", value: "private" } },
      { name: "topic", value: { kind: "string-literal", value: "secret" } },
    ],
    children: [], span: span(300),
  };
  const saveFn = {
    kind: "function-decl", name: "saveThing", params: ["name"], body: [],
    fnKind: "function", isServer: true, isGenerator: false, canFail: false, errorType: null,
    route: "/api/save", method: "POST", span: span(50),
  };
  const fileAST = {
    filePath: FP,
    nodes: [{ kind: "logic", body: [saveFn], span: span(0) }, channelNode],
    imports: [], exports: [], components: [], typeDecls: [],
    nodeTypes: new Map(), componentShapes: new Map(), scopeChain: null, spans: new Map(),
  };
  const routeMap = {
    functions: new Map([
      [`${FP}::50`, {
        functionNodeId: `${FP}::50`, boundary: "server", escalationReasons: [],
        generatedRouteName: "__ri_route_saveThing_1", serverEntrySpan: saveFn.span,
        isSSE: false, explicitMethod: "POST", explicitRoute: "/api/save", cpsSplit: null,
      }],
    ]),
  };
  return { fileAST, routeMap };
}

describe("§D scope-aware detector + §38 channel-WS carries NO cookie-auth in headless", () => {
  beforeEach(() => resetVarCounter());

  const authMw = { auth: "required", csrf: "auto", loginRedirect: "/login", sessionExpiry: "2h" };

  test("detector self-check: flags a genuinely-undefined _scrml_ helper, passes when defined", () => {
    const bad = "function f(){ return _scrml_missing_helper(1); }\nconst _scrml_x = 1;\n";
    expect(findDanglingScrmlRefs(bad)).toContain("_scrml_missing_helper");
    const good = "function _scrml_missing_helper(n){ return n; }\nfunction f(){ return _scrml_missing_helper(1); }\n";
    expect(findDanglingScrmlRefs(good)).toEqual([]);
  });

  test("detector is SCOPE-AWARE: a same-name local in an UNRELATED function does NOT mask a top-level dangling ref (Finding 2)", () => {
    // `_scrml_foo` is referenced at module scope (in `caller`) with NO top-level
    // definition; a `const _scrml_foo` local inside the UNRELATED `other` must not
    // mask it. A scope-BLIND (flat-declared-set) detector would wrongly pass here.
    const src = [
      "function caller(){ return _scrml_foo(1); }",   // top-level ref, unresolved
      "function other(){ const _scrml_foo = 42; return _scrml_foo; }", // sibling local
      "export const routes = [];",
    ].join("\n");
    expect(findDanglingScrmlRefs(src)).toContain("_scrml_foo");

    // Control: when `_scrml_foo` IS a top-level definition, the same shape resolves.
    const okSrc = [
      "function _scrml_foo(n){ return n; }",
      "function caller(){ return _scrml_foo(1); }",
      "function other(){ const _scrml_foo = 42; return _scrml_foo; }",
    ].join("\n");
    expect(findDanglingScrmlRefs(okSrc)).toEqual([]);

    // Nested resolution: a call INSIDE a deeply-nested function still resolves
    // against a TOP-LEVEL def (the exact §38 channel-WS handler-arrow shape).
    const nestedSrc = [
      "function _scrml_auth_check(req){ return null; }",
      "export const r = { handler: (req, server) => { const x = _scrml_auth_check(req); return x; } };",
    ].join("\n");
    expect(findDanglingScrmlRefs(nestedSrc)).toEqual([]);
  });

  test("INVERTED (round-3): channel + route-auth compiled headless emits the WS route with NO cookie-auth chain and NO session routes", () => {
    const { fileAST, routeMap } = makeChannelAuthFixture();

    resetVarCounter();
    const webApp = generateServerJs(fileAST, routeMap, [], authMw);
    resetVarCounter();
    const headless = generateServerJs(
      fileAST, routeMap, [], authMw, null, undefined, undefined, "browser", null, null, "headless",
    );

    // The §38 WS upgrade route emits in BOTH shapes (channels are shape-invariant).
    expect(webApp).toContain("_scrml_route_ws_private");
    expect(headless).toContain("_scrml_route_ws_private");

    // The cookie-auth guard is PRESENT in web-app and ABSENT in headless (the PAIR).
    expect(webApp).toContain("_scrml_auth_check(req)");
    expect(headless).not.toContain("_scrml_auth_check(req)");
    // …and NO cookie-session definition/chain survives in headless.
    for (const sym of ["_scrml_auth_check", "_scrml_session_middleware", "_scrml_session_store",
                       "_scrml_generate_csrf", "_scrml_validate_csrf"]) {
      expect(webApp).toContain(sym);        // present web-app — non-vacuous
      expect(headless).not.toContain(sym);  // uniformly absent headless
    }

    // The headless `routes` array = ONLY the app's declared routes; ZERO reserved
    // `_scrml_session_*` HTTP routes.
    const headlessRoutes = (headless.match(/export const routes = \[[^\]]*\]/) || [""])[0];
    expect(headlessRoutes).toBe("export const routes = [__ri_route_saveThing_1, _scrml_route_ws_private]");
    expect(headlessRoutes).not.toContain("_scrml_session_destroy");
    expect(headlessRoutes).not.toContain("_scrml_session_projection");

    // No dangling reference, valid module — in BOTH shapes.
    expect(findDanglingScrmlRefs(headless)).toEqual([]);
    expect(findDanglingScrmlRefs(webApp)).toEqual([]);
    expect(() => assertParsesAsModule(headless)).not.toThrow();
  });
});
