# scrmlTS — Session 153 (CLOSE)

**Date:** 2026-06-01 (session) · wrap completed 2026-06-02 (post-power-loss recovery)
**Previous:** `handOffs/hand-off-157.md` (= S152 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-158.md` at next session OPEN.

---

## 🏁 S153 CLOSE — `<each>`-in-dynamic-context fix sweep: 4 fixes + maps refresh, HIGH stays 0

The S152 dogfood left req2 (the engine-variation todo) mounting clean but with an empty list. S153 fixed that and swept the whole surface around it — every place an `<each>` lives inside a *dynamic* mount (engine arm / match arm / nested / component body) + the `:`-shorthand parser bug the dogfood hit. **req2 now renders end-to-end.** 4 worktree-isolated fixes + a maps refresh; HIGH stays 0; NO design ratifications (the surfaced design questions were parked for user input — see Open questions below).

**⚡ Session ended mid-wrap on POWER LOSS.** The 5 commits + 4 dispatch worktrees were recovered intact next session (branch-coherence `0/5`; all 4 worktree trees byte-identical to their landed main commits; zero uncommitted work — nothing lost). The wrap below (hand-off CLOSE + master-list §0.6 + changelog + worktree cleanup + push) was completed from that intact state.

### Sync / repo state at CLOSE
- **scrmlTS:** clean, `origin/main` **0/0** (pushed at wrap; pre-push gate = full suite + TodoMVC gauntlet passed). HEAD `e6870f25`.
- **scrml-support:** clean, 0/0 (no S153 changes — no new durable directive; the design Qs were parked, not ratified, so user-voice needs no S153 entry).
- **Worktrees:** main only (4 S153 dispatch worktrees cleaned at wrap per S83 §6b).
- **Inbox:** `handOffs/incoming/` empty. **Outbox:** none sent.
- **Tests at close:** full `bun run test` **22,586 pass / 0 fail / 220 skip / 1 todo / 873 files** (Ran 22,807; 66,411 expect). within-node canary PARSE-FAILURE 0.
- **Maps:** `.claude/maps/` refreshed `efcd5536` (S148–S152 + engine-gated-each) — now **3 commits stale** (each-in-match `3429b385`, colon-shorthand `c89c1cb1`, each-enclosing-scope `e6870f25` landed after). Refresh before the next compiler-source dispatch.
- **Version:** on top of v0.7.0 (pkg.json unchanged; no tag cut).
- **known-gaps:** HIGH 0 · MED ~12 · LOW ~20 · Nominal 7.

## ⚠️ CARRY-FORWARD / OPEN (from S152 CLOSE §0.6 + hand-off-157)

**Immediate / highest-leverage:**
1. ✅ **engine-gated-`<each>`-populate (MED) — RESOLVED S153** (`54d54d4d`). Was THREE coupled codegen modes, not the hand-off's "or": (A) emit-each.ts read the cell AFTER `if (!_mount) return;` so `_scrml_effect_static`'s one-shot dep pass (hasRun) recorded no dep when the mount was absent (non-initial arm) → fix: read `_items` first; (B) emit-variant-guard.ts + runtime: decoupled `_scrml_each_renderers` registry + `_scrml_remount_each(root)` helper the shared dispatcher calls after innerHTML+wire on every arm; (C) emit-client.ts: `detectRuntimeChunks` now descends into engine `bodyChildren` (was tree-shaking reconcile/effect chunks out → ReferenceError). NEW 9-test happy-dom canary; full suite 22,545/0; PA-independent R26 green.
1b. ✅ **each-inside-block-form-`<match>`-arm — RESOLVED S153** (`3429b385`). Started as the "#1 match-coverage follow-up test" but the empirical check found a REAL pre-existing bug (not a test gap): an `<each>` with `@.` sigil inside a `<match>` arm emitted invalid JS (`E-CODEGEN-INVALID-JS`, `.name` leak). Root: match arms are raw text (`armsRaw`); emit-match re-parsed via `nativeParseFile` → generic `markup tag="each"`, NOT an `each-block` (the each-block transform is in `buildAST`, not the native parser) → rendered inline, `@.` unscoped. Fix (emit-match.ts): each-bearing arms re-parse via `splitBlocks`+`buildAST` (gated by `/<\s*each\b/`), `restampEachBlockIds` namespaces ids, lifted each-blocks attach to `matchBlock.bodyChildren` so `collectEachBlocks` emits the render fn w/ `@.` rewrite; `__scrmlCachedArms` memoizes across the 2 passes; emit-client.ts new match-block chunk case. **FORWARD-CORRECTION:** the #1 commit's "covers block-form match" claim was aspirational (hook wired but each-in-match never compiled) — now real. R28-1b (match INSIDE each) preserved. NEW 12-test canary; full suite 22,557/0; PA R26 green. **Minor robustness note:** the each-id namespace `matchId*1e6+armHash*1e3+localIdx` (armHash = arm-tag hash mod 1000) has a vanishing theoretical collision (2 arms in one match w/ hash-colliding tags each holding an each at the same localIdx). NEW follow-up: other `nativeParseFile` re-parse sites feeding `generateHtml` (component slots / lift-guarded blocks) MAY share the each-block-transform gap if an each can appear inside them — UNAUDITED.
**PUSH HELD** for all 3 S153 commits (user "commit, hold push" on #1; subsequent fixes landed same disposition).
2. **scalar/struct zero-default open Q** — should `<x>: int` default to `0`, `<x>: string` to `""`? Shape 4 did array-only (`<x>: T[]` → `[]`); scalar/struct deliberately left OUT as a separate design call. Needs user ratification before impl.
2b. ✅ **`:`-shorthand-child-in-engine-arm — RESOLVED S153** (`c89c1cb1`). A §4.14 `:`-shorthand child element (`<span : @label>`, `<li : @.name>`) inside an engine state-child broke closer-pairing → `E-ENGINE-STATE-CHILD-MISSING` (valid at top-level; only broke in an engine arm). Root: the 3 closer-finders in engine-statechild-parser.ts push non-void lowercase openers onto `lowerDepth`; a `:`-shorthand opener has no closer → phantom unbalanced opener absorbed the state-child `</>`. Fix: attr-aware `isColonShorthandOpener` (whitespace-preceded depth-0 non-string `:`; tracks string/paren/brace/bracket/`${}` so `bind:`/`on:`/`style="x:y"`/`${a?b:c}` aren't mis-detected) wired into all 3 finders, mirroring the void/self-close exclusions. The dogfood case (`<li : @.name>` in `<each>` in engine arm) now RENDERS end-to-end. NEW 16-test suite + mutation probe; full suite 22,573/0; within-node 1005/0 no rebump. block-splitter.js was already clean (gap confined to the custom raw-text engine parser).
2c. **NEW deferred (S153, surfaced by 2b fix): `:`-shorthand on a LOWERCASE HTML element doesn't render.** `<span : @label>` now PARSES but emits empty `<span></span>` + E-DG-002 "label never consumed" — EVEN AT TOP-LEVEL (a codegen-emission gap independent of engines; the `<each>` per-item path DOES render `:`-shorthand). §4.14 line 997 ("HTML elements MAY accept `:`-shorthand where meaningful") makes whether `<span : @label>` SHOULD render a DESIGN QUESTION → needs user ruling before any fix.
2d. **NEW SPEC discrepancy (S153, Rule-4 flag): §4.14 vs §51.0.I `:`-placement for the state-child's OWN body.** §4.14 (universal) = `<tag : expr>` (`:` inside opener); §51.0.I (engine state-child) = `<Variant> : expr` (`:` after `>`). §51.0.I cross-refs §4.14 as the same form but places `:` differently; impl follows §51.0.I, so a state-child in the §4.14 form (`<Idle rule=.X : "...">`) fails to parse. **Spec-authority call pending user:** is §51.0.I canonical (carve-out §4.14's universal claim) OR should §4.14 be the one form everywhere (fix impl + §51.0.I)? NOT a mechanical fix.
2e. ✅ **`<each>` over an enclosing-scope binding — RESOLVED S153** (`e6870f25`). Two bugs found via PA probe, one root (file-scope each emission can't see enclosing scope): (A) **nested `<each>`** (documented `as` pattern) — inner each lifted to module-scope reading `group.items` (undefined) → ReferenceError; fix = inline emission in the outer factory via shared `emitEachReconcileLines` (R28-1b precedent for each-blocks). (B) **`<each>` in a component body** — `@.id` E-SCOPE-001 + `.name` leak; 3 roots in component-expander.ts (native parser doesn't promote each/match → legacy route; substituteProps missed each-block string fields; tokenized `@ . id` collapse). Anchors (each in errorBoundary / under `if=`, top-level-cell source) still work. +13 happy-dom tests; full suite 22,807/0. PA R26 green (both render).
2f. **NEW load-bearing M5-swap blocker (S153, surfaced by 2e + 1b): the native parser does NOT promote `<each>`/`<match>` to structural each-block/match-block nodes.** Bug-2e-B FIX-1 + the each-in-match fix (`3429b385`) BOTH route AROUND it via the legacy BS+TAB path. When the native parser becomes default (M5-swap), it MUST promote `<each>`/`<match>` or ALL each/match break — not just component bodies. **Dedicated PA item — this is a hard M5-swap precondition, now witnessed twice.** Deeper nesting (each³) + each-in-snippet + each-in-match-arm-in-each are adjacent untested patterns.

**Body-split / CPS debt (well-characterized by req2 dogfood):**
3. **Body-split conditional-tier (A9 Ext 3) — the remaining CPS debt.** S152 inline-`?{}` fix closed single-boundary-in-branch. STILL deferred: multi-server-batch across a branch (server-call-in-arm + server-call-after-match = the "shared reload tail") + `!{}`-handler+server-call in one arm body (both → E-CODEGEN-INVALID-JS today; workaround: one server boundary per arm, extract the rest to named fns). `cps-conditional-classifier.ts` / `cps-loop-planner.ts` still absent (Ext 3/Ext 2 unbuilt). The "compiler owns the wiring" pitch is narrower than reality inside branches — that's the debt.

**Follow-ups filed S152:**
4. **A-4 atom-emitter bare-import follow-up** — same bare-`import`-in-classic-`<script>` class as #6, gated on `emitPerRoute` (default-OFF). Blocks A-4 default-on until it registers into `_scrml_modules`.
5. **W-DEAD-FUNCTION false-positive** on fns called only from `match`-arm bodies (RI under-counts arm-body calls; cosmetic — they emit+wire). **I-FN-PROMOTABLE** mis-fires on SQL-bearing `function`s (suggests `fn` though `fn` forbids SQL). Both cosmetic lint FPs.

**Carried from S151 (untouched through S152):**
6. C1 self-demo website **inc2** (3 more flagships + live dashboard embed + KB-nav + PE-layer toggle + postMessage live-pane↔source hover + Phase-2 HTML/CSS provenance; open forks parked: engine-graph multi-file write-loop, live-pane mount, dashboard live-embed). serve-before-push per S146 (user MAY waive on strong verification — S151 precedent).
7. MCP `<program mcp>` flip (queued C1 inc2 + corpus-MCP own arc; MCP V0 is SHIPPED — 11-tool stdio server; 3 live-state tools broken = Bug 14).
8. R28-8 §14.10 bare-variant-inference impl (RATIFIED S151 — extend inference to typed object-literal fields + `is some`-narrowed `==` RHS; impl-pending; no new semantic-ambiguity class, only impl cost).
9. **predicate-fields STANDING QUESTION** (S151) — user's "cand predicate fields exept enums?" (ambiguous: except vs accept). PA grounded against §53/§55/§14/§41.15.6; the likely-open edge = **enum-SUBSET restriction via `oneOf([.A, .B])`** (spec shows `oneOf` on text cols + auto-`oneOf(all)` for enum fields but NOT an explicit enum-subset predicate example — possible genuine gap). Needs PA to confirm intended reading before any design call.
10. `print()` canon decision + `< db>` spacing (parked from R28-C1/C2).
11. srcmap offset-threading full-fix (col-precise correct provenance — the queued half from S150's honest-synthetic ratification; NEW LOW).
12. given-guard struct-field discrimination (NEW LOW, filed S151 as pre-existing).
13. engine-graph multi-file write-loop (LOW).
14. tier-2 ceiling DD (event-payload-transition primitive — S149 DD named this the highest-leverage language arc; the real case-analysis friction is at the Tier-2 ceiling, not the 0→1 step).
15. `:`-shorthand BS fragility (parser).
16. **maps refresh** (27 commits stale — see above).

## req.scrml / req2.scrml status (masterScrml/ — scratch comparison files, NOT repo content)
- **req.scrml** — USER's WIP hack (OR-arm dead-code + `listTodos` in a match-arm + `raw` undefined). Does NOT compile (E-RI-002 / E-SCOPE-001 / E-CODEGEN-INVALID-JS) — user's experimental edits, NOT compiler bugs.
- **req2.scrml** — PA's corrected full-engine baseline. **Compiles clean** (one server boundary per arm, internal reload). MOUNTS without crash (post each-init-fix). **Does NOT yet populate the list** (carry-forward #1 — engine-gated-each dep gap). So: compile-green + mount-clean + list-empty pending #1.

## pa.md directives in force (verified at open)
- Rules R1–R5 (no marketing / full-production fidelity / right-answer-beats-easy / SPEC-normative / shoot-straight).
- Working-style S147: pick the largest fully-ratified high-priority target, go autonomous, park-on-input-needed.
- `---` answer-delimiter convention (S152): tail below the last `---` = answers to PA's pending questions.
- `full wrap` / 88% safety floor (S139) available.
- Every `isolation:worktree` dispatch: S88 explicit `isolation` param · F4 startup-verification block · S99/S126 Bash-edit + no-`cd`-into-main · S136 BRIEF.md archival · S138 R26 empirical verify (HIGH codegen) · S147 branch-leak coherence check · S90 CWD gate before dispatch · maps-discipline brief block (S82).
- `--no-verify` prohibited on commit AND push without explicit auth (S88 richer-hooks setup: pre-push runs full suite + TodoMVC gauntlet).

## Open questions to surface immediately (next-session pickup)
- ✅ **PUSHED.** All 5 S153 commits + the wrap commit pushed to `origin/main` at the post-power-loss wrap (`54d54d4d` engine-gated-`<each>` · `efcd5536` maps · `3429b385` each-in-block-form-`<match>` · `c89c1cb1` `:`-shorthand-child-in-engine-arm · `e6870f25` each-over-enclosing-scope). Pre-push gate (full suite + TodoMVC gauntlet) passed. scrmlTS 0/0.
- ✅ **Worktrees cleaned (4).** All four S153 dispatch worktrees removed at wrap; `git worktree list` = main only.
- **DESIGN DECISIONS AWAITING USER (parked S153):** (a) **#2c `:`-shorthand on a lowercase HTML element** — `<span : @label>` parses but emits empty `<span></span>` + E-DG-002 (even at top-level); §4.14 line 997 ("HTML elements MAY accept `:`-shorthand where meaningful") makes whether it SHOULD render a design call. (b) **#2d §4.14 vs §51.0.I `:`-placement spec discrepancy** — §4.14 universal `<tag : expr>` vs §51.0.I engine-state-child `<Variant> : expr`; impl follows §51.0.I, so a §4.14-form state-child fails to parse. Spec-authority call: is §51.0.I a canonical carve-out, or should §4.14 be the one form everywhere (fix impl + §51.0.I)? (c) **#2 scalar/struct zero-default** — should `<x>: int` default to `0`, `<x>: string` to `""`? (Shape 4 did array-only.) (d) **#9 predicate-fields reading** — enum-subset `oneOf([.A,.B])` possible gap (S151 standing question).
- **Autonomous-ready next priorities:** **#2f native-parser each/match promotion** (hard M5-swap precondition, witnessed twice this session — larger) · **C1 self-demo website inc2** (large) · **#14 tier-2 ceiling DD** (event-payload-transition primitive — S149 named it the highest-leverage language arc) · **maps refresh** (3 commits stale).

## Tags
#session-153 #CLOSE #wrapped #pushed #each-in-dynamic-context-sweep #engine-gated-each-RESOLVED #each-in-block-match-RESOLVED #colon-shorthand-engine-arm-RESOLVED #each-enclosing-scope-RESOLVED #req2-renders-e2e #native-parser-each-match-promotion-M5-blocker #power-loss-recovered #design-Qs-parked
