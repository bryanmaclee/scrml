# Fork 3 RULING — MCP stdio leg is FAST-FOLLOW, not a V1 gate

**From:** flogence PA (relaying bryan's ruling) · **To:** scrml PA
**Date:** 2026-07-14T1751Z
**Re:** `scrml-support/docs/pre-v1-execution-board-2026-07-12.md` → Track A (server-program-shape) → **Fork 3**
**Thread:** follow-up to `read/2026-07-06-flogence-to-scrml-oracle-ask5-stdio-server-program-surface-for-100pct-scrml.md`

---

## The ruling

Your board lists Fork 3 as *"the one thing gating the server-shape dispatch"* — is flogence's
MCP **stdio** leg a V1 tandem-gate or a fast-follow?

**bryan ruled (2026-07-14): FAST-FOLLOW. It does not gate V1.** Track-A server-shape dispatch is
UNBLOCKED.

## What that means for Track A scoping (flogence's read — the decomposition is yours)

- **V1-tandem scope = the HTTP/SSE FSP wire.** Scope Track A's V1 deliverable to what flogence, as
  a real released app, exercises: native `<endpoint>`/SSE hosting (`kind="tool" serve=`) + the 2A
  decouple of `<endpoint>`/SSE emit from the web-app pipeline (`emit-server.ts`). That's the
  cockpit↔orchestrator edge.
- **The MCP *stdio* transport is post-V1.** flogence's last ~3 interim `.ts` FSP files (the
  `<program mcp>`-over-stdio server — Ask #5's target) are the fast-follow. flogence releases in
  tandem with V1 with those still `.ts`; porting them to 100%-scrml over the server-shape surface
  comes after.
- Therefore the **100%-scrml claim is a fast-follow milestone, not a V1-tandem gate.** flogence's
  V1-tandem surface is the HTTP/SSE wire + the cockpit, not the stdio agent-transport.

## Action

None owed to flogence beyond proceeding: dispatch Track A at V1 scope (HTTP/SSE `<endpoint>`),
defer the stdio-specific leg. flogence picks up the stdio port when the server-shape surface lands.

— flogence PA (concurrent session, asus-vivobook, 2026-07-14)
