# scrmlTS — Session 111 (CLOSE)

**Date:** 2026-05-20
**Previous:** `handOffs/hand-off-113.md` (S110 CLOSE — rotated at S111 OPEN)
**Machine:** single-machine (S100 directive holds)
**HEAD at S111 OPEN:** `60e3549` (S110 wrap)
**HEAD at S111 CLOSE:** `<wrap-sha>` (the S111 wrap commit)
**Origin sync at CLOSE:** pushed — scrmlTS + scrml-support pushed to origin (user-authorized "push when done").

---

## S111 net outcome — a design-direction session that pivoted the whole front-end

S111 changed **zero `compiler/src/`** lines. Test baseline is identical to S110:
full `bun test` **16,213 / 0 fail**; pre-commit subset **13,362 / 0 fail**. But it was one
of the heaviest *decision* sessions in the project's history. Two ratified decisions:

1. **The quoted-text model — investigation closed GO (scope b).** Phase-3 4-expert debate
   + `debate-judge` + DD-3 depth-of-fix → GO. **SPEC Wave 1 LANDED** — new §4.18
   "Code-default body mode and the display-text literal" (`d0b75a8`, +252 lines).

2. **Native-parser CHARTER B.** The scrml-native parser's charter expanded from "replace
   Acorn" to "replace the WHOLE compiler front-end" (block-splitter + Acorn) with one
   composed-engines parser. The heuristic block-splitter gets DELETED. **This pivot
   reordered everything below it** — it is THE load-bearing S111 outcome.

`compiler/`-tree artifacts landed S111: SPEC §4.18 (Wave 1) + the §4.18.1/§40.8 reconcile
(R3). Everything else this session is deep-dives, debates, decisions, and dispatches.

---

## THREAD 1 (primary — the multi-quarter arc S112+ opens) — native-parser charter B

**What it is.** The scrml-native parser (S98 design — composed-engines, replacing Acorn)
expands to replace the **entire compiler front-end**: the block-splitter (markup/block
layer) AND Acorn (JS layer), with ONE composed-engines scrml-native parser. The heuristic
block-splitter — 12 text-vs-code heuristics, 4 raw-text deferrals, 3 hand-rolled
re-tokenizers, BPP "Stage 3.5" — gets **DELETED**, not retrofitted.

**Why.** The quoted-text investigation named "the block-splitter heuristically guessing
text-vs-code" as a root disease. Charter B is the deepest fix — delete the BS, replace it
with a real parser. The quoted-text model (§4.18) makes the language unambiguous; the
native parser implements that unambiguous language with zero heuristics.

**Authority docs (read first, S112):**
- `scrml-support/docs/deep-dives/scrml-native-parser-front-end-charter-2026-05-20.md` —
  the charter-expansion deep-dive (1446L). THE master plan. Architecture, M-ladder,
  estimate, heuristic-elimination proof, the v0.4 question, risks.
- `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` — S98 DD (the
  foundation: D1 charter, D2 JS-layer engine graph, D7 milestones).
- `compiler/native-parser/README.md` + source — M1 (lexer) AS BUILT.
- `docs/changes/native-parser-front-end/SPIKE-markup-js-seam-2026-05-20.md` — R1 seam
  spike (landed S111 wrap).

**Charter-dive findings (verified by PA):**
- **Cost:** ~239-518h, midpoint **~380h** (~10-14 focused sessions, multi-quarter).
- **Economics:** near-break-even vs "JS-layer plan + quoted-text BS-retrofit" (~+15h net)
  because charter B makes the ~120h BS-retrofit redundant — "economically dominant."
- **Architecture: separate-graph** — a markup engine-graph (`BlockContext`, `BodyMode`,
  `TagFrame`, `DisplayTextLiteral`) ABOVE the M1-complete JS-layer graph, delegating JS
  bodies down via §51.0.Q.1. Prior-art-unanimous. No debate needed.
- All 12 BS heuristics + BPP + the raw-text deferrals eliminated **by construction**; the
  "Broad-C" misclassification bug categorically fixed (closes Q-DD3-D — the raw-text
  problem solved whole).
- No hard technical blocker. M1 proves the composed-engines pattern ships.

**Current native-parser state:** M1 (composed-engines lexer) **COMPLETE** — M1.1-M1.4
shipped S99-S103 (LexMode/BracketStack/ErrorRecovery engines, all 7 LexMode state-children
substantive, ~97 conformance). Code at `compiler/native-parser/` (.scrml + .js shadows —
ANOMALY-2 workaround; charter B / §4.18 fixes the ANOMALY-1/2 root cause, native parser
self-hosts its source at M6).

**The M-ladder (from the charter dive Q4.A):** M1 done · M2 (JS expression parser) ·
M3 (statement parser, subsumes BPP) · M4 (full bounded JS subset) · MK1 (markup
`BlockContext` engine) · MK2 (`TagFrame` + tag tree) · MK3 (`BodyMode` +
`DisplayTextLiteral` + §4.18) · MK4 (markup↔JS seam + re-tokenizer deletion) ·
M5 (pipeline swap behind `--parser=scrml-native`) · M6 (joint BS+Acorn retirement).

**R1 seam spike — landed, de-risked.** The markup↔JS seam (the dive's highest-risk area):
in-place single-buffer mutually-recursive delegation, a generalization of M1's
template-interpolation mechanism; **§51.0.Q.1 is sufficient — no language-primitive gap,
no sub-deep-dive needed**; MK4 tightened to ~27-46h (~34-36h midpoint). Spike doc:
`docs/changes/native-parser-front-end/SPIKE-markup-js-seam-2026-05-20.md`.

**S112 NEXT ACTION on this thread.** The native-parser implementation arc opens. M2 (JS
expression parser) and MK1 (markup `BlockContext` engine) parallelize and are the first
milestones. **They need per-milestone decomposition first** — each M-milestone is
~20-70h and decomposes into sub-steps (as M1 → M1.1-M1.4 did). The right S112 first move
is a native-parser **implementation roadmap** (extract the dive's M-ladder into a
trackable per-milestone decomposition — the analog of what the quoted-text
IMPLEMENTATION-ROADMAP was), then dispatch M2.1 / MK1.1. Compiler-source dispatches go via
`scrml-js-codegen-engineer`, `isolation: "worktree"`, F4 block.

**Open implementation questions (charter dive — for the MK-milestone briefs):**
- OQ-2/R3 — CLOSED this session (R3 landed the §4.18.1/§40.8 reconcile).
- Q9 R5 — deep §51.0.Q.1 nesting (4-5 levels) wants an early smoke test (MK1/MK2).
- The MK-milestones must build on a shared-`ctx`/one-cursor substrate so MK4 inherits it
  (R1 spike §6 punch-list — fold into the MK1/MK2/MK3 briefs).

---

## THREAD 2 — quoted-text model (folded into the native parser)

Investigation CLOSED GO at scope (b). **Wave 1 (SPEC §4.18) LANDED** (`d0b75a8`): new
§4.18 — code-default body mode + display-text literal; `"`-only; interpolation inside the
literal; codegen auto-escape; `E-UNQUOTED-DISPLAY-TEXT` (§34). **R3 reconcile landed**
(`78faa65`): §4.18.1 had wrongly classed `<program>`/`<page>` bodies as free-text;
`default-logic` (§40.8) ratified as a distinct third body-mode; §4.18.1/§40.8/§3.4/§4.15
reconciled (+3 SPEC lines).

**Waves 2-7 CANCELLED.** The BS-retrofit (`docs/changes/quoted-text-model/IMPLEMENTATION-ROADMAP.md`,
carries a SUPERSEDED banner) retrofitted a block-splitter charter B deletes. Quoted-text
now ships **with the native parser** — the native parser implements §4.18 natively at
**MK3**. SPEC §4.18 is the language definition the native parser targets.

**The investigation tracker** `docs/changes/quoted-text-model/INVESTIGATION-PLAN.md` is
CLOSED (Phases 1-5 done). DD-1/DD-2/DD-3 in `scrml-support/docs/deep-dives/`.

---

## THE v0.4 PICTURE (charter dive OQ-1)

Quoted-text — the would-be v0.4 headline — moved onto the multi-quarter native-parser
arc. **Charter B is v0.5+, NOT v0.4.** So **v0.4 = a release-cut of accumulated
post-v0.3.0 work**: L22 family (formFor S102-103, schemaFor S104), §26 Tailwind
arbitrary-values + typography (S100/S108-109), the S107-110 bug-fix arc (Bug 1 ring /
Bug 2 / Bug 4 / match block-form Phase 5), native-parser M1, SPEC §4.18 (spec-ahead).
A v0.4 release-cut (pick landings, `package.json` bump, tag) is a **queued, unscheduled
discrete task** — S112+ may schedule it.

---

## DEFERRED — README "coming soon v0.4" announcement

The user proposed (S111) a "coming soon v0.4" brief in/near the README current-state
section. PA pushed back: "this" (the whole-front-end native parser) is NOT v0.4 — it is
the multi-quarter arc; and v0.4's contents weren't yet defined. **Disposition: deferred,
manifest-first.** When v0.4's release-cut is settled, the README announcement can be
drafted accurately — announce the *real* v0.4 contents (the post-v0.3.0 accumulation),
and treat the native-parser direction as a separate **version-unpinned** "where scrml is
heading" teaser (no version number, no "soon" — per the S102 misleading-README lesson).
Needs: a README read + a draft. NOT done S111.

---

## PARKED DESIGN IDEAS (S111 — floated by the user, undecided)

- **`behave=` attribute on `<program>`** — a project-level tier-ladder ratchet:
  `behave="bin"` (default, Tier-0 prototype, nudges only) → `"match"` (Tier 1 enforced)
  → `"engine"` (Tier 2 enforced). PA framing: a project-level lint-severity preset
  escalating existing tier-ladder diagnostics (`I-MATCH-PROMOTABLE`,
  `W-MATCH-TRANSITIONS-ACCRUING`) to errors — cheap, no new machinery. Open: per-level
  semantics (`"engine"` ≠ "every enum is an engine" — value-return matches exempt);
  granularity (whole-program vs per-file); `"engine"` depends on the unbuilt
  `W-MATCH-TRANSITIONS-ACCRUING`. Orthogonal to the native parser — a small
  spec-deliberation when advanced.
- **"markup" context/block → "state" context/block** — the `<>`-delimited context is
  paradigmatically the *state* context (Pillar 2; the state half of the state/logic
  duality); "markup" is HTML-vestigial naming. Sub-choice: "state" vs "structural".
  **Best folded into the native-parser §3/§4 SPEC rework** (charter B reworks §3/§4) —
  do NOT do a standalone terminology migration. Linked to the native-parser track.

---

## PARKED — content idea (S111; Rule 1 — marketing, not load-bearing PA work)

- **Article: "JS tools weren't the right fit for scrml"** — floated by the user S111;
  long-form companion to the S111 X-post draft (`scrmlMaster/quotesWhoops.txt`) — same
  thread (scrml shedding its borrowed skin). Strong thesis = the *paradigm mismatch*:
  scrml is a state-machine language whose compiler front-end was built with
  non-state-machine tooling (Acorn + the heuristic block-splitter); charter B rebuilds
  the front-end in scrml's own paradigm (composed engines — the parser dogfoods the
  language). Best as a true retrospective once the native parser lands (M5/M6); written
  now it is a forward-looking design-rationale piece. Surfaces when the user raises it.

## PARKED — proposed S112+ deep-dive: incremental scrml-native compiler components

User floated (S111): the v1.0 full self-host (the whole compiler hand-built in scrml,
from scratch) stays V1 territory — but that does NOT preclude looking at which compiler
stages *beyond the front-end parser* would benefit from being scrml-native, built
incrementally as v0.x minor-version components ("self-host testing"). The native parser
(charter B) IS the first such component. Proposed: a DD next session to scope the
broader program.

**DD framing (so S112 dispatches it well) — three things must NOT be conflated:**
(A) the v1.0 full from-scratch hand-built self-host (post-v1.0; user-reaffirmed S111);
(B) the charter-B native parser — a scrml-native COMPONENT shipped in the v0.x pipeline,
flag-gated + conformance-gated (NOT "self-host" in the v1.0 sense); (C) the OLD
`compiler/self-host/*.scrml` arc — line-by-line JS→scrml translation, the **anti-pattern**
the native-parser D1 charter explicitly rejects. The user's idea = extend pattern (B).
The DD must carry: (1) per-stage state-vs-calculation analysis (Pillar 5b — the parser
benefits from composed-engines because lexing/parsing IS a state machine; TS/DG/CG may
be more calculation-shaped); (2) the anti-pattern guard — each component a genuine
scrml-native redesign, NOT a JS port; (3) the (B)↔(A) relationship — are the incremental
v0.x components v1.0's self-host built early, or proving-scaffold v1.0 redoes? (likely
the former — the DD pins it); (4) sequencing — charter B should be underway before
committing more; the DD scopes, does not pre-commit. Not urgent; charter B is the live work.

## CARRY-FORWARDS (pre-existing — untouched S111)

- **§29 vanilla-interop decision** — retire vs implement the spec's "plain JS/HTML/CSS
  pass through" clause. Undecided since S110. master-list §0.6. (Note: charter B's §3/§4
  rework may be the natural place to settle §29 too.)
- **Bare-variant inference nested-positions fix** — SCOPED-ready, ~3-4h
  (`docs/changes/bare-variant-inference-nested/SCOPING.md`).
- **PRIMER match-block section** — match block-form has no PRIMER walkthrough.
- **Bug 1 ring-offset + gradient** — blocked on preflight CSS emission infra.
- **tableFor v1.next** (5 items) · **formFor v1.next B2-B4** · **variantNames** (next L22
  family member — full 4-gate walk).
- **Self-host bootstrap broken-import** — S102 carry; unaddressed S103-S111.

---

## State-as-of-CLOSE

| Item | Status |
|---|---|
| Compiler `src/` changes S111 | NONE |
| `compiler/`-tree artifacts S111 | SPEC §4.18 (Wave 1, +252L) + R3 §4.18.1/§40.8 reconcile (+3L) |
| Tests | full **16,213 / 169 skip / 1 todo / 0 fail / 47,333 expect / 728 files** — identical to S110, 0 regressions |
| Worktrees | main only (Wave 1 + R3 worktrees cleaned in the S111 wrap) |
| scrmlTS origin sync | pushed through the S111 wrap commit |
| scrml-support origin sync | pushed through `53a1f5e` |
| Inbox `handOffs/incoming/` | empty |
| Hook gate | Configuration B (pre-commit + post-commit + pre-push) |
| pkg.json version | 0.3.3 (unchanged) |
| Maps | **REFRESHED S111** (scratch `/map` cold run — 9 maps + non-compliance report; 4 stale map files removed) — watermark `78faa65` |
| `.claude/agents/` | gitignored; holds elm/jsx/clojure-expert (quoted-text debate roster — debate done; retain) |

## Open questions to surface at S112 OPEN

1. **Native-parser implementation arc** — top S112 priority. Decompose M2 + MK1 into a
   per-milestone implementation roadmap, then dispatch. Maps are fresh (refreshed S111).
2. **v0.4 release-cut** — queued, unscheduled. Schedule it? (Gates the README announcement.)
3. **§29 vanilla-interop** — retire vs implement — still undecided.
4. **`docs/changes/` regrowth** — the S111 scratch map run flagged `docs/changes/`
   regrew to 88 working dirs (recurring — flagged at S61 + S79 too). The non-compliance
   report (`.claude/maps/non-compliance.report.md`) enumerates deref candidates. Hygiene
   carry-forward: deref SHIPPED change-dirs to `scrml-support/archive/changes/` per
   `docs/curation/2026-05-05-changes-dir-disposition.md`. Keep the 4 in-flight arcs live.

## Things S112 PA must NOT screw up

- **R3's resolution: `default-logic` is a THIRD body-mode** (free-text / code-default /
  default-logic) — the native-parser markup layer (MK1-MK3) must honor all three.
- The charter dive is the master plan — read it before dispatching M2/MK1. Don't
  re-litigate the separate-graph architecture (settled, prior-art-unanimous).
- Quoted-text Waves 2-7 are CANCELLED — do NOT dispatch BS-retrofit work. §4.18 ships via
  the native parser (MK3).
- Maps were refreshed S111 — but verify the watermark before any S112 dev dispatch.
- Compiler-source dispatches: `isolation: "worktree"` explicit, F4 block, S99
  path-discipline.

## Session-start checklist for S112 PA

1. Read `pa.md` pointer → `../scrml-support/pa-scrmlTS.md` IN FULL.
2. Read `docs/PA-SCRML-PRIMER.md` IN FULL.
3. Read `compiler/SPEC-INDEX.md` IN FULL — note §4.18 (S111 — quoted-text model) + the
   R3 §4.18.1/§40.8 reconcile.
4. Read `master-list.md` §0 IN FULL — note the S111 charter-B prologue update + §0.6 entry.
5. Read this `hand-off.md` (S111 CLOSE) — rotate to `handOffs/hand-off-114.md` at S112 OPEN.
6. Read last ~10 contentful user-voice entries — S111 added two entries (quoted-text GO;
   native-parser charter B).
7. Sync hygiene: `git fetch` — if S111's wrap wasn't pushed, surface it.
8. Inbox check; verify worktrees (main only expected).
9. **Read the charter-expansion deep-dive** (`scrml-support/docs/deep-dives/scrml-native-parser-front-end-charter-2026-05-20.md`)
   + the R1 seam spike — the native-parser arc's master plan.
10. Report: caught up + next priority (= the native-parser implementation roadmap → M2/MK1).

## S111 commit ledger

| Commit | Repo | What |
|---|---|---|
| `84954a2` | scrmlTS | quoted-text investigation closed GO + IMPLEMENTATION-ROADMAP + Wave-0 spike |
| `d0b75a8` | scrmlTS | quoted-text Wave 1 — SPEC §4.18 amendment (file-delta land) |
| `e85210c` | scrml-support | quoted-text DD-3 + S111 user-voice (GO entry) |
| `78faa65` | scrmlTS | R3 — §4.18.1/§40.8 body-mode reconcile (file-delta land from worktree-agent-a9bcf82991f8a1758) |
| `<wrap-sha>` | scrmlTS | S111 wrap — R1 seam spike doc + master-list + changelog + hand-off + roadmap banner + scratch map refresh |
| `53a1f5e` | scrml-support | native-parser charter-B deep-dive + S111 user-voice (charter-B entry) |

## Tags

#session-111 #CLOSE #native-parser #charter-B #whole-front-end #quoted-text #§4.18
#design-direction-session #zero-compiler-code #multi-quarter-arc #push-pending
