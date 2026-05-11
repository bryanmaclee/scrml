# scrmlTS — Session 80 (CLOSE — auth/protect/csrf codification · D3 csrf= drift resolved · E-MW-001 retired · Bootstrap L3 strip-bug FIXED · A5-7 canonical-sample family landed · 6 commits · 0 regressions · pushed)

**Date opened:** 2026-05-11
**Date closed:** 2026-05-11 (single-day session)
**Previous:** `handOffs/hand-off-79.md` (S79 close — 4 SHIPs + Batch K deref + 88 new tests + 0 regressions + pushed)
**This file:** rotates to `handOffs/hand-off-80.md` at S81 open

**Tests at open (S79 close baseline):** 10,413 pass / 62 skip / 1 todo / 0 fail (506 files, pre-commit subset).
**Tests at S80 close (pre-commit subset, `55d41f7`):** **10,416 pass / 62 skip / 1 todo / 0 fail** (506 files; +3 from baseline — net of 4 new sample files picked up by pretest, -1 from MW-CSRF-001 deletion).
**Tests at S80 close (FULL suite, `bun run test`):** **11,139 pass / 73 skip / 1 todo / 0 fail** (534 files).

---

## S80 close — summary

Substantive session. **Two non-trivial design landings + one Bootstrap-L3 compiler-bug fix + the full A5-7 canonical-sample family + one wrap-time parity catch-up.** 6 commits, 2 push pairs. Zero regressions across full suite.

### S80 commit chain (in order — 6 commits on scrmlTS + 1 on scrml-support)

**scrmlTS commits (6):**
1. `ef70daa` refactor(s80): codify auth/protect/csrf attribute hosts; retire E-MW-001 + channel protect=
2. `d7f9609` fix(s80): library-mode meta-block strip — paren-aware import-arg regex
3. `a5dea6e` feat(s80-a5-7a): canonical <onTimeout> samples — static + computed-delay
4. `48e0005` feat(s80-a5-7b): named <onTimeout> + cancelTimer() sample (engine-007)
5. `2fbb4ac` feat(s80-a5-7c+d): <onIdle> watchdog sample + A5-7d audit closure
6. `55d41f7` fix(s80-self-host-parity): sync ast.scrml — drop mwCsrf + E-MW-001 (mirrors ef70daa)
7. (this wrap commit)

**scrml-support commits (1):**
- `7279e6e` deep-dive: protect-auth-csrf-terminology-2026-05-11.md (the dive that surfaced D3 csrf= drift + the Approach A vs B vs C decomposition for E-MW-001 retirement)

---

## S80 thread-by-thread

### Thread 1 — Hook install + session bootstrap

Per pa.md §"Per-machine setup — pre-commit hook installation (S78)": session-start check found `core.hooksPath` returning `.git/hooks` (not `scripts/git-hooks`). Likely cross-machine state — S79 closed on a different machine where the hook was installed. PA ran `git config core.hooksPath scripts/git-hooks` to install. Hook fired clean on every subsequent commit.

### Thread 2 — Phantom-code middleware family → became D3 csrf= drift resolution (`ef70daa`)

User picked "Phantom-code middleware family" from the S79 carry-forward menu. PA verification per Rule 4 surfaced that the "phantom" framing was wrong: all 4 codes (E-MW-001/002/005/006) HAD emit-sites in `ast-builder.js:10043-10163` and tests passed 46/46 in `middleware-handle.test.js`. The §34 catalog rows existed (added at S78 audit follow-up) but carried stale **"Un-fireable note: no current src emit-site located"** annotations.

Deeper investigation found a **real spec↔src terminology mismatch on E-MW-001**: SPEC §40 line 17005 said `csrf="on"` requires "either `<program protect="...">` or equivalent session handling," but source `ast-builder.js:10093` checked `!authConfig` (built from `<program auth=>`). Source + tests aligned on `auth=`; SPEC §40 was the outlier.

PA dispatched `scrml-deep-dive` (a0ec3cde67614fdc4) for terminology analysis. Output: `scrml-support/docs/deep-dives/protect-auth-csrf-terminology-2026-05-11.md` (664 lines, `7279e6e`).

**Bryan-driven design call (rejecting deep-dive's Approach A):** Bryan caught that the deep-dive's "ghost form" conclusion missed `<program protect=>` at SPEC line 16590 (worked example). The terminology issue was BROADER — `protect=` has 4+ valid hosts (`<db>`, `<Type>`, `<channel>`, `<program>`-as-shorthand) with related-but-different semantics. PA pulled back, Bryan said "no deep dive for now. lets just look at this practically and discuss where these attributes SHOULD live." → led to the canonical design verdict:

| Surface | Attribute |
|---|---|
| Routing surfaces (`<program>`, `<page>`, `<channel>`) | `auth=`, `csrf=` |
| Data-declaration surfaces (`<db>`, `<Type>`) | `protect=` |
| Type declarations (`<Type>`) | `authority=` |

Two retirements: `<channel protect=>` → `<channel auth=>` (WS upgrade gate is auth-shaped); `<program protect=>` shorthand retired (zero consumers in source).

**Secondary finding while implementing:** D3 csrf= drift (§40.2 said `"on"|"off"`; §52.13 said `"auto"|"off"`). Bryan asked PA to also resolve. PA initially recommended `csrf="on"|"off"` with compiler-picks-mechanism (Approach B), but on audit found `csrf="auto"` is the canonical value already used in src + tests + route-inference.ts + session-auth.test.js + sql-client-leak.test.js + attribute-registry.js + PIPELINE.md. Bryan picked Approach A: collapse to `csrf="auto"|"off"`, drop middleware-mode `csrf="on"` codepath, retire E-MW-001 entirely (the design pairing requirement was enforcing design-opinion not technical-correctness; OWASP confirms baseline double-submit cookie is independently valid).

**Landed:** SPEC.md edits + ast-builder.js + emit-server.ts (~50 LOC deleted: `_scrml_hasCsrfMW` + two inline mw-wrap CSRF check blocks) + section-assembly.js mirror + attribute-registry.js (protect= removed from program + channel sets) + types/ast.ts (`MiddlewareConfig.csrf` removed) + 7 test files (18 fixtures cleaned of dead `csrf:` field; MW-CSRF-001 deleted; MW-CSRF-002 inverted to regression assertion; `<channel protect=>` and `<program protect=>` test fixtures migrated). 14 files / +82 / -194. 10,412 pass / 0 fail at commit.

### Thread 3 — Bootstrap L3 host-compiler library-mode meta-block strip bug (`d7f9609`)

User picked "1. Bootstrap L3 host-compiler library-mode meta-block strip bug" from S80 next-priority menu after Thread 2 landed.

**Bug shape (per primer §13.5 depth-of-survey discipline):** PA read the skipped test at `compiler/tests/integration/self-compilation.test.js:531`, examined `compiler/dist/self-host/ast.js`, and found that `compiler/self-host/ast.scrml` line 33's `const _ep = await import(new URL("../src/expression-parser.ts", import.meta.url).href)` emitted as just `.href)` in the dist. The strip pass at `compiler/src/codegen/emit-library.ts:180-188` used `[^)]+` (not paren-aware) in its strip regex, which greedy-truncated `await import(complex-arg)` calls at the first `)`. The companion emit-side regexes (importRe + nsImportRe at 167+173) only match string-literal-arg `await import("X")` patterns — so the strip regex should mirror that constraint to avoid stripping complex args.

**Fix:** narrowed both strip regexes to `\(\s*["'][^"']+["']\s*\)`. Mirror fix in `compiler/self-host/cg-parts/section-assembly.js:937-944`. Regenerated dist via `scripts/rebuild-self-host-dist.ts`.

**Unblocked the L3 test partially** — `ast.js` now structurally valid; `api.js` imports cleanly. BUT exposed a broader self-host parity gap: 21 of 23 parity assertions fail when L3 runs. **Root cause of the un-skipping-side-effect:** `compiler/self-host/cg.scrml` is **structurally malformed** — its `export const runCG = ...` statements live INSIDE the `^{}` meta block, producing an empty 104-byte `cg.js`. With `cg.runCG` undefined, the L2 "Bootstrap: compiler compiles compiler" describe block had been soft-falling-back to the standard runCG. PA attempted to restructure cg.scrml (move exports outside `^{}` per the `pa.scrml` / `bs.scrml` pattern) but found it required path adjustment (`./cg-parts/` → `../../self-host/cg-parts/` because dist lands at `compiler/dist/self-host/`) AND when fixed, the actual self-host runCG produced DIFFERENT output than standard (real parity gap, not just the cg.runCG-undefined artifact).

**Disposition:** PA reverted the cg.scrml restructure attempt; re-skipped the L3 describe block with an updated reason that documents what's fixed (strip bug) and what remains (self-host parity gap is a separate, much larger project).

### Thread 4 — A5-7 canonical-sample family (`a5dea6e`, `48e0005`, `2fbb4ac`)

User picked "A5-7" from menu. Per primer §13.5 depth-of-survey discipline, PA dispatched a 1-hour inventory survey first. **Result: the 12-18h original estimate was 10x too large** — A5 features F4-F8 (hierarchy, history, internal:rule=, parallel) are SPEC-ONLY (no codegen), and existing unit/integration coverage (~249 tests) already covers compile/typer/codegen paths for the shipped surface (F1, F1a, F1b, F2, F3, F3a, F9). Sample-writing is the ONLY actual gap.

**Sub-phases (4) — all landed:**

- **A5-7a (`a5dea6e`):** `engine-005-ontimeout-basic.scrml` (literal `after=2s` form) + `engine-006-ontimeout-computed.scrml` (computed-delay `after=${@var}ms`). Both compile clean, emit canonical codegen verified via grep (`{ ms: 2000, target: "Loading" }` literal form vs `{ msExpr: function(){...}, target: "..." }` computed form).
- **A5-7b (`48e0005`):** `engine-007-cancel-timer.scrml`. Named `<onTimeout name=autoConfirm>` + `cancelTimer("autoConfirm")` via onclick call-ref. Header explicitly documents v1 limitations (call-ref form only; no expression-form or function-body calls). Codegen verified: emits `{ ms: 5000, target: "Confirmed", name: "autoConfirm" }` + `_scrml_engine_clear_named_timer("confirmPhase", "Confirming", "autoConfirm")` for the cancel call.
- **A5-7c (`2fbb4ac`):** `engine-008-onidle-watchdog.scrml`. `<onIdle after=30s to=.Locked/>` at engine-root scope; each non-Locked state's `rule=` includes `.Locked` for rule=-honoring fire. Codegen: `__scrml_engine_sessionState_idle = Object.freeze({ ms: 30000, target: "Locked" })` + `_scrml_engine_arm_idle_watchdog(...)` at module-init.
- **A5-7d (`2fbb4ac` — audit closure):** confirmed `combined-018-timer.scrml` is NOT an A5 sample (plain reactive state); `machine-002-traffic-light.scrml` uses legacy `<machine>` with immediate `.From => .To` rules (no temporal). Negative Machine Cohesion sample DROPPED — parser pipeline doesn't admit engine-inside-component shape end-to-end (existing B17 tests use synthesized AST); legacy temporal `<machine>` sample SKIPPED to avoid adding deprecated-keyword reference.

**Inventory doc:** `docs/changes/a5-7-tests-samples/INVENTORY.md` (218 lines). Captures full feature surface map (F1-F9), existing-coverage audit, gap matrix, decomposition + actual landing times (~1.5h total vs 12-18h original estimate → ~10x depth-of-survey discount).

### Thread 5 — Self-host parity catch-up (`55d41f7`) — wrap-time

Full-suite measurement during wrap (`bun run test`) surfaced 4 failures all in `compiler/tests/self-host/ast.test.js`: auth config extraction, middleware config extraction, csrf="on" parity, E-MW-002 invalid ratelimit. Root cause: `ef70daa` updated `compiler/src/ast-builder.js` to drop `mwCsrf` extraction + E-MW-001 fire-site, but the self-host scrml port `compiler/self-host/ast.scrml` was missed.

**Fix:** mirrored the TS-side delta verbatim — dropped `mwCsrf` extraction (line 3655), dropped `csrf: mwCsrf` from middlewareConfig object literal (line 3663), deleted the E-MW-001 fire-site block (lines 3666-3674). Replaced with a comment marker referencing `ef70daa`. Regenerated `compiler/dist/self-host/ast.js` (now 160974 bytes, vs prior 161245 bytes — the 271-byte delta is the deletion). Full suite went from 11,135 pass / 4 fail → 11,139 pass / 0 fail.

---

## S80 audit-thread outcomes

### D3 csrf= drift — RESOLVED

Spec section reconciliation: `csrf=` accepts `"auto" | "off"` per §52.13 (single canonical value set). §40.2 attribute table updated to match. §39.2.3 normative rewritten. §34 catalog row for E-MW-001 deleted; retirement note added to §40.6 error table.

### Un-fireable note radius — VERIFIED CLEAN

Per the deep-dive's D4 callout, PA swept §34 for the "Un-fireable note" pattern after the E-MW commit. Zero remaining instances of `"Un-fireable"` / `"no current src emit-site"` / `"audit follow-up"` / `"emit-site located"` patterns. The four E-MW rows were the entire footprint; S80 commit closed it entirely.

### Bootstrap L3 strip bug — PARTIAL FIX

Real compiler bug fixed (paren-aware regex narrowing). L3 test still skipped, reason updated to reflect remaining self-host parity gap.

---

## S80 user-voice — no new durable directives

S80 produced no new durable methodology directives that need recording in user-voice. The session was design-and-implementation-heavy under pre-ratified S77/S79 verdicts + the new S80-internal design calls (attribute-host codification). User decisions in this session were tactical:

- `install the hook` (per-machine setup)
- `1` (Phantom-code MW family pick from menu)
- `deep dive (terminology is tangled)` after PA surfaced spec↔src mismatch
- `no deep dive for now. lets just look at this practically and discuss where these attributes SHOULD live` (after Bryan caught the deep-dive's incomplete drift map)
- `codify these. I want to see them in action` → led to the worked example + recommendation
- `A` (Approach A pick: collapse `csrf=` to `"auto"|"off"` matching src reality)
- `proceed` (authorize edits + commit)
- `push it` (authorize push)
- `check on the D4 un-fireable note radius` (verification)
- `whats next on the priorities?` → `1` (Bootstrap L3 pick)
- `A5-7` (next priority pick)
- `1h inventory survey first` (A5-7 scoping)
- `2. samples, examples are for larger more integrated examples; 3. smoke too` (clarifying samples/examples target + verification level)
- `push it, then A5-7b`, `batch and go` (cadence directives)
- `wrap this session`

None are durable design directives. All tactical execution choices.

---

## Cross-machine sync state at S80 close

- **scrmlTS:** 6 commits ahead of origin/main pre-wrap-commit (ef70daa, d7f9609, a5dea6e, 48e0005, 2fbb4ac, 55d41f7, +wrap). PUSHED at wrap close.
- **scrml-support:** 1 commit ahead pre-wrap (7279e6e deep-dive doc landed mid-session). VERIFY at wrap close.

Per pa.md "wrap" §7 default (push included unless user says "wrap, no push").

---

## Next priority — menu (S80 close — carry-forward)

Awaiting user direction at S81 open. Reduced from S79's 13-item menu after S80's landings closed:
- D3 csrf= drift (CLOSED via ef70daa)
- Phantom-code middleware family / E-MW-001 (CLOSED — E-MW-001 retired; E-MW-002/005/006 had stale notes stripped)
- Bootstrap L3 strip bug (PARTIAL FIX — strip-bug closed at d7f9609; broader self-host parity gap is a separate priority)
- A5-7 tests + samples (FULLY CLOSED — 4 samples landed, audit closure on sub-phase d)

### Active remaining priorities

1. **Phase A10 deferred items** (preserved from S78/S79):
   - Payload-binding scope injection (`<Error msg>` introducing `msg` as local in body sub-scope)
   - Type-system body-walk re-enablement (gated on emission-boundary structural-element filter)

2. **Self-host parity work** — `cg.scrml` structural restructure (exports inside `^{}` meta-block produces empty dist; the L2 tests soft-pass only because `cg.runCG` is undefined) + the deeper self-host divergence (21 parity assertions fail when L2/L3 properly wired). Substantial project; pre-condition for un-skipping Bootstrap L3 cleanly.

3. **Multi-token threshold deep-read** (~1-2h) — per S78 audit caveat. Per-file deep-read of `codegen/emit-*.ts` to catch 2-4 more Bucket C threshold items (rate-limit, CSRF, CORS Max-Age) that grep can't catch (`5 * 1000`-shape arithmetic).

4. **Debounce/throttle imperative keyword-call retirement** (OQ-2, deferred from S79 dispatch). Retire `debounce(fn, ms)` / `throttle(fn, ms)` AST kinds in favor of `scrml:time.debounce` / `scrml:time.throttle` stdlib imports. ~3-5h. Should solidify the stdlib alternative first.

5. **A6-6 optional API alignment** — LSP/CG API design dive (TBD).

6. **A9 Ext 5 follow-ups** (D1/D3/D5 from S76):
   - D1 export-synth modifier propagation
   - D3 pure-fn-call detection in classifier (over-emits keys)
   - D5 Redis backend inlining

7. **Insight 28 OQ-bridge-5** — compile-time WARNING when bridged validator on schema-column field — defer to compiler-diagnostics audit pass.

8. **Insight 28 OQ-bridge-2** — passive (re-debate trigger on ≥3 adopter friction reports).

9. **W-LEAK-010 follow-up** (per memory-leak deep-dive refresh §7.2):
   - Step 2: `<program idempotency-store=>` background sweeper (CG/runtime dispatch)
   - Step 3: LC pass implementation (Stage 7.6, SCOPE-AND-DECOMPOSITION dispatch)
   - Hold for v0.3.0+ unless W-LEAK-010 spec-amendment is fast-tracked

10. **Versioning-discipline discussion** (deferred from S78) — patch-version-as-lifecycle-stage thread. Adjacent question: should `0.2.0` be re-scoped tighter? Hold for a session of its own.

11. **SPEC-INDEX.md regeneration** — per S64 audit + S78/S79/S80 amendments: SPEC-INDEX.md is stale. Generated via `bash scripts/update-spec-index.sh`. Mechanical.

12. **D3-secondary csrf= follow-ups (from S80 deep-dive)** — Open Q4 surfaced but resolved by Approach A choice. **No remaining action.**

**Articles thread (5 in-flight drafts at scrml-support/voice/articles/):** Per pa.md Rule 1, no PA-volunteered marketing work; await user-raised threads.

---

## Open questions to surface immediately at S81 open

1. **Push state — CLEAN at S80 close** (wrap push completed both repos). scrmlTS 0/0 origin; scrml-support 0/0 origin assumed at wrap. VERIFY scrml-support push state at S81 open.

2. **Hook installed on THIS machine** — verified S80 open. The OTHER machine still needs the same setup if not already done (per pa.md "Per-machine setup — pre-commit hook installation (S78)").

3. **Bootstrap L3 fix is partial** — the strip-bug is FIXED, but the L3 test stays `.skip` because the broader self-host parity gap (21 of 23 parity assertions fail when L2/L3 properly wired) is a separate, much larger project. Documented in the `describe.skip` reason at `compiler/tests/integration/self-compilation.test.js:513-538`.

4. **cg.scrml is structurally malformed** — `export const` statements inside a `^{}` meta block produce an empty dist file. The L2 self-host parity tests "pass" today only because the soft-fallback path activates when `cg.runCG` is undefined. Fixing cg.scrml structure is a precondition for un-skipping the L3 test cleanly.

5. **`<program protect=>` shorthand retired (S80) but `<db protect=>` remains canonical.** The §39 worked example was updated to drop `protect="password_hash"` from `<program>`; the per-block `<db protect=>` form is the canonical surface. Any adopter docs / examples that used the program-level shorthand need a manual fix (`bun scrml migrate` doesn't currently handle this — manual cleanup if it surfaces).

6. **`<channel protect=>` → `<channel auth=>` rename (S80).** The S80 rename is a hard break in the `<channel>` attribute set (the `protect=` attribute is dropped from `attribute-registry.js`). Any existing `<channel protect="..">` usage will now emit `W-ATTR-001` (unknown attribute) per `attribute-registry.js` closed-set semantics. PA updated 2 test sites (`channel.test.js`, `p3a-tab-channel-export-recognition.test.js`); no further adopter migration needed (zero current adopters).

7. **E-MW-001 is RETIRED** (not deprecated — gone). Any docs / articles / tests citing E-MW-001 as live should be reviewed and updated. PA scrubbed all in-tree refs at S80; cross-repo refs (scrml-support, giti, 6nz) NOT scrubbed.

8. **MW-CSRF-002 was DELETED** (not just inverted) from `middleware-handle.test.js`. A regression-assertion `MW-CSRF-RETIRED` replaces it asserting E-MW-001 no longer fires.

9. **A5-7 fully closed** for the implemented surface. F4-F8 (hierarchy, history, internal:rule=, parallel — spec-only, no codegen) are out of scope for sample coverage until A5-2/A5-3 codegen ships. Inventory at `docs/changes/a5-7-tests-samples/INVENTORY.md` documents this.

10. **Worktree branches retained from S79** (forensic per S67): `worktree-agent-ab656f3dcdd0f1638` (S79 debounce/throttle dispatch, 6 WIP commits). S80 had no dispatches (PA-direct throughout). Cleanup not priority.

11. **scrml-dev-pipeline agent not staged on THIS machine.** Per pa.md fallback, S80's deep-dive used `scrml-deep-dive` (which IS staged globally at `~/.claude/agents/`). Future compiler-source dispatches will still need to either request master to stage `scrml-dev-pipeline` (and switch machines after) OR continue using `general-purpose`.

12. **3 legacy master inbox carry-overs** (S78+S79 carry-forward, still safe-to-ignore unless sweep requested):
    - `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` (UNREAD legacy)
    - `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md`
    - `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md`

13. **Project-mapper refresh state** — last full cold-start at S79 open. S80 did not touch the project-map. At S81 open, run incremental refresh against the S80 touched files (~20 files across SPEC + src + tests + samples + dist) OR full cold-start if Phase A10 / cg.scrml-restructure surface needs to be re-inventoried.

---

## Things S81 PA must NOT screw up (S77/S78/S79 standing list + S80 additions)

S77/S78/S79 standing lists (items 1-220+) carry forward verbatim. **S80 additions:**

- **DON'T cite E-MW-001 as live.** Retired at S80. Any new doc/code referencing it should be flagged as historical-record.
- **DON'T accept `csrf="on"` in new test fixtures or samples.** Canonical value set is `"auto"|"off"` per §52.13. The attribute-registry already enforces this (emits `W-ATTR-002` on invalid values).
- **DON'T accept `<channel protect=>` in new code.** Renamed to `<channel auth=>` at S80. attribute-registry drops `protect=` from the channel allowed-set; any usage now emits `W-ATTR-001`.
- **DON'T add `<program protect=>` in new examples.** The shorthand is retired; per-block `<db protect=>` is canonical.
- **DON'T un-skip Bootstrap L3 without first fixing cg.scrml structural issue + self-host parity gap.** The strip-bug fix at S80 is necessary-but-not-sufficient. The L3 describe block stays `.skip` with the updated reason documenting both.
- **DON'T forget to mirror TS-side ast-builder.js changes into compiler/self-host/ast.scrml.** S80 missed this in the initial ef70daa commit; caught at wrap-time full-suite measurement. **Standing rule: any change touching ast-builder.js's parse / extract / fire-site logic MUST check `compiler/self-host/ast.scrml` for the parallel mirror site.** Same applies for emit-server.ts → self-host section-assembly.js (already mirrored at d7f9609 + ef70daa).
- **DO use the `bun run scripts/rebuild-self-host-dist.ts` script after editing any self-host scrml source.** dist files are gitignored but tests load from them.
- **DON'T treat the A5-7 INVENTORY's "Adjusted estimate" column as authoritative for future estimates.** The actual S80 landing was ~1.5h for the implemented-surface samples — the depth-of-survey discount kept getting LARGER as the work progressed. Real estimates should always include the audit-first phase.

---

## Tags

#session-80 #close #auth-protect-csrf-codification #e-mw-001-retired #d3-csrf-drift-resolved #bootstrap-l3-strip-bug-fixed #a5-7-samples-landed #engine-005-through-008 #self-host-parity-catchup #6-commits #0-regressions #depth-of-survey-discount-10x #pushed
