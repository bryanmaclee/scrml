# MCP-V0 DevTools — SCOPING progress

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a47475be071147108`
**Branch:** `worktree-agent-a47475be071147108`
**Base after merge main:** `f0368d9c` (M6.5.b.0 within-node parity canary extension)
**Dispatch:** V0 MCP-DevTools SCOPING — survey-only, produces SCOPING.md

---

## Timeline

- **T0** — Startup verification passed. pwd + worktree root match. Status clean. Branch correct.
- **T0+1m** — `git merge main` clean fast-forward absorbed M6.5/M6.6/M6.7 work; new base `f0368d9c`.
- **T0+2m** — `bun install` clean (117 pkgs in 210ms).
- **T0+3m** — SCOPING dir created; this progress file initialized.
- **T0+5m** — Phase A: Read parent deep-dive in full (651 lines). Substrate locked.
- **T0+10m** — Phase B: Required reading on SPEC § references.
  - SPEC §4.12.2 (nested `<program>` attrs) — read in full. Used as reference only; not load-bearing for V0 top-level `<program>`.
  - SPEC §40.8 (v0.3 program shape) — read in full. Anchor for `<program>` attribute additions.
  - SPEC §40.9 + §40.9.1 (closure analysis + playable_surface formalization) — read. Confirms chunks.json contract.
  - SPEC §41 (Import System) — read §41.1-§41.11 + §41.17. CONFIRMED §41 (not §47.11) is the stdlib shim convention home — flagged this brief error in SCOPING §5/Q4.
  - SPEC §47 — verified §47 is "Output Name Encoding" (not the stdlib convention). Brief's §47.11 reference is incorrect.
- **T0+15m** — Phase C: Compiler-source survey.
  - `compiler/src/attribute-registry.js` lines 81-143 — verified ALL `<program>` attrs; CONFIRMED `mcp=` collision-free.
  - `compiler/src/codegen/route-splitter.ts` lines 1-270 — read `ChunkOutput`, `ChunksManifest`, `ChunksManifestEntry`, `ChunkContents`.
  - `compiler/src/types/reachability.ts` lines 1-220 — confirmed `ChunkContents` shape (componentNodeIds, reactiveCellNodeIds, serverFnNodeIds, vendorUnitNames).
  - `compiler/src/runtime-template.js` — confirmed top-level runtime helpers (`_scrml_reactive_get` line 406, `_scrml_derived_get` line 849, `_scrml_engine_direct_set` line 3235).
  - `compiler/runtime/stdlib/host.js` + `stdlib/host/index.scrml` — confirmed canonical stdlib shim shape (source.scrml stub bodies + hand-authored .js shim).
  - `compiler/src/api.js` line 1967 — confirmed chunks.json write site.
  - `compiler/src/commands/compile.js` line 154 — confirmed `--emit-per-route` flag gates chunks.json emission.
- **T0+20m** — Phase D: External research.
  - WebFetch on `modelcontextprotocol.io/specification/2025-11-25` — read protocol overview (tools as JSON-RPC, stdio/SSE transports).
  - WebSearch on `@modelcontextprotocol/sdk` — confirmed package exists, multiple working examples.
  - WebFetch on `github.com/modelcontextprotocol/typescript-sdk` README — confirmed (1) package `@modelcontextprotocol/server`, (2) Apache 2.0 / MIT license, (3) Bun-compatible, (4) minimal stdio server API (`McpServer` + `StdioServerTransport` + `server.registerTool`).
- **T0+30m** — Phase E: SCOPING.md authored.
  - §0 Headline — V0 dispatchable, no M6 dep, 52-78h re-estimate (within deep-dive 40-80h band).
  - §1 — 11-tool surface (10 from deep-dive §7.1 + recommended `get_reachable_server_fns`) per-tool source-of-truth.
  - §2 — 4 PA questions sharpened with recommended answers.
  - §3 — 5 sub-unit decomposition (A sidecars, B helpers, C stdlib, D attribute, E tests).
  - §4 — Dependencies: empirical M6 conflict surface (only `api.js`).
  - §5 — Risk register: 6 risks, all mitigated.
  - §6 — Honest cost re-estimate: 52-78h, MEDIUM-HIGH confidence.
  - §7 — All 3 stop-conditions cleared. CONTINUE.
  - §8 — Recommended dispatch order (parallel A+B → C → D → E, ~6 calendar days critical path).
  - §9 — 3 sub-unit-level OQs surfaced (sidecar format, MCP server discovery, nested-`<program>` posture).
- **T0+35m** — Commit prep — pwd verified inside worktree, status clean save for new SCOPING + progress files.

## Status: COMPLETE

---

# Sub-unit B — Runtime helpers (separate dispatch — agent-a94b4df180fb008b4)

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a94b4df180fb008b4`
**Base after merge main:** `5b1afb9d` (S125 OPEN maps refresh)
**Dispatch:** Sub-unit B — three thin runtime helpers in `compiler/runtime/stdlib/mcp.js`

## Timeline

- **T0** — Startup verification. pwd inside worktree confirmed; `git rev-parse --show-toplevel` matches. Initial HEAD was `329101db` (S123 close — older than main's S124).
- **T0+1m** — `git merge main --no-edit` clean fast-forward to `5b1afb9d`.
- **T0+2m** — `bun install` clean (117 pkgs / 204ms). `bun run pretest` compiled fixtures.
- **T0+5m** — Baseline `bun run test`: 21044 pass / 1-2 fail (browser/e2e ECONNREFUSED flake, out-of-gate).
- **T0+8m** — Mandated reads: SCOPING.md §3 Sub-unit B + §1 Tools 2/3/6, `compiler/runtime/stdlib/host.js` IN FULL (canonical template), `compiler/src/runtime-template.js:406` + `:849` (the two runtime read primitives), `compiler/src/api.js:272-380` (`bundleStdlibForRun` — confirmed shim is copied to `<outputDir>/_scrml/<name>.js`).
- **T0+10m** — Architectural discovery: shims are independent ES modules; runtime helpers (`_scrml_reactive_get` / `_scrml_derived_get`) live in generated-code scope and are NOT exported. Bridge approach chosen: `install({ reactive_get, derived_get })` injector pattern. Sub-unit C / D boot code will call install once at MCP server start. This matches the "long-lived server wrap" precedent the SCOPING §1 Q4 names.
- **T0+15m** — Authored `compiler/runtime/stdlib/mcp.js` (~330 LOC). Surface: `install`, `uninstall`, `loadSidecars(outputDir, { watch })`, `stopWatchers`, `getCurrentVariant`, `getFormStatus`, `getChannelState`, plus `_stateForTests` / `_resetForTests` introspection. Sidecar loader resolves outputDir from explicit param or falls back to `import.meta.url`-relative (`<outputDir>/_scrml/mcp.js` → up one dir). Missing / malformed sidecars degrade to `[]` (no throw).
- **T0+18m** — fs.watch reload (SCOPING §5 Risk 5) IMPLEMENTED, opt-in via `loadSidecars(..., { watch: true })`. Default OFF so tests are deterministic and Sub-unit C / D can opt in explicitly. ~15 lines of code; well within the SCOPING budget for this risk. Not deferred.
- **T0+22m** — Commit 1: `cd6ed588` — shim file (no consumers yet, additive, cannot break gate).
- **T0+25m** — Authored `compiler/tests/unit/mcp-runtime-helpers.test.js` (~280 LOC). 25 tests across install/uninstall lifecycle, loadSidecars edge cases, the three helpers (happy path, normalization, unknown name, update propagation), and fs.watch opt-in reload. Mock runtime is a plain JS object — no SCRML runtime evaluation needed since helpers are pure consumers of injected refs.
- **T0+27m** — `bun test compiler/tests/unit/mcp-runtime-helpers.test.js`: **25 pass / 0 fail / 54 expect() calls / 281ms.**
- **T0+28m** — Commit 2: `9ae5603b` — tests.
- **T0+30m** — Pre-commit gate: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` → **14071 pass / 0 fail / 88 skip / 1 todo / 46965 expect()** / 65.3s. Zero regressions.

## Files Touched

- `compiler/runtime/stdlib/mcp.js` (NEW, ~330 LOC)
- `compiler/tests/unit/mcp-runtime-helpers.test.js` (NEW, ~280 LOC)

## Helpers Landed

- `getCurrentVariant(engineName)` — wraps `reactive_get`; normalizes `{variant,data}` records to tag string; honors `cellKey` override
- `getFormStatus(formName)` — composes `{isValid, errors, touched, submitted, perField}` per §55.5-§55.7; uses pre-resolved keys from sidecar (no re-encoding); rolls up from per-field cells when no compound surface present
- `getChannelState(channelName)` — composes `{name, topic, cellState}` from §38.4 auto-synced cells over `channels.json`

## Sidecar Loader Approach

`loadSidecars(outputDir, opts)`. Explicit outputDir parameter is preferred. When omitted, derives from `import.meta.url` (the shim's own location — `<outputDir>/_scrml/mcp.js` → `<outputDir>`). No new env var added; no api.js changes needed. Test harness passes an explicit tmp dir.

## fs.watch Status

IMPLEMENTED + opt-in. `loadSidecars(outputDir, { watch: true })` registers 3 fs.watch handles, one per sidecar; `change`/`rename` events trigger re-read + re-cache. Errors in mid-rewrite reads are swallowed (next read or next watch fires recovers). `stopWatchers()` exposes a shutdown hook for Sub-unit C's MCP-server-stop path. Verified with a real-FS test (200ms wait after rewrite).

## Coordination Signal with Sub-unit A

The helpers consume the sidecar shapes documented at SCOPING §3 Sub-unit A literally — pre-resolved keys, no re-encoding. The `forms.json` entry shape adds an optional `compoundKeys` object (with `isValidKey` / `errorsKey` / `touchedKey` / `submittedKey`) that the SCOPING line "[{ formName, fields: [...] }]" does not explicitly mention; I added it to the consumer because §55 forms have BOTH per-field AND compound auto-synthesized cells, and the compound shape is what Tool 3 `get_form_status` SCOPING §1 calls for. If Sub-unit A's final emitter omits `compoundKeys`, the helper rolls up from per-field; if A includes it, the helper uses it directly. Either shape works.

The `engines.json` entry's optional `cellKey` field (for cases where the runtime state map's key differs from the engine's user-facing name) is similarly speculative — if A emits only `{name}`, the helper falls back to using name AS the key.

## Stop Conditions — none triggered

1. Sidecar loader path resolution — handled via `import.meta.url` fallback + explicit param. No api.js changes; no env var. **CLEAR.**
2. `_scrml_reactive_get` / `_scrml_derived_get` shape — the existing helpers return what we need (raw stored value). No gap. **CLEAR.**
3. Sub-unit A sidecar shape divergence — built against SCOPING §3 documented shapes; defensive fallback if A's final shape is leaner (described above under "Coordination Signal"). **CLEAR.**
4. fs.watch complexity — ~15 lines, well under 2h work. Implemented, not deferred. **CLEAR.**
5. Cross-file coordination need — install() bridge handles runtime ref injection. No changes to `compiler/src/api.js` or stdlib bundling logic — the existing `bundleStdlibForRun` copies the new file with zero change because `_scrml` family detection is by-file-presence in `compiler/runtime/stdlib/`. **CLEAR.**

## Final SHA

`9ae5603b`

---

# Sub-unit A — Descriptor sidecars (separate dispatch — agent-a03ab192db85596bb)

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a03ab192db85596bb`
**Base after merge main:** `5b1afb9d` (S125 OPEN maps refresh)
**Dispatch:** Sub-unit A — 4 compile-time descriptor sidecars + api.js write sites

## Landed (PARTIAL — tests deferred to follow-on dispatch)

- `compiler/src/codegen/mcp-descriptors.ts` (NEW ~868 LOC)
  - `buildMcpDescriptors(tabResults)` extractor with 4 per-sidecar sub-extractors
    (engines / forms / channels / serverFns). Source-of-truth wiring per
    SCOPING §3 Sub-unit A:
    - engines: AST walks `kind: "engine-decl"` + §51.0 variants/rules; emits
      `cellKey` and `kind: "primary"|"derived"`.
    - forms: emit-validators + emit-synth-surface + emit-form-for triangulation;
      emits PRE-RESOLVED runtime keys per Sub-unit B coordination signal —
      `compoundKeys` field included (the B-speculated optional field is now
      load-bearing).
    - channels: emit-channel + §38.4 auto-synced walks; emits resolved cell keys.
    - serverfns: RI Stage 5 registry + TS Stage 6 signatures; `dispatchable: false`
      permanent v0 annotation.
- `compiler/src/api.js` (+37 LOC)
  - Imports buildMcpDescriptors; 4-sidecar write loop after chunks.json write
    site (line ~1976); same `--emit-per-route` flag gating; per-sidecar
    verbose log.
  - Degenerate-app case handled: empty `[]` emit unconditionally so every
    adopter app has predictable sidecar contracts.

## NOT Landed (tests follow-on — M6.5-style sibling sub-unit)

- Per-sidecar unit tests (4 tests, one per sidecar — fixture compile +
  assert JSON shape).
- Cross-cutting integration test (multi-engine, multi-form, multi-channel,
  2+ server fns fixture; all 4 sidecars present + valid JSON + resolved
  keys decode at runtime via the B helpers).
- Degenerate SPA case test (zero-page-zero-channel fixture).

**Filed as MCP-V0.A-tests follow-on dispatch.** Per S125 user direction
("wrap when what's going now is landed"), tests NOT dispatched this
session. Blocks Sub-unit C until landed.

## Process

- Agent: a03ab192db85596bb
- Branch: worktree-agent-a03ab192db85596bb (2 commits: aa3d6075 / c07457b4)
- Echo-pwd discipline verified at aa3d6075.
- Agent stalled mid-dispatch (stream watchdog: 600s no progress) AFTER
  committing both substantive files BEFORE writing tests. PA-side
  recovery via S89 §13.2 — branch-tip work coherent + complete for the
  production-code half.
- Per pa.md Rule 3: landing the partial-but-coherent extractor + wiring
  is the right answer (preserves the agent's productive code work);
  re-dispatching tests as a separate agent is the natural follow-on.
- Zero S99 path-discipline incidents (counter remains 11).

## Final SHA

`c07457b4` (last agent commit before stall)

## PA landing SHA

(To be filled after PA-authored commit fires.)

