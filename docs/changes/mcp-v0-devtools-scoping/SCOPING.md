---
status: current
last-reviewed: 2026-05-23
topic: V0 MCP-DevTools — implementation scoping (post deep-dive crystallization)
parent-dive: ../../../../../scrml-support/docs/deep-dives/scrml-mcp-llm-agent-surface-2026-05-23.md
direction: S124 — "V0 of mcp parallel"
---

# V0 MCP-DevTools — SCOPING

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a47475be071147108`
**Base (post merge main):** `f0368d9c` (M6.5.b.0 within-node parity canary extension landed)
**Survey-only.** No source files touched. Produces this SCOPING.md + progress.md.
**Substrate:** S122 deep-dive `scrml-mcp-llm-agent-surface-2026-05-23.md` (651 lines, status `current`). This SCOPING does NOT re-research; it crystallizes the v0 surface into dispatchable sub-units.

---

## 0. Headline

V0 MCP is dispatchable. The compiler already emits or trivially can emit every data surface v0 needs. The off-the-shelf TypeScript MCP SDK (`@modelcontextprotocol/server`, Apache 2.0 / MIT, Bun-compatible per its README) closes the protocol side. The 4 PA-facing questions are tractable; none are blockers. **No SPEC amendment is required for V0** — the `<program mcp>` attribute is a clean registry addition with zero collisions, but if the PA wants to formalize it in SPEC §40.8 first the dispatch can ship behind it.

Total re-estimate after empirical survey: **52-78 engineer-hours**, broken across 5 sub-units (A through E). The deep-dive's 40-80h band holds; the survey collapsed nothing and surfaced no hidden complexity that would push past 80h. The dispatchable shape is 5 sub-units; A and B can run in parallel; C depends on A+B; D depends on C; E depends on D. Critical path ~5 calendar days at one-agent-per-sub-unit.

There is **no M6 dependency** — verified empirically against current code. V0 reads `chunks.json` + new runtime descriptor sidecars + existing runtime helper exports; none of these surfaces are M6-gated.

---

## 1. V0 scope confirmation — the 10 read-only tools

Per deep-dive §7.1, V0 ships 10 read-only MCP tools. For each: source of truth in the compiler/runtime, implementation complexity, test surface, deferral statement.

### Tool 1 — `get_app_topology()`

- **Returns:** `chunks.json` verbatim.
- **Source of truth:** `compiler/src/codegen/route-splitter.ts:208` (the `ChunksManifest` interface) — emitted to `<outputDir>/chunks.json` by `api.js:1967` when the `--emit-per-route` CLI flag is set (gated at `commands/compile.js:154`).
- **Implementation complexity:** CHEAP. Read the file from disk at server startup; cache; serve.
- **Test surface required:** One integration fixture compile-with-`--emit-per-route`, then assert MCP returns the exact JSON bytes.
- **Deferral:** None. This is the highest-leverage v0 tool because every other tool is parameterized by entry-point / role, and this one returns the index.
- **Caveat:** Requires `--emit-per-route` flag to be set at the build the MCP server is reading from. Either: (a) the dev-mode default flips this on when `<program mcp>` is present, or (b) the MCP server returns `E-MCP-NO-CHUNKS-MANIFEST` if the artifact is missing and surfaces the fix-path in the error message. **Recommend (a)** — fewer footguns; the attribute IS the opt-in.

### Tool 2 — `list_engines() / get_engine(name)`

- **Returns:** Per-engine `{ name, type, variants: [...], rules: {...}, currentVariant }`.
- **Source of truth:** SPLIT.
  - Compile-time facts (name, type, variants, rules) live in the AST + type system: `compiler/src/types/ast.ts:904` (`kind: "engine-decl"`), `emit-engine.ts`, and §51.0 spec semantics.
  - Runtime fact (currentVariant) lives in `_scrml_state[name]` — read via `_scrml_reactive_get(name)` from `runtime-template.js:406`.
- **Implementation complexity:** MEDIUM. Requires a new runtime descriptor sidecar (call it `engines.json` — see Sub-unit A) that the compiler emits during CG carrying compile-time facts per engine. Runtime current-variant is a thin `_scrml_reactive_get` wrapper (Sub-unit B).
- **Test surface required:** Fixture with 2-3 engines of varying shape (simple, with payloads per §51.0.B.1, nested per §51.0.Q.1); assert the descriptor matches; assert `currentVariant` updates when the engine advances.
- **Deferral:** Derived engines (§51.0.J) included as `kind: "derived"` field on the descriptor (not call site for v0 — these are read-only by definition).

### Tool 3 — `list_forms() / get_form_status(formName)`

- **Returns:** `{ isValid, errors, touched, submitted, perField: { fieldName: { isValid, errors, touched } } }` per §55.5-§55.7.
- **Source of truth:** Auto-synthesized derived cells emitted by `compiler/src/codegen/emit-validators.ts` (per-field) + `emit-synth-surface.ts` (compound). Reachable at runtime via `_scrml_derived_get(<encoded-key>)` per `emit-validators.ts:222`.
- **Implementation complexity:** MEDIUM. The compiler already enumerates forms during validator emission; the sidecar (Sub-unit A — `forms.json`) lists `{ formName, fields[] }` and maps each readable cell name to its `encodeKey()` runtime key. Runtime helper (Sub-unit B) wraps `_scrml_derived_get` for each.
- **Test surface required:** Fixture with one `formFor`-synthesized form + one hand-authored compound with validators per §55.5; both should appear in `list_forms`; toggling a field's input should flip `get_form_status`.
- **Deferral:** None for v0. `ValidationError` enum values per §55.9 ship as their compiler-emitted shape `{ variant: "Required" }` / `{ variant: "LengthFailed", data: { predicate: ">=8" } }` — that IS the structured surface the deep-dive §4.2 names as the LLM-agent advantage.

### Tool 4 — `list_routes() / get_route_chunks(EP, role)`

- **Returns:** Per-(EP, role) `{ initial, tier1, tier2, tierN[] }` per `ChunksManifestEntry` at `route-splitter.ts:184`.
- **Source of truth:** `chunks.json` (already enumerated under Tool 1; this is a projection).
- **Implementation complexity:** CHEAP. Pure JSON projection over the cached manifest.
- **Test surface required:** Fixture with one multi-page app + one role-enum that gates a route differently per role; assert per-role chunk-set differs.
- **Deferral:** `get_reachable_server_fns(EP, role, depth: N)` from deep-dive §4.5 is NOT in the 10-tool surface. Confirm with PA whether to add it now (the underlying `serverFnNodeIds` per-chunk is already in `ChunkContents` — surfacing it is one extra projection function) or defer to V1 dispatch surface. **Recommend INCLUDE in v0** — cheap, doesn't change the no-write posture, valuable to the agent.

### Tool 5 — `list_server_functions()`

- **Returns:** `{ name, params: [{ name, type }, ...], returnType }` — NAME + SIGNATURE ONLY. No `call_server_function` in v0 per deep-dive §7.1.
- **Source of truth:** RI Stage 5 server-fn registry + type-system signatures (TS Stage 6). Reachable through the per-file compile output.
- **Implementation complexity:** MEDIUM. The signatures exist in the type system but are not currently a CG sidecar artifact. Add to `serverfns.json` sidecar in Sub-unit A.
- **Test surface required:** Fixture with 2-3 server functions of varied signatures; assert names + parameter types + return types are surfaced.
- **Deferral confirmation:** Per deep-dive §7.1 "name + signature only (no call surface in v0)." **CONFIRM this stance** in PA Q2. Listing without calling has a known UX risk — the agent sees an affordance it cannot use. Two responses:
  - **(a) Drop entirely from v0.** Then the agent never sees server-fn names; topology is engine-only + form-only + routes. Drops one of the 6 surfaces foldkit DOES NOT have (per deep-dive §6.1 "Per-route per-role topology" line).
  - **(b) Keep listing-only AND add a per-tool `dispatchable: false` annotation** so the agent knows it's an enumeration not an invocation. The MCP tool's `description` field carries the explanation. **Recommend (b)** — preserves the differentiator from §6.1; the annotation pattern can extend to engine + cell write tools when v1 lands them.

### Tool 6 — `list_channels() / get_channel_state(name)`

- **Returns:** Per channel `{ name, topic?, auto-synced-cells: [...], cellState: { cellName: value, ... } }`.
- **Source of truth:** Channel decls per `compiler/src/codegen/emit-channel.ts`; auto-synced cells per §38.4. Runtime cell values via `_scrml_reactive_get(<encoded-key>)`.
- **Implementation complexity:** MEDIUM. New `channels.json` sidecar (Sub-unit A) lists channels + their cell names. Runtime helper (Sub-unit B) reads cells. Note: server-side cell state versus client-side cell state are distinct — for v0 stdio (server-process MCP), the server-side view is the canonical answer.
- **Test surface required:** Fixture with one `<channel>` + a writer + an observer; assert state reads correctly; the multi-client view (the v1+ multi-agent surface from deep-dive §4.3) is OUT of v0 scope.
- **Deferral:** Multi-agent channel-mode MCP (deep-dive §4.3 v1+ — `publish_to_channel`) is OUT of v0. v0 read-only never writes to a channel.
- **Auth caveat:** v0 stdio MCP server runs server-side and reads the server-side state map. If a channel has `auth="required"` (§38.5), `get_channel_state` from v0 still reads it — the auth gate applies to WS upgrades, not to server-process inspection. **This is correct v0 behavior** but worth documenting in adopter docs.

### V0 tool count tally

- 10 tools per the deep-dive §7.1: `get_app_topology`, `list_engines`, `get_engine`, `list_forms`, `get_form_status`, `list_routes`, `get_route_chunks`, `list_server_functions`, `list_channels`, `get_channel_state`.
- Recommended add (Q2 below): `get_reachable_server_fns(EP, role, depth)` — cheap projection over already-emitted reachability records; 1 more tool → 11.
- Recommended posture (Q2 below): keep `list_server_functions` with a `dispatchable: false` annotation rather than dropping.

---

## 2. The 4 PA-facing questions — sharpened

### Q1 — Slot: v0.4 / v0.5 / v0.6 / post-v0.7

**Per user direction S124:** "V0 of mcp parallel" → V0 dispatches alongside M6.5 Wave 2, not after. Implied slot: v0.4-v0.5 release co-cut with M6 close. Per pa.md Rule 1, scrml is pre-1.0 + non-load-bearing-marketing; the release-cut work is light.

**Sharpened sub-questions:**

- **Release-cut artifacts.** A changelog entry shape: "v0.4 — V0 MCP DevTools surface: `<program mcp>` opt-in exposes 11 read-only tools over MCP stdio transport. See `docs/adopter/mcp-setup.md`." That's the load-bearing message; no marketing claims.
- **Versioning posture.** Since V0 is read-only, additive, and behind an attribute opt-in, semver-wise it's PATCH-compatible. v0.4.x → v0.5.0 (the attribute is a new public surface) → no breaking changes for non-adopters.
- **Migration story.** None — adopters opt in by adding `<program mcp>`; non-adopters see zero behavior change.
- **PA decision shape for Q1.** "Confirm v0.4 slot AND parallel-with-M6.5 Wave 2 dispatch order" is one sentence. The empirically-load-bearing decision is dispatch ORDER (parallel-or-not) rather than slot number.

**Recommendation to PA:** Slot v0.4 (next minor); dispatch starts now in parallel with M6.5 Wave 2; release co-cuts whenever both close.

### Q2 — V0 tool scope: 10 tools per §7.1 — add or drop?

**Sharpened sub-questions:**

- **Add `get_reachable_server_fns(EP, role, depth: N)`.** Deep-dive §4.5 names this tool. It's a cheap projection over `ChunkContents.serverFnNodeIds` (already emitted). Strict superset of value to the agent. **Recommend ADD.**
- **`list_server_functions` posture.** Keep with `dispatchable: false` annotation (recommended) OR drop entirely. Cost differential: 0 hours either way (the symbols are emitted regardless; the tool is 10 lines).
- **Should anything else from the deep-dive surface inventory appear?** Checking Phase 1 catalog (§4.1-§4.6):
  - §4.1 Engines — covered by Tools 2.
  - §4.2 Validity — covered by Tool 3.
  - §4.3 Channels — covered by Tool 6 (read-only slice).
  - §4.4 Server functions — covered by Tool 5 (list-only).
  - §4.5 Chunks — covered by Tools 1 + 4 + the recommended Tool 7.
  - §4.6 Engine transitions — NOT covered (the global-transition-hook surface is v1, per deep-dive §7.2; deferral is correct).
- **Anything to DROP?**
  - The `list_server_functions` UX concern (agent sees affordance, can't use it) is the only candidate. Posture (b) above addresses it without removal.

**Recommendation to PA:** 11 tools (10 from §7.1 + `get_reachable_server_fns`); keep `list_server_functions` annotated `dispatchable: false`.

### Q3 — Open design questions (6 in deep-dive §8) — V0 vs V1

The deep-dive §8 lists 6 cross-cutting design questions. For each, V0-block status:

1. **MCP-as-channel vs MCP-as-stdio.** V0 picks stdio per §7.1. NOT a v0 blocker.
2. **Auth model for dispatch.** Pure v1 concern (no dispatch in v0). NOT a v0 blocker.
3. **Global transition hook in SPEC vs debug-only tap.** Pure v1 concern (no transition-subscribe in v0). NOT a v0 blocker.
4. **Should `<program mcp>` ship in production builds?** **THIS IS THE ONE V0 QUESTION.** Three sub-options:
   - **(a) Always dev-only.** `<program mcp>` is silently a no-op when `NODE_ENV === "production"` (or scrml's equivalent build-mode flag). Safest default.
   - **(b) Adopter-controlled via value.** `<program mcp="dev-only">` (default), `<program mcp="always">` for the CI/production-introspection case.
   - **(c) Always enabled.** Adopter opt-in IS the opt-in; the attribute presence means "I want this on."
   - **Recommend (b)** — matches the existing `<program>` attribute style (most use enums per `attribute-registry.js:88-141`: `auth="required|optional|none"`, `csrf="auto|off"`, `log="structured|minimal|off"`). Adopters who only want dev get the safe default; the "always" escape hatch covers introspection panels + CI without needing per-environment build flags.
5. **Composition with `test-bind` (§A6).** v1+ concern — A6 work in flight per cited deep-dive. NOT a v0 blocker.
6. **Composition with native parser (M6).** v1+ acceleration. NOT a v0 blocker.

**Recommendation to PA:** Only Q3.4 needs an answer before V0 dispatches. Recommended answer: option (b) — `<program mcp="dev-only">` default + `<program mcp="always">` escape hatch. The other 5 are v1+ design work that can proceed in parallel with V0 implementation.

### Q4 — `scrml:mcp` stdlib pattern fit

The deep-dive frames this as "does it fit the existing `scrml:NAME` shim convention." The convention is anchored at §41 (NOT §47.11 — see §5.1 Risk register; the brief reference to §47.11 was incorrect — §47 is Output Name Encoding). Surveyed shape:

- **Existing stdlib physical pattern** (verified via `stdlib/host/`, `stdlib/auth/`, `stdlib/data/`):
  - Source at `stdlib/<name>/index.scrml` — declares the export surface as scrml `export` decls with stub bodies (see `stdlib/host/index.scrml` lines 88-93 for the canonical stub-body pattern).
  - Runtime shim at `compiler/runtime/stdlib/<name>.js` — hand-authored ES module that implements the export surface. Copied to `<outputDir>/_scrml/<name>.js` by `api.js:bundleStdlibForRun`.
  - Bundler resolution: `scrml:NAME` → resolve to source's exports for type-check; runtime imports resolve to `<outputDir>/_scrml/<name>.js`.
- **`scrml:mcp` divergences from the canonical shape:**
  - **Server-wrapping vs utility-wrapping.** Existing `scrml:NAME` modules wrap PURE UTILITIES (`safeCall` thunks, `parseVariant` JSON, `validate` predicates, etc.) or PROCESS-LOCAL primitives (`fs`, `path`, `process`). NONE wrap a long-lived stateful server. `scrml:mcp` would wrap the MCP server lifecycle (`server.connect(transport)` is a long-lived call). **First-of-its-kind.**
  - **Lifecycle binding to `<program>`.** `scrml:mcp` wants to be auto-installed when `<program mcp>` is present, NOT just when an adopter `import { ... } from 'scrml:mcp'`. The existing shape requires explicit import; `scrml:mcp` wants attribute-driven activation.
  - **Server-process-only.** Like `scrml:auth`, `scrml:db`, etc. (per the SERVER_ONLY_SCRML_MODULES set referenced at SPEC line 6713), the MCP server is server-only. The pattern fits.
- **Pattern-divergence verdict:** The lifecycle-binding-to-`<program>` divergence is REAL but NOT structural. Two responses:
  - **(a) Treat `scrml:mcp` as an internal stdlib not meant for direct import.** Adopters never `import { ... } from 'scrml:mcp'`; they just add `<program mcp>` and the compiler wires it up. The stdlib module exists for the compiler-generated boot code to import. **Recommend (a).** Matches the auto-middleware pattern from §40.2 (CORS, log, headers, ratelimit are `<program>` attributes; the runtime modules behind them are not directly importable either).
  - **(b) Expose direct-import surface too** for adopters who want programmatic control over MCP server lifecycle. Adds API surface; defers to v1 when use cases surface.
- **Server-wrapping divergence.** Long-lived server lifecycle is a NEW stdlib precedent. The closest precedent is `stdlib/cron/` (long-lived job scheduler — `Bun.cron`) — verify its lifecycle pattern. Likely follows: registration at module-init time; server-process catches its hooks. `scrml:mcp` can mirror this. **Verify in Sub-unit C** (one-file scope check; if the pattern doesn't fit, surface back).

**Recommendation to PA:** Stdlib pattern fit is GOOD with one new convention (long-lived-server-wrap). Recommend treating `scrml:mcp` as compiler-internal (not directly imported); v0 wires it via `<program mcp>` attribute exclusively. Mirror the `stdlib/cron/` lifecycle pattern.

---

## 3. V0 implementation sub-unit decomposition

5 sub-units. A and B parallelizable. C depends on A+B. D depends on C. E depends on D.

### Sub-unit A — Descriptor emission (CG-side)

**Scope:** Compiler emits 4 new runtime descriptor sidecars alongside the existing `chunks.json`:

- `engines.json` — `[{ name, type, variants: [{ tag, fields: [{ name, type }] }], rules: { fromVariant: [legalTo, ...] }, kind: "primary" | "derived" }, ...]`
- `forms.json` — `[{ formName, fields: [{ name, qualifiedName, errorsKey, isValidKey, touchedKey }] }, ...]`
- `channels.json` — `[{ name, topic, autoSyncedCells: [{ name, key }] }, ...]`
- `serverfns.json` — `[{ name, params: [{ name, type }], returnType, file, dispatchable: false }, ...]`

**Source-of-truth wiring:**

- `engines.json` ← `emit-engine.ts` + AST `kind: "engine-decl"` walks + §51.0 rule resolver.
- `forms.json` ← `emit-validators.ts` (per-field cell keys) + `emit-synth-surface.ts` (compound surface) + the `encodeKey()` function used at validator emission.
- `channels.json` ← `emit-channel.ts` walks of `<channel name=...>` decls + auto-synced cell emit.
- `serverfns.json` ← `runFinalize`/RI Stage 5 server-fn registry + TS Stage 6 type-system signatures.

**Emission point:** Mirror `api.js:1967` (chunks.json write site). Each sidecar emitted next to `chunks.json` in `<outputDir>/`. Gated by the same `--emit-per-route` flag (or — see Sub-unit D — by `<program mcp>` presence flipping the flag on automatically).

**Test surface:** Per-sidecar unit test (assert JSON shape against fixture compile output) + one cross-cutting integration test (assert all 4 sidecars present + valid JSON when `<program mcp>` is set).

**Sizing:** 4 sidecars × ~3-4 hours each (extractor + emit-point wire + test) = **12-16 hours.**

**Risks:**

- Form discovery is currently scattered across `emit-validators.ts` (per-field) + `emit-synth-surface.ts` (compound) + `emit-form-for.ts` (`formFor`-synthesized forms). The extractor needs to walk all three. Mitigation: there's no third-party form pattern; these three sites are exhaustive.
- Server-fn return-type extraction depends on TS Stage 6 having run. Confirm pipeline order in `api.js` — TS runs before CG, so signatures are available.

### Sub-unit B — Runtime helpers

**Scope:** Three thin wrappers over the existing reactive-cell read path:

- `getCurrentVariant(engineName)` — wraps `_scrml_reactive_get(engineName)`.
- `getFormStatus(formName)` — wraps `_scrml_derived_get(<encoded-keys>)` for the form's `isValid` + `errors` + `touched` + `submitted` + per-field cells; composes the structured shape.
- `getChannelState(channelName)` — for each auto-synced cell of the channel, wraps `_scrml_reactive_get(<key>)` and composes the `{ cellName: value }` map.

**Source-of-truth wiring:**

- All three wrap existing `runtime-template.js` helpers: `_scrml_reactive_get` (line 406) and `_scrml_derived_get` (line 849). The wrappers know which keys to read because they consume the per-app sidecars from Sub-unit A.

**Where to live:** Add to `compiler/runtime/stdlib/mcp.js` (hand-authored shim per the existing `scrml:NAME` convention). The shim is the runtime side of `scrml:mcp`.

**Test surface:** Unit tests against a small compiled fixture; assert each helper returns the right shape; assert update propagation (advance engine → helper returns new variant).

**Sizing:** Each wrapper ~1-2 hours + sidecar-consumer logic + tests = **6-10 hours.**

**Risks:**

- The `encodeKey` function is internal to `emit-validators.ts`. Either: (a) export it for the sidecar to use AND for the runtime helper to use, or (b) the sidecar emits resolved keys and the runtime helper just reads them. **Recommend (b)** — eliminates the cross-module dependency; sidecar is the single source of truth.

### Sub-unit C — `scrml:mcp` stdlib module

**Scope:** Author the stdlib module that exposes the 11 MCP tools.

**Files to create:**

- `stdlib/mcp/index.scrml` — declares the public surface (per existing stdlib convention). Stub bodies; real impl in the runtime shim.
- `compiler/runtime/stdlib/mcp.js` — runtime shim. Imports the MCP TypeScript SDK (`@modelcontextprotocol/server`); imports the Sub-unit B runtime helpers; loads the Sub-unit A sidecars; registers 11 `server.registerTool` handlers; binds `StdioServerTransport`.
- Sidecar loader: reads `<outputDir>/{engines,forms,channels,serverfns,chunks}.json` at startup.

**Tool handler shape** (all 11 follow the same shape; per the MCP SDK API):
```typescript
server.registerTool(
  "get_engine",
  {
    description: "Return descriptor for one engine including current variant.",
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => {
    const descriptor = engines.find(e => e.name === name);
    const currentVariant = getCurrentVariant(name);
    return { content: [{ type: "text", text: JSON.stringify({ ...descriptor, currentVariant }) }] };
  }
);
```

**MCP SDK dependency:**
- `@modelcontextprotocol/server` (npm). Apache 2.0 / MIT. Bun-compatible per README. Add to scrmlTS root `package.json` dependencies.
- Zod for input schema validation per the SDK's expected shape.

**Test surface:** Integration test — spin up the MCP server against a fixture's compiled output; speak MCP-protocol JSON-RPC over stdio (or use the SDK's `Client` companion for the test harness); assert each of the 11 tools returns the expected shape.

**Sizing:** 11 tools × ~1 hour (handler is mostly boilerplate per the example above) + sidecar-loader + transport-boot + dependency setup + integration test harness = **14-22 hours.**

**Risks:**

- The SDK's `McpServer` lifecycle may not be Bun-clean for long-running stdio in some edge cases (graceful shutdown on SIGINT/SIGTERM). Mitigation: 1 hour of manual smoke test before declaring done.
- The stdlib pattern divergence flagged in Q4 — long-lived server wrap is a new precedent. The implementation surface is bounded; the architectural divergence is a doc-update concern not an impl complexity concern.

### Sub-unit D — `<program mcp>` attribute wiring

**Scope:** Auto-install the MCP server when `<program mcp>` is present + the build is in dev-mode.

**Files to touch:**

- `compiler/src/attribute-registry.js` — add `mcp` to the `ELEMENT_ATTR_REGISTRY.get("program").allowedAttrs` Map with the spec from Q3.4 (allowedValues: `["dev-only", "always"]`, default `"dev-only"`).
- `compiler/src/compute-program-config.ts` — extract `mcp` attr value into the program config struct.
- `compiler/src/api.js` (around the existing per-program emission point) — when `mcp` is present, automatically flip `--emit-per-route` on (so sidecars + chunks.json get emitted) AND inject the `scrml:mcp` boot import into the server entry.
- `commands/compile.js` — surface the auto-flip in `--verbose` output so adopters see what was wired.

**Test surface:** Fixture compile with `<program mcp>` → assert sidecars emitted (no explicit `--emit-per-route` flag); fixture compile with `<program mcp="always">` → assert production build also wires; fixture compile without `<program mcp>` → assert NO MCP wiring (baseline regression guard).

**Sizing:** Attribute registration + extraction + flag auto-flip + boot-injection + 3 fixture tests = **8-12 hours.**

**Risks:**

- The auto-flip of `--emit-per-route` when `<program mcp>` is present may surprise adopters who didn't ask for per-route artifact splitting separately. Mitigation: the `--verbose` log line + a doc paragraph; not a SPEC concern.
- Build-mode detection (dev vs production) in scrml — verify how this is currently detected. If there's no canonical hook, falls into Q3.4 territory and may need explicit adopter env-var. Likely there's already a convention via the `[story]` / build-story surface per §58 — survey at impl time.

### Sub-unit E — Tests + adopter docs

**Scope:** End-to-end integration tests against a non-trivial fixture; adopter-facing setup doc.

**Files to create:**

- `compiler/tests/integration/mcp-v0-e2e.test.js` — boot the MCP server against a multi-page fixture; invoke each tool; assert shape.
- `docs/adopter/mcp-setup.md` — adopter-facing setup: add `<program mcp>`, compile, point your LLM-agent's MCP client at the stdio transport, list of 11 tools with input/output shape.
- One fixture under `compiler/samples/mcp-v0-fixture/` — a small multi-page app with 2 engines + 1 form + 1 channel + 2 server fns + 1 role-enum gating.

**Test surface:** The fixture IS the test surface. Each of the 11 tools gets one round-trip assertion.

**Sizing:** Fixture authoring (~4h) + E2E test harness (~4h) + adopter doc (~2-4h) = **10-12 hours.**

**Risks:**

- The E2E test needs to spawn the MCP server as a subprocess (or in-process via the SDK's `Client` companion). The SDK provides both; pick the simpler. Bun's `Bun.spawn` is fine for the subprocess case if needed.

### Sub-unit dependency graph

```
A (sidecars)  ──┐
                ├──→ C (stdlib module) ──→ D (attribute wiring) ──→ E (tests + docs)
B (helpers)   ──┘
```

A and B can run in parallel as two separate sub-agents. Critical path: A or B → C → D → E. With one agent per sub-unit (3 sequential + 2 parallel for A/B), critical-path calendar time is ~5 days at 8h/day per agent.

---

## 4. Dependencies — the parallel-with-M6 claim

**Per S124 user direction:** V0 MCP proceeds in parallel with M6.5 Wave 2 (not after). The deep-dive §7.1 asserts no M6 dependency. Verified empirically:

### V0 reads from

- `chunks.json` — already emitted (route-splitter Wave A-4 landed). No M6 dep.
- New sidecars (`engines.json`, `forms.json`, `channels.json`, `serverfns.json`) — emitted from CG-time AST + type-system data, ALREADY produced by either parser path (M6.5 native or legacy).
- Runtime helpers (`_scrml_reactive_get`, `_scrml_derived_get`) — runtime-template.js stable; not touched by M6.

### M6 Wave 2 conflict surface

M6.5 Wave 2 is the within-node parity work (`compiler/src/native-parser-canary/within-node-classifier.ts` per the recent landing). It's a PARSER concern (M6 is the parser swap). The Sub-unit A descriptor emission lives in the CG phase, AFTER parsing. M6 changes the AST PRODUCTION; V0 reads the AST CONSUMPTION. No file-level conflict.

**Empirical file-overlap check:**

- M6 active files (per recent commits + `compiler/src/native-parser-canary/`, `compiler/src/native-walker/`): all parser-stage / walker files.
- V0 sub-unit A touch list: `emit-engine.ts`, `emit-validators.ts`, `emit-synth-surface.ts`, `emit-channel.ts`, `api.js` (sidecar write sites), `attribute-registry.js`.
- V0 sub-unit D touch list: `attribute-registry.js`, `compute-program-config.ts`, `api.js`, `commands/compile.js`.
- **Overlap surfaces:**
  - `api.js` — both M6 (parser swap wires through api.js for `runBs` parser-select) AND V0 (sidecar write sites + boot injection) touch this file. EXPECTED some merge friction over the M6 transition window. Mitigation: V0 sub-units should run `git merge main` regularly (S112 rule) to absorb M6 commits.
  - `attribute-registry.js` — M6 should NOT touch this (parsers don't reach attribute-spec). Cross-check: `grep` confirms M6.6/M6.7 work was in walker + symbol-table land, not the attribute registry. CLEAR.

### Dual-parser-output handling during M6 transition window

Per the brief: if V0 lands during M6 transition, does the runtime descriptor emit need to handle both native + legacy parser outputs?

**Empirical answer:** NO at the descriptor-emit level. The native parser's exit contract is parity with the legacy parser at the AST surface (that's the M6 charter — drop-in replacement). The CG stage (where Sub-unit A lives) consumes the AST without caring which parser produced it. The dual-parser-output complexity is bounded inside parser-stage code; AST-consumer code (incl. all of CG) doesn't need to discriminate.

**Confirmation:** Sub-unit A's extractors will work identically against either parser output as long as the AST shape stays normalized (which IS the M6 invariant — see recent within-node canary work). If parity drift surfaces during V0 dispatch, that's an M6 bug not a V0 bug.

### Verdict

**No M6 dependency.** No file conflicts that can't be absorbed by a regular merge. V0 dispatches IN PARALLEL safely.

---

## 5. Risk register

### Risk 1 — `<program mcp>` attribute namespace collision

**Verified:** NO collision. Per `compiler/src/attribute-registry.js` lines 81-143, the `<program>` attribute set is:

`db, tables, html, name, auth, loginRedirect, csrf, sessionExpiry, title, description, version, author, license, cors, log, headers, ratelimit, idempotency-store, idempotency-ttl, batch-in-list-cap, cors-max-age, channel-reconnect, lang, mode, callchar, build, autostart, restart, max-restarts, within`

`mcp=` is fresh — no overlap with any existing or reserved-vocab attribute. **CLEAR.**

### Risk 2 — MCP TypeScript SDK runtime constraints

**Verified:**

- License: Apache 2.0 for new contributions / MIT for existing code. **Compatible with scrml's posture.** (scrml's license is internally TBD per pa.md but compatible-with-mainstream-OSS is the trajectory.)
- Bun compatibility: explicit per SDK README ("It runs on Node.js, Bun, and Deno"). **CLEAR.**
- Dependency footprint: SDK depends on `zod` (for input schema validation). zod is widely used; no surprises.
- One UNVERIFIED concern: the SDK's `StdioServerTransport` lifecycle behavior under Bun's process model. Mitigation: 1-hour smoke test in Sub-unit C (boot + accept a tool call + shut down cleanly on SIGINT). If it surfaces a real problem, the workaround is the HTTP/SSE transport (`StreamableHttpServerTransport`) which has fewer process-integration concerns at the cost of a port binding.

### Risk 3 — V0 design boxes in V1

**Concerns surveyed:**

- **Auth model lock-in.** V0 is read-only stdio with no auth boundary (it runs server-side and inspects server-side state; local-only). V1 adds dispatch which needs auth. V0 does NOT preclude either auth path (dedicated `MCPAgent` role OR session-attach) from deep-dive §5.2. **CLEAR.**
- **Channel-mode MCP lock-in.** V0 ships stdio only. V1+ may add channel-mode for multi-agent coordination. The stdio choice does NOT preclude future channel-mode — they're transports, the tool surface is transport-agnostic at the MCP protocol level. **CLEAR.**
- **Global-transition-hook lock-in.** V0 doesn't subscribe to transitions. V1 might add subscribe via Option A (SPEC) or Option B (runtime tap). V0's tool surface doesn't preclude either. **CLEAR.**
- **Stdlib pattern lock-in.** Q4 above — long-lived-server-wrap is a new precedent. The first instance sets the pattern. **Mitigation:** Sub-unit C verifies the pattern fits via the `stdlib/cron/` lifecycle comparison; if it diverges substantially, surface back for ratification before C lands.

**Architectural decisions V0 should defer (NOT lock now):**

- Auth model for v1 dispatch.
- Global transition hook (SPEC vs runtime tap).
- Channel-mode MCP transport.
- `test-bind` convergence (deep-dive §8.5).

**Architectural decisions V0 should LOCK now:**

- Attribute name (`mcp`) — frozen by registry add in Sub-unit D.
- Attribute value enum (`dev-only`, `always`) — frozen by Q3.4 ratification.
- Sidecar artifact names (`engines.json` etc.) — internal but consumed by `scrml:mcp` stdlib; renaming later is a coordinated change. Sub-unit A locks these.
- Tool names (per §1 above) — public API to LLM agents; renaming later is a breaking change for adopters' agent configs.

### Risk 4 — STDIO logging discipline

Per WebSearch confirmation: "For STDIO-based servers, never write to stdout, as writing to stdout will corrupt the JSON-RPC messages and break your server."

**Implication for scrml:** The compiler's existing log() calls (which write to stdout in `--verbose`) MUST NOT bleed into the MCP server's stdio. The boot path Sub-unit D wires up needs to ensure: (a) the MCP server process is distinct from the compiler process, OR (b) log() is redirected to stderr in the MCP server context.

**Mitigation:** Sub-unit C's boot path explicitly redirects any logging to stderr. Document this in the adopter doc. Sub-unit E's E2E test asserts stdout is clean JSON-RPC only.

### Risk 5 — Sidecar staleness across rebuilds

If the adopter compiles, then runs the MCP server, then re-compiles (e.g. dev rebuild on file change) — the MCP server may be reading stale sidecars. Mitigation in v0: the MCP server can `fs.watch` the sidecar files (cheap, ~10 lines of code in Sub-unit C). Or document the limitation: restart the MCP server on rebuild. **Recommend the `fs.watch` approach** — small impl cost, adopter-invisible.

### Risk 6 — Initial-build `chunks.json` missing (no entry-point)

If the adopter's app has zero `<page>` and zero `<channel>`, `chunks.json` is structurally degenerate (one entry per the SPA-program shape). The MCP server should still return a valid `get_app_topology` response — verify the route-splitter's behavior on the SPA-only case via fixture in Sub-unit E.

---

## 6. Honest cost re-estimate

| Sub-unit | Deep-dive implied | This SCOPING re-estimate | Notes |
|---|---|---|---|
| A — Descriptor emission | ~12-18h (implied by "minor codegen extension") | **12-16h** | Convergent. 4 sidecars, well-bounded extractors. |
| B — Runtime helpers | ~4-8h ("thin wrappers") | **6-10h** | Slightly higher than deep-dive implied — wrapping is thin but the encoded-key plumbing adds ~2h. |
| C — `scrml:mcp` stdlib | ~16-24h (the bulk) | **14-22h** | Convergent. 11 tools × ~1h boilerplate + SDK integration. |
| D — `<program mcp>` wiring | ~4-8h | **8-12h** | Slightly higher — auto-flip of `--emit-per-route` + boot-injection adds complexity not surfaced in deep-dive. |
| E — Tests + docs | ~4-12h | **10-12h** | Convergent. E2E spawn + 11 tool round-trips + adopter doc. |
| **TOTAL** | **40-70h** (deep-dive band 40-80h) | **52-78h** | Within deep-dive band. No collapse; no major hidden complexity. |

**Re-estimate confidence:** MEDIUM-HIGH. The empirical anchors (file paths, existing helpers, attribute-registry shape, MCP SDK API) are all verified. The main residual uncertainty is the boot-injection mechanism in Sub-unit D — until the impl agent surveys `api.js`'s existing emission paths in detail, the +2-4h on D could be +0 (if there's a clean injection seam already) or +4 (if not).

**Discount surfaced?** None at this depth — no collapsibility found. The work IS modular and IS dispatchable. The empirical basis CONFIRMS the deep-dive's sizing rather than refining it down.

**Complexity surfaced?** One small upward adjustment on D (~+4h). Total still inside the deep-dive's 40-80h band.

---

## 7. Stop-condition status

The brief listed 3 stop conditions. Survey results:

1. **SPEC amendment required for `<program mcp>`?** NO. The attribute registry is in `compiler/src/attribute-registry.js` (not in SPEC §4.12.2 — that section is a documentation snapshot; the validator is the registry). Sub-unit D adds the entry. NO SPEC amendment is structurally required to ship V0. PA may CHOOSE to add it to SPEC §4.12.2's attribute table as a documentation update (1-hour change), but it's not a dispatch blocker. **CONTINUE.**

2. **`scrml:mcp` non-trivial stdlib pattern divergence?** Two divergences surfaced (long-lived server wrap; attribute-driven activation), both addressable within sub-unit C. The closest precedent (`stdlib/cron/`) likely covers the lifecycle pattern. The verification is a single file-survey at sub-unit C startup. **NOT >1 file of new conventions.** **CONTINUE.**

3. **V0 M6 dependency surfaces?** NO. Empirically verified in §4. The only file-conflict surface is `api.js` (both M6 and V0 D touch it) and that's an ordinary merge concern, not a slot change. **CONTINUE.**

**All three stop conditions cleared. V0 is dispatchable.**

---

## 8. Recommended dispatch order

Given the dependency graph in §3 and per S124 parallel-with-M6 direction:

```
TIME →
  Day 1-2:  [Sub-unit A — sidecars]     [Sub-unit B — runtime helpers]
            (parallel — 2 agents)
  Day 3-4:  [Sub-unit C — scrml:mcp stdlib]
            (depends on A + B)
  Day 5:    [Sub-unit D — <program mcp> wiring]
            (depends on C)
  Day 6:    [Sub-unit E — tests + adopter docs]
            (depends on D)
```

Critical path: ~6 calendar days at one agent per sub-unit, 8h/day. Total agent-hours: 52-78h per re-estimate.

**Pre-dispatch checklist for PA:**

1. Ratify the 11-tool surface (Q2 recommendation).
2. Ratify `<program mcp="dev-only"|"always">` shape (Q3.4 recommendation).
3. Ratify the `scrml:mcp` compiler-internal posture (Q4 recommendation).
4. Confirm v0.4 slot + parallel dispatch (Q1 recommendation).

Once those 4 are ratified, Sub-units A and B dispatch in parallel.

---

## 9. Open questions surfaced during survey (NOT in the 4 PA Qs)

- **OQ-MCP-V0-1.** Should the sidecar artifact format be JSON (recommended for adopter inspectability) or msgpack/CBOR (smaller, faster)? Recommend JSON for V0 — debuggability dominates at this scale.
- **OQ-MCP-V0-2.** The MCP server discovery — does the adopter's LLM-agent's MCP client need a path to the spawn point? Likely yes; document the canonical CLI invocation in the adopter doc.
- **OQ-MCP-V0-3.** Single MCP server per scrml app, or one per nested `<program>` (workers, sidecars per §4.12)? Recommend single-per-app for V0 — nested `<program>` introspection is V1+ scope.

These are sub-unit-level questions to surface at sub-unit dispatch, not PA-level Q&A.

---

## Tags
#scoping #mcp #v0 #devtools #llm-agents #parallel-with-m6 #s124 #v0.4-slot-recommendation

## Links
- Parent deep-dive — `scrml-support/docs/deep-dives/scrml-mcp-llm-agent-surface-2026-05-23.md` (S122)
- SPEC §40.8 — v0.3 program shape (one-program-per-application) — `compiler/SPEC.md` line 18375
- SPEC §40.9 — Closure Analysis (Minimal Playable Surface) — `compiler/SPEC.md` line 18487
- SPEC §41 — Import System (`scrml:` protocol prefix + stdlib resolution) — `compiler/SPEC.md` line 18770
- SPEC §41.17 — `scrml:compiler` KNOWN-DEFERRED stdlib precedent — `compiler/SPEC.md` line 19580
- SPEC §51.0 — Engines (state machine subsystem) — `compiler/SPEC.md`
- SPEC §55.5-§55.10 — Auto-synthesized validity surface, `ValidationError` enum
- Attribute registry — `compiler/src/attribute-registry.js` lines 81-143 (verified `mcp=` non-collision)
- Chunks manifest shape — `compiler/src/codegen/route-splitter.ts:208`
- Reachability types — `compiler/src/types/reachability.ts:145` (ChunkContents)
- Runtime helpers — `compiler/src/runtime-template.js:406` (`_scrml_reactive_get`), line 849 (`_scrml_derived_get`)
- Engine direct-set — `compiler/src/runtime-template.js:3235` (`_scrml_engine_direct_set`)
- Existing stdlib pattern reference — `compiler/runtime/stdlib/host.js` + `stdlib/host/index.scrml`
- chunks.json emission point — `compiler/src/api.js:1967`
- `--emit-per-route` CLI flag — `compiler/src/commands/compile.js:154`
- MCP TypeScript SDK — [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) (Apache 2.0 / MIT, Bun-compatible)
- MCP protocol spec — [modelcontextprotocol.io/specification/2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
