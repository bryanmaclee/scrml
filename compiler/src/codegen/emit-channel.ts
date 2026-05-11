import { genVar } from "./var-counter.ts";
import { emitLogicNode } from "./emit-logic.js";
import { CGError } from "./errors.ts";

/**
 * §38 `<channel>` — WebSocket state type codegen.
 *
 * `<channel>` is a lifecycle markup element that generates persistent WebSocket
 * infrastructure. It emits no HTML. Like `<timer>` and `<poll>`, the AST node is
 * `kind: "markup", tag: "channel"`.
 *
 * Three codegen functions are exported:
 *
 * 1. `collectChannelNodes(nodes)` — walk AST, collect all channel markup nodes
 * 2. `emitChannelClientJs(node, errors, filePath)` — client-side WebSocket setup
 * 3. `emitChannelServerJs(node, errors, filePath)` — server-side upgrade route
 * 4. `emitChannelWsHandlers(nodes, errors, filePath)` — merged Bun.serve() websocket: block
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelAttrs {
  name: string;
  safeName: string;
  topic: string;
  reconnectMs: number;
  /** True when the `<channel>` carries its own `auth=` attribute (§52.13). */
  hasChannelAuth: boolean;
  hasPresence: boolean;
}

interface ChannelHandlers {
  open: string | null;
  message: string | null;
  close: string | null;
}

// ---------------------------------------------------------------------------
// Channel node collection
// ---------------------------------------------------------------------------

/**
 * Walk an AST node tree and collect all `<channel>` markup nodes.
 *
 * P3.A: channels marked `_p3aIsExport: true` are EXPORTER-side declarations
 * that have been inlined into every consumer by CHX (CE phase 2). Including
 * them in this file's emit set would duplicate the WS routes and `@shared`
 * mirrors. Per P3 dive §6.2 step 9 (PURE-CHANNEL-FILE recognition), the
 * exporter file emits no per-channel artifacts; codegen happens at the
 * inlined-consumer site. We filter exported channels here so the rest of
 * the channel emit pipeline (`emitChannelClientJs`, `emitChannelServerJs`,
 * `emitChannelWsHandlers`) sees only locally-declared (per-page) channels
 * AND the inlined copies that landed in consumer files via CHX.
 */
export function collectChannelNodes(nodes: any[]): any[] {
  const result: any[] = [];

  function visit(nodeList: any[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;

      if (node.kind === "markup") {
        if ((node.tag ?? "") === "channel") {
          // P3.A: skip the exporter's own channel emit; consumers' inlined
          // copies (which lack the _p3aIsExport flag) emit the WS layer.
          if (node._p3aIsExport !== true) {
            result.push(node);
          }
        }
        if (Array.isArray(node.children)) {
          visit(node.children);
        }
        continue;
      }

      if (node.kind === "logic" && Array.isArray(node.body)) {
        continue;
      }

      if (Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  }

  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Channel attribute extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract channel attributes from a `<channel>` markup node.
 */
function extractChannelAttrs(node: any): ChannelAttrs {
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  const nameAttr = attrMap.get("name");
  let name = "channel";
  if (nameAttr) {
    const v = nameAttr.value;
    if (v?.kind === "string-literal") name = v.value;
    else if (v?.kind === "variable-ref") name = (v.name ?? "").replace(/^@/, "");
    else if (typeof v === "string") name = v;
  }

  const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_");

  const topicAttr = attrMap.get("topic");
  let topic = name;
  if (topicAttr) {
    const v = topicAttr.value;
    if (v?.kind === "string-literal") topic = v.value;
    else if (v?.kind === "variable-ref") topic = (v.name ?? "").replace(/^@/, "");
    else if (typeof v === "string") topic = v;
  }

  const reconnAttr = attrMap.get("reconnect");
  let reconnectMs = 2000;
  if (reconnAttr) {
    const v = reconnAttr.value;
    const raw = v?.kind === "string-literal" ? v.value : (v?.name ?? "").replace(/^@/, "");
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) reconnectMs = parsed;
  }

  // S80 (2026-05-11): <channel auth=> replaces the legacy <channel protect=>
  // WS-upgrade gate per §38.5 + §52.13.
  const hasChannelAuth = attrMap.has("auth");
  const hasPresence = attrMap.has("presence");

  return { name, safeName, topic, reconnectMs, hasChannelAuth, hasPresence };
}

/**
 * Extract `onserver:` lifecycle attribute handlers from a channel node.
 * These are server-side handlers used in `_scrml_ws_handlers` (Bun WebSocket server callbacks).
 */
function extractChannelHandlers(node: any): ChannelHandlers {
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  function attrToCall(attr: any): string | null {
    if (!attr) return null;
    const v = attr.value;
    if (!v) return null;
    if (v.kind === "call") return `${v.name}(${v.args ?? ""})`;
    if (v.kind === "variable-ref") return `${v.name}()`;
    if (v.kind === "string-literal") return v.value;
    return null;
  }

  return {
    open: attrToCall(attrMap.get("onserver:open")),
    message: attrToCall(attrMap.get("onserver:message")),
    close: attrToCall(attrMap.get("onserver:close")),
  };
}

/**
 * Extract `onclient:` lifecycle attribute handlers from a channel node.
 * These are client-side handlers wired to the browser WebSocket events.
 *
 * Bug 4 fix: The original code used `extractChannelHandlers` (onserver:*) for the
 * client-side browser WebSocket events — that was wrong. onclient:open/close/error
 * are distinct from onserver:open/message/close.
 */
function extractClientHandlers(node: any): { open: string | null; close: string | null; error: string | null } {
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  function attrToCall(attr: any): string | null {
    if (!attr) return null;
    const v = attr.value;
    if (!v) return null;
    if (v.kind === "call") return `${v.name}(${v.args ?? ""})`;
    if (v.kind === "variable-ref") return `${v.name}()`;
    if (v.kind === "string-literal") return v.value;
    return null;
  }

  return {
    open: attrToCall(attrMap.get("onclient:open")),
    close: attrToCall(attrMap.get("onclient:close")),
    error: attrToCall(attrMap.get("onclient:error")),
  };
}

/**
 * Extract auto-syncing channel-cell variable names from a channel node's body.
 *
 * Per SPEC §38.4 (M19 / B19, S57+): every V5-strict state-decl declared
 * inside a `<channel>` body auto-syncs across all subscribed clients. The
 * `@shared` modifier is removed in v0.next; presence inside the channel body
 * is the sync trigger. State-decls carry `structuralForm: true` (§6.1) under
 * V5-strict — the canonical shape `<x> = init`.
 *
 * For backcompat we also accept the legacy `isShared: true` flag (older
 * AST shapes), but the canonical v0.next path is `structuralForm: true`.
 * LOCALS declared inside `${ }` logic blocks (`let x = ...`, `const x = ...`)
 * do NOT auto-sync — only structural state-decls do.
 *
 * Note: the export name `extractSharedVars` is preserved for backcompat with
 * any in-tree callers; the function now returns the V5-strict cell set.
 */
export function extractSharedVars(node: any): string[] {
  const cells: string[] = [];
  const children: any[] = node.children ?? [];

  function walkForCells(nodeList: any[]): void {
    for (const n of nodeList) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "state-decl") {
        // V5-strict (§38.4): structural state-decls auto-sync.
        // Legacy: isShared:true (pre-M19).
        if (n.structuralForm === true || n.isShared === true) {
          cells.push(n.name ?? "");
        }
      }
      if (Array.isArray(n.children)) walkForCells(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) walkForCells(n.body);
    }
  }

  walkForCells(children);
  return cells.filter(Boolean);
}

/**
 * Alias of {@link extractSharedVars} with a v0.next-canonical name. Returns
 * the auto-syncing channel-cell variable names declared inside a channel body
 * (V5-strict state-decls per §38.4).
 */
export const extractChannelCells = extractSharedVars;

/**
 * Walk an AST and produce a map from function name to the channel-name that
 * lexically owns it. A function is "channel-owned" when its declaration
 * appears inside a `<channel>` body (per §38.6: "any server-annotated function
 * or handler whose declaration appears within the lexical scope of a
 * `<channel>` body").
 *
 * Inputs to the C18 implementation:
 *   - `broadcast(data)` and `disconnect()` are auto-injected as locals in
 *     channel-owned server function emit (§38.6, §38.6.1).
 *   - Channel-owned server functions writing to channel-cells (§38.4) are
 *     legitimate (they propagate via the broadcast wire); RI's E-RI-002
 *     guard skips channel-owned cell writes.
 *   - Calls to `broadcast()` / `disconnect()` from a function NOT in this map
 *     fire E-CHANNEL-004.
 *
 * Returns a Map keyed by function name (string) → channel name (string).
 * If two channels both declare a function with the same name, the latter
 * wins; collisions of this kind are rare (and would already be caught by
 * the typer's duplicate-function-decl check).
 */
export function collectChannelFunctionMap(nodes: any[]): Map<string, string> {
  const result = new Map<string, string>();

  function visitInsideChannel(nodeList: any[], channelName: string): void {
    for (const n of nodeList) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "function-decl" && typeof n.name === "string" && n.name.length > 0) {
        result.set(n.name, channelName);
      }
      if (Array.isArray(n.children)) visitInsideChannel(n.children, channelName);
      if (n.kind === "logic" && Array.isArray(n.body)) visitInsideChannel(n.body, channelName);
    }
  }

  function visit(nodeList: any[]): void {
    for (const n of nodeList) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "markup" && (n.tag ?? "") === "channel") {
        // Skip P3.A exporter copies (per collectChannelNodes filter).
        if (n._p3aIsExport === true) continue;
        const { name } = extractChannelAttrs(n);
        if (Array.isArray(n.children)) visitInsideChannel(n.children, name);
        continue;
      }
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
    }
  }

  visit(nodes);
  return result;
}

/**
 * Walk an AST and produce a map from channel name to the set of state-decl
 * cell names declared inside that channel's body (V5-strict §38.4 cells).
 * Used by RI to skip E-RI-002 on channel-owned server functions writing
 * to channel-owned cells (the writes propagate via the broadcast wire).
 *
 * Returns a Map<channelName, Set<cellName>>.
 */
export function collectChannelCellMap(nodes: any[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  function visit(nodeList: any[]): void {
    for (const n of nodeList) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "markup" && (n.tag ?? "") === "channel") {
        if (n._p3aIsExport === true) continue;
        const { name } = extractChannelAttrs(n);
        const cells = new Set<string>(extractSharedVars(n));
        result.set(name, cells);
        continue;
      }
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
    }
  }

  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Client JS emission
// ---------------------------------------------------------------------------

/**
 * Emit client-side JavaScript for a single `<channel>` node.
 */
export function emitChannelClientJs(node: any, errors: CGError[], filePath: string): string[] {
  const lines: string[] = [];
  const { name, safeName, topic, reconnectMs } = extractChannelAttrs(node);
  // Bug 4 fix: use onclient:* handlers for client-side browser WebSocket events.
  const { open: clientOpenHandler, close: clientCloseHandler, error: clientErrorHandler } = extractClientHandlers(node);
  const sharedVars = extractSharedVars(node);

  const varName = `_scrml_ws_${safeName}`;
  const wsVar = "_ws";
  const reconnVar = "_reconn";
  const connectFn = "_connect";

  lines.push(`// <channel name="${name}" topic="${topic}"> — WebSocket client (§38)`);
  lines.push(`const ${varName} = (() => {`);
  lines.push(`  let ${wsVar}, ${reconnVar};`);
  lines.push(`  function ${connectFn}() {`);
  // Bug 3 fix: use protocol-relative WebSocket URL (ws:// on HTTP, wss:// on HTTPS).
  lines.push(`    ${wsVar} = new WebSocket(\`\${location.protocol === 'https:' ? 'wss' : 'ws'}://\${location.host}/_scrml_ws/${safeName}\`);`);

  if (clientOpenHandler) {
    lines.push(`    ${wsVar}.onopen = () => { ${clientOpenHandler}; };`);
  } else {
    lines.push(`    ${wsVar}.onopen = () => {};`);
  }

  lines.push(`    ${wsVar}.onmessage = (e) => {`);
  lines.push(`      try {`);
  lines.push(`        const _d = JSON.parse(e.data);`);

  if (sharedVars.length > 0) {
    lines.push(`        if (_d.__type === "__sync") {`);
    lines.push(`          // §38.4 channel-cell sync from server (V5-strict auto-sync)`);
    for (const varN of sharedVars) {
      lines.push(`          if (_d.__key === ${JSON.stringify(varN)}) _scrml_reactive_set(${JSON.stringify(varN)}, _d.__val);`);
    }
    lines.push(`          return;`);
    lines.push(`        }`);
  }

  lines.push(`      } catch (_e) {}`);
  lines.push(`    };`);

  if (clientErrorHandler) {
    lines.push(`    ${wsVar}.onerror = (err) => { ${clientErrorHandler}; };`);
  }

  if (reconnectMs > 0) {
    if (clientCloseHandler) {
      lines.push(`    ${wsVar}.onclose = () => { ${clientCloseHandler}; ${reconnVar} = setTimeout(${connectFn}, ${reconnectMs}); };`);
    } else {
      lines.push(`    ${wsVar}.onclose = () => { ${reconnVar} = setTimeout(${connectFn}, ${reconnectMs}); };`);
    }
  } else {
    if (clientCloseHandler) {
      lines.push(`    ${wsVar}.onclose = () => { ${clientCloseHandler}; };`);
    } else {
      lines.push(`    ${wsVar}.onclose = () => {};`);
    }
  }

  lines.push(`  }`);
  lines.push(`  ${connectFn}();`);
  lines.push(`  _scrml_register_cleanup(() => { ${wsVar}?.close(); clearTimeout(${reconnVar}); });`);
  lines.push(`  return {`);
  lines.push(`    send: (d) => ${wsVar}?.readyState === 1 && ${wsVar}.send(JSON.stringify(d)),`);
  lines.push(`    close: () => ${wsVar}?.close(),`);

  if (sharedVars.length > 0) {
    lines.push(`    syncShared: (key, val) => ${wsVar}?.readyState === 1 &&`);
    lines.push(`      ${wsVar}.send(JSON.stringify({ __type: "__sync", __key: key, __val: val })),`);
  }

  lines.push(`  };`);
  lines.push(`})();`);

  if (sharedVars.length > 0) {
    lines.push(`// §38.4 channel-cell auto-sync effects for <channel name="${name}">`);
    for (const varN of sharedVars) {
      lines.push(`_scrml_effect(() => ${varName}.syncShared(${JSON.stringify(varN)}, _scrml_reactive_get(${JSON.stringify(varN)})));`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Server route emission
// ---------------------------------------------------------------------------

/**
 * Emit server-side JavaScript for a single `<channel>` node.
 *
 * Bug 2 fix: The original code emitted `routes.push({...})` — `routes` is never
 * declared in .server.js files. All other routes are emitted as
 * `export const _scrml_route_XXX = { path, method, handler }` so that
 * `discoverServerRoutes` (build.js) and `loadServerRoutes` (dev.js) can find them.
 * Channel WS upgrade routes must follow the same pattern.
 */
export function emitChannelServerJs(node: any, errors: CGError[], filePath: string, hasAuth = false): string[] {
  const lines: string[] = [];
  const { name, safeName, topic, hasChannelAuth } = extractChannelAttrs(node);

  const path = `/_scrml_ws/${safeName}`;
  // Route export name follows the same convention as HTTP routes: _scrml_route_ws_<safeName>
  const routeExportName = `_scrml_route_ws_${safeName}`;

  lines.push(`// <channel name="${name}"> — WebSocket upgrade route (§38)`);
  lines.push(`export const ${routeExportName} = {`);
  lines.push(`  path: ${JSON.stringify(path)},`);
  lines.push(`  method: "GET",`);
  lines.push(`  isWebSocket: true,`);
  lines.push(`  handler: (req, server) => {`);

  if (hasAuth || hasChannelAuth) {
    lines.push(`    // Auth check for WebSocket upgrade (§38.5)`);
    lines.push(`    const _authResult = _scrml_auth_check(req);`);
    lines.push(`    if (_authResult) return _authResult;`);
  }

  lines.push(`    const ok = server.upgrade(req, { data: { __ch: ${JSON.stringify(name)}, __topic: ${JSON.stringify(topic)} } });`);
  lines.push(`    return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });`);
  lines.push(`  },`);
  lines.push(`};`);

  return lines;
}

// ---------------------------------------------------------------------------
// WebSocket handlers object emission
// ---------------------------------------------------------------------------

/**
 * Emit the merged `_scrml_ws_handlers` export for all channels in a file.
 *
 * Bug 5 fix: `close` handler signature updated to `close(ws, code, reason)` to
 * match Bun's WebSocket close handler signature. Previously emitted `close(ws)`,
 * which dropped the close code and reason.
 */
export function emitChannelWsHandlers(channelNodes: any[], errors: CGError[], filePath: string): string[] {
  if (channelNodes.length === 0) return [];

  const lines: string[] = [];
  lines.push(`// WebSocket handlers for ${channelNodes.length} channel(s) — passed to Bun.serve() websocket:`);
  lines.push(`export const _scrml_ws_handlers = {`);

  // open
  lines.push(`  open(ws) {`);
  lines.push(`    ws.subscribe(ws.data.__topic);`);
  for (const node of channelNodes) {
    const { name } = extractChannelAttrs(node);
    const { open: openHandler } = extractChannelHandlers(node);
    if (openHandler) {
      lines.push(`    if (ws.data.__ch === ${JSON.stringify(name)}) { ${openHandler}; }`);
    }
  }
  lines.push(`  },`);

  // message
  lines.push(`  message(ws, raw) {`);
  lines.push(`    try {`);
  lines.push(`      const d = JSON.parse(raw);`);
  lines.push(`      const __ch = ws.data.__ch;`);
  for (const node of channelNodes) {
    const { name } = extractChannelAttrs(node);
    const { message: msgHandler } = extractChannelHandlers(node);
    const sharedVars = extractSharedVars(node);

    lines.push(`      if (__ch === ${JSON.stringify(name)}) {`);

    if (sharedVars.length > 0) {
      lines.push(`        if (d.__type === "__sync") {`);
      lines.push(`          // §38.4 broadcast channel-cell sync to all other subscribers`);
      lines.push(`          ws.publish(ws.data.__topic, raw);`);
      lines.push(`          return;`);
      lines.push(`        }`);
    }

    if (msgHandler) {
      lines.push(`        ${msgHandler};`);
    }

    lines.push(`      }`);
  }
  lines.push(`    } catch (_e) {}`);
  lines.push(`  },`);

  // close — Bug 5 fix: include code and reason params (Bun passes them)
  lines.push(`  close(ws, code, reason) {`);
  lines.push(`    ws.unsubscribe(ws.data.__topic);`);
  for (const node of channelNodes) {
    const { name } = extractChannelAttrs(node);
    const { close: closeHandler } = extractChannelHandlers(node);
    if (closeHandler) {
      lines.push(`    if (ws.data.__ch === ${JSON.stringify(name)}) { ${closeHandler}; }`);
    }
  }
  lines.push(`  },`);

  lines.push(`};`);

  return lines;
}
