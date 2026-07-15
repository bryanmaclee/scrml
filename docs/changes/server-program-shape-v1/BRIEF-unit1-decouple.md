TASK — server-program-shape V1, Unit 1: DECOUPLE `<endpoint>`/SSE emit from the web-app pipeline (Fork 2A).

You are the canonical scrml compiler dev-agent. This is Unit 1 of the Track-A server-program-shape arc
(the #1 flogence tandem-release gate). It is a REFACTOR with NO new authored surface and NO SPEC change.

═══════════════════════════════════════════════════════════════════════════
MAPS — REQUIRED FIRST READ
═══════════════════════════════════════════════════════════════════════════
Read `.claude/maps/primary.map.md` first, then follow its Task-Shape Routing to the codegen/domain maps.
⚠️ THE MAPS ARE STALE — stamped commit `fbb4d9fd` (2026-07-09), ~125 commits behind HEAD `b3d5794a`.
Treat ALL map line-numbers/loci as a VERIFY-AGAINST-SOURCE hypothesis, not truth. Navigate with
`bun scripts/dock.ts --units <file>` + grep against the LIVE source. Report whether the maps were
load-bearing (including "not load-bearing").

═══════════════════════════════════════════════════════════════════════════
CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — do this FIRST, before any edit
═══════════════════════════════════════════════════════════════════════════
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not
   (e.g. it is the main checkout or a sibling repo), STOP and report — do not proceed.
2. `git rev-parse --show-toplevel` MUST equal that worktree root. `git status` MUST be clean.
3. `bun install` (worktrees do NOT inherit node_modules — the hook fails "cannot find package 'acorn'"
   otherwise). Then `bun run pretest` (populates gitignored `samples/compilation-tests/dist/` fixtures).
4. If browser tests need it, symlink `dist/` from main (gitignored; ENV-GAP not regression).
5. Use `bun run test` (chains pretest) for baselines — NOT `bun test` directly.
6. PATH DISCIPLINE: every edit targets a WORKTREE-ABSOLUTE path. NEVER `cd` into the main checkout; use
   worktree-absolute paths + `git -C "$WORKTREE_ROOT"`. Echo `pwd` in your first commit message
   (`WIP(unit1-decouple): start at $(pwd)`). Commit after EACH meaningful change (WIP commits expected —
   the branch is your crash-recovery anchor); append an append-only `progress.md` (timestamped: done /
   next / blockers).

═══════════════════════════════════════════════════════════════════════════
ANTI-PATTERN BRIEFING — read BOTH before any code, re-read before each sub-step
═══════════════════════════════════════════════════════════════════════════
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` (Ghost-Pattern
  mitigation — kills the React/Vue/JSX reflex).
- `docs/articles/llm-kickstarter-v2-2026-05-04.md` (canonical scrml shape + stdlib catalog + recipes).

═══════════════════════════════════════════════════════════════════════════
DESIGN AUTHORITY (read for the WHY)
═══════════════════════════════════════════════════════════════════════════
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/server-program-shape-2026-07-12.md` —
  Fork 2 (§ "Piece 2 — decouple") + Hard Problem H3. RULED 2A ("yes: the typed-inbound-route primitive is
  orthogonal to the UI emit").
- (Arc context — you are Unit 1 ONLY, the refactor: decouple the emit; do NOT build the serve-harness or
  the `serve=` surface [that is Unit 2]. Full decomposition lives in the PA's SCOPING; this brief is
  self-contained for Unit 1.)

═══════════════════════════════════════════════════════════════════════════
THE TASK
═══════════════════════════════════════════════════════════════════════════
GOAL: make the §61 `<endpoint>` + §37 `server function* route=` SSE server route-handler emit AND the
`fetch`-handler assembly PROGRAM-SHAPE-AGNOSTIC — so a headless, listener-owning program (no UI) can host
them, not only the web-app `<program>`. Today they ride the web-app emit pipeline (html + client bundle +
CSRF scaffold + SSR). Extract them so the route/fetch emit is parameterized by program SHAPE:
  - **web-app shape** = today's behavior EXACTLY (html/client/CSRF/SSR + routes + fetch). BYTE-IDENTICAL.
  - **headless shape** = route-handlers + a `fetch` handler mounting them + CORS ONLY — NO html, NO client
    bundle, NO CSRF scaffold, NO SSR.

SCOPE FENCE — Unit 1 is the REFACTOR ONLY:
  - DO NOT build the `Bun.serve` serve-harness (that is Unit 2 / emit-tool.ts).
  - DO NOT add the `serve=`/`cors=` attributes or any `kind="tool"` wiring (Unit 2).
  - DO NOT touch SPEC.md (the §64.1 strike is Unit 2). NO new §34 codes. NO new authored surface.
  - The headless shape is EXERCISED ONLY by a unit test in this unit (prove separability); its real
    consumer is Unit 2.

PHASE 0 — MAP THE COUPLING (report before extracting). Using dock + grep on LIVE source, precisely locate:
  - `generateServerJs` (emit-server.ts ~L1009) and its `mode:"browser"|"library"` axis — what does each
    mode currently gate?
  - The `<endpoint>` route-handler emit (`collectEndpointDecls` ~L956, `emitEndpointServerHelperLines`
    ~L796, `parseArmBindings` ~L986) and the §37 SSE route emit — where do they assume a web-app program?
  - The `fetch`-handler assembly (`export async function fetch(request)` ~L3595) — how routes get mounted
    into it, and what web-app-only scaffold (html/client/CSRF/SSR) is interleaved.
  - `generateValueOnlyServerJs` (~L896) — the EXISTING no-web-app emit precedent; mirror its pattern.
  Write the coupling shape to `progress.md`. If the coupling is DEEP/entangled (much larger than a
  bounded extraction), STOP and report — do not force a huge refactor; the PA will re-scope.

PHASE 1 — EXTRACT. Introduce the program-shape-agnostic route-handler + fetch-assembly emitter,
parameterized by shape. The web-app path calls it with the web-app shape and its output is UNCHANGED.

PHASE 2 — REGRESSION GATE (the primary safety property — a refactor must not change existing output):
  - Full suite `bun run test` = 0 fail.
  - BYTE-IDENTITY: pick a representative fixture that exercises a web-app `<program>` with an `<endpoint>`
    AND an SSE `server function* route=`. Compile it on the PRE-refactor baseline and the POST-refactor
    build; the emitted server JS MUST be byte-identical. Capture the pre-image FIRST (before editing).
    A grep-diff of the emitted `.js` is the check — NOT just "tests pass."

PHASE 3 — HEADLESS-SHAPE UNIT TEST: a new unit test asserting the extracted emitter, invoked with the
  headless shape over a program containing an `<endpoint>` + an SSE route, emits the route-handlers + a
  `fetch` handler mounting them and OMITS html/client-bundle/CSRF/SSR scaffold. (This proves separability;
  Unit 2 wires it to `Bun.serve`.)

NAMING GUARD: never call this a "server shell" / "persistent shell" — that aliases navigate's §20.8 SPA
client shell. Use "headless shape" / "listener-owning program" / "program-shape-agnostic route emit."

═══════════════════════════════════════════════════════════════════════════
DoD — do not mark DONE without ALL of:
═══════════════════════════════════════════════════════════════════════════
- [ ] Route-handler + fetch emit extracted into a program-shape-agnostic emitter (web-app + headless shapes).
- [ ] Web-app output BYTE-IDENTICAL (full suite 0-fail + the byte-identity fixture check, pre vs post).
- [ ] Headless-shape unit test passes (routes + fetch, NO html/client/CSRF/SSR).
- [ ] No SPEC change, no new §34 codes, no new authored surface, no serve-harness, no `serve=` attribute.
- [ ] `progress.md` current (Phase-0 coupling map + what/next/blockers); clean `git status`; branch tip
      carries all work; report the FINAL_SHA + files-touched + the byte-identity result + maps-load-bearing.
NOTE: the PA runs an independent adversarial `/code-review` on your diff before landing (you cannot run it
in-agent) — write for that gate: keep the diff reviewable, the extraction mechanical, the web-app path provably unchanged.
