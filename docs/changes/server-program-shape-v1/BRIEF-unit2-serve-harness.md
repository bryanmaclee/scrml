TASK — server-program-shape V1, Unit 2: the `kind="tool" serve=` LISTENER-OWNING HARNESS (Fork 1A).

You are the canonical scrml compiler dev-agent. Unit 2 of the Track-A server-program-shape arc. It builds
ON Unit 1 (LANDED on main `46cabd23`): `generateHeadlessServerJs` (emit-server.ts) already emits the
program-shape-agnostic route-handlers + fetch handler with NO web-app scaffold. Unit 2 makes a
`kind="tool" serve=` program HOST them via a compiler-emitted `Bun.serve`.

═══════════════════════════════════════════════════════════════════════════
MAPS — REQUIRED FIRST READ
═══════════════════════════════════════════════════════════════════════════
Read `.claude/maps/primary.map.md` first, then its Task-Shape Routing to the codegen/domain maps.
⚠️ MAPS ARE STALE — stamped `fbb4d9fd` (2026-07-09), ~130 commits behind HEAD `46cabd23`. Treat all map
line-numbers as a VERIFY-AGAINST-SOURCE hypothesis; navigate with `bun scripts/dock.ts --units <file>` +
grep on live source. Report whether the maps were load-bearing.

═══════════════════════════════════════════════════════════════════════════
CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — FIRST, before any edit
═══════════════════════════════════════════════════════════════════════════
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not, STOP + report.
2. `git rev-parse --show-toplevel` == that worktree root. `git status` clean.
3. `bun install` (worktrees don't inherit node_modules). Then `bun run pretest` (gitignored dist fixtures).
4. Use `bun run test` (chains pretest) for baselines — NOT `bun test` directly.
5. PATH DISCIPLINE: every edit WORKTREE-ABSOLUTE. NEVER `cd` into the main checkout; use worktree-absolute
   paths + `git -C "$WORKTREE_ROOT"`. Echo `pwd` in your first commit (`WIP(unit2-serve): start at $(pwd)`).
   Commit after EACH change (WIP commits expected — the branch is your crash anchor); append `progress.md`.

═══════════════════════════════════════════════════════════════════════════
ANTI-PATTERN BRIEFING — read BOTH before any code, re-read before each sub-step
═══════════════════════════════════════════════════════════════════════════
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` (Ghost-Pattern).
- `docs/articles/llm-kickstarter-v2-2026-05-04.md` (canonical scrml shape + stdlib catalog).

═══════════════════════════════════════════════════════════════════════════
DESIGN AUTHORITY
═══════════════════════════════════════════════════════════════════════════
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/server-program-shape-2026-07-12.md` —
  Fork 1 (RULED 1A: extend kind="tool" with serve= hosting native transports) + "Piece 1".
- SPEC §64 (Standalone Tool Target, ~L34974): §64.1 emit shape, §64.2 `function main` entry (E-TOOL-001),
  §64.3 the main() harness + liveness (READ IN FULL — the main-optional ruling grounds here), §64.6 codes,
  §64.7 worked example (the `_{}` Bun.serve gap you replace). READ §64 IN FULL before the SPEC edits.

═══════════════════════════════════════════════════════════════════════════
THE TASK — build the serve-harness (5 parts)
═══════════════════════════════════════════════════════════════════════════
GOAL: a `<program kind="tool" serve=PORT [cors=]>` containing `<endpoint>` / `server function* route=` SSE
children emits a compiler-owned `Bun.serve({ port, fetch, websocket })` mounting those routes — replacing
the hand-rolled `_{}` Bun.serve (§64.7's literal gap). The route/fetch emit already exists
(`generateHeadlessServerJs`, Unit 1); Unit 2 adds the listener + the surface.

PART 1 — Attribute surface. Recognize `serve=PORT` (integer literal or `${expr}`) + optional `cors=` on a
TOP-LEVEL `<program kind="tool">`. Wire `attribute-registry.js` + `ast-builder.js` + `tool-program.ts`
(the recognition helpers). `serve=`/`cors=` on a non-tool or nested `<program>` → an honest error.

PART 2 — Serve-harness emit (the core). In `emit-tool.ts`, when a kind="tool" program carries `serve=`:
invoke `generateHeadlessServerJs` (import from emit-server.ts) to get the headless route-handlers + fetch
handler, and emit `Bun.serve({ port: <PORT>, fetch: <headless fetch>, websocket: <the channel ws handler,
only if the program has §38 channels> })` as the module's serve-harness. NO html, NO client bundle, NO
CSRF (Unit 1's headless shape already omits them). The emitted module is a runnable headless server
(`bun <emitted>.js`). Study emit-tool.ts's existing main-harness (§64.3, ~L356) + how it already imports
from emit-server.ts (`collectDbScopes`).

PART 3 — main-optional (RULED S255, bryan-endorsed; grounded in §64.3). A `serve=` tool's compiler-emitted
serve-harness IS the §64.3 active handle (the Bun.serve keeps the process alive — §64.3's own "a
long-running server is a no-return main whose Bun.serve keeps it alive; no kind=service, no park
boilerplate"). So RELAX `E-TOOL-001` when `serve=` is present: NO `function main` required. If a `main` IS
also written, it COMPOSES — `await main(...)` runs as setup, THEN the serve-harness holds the process
(main-with-numeric-return + serve is the one incoherent combo — error or document it). E-TOOL-001 STILL
fires for a non-serve tool with no main.

PART 4 — the auth guardrail (from Unit 1's finding — prevents a silent-unguarded footgun). Unit 1 gates
cookie-session auth/CSRF OFF in headless (it's web-app-shaped; headless auth is BEARER, Fork 6, a LATER
unit). So a `kind="tool" serve=` program carrying cookie-session `auth=` middleware would emit routes with
NO auth guard, silently. FIRE A NEW HARD ERROR on that combination (a `serve=` tool + cookie-session
`auth=`) — name it e.g. `E-TOOL-SERVE-AUTH-UNSUPPORTED`, message: cookie-session auth is web-app-shaped;
a headless serve= program has no cookie-session; bearer auth is a later unit. (This is the honest
fail-closed until Fork 6 bearer lands.)

PART 5 — SPEC + §34. Amend §64.1: strike "NO HTTP-web server-route emission" → a `serve=` tool DOES emit
its `<endpoint>`/SSE routes + a Bun.serve harness (a non-serve tool still emits none). Amend §64.2: main is
OPTIONAL when `serve=` is present (the serve-harness is the entry). Add the `serve=`/`cors=` attribute rows
(§64 attribute surface). §34: the new `E-TOOL-SERVE-*` code rows (serve-auth-unsupported + any serve=
validation code, e.g. E-TOOL-SERVE-PORT-INVALID) land WITH this impl (Rule 4 named-codes-land-with-impl).

NAMING GUARD: "listener-owning `kind="tool" serve=` program" / "headless serve-target" — NEVER "server
shell"/"persistent shell" (aliases navigate's §20.8 SPA client shell).

═══════════════════════════════════════════════════════════════════════════
DoD — do not mark DONE without ALL:
═══════════════════════════════════════════════════════════════════════════
- [ ] A `kind="tool" serve=7878` program with an `<endpoint>` (+ an SSE `server function* route=`) compiles
      → emits `Bun.serve({port, fetch, websocket?})` mounting the routes; the module is a runnable headless
      server (no html/client/CSRF). Prove by inspecting the emitted `.js` (the Bun.serve harness + the mounted routes).
- [ ] main-optional: the serve= tool compiles with NO `function main` (E-TOOL-001 does NOT fire); a non-serve
      tool with no main STILL fires E-TOOL-001 (regression-guard both directions).
- [ ] auth guardrail: a serve= tool with cookie-session `auth=` fires the new E-TOOL-SERVE-AUTH-UNSUPPORTED.
- [ ] Existing `kind="tool"` (NON-serve) emit is UNCHANGED (byte-identical — capture a pre-image of a
      non-serve tool fixture, confirm pre==post). No regression to the CLI/library tool paths.
- [ ] SPEC §64.1/§64.2 amended + §34 E-TOOL-SERVE-* rows; SPEC-INDEX regenerated (`bun run scripts/regen-spec-index.ts`).
- [ ] Unit + integration tests for all the above. R26: compile a realistic fsp-wire-shaped serve= program
      (an <endpoint> POST + an SSE route) and confirm the emitted module is a valid Bun.serve server (node --check + inspect).
- [ ] Full unit+integration+conformance gate = 0 fail. `progress.md` current; clean status; report FINAL_SHA
      + files-touched + the emitted serve-harness shape + maps-load-bearing.
NOTE: the PA runs an independent adversarial `/code-review` on your diff before landing (you can't run it
in-agent). Blast-radius to hunt: does the serve-harness correctly mount ALL route kinds (endpoint + SSE +
channel WS)? Does main-optional break the existing exit/invoke harness discrimination? Does the auth-error
over-fire (a serve= tool with NO auth should be fine) or under-fire (miss a cookie-auth shape)?
