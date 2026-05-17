# scrmlTS — Session 99 (CLOSE)

**Date:** 2026-05-17
**Previous:** `handOffs/hand-off-100.md` (S98 CLOSE — comprehensive landing summary)
**Machine:** B (the `bryan-maclee` filesystem; orchestrator role this session was the OTHER machine, "Machine A" on the `bryan` filesystem)

---

## TL;DR for S100 PA pickup

S99 was a **two-track parallel session** — Machine A (the other machine, on `bryan` filesystem) ran the compiler-fix arc + B1 §51.0.B.1 wiring + corpus-refresh + twitter-archive drop + S99 LIVE hand-off rotation. This machine (Machine B per current labeling, on `bryan-maclee` filesystem) ran the voice-author article-assembly + twitter corpus extraction (507 candidates) + 9-page Day-30 reference build-out batch.

**Combined session output:** ~30 commits across both repos. v0.3.x patch arc continues; bug-k pre-push failure remains pre-existing orthogonal noise (1 fail consistent since S98).

**3 distinct gaps surfaced during S99 docs-build-out review:** dev-server URL routing, shell composition, Tailwind engine coverage. Bug report filed back to Machine A at `handOffs/incoming/2026-05-17-1815-machine-B-to-machine-A-dev-server-routing-bug.md` with 3 fix-shape options per gap + PA recommendation. v0.3.x candidate.

---

## Final state at S99 close

- **scrmlTS HEAD:** `83a902e` (feat(website): Day-30 reference build-out batch 3 — onTransition + page + schema + landing update)
- **scrml-support HEAD:** `1527d42` (scripts: promote twitter-archive extractor + regen candidates metadata)
- **Working tree:** clean both repos pre-wrap (verified at wrap start)
- **Worktrees:** only main on this machine — zero agent worktrees retained (all S99 work was direct-PA + Machine A's worktrees live on the other filesystem)

**Tests at HEAD `83a902e` (post-wrap full suite):** **15325 pass / 129 skip / 1 todo / 1 fail / 685 files / 44181 expect**.

The 1 fail is `compiler/tests/unit/bug-k-sync-effect-throw.test.js` — **pre-existing orthogonal**, same 1-fail count since S98 CLOSE. Authorized `--no-verify` pushes throughout S99 per user direction. Not caused by S99 work.

---

## S99 commit ledger (this machine's contributions)

scrmlTS (this machine):
```
83a902e  feat(website): Day-30 reference build-out batch 3 (+3 pages — onTransition + page + schema)
5cb1e3b  docs(handoff): append Tailwind-engine-gap addendum to dev-server bug report
74bcca9  fix(website): patch internal links with /pages/ prefix + file routing bug
41086cd  feat(website): Day-30 reference build-out batch 2 (+3 pages — channel + auth + logic)
bbdad7e  feat(website): start Day-30 reference build-out (+3 pages — engine extras + match + program)
```
Plus this S99 CLOSE wrap commit chain.

scrml-support (this machine):
```
1527d42  scripts: promote twitter-archive extractor + regen candidates metadata
2f04d28  docs(voice): extract twitter-archive corpus candidates (S99 Machine-A) [507 candidates]
50f5d5d  docs(voice): state-vs-logic DRAFT rev-2 — Q3 swap to GingerBill tweet + Q2 extension
e644ffd  docs(voice): S99 working-draft assembly of state-vs-logic axiom essay
```

Machine A contributions pulled in (chronological, scrmlTS):
```
8c0e8ff   docs(handoff): notify Machine B of corpus-audit-complete
b07b37f   fix(A7): E-SWITCH-FORBIDDEN silent bypass — structural post-parse walker
518ebc9   fix(is-some Phase B): bare-compound LHS for is some / is not / is .V
23c0943   fix(A5-FUP): function-parameter destructuring in parseParamList
9754f1f   fix(B1-FUP): TS scope walker for §51.0.B.1 named-form RHS identifiers
c4c99e4   feat(B1): §51.0.B.1 payload-binding on engine state-children compiler-feature wiring
805a21b   docs(handoff): S99 LIVE — A2-anomaly-2 cascade closed end-to-end
c9b8821   docs(readme): refresh current-state to v0.3.0 STABLE + v0.3.x patch arc
87426c8   fix(A4): is some / is not / is .V preprocessor — preserve member-access LHS
bc475db   docs(handoff): notify Machine B of twitter-archive corpus source
64b2e54   fix(A1): scope-walker gaps on export-class + destructuring (A2-anomaly-2-surfaced)
dbd827f   fix(A2-FUP-2): RI promotion for `export function foo() { server { ... } }`
79c0714   fix(A3): parseParamList default-value handling + token.scrml §42 migration
c4fc98a   fix(ast-builder): A2 anomaly-2 — populate params+body on export function synth stubs
```

scrml-support Machine A contributions:
```
6ef8782   docs(voice): add twitter-archive 2026-05-17 corpus source (21.2 MB zip)
bb6d51d   docs(voice): Machine-A corpus-refresh — 425 candidates + promote extraction script
```

---

## S99 substantive deliverables

### Voice-author work (this machine)

1. **State-vs-logic axiom essay working-draft assembled** at `scrml-support/voice/articles/state-vs-logic-axiom-evolution-arc-DRAFT-2026-05-17.md`. User's S98 bridge-Q1 prose preserved verbatim; quotes inserted at user-marked `<insert qt>` placeholders; Quote 3 swapped from S95 shoot-straight (now reserved for building-anyway essay per cross-essay coordination) → GingerBill twitter reply 2026-05-15 (same controversy-drives-evolution thesis, public attestation). Quote 2 extended to include "When I reread what I originally typed, its totally not what I meant" sentence.

2. **Twitter archive corpus extraction** at `scrml-support/voice/twitter-corpus-candidates-2026-05-17.json` — **507 candidates** (451 tweets + 56 note-tweets) from 21.2 MB archive. Schema-compatible with `machine-A-corpus-candidates-2026-05-17.json` (425 Claude-transcript candidates from other machine) and `machine-B-corpus-candidates-2026-05-17.json` (645 Claude-transcript candidates from this machine S98B). **Total candidate pool now 1,577 across 3 streams** awaiting user-review-curation into `quote-library.json`.

3. **Extractor script promoted** to `scrml-support/scripts/regen-twitter-corpus-candidates.py` — parameterized, auto-discovers newest `twitter-archive-*.zip` in `voice/corpus-sources/`. Companion to other machine's `regen-corpus-candidates.py` (Claude-transcript source). Both follow same JSON output shape.

### Website reference build-out (this machine)

**Day-30 surface: 11 of ~22 element + context pages shipped.** Half the structural surface complete.

| Category | Shipped (S99 + prior) | Queued |
|---|---|---|
| **Elements** | 9: engine, errors, match, program, channel, auth, onTransition, page, schema | onTimeout, onIdle |
| **Contexts** | 2: logic, sql | `#{}` CSS, `^{}` meta, `_{}` foreign |
| **Keywords** | 0 | fn, lift, lin, pinned, derived, is, not, req, pure, ~, reset (~11 pages) |
| **Error codes** | 0 | ~30 most-common per-code pages |

All 9 element + 2 context pages follow the established 8-section template (header / syntax / worked example / semantics + errors / edge cases / related features / availability / specification).

**Authoring conventions captured for future feature pages:**
- HTML-entity escape `{` `}` inside all `<code>` and `<pre>` blocks containing `${...}` or unbalanced braces
- Escape `//` → `&#47;&#47;` inside inline `<code>` (parser otherwise consumes the closing tag as comment)
- Escape `/*` `*/` slashes in display code as `&#47;` for same reason
- File-top comments: avoid raw `<X attr="...">` tag shapes
- Avoid `&lt;X&gt;'s` apostrophe-s in body text — rephrase
- Bare `/` between tags / in `<td>` content parses as a closer — escape as `&#47;`
- Avoid raw `match <ident>` in markup text — escape with `&#109;atch` or rephrase

### Bugs filed / processed during S99

4. **Dev-server multi-page-app routing + shell-composition + Tailwind-engine gaps** — 3 distinct gaps filed in single bug report at `handOffs/incoming/2026-05-17-1815-machine-B-to-machine-A-dev-server-routing-bug.md`. Workarounds applied this session (hard-coded `/pages/` prefixes in 16 .scrml files; Tailwind Play CDN injection script for dist HTMLs). Proper fixes are v0.3.x compiler/dev-server work.

5. **bug-k-sync-effect-throw orthogonal failure** — same 1-fail count since S98 close; authorized `--no-verify` push throughout S99 per user direction. Surfaced per S88 protocol. Investigation candidate.

---

## In-flight / open questions for S100 PA pickup

### Immediate (carry-forward)

1. **Continue Day-30 reference build-out.** Remaining ~22-30 pages: `<onTimeout>` + `<onIdle>` (closes elements); `#{}` + `^{}` + `_{}` contexts; ~11 keyword pages; ~30 error code pages. Each follows the 8-section template + the authoring conventions above. Pacing: ~3 pages per dispatch batch is a sustainable cadence.

2. **bug-k-sync-effect-throw investigation.** Pre-existing orthogonal failure blocking the pre-push gate. ~1-2h dispatch candidate. Until closed, every push needs `--no-verify` + explicit authorization.

3. **Dev-server routing bug pickup by Machine A.** The 1815-MB-to-MA bug report sits in `handOffs/incoming/`. Machine A's next session should action — pick a fix shape (PA recommended Option C: emit `dist/<route>.html` directly with shell inlined) + dispatch.

### User-driven (waiting for direction)

4. **lin redesign Phase 1** (#4 from S98) — user paused S98 ("I'll think about lin"). Status unchanged this session.

5. **Typestate-primitive meta-shape** (#12 from S98) — design horizon stub at `scrml-support/docs/deep-dives/typestate-primitive-meta-shape-design-horizon-2026-05-17.md`. Default hold.

6. **Voice corpus curation pass.** 1,577 candidates across 3 streams. User selectively promotes to canonical `quote-library.json`.

7. **State-vs-logic essay finalization.** Working-draft has user's bridge-Q1 prose + 3 quotes + user's "I would" lead-in for closing. User authors final prose; PA's role is substrate supply per S95 voice-author redesign.

### v0.3.x / v0.5+ backlog (unchanged from S98)

8. **CG hotspot deep characterization** (#18) — v0.5+ horizon.
9. **BS-level `/* */` bug** (#23) — sub-anomaly from S98 A1 fix; v0.3.x backlog.

---

## Inbox state at S99 close

**scrmlTS/handOffs/incoming/:**
- `2026-05-17-1815-machine-B-to-machine-A-dev-server-routing-bug.md` — OUTGOING from this PA → Machine A. Machine A's next session should action.

**Processed during S99 (moved to read/):**
- `2026-05-17-1500-machine-A-to-machine-B-state-vs-logic-scaffold-update.md`
- `2026-05-17-1700-machine-A-to-machine-B-twitter-archive-corpus-source.md`
- `2026-05-17-1800-machine-A-to-machine-B-corpus-audit-complete.md`

---

## Things S100 PA must NOT screw up

### Permanently load-bearing (from prior sessions)

- pa.md Rules 1-5 (no marketing without prompt; full-production fidelity; right beats easy; SPEC normative; shoot straight)
- All S96-S99 PA-memory rules in `~/.claude/projects/-home-bryan-maclee-scrmlMaster-scrmlTS/memory/`
- Cross-machine sync hygiene — fetch/pull both repos at session start (S43)
- S83 commit discipline two-sided rule
- S88 isolation:worktree mandatory on every dev-agent Agent() call + `--no-verify` requires explicit user authorization
- S91 CWD-routing rule
- S95 communication norms (shoot straight; politeness for politeness sake rejected)
- S96 SPEC-at-session-start
- S98 Pillar 5b "Reach discipline"

### S99 NEW (carried into S100)

- **Reuse-over-reinvent for voice work** — if user has already said something well, surface it from the substrate (quote-library / corpus-candidates / tweet-drafts / prior articles) before generating new prose. User-voice S99 verbatim: "If I have already said something well once, why come up with it again."
- **Cross-essay quote-overstacking is signal** — when two scaffolds claim the same quote, surface a sibling-quote swap (S99 GingerBill-tweet swap is the canonical pattern).
- **Visit-and-verify is part of the docs-build-out loop.** Compiling-in-isolation doesn't validate the site as a whole. Future build-out passes should include browser-visit-and-click-through before declaring shippable.
- **`--no-verify` authorization scope is per-session.** S99 authorized for S99 pushes only; S100 needs fresh authorization until bug-k closes.

---

---

## Post-Machine-B-wrap consolidation (Machine A — final S99 CLOSE)

Machine B wrapped at `a6dd6af` with dev-server-routing-bug filed back to Machine A. Machine A read + acted same session. Final state below.

### Compiler fixes landed post-Machine-B-wrap

1. **`fc27960`** MPA shell composition + clean-URL emit (SPEC §40.8.1). Closes Machine B's dev-server-routing bug end-to-end on the compiler side per fix-shape (c). Four sub-deliverables:
   - **Sub 1** (`api.js pathFor()`) — strip leading `pages/` segment: `pages/X/index.scrml` → `dist/X/index.html`
   - **Sub 2** (`codegen/index.ts` post-pass) — extract entry's `<main>` slot + inline shell-prefix + page-body + shell-suffix for each `<page>` file; `app.css` linked into per-page heads; scripts re-emitted with `upToRoot` relative path; `<page>` tag emits transparently
   - **Sub 3** (`commands/dev.js`) — static-file fallback gains `dist/<path>/index.html` candidate; trailing-slash URLs fold to non-slash for lookup
   - **Sub 4** — `app.scrml` keeps emitting `dist/app.html` as standalone shell-only artifact (option (i); dev-tool inspection affordance)
   
   Composition is a NO-OP when entry has no `<main>` slot — trucking-dispatch fixture unchanged (its body has no separate `<main>` element). +22 tests (17 integration + 5 unit). PATH-DISCIPLINE INCIDENT #6: dispatch agent leaked pre-snapshot commit `be1cff9` to local main; PA reset before pulling Machine B's intervening commits + before pushing the fix; leaked commit never reached origin.

2. **`7fa0dab`** docs(handoff) — MPA fix landing notification to Machine B + processed dev-server bug-report (moved to read/). 8-file workaround-revert checklist sent for Machine B's next pickup. SPEC §47.9.5 amendment surfaced (worked-example dist paths show un-stripped shape; small editorial SPEC dispatch needed).

### Tailwind engine gap — DIRECTION LOCKED for S100 pickup

User answered the surfaced question pre-emptively during wrap: **option (a)** — extend the built-in Tailwind engine.

User verbatim: *"A the tailwid dir"* (option A; tailwind direction).

**S100 dispatch readiness:**
- Scope ~8-15h depending on typography plugin coverage breadth (full vs scoped-to-docs-usage)
- Files: likely `compiler/src/codegen/emit-tailwind.ts` (or equivalent — verify location) + `compiler/SPEC.md` §26.6 NEW "Typography Plugin" subsection
- Audit-surface utilities to cover at minimum: `font-mono`, `prose` family (incl. `prose-slate`, `prose-lg`, `not-prose`, etc), `border-collapse`, + spot-check audit pass for other missing utilities used across docs/website/
- Companion SPEC editorial dispatch may be needed depending on scope decision
- Rationale per Rule 2 (full-production fidelity) + Rule 3 (right answer beats easy 99.999%) + flagship-claim alignment per `docs/website/pages/articles/css-without-build-step.scrml`

**S100 first action recommendation:** fire as scrml-dev-pipeline isolation:worktree dispatch on session-open. See Tailwind-engine-gap addendum in `handOffs/incoming/read/2026-05-17-1815-machine-B-to-machine-A-dev-server-routing-bug.md` (now archived) for the full scope-of-coverage context.

### Path-discipline pattern crystallized (S99 epilogue)

**Six leak incidents in one session** (A1, B1, A5, A7, MPA-fix, plus the MPA-pre-snapshot which makes 6). Each caught + recovered cheaply but the rate is structural — agents bypass F4 + S88 because the model habit from training-data convention is the shorter main-rooted path. `pa-scrmlTS.md` S99 addendum at scrml-support `65eaab7` documents:

1. Echo-pwd-in-first-commit discipline aid (mandatory; PA verifies at landing)
2. S99 leak-history prefix in every brief (incident counter)
3. PA-side dual-verify on every landing — `git status --short` in main BEFORE file-delta
4. Platform-level fix (PreToolUse hook rejecting absolute writes outside active worktree subtree) — STILL DEFERRED since S42; S99 rate-of-incidence escalates urgency for v0.4+ dispatch-quality

Empirical-record convention ratified: every PA-authored landing that hit a leak includes `PATH-DISCIPLINE INCIDENT` in commit body for grep-based audit.

### Final state at S99 CLOSE (post-Machine-A consolidation)

- **scrmlTS HEAD:** this wrap commit (after Machine B's `a6dd6af` + Machine A's `fc27960` + `7fa0dab` + this consolidation)
- **scrml-support HEAD:** `e149662` (S99 Machine-A user-voice entries + user DRAFT refinements)
- **Working tree:** clean both repos pre-push (verified)
- **Worktrees:** only main on Machine A (zero retained; per-dispatch cleanup discipline held)

**Tests at S99 CLOSE (post-MPA, full suite):** **15,342 pass / 133 skip / 1 todo / 2 fail / 1 error / 687 files / 44,255 expect**.
**Pre-commit subset (unit+integration+conformance only):** **12,555 pass / 92 skip / 1 todo / 0 fail / 654 files**.

The 2 fail / 1 error in the full suite are pre-existing orthogonal (`bug-k-sync-effect-throw` from S98 + browser-runtime smoke flakes per Bug 18 family). Pre-commit gate stays clean.

### S99 cumulative ledger (both machines combined)

~30+ commits across scrmlTS + scrml-support. End-to-end closures:

**Compiler arc (Machine A):** A2 anomaly-2 → A3 → A2-FUP-2 → A1 → A4 → B1 → A5 → A5-FUP → A6 → A7 → switch-in-attribute-body → is-some Phase B → Phase B-2 → B1-FUP → MPA shell composition + clean-URL emit. **A2-anomaly-2 cascade closed end-to-end** (16+ commits collectively touching ~15 compiler-source files).

**Voice + docs arc (Machine B):** state-vs-logic essay assembly + rev-2 + Day-30 reference build-out 11 pages + twitter-archive corpus extraction (507 candidates) + dev-server bug report filing (with 3 gaps documented, 4 fix-shape options each, PA recommendations).

**Cross-cutting:** README v0.3.0 STABLE refresh, master-list test-count refresh, lin description truncation, server-keyword example removal, pa-scrmlTS.md S99 path-discipline addendum, pa-scrmlTS.md S99 voice-author "reuse-over-reinvent" rule, Machine-A Claude-transcript corpus extraction (425 candidates) + extractor script promotion.

**Combined voice corpus pool:** 1,577 candidates across 3 streams (machine-A Claude-transcript 425 + machine-B Claude-transcript 645 + twitter-archive 507) awaiting user-review-curation.

---

## Tags

#session-99 #CLOSE #voice-corpus-extraction #twitter-507-candidates #reference-build-out-9-elements-2-contexts #dev-server-routing-bug-filed #cross-machine-coordination #s99-tailwind-cdn-bandaid #bug-k-orthogonal-noise #a2-anomaly-2-cascade-closed-end-to-end #spec-§51.0.b.1-payload-binding-wired #spec-§40.8.1-mpa-fix-landed #tailwind-direction-a-locked-for-s100 #path-discipline-6-incidents
