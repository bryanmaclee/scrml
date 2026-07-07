import { genVar } from "./var-counter.ts";
import { emitLogicNode } from "./emit-logic.js";
import { emitExprField } from "./emit-expr.ts";
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
  /**
   * The binding name for the `onserver:message` payload (the parameter in the
   * call expression, e.g. `msg` in `onserver:message=handleMessage(msg)`).
   * Per §38.6.1 the server `message()` handler binds this name to
   * `JSON.parse(raw)` before invoking the handler. `null` when the message
   * handler is absent or takes no parameter.
   */
  messageParam: string | null;
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
// Import-emit suppression (cross-file channel imports)
// ---------------------------------------------------------------------------

/**
 * Type alias for MOD's exportRegistry shape, matching `CompileContext.exportRegistry`.
 */
type CrossFileExportRegistry = Map<
  string,
  Map<string, { kind: string; category: string; isComponent: boolean }>
>;

/**
 * Given a single import-decl statement (from `fileAST.ast.imports`), filter out
 * any specifier whose imported name resolves to a `<channel>` export in MOD's
 * exportRegistry. Returns the remaining (non-channel) specifiers — caller emits
 * the JS `import { ... } from "..."` over these, or skips emission entirely
 * when the result is empty.
 *
 * Why this exists (Task #17, S85): a consumer file using
 *   ${ import { "dispatch-board" as dispatchBoard } from './channels/x.scrml' }
 * was producing an emitted line like
 *   import { dispatch-board } from "./channels/x.server.js";
 * — a JS SyntaxError ("Unexpected token '-'"). Quoting the name would only
 * promote the error to a module-link failure, because the channel's compiled
 * exporter does NOT bind the channel name as an ES export — channels are
 * inlined by CHX at the consumer site, not resolved via module bindings.
 * The correct fix is therefore to suppress JS import emission for the
 * channel-only specifiers entirely.
 *
 * Path-shape resilience: production exportRegistry is keyed by ABSOLUTE
 * post-resolveModulePath paths; unit-test harnesses sometimes use relative
 * keys. We try both, mirroring `collectCrossFileEngineMounts` in emit-engine.ts.
 *
 * Falls back to a syntactic check when no exportRegistry is provided: if an
 * imported name contains characters that are not valid in a JS IdentifierName
 * (e.g., `-`, `.`), we assume it's a string-literal channel import and drop
 * it — emitting `import { kebab-name } from ...` is never valid JS.
 *
 * @param stmt — the import-decl or use-decl AST node
 * @param importerPath — absolute path of the file containing the import
 * @param exportRegistry — MOD's exportRegistry (may be null in tests)
 * @returns filtered specifiers: [{imported, local}] for each non-channel
 *          binding, in original order. Empty array means the import should
 *          be skipped entirely.
 */
export function filterChannelImportSpecifiers(
  stmt: any,
  importerPath: string | null | undefined,
  exportRegistry: CrossFileExportRegistry | null | undefined,
): Array<{ imported: string; local: string }> {
  // Specifier source-of-truth: prefer `stmt.specifiers` (carries `{imported,
  // local}`); fall back to `stmt.names` (legacy / use-decl shape).
  const specs: Array<{ imported: string; local: string }> = Array.isArray(stmt.specifiers) && stmt.specifiers.length > 0
    ? stmt.specifiers.map((s: any) => ({ imported: String(s.imported), local: String(s.local ?? s.imported) }))
    : (Array.isArray(stmt.names) ? stmt.names.map((n: string) => ({ imported: n, local: n })) : []);

  if (specs.length === 0) return [];

  const sourcePath: string = stmt.source ?? "";
  // Non-.scrml sources (scrml:*, vendor:*, plain JS) — pass through unchanged.
  if (!sourcePath.endsWith(".scrml")) return specs;

  // Try exportRegistry lookup first (the authoritative signal).
  let sourceMap: Map<string, { kind: string; category: string; isComponent: boolean }> | undefined;
  if (exportRegistry) {
    sourceMap = exportRegistry.get(sourcePath);
    if ((!sourceMap || sourceMap.size === 0) && importerPath && (sourcePath.startsWith("./") || sourcePath.startsWith("../"))) {
      // Resolve relative → absolute via module-resolver. Lazy require to
      // avoid the static dependency at this codegen module's import time
      // (mirrors emit-engine.ts:2484).
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { resolveModulePath } = require("../module-resolver.js");
        const absSource: string = resolveModulePath(sourcePath, importerPath);
        sourceMap = exportRegistry.get(absSource);
      } catch {
        // resolveModulePath unavailable or threw — fall through to the
        // syntactic fallback below.
      }
    }
  }

  return specs.filter(({ imported }) => {
    // (1) authoritative — exportRegistry says category === "channel".
    if (sourceMap) {
      const entry = sourceMap.get(imported);
      if (entry && entry.category === "channel") return false;
    }
    // (2) syntactic fallback — when no registry is available (tests, isolated
    // codegen calls). Channel names are quoted in source because they aren't
    // valid JS IdentifierNames; if we still see a non-identifier here, it
    // must be a channel binding that we cannot validly emit as a JS import.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(imported)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Channel attribute extraction helpers
// ---------------------------------------------------------------------------

/**
 * S81 audit fix F.2 — parse `<program channel-reconnect="...">` raw value
 * into a millisecond integer, or `null` for fall-back-to-default-2000.
 *
 * Accepted shapes (same as parseIdempotencyTtl in emit-server.ts MINUS `d`
 * suffix — channel reconnect at day-scale is structurally suspicious; if a
 * real use case emerges the suffix grammar can be extended):
 *   - bare integer ("500", "5000") → that many millis
 *   - duration string with unit suffix "Nms" / "Ns" / "Nm" / "Nh"
 *
 * Returns null when raw is null/empty/malformed — caller falls back to the
 * 2000ms default with no diagnostic per §38.3.1 amendment v1 scope.
 */
export function parseChannelReconnect(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const m = trimmed.match(/^(\d+)\s*(ms|s|m|h)$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
  };
  const mult = multipliers[unit];
  return mult !== undefined ? n * mult : null;
}

/**
 * Extract channel attributes from a `<channel>` markup node.
 *
 * Accepts an optional `projectReconnectDefault` (millis) — when the per-channel
 * `reconnect=` attribute is absent, the project-level default from
 * `<program channel-reconnect=>` (§38.3.1) is used. When BOTH are absent the
 * hardcoded `2000` ms default applies. Per-channel `reconnect=` always wins
 * when present (per §38.3.1 normative).
 */
function extractChannelAttrs(node: any, projectReconnectDefault: number | null = null): ChannelAttrs {
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

  // S81 audit fix F.2 (§38.3.1) precedence chain:
  //   1. per-channel <channel reconnect=N>  (winner when present + parseable)
  //   2. project-level <program channel-reconnect=N>  (when per-channel absent)
  //   3. hardcoded 2000 ms  (when both absent)
  const reconnAttr = attrMap.get("reconnect");
  let reconnectMs = projectReconnectDefault !== null ? projectReconnectDefault : 2000;
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
 * Lower a channel lifecycle-handler attribute value to a JS call-expression
 * string (`handler(arg, ...)`), or `null` when the attribute is absent.
 *
 * Bug 2 (channel-codegen-fixes-2026-06-12): a real-source handler attribute
 * (`onserver:message=handleMessage(msg)` / `onclient:open=onOpen()`) parses to
 * `kind:"call-ref"` with `name` + an `args` ARRAY. Before this fix the
 * extractors only recognized the synthetic `kind:"call"` (string `args`), so a
 * real-source handler returned `null` and emitted an EMPTY listener. We handle
 * `call-ref` (array args) alongside the legacy `call` (string args) /
 * `variable-ref` (bare name) / `string-literal` shapes.
 */
function channelAttrToCall(attr: any): string | null {
  if (!attr) return null;
  const v = attr.value;
  if (!v) return null;
  // Real-source parse shape: kind:"call-ref", args is an array of arg strings.
  if (v.kind === "call-ref") {
    const args = Array.isArray(v.args) ? v.args.join(", ") : "";
    return `${v.name}(${args})`;
  }
  // Synthetic / legacy parse shape: kind:"call", args is a pre-joined string.
  if (v.kind === "call") return `${v.name}(${v.args ?? ""})`;
  if (v.kind === "variable-ref") return `${v.name}()`;
  if (v.kind === "string-literal") return v.value;
  return null;
}

/**
 * Extract the first parameter name from a channel handler attribute value
 * (the §38.6.1 / §38.10.1 payload/event binding name). Returns `null` when the
 * handler is absent or takes no parameter.
 */
function channelAttrParam(attr: any): string | null {
  if (!attr) return null;
  const v = attr.value;
  if (!v) return null;
  if (v.kind === "call-ref" && Array.isArray(v.args) && v.args.length > 0) {
    return String(v.args[0]).trim() || null;
  }
  if (v.kind === "call" && typeof v.args === "string" && v.args.trim().length > 0) {
    return v.args.split(",")[0].trim() || null;
  }
  return null;
}

/**
 * Extract `onserver:` lifecycle attribute handlers from a channel node.
 * These are server-side handlers used in `_scrml_ws_handlers` (Bun WebSocket server callbacks).
 */
function extractChannelHandlers(node: any): ChannelHandlers {
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  return {
    open: channelAttrToCall(attrMap.get("onserver:open")),
    message: channelAttrToCall(attrMap.get("onserver:message")),
    close: channelAttrToCall(attrMap.get("onserver:close")),
    messageParam: channelAttrParam(attrMap.get("onserver:message")),
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

  return {
    open: channelAttrToCall(attrMap.get("onclient:open")),
    close: channelAttrToCall(attrMap.get("onclient:close")),
    error: channelAttrToCall(attrMap.get("onclient:error")),
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
        // T1 (cross-file channel mount E-RI-002 fix, 2026-05-11):
        // Do NOT skip `_p3aIsExport === true` channels here. Channel-function
        // ownership is a property of where the function-decl LEXICALLY lives
        // (per §38.6) and is independent of whether this file is the WS-emit
        // site (`collectChannelNodes` decides that). The PURE-CHANNEL-FILE
        // (exporter) still emits the channel-owned server functions via
        // `collectFunctions`; without this map, emit-server would not inject
        // the `broadcast(...)` helper and RI's E-RI-002 skip-path would
        // false-fire on the exporter's own `publish*` writes to channel cells.
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
        // T1 (cross-file channel mount E-RI-002 fix, 2026-05-11):
        // Mirror collectChannelFunctionMap — channel-cell ownership is
        // lexical (where the state-decl appears), not tied to WS-emit
        // site. The RI skip-path needs the exporter file's own channel
        // cells to suppress E-RI-002 on the exporter's `publish*` writes.
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

/**
 * Walk an AST and collect the function names referenced by channel lifecycle
 * ATTRIBUTE handlers, partitioned by side.
 *
 * Bug 2b (channel-codegen-fixes-2026-06-12): route inference needs this to
 * keep the two handler classes on the correct boundary:
 *
 *  - `onclient` names (`onclient:open=onOpen()` etc.) are CLIENT-ONLY per
 *    §38.10 ("onclient:* SHALL execute on the client only; the compiler SHALL
 *    NOT emit any server-side code"). RI MUST NOT escalate them to the server
 *    even when their body writes a channel cell (§12.2 Trigger 7). §38.10 is
 *    explicit + normative and WINS over Trigger 7 for these functions: their
 *    channel-cell write runs client-side and syncs via the normal `__sync`
 *    wire path.
 *
 *  - `onserver` names (`onserver:message=handleMessage(msg)` etc.) ARE
 *    server-side, but they are invoked from the WS message/lifecycle handler
 *    (`_scrml_ws_handlers`, §38.6.1 / §38.7), NOT from an HTTP RPC route. The
 *    duplicate HTTP route + client fetch stub the standard server-fn path
 *    would generate is DEAD code (nothing fetches it). RI marks them so codegen
 *    emits them as plain callable server functions and suppresses the dead
 *    route.
 *
 * The handler attribute value parses to `kind:"call-ref"` (real source) with a
 * `.name`; the synthetic test form is `kind:"call"`. We read the name from
 * either shape, plus the bare `variable-ref` form (`onclient:open=onOpen`).
 *
 * Returns `{ onclient, onserver }` as two name Sets.
 */
export function collectChannelAttrHandlerNames(
  nodes: any[],
): { onclient: Set<string>; onserver: Set<string> } {
  const onclient = new Set<string>();
  const onserver = new Set<string>();

  function handlerName(attr: any): string | null {
    if (!attr) return null;
    const v = attr.value;
    if (!v) return null;
    if ((v.kind === "call-ref" || v.kind === "call" || v.kind === "variable-ref") &&
        typeof v.name === "string" && v.name.length > 0) {
      return v.name;
    }
    return null;
  }

  function visit(nodeList: any[]): void {
    for (const n of nodeList) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "markup" && (n.tag ?? "") === "channel") {
        const attrs: any[] = n.attrs ?? n.attributes ?? [];
        for (const a of attrs) {
          if (!a || typeof a.name !== "string") continue;
          if (a.name.startsWith("onclient:")) {
            const hn = handlerName(a);
            if (hn) onclient.add(hn);
          } else if (a.name.startsWith("onserver:")) {
            const hn = handlerName(a);
            if (hn) onserver.add(hn);
          }
        }
        // Channel bodies do not nest channels; still recurse children so a
        // handler reference inside a non-channel descendant is not missed.
      }
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
    }
  }

  visit(nodes);
  return { onclient, onserver };
}

// ---------------------------------------------------------------------------
// §38.13 realtime `watches=` feed — client `<onchange>` dispatch
// ---------------------------------------------------------------------------

/**
 * The single `<onchange>` decl child of a `watches=` `<channel>` node, or null.
 * Phase 1 stamps `node._rowChangeSynth` on a valid `watches=` channel and parses
 * its `<onchange>` body into an `onchange-decl` child (§38.13.3).
 */
function findOnchangeDecl(node: any): any | null {
  const kids = Array.isArray(node?.children) ? node.children : [];
  for (const k of kids) {
    if (k && typeof k === "object" && k.kind === "onchange-decl") return k;
  }
  return null;
}

/**
 * Parse the single positional payload binding name (`row` / `key`) from an
 * `<onchange>` arm's `payloadBindingsRaw` (§51.0.B.1 — reused). Returns null for
 * a discard `_` or an empty binding (a no-payload arm).
 */
function onchangeArmBindingName(raw: string | undefined | null): string | null {
  const t = (raw ?? "").trim();
  if (t === "" || t === "_") return null;
  // Single positional binding — take the first comma-part, drop a `field:` label.
  const first = t.split(",")[0].trim();
  const colon = first.indexOf(":");
  const local = (colon >= 0 ? first.slice(colon + 1) : first).trim();
  return local || null;
}

/**
 * Split a §4.18 code-default arm body into top-level statements — brace / paren /
 * bracket / string / template aware — stripping a single outer `{ … }` wrapper.
 * The `<onchange>` arm bodies patch program-scope `@`-cells (§38.13.3); each
 * statement is lowered independently by `emitExprField` (client mode). A single
 * statement wrapped across a line at bracket-depth 0 should parenthesise its
 * continuation (the depth-0 newline is a statement separator, scrml-native).
 */
function splitCodeBodyStatements(bodyRaw: string): string[] {
  let t = (bodyRaw ?? "").trim();
  if (t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1).trim();
  const out: string[] = [];
  let depth = 0, inDQ = false, inSQ = false, inTick = false, start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
    if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
    if (inTick) { if (c === "`") inTick = false; else if (c === "\\") i++; continue; }
    if (c === '"') { inDQ = true; continue; }
    if (c === "'") { inSQ = true; continue; }
    if (c === "`") { inTick = true; continue; }
    if (c === "{" || c === "(" || c === "[") { depth++; continue; }
    if (c === "}" || c === ")" || c === "]") { if (depth > 0) depth--; continue; }
    if ((c === ";" || c === "\n") && depth === 0) {
      const seg = t.slice(start, i).trim();
      if (seg) out.push(seg);
      start = i + 1;
    }
  }
  const last = t.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/**
 * Build the `if (_d.__type === "__change") { … }` client dispatch for a
 * `watches=` channel (§38.13.3). For each `<onchange>` arm, bind its payload
 * local — `_d.row` for `Inserted` / `Updated`, `_d.key` for `Deleted` (the
 * pinned `__change` frame, §38.13.7) — then run the arm's code-default body
 * (lowered by `emitExprField` in client mode, so `@`-cell reads/writes become
 * `_scrml_reactive_get`/`_scrml_reactive_set`). A wildcard `_` arm is a catch-all
 * (no payload bind). Exhaustiveness over `RowChange` was validated in Phase 1.
 */
function buildOnchangeDispatchLines(node: any, filePath: string, errors: CGError[]): string[] {
  const onchange = findOnchangeDecl(node);
  const arms: any[] = Array.isArray(onchange?.arms) ? onchange.arms : [];
  if (arms.length === 0) return [];

  const lowerBody = (arm: any): string[] => {
    if (arm?.bodyForm === "self-closing") return [];
    const stmts = splitCodeBodyStatements(typeof arm?.bodyRaw === "string" ? arm.bodyRaw : "");
    const out: string[] = [];
    for (const s of stmts) {
      let js: string;
      try {
        js = emitExprField(null, s, { mode: "client" } as any);
      } catch (e) {
        errors.push(new CGError(
          "E-CODEGEN-INVALID-LOGIC",
          `E-CODEGEN-INVALID-LOGIC: could not lower an <onchange> arm body to valid output (§38.13.3): ${(e as Error).message}`,
          (arm?.span ?? node?.span ?? {}),
          "error",
        ));
        js = "/* onchange arm lowering failed */ void 0";
      }
      out.push(`${js};`);
    }
    return out;
  };

  const lines: string[] = [];
  lines.push(`        if (_d.__type === "__change") {`);
  lines.push(`          // §38.13.3 — dispatch the RowChange delta into the <onchange> arms`);
  let wildcard: any = null;
  for (const arm of arms) {
    if (arm?.isWildcard) { wildcard = arm; continue; }
    const variant = typeof arm?.variantName === "string" ? arm.variantName : null;
    if (!variant) continue;
    const local = onchangeArmBindingName(arm?.payloadBindingsRaw);
    // Inserted / Updated carry the full row; Deleted carries only the key.
    const src = variant === "Deleted" ? "_d.key" : "_d.row";
    const bind = local ? `const ${local} = ${src}; ` : "";
    const body = lowerBody(arm).join(" ");
    lines.push(`          if (_d.op === ${JSON.stringify(variant)}) { ${bind}${body} return; }`);
  }
  if (wildcard) {
    const body = lowerBody(wildcard).join(" ");
    lines.push(`          { ${body} return; }`);
  }
  lines.push(`          return;`);
  lines.push(`        }`);
  return lines;
}

// ---------------------------------------------------------------------------
// Client JS emission
// ---------------------------------------------------------------------------

/**
 * Emit client-side JavaScript for a single `<channel>` node.
 */
export function emitChannelClientJs(node: any, errors: CGError[], filePath: string, projectReconnectDefault: number | null = null): string[] {
  const lines: string[] = [];
  const { name, safeName, topic, reconnectMs } = extractChannelAttrs(node, projectReconnectDefault);
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

  // §38.13.3 — a `watches=` realtime feed dispatches the server-published
  // `__change` frame into the typed `<onchange>` arms. Emitted UNCONDITIONALLY
  // for a watches channel (it has no `__sync` synced cells — §38.13.4). Gated on
  // the Phase-1 `_rowChangeSynth` stamp (present only on a valid `watches=`
  // channel), so an ordinary §38.4 / §38.6 channel is byte-identical.
  if (node && node._rowChangeSynth) {
    for (const l of buildOnchangeDispatchLines(node, filePath, errors)) lines.push(l);
  }

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
  // Bun's server.upgrade() API contract requires returning undefined to
  // signal "the request was upgraded; do not return a response." `void 0`
  // evaluates to the JS undefined value without using the keyword literal
  // (W-CG-UNDEFINED-INTERPOLATION-safe; standards-conforming idiom).
  lines.push(`    return ok ? void 0 : new Response("WebSocket upgrade failed", { status: 400 });`);
  lines.push(`  },`);
  lines.push(`};`);

  return lines;
}

// ---------------------------------------------------------------------------
// §38.13.7 realtime `watches=` feed — server-side change capture
// (Postgres LISTEN/NOTIFY). Trigger install via Bun.SQL (`_scrml_sql`) +
// a dedicated `pg` session connection for notification delivery (Bun.SQL
// v1.3.13 exposes NO LISTEN/NOTIFY subscription API — only `onconnect`/
// `onclose`). SERVER-ONLY: the connection string / DDL / bridge never appear
// in client output. Postgres-only; gated on a resolved `_rowChangeSynth` + PK.
// ---------------------------------------------------------------------------

/** Sanitise an identifier into a safe lowercase SQL/JS identifier segment. */
function sqlSafeIdent(name: string): string {
  const s = String(name ?? "").replace(/[^A-Za-z0-9_]/g, "_");
  return (/^[0-9]/.test(s) ? "_" + s : s) || "ch";
}

/** Double-quote a Postgres identifier (table / column), escaping embedded `"`. */
function pgQuoteIdent(name: string): string {
  return '"' + String(name ?? "").replace(/"/g, '""') + '"';
}

/**
 * Build the Postgres trigger + trigger-function install DDL for one `watches=`
 * channel (§38.13.7). Idempotent re-install each boot IS the drift-reconcile
 * (no separate reconcile pass). Uses `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`
 * (works on PG < 14; `CREATE OR REPLACE TRIGGER` would require PG 14+).
 * `CREATE OR REPLACE FUNCTION` + `json_build_object` set the floor at **PG 9.4+**.
 * The trigger `pg_notify`s only the primary key (Postgres NOTIFY caps at 8000
 * bytes); the listener re-SELECTs the full row (§38.13.7).
 */
export function buildWatchesTriggerDDL(
  safeName: string,
  table: string,
  pkColumn: string,
): { fnDDL: string; dropTrigDDL: string; createTrigDDL: string; notifyChannel: string } {
  const notifyChannel = `scrml_${safeName}`;
  const fnName = `scrml_notify_${safeName}`;
  const trgName = `scrml_trg_${safeName}`;
  const qT = pgQuoteIdent(table);
  const qPk = pgQuoteIdent(pkColumn);
  const fnDDL =
    `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $BODY$ ` +
    `BEGIN PERFORM pg_notify('${notifyChannel}', json_build_object(` +
    `'op', TG_OP, 'key', CASE WHEN TG_OP = 'DELETE' THEN OLD.${qPk} ELSE NEW.${qPk} END)::text); ` +
    `RETURN NULL; END; $BODY$ LANGUAGE plpgsql;`;
  const dropTrigDDL = `DROP TRIGGER IF EXISTS ${trgName} ON ${qT};`;
  const createTrigDDL =
    `CREATE TRIGGER ${trgName} AFTER INSERT OR UPDATE OR DELETE ON ${qT} ` +
    `FOR EACH ROW EXECUTE FUNCTION ${fnName}();`;
  return { fnDDL, dropTrigDDL, createTrigDDL, notifyChannel };
}

/**
 * Emit the server-boot change-capture block for every `watches=` channel in a
 * file (§38.13.7). For each feed: (1) install the trigger+function idempotently
 * via `_scrml_sql.unsafe(...)`; (2) open a dedicated `pg` session connection,
 * `LISTEN` on the feed's channel, and on each notification re-SELECT the changed
 * row by PK (INSERT/UPDATE) or forward the key (DELETE), publishing the pinned
 * `{ __type:"__change", op, row|key }` frame to the channel topic via
 * `globalThis._scrml_active_server.publish`. Reconnect-on-drop. Multi-instance
 * is free (each instance holds its own LISTEN — no cross-instance backbone).
 *
 * Returns `[]` (byte-identical to a non-realtime build) when there is no
 * postgres connection or no PK-resolved `watches=` feed. A `watches=` channel
 * whose table has no derivable PK (`_rowChangeSynth.pkColumn === null`,
 * W-CHANNEL-WATCHES-NO-PK) is SKIPPED here — the feed cannot key its deltas, so
 * no capture is emitted (the client `<onchange>` dispatch stays, but inert).
 */
export function emitChannelWatchesServerBoot(
  channelNodes: any[],
  pgConnStr: string | null,
  errors: CGError[],
  filePath: string,
  protectedColsByTable: Map<string, Set<string>> | null = null,
  projectReconnectDefault: number | null = null,
): string[] {
  const feeds = channelNodes.filter(
    (n) => n && n._rowChangeSynth && typeof n._rowChangeSynth.pkColumn === "string" && n._rowChangeSynth.pkColumn,
  );
  if (feeds.length === 0 || !pgConnStr) return [];

  const lines: string[] = [];
  lines.push("");
  lines.push("// --- §38.13.7 realtime watches= feed: DB change capture (Postgres LISTEN/NOTIFY) ---");
  lines.push("// Compiler-emitted, SERVER-ONLY. Trigger install via Bun.SQL (_scrml_sql); notification");
  lines.push("// delivery via a dedicated pg session connection — Bun.SQL v1.3.13 has NO LISTEN API.");
  lines.push("// Min Postgres: 9.4 (json_build_object). PgBouncer: this connection MUST be session-mode");
  lines.push("// (transaction pooling breaks LISTEN). Multi-instance-safe: each instance holds its own LISTEN.");
  lines.push(`const _SCRML_WATCHES_CONN = ${JSON.stringify(pgConnStr)};`);
  lines.push("const _SCRML_WATCHES_RECONNECT_MS = 2000;");
  lines.push("");

  // (1) Trigger install — one function + trigger pair per feed, idempotent.
  lines.push("async function _scrml_watches_install_triggers() {");
  lines.push("  try {");
  for (const node of feeds) {
    const { name, safeName, topic } = extractChannelAttrs(node, projectReconnectDefault);
    void name; void topic;
    const synth = node._rowChangeSynth;
    const ident = sqlSafeIdent(safeName);
    const { fnDDL, dropTrigDDL, createTrigDDL } = buildWatchesTriggerDDL(ident, synth.table, synth.pkColumn);
    lines.push(`    await _scrml_sql.unsafe(${JSON.stringify(fnDDL)});`);
    lines.push(`    await _scrml_sql.unsafe(${JSON.stringify(dropTrigDDL)});`);
    lines.push(`    await _scrml_sql.unsafe(${JSON.stringify(createTrigDDL)});`);
  }
  lines.push("  } catch (_e) {");
  lines.push('    console.error("[scrml] watches= trigger install failed:", _e && _e.message);');
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // (2) Per-feed LISTEN bridge (dedicated pg session connection).
  const listenFnNames: string[] = [];
  for (const node of feeds) {
    const { safeName, topic } = extractChannelAttrs(node, projectReconnectDefault);
    const synth = node._rowChangeSynth;
    const ident = sqlSafeIdent(safeName);
    const listenFn = `_scrml_watches_listen_${ident}`;
    listenFnNames.push(listenFn);
    const notifyChannel = `scrml_${ident}`;
    const qT = pgQuoteIdent(synth.table);
    const qPk = pgQuoteIdent(synth.pkColumn);
    lines.push(`// LISTEN bridge for <channel watches=${JSON.stringify(synth.table)}> topic ${JSON.stringify(topic)}`);
    lines.push(`function ${listenFn}() {`);
    lines.push(`  import("pg").then((_pgMod) => {`);
    lines.push(`    const _PgClient = (_pgMod.default && _pgMod.default.Client) || _pgMod.Client;`);
    lines.push(`    const _client = new _PgClient({ connectionString: _SCRML_WATCHES_CONN });`);
    lines.push(`    const _retry = () => { try { _client.removeAllListeners && _client.removeAllListeners(); } catch (_e) {} setTimeout(${listenFn}, _SCRML_WATCHES_RECONNECT_MS); };`);
    lines.push(`    _client.on("error", _retry);`);
    lines.push(`    _client.on("end", _retry);`);
    lines.push(`    _client.on("notification", async (_msg) => {`);
    lines.push(`      let _p; try { _p = JSON.parse(_msg.payload); } catch (_e) { return; }`);
    lines.push(`      const _server = globalThis._scrml_active_server;`);
    lines.push(`      if (!_server) return;`);
    lines.push(`      if (_p.op === "DELETE") {`);
    lines.push(`        _server.publish(${JSON.stringify(topic)}, JSON.stringify({ __type: "__change", op: "Deleted", key: _p.key }));`);
    lines.push(`        return;`);
    lines.push(`      }`);
    lines.push(`      try {`);
    // §14.8.9 — the re-SELECT is a hand-emitted `SELECT *` whose row is published
    // to every subscriber (a client egress). Mirror the SSR /__serverLoad Tier-1
    // sink: TAG the hand-emitted rows with the table's protected columns (the raw
    // `.unsafe` result is NOT `?{}`-tagged), then REDACT the published row so a
    // `protect=` column never crosses the feed. When the table has no protected
    // column the emit is byte-identical (no tag / no redact).
    const _protCols = protectedColsByTable ? protectedColsByTable.get(synth.table) : undefined;
    const _hasProt = !!(_protCols && _protCols.size > 0);
    const _selectSql = `SELECT * FROM ${qT} WHERE ${qPk} = $1`;
    if (_hasProt) {
      lines.push(`        const _rows = _scrml_protect_tag(await _scrml_sql.unsafe(${JSON.stringify(_selectSql)}, [_p.key]), ${JSON.stringify([..._protCols!])});`);
    } else {
      lines.push(`        const _rows = await _scrml_sql.unsafe(${JSON.stringify(_selectSql)}, [_p.key]);`);
    }
    lines.push(`        const _row = _rows && _rows[0];`);
    lines.push(`        if (!_row) return;`);
    lines.push(`        const _variant = _p.op === "INSERT" ? "Inserted" : "Updated";`);
    const _rowExpr = _hasProt ? "_scrml_protect_redact(_row)" : "_row";
    lines.push(`        _server.publish(${JSON.stringify(topic)}, JSON.stringify({ __type: "__change", op: _variant, row: ${_rowExpr} }));`);
    lines.push(`      } catch (_e) {}`);
    lines.push(`    });`);
    lines.push(`    _client.connect().then(() => _client.query(${JSON.stringify(`LISTEN ${notifyChannel}`)})).catch(_retry);`);
    lines.push(`  }).catch((_e) => {`);
    lines.push(`    console.error("[scrml] realtime watches= feed needs the 'pg' package (Bun.SQL has no LISTEN API):", _e && _e.message);`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
  }

  // (3) Boot — install triggers, then start every LISTEN loop.
  lines.push("_scrml_watches_install_triggers().then(() => {");
  for (const fn of listenFnNames) lines.push(`  ${fn}();`);
  lines.push('}).catch((_e) => { console.error("[scrml] watches= boot failed:", _e && _e.message); });');
  lines.push("");

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
    const { message: msgHandler, messageParam } = extractChannelHandlers(node);
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
      // §38.6.1: bind the call expression's parameter name to the parsed
      // message payload (`JSON.parse(raw)`, already in `d`) before invoking the
      // handler. A no-parameter handler (`onserver:message=handleMessage()`)
      // skips the binding — the raw event is NOT passed (§38.6.1 normative).
      if (messageParam) {
        lines.push(`        const ${messageParam} = d;`);
      }
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
