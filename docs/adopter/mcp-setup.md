# MCP setup — exposing your scrml app to an LLM agent

**Status:** V0 (read-only). Implemented in scrml v0.6+ (`<program mcp>` opt-in landed S130).

scrml's MCP V0 surface exposes 11 read-only tools that an LLM coding agent can call over the [Model Context Protocol](https://modelcontextprotocol.io/) to inspect a running scrml app: engines + their current variant, forms + their live validity surface, channels + their state, server function signatures, and per-route chunk topology. The intent is **closing the agent's blind spot** — instead of guessing app shape from source files, the agent reads it from the live process.

The surface is **read-only**: V0 cannot dispatch server functions, write to state cells, or publish to channels. Dispatch lands in a separate later wave.

## Quick start — the 3-line adopter shape

Add the `mcp` attribute to your top-level `<program>`:

```scrml
<program mcp>
  ...
</program>
```

That's the entire opt-in. The compiler:

1. Auto-flips `--emit-per-route` on for your build so it emits the descriptor sidecars + `chunks.json` the MCP server reads.
2. Auto-injects the `scrml:mcp` boot import into your generated `_server.js`.
3. Gates the boot on `NODE_ENV !== "production"` so the MCP surface lights up in `scrml dev` + `scrml build`-then-run-locally, and stays dormant in production builds.

Run your build. Point your LLM agent's MCP client at the resulting stdio transport. Done.

## The two `mcp=` values

| Value | Behavior |
|---|---|
| `<program mcp>` *(bare — `dev-only` default)* | Auto-flips `--emit-per-route`, injects the boot, runtime-gates on `NODE_ENV !== "production"`. Safest default — the MCP server never accidentally ships in a production build. |
| `<program mcp="dev-only">` | Explicit `dev-only`; behaves identically to the bare form. |
| `<program mcp="always">` | Always boots, regardless of `NODE_ENV`. Use for CI introspection, production debugging panels, or any case where you want the MCP surface always-on. |

Any other value (`<program mcp="bogus">`) falls back to `dev-only` and emits `W-ATTR-002` against the unknown value. The safer default beats accidentally enabling `always`.

## What the compiler does for you

When `<program mcp>` is present, your build directory gains:

```
<outputDir>/
  ├── _server.js             ← boot import + startMcpServer({...}) wiring
  ├── _scrml/mcp.js          ← the scrml:mcp runtime shim (the 11-tool server)
  ├── engines.json           ← compile-time engine descriptors
  ├── forms.json             ← compile-time form descriptors + resolved cell keys
  ├── channels.json          ← compile-time channel descriptors + cell keys
  ├── serverfns.json         ← compile-time server-fn signatures
  └── chunks.json            ← per-route per-role chunk topology
```

The `_server.js` boot block looks roughly like this (`dev-only` mode):

```javascript
// MCP V0 Sub-unit D — scrml:mcp boot import (auto-injected by <program mcp> opt-in).
// Adopters do NOT directly import scrml:mcp; the attribute IS the opt-in.
import { startMcpServer, shutdownMcpServer } from "./_scrml/mcp.js";

// ... (your routes / Bun.serve() / etc) ...

// ----- MCP V0 Sub-unit D boot -----
const _scrml_mcp_boot_enabled = process.env.NODE_ENV !== "production";
if (_scrml_mcp_boot_enabled) {
  const _scrml_mcp_watch = process.env.SCRML_MCP_WATCH === "1";
  startMcpServer({
    reactiveGet: globalThis._scrml_reactive_get,
    derivedGet: globalThis._scrml_derived_get,
    outputDir: SERVE_DIR,
    watch: _scrml_mcp_watch,
  }).then((handle) => {
    globalThis._scrml_mcp_handle = handle;
    const _shutdown = () => { try { shutdownMcpServer(handle); } catch (_e) { /* ignore */ } };
    process.once("SIGINT", _shutdown);
    process.once("SIGTERM", _shutdown);
  }).catch((err) => {
    try { process.stderr.write("[scrml:mcp] startMcpServer failed: " + (err && err.message || err) + "\n"); } catch (_e) {}
  });
}
```

`mcp="always"` produces the same block minus the `NODE_ENV` gate (the `if (_scrml_mcp_boot_enabled) { ... }` wrapper drops out).

`startMcpServer` binds the MCP server to **process stdio** via `StdioServerTransport`. Stdout is reserved for JSON-RPC frame traffic; the readiness line + diagnostics go to stderr. SIGINT / SIGTERM trigger clean shutdown. Set `SCRML_MCP_WATCH=1` in the environment if you want the MCP server to `fs.watch` its sidecars (picking up rebuild deltas without restart); the default is OFF for deterministic boot.

## Pointing your LLM agent at the MCP server

The exact config shape depends on your MCP client (Claude Code, Cursor, Cline, etc.). The shape every client accepts is **stdio transport pointed at your scrml app's server process**. Example for an MCP client that takes a JSON config:

```json
{
  "mcpServers": {
    "my-scrml-app": {
      "command": "bun",
      "args": ["run", "/path/to/your/app/dist/_server.js"]
    }
  }
}
```

Your `_server.js` is a regular long-lived Bun process: it serves HTTP routes + WebSocket channels on the configured port AND speaks MCP JSON-RPC on stdio. The two transports do not conflict — HTTP / WS bind a TCP port, MCP binds stdio.

If your app needs to skip the MCP surface for a particular invocation, set `NODE_ENV=production` before launching — the runtime gate will short-circuit `startMcpServer`.

## The 11 tools

All tools are read-only. Tool names are a public contract — they will not be renamed across V0 patch releases.

### Topology

#### 1. `get_app_topology()`

Returns `chunks.json` verbatim — the full per-(entry-point, role, tier) chunk index. Equivalent to dumping `chunks.json` from disk; the tool exists so the agent doesn't need filesystem access to discover the topology.

- **Input:** none
- **Output shape:**
  ```json
  {
    "version": 1,
    "compiler": "0.6.0",
    "entryPoints": {
      "<ep-id>": {
        "<role>": { "initial": "<chunk-filename>", "tier1": "...", "tier2": "...", "tierN": [...] },
        ...
      },
      ...
    }
  }
  ```

#### 4a. `list_routes()`

Projection of `chunks.json` listing the `(entryPoint, roles[])` pairs in compact form. Use this to discover which (EP, role) pairs are valid before calling `get_route_chunks`.

- **Input:** none
- **Output shape:** `[{ entryPoint: string, roles: string[] }, ...]`

#### 4b. `get_route_chunks(entryPoint, role)`

Returns the tier entry for one (EP, role) pair — the same per-pair shape that lives under `chunks.json` `entryPoints[ep][role]`. Returns `null` when the pair is unknown.

- **Input:** `{ entryPoint: string, role: string }`
- **Output shape:** `{ initial?: string, tier1?: string, tier2?: string, tierN?: string[] }` or `null`

### Engines (§51.0)

#### 2a. `list_engines()`

Lists every state-machine engine in the app — compile-time facts only (variants, transition rules, kind). Use `get_engine(name)` for the live current-variant value.

- **Input:** none
- **Output shape:** `EngineDescriptor[]` where each entry is:
  ```json
  {
    "name": "<auto-declared-or-var-overridden>",
    "cellKey": "<runtime-state-key>",
    "type": "<EnumTypeName>",
    "variants": [{ "tag": "<VariantTag>", "fields": [{ "name": "<field>", "type": "<TypeAnnotation>" }] }, ...],
    "rules": { "<FromVariant>": ["<LegalTo>", ...], ... },
    "kind": "primary" | "derived"
  }
  ```

#### 2b. `get_engine(name)`

Returns one engine's descriptor plus its **live current variant**. The variant is normalized: payload variants like `.Loaded(rows)` surface as the tag string `"Loaded"` (the payload data is reachable via the engine variable's `data` field through other inspection mechanisms; the engine tool surface focuses on which-variant-is-active).

Returns `null` when the engine name is unknown.

- **Input:** `{ name: string }`
- **Output shape:** `EngineDescriptor` plus `{ currentVariant: string }`, or `null`

### Forms (§55)

#### 3a. `list_forms()`

Lists every compound state cell with auto-synthesized validators — name + per-field surface. Use `get_form_status(formName)` for the live `isValid` / `errors` / `touched` / `submitted` values.

- **Input:** none
- **Output shape:** `FormDescriptor[]` where each entry is:
  ```json
  {
    "formName": "<compound-cell-name>",
    "compoundKeys": {
      "isValidKey":   "<form>.isValid",
      "errorsKey":    "<form>.errors",
      "touchedKey":   "<form>.touched",
      "submittedKey": "<form>.submitted"
    },
    "fields": [
      {
        "name": "<field>",
        "qualifiedName": "<form>.<field>",
        "errorsKey":  "<form>.<field>.errors",
        "isValidKey": "<form>.<field>.isValid",
        "touchedKey": "<form>.<field>.touched"
      },
      ...
    ]
  }
  ```

#### 3b. `get_form_status(formName)`

Returns the live validity surface for one form, mirroring §55.5-§55.7. `errors` arrays contain `ValidationError` enum tags (e.g. `{ variant: "Required" }`, `{ variant: "LengthFailed", data: { predicate: ">=2" } }`) — NOT human strings; the agent gets the structured tags so it can reason about which validator fired.

Returns `null` for an unknown form name.

- **Input:** `{ formName: string }`
- **Output shape:**
  ```json
  {
    "isValid":   boolean,
    "errors":    { "<field>": [tag, ...], ... },
    "touched":   boolean,
    "submitted": boolean,
    "perField":  { "<field>": { "isValid": boolean, "errors": [tag, ...], "touched": boolean }, ... }
  }
  ```
  or `null`.

### Server functions (§12)

#### 5. `list_server_functions()`

Enumerates explicit `server function` declarations across the compile unit. Auto-escalated functions (functions that became server-side via Insight 26 body-content inference) are intentionally **excluded** from V0 — only EXPLICITLY-marked `server function`s surface, which matches "what the adopter authored as an RPC-callable boundary."

V0 cannot invoke server functions; every entry carries `"dispatchable": false`. Dispatch is V1 work.

- **Input:** none
- **Output shape:** `ServerFnDescriptor[]` where each entry is:
  ```json
  {
    "name": "<fnName>",
    "params": [{ "name": "<param>", "type": "<TypeAnnotation>|unknown" }, ...],
    "returnType": "<TypeAnnotation>|unknown",
    "file": "<absolute-file-path>",
    "dispatchable": false
  }
  ```

#### 7. `get_reachable_server_fns(entryPoint, role, depth?)`

Intended to project the per-(EP, role) reachable subset of server functions. **V0 limitation:** the artifacts a `--emit-per-route` build produces today do not carry a node-id ↔ name join, so per-route filtering is not computable. Rather than fabricate reachability, the tool is degraded-honest: it validates the (EP, role) pair exists in `chunks.json`, then returns the **full app-wide** server-fn list annotated `reachabilityFiltered: false` plus a `note` describing the gap.

Returns `found: false` for an unknown pair.

- **Input:** `{ entryPoint: string, role: string, depth?: number }`
- **Output shape:**
  ```json
  {
    "found":       boolean,
    "entryPoint":  string,
    "role":        string,
    "depth":       number | null,
    "reachabilityFiltered": false,
    "serverFns":   ServerFnDescriptor[],
    "note":        string
  }
  ```

The real fix (auto-emit reachability + add a `nodeId` field to `serverfns.json`) is a documented follow-on. Until it lands, treat Tool 7 as a strict superset of Tool 5 with route-validity confirmation.

### Channels (§38)

#### 6a. `list_channels()`

Lists every `<channel>` declared in the entry-file `<program>`s — name + topic + the V5-strict auto-synced cells (§38.4) that are sync'd across clients.

- **Input:** none
- **Output shape:** `ChannelDescriptor[]` where each entry is:
  ```json
  {
    "name":  "<channel-name>",
    "topic": "<topic-or-channel-name>",
    "autoSyncedCells": [{ "name": "<cell>", "key": "<runtime-state-key>" }, ...]
  }
  ```

#### 6b. `get_channel_state(name)`

Returns the live state map of a channel's auto-synced cells — the same values an HTTP client connected to `/_scrml_ws/<name>` would see. The MCP server runs server-side, so it reads the server-side state map; per-client divergent views are not exposed in V0.

Auth caveat: if a channel has `auth="required"` (§38.5), the WS upgrade gate is enforced for client connections, but the MCP server's read of the server-side state map is NOT gated. Treat the MCP server as a trusted introspection peer.

Returns `null` for an unknown channel name.

- **Input:** `{ name: string }`
- **Output shape:** `{ name: string, topic: string, cellState: { "<cellName>": <value>, ... } }` or `null`

## Troubleshooting

### "I added `<program mcp>` but no sidecars appear"

The auto-flip only fires when `<program mcp>` lives on the **top-level** `<program>` element of the entry file (the first `<program>` markup node `compileScrml` scans for it). Nested `<program>` blocks (per §43) are silently skipped — `mcp=` there is a no-op. Move the attribute to the file's top-level `<program>` and re-build.

If the attribute IS on the top-level `<program>` and sidecars still don't appear: re-run with `--verbose`; the compiler logs `[MCP] <program mcp> detected — auto-flipping --emit-per-route ON (mode: ...)` when the attribute is recognized. If you don't see that line, the attribute isn't being parsed (check for a typo like `mcp:dev-only` or `mcp.dev-only`).

### "The MCP server boots, but `get_engine` / `get_form_status` / `get_channel_state` return undefined"

**Known V0 limitation:** the generated per-module `.server.js` files do NOT yet stash their reactive read helpers (`_scrml_reactive_get` / `_scrml_derived_get`) on `globalThis`. The boot block passes `globalThis._scrml_reactive_get` to `startMcpServer`, but those properties are unset until the globalThis-stash wave lands. The topology tools (1, 2a, 3a, 4a, 4b, 5, 6a, 7) are not affected — they read from sidecars.

Workaround until the wave lands: wire `globalThis._scrml_reactive_get` + `globalThis._scrml_derived_get` manually in your boot file before `startMcpServer` runs (or accept the topology-only view).

### "`scrml dev` doesn't expose MCP, only `scrml build` does"

Correct for V0. `scrml dev` runs `Bun.serve` in-process and does not generate `_server.js`, so the V0.D boot injection (which targets `_server.js`) is not reached. Use `scrml build` for a process you can point an MCP client at; in-process dev-server MCP is a documented follow-on.

### "STDOUT looks like garbage"

The MCP server uses stdio JSON-RPC framing on stdout. Don't `print` / `console.log` from your generated server code on stdout — route diagnostics through `console.error` / `process.stderr.write`. The compiler-generated boot does this correctly; if you have hand-authored modules that log to stdout, you'll need to migrate them.

## References

- SCOPING document — `docs/changes/mcp-v0-devtools-scoping/SCOPING.md`
- Implementation progress — `docs/changes/mcp-v0-devtools-scoping/progress.md`
- Runtime shim — `compiler/runtime/stdlib/mcp.js`
- Descriptor extractor — `compiler/src/codegen/mcp-descriptors.ts`
- Attribute wiring — `compiler/src/attribute-registry.js` (search for `"mcp"`)
- Boot injection — `compiler/src/commands/build.js` `generateServerEntry`
- MCP TypeScript SDK — `@modelcontextprotocol/sdk@1.29.0` (MIT)
- Model Context Protocol spec — https://modelcontextprotocol.io/specification/2025-11-25
