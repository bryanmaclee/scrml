// scrml:mcp — runtime shim (Sub-unit B helpers; MCP-V0)
//
// Hand-written ES module. The full scrml:mcp surface (11 MCP tools, MCP
// server boot, sidecar-loader wiring) is Sub-unit C / D scope. This file
// ships the three runtime READ helpers that Sub-unit C's tool handlers
// invoke and the minimal sidecar+runtime plumbing those helpers need.
//
// Surface exported here:
//
//   install({ reactive_get, derived_get })
//     Connect the shim to the compiled program's runtime helpers. Called
//     once at MCP server boot (Sub-unit C / D wires the call). Without
//     install(), the three READ helpers throw a clear E-MCP-RUNTIME-NOT-INSTALLED
//     diagnostic instead of returning stale / wrong data silently.
//
//   loadSidecars(outputDir, { watch = false } = {})
//     Read engines.json / forms.json / channels.json from <outputDir>/.
//     Cache the parsed JSON in module state for the helpers below. If
//     `watch:true`, register fs.watch on each sidecar so a rebuild
//     refreshes the cache without an MCP-server restart (deferrable
//     mitigation per SCOPING §5 Risk 5).
//
//   getCurrentVariant(engineName)            → string  (engine's variant tag)
//   getFormStatus(formName)                  → { isValid, errors, touched,
//                                                submitted, perField: {...} }
//   getChannelState(channelName)             → { name, topic, cellState }
//
//   _stateForTests()                         → { sidecars, runtime }
//     Test-only introspection hook (not part of the public MCP surface).
//
// Design notes:
//
//   1. Sidecar shape — SCOPING §3 Sub-unit A documents the shapes. Each
//      cell key the helpers need is RESOLVED in the sidecar (see SCOPING
//      §3 Sub-unit B Risks bullet: "the sidecar emits resolved keys and
//      the runtime helper just reads them" — option (b), recommended).
//      The helpers do not re-encode keys.
//
//   2. Runtime injection — shims live as independent ES modules at
//      <outputDir>/_scrml/<name>.js. The runtime helpers (_scrml_state,
//      _scrml_reactive_get, _scrml_derived_get) live in the same module
//      scope as generated code, NOT exported. We bridge via install({...}).
//      Sub-unit C's MCP boot code, which lives alongside generated code,
//      will call install with refs to the runtime helpers. This is the
//      "long-lived server wrap" precedent SCOPING §1 Q4 names.
//
//   3. _scrml_reactive_get already routes derived cells through
//      _scrml_derived_get (runtime-template.js:422). For READ paths the
//      shim could use just reactive_get and rely on that route. We accept
//      both at install() so Sub-unit C can pass either or both; helpers
//      prefer derived_get when the sidecar marks the key as derived, else
//      fall back to reactive_get. Today, validators are derived and engine
//      cells are reactive; the sidecar's per-cell `kind` (if present) or
//      module-default routing covers both.
//
//   4. fs.watch — optional. Default OFF for deterministic test runs and
//      so Sub-unit C / D can opt in explicitly. When ON, each sidecar file
//      watcher re-reads + re-parses the file on `change` events. Errors
//      during reload are swallowed with a console.warn (stderr) — a
//      malformed in-flight rewrite must not crash the MCP server.

import { readFileSync, watch as fsWatch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

// Runtime helper refs, populated by install().
var _runtime = null;

// Sidecar caches. Each is an array of records per the SCOPING §3 Sub-unit A
// shape. Null until loadSidecars() has been called.
var _engines = null;   // [{ name, type, variants, rules, kind, cellKey }, ...]
var _forms = null;     // [{ formName, fields: [...], compoundKeys: {...} }, ...]
var _channels = null;  // [{ name, topic, autoSyncedCells: [{ name, key }] }, ...]

// Sub-unit C additions. serverfns.json is an ARRAY (Sub-unit A shape);
// chunks.json is the per-app ChunksManifest OBJECT (NOT an array) — read with
// a dedicated object reader so _readSidecar's array-coercion doesn't blank it.
var _serverFns = null; // [{ name, params, returnType, file, dispatchable }, ...]
var _chunks = null;    // { version, compiler, entryPoints: { <ep>: { <role>: {...} } } }

// fs.watch handles, kept for shutdown / test cleanup.
var _watchers = [];

// Track which outputDir is currently loaded (debug aid / test introspection).
var _loadedOutputDir = null;

// ---------------------------------------------------------------------------
// install({ reactive_get, derived_get })
// ---------------------------------------------------------------------------
//
// Connect the shim to the compiled program's runtime. Caller passes the
// runtime functions as a small object; we keep references. Either function
// may be omitted, in which case helpers that need it raise at call time.

export function install(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new Error(
      "[scrml:mcp] install() requires a runtime object with reactive_get and/or derived_get."
    );
  }
  _runtime = {
    reactive_get: typeof runtime.reactive_get === "function" ? runtime.reactive_get : null,
    derived_get: typeof runtime.derived_get === "function" ? runtime.derived_get : null,
  };
}

// uninstall() — release the runtime ref. Test-only; not part of the public
// MCP surface. Sub-unit C may also call this for clean MCP server shutdown.
export function uninstall() {
  _runtime = null;
}

// ---------------------------------------------------------------------------
// Sidecar loader
// ---------------------------------------------------------------------------
//
// Reads the three sidecars from <outputDir>/. Sub-unit A emits these next
// to chunks.json. If a sidecar is missing OR empty, the corresponding
// cache is set to [] and the corresponding helper returns a clean
// "not-found" diagnostic (rather than throwing on the first call).
//
// outputDir resolution: explicit parameter is preferred. When omitted, the
// shim falls back to resolving relative to its own location at runtime:
// <outputDir>/_scrml/mcp.js → outputDir = <outputDir>/. This works for the
// normal bundleStdlibForRun path (where the shim is copied next to the
// generated JS). Tests pass an explicit tmpdir.

export function loadSidecars(outputDir, options) {
  var opts = options || {};
  var dir = outputDir || _defaultOutputDir();
  if (!dir) {
    throw new Error(
      "[scrml:mcp] loadSidecars() could not determine outputDir. " +
        "Pass an explicit outputDir parameter, or import this shim from <outputDir>/_scrml/mcp.js."
    );
  }
  _loadedOutputDir = dir;
  _engines = _readSidecar(join(dir, "engines.json"));
  _forms = _readSidecar(join(dir, "forms.json"));
  _channels = _readSidecar(join(dir, "channels.json"));
  // Sub-unit C — the two additional artifacts the 11-tool surface needs.
  _serverFns = _readSidecar(join(dir, "serverfns.json"));
  _chunks = _readChunksManifest(join(dir, "chunks.json"));

  if (opts.watch) {
    _stopWatchers();
    _startWatcher(join(dir, "engines.json"), function () { _engines = _readSidecar(join(dir, "engines.json")); });
    _startWatcher(join(dir, "forms.json"), function () { _forms = _readSidecar(join(dir, "forms.json")); });
    _startWatcher(join(dir, "channels.json"), function () { _channels = _readSidecar(join(dir, "channels.json")); });
    _startWatcher(join(dir, "serverfns.json"), function () { _serverFns = _readSidecar(join(dir, "serverfns.json")); });
    _startWatcher(join(dir, "chunks.json"), function () { _chunks = _readChunksManifest(join(dir, "chunks.json")); });
  }
}

// stopWatchers() — explicit shutdown hook for the fs.watch handles.
// Test-only / clean-shutdown helper.
export function stopWatchers() {
  _stopWatchers();
}

function _defaultOutputDir() {
  // import.meta.url points at <outputDir>/_scrml/mcp.js when bundled.
  // The sidecars live one directory up.
  try {
    var filePath = fileURLToPath(import.meta.url);
    // filePath: /…/<outputDir>/_scrml/mcp.js → up two dirs would be wrong;
    // up ONE dir (out of _scrml/) is the outputDir we want.
    var lastSlash = filePath.lastIndexOf("/");
    if (lastSlash < 0) return null;
    var scrmlDir = filePath.slice(0, lastSlash);     // <outputDir>/_scrml
    var secondLast = scrmlDir.lastIndexOf("/");
    if (secondLast < 0) return null;
    return scrmlDir.slice(0, secondLast);            // <outputDir>
  } catch (_err) {
    return null;
  }
}

function _readSidecar(path) {
  try {
    var raw = readFileSync(path, "utf-8");
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (_err) {
    // Missing or malformed — return [] so callers see a deterministic
    // empty surface instead of an exception.
    return [];
  }
}

// _readChunksManifest(path) — chunks.json is a single ChunksManifest OBJECT
// ({ version, compiler, entryPoints }), not an array, so it has its own reader.
// A missing / malformed manifest degrades to null — the topology tools then
// return a deterministic "no manifest" surface rather than throwing.
function _readChunksManifest(path) {
  try {
    var raw = readFileSync(path, "utf-8");
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function _startWatcher(path, onChange) {
  try {
    var w = fsWatch(path, { persistent: false }, function (eventType) {
      if (eventType === "change" || eventType === "rename") {
        try { onChange(); } catch (_err) { /* swallow — see header */ }
      }
    });
    _watchers.push(w);
  } catch (_err) {
    // fs.watch can fail (e.g. file missing) — caller will see stale cache
    // on next read; the next loadSidecars(...) call recovers.
  }
}

function _stopWatchers() {
  for (var i = 0; i < _watchers.length; i++) {
    try { _watchers[i].close(); } catch (_err) { /* ignore */ }
  }
  _watchers = [];
}

// ---------------------------------------------------------------------------
// Runtime read helpers
// ---------------------------------------------------------------------------

function _requireRuntime(helperName) {
  if (!_runtime || (!_runtime.reactive_get && !_runtime.derived_get)) {
    throw new Error(
      "[scrml:mcp] " + helperName + "() called before install() — runtime not connected. " +
        "Sub-unit C / D boot code must call install({ reactive_get, derived_get }) before any read helper."
    );
  }
}

// _read(key, kind) — uniform reader. `kind` is "derived" or "reactive";
// when "derived" is requested, prefer derived_get. _scrml_reactive_get
// already routes derived cells through _scrml_derived_get (runtime-
// template.js:422), so reactive_get is a safe universal fallback.
function _read(key, kind) {
  if (kind === "derived" && _runtime.derived_get) return _runtime.derived_get(key);
  if (_runtime.reactive_get) return _runtime.reactive_get(key);
  if (_runtime.derived_get) return _runtime.derived_get(key);
  return undefined;
}

// ---------------------------------------------------------------------------
// getCurrentVariant(engineName) → string | undefined
//
// Returns the engine's current variant tag (e.g. "Idle", "Loading"). Reads
// _scrml_state[engineName] via _scrml_reactive_get. The engine descriptor
// in engines.json carries an optional `cellKey` field for the case where
// the runtime-state key differs from the engine name (e.g. encoded names
// per §47). When cellKey is absent, engineName IS the state key.
// ---------------------------------------------------------------------------

export function getCurrentVariant(engineName) {
  _requireRuntime("getCurrentVariant");
  if (_engines === null) {
    throw new Error(
      "[scrml:mcp] getCurrentVariant() called before loadSidecars() — engines.json not loaded."
    );
  }
  var descriptor = _findByName(_engines, engineName);
  if (!descriptor) return undefined;
  var key = descriptor.cellKey || descriptor.name || engineName;
  var raw = _read(key, "reactive");
  // Variant cells may be stored either as bare tag strings ("Idle") OR as
  // {variant, data} records (the compiler-emitted shape for variants
  // carrying payloads). Normalize to the tag string per SCOPING Tool 2
  // currentVariant contract.
  if (raw && typeof raw === "object" && typeof raw.variant === "string") {
    return raw.variant;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// getFormStatus(formName) → structured per SPEC §55.5-§55.7
//
// Composition:
//   {
//     isValid:   bool,
//     errors:    [...],
//     touched:   bool,
//     submitted: bool,
//     perField: {
//       <fieldName>: { isValid, errors, touched }, ...
//     }
//   }
//
// Sidecar shape per SCOPING §3 Sub-unit A:
//   {
//     formName,
//     fields: [{ name, qualifiedName, errorsKey, isValidKey, touchedKey }, ...],
//     compoundKeys?: { isValidKey, errorsKey, touchedKey, submittedKey }
//   }
//
// All four compound keys + the three per-field keys are pre-resolved by
// Sub-unit A. The helper does NOT re-encode anything. If a compound key is
// absent (e.g. a form without auto-synthesized compound surface), the
// helper composes a per-field rollup: isValid = all fields valid;
// errors = union of per-field errors; touched = any field touched;
// submitted = false (no compound surface implies no submitted tracker).
// ---------------------------------------------------------------------------

export function getFormStatus(formName) {
  _requireRuntime("getFormStatus");
  if (_forms === null) {
    throw new Error(
      "[scrml:mcp] getFormStatus() called before loadSidecars() — forms.json not loaded."
    );
  }
  var descriptor = _findForm(_forms, formName);
  if (!descriptor) return undefined;

  var perField = {};
  var fields = Array.isArray(descriptor.fields) ? descriptor.fields : [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    perField[f.name] = {
      isValid: f.isValidKey ? _read(f.isValidKey, "derived") : undefined,
      errors: f.errorsKey ? _read(f.errorsKey, "derived") : [],
      touched: f.touchedKey ? _read(f.touchedKey, "derived") : false,
    };
  }

  var compound = descriptor.compoundKeys || {};
  var result = {
    isValid: compound.isValidKey
      ? _read(compound.isValidKey, "derived")
      : _rollupAllValid(perField),
    errors: compound.errorsKey
      ? (_read(compound.errorsKey, "derived") || [])
      : _rollupErrors(perField),
    touched: compound.touchedKey
      ? _read(compound.touchedKey, "derived")
      : _rollupAnyTouched(perField),
    submitted: compound.submittedKey
      ? (_read(compound.submittedKey, "reactive") || false)
      : false,
    perField: perField,
  };
  return result;
}

function _rollupAllValid(perField) {
  for (var k in perField) {
    if (perField[k].isValid === false) return false;
  }
  return true;
}

function _rollupAnyTouched(perField) {
  for (var k in perField) {
    if (perField[k].touched === true) return true;
  }
  return false;
}

function _rollupErrors(perField) {
  var out = [];
  for (var k in perField) {
    var errs = perField[k].errors;
    if (Array.isArray(errs)) {
      for (var i = 0; i < errs.length; i++) out.push(errs[i]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// getChannelState(channelName) → { name, topic, cellState }
//
// Per §38.4 auto-synced cells. Sidecar shape per SCOPING §3 Sub-unit A:
//   { name, topic, autoSyncedCells: [{ name, key }, ...] }
//
// For each entry in autoSyncedCells, read the runtime cell at `key` and
// expose it under `cellName`. Topic is passed through from the sidecar.
// ---------------------------------------------------------------------------

export function getChannelState(channelName) {
  _requireRuntime("getChannelState");
  if (_channels === null) {
    throw new Error(
      "[scrml:mcp] getChannelState() called before loadSidecars() — channels.json not loaded."
    );
  }
  var descriptor = _findByName(_channels, channelName);
  if (!descriptor) return undefined;
  var cellState = {};
  var cells = Array.isArray(descriptor.autoSyncedCells) ? descriptor.autoSyncedCells : [];
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    cellState[c.name] = _read(c.key, "reactive");
  }
  return {
    name: descriptor.name,
    topic: descriptor.topic,
    cellState: cellState,
  };
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

function _findByName(list, name) {
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].name === name) return list[i];
  }
  return null;
}

function _findForm(list, formName) {
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].formName === formName) return list[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test introspection
// ---------------------------------------------------------------------------

export function _stateForTests() {
  return {
    sidecars: { engines: _engines, forms: _forms, channels: _channels, serverFns: _serverFns },
    chunks: _chunks,
    runtime: _runtime,
    loadedOutputDir: _loadedOutputDir,
    watcherCount: _watchers.length,
  };
}

// _resetForTests() — wipe module state between tests so test isolation
// doesn't depend on import ordering.
export function _resetForTests() {
  _stopWatchers();
  _runtime = null;
  _engines = null;
  _forms = null;
  _channels = null;
  _serverFns = null;
  _chunks = null;
  _loadedOutputDir = null;
}

// ===========================================================================
// Sub-unit C — the 11 read-only MCP tools.
//
// Each tool's DATA LOGIC is a pure exported resolver (`tool*`) that reads the
// loaded sidecars / chunks manifest and composes with the B helpers where
// runtime state is needed. The MCP SDK handlers (registerTool, below) are thin
// JSON wrappers over these resolvers, so the data behavior is unit-testable
// without booting the SDK.
//
// Tool names are a LOCKED public API (adopter agent configs depend on them):
//   get_app_topology, list_engines, get_engine, list_forms, get_form_status,
//   list_routes, get_route_chunks, list_server_functions, list_channels,
//   get_channel_state, get_reachable_server_fns.
// ===========================================================================

function _requireSidecars(toolName) {
  // The five surfaces are populated together by loadSidecars(). Engines being
  // null is a sufficient sentinel that loadSidecars() has not run.
  if (_engines === null) {
    throw new Error(
      "[scrml:mcp] " + toolName + " called before loadSidecars() / startMcpServer() — " +
        "descriptor sidecars not loaded."
    );
  }
}

// Tool 1 — get_app_topology() → the chunks.json manifest verbatim.
// Returns null when no manifest was emitted (degenerate / non-per-route build).
export function toolGetAppTopology() {
  _requireSidecars("get_app_topology");
  return _chunks;
}

// Tool 2a — list_engines() → engines.json descriptors WITHOUT runtime variant
// (compile-time facts only; the agent calls get_engine for live state).
export function toolListEngines() {
  _requireSidecars("list_engines");
  return Array.isArray(_engines) ? _engines : [];
}

// Tool 2b — get_engine(name) → the engine descriptor + live currentVariant.
// Returns null for an unknown engine name.
export function toolGetEngine(name) {
  _requireSidecars("get_engine");
  var descriptor = _findByName(_engines, name);
  if (!descriptor) return null;
  // currentVariant composes with the B helper (requires install()).
  var currentVariant = getCurrentVariant(name);
  return Object.assign({}, descriptor, { currentVariant: currentVariant });
}

// Tool 3a — list_forms() → form descriptors (names + field lists), no live state.
export function toolListForms() {
  _requireSidecars("list_forms");
  return Array.isArray(_forms) ? _forms : [];
}

// Tool 3b — get_form_status(formName) → the live validity surface (B helper).
// Returns null for an unknown form name.
export function toolGetFormStatus(formName) {
  _requireSidecars("get_form_status");
  var status = getFormStatus(formName);
  return status === undefined ? null : status;
}

// Tool 4a — list_routes() → the (entryPoint, role) index from chunks.json.
// Shape: [{ entryPoint, roles: [roleName, ...] }, ...]. Empty when no manifest.
export function toolListRoutes() {
  _requireSidecars("list_routes");
  var out = [];
  if (!_chunks || !_chunks.entryPoints || typeof _chunks.entryPoints !== "object") return out;
  var eps = _chunks.entryPoints;
  for (var ep in eps) {
    if (!Object.prototype.hasOwnProperty.call(eps, ep)) continue;
    var roleMap = eps[ep] || {};
    out.push({ entryPoint: ep, roles: Object.keys(roleMap) });
  }
  return out;
}

// Tool 4b — get_route_chunks(entryPoint, role) → the per-(EP,role) tier entry
// from chunks.json ({ initial?, tier1?, tier2?, tierN? }). Returns null when the
// (EP, role) pair is absent.
export function toolGetRouteChunks(entryPoint, role) {
  _requireSidecars("get_route_chunks");
  if (!_chunks || !_chunks.entryPoints) return null;
  var roleMap = _chunks.entryPoints[entryPoint];
  if (!roleMap || typeof roleMap !== "object") return null;
  var entry = roleMap[role];
  return entry === undefined ? null : entry;
}

// Tool 5 — list_server_functions() → serverfns.json verbatim. Enumeration only
// (`dispatchable: false` on every entry — V0 has no call surface).
export function toolListServerFunctions() {
  _requireSidecars("list_server_functions");
  return Array.isArray(_serverFns) ? _serverFns : [];
}

// Tool 6a — list_channels() → channels.json descriptors (names + topic +
// auto-synced cell list), no live state.
export function toolListChannels() {
  _requireSidecars("list_channels");
  return Array.isArray(_channels) ? _channels : [];
}

// Tool 6b — get_channel_state(name) → live channel cell state (B helper).
// Returns null for an unknown channel name.
export function toolGetChannelState(name) {
  _requireSidecars("get_channel_state");
  var state = getChannelState(name);
  return state === undefined ? null : state;
}

// Tool 7 — get_reachable_server_fns(entryPoint, role, depth) → DEGRADED-HONEST.
//
// SHAPE GAP (surfaced to PA, see docs/changes/mcp-v0-c-stdlib/progress.md):
// the emitted chunks.json carries only chunk filename strings per (EP, role),
// NOT ChunkContents.serverFnNodeIds. reachability.json (a separate
// `--emit-reachability` flag, not auto-emitted by --emit-per-route) carries
// serverFnNodeIds but as node IDs, and serverfns.json has no node-id field to
// join on. So per-route filtering is NOT faithfully computable from the
// artifacts a --emit-per-route build produces.
//
// Rather than fabricate reachability, this tool validates the (EP, role) pair
// against chunks.json, then returns the FULL server-fn list annotated
// `reachabilityFiltered: false` with a `note`. When the (EP, role) is unknown
// it returns `{ found: false }`. The real fix (node-id↔name join) is an A+D
// follow-on.
export function toolGetReachableServerFns(entryPoint, role, depth) {
  _requireSidecars("get_reachable_server_fns");
  var routeEntry = toolGetRouteChunks(entryPoint, role);
  if (routeEntry === null) {
    return {
      found: false,
      entryPoint: entryPoint,
      role: role,
      depth: typeof depth === "number" ? depth : null,
      reachabilityFiltered: false,
      serverFns: [],
      note:
        "Unknown (entryPoint, role) — not present in chunks.json. Call list_routes " +
        "for valid pairs.",
    };
  }
  return {
    found: true,
    entryPoint: entryPoint,
    role: role,
    depth: typeof depth === "number" ? depth : null,
    reachabilityFiltered: false,
    serverFns: Array.isArray(_serverFns) ? _serverFns : [],
    note:
      "V0 limitation: per-route server-fn reachability filtering is unavailable — " +
      "chunks.json carries no serverFnNodeIds and serverfns.json carries no node-id " +
      "to join on. Returning the full app-wide server-fn list. A node-id<->name join " +
      "(serverfns.json + auto-emitted reachability) is a documented follow-on.",
  };
}

// ---------------------------------------------------------------------------
// Tool registration table — single source of truth for the 11 tool names,
// descriptions, input schemas, and the resolver each wraps. Consumed by
// registerMcpTools() (SDK wiring) AND by tests that assert the full surface.
// `inputSchema` entries are zod RAW SHAPES (plain objects of zod validators),
// the form `McpServer.registerTool` expects — see startMcpServer for where zod
// is imported. A null inputSchema means a no-argument tool.
// ---------------------------------------------------------------------------

/** Build the tool spec table. `z` is the imported zod module (passed in so the
 *  shim has no hard top-level zod import — the SDK pulls zod transitively and
 *  startMcpServer imports it lazily). */
export function buildToolSpecs(z) {
  return [
    {
      name: "get_app_topology",
      description:
        "Return the application chunk topology (chunks.json) verbatim: per " +
        "entry-point, per-role initial/tier1/tier2/tierN chunk URLs.",
      inputSchema: null,
      resolve: function () { return toolGetAppTopology(); },
    },
    {
      name: "list_engines",
      description:
        "List all state-machine engines (compile-time facts: name, governing " +
        "type, variants, transition rules, kind). Use get_engine for live state.",
      inputSchema: null,
      resolve: function () { return toolListEngines(); },
    },
    {
      name: "get_engine",
      description:
        "Return one engine's descriptor including its live currentVariant.",
      inputSchema: { name: z.string() },
      resolve: function (args) { return toolGetEngine(args.name); },
    },
    {
      name: "list_forms",
      description:
        "List all forms (compound validity surfaces): form name + field list. " +
        "Use get_form_status for live validity state.",
      inputSchema: null,
      resolve: function () { return toolListForms(); },
    },
    {
      name: "get_form_status",
      description:
        "Return one form's live validity status: isValid, errors, touched, " +
        "submitted, and per-field { isValid, errors, touched }.",
      inputSchema: { formName: z.string() },
      resolve: function (args) { return toolGetFormStatus(args.formName); },
    },
    {
      name: "list_routes",
      description:
        "List all routes as (entryPoint, roles[]) pairs from the chunk topology.",
      inputSchema: null,
      resolve: function () { return toolListRoutes(); },
    },
    {
      name: "get_route_chunks",
      description:
        "Return the chunk set ({ initial, tier1, tier2, tierN }) for one " +
        "(entryPoint, role).",
      inputSchema: { entryPoint: z.string(), role: z.string() },
      resolve: function (args) { return toolGetRouteChunks(args.entryPoint, args.role); },
    },
    {
      name: "list_server_functions",
      description:
        "Enumerate server functions (name, params, return type, file). " +
        "Enumeration only — V0 cannot invoke server functions (dispatchable: false).",
      inputSchema: null,
      resolve: function () { return toolListServerFunctions(); },
    },
    {
      name: "list_channels",
      description:
        "List all real-time channels: name, topic, and auto-synced cell names. " +
        "Use get_channel_state for live cell values.",
      inputSchema: null,
      resolve: function () { return toolListChannels(); },
    },
    {
      name: "get_channel_state",
      description:
        "Return one channel's live state: name, topic, and current cellState map.",
      inputSchema: { name: z.string() },
      resolve: function (args) { return toolGetChannelState(args.name); },
    },
    {
      name: "get_reachable_server_fns",
      description:
        "Server functions reachable for an (entryPoint, role, depth). " +
        "Enumeration only (dispatchable: false). V0 limitation: returns the " +
        "full app-wide server-fn list with reachabilityFiltered:false — per-route " +
        "filtering awaits a node-id join follow-on.",
      inputSchema: {
        entryPoint: z.string(),
        role: z.string(),
        depth: z.number().int().optional(),
      },
      resolve: function (args) {
        return toolGetReachableServerFns(args.entryPoint, args.role, args.depth);
      },
    },
  ];
}

/** The 11 LOCKED tool names, in registration order — exported for tests that
 *  assert the public surface didn't drift. */
export var TOOL_NAMES = [
  "get_app_topology",
  "list_engines",
  "get_engine",
  "list_forms",
  "get_form_status",
  "list_routes",
  "get_route_chunks",
  "list_server_functions",
  "list_channels",
  "get_channel_state",
  "get_reachable_server_fns",
];

// ---------------------------------------------------------------------------
// SDK wiring — registerMcpTools(server, z)
//
// Registers all 11 tools on an McpServer. Each handler calls the resolver and
// wraps the result in the MCP content-block shape. Resolver throws (e.g.
// not-loaded / runtime-not-installed) are converted to an isError content
// response so the JSON-RPC channel stays well-formed — a thrown handler would
// otherwise surface as a protocol-level error.
// ---------------------------------------------------------------------------

export function registerMcpTools(server, z) {
  var specs = buildToolSpecs(z);
  for (var i = 0; i < specs.length; i++) {
    _registerOneTool(server, specs[i]);
  }
  return specs.length;
}

function _registerOneTool(server, spec) {
  var config = { description: spec.description };
  // registerTool requires inputSchema to be a ZodRawShape; for no-arg tools we
  // pass an empty shape so the SDK still routes the call cleanly.
  config.inputSchema = spec.inputSchema || {};
  server.registerTool(spec.name, config, function (args) {
    var payload;
    try {
      payload = spec.resolve(args || {});
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });
}

// ---------------------------------------------------------------------------
// startMcpServer(config) — long-lived-server-wrap boot entry (SCOPING §1 Q4).
//
//   config = { reactiveGet, derivedGet, outputDir, watch? }
//
// Boot sequence:
//   1. install({ reactive_get, derived_get })   — connect runtime read helpers.
//   2. loadSidecars(outputDir, { watch })        — load the 5 artifacts.
//   3. new McpServer(...) + registerMcpTools()   — register the 11 tools.
//   4. new StdioServerTransport() + server.connect(transport).
//
// STDIO discipline (SCOPING §5 Risk 4): nothing here writes to stdout — the
// transport owns stdout for JSON-RPC framing. Diagnostics go to stderr.
//
// Returns an McpHandle { server, transport, shutdown } for D's lifecycle wiring.
// The SDK + zod imports are LAZY (dynamic import) so importing this shim for the
// B-helpers / tool resolvers does not require the SDK to be present.
// ---------------------------------------------------------------------------

export async function startMcpServer(config) {
  var cfg = config || {};
  if (!cfg.outputDir) {
    throw new Error(
      "[scrml:mcp] startMcpServer requires config.outputDir (the directory the " +
        "descriptor sidecars + chunks.json were emitted to)."
    );
  }

  install({ reactive_get: cfg.reactiveGet, derived_get: cfg.derivedGet });
  loadSidecars(cfg.outputDir, { watch: cfg.watch === true });

  var mcpMod = await import("@modelcontextprotocol/sdk/server/mcp.js");
  var stdioMod = await import("@modelcontextprotocol/sdk/server/stdio.js");
  var zodMod = await import("zod");
  var McpServer = mcpMod.McpServer;
  var StdioServerTransport = stdioMod.StdioServerTransport;
  var z = zodMod.z || zodMod.default || zodMod;

  var server = new McpServer({ name: "scrml-mcp", version: "0" });
  registerMcpTools(server, z);

  var transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr-only readiness line — MUST NOT go to stdout (Risk 4).
  try { process.stderr.write("[scrml:mcp] server ready (stdio) — 11 tools registered\n"); } catch (_e) { /* ignore */ }

  var handle = {
    server: server,
    transport: transport,
    shutdown: function () { return shutdownMcpServer(handle); },
  };
  return handle;
}

// ---------------------------------------------------------------------------
// shutdownMcpServer(handle) — clean shutdown. Stops fs.watch handles, closes the
// transport, and releases the runtime ref. Idempotent. Swallows close errors so
// a double-shutdown / partial-boot handle never throws.
// ---------------------------------------------------------------------------

export async function shutdownMcpServer(handle) {
  stopWatchers();
  if (handle) {
    try {
      if (handle.transport && typeof handle.transport.close === "function") {
        await handle.transport.close();
      }
    } catch (_e) { /* ignore */ }
    try {
      if (handle.server && typeof handle.server.close === "function") {
        await handle.server.close();
      }
    } catch (_e) { /* ignore */ }
  }
  uninstall();
}
