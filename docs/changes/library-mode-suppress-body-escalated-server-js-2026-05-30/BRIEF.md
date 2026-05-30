# BRIEF — library-mode-suppress-body-escalated-server-js-2026-05-30

> Archived verbatim per pa.md S136 addendum. Dispatched S145 (2026-05-30) via `scrml-dev-pipeline`, `isolation: "worktree"`, `model: opus`, background. Agent ID `a4faeb580c113d8dc`. Dispatched from main HEAD `8b50c89b` (after GITI-024 landed). User-ratified direction: "Body-content-escalated only" (suppress the HTTP-handler .server.js wrapper in library mode for purely body-content-escalated functions; keep it for explicit `export server function` endpoints). Backed by the 4-reader workflow investigation `wf_e623be53-2f0` (SPEC §12/§13.4/§21.5/§44.7.1 grounding).

---

You are implementing a USER-RATIFIED scrml compiler change: SPEC amendment + codegen. Change-id: `library-mode-suppress-body-escalated-server-js-2026-05-30`. Tight scope — one coherent change.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; follow its Task-Shape Routing for a compiler-source codegen + SPEC change.
Map currency: maps reflect HEAD `9ab7aa38` (2026-05-29); HEAD is now ~31 commits ahead. Treat map content about the files below as a starting hypothesis to verify against current source via grep/Read, NOT ground truth. A detailed PA-led investigation already produced exact file:line leads (in THE TASK below) — trust those + verify.
Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing."

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (read fully before any other tool call)
S99 has had 20 path-discipline leaks; do NOT make this #21.
## Startup (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP + report (S90 CWD-routing failure). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — clean.
4. `bun install` (worktrees don't inherit node_modules).
5. `bun run pretest` (populates samples/compilation-tests/dist/). Use `bun run test` for baselines, NOT `bun test`.
If ANY fails: STOP, report, exit.
## Path + edit discipline (S126 — IN FORCE)
- Apply ALL edits via Bash (`perl -i`/`python`/heredoc/`cp`) on WORKTREE-ABSOLUTE paths including the `.claude/worktrees/agent-<id>/` segment. Do NOT use Edit/Write tools (they leaked to MAIN — incidents #12/#13). Echo target path before each write; re-verify via `git diff`/`grep` after.
- NEVER `cd` into main or anywhere outside WORKTREE_ROOT. Use `git -C "$WORKTREE_ROOT"`, run bun from WORKTREE_ROOT, worktree-absolute paths only.
- SPEC.md is ~30,667 lines / ~410k tokens — NEVER full-file Read. Use grep -n + targeted Read with offset/limit.

# THE TASK — user-ratified design decision

**Decision (ratified by user S145):** In `--mode library`, a function escalated to server-bound PURELY by body content (a `scrml:fs`/`scrml:process`/`scrml:redis`/etc. server-only import, or `?{}` SQL — i.e. its `escalationReasons` are ALL `kind:"server-only-resource"`) SHALL emit as a plain server-side export — NO HTTP-handler `.server.js` route wrapper, NO client fetch-stub. An EXPLICIT `export server function` (or one with an explicit `route=` — i.e. `escalationReasons` includes `kind:"explicit-annotation"`) in library mode RETAINS the `.server.js` wrapper (preserves the host `mount(server)` use case, Insight 22 / giti page-route libraries). App (browser) mode is UNCHANGED.

**Why (spec grounding — a 4-reader PA investigation established this; cite in your SPEC amendment):**
- SPEC §12 (Route Inference) is mode-agnostic, written 100% from the app-mode model; it is SILENT on `--mode library` (no occurrence of "library"/"mode" in §12.1-§12.5).
- §12.3 "Generated Infrastructure" (SPEC.md ~6887-6895) specifies an INDIVISIBLE bundle: route handler + client-side fetch call + event/reactive trigger + ser/deser. In library mode there is no client and nothing fetches the route, so emitting the handler half ALONE is an artifact §12 never describes in isolation.
- §13.4 "Server Function Composition" (SPEC.md ~7019-7058) is direct precedent: a server-escalated callee with NO client/wire caller generates "no separate HTTP route" (it's inlined); an HTTP route appears ONLY when "also called from client code." A library export with in-process callers is structurally the same case → escalation ≠ endpoint.
- §21.5 "Pure-Type Files" / library files (SPEC.md ~13896): a library file's output SHALL be "a JS module with the exported bindings as its sole output" + "not a page." An HTTP request-handler `.server.js` is neither an exported binding nor "sole output".
- §44.7.1 (SPEC.md ~21141-21166): library-module "server route generation" is EXPLICITLY a staged/not-yet-realized lifecycle — so no fixed mandate is being violated.
- The `server` keyword is DEPRECATED (Insight 26): escalation is PLACEMENT classification, not endpoint declaration.

# IMPLEMENTATION

## 1. SPEC amendment (R4 — the normative encoding)
Add a normative mode-conditioning clause. Recommended home: a NEW subsection under §12 (e.g. §12.6 "Library-mode emission") + a cross-ref line in §21.5. The clause SHALL state, in normative SHALL/SHALL-NOT language:
- In `--mode library`, a function whose server escalation is due SOLELY to body content (`escalationReasons` all `kind:"server-only-resource"` per §12.2 Triggers 1/3) emits as a plain server-side export; the compiler SHALL NOT generate the §12.3 HTTP route-handler / client fetch-stub bundle for it (the fetch-call + event-trigger members are inapplicable with no wire caller; consistent with §13.4 no-wire-caller→no-route).
- A library function escalated by an EXPLICIT `server` annotation or explicit `route=` (`escalationReasons` includes `kind:"explicit-annotation"`) RETAINS the §12.3 route-handler emission (host `mount(server)` use case).
- App (browser) mode emission is unchanged.
Determine whether a diagnostic is warranted (likely NOT — this is silent-correct behavior; do not invent a needless lint). If you add any §34 code, justify it. Cite the §13.4 / §12.3 / §21.5 grounding in the amendment prose. Verify your §refs against the ACTUAL current SPEC line numbers (grep first; the numbers above are from the investigation and may have drifted).

## 2. Codegen (the gate)
The PA investigation pinned the mechanism: route-inference is mode-blind; `generateServerJs` (emit-server.ts ~279) has NO `mode` param; the `.server.js` write at `api.js` ~2072 sits OUTSIDE the `if (mode === 'library')` branch; the per-fn emission gate at `emit-server.ts` ~340-356 is `route.boundary === 'server'` ONLY (it never consults `route.escalationReasons`, though that data EXISTS on the FunctionRoute — `kind:"server-only-resource"` vs `kind:"explicit-annotation"`, confirmed at route-inference.ts ~29-30/91-92/235).
Implement: thread `mode` to the server-fn emission path and, in library mode, SKIP handler emission for any function whose `escalationReasons` are ALL `kind:"server-only-resource"` (no `kind:"explicit-annotation"` AND no explicit `route=`). Cleanest locus per the investigation: either short-circuit/condition at `codegen/index.ts` ~600-602 (mode already in scope there) OR add the discrimination inside the `emit-server.ts` ~340-356 per-fn loop. You choose the cleaner one; the per-fn `escalationReasons` discrimination is the load-bearing part (it's what keeps explicit endpoints emitting).

## 3. The E-CG-006 interaction — SCOPE GUARD (important)
A body-escalated function whose body has a TOP-LEVEL inline `?{}`/transaction statement trips `E-CG-006` in the library `.js` today (collect.ts ~460-519 `isServerOnlyNode`) — it does NOT emit as a clean plain library export. Suppressing its `.server.js` would leave it with NEITHER a working library export NOR a server endpoint = WORSE than today. That under-emission case is a SEPARATE, already-tracked staged lifecycle (W5a/W5b / F-COMPILE-003). **Therefore: only suppress the `.server.js` wrapper for body-escalated functions that ALREADY emit cleanly as a plain export in the library `.js`** (the import-escalated case — e.g. a plain `export function` importing `scrml:fs`, which is GITI-024's exact shape). If a function would trip E-CG-006 in the library `.js`, leave its current behavior unchanged (do NOT suppress) — that case is out of scope. Confirm this boundary empirically.

## OUT OF SCOPE — do NOT touch
- The separate pre-existing defect: library-mode CLIENT `.js` emitting `export server function` verbatim (invalid JS). PA is filing it separately.
- The W5a/W5b pure-fn-library staged lifecycle (the `?{}`-top-level under-emission case).

# ACCEPTANCE (mandatory; R26 empirical per S138)
- **(a)** Library-mode compile of GITI-024's plain `export function` + `scrml:fs` reproducer (`handOffs/incoming/2026-05-30-1037-giti-to-scrmlTS-giti-024-server-split-braceless-continue.scrml`, committed): NO `.server.js` HTTP-handler emitted; the function present as a plain `export function` in the library `.js`; compile exit-0; `node --check` clean on emitted artifacts.
- **(b)** Library-mode compile of an EXPLICIT `export server function` (write a fixture): `.server.js` STILL emitted (mount use case preserved).
- **(c)** App/browser-mode compile of a server function: `.server.js` STILL emitted (NO regression to app mode).
- **No regressions:** full `bun run test` green vs your startup baseline (+N for new tests). NB 3 known parallel-load flakes (`self-compilation.test.js` + `trucking-dispatch-smoke-integration.test.js` two-compile-determinism) — if one fails, re-run it ISOLATED to confirm it passes alone (NOT a regression); do NOT bypass the gate over it. A non-flake failure is a real regression.
- **Write regression tests** (write-test-always) covering (a)+(b)+(c).

# COMMIT DISCIPLINE (S83 + S99)
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>`, `git -C "$WORKTREE_ROOT" add <file>`, commit IMMEDIATELY (don't batch).
- FIRST commit message MUST include verbatim startup `pwd` output (e.g. `WIP(lib-server-js): start at <pwd>`).
- Do NOT use `--no-verify`. If pre-commit fails on env race, STOP + report.
- Before DONE: `git -C "$WORKTREE_ROOT" status` clean.

# FINAL REPORT: WORKTREE_PATH · BRANCH · FINAL_SHA · FILES_TOUCHED · the SPEC §section(s) you amended (with the exact §number you chose + why) · the codegen gate locus + how you discriminate body-content vs explicit · how you handled the E-CG-006 scope guard (empirical confirmation) · acceptance results (a)+(b)+(c) · test delta · maps feedback line · deferred items.
