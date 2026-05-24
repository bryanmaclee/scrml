# Progress: mcp-v0-c-stdlib (MCP-V0.C — scrml:mcp stdlib module, 11 read-only tools over stdio)

Worktree: `/home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a2939a2fe12eef455`
Baseline: 21155 pass / 0 fail (clean re-run; flaky timing pair flickered once on first run)

- [07:xx] Startup verified — pwd=worktree, merge main fast-forward clean, bun install, pretest, baseline test.
- [07:xx] First WIP commit (empty) marking start.
- [07:xx] Required reading complete: SCOPING §1/§3/§5, mcp.js (B helpers), mcp-descriptors.ts shapes, mcp-runtime-helpers.test.js, host/cron stdlib templates, route-splitter ChunksManifest, reachability ChunkContents.
- [07:xx] PATH-DISCIPLINE INCIDENT (caught + remediated): `cd /home/bryan/scrmlMaster/scrmlTS &&` in Bash commands resolved to PRIMARY MAIN, not the worktree. `bun add @modelcontextprotocol/sdk` leaked into PRIMARY MAIN's package.json + bun.lock. Reverted via `git -C <primary> checkout -- package.json bun.lock` + `bun install --cwd <primary>` to prune. Re-applied correctly with `bun add --cwd <worktree>`. PRIMARY MAIN confirmed clean. Going forward: `--cwd "$WT"` / `git -C "$WT"` only, never `cd`.
- [07:xx] SDK pinned: @modelcontextprotocol/sdk@1.29.0 (MIT, requires zod ^3.25 — have 3.25.76). Smoke test PASS under Bun: McpServer + registerTool + StdioServerTransport construct; InMemoryTransport in-process Client round-trip works. Import specifiers confirmed: server/mcp.js (McpServer), server/stdio.js (StdioServerTransport), client/index.js (Client), inMemory.js (InMemoryTransport). inputSchema is ZodRawShape (plain object of zod types).

## Key Decisions
- SDK boot entry name: `startMcpServer({ reactiveGet, derivedGet, outputDir })` per brief Q4 — D will call it.
- Tools 1/4/7 read chunks.json — mcp.js (B) does not yet load chunks.json; C adds a chunks loader to the boot path (NOT touching B's 3 sidecar helpers).
- serverfns.json: emitted by A; B never read it. C adds a serverfns loader.
- Logging: all server-side logging routed to stderr (SCOPING Risk 4) — stdout reserved for JSON-RPC framing.

## SHAPE GAP FINDING — Tool 7 `get_reachable_server_fns(EP, role, depth)`
Verified empirically by compiling a multi-surface fixture with `emitPerRoute: true`:
- On-disk `chunks.json` carries ONLY URL-style chunk filename strings per (EP, role) tier — NO `serverFnNodeIds`. (`serializeChunksManifest` route-splitter.ts:2056 transforms ChunkKey→filename, dropping ChunkContents.)
- `reachability.json` (separate `--emit-reachability` flag, NOT auto-emitted by `--emit-per-route`, NOT in C/D scope) DOES carry per-(EP,role) `serverFnNodeIds` — but as NODE IDs (`serializeChunkContents` reachability-solver.ts:596), and `serverfns.json` carries NO node-id field to JOIN on (only name/params/returnType/file).
- => Tool 7's promised projection (SCOPING §1 Tool 4 deferral / brief Q2) is NOT faithfully implementable from artifacts a `--emit-per-route` build produces. This is a shape gap analogous to the A↔B cellKey/compoundKeys gap.

DECISION (locked tool name preserved, no fabrication): register all 11 tools. Tool 7 ships in a DEGRADED-HONEST form — it validates (EP, role) exists in chunks.json, then returns the FULL serverfns.json list annotated `reachabilityFiltered: false` + a `note` stating per-route filtering is unavailable until a node-id↔name join lands. It does NOT fabricate reachability. The real fix (A-side: add `nodeId` to serverfns.json + D-side: auto-emit reachability) is a follow-on surfaced to PA — out of C's file scope.

## DONE
- [x] stdlib/mcp/index.scrml source surface (startMcpServer/shutdownMcpServer stubs) — compiles clean (0 fatal). Committed c53de771.
- [x] compiler/runtime/stdlib/mcp.js extended: chunks+serverfns loaders (chunks object reader), 11 pure tool resolvers, buildToolSpecs/TOOL_NAMES/registerMcpTools, startMcpServer + shutdownMcpServer. B-helpers untouched (25 pass). Committed c53de771.
- [x] Integration test compiler/tests/integration/mcp-server-tools.test.js — 20 pass / 0 fail, 108 expect() calls. All 11 tools driven via in-process Client over InMemoryTransport against REAL emitted sidecars; plus error-surface test + real startMcpServer stdio boot+shutdown lifecycle. stderr-only readiness line confirmed (stdout discipline holds).

## Per-tool verification (all 11 round-tripped via JSON-RPC):
1 get_app_topology ✓  2 list_engines ✓  2 get_engine ✓ (live currentVariant normalized)  3 list_forms ✓  3 get_form_status ✓ (compound+perField)  4 list_routes ✓  4 get_route_chunks ✓ (+null for unknown)  5 list_server_functions ✓ (dispatchable:false)  6 list_channels ✓  6 get_channel_state ✓ (+null)  7 get_reachable_server_fns ✓ (degraded-honest, reachabilityFiltered:false; found:false for unknown pair).

## DONE (cont.)
- [x] M6.5.b.0 within-node parity canary caught the new stdlib/mcp/index.scrml (residual 57, over-budget). Added allowlist baseline (regenerated exact counts via classifier). Committed c25631c4.
- [x] FINAL full-suite gate: 21179 pass / 174 skip / 0 fail (baseline 21155/0 — +24 net new, 0 regressions). exit 0.

## FINAL
- FINAL_SHA: c25631c4
- Worktree clean; PRIMARY MAIN untouched (SDK-leak incident remediated early).
- SDK pinned: @modelcontextprotocol/sdk@1.29.0 (MIT).
- Sub-unit C COMPLETE. All 11 tools verified. Tool 7 degraded-honest (gap surfaced for A+D follow-on).

## Follow-ons for PA
1. SHAPE GAP (Tool 7): add `nodeId` to serverfns.json (A-side, mcp-descriptors.ts) + auto-emit reachability (D-side) so get_reachable_server_fns can filter per-route. Currently degraded-honest (returns full list, reachabilityFiltered:false).
2. Sub-unit D wires `<program mcp>` → calls startMcpServer({reactiveGet, derivedGet, outputDir}); must add `mcp` to the stdlib bundling allowlist (the brief notes mcp.js is NOT yet in it) and inject the boot import.
3. Production §47 encoding: cellKey/compoundKeys are raw names in dev mode (documented A-side limitation, unchanged here).
