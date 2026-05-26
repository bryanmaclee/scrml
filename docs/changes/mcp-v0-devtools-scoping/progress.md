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
      `kind: "primary"|"derived"`.
      **[CORRECTED S126 by MCP-V0.A-tests dispatch]** The original A landing did
      NOT emit `cellKey`; it was added in the MCP-V0.A-tests contract fix so B's
      `getCurrentVariant` (mcp.js:249 `descriptor.cellKey || descriptor.name`)
      resolves production §47-encoded keys. Dev builds use identity encoding
      (cellKey === name), production-encoding pass-through is a documented follow-on.
    - forms: emit-validators + emit-synth-surface + emit-form-for triangulation;
      emits PRE-RESOLVED runtime keys.
      **[CORRECTED S126 by MCP-V0.A-tests dispatch]** The original A landing
      claimed "`compoundKeys` field included" — this was FALSE. A emitted the four
      compound rollup keys FLAT on the descriptor root (`errorsKey`/`isValidKey`/
      `touchedKey`/`submittedKey`), but B's `getFormStatus` reads them NESTED under
      `descriptor.compoundKeys` (mcp.js:311-323). The flat shape left B's
      `compoundKeys` undefined → per-field fallback → `submitted` (compound-only
      per §55.7) UNDECODEABLE. The MCP-V0.A-tests fix NESTS the four keys under a
      `compoundKeys: { isValidKey, errorsKey, touchedKey, submittedKey }` object,
      matching B's documented read shape (mcp.js:279). B was NOT changed (it is
      shipped + tested).
    - channels: emit-channel + §38.4 auto-synced walks; emits resolved cell keys.
      **[CORRECTED S126 by MCP-V0.A-tests dispatch]** The original
      `collectChannelAutoSyncedCells` walk only descended `node.children`, but
      V5-strict channel cells are authored inside a `${ ... }` logic block whose
      state-decls live in `logic.body` — so `autoSyncedCells` was ALWAYS `[]`. The
      fix descends `body`/`bodyChildren` (deduped by cell name) so channel cells
      surface for `getChannelState` decode.
    - serverfns: RI Stage 5 registry + TS Stage 6 signatures; `dispatchable: false`
      permanent v0 annotation.
- `compiler/src/api.js` (+37 LOC)
  - Imports buildMcpDescriptors; 4-sidecar write loop after chunks.json write
    site (line ~1976); same `--emit-per-route` flag gating; per-sidecar
    verbose log.
  - Degenerate-app case handled: empty `[]` emit unconditionally so every
    adopter app has predictable sidecar contracts.

## Tests — LANDED S126 (MCP-V0.A-tests dispatch)

All six deferred tests landed in the MCP-V0.A-tests follow-on dispatch (see
`docs/changes/mcp-v0-a-tests/progress.md`), alongside the A↔B contract fix:

- Per-sidecar unit tests (4) — `compiler/tests/unit/mcp-descriptors-{engines,
  forms,channels,serverfns}.test.js`. Each compiles a focused fixture via the
  real emit path + asserts the on-disk sidecar JSON shape.
- Cross-cutting integration test — `compiler/tests/integration/
  mcp-descriptors-runtime-integration.test.js`. 2-engine + 1-form + 2-channel +
  3-server-fn fixture; all 4 sidecars present + valid; loadSidecars +
  install(mock runtime keyed by resolved descriptor keys) decodes
  getCurrentVariant / getFormStatus (incl. `submitted`) / getChannelState.
- Degenerate SPA test — `compiler/tests/unit/mcp-descriptors-degenerate-spa.test.js`.
  Zero-engine/form/channel/server-fn <program> → all four sidecars empty []; B
  helpers degrade gracefully.
- Shared helper — `compiler/tests/helpers/mcp-sidecar-compile.js` (real emit path).

30 test cases, all passing. **Unblocks Sub-unit C.**

The A↔B contract fix (form `compoundKeys` nesting, engine `cellKey` emit, channel
auto-synced-cell collection) landed in the same dispatch — see the
[CORRECTED S126] notes in the Landed section above.

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


---

# Sub-unit E — Tests + adopter docs (separate dispatch — agent-a935f95138c2cb86a)

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a935f95138c2cb86a`
**Branch:** `worktree-agent-a935f95138c2cb86a`
**Base:** `5551bca0` (S130 close — wrap commit, master-list §0.6, CHANGELOG)
**Dispatch:** Sub-unit E — end-to-end integration tests against a multi-page fixture + adopter-facing setup doc.

## Timeline

- **T0** — Startup verification clean. `pwd` matches WORKTREE_ROOT; `git status --short` empty; tree clean; on branch `worktree-agent-a935f95138c2cb86a`.
- **T0+1m** — `bun install` clean (204 packages, 236ms incl. @modelcontextprotocol/sdk@1.29.0). `bun run pretest` compiled 13 test samples.
- **T0+2m** — First WIP commit echoing pwd per S99 discipline (`796de658`).
- **T0+8m** — Mandated reads complete: primary.map.md (full), PA-SCRML-PRIMER §1-§13 + §13.7, SPEC-INDEX (full), SCOPING.md §3 Sub-unit E (lines 277-300) + §1 11-tool catalog, ALL FOUR mcp progress.md files (parent + A-tests + C-stdlib + D), llm-kickstarter-v2 §1-§11, BRIEFING-ANTI-PATTERNS in full, mcp-server-tools.test.js (Sub-unit C's reference integration test, 374 LOC), mcp-sidecar-compile.js helper, mcp.js entry-points (install / loadSidecars / registerMcpTools / startMcpServer / shutdownMcpServer / 11 tool resolvers), mcp-descriptors.ts interfaces, mcp-program-attr.test.js (Sub-unit D's reference), attribute-registry.js mcp= attribute spec, build.js generateServerEntry MCP boot block exact shape.
- **T0+12m** — Fixture authored at `compiler/samples/mcp-v0-fixture/routes/` — 3-file multi-page app (mirrors the A-5 cornerstone shape): index.scrml (home + UserRole enum + auth-gated nav), loads.scrml (LoadPhase engine + loadRows server fn + dispatch channel), admin.scrml (Health engine + signup form + pingAdmin server fn + auth-gated admin subtree).
- **T0+18m** — Smoke compile via CLI surfaced unintended `${...}` wrappers (W-PROGRAM-REDUNDANT-LOGIC) and that the MCP serverfns extractor intentionally surfaces ONLY explicit `server function` declarations (per mcp-descriptors.ts:826), not auto-escalated ones. Restored explicit `server function` modifier (W-DEPRECATED-SERVER-MODIFIER is acceptable for the fixture purpose — descriptor coverage trumps migration-roadmap lint). Smoke baseline post-cleanup: 0 fatal / 8 warnings + 2 ghost-pattern lints — all informational; comparable to the cornerstone A-5 fixture's warning set.
- **T0+22m** — Fixture commit (`5b7511e1` — see below for SHA chain). All 4 sidecars + chunks.json populated correctly (2 engines / 1 form / 1 channel / 2 server fns).
- **T0+30m** — Authored `compiler/tests/integration/mcp-v0-e2e.test.js` (~440 LOC, 22 tests). Strategy mirrors mcp-server-tools.test.js (in-process Client over InMemoryTransport, MOCK runtime with descriptor-resolved keys), but binds against on-disk multi-page fixture instead of inline source string.
- **T0+32m** — First-run test: **22 pass / 0 fail / 136 expect() / 549ms.**
- **T0+34m** — E2E test commit landed; pre-commit gate clean.
- **T0+45m** — Authored `docs/adopter/mcp-setup.md` (~321 LOC). Quick-start + the two `mcp=` values + output artifact map + exact generated boot block (matches build.js generateServerEntry verbatim — promise-form + globalThis._scrml_mcp_handle stash + SCRML_MCP_WATCH=1 env) + LLM agent client config + per-tool reference + troubleshooting (top-level-only / globalThis-unset limitation / scrml-dev-vs-build / STDOUT discipline). Pa.md Rule 4 cross-check applied to EVERY claim against landed source.
- **T0+48m** — Adopter doc commit landed; pre-commit gate clean.

## Files Landed

- `compiler/samples/mcp-v0-fixture/routes/index.scrml` (NEW ~38 LOC) — home page
- `compiler/samples/mcp-v0-fixture/routes/loads.scrml` (NEW ~60 LOC) — engine + channel + server fn
- `compiler/samples/mcp-v0-fixture/routes/admin.scrml` (NEW ~57 LOC) — engine + form + server fn + auth gate
- `compiler/tests/integration/mcp-v0-e2e.test.js` (NEW ~440 LOC) — 22 tests, 11 tool round-trips + multi-page assertions
- `docs/adopter/mcp-setup.md` (NEW ~321 LOC) — adopter-facing setup + reference

## Test Coverage

22 tests across 4 describe blocks:
- §1 Fixture compile + sidecar emission (3 tests) — 0 fatal errors / 5 sidecars present / counts match
- §2 MCP server registers the 11 LOCKED tools (1 test)
- §3 Per-tool round-trip (15 tests covering all 11 tools + null-on-unknown variants)
- §4 Multi-page-specific (2 tests) — multiple entry points + per-role chunk variance observable

## SCOPING-vs-landed contradictions (Pa.md Rule 4)

1. **Server-fn extractor scope** — SCOPING §1 Tool 5 description does not flag that the MCP descriptor extractor intentionally surfaces only EXPLICIT `server function` declarations (auto-escalated ones excluded). This is documented in mcp-descriptors.ts:826 as deliberate v0 posture ("what an adopter authored as RPC-callable"). The fixture must use explicit `server function` modifier despite W-DEPRECATED-SERVER-MODIFIER lint to populate serverfns.json. NOT A BUG — landed behavior wins; surfaced as a doc gap that the adopter doc now addresses.

2. **Brief Q3.4 deferred** — the SCOPING risk register §3.D notes "no canonical dev-vs-production hook in compiler today" and the V0.D progress confirms the boot uses a runtime NODE_ENV gate in generated _server.js per pa.md Rule 3. This is the LANDED shape and the adopter doc documents it faithfully. The §58 Build Story implementation will revisit.

3. **Tool 7 shape gap** — the SHAPE GAP surfaced in C's progress (Tool 7 cannot faithfully filter per-route because chunks.json carries no serverFnNodeIds and serverfns.json carries no node-id). Tool 7 is degraded-honest in the runtime; the adopter doc documents this explicitly. Real fix is a documented A+D follow-on.

## V0.A-D cross-tool integration bugs surfaced

NONE. The fixture compiles cleanly through the V0.A-D pipeline; all 4 sidecars + chunks.json land correctly; all 11 tools round-trip against the descriptors with deterministic mock runtime; the per-role chunk-variance test confirms `<auth role="Admin">` (V0.A → V0.D chain) drives multi-role topology surfaces correctly through to the MCP client view.

The V0.D-documented limitation (per-module .server.js files don't yet stash _scrml_reactive_get on globalThis) is acknowledged in the test-file header AND in the adopter doc troubleshooting; it does NOT affect the E2E test (mock runtime injects deterministic values) and does NOT affect the topology tools (1, 2a, 3a, 4a, 4b, 5, 6a, 7 read from sidecars not the runtime).

## Pre-commit gate

Before: 14532 pass / 0 fail / 88 skip / 1 todo (from session-start baseline).
After:  14554 pass / 0 fail / 88 skip / 1 todo. **+22 net new = exactly the new E2E tests. Zero regressions.**

## File-disjoint coordination (with sibling Lifecycle Landing 2 + Iteration Landing 1)

CONFIRMED file-disjoint:
- This dispatch's writes: `compiler/samples/mcp-v0-fixture/**` (NEW directory), `compiler/tests/integration/mcp-v0-e2e.test.js` (NEW file), `docs/adopter/mcp-setup.md` (NEW file), `docs/changes/mcp-v0-devtools-scoping/progress.md` (APPEND ONLY).
- Sibling dispatches touch SPEC.md + compiler core — zero overlap.
- No coordination friction expected or observed.

## Final SHA

`d86962ef` (progress-doc append) → the SHA-fill commit immediately following is the dispatch close.

## Maps consulted + load-bearing finding

`primary.map.md` (full read). Load-bearing finding: the map's MCP routing table (lines 51-62 — "MCP descriptor-extractor work" and "MCP runtime / server work") was directly useful in identifying which source files to verify against. Map is from S127 (HEAD `3a909c1d`); current HEAD `5551bca0` is ~115 files newer (MCP V0.D landed at `2b51da82` per brief). Map content was used as a starting hypothesis verified via grep/Read against current source per brief mandate; the MCP descriptor + runtime / server module routings held up against current source.

## Status: COMPLETE

V0.A + V0.B + V0.C + V0.D + V0.E all SHIPPED. MCP V0 is feature-complete; remaining work is documented follow-ons:
1. SHAPE GAP for Tool 7 (node-id join — A+D follow-on)
2. globalThis._scrml_{reactive,derived}_get stash from per-module .server.js (follow-on wave)
3. scrml dev in-process MCP boot (follow-on)
4. Production §47 encoding pass-through for cellKey/compoundKeys
