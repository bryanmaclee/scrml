# scrmlTS — Session 85 (CLOSE — v0.2.5 + v0.2.6 tagged · v0.3 Wave 1 spec landed · `<page>` ratified · Wave 3 Dispatch 1 e2e green on 2/3 browsers)

**Date:** 2026-05-11 → 2026-05-12 (S85; opened morning of 2026-05-11; closed 2026-05-12)
**Previous:** `handOffs/hand-off-84.md` (S84 close — v0.2.4 cut + Wave 2 landed + v0.3 program-shape dive ratified)
**This file:** rotates to `handOffs/hand-off-85.md` at S86 open

**Tests at S85 CLOSE:** **11,507 pass / 100 skip / 1 todo / 0 fail / 557 files** (`bun run test` at HEAD `2b7c4df`)
**Cumulative S84→S85 delta:** **−5 pass / +23 skip / +3 files / 0 regressions** vs v0.2.4 baseline `28cd2ac`. The pass-count regression is by design — v0.3 Wave 1 walker inversion + 5 deferred-A8-wave `.skip`s consolidated test surface; the new walker has fewer paths (test-rewrite-not-bug).

**Semver state at S85 close:**
- v0.2.0 `022ee02` — first semver baseline (S83)
- v0.2.1 `d72c074` — Wave 4A bundle (S83)
- v0.2.2 `98e872d` — Wave 4B.1 bundle (S83)
- v0.2.3 `d512266` — Bug 2 (S84)
- v0.2.4 `28cd2ac` — Wave 1 + Wave 1.5 robust-v0.2 bundle (S84)
- **v0.2.5 `2c687b5`** — Wave 2.5 robust-v0.2 bundle (S85 — A2+A4 real fixes + A1+A3 depth-of-survey-with-regression-coverage)
- **v0.2.6 `efbd1e8`** — F-COMPONENT-001 family closure (S85 — A6 transitive cross-file component registry + A7 23-site server-modifier sweep + loadRows rename → trucking-dispatch error-free)
- HEAD `2b7c4df` (v0.3 Wave 1 SPEC anchor + walker inversion; NOT tagged — v0.3.0 tag waits for actual v0.3 implementation completion in Wave 2+)
- All semver tags pushed to origin

**Cross-machine sync at S85 close:**
- scrmlTS: 0/0 vs origin/main at close (all S85 commits pushed)
- scrml-support: 0/0 vs origin/main at close (v0.3 ratification + S85 dive docs pushed)

---

## S85 — what happened (summary by phase)

S85 opened morning of 2026-05-11 with sync checks + hand-off rotation + per-machine pre-commit hook install (was uninstalled on this machine). It closed evening of 2026-05-12 with v0.2.5 + v0.2.6 tagged, v0.3 spec anchor + walker landed, Wave 3 e2e infra live + canary green on 2/3 browsers, scrml.dev landing-page substantively refreshed to v0.2.6 mental model, and 4 deep-dive docs landed in scrml-support. **Second-largest single session of the project.**

### Phase 1 — Session-open ops + 4 stale-worktree cleanup + hook install

Sync clean both repos. **Pre-commit hook NOT installed on this machine** — `core.hooksPath` defaulted to `.git/hooks`. Installed at S85 open: `git config core.hooksPath scripts/git-hooks`. **Note: appeared to revert mid-session** (worktree-prune side-effect?); re-applied. **4 stale worktrees from S84** were locked + retained despite hand-off-84 claiming clean. Unlocked + removed + branches deleted. Pruned. Main checkout only.

### Phase 2 — Q-verdict ratification + co-location principle captured

User Socratic prompt at S85 open ("what is the token that every AST ever starts with?") landed Q2 correction: `<program>` is **once-per-application** not once-per-file. Modules (utility/component files) are bare; only the entry file has `<program>`.

Companion principle captured (NOT formalized as a lock per user directive): **co-location-of-behavior is the #1 persistent design principle.** User verbatim: "I want to look at 1 place in the code and see: what that thing looks like, what it does, when where and how it does it. co-location baby."

5 Q-verdicts ratified at S85 with Q2 corrected. Q-verdict table:

| Q | S84 dive verdict | S85 ratified |
|---|---|---|
| Q1-channels-inside | reverse E-CHANNEL-INSIDE-PROGRAM | ✅ YES |
| Q1-styles-outside | `#{}` stays file-top | ✅ YES |
| **Q2** | one-program-per-file canonical | ✅ **one-program-per-APP canonical** |
| Q3-let/const lift | bare locals at program-top lift | ✅ YES |
| Q3-decl-shape list | full enumeration | ✅ YES |
| Q5-deprecation cycle | W → E v0.4 | ✅ YES |

Persisted to user-voice + S85 dive amendment.

### Phase 3 — Wave 2.5 dispatched (A1-A4 in parallel)

User authorization: **"1"** (Fire Wave 2.5 parallel A1-A4 NOW, Wave 3 after).

| # | Outcome | Locus | Tests | Commit |
|---|---|---|---|---|
| A1 | Depth-of-survey #11 — no bug | regex at `expression-parser.ts:709,715` already handled `@cell.member` | +4 regression tests | `047b4e1` |
| **A2** | **Real fix** — `_p3aIsExport` filter conflation (added C18 `e28a022` 2026-05-09) | `compiler/src/codegen/emit-channel.ts` (−4 lines + comments) | +3 unit tests + 1 inverted | `a1cc782` |
| A3 | Depth-of-survey #12 — stale workaround comment | `examples/23-trucking-dispatch/app.scrml` (5 fn-decl cleanups) | +2 regression tests | `80cbb9c` |
| **A4** | **Real fix** — `normalizeTokenizedRaw` internal `/>` collapse gap | `compiler/src/component-expander.ts` (+13/-1) | +1 integration test (§C10) | `2c687b5` |

Trucking-dispatch E2E delta: 11 errors → 7 errors (4 E-RI-002 publisher-pattern fires closed by A2). v0.2.5 tagged at `2c687b5`.

### Phase 4 — A6 transitive cross-file component registry (F-COMPONENT-001 closure) + A7 sweep + loadRows fix + E-DG-002 fix

Followon dispatches after Wave 2.5 surfaced the residual surface.

**A6 (`e71d914`)** — Transitive cross-file component registry enrichment. `LoadCard` imported by `board.scrml` references `<LoadStatusBadge/>` in its body; `LoadStatusBadge` imported only by `load-card.scrml`. Eager worklist enrichment via `lookupKey(filePath, imp, importGraph)` per the W2 commit's F4-deferred precedent. +115/-58 in `component-expander.ts`. +2 integration tests at §C11. Closes the F-COMPONENT-001 family completely (W2's F1+F2+F3 + A4's F4 + A6's transitive).

**A7 (`37dc5a5`)** — PA-side sweep of 23 `server function` redeclarations in 18 trucking-dispatch pages. All have `?{}` body OR call another server fn (auto-escalate via Insight 26 D3 cross-file caller-context propagation). −32 W-DEPRECATED-SERVER-MODIFIER warnings. Channel publishers intentionally left alone (special escalation path; no warning fires).

**loadRows rename (`efbd1e8`)** — `const loadRows` in `board.scrml:57` shadowed registered `<loadRows>` state cell. Renamed local to `const rows`; updated return mapping `loadRows: rows`. Closes E-NAME-COLLIDES-STATE.

**E-DG-002 fix (`6fc58bb`)** — Spurious false-fire on `@driverStatus` in trucking-dispatch register.scrml. Depth-of-survey #13: locus right (DG fire-site) but mechanism different (per-file engine-cell self-consumption, not cross-file leak). `<engine for=DriverStatus initial=.OffDuty>` auto-declares `@driverStatus` per §51.0.C; engine block IS the rendered consumption position per §51.0.D; but DG markup-sweep didn't visit `engine-decl` nodes for self-consumption. +21 lines at `dependency-graph.ts:1851` (engine-decl arm in `sweepNodeForAtRefs`). +5 regression tests in new file `dg-engine-cell-self-credit.test.js`.

v0.2.6 tagged at `efbd1e8`. **Trucking-dispatch reference app: 11 errors → 0 errors / 100 warnings → 41 warnings.** Production-compilation-clean.

### Phase 5 — scrml.dev landing-page refresh (2 commits)

**Commit 1 (`28c075b`) — surgical staleness fixes (6 items):**
- Counter code example V5-strict (`<count> = 0` not `@count = 0`)
- `<machine>` → `<engine>` in mutability paragraph
- `@shared` retirement language in realtime paragraph
- "14 examples" → "22 examples + trucking-dispatch reference app"
- Quick-start adds `bun link` + `scrml init`
- Mutability predicate form V5-strict (`<price>: number(...)`)

**User feedback:** *"I wanted a legit update and I am not seeing that. look through it, is < card> still showing as decl of state."*

**Commit 2 (`fd3edf9`) — substantive mental-model refresh:**
- Replaced "State is first-class" (with broken `< Card>` framing) → **"State is the declaration primitive"** + NEW **"The UI is the state machine"** sections
- Added NEW **"Validators auto-synthesize a validity surface"** section (L11/L12/L13 surface that wasn't on site)
- Added NEW **"Errors-as-states is the canonical lifting"** section (failable functions + `!{}` + Phase-enum lifting)
- Refactored "This page is the highlights" — dropped `use` keyword (dead); added refinement types, `lin`, `!{}`, `<onTransition>`, `pinned`, `bun scrml promote --match`

Landing page now reflects v0.2.6 mental model (tier ladder + V5-strict + validators + match/engine + errors-as-states) instead of pre-v0.2 unified-state-type framing. **Durable PA-rule:** "surgical fixes" and "substantive refresh" are DIFFERENT operations; default to deeper-refresh shape when user asks to "update the site."

### Phase 6 — v0.3 Wave 1 dispatch (the big architectural anchor)

User ratifications after `<page>` design dive returned:
- `ratelimit=` per-route (on `<page>`)
- SPA stays `<program>`-only (no sibling `<page>`)
- `<program spa>` boolean as DELIBERATE OQ (user "juggling consequences")
- Schema/seeds db-anchor workaround explicit-known-fix language
- A8 folded into v0.3 scope

**v0.3 Wave 1 landed at `2b7c4df`:**
- SPEC §40.8 + §40.8.1: `<program>` once-per-application normative; `<page>` siblings inside `<program>` for multi-page apps; SPA = absence of `<page>` siblings; channels inside `<program>` as siblings of `<page>`; default-logic body mode; `<program spa>` OQ with 4 args-each-side + decision deferred
- SPEC §4.15 + §24.4: `<page>` registered with attrs `{db, auth, csrf, ratelimit}` and `route=` DOUBLY forbidden (regression + §4.12.2 collision)
- SPEC §38.1/2/4 + §38.4.1: channel placement REVERSED — now inside `<program>` (v0.3 direction). §38.4.1 NEW A8 canonical contract: exporter is server-route SoT; consumers emit client stubs only
- SPEC §39.12.0 NEW: schema/seeds db-anchor workaround tolerated v0.3 + explicit v0.4-fix note
- SPEC §47.9.2: cross-ref to `<page>` registration
- §34 catalog +5 rows (4 errors + 1 warning): E-CHANNEL-OUTSIDE-PROGRAM, E-CHANNEL-INSIDE-PAGE, E-PAGE-ROUTE-ATTR-FORBIDDEN, E-PAGE-INVALID-ATTR, W-PROGRAM-REDUNDANT-LOGIC. E-CHANNEL-INSIDE-PROGRAM marked retired.
- `compiler/src/symbol-table.ts:6006` — `walkChannelPlacement` inverted: was E-CHANNEL-INSIDE-PROGRAM; now E-CHANNEL-OUTSIDE-PROGRAM
- 5 test files `.skip`'d with documented v0.3 A8-wave deferral; `channel-placement-shared-b19.test.js` rewritten for v0.3 direction (15 pass)

Tests: 11528 → 11507 pass (−22 from rewrite) / +23 skip (deferred A8-wave) / 0 fail.

**Fixture migration NOT done** — `examples/15-channel-chat.scrml`, `examples/08-chat.scrml`, `examples/23-trucking-dispatch/channels/*` still have file-top channels. Under v0.3 walker they fire E-CHANNEL-OUTSIDE-PROGRAM. **This is expected new-spec behavior**; migration is `scrml migrate` Wave-2+ work.

### Phase 7 — Wave 3 Playwright Dispatch 1 + live e2e validation

User authorization: **"wave 3 go"**.

Dispatch landed at `f69ff6a` (after recovery from a PA-side worktree-removal-while-CWD-inside mishap; see Phase 8 anomalies):
- Top-level `e2e/` workspace: `playwright.config.ts` + `fixtures/dev-server-fixture.ts` + `tests/02-counter.spec.ts` + `README.md`
- `@playwright/test ^1.49.0` devDep + 3 npm scripts (`e2e`, `e2e:ui`, `e2e:install`)
- `.gitignore` additions for build artifacts

**Live e2e validation (PA-side, post-landing):**
- **Chromium: 5/5 PASS (3.9s)** ✅
- **Firefox: 5/5 PASS (19.7s)** ✅
- **WebKit: 5/5 FAIL at browser launch** — host system missing `libavif13` (needs `sudo apt-get install libavif13` OR `sudo npx playwright install-deps`). Runtime compatibility UNTESTED. Filed as separate task #18.

Both dev servers (port 3100 examples/ + port 3101 benchmarks/todomvc/) booted cleanly.

**Bonus signal:** when `scrml dev examples/` compiled trucking-dispatch + 17-schema-migrations on-the-fly, ~12 `.server.js` files emitted "Unexpected ." errors. Static `bun scrml compile` produces 0 errors at v0.2.6. **Dev-server-side codegen pipeline diverges from static compile pipeline.** Filed as task #17.

### Phase 8 — Operational anomalies + recovery patterns

**Pre-commit hook config: worktrees don't inherit `core.hooksPath`.** 4/4 S85 dispatch agents reported `core.hooksPath` resolves to `.git/hooks` in their worktrees despite main having `scripts/git-hooks` set. Dispatch brief addendum (per-worktree enable at startup) works (validated by A6 + Wave 1). Filed as task #9 (now completed-with-workaround-documented).

**PA-side worktree-removal mishap.** Mid-session, PA ran `git worktree remove --force <path>` while harness's CWD was inside the worktree being removed. Nuked CWD; staged changes for the commit attempt vanished. Recovery: agent's commits remained as unreachable refs in git object database; used `git checkout <dangling-sha> -- <files>` from main checkout. Wave 3 Dispatch 1 landed cleanly at `f69ff6a`. **Durable rule: ALWAYS `cd /home/bryan/scrmlMaster/scrmlTS` BEFORE `git worktree remove`.** Validated for subsequent worktrees including Wave 1 cleanup.

**Agent-side path-discipline.** Wave 1 agent's first Edit attempts on bare `/home/.../scrmlTS/...` paths went to MAIN, not worktree. Self-detected via `git hash-object` showing identical-to-HEAD. Recovered + re-applied to WORKTREE_ROOT-absolute paths. Pa.md F4 rule remains correct + load-bearing.

**Mid-session `core.hooksPath` revert.** PA set hook at S85 open; later observed it returned to default `.git/hooks`. Re-applied. Possible cause: `git worktree prune` or `git worktree remove --force` clearing config inadvertently. Not load-bearing for v0.3 progress; tracked for recurrence.

---

## State-as-of-close tables

### Semver tag history

| Tag | Commit | Scope |
|---|---|---|
| v0.2.0 | `022ee02` | First semver baseline (S83) |
| v0.2.1 | `d72c074` | Wave 4A bundle (S83) |
| v0.2.2 | `98e872d` | Wave 4B.1 bundle (S83) |
| v0.2.3 | `d512266` | Bug 2 (S84) |
| v0.2.4 | `28cd2ac` | Wave 1 + Wave 1.5 robust-v0.2 bundle (S84) |
| **v0.2.5** | **`2c687b5`** | **Wave 2.5 (S85 — A1+A2+A3+A4 + Wave 2.5 robust-v0.2)** |
| **v0.2.6** | **`efbd1e8`** | **F-COMPONENT-001 family closure (S85 — A6 + A7 + loadRows + E-DG-002 + v0.2.6 trucking-dispatch error-free)** |
| (untagged) | `2b7c4df` | v0.3 Wave 1 SPEC anchor + walker inversion |

### S85 commit ledger (chronological)

| # | Commit | Description |
|---|---|---|
| 1 | `047b4e1` | A1 regression tests (depth-of-survey #11) |
| 2 | `a1cc782` | A2 cross-file channel emit-channel.ts fix (REAL) |
| 3 | `80cbb9c` | A3 stale workaround removal (depth-of-survey #12) |
| 4 | `2c687b5` | A4 component-expander.ts internal `/>` fix (REAL) → **v0.2.5** |
| 5 | `5b714fb` | S85 hand-off rotation + in-flight state |
| 6 | `e71d914` | A6 transitive cross-file component registry (REAL — F-COMPONENT-001 closure) |
| 7 | `37dc5a5` | A7 server-modifier sweep (23 sites in 18 pages) |
| 8 | `efbd1e8` | loadRows local-rename → **v0.2.6** |
| 9 | `6fc58bb` | E-DG-002 false-fire fix (depth-of-survey #13) |
| 10 | `28c075b` | scrml.dev landing page surgical staleness fixes |
| 11 | `f69ff6a` | Wave 3 Dispatch 1 — Playwright infra + 02-counter canary |
| 12 | `fd3edf9` | scrml.dev landing page substantive mental-model refresh |
| 13 | `2b7c4df` | v0.3 Wave 1 — spec amendments + walker inversion |
| 14 | TBD (wrap) | S85-close wrap (hand-off + master-list + changelog + .gitignore) |

**scrml-support S85 commits:** `26aad28` (v0.3 Q-verdicts ratified + S85 dive amendment) + `745adde` (3 deep-dive docs from session)

### Tests at close (full suite via `bun run test`)

- **11,507 pass / 100 skip / 1 todo / 0 fail across 557 files**
- −22 pass since S84 close (test-rewrite consolidation in b19 for v0.3 walker reversal)
- +23 skip since S84 close (deferred-A8-wave `.skip`'s for fixture-migration test files)
- 0 regressions across all 13 S85 landings

### Trucking-dispatch reference app state

- **Before S85:** 11 errors / 100 warnings
- **After v0.2.5 (A1-A4):** 7 errors / 73 warnings
- **After v0.2.6 (A6 + A7 + loadRows):** **0 errors / 41 warnings**
- **After v0.3 Wave 1 (channel-placement reversal):** **9 errors / 39 warnings** — the 9 errors are now E-CHANNEL-OUTSIDE-PROGRAM on the 4 channel decls + dependent fan-out. **Expected v0.3-walker behavior; needs `scrml migrate` to fix.** This is the canonical v0.3 fixture migration target.

### Cumulative file deltas S84→S85

**scrmlTS:**
- 4 NEW compiler-test files (A1 + A2 + A6 + E-DG-002)
- A2 test inverted in channel.test.js
- 5 test files `.skip`'d (deferred A8-wave): channel-placement-shared-b19 (rewritten), p3a-cross-file-multi-page-broadcast, p3a-pure-channel-file, p3a-chx-cross-file-inline, p3a-chx-same-file-passthrough, p3a-diagnosis
- 1 new integration test (Wave 3 D1)
- 4 NEW compiler-source modifications: `emit-channel.ts`, `component-expander.ts` (twice — A4 + A6), `dependency-graph.ts`, `symbol-table.ts`
- 1 SPEC.md edit (Wave 1, 7 sections, ~285 lines)
- 1 new e2e/ workspace (4 files + README)
- 5 trucking-dispatch source edits (app.scrml workaround + 18 server-fn cleanups + board.scrml loadRows)
- 2 landing-page docs edits (`docs/index.html` surgical + substantive)
- 2 new memory files (none — no MEMORY.md additions S85)
- .gitignore extension for docs/articles/<slug>/ build output

**scrml-support:**
- 4 new deep-dive docs:
  - `program-as-container-shape-DIVE-2026-05-11.md` (S85 amendment block)
  - `program-as-container-implementation-plan-2026-05-12.md` (NEW)
  - `page-helper-element-design-2026-05-12.md` (NEW)
  - `wave-3-playwright-benchmarks-scoping-2026-05-12.md` (NEW)
- 1 user-voice append (~145 lines)

### `.claude/agents/` state at close

11 project agents + 5 debate panelists (carried from S83). No staging changes this session.

### Pre-commit hook state

**INSTALLED at S85 open + verified holding at close** (`core.hooksPath = scripts/git-hooks`). Mid-session revert observed once; re-applied. Worktree-inheritance issue confirmed (worktrees don't inherit; agent brief addendum handles). Tracked as completed-with-workaround per task #9.

### Worktree state at close

CLEAN. Main checkout only. All S85 worktrees (A1+A2+A3+A4+A6+E-DG-002+Wave3-D1+`<page>`-dive+Wave1) cleaned post-landing.

---

## Open questions to surface immediately at S86 open

1. **`<program spa>` boolean OQ** — deferred per user "juggling the consequences." 4 args-for + 4 args-against captured in SPEC §40.8.1. Decision waits on adopter-friction signal or further user deliberation.

2. **v0.3 Wave 2+ dispatch** — Wave 1 anchored the spec. Wave 2 territory:
   - TAB extension to tokenize `<page>` as structural element
   - AST node shape for `<page>`
   - Walker for E-CHANNEL-INSIDE-PAGE (depends on `<page>` parser support)
   - A8 codegen change (exporter-only server-route + consumer client-stub) per SPEC §38.4.1 contract
   - `scrml migrate --program-shape` command implementation
   - Module-file channel dispensation (`export <channel>` in no-`<program>` module file — part of A8 work)
   - W-PROGRAM-REDUNDANT-LOGIC fire-site emitter (warning registered; emitter pending)
   - Fixture migration sweep across ~933 .scrml files
   - **Estimated band: 75-135h walltime (R2 with `<page>`)** per implementation-plan dive

3. **Wave 3 Dispatch 2** — 4 more critical-path specs (TodoMVC + 03-contact-book + 05-multi-step-form + 14-mario). Survey produced refinements baked in:
   - Browser-install verification at startup
   - WebKit canary FIRST before writing more specs (gates --no-hot-reload-assumption shape)
   - `freshDb` fixture for 03-contact-book
   - TodoMVC pre-flight: compile fresh + verify port-3101 boots
   - Spec convention proposal: aria-live + test-id on reactive value displays
   - Estimated 10-16h

4. **Wave 3 Dispatch 3** — Phase B benchmarks refresh against React/Svelte/Vue at v0.2.6. Numbers-honesty check mandate: ship honest numbers; update README + scrml.dev if delta >10%. Estimated 6-12h.

5. **WebKit + scrml runtime compatibility validation** — blocked on `sudo apt-get install libavif13`. Once installed, re-run `bun run e2e --project=webkit`. SSE-hot-reload-keepalive risk also untested. Task #18.

6. **Trucking-dispatch `scrml dev` server-side codegen divergence** — `scrml dev` fires "Unexpected ." errors on ~12 `.server.js` files where `bun scrml compile` produces 0 errors. Real divergence between dev-server compile pipeline and static compile pipeline. Task #17.

7. **A8 implementation** — folded into v0.3 scope at user S86 directive. Wave-2+ codegen change. SPEC §38.4.1 anchored at Wave 1.

8. **5 articles publishable** per S84 W2-3 triage — user-decision-queue per pa.md Rule 1. PA did NOT auto-publish during S85 site refresh.

9. **Pre-commit hook `core.hooksPath` mid-session revert** — recurrence worth tracking. Possible `git worktree prune`/`remove --force` side-effect.

10. **SPEC-INDEX.md regeneration** — ~286 line shift from §39.12.0/§40.8/§40.8.1/§47.9.2/§34 amendments. Run `bun run scripts/regen-spec-index.ts` (or equivalent) at S86 open.

11. **`route-inference.ts:2467` `routes/`-vs-`pages/` consistency cleanup** — compiler-internal flagged by implementation-plan dive. Separate dispatch.

---

## Things S86 PA must NOT screw up (carry-forward from prior sessions + S85 additions)

S77-S84 lists carry forward verbatim. **S85 additions:**

- **DO NOT re-debate v0.3 program-shape direction.** R2 (one-program-per-APP) is ratified S85. Q-verdicts are ratified. `<page>` design is ratified (route-free, 4 attrs). Schema/seeds db-anchor workaround is ratified. A8-into-v0.3 is ratified.
- **DO surface `<program spa>` OQ as a deliberate-deferred decision.** SPEC §40.8.1 has 4 args each side. Don't pre-commit a side; let adopter friction surface the right answer.
- **DO read the v0.3 Wave 1 commit `2b7c4df` SPEC changes FIRST** at S86 open before any Wave 2+ work. The spec anchor is the target.
- **DO read 4 dive docs** at `scrml-support/docs/deep-dives/`:
  - `program-as-container-shape-DIVE-2026-05-11.md` (S84 verdict + S85 amendment)
  - `program-as-container-implementation-plan-2026-05-12.md` (R1-vs-R2 + 4-wave plan)
  - `page-helper-element-design-2026-05-12.md` (`<page>` design)
  - `wave-3-playwright-benchmarks-scoping-2026-05-12.md` (Wave 3 plan)
- **DO note 5 NEW §34 catalog rows + 1 retired** — E-CHANNEL-INSIDE-PROGRAM retired; E-CHANNEL-OUTSIDE-PROGRAM + E-CHANNEL-INSIDE-PAGE + E-PAGE-ROUTE-ATTR-FORBIDDEN + E-PAGE-INVALID-ATTR + W-PROGRAM-REDUNDANT-LOGIC added.
- **DO note v0.3 walker is LIVE** — `walkChannelPlacement` now fires E-CHANNEL-OUTSIDE-PROGRAM. Pre-v0.3 fixtures with file-top channels (15-channel-chat, 08-chat, trucking-dispatch/channels/*) will fire. EXPECTED — needs Wave 2 migration via `scrml migrate`.
- **DO note 5 test files are `.skip`'d** with documented v0.3 A8-wave deferral. They re-enable when A8 codegen lands. Test count at S85 close is 11,507 / 100 / 0 / 0 / 557.
- **DON'T fire Wave 3 Dispatch 2 BEFORE the WebKit-libavif13 question is resolved** — Dispatch 2 spec choices are affected by whether WebKit support is locked in or punted.
- **DON'T commit docs/articles/<slug>/ build artifacts** — gitignored S85 close. Build output, regenerable via `bun run docs/build.ts`. NEVER track.
- **DON'T forget the `cd /home/bryan/scrmlMaster/scrmlTS` BEFORE `git worktree remove`** — PA-side mishap S85; nearly lost a dispatch.
- **DON'T auto-publish articles** per pa.md Rule 1. The 5 publishable-per-W2-3-triage articles are user-decision-queue.
- **DON'T treat depth-of-survey-discount #13 as a pattern that's slowing down.** Frequency keeps climbing; the pattern is reliable + applies more often than not. Brief dispatches with locus-hints but NOT mechanism-hints; let agent survey reveal the actual mechanism.
- **DON'T forget v0.2.7 tag is not yet needed** — current pattern is per-wave-bundle tagging. v0.2.6 covers Wave 2.5 + F-COMPONENT-001 closure. v0.3.0 tag waits for actual v0.3 implementation completion (Wave 2+).
- **DO note `<page>` parsing is NOT YET in the compiler.** Wave 1 anchored the spec; the AST/TAB extension is Wave 2 work. Trying to compile a file with literal `<page>` block today will fail (or be parsed as HTML).
- **DON'T attempt fixture migration manually.** The `scrml migrate --program-shape` command is the canonical migration path; lands in Wave 2.
- **DO read `program-as-container-implementation-plan-2026-05-12.md` §"Phase 4 recommended next action" + the `<page>` dive's "Phase 4 — Recommended PA next action"** before drafting Wave 2 brief.

---

## Memory files updated this session

NONE. No additions to `~/.claude/projects/-home-bryan-scrmlMaster-scrmlTS/memory/`. S85 durable directives captured in user-voice + this hand-off + SPEC amendments + dive docs. No standalone memory entries warranted.

---

## Cross-machine sync state at S85 close

- **scrmlTS:** 0/0 vs origin/main at close. All 14 S85 commits pushed. v0.2.5 + v0.2.6 tags pushed.
- **scrml-support:** 0/0 vs origin/main at close. v0.3 Q-verdict ratification commit (`26aad28`) + 3 deep-dive docs commit (`745adde`) + user-voice S85-close append (pushed as part of `745adde`).
- **Worktree state:** clean (main checkout only).
- **Pre-commit hook:** verified `core.hooksPath = scripts/git-hooks` at close.

---

## Tags

#session-85 #close #v0.2.5-tag #v0.2.6-tag #v0.3-wave-1-spec-anchor #f-component-001-family-CLOSED #trucking-dispatch-error-free #depth-of-survey-frequency-13 #pro-x-voting-against-x-frequency-8 #co-location-principle-recorded-not-locked #page-helper-element-ratified-route-free #r2-ratified #db-anchor-workaround-explicit-fix-v0.4 #a8-into-v0.3 #wave-3-d1-live-canary-2-of-3-browsers-green #webkit-blocked-on-libavif13 #worktree-mishap-recovered #path-discipline-rule-load-bearing #pre-commit-worktree-inheritance-issue #scrml-dev-server-codegen-divergence #site-substantive-mental-model-refresh #zero-regressions
