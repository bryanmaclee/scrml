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
