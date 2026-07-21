# scrml — Session 277 (bryan) — WRAP

**Date:** 2026-07-21. A **normative-grounding** session. Three PRs landed; the durable output is not the code — it is `pa-base v2.3`, hardened from three same-session failures of the same kind, on a project that now has live adopters. Solo.

## ⚠️ READ FIRST — state as of close
- **scrml main = `9481bc69`** (#128). Coherence **0/0** both repos. Gate GREEN.
- **scrml-support = `f0fef98`** (`pa-base v2.3`), pushed.
- Mechanical state (counts / deltas / board) lives in `handOffs/delta-log.md` **[677]-[702]** and the flogence digest — not duplicated here.

## 🎬 WHAT LANDED
| PR | SHA | what |
|---|---|---|
| **#126** | `499dd740` | outlet-collector **total-walk** + shared `landmark-tag.ts` predicate |
| **#127** | `07901878` | **`E-SCRIPT-001`** — `<script>` rejected in scrml source |
| **#128** | `9481bc69` | nested-`<program>` route-scope reset + **decl-scoped** non-bindable markup reject |

Plus **`pa-base` v2.1 → v2.3** (scrml-support, direct-push).

## 🔴 OPEN — needs bryan
1. **The Shape-1 markup question.** *Should a plain reactive cell be able to hold a markup value?* Surfaced properly, deliberately NOT bundled into the bug fix. For: L1 says markup is a value and Shape 1 is the value shape. Against: Shape 3 already covers display-only markup (no expressive gap, only ergonomic); widening is a one-way door; "limit primitives, don't god-ify." **SPEC amendment, ladder R2 minimum.**
2. **§34 `E-STYLE-001` row defect** — row says "CSS: syntax error in `#{}` style block"; the code rejects the `<style>` ELEMENT. Needs a ruling: is the row stale, or is the code double-duty with one trigger dead? Now more visible beside an accurate `E-SCRIPT-001` row.
3. **Conformance rationale prose staleness** — `conformance/cases/forms/compound-render-not-bindable/expected.json` still PASSES (code-only assertion) but its prose describes the retired use-site mechanism. Prose-only; a rationale rewrite is a judgment call.
4. **ESM-chunks arc** — ruled, unblocked, unstarted. See below.

## 🧭 THE SESSION'S REAL CONTENT — three failures of one kind

All three: **a solid reproducer of a SYMPTOM, then a fix proposed without establishing what the surrounding system MEANS.** Two recurred *after* the pattern had been analysed in-session, which is why the countermeasures are gates that leave ARTIFACTS rather than rules to remember.

1. **The markup-cell near-miss (caught by bryan, not the PA).** I reasoned from the PRIMER + a symptom to a language WIDENING, asserting "SPEC is silent" without reading §6.2 — which explicitly governs the shape and says the opposite. bryan's instinct caught it: *"was `const` = derived, bare = reactive only — does any of that line up?"* It does: `const` IS the derived marker (§6.2 Shape 3, read-only, recomputes), so "widen the Shape-3 lowering to non-`const` cells" was a category error, and my own brief's "reassignment must work" contradicted the shape it named. **Ruling given, then REVERSED on the evidence.**
2. **FIX 1 (caught by the dev agent).** I specified a bare `toLowerCase() === "main"`. `ast-builder` classifies component-vs-element by capitalization ALONE, so that maps `<MAIN>` and a user's `<Main/>` to the same string — it would have fired on a legal component and demoted its slot to zero landmarks. The agent verified by installing my predicate and watching two guard tests go red, then built the right discriminator (name resolution via NR's `resolvedKind`) as a SHARED module so the predicate exists once.
3. **FIX 2 (caught by the dev agent).** I attributed degenerate diagnostic spans to the agent's change. It is a pre-existing compiler-wide `ast-builder` gap — **PA-confirmed on the untouched base with an unrelated diagnostic**: `${@nope}` reports L2:C10 at top level but L1:C8 inside a match arm.

**Cumulative: dev agents corrected the PA 4× this session** (the three above + a non-existent `--outdir` flag in a brief). Telling agents refusal is welcome is now empirically load-bearing, not courtesy. Say it in every brief.

## 📐 DOCTRINE — `pa-base v2.3` (the durable output)

Placed in **Layer 1**, not the scrml overlay and not memory (bryan: *"they are project agnostic, so it should go in PA documentation not memory"*). All pass the §Q1 split test.

- **§0 — the empirical-sufficiency illusion.** The spine's own blind spot: every mechanism it names answers *"does the code do what we said"*; none answers *"was what we said right."* A reproducer proves a SYMPTOM and says nothing about intent — and feels sufficient exactly when it is not. Invisible from inside, because everything checked did check out.
- **§1 Rule 4 — the governing-sentence gate.** Rule 4 fails SILENTLY: not-consulting leaves no trace and looks identical to consulted-and-agreed. So the consultation must produce an ARTIFACT — quote the governing sentence, or record "searched §X/§Y, none found." **Outcome 2 is a FINDING**, converting a PA-scoped fix into a USER ruling. Triggered MECHANICALLY (would a program's acceptance or meaning change?), because "does this feel spec-implicating" is precisely the classifier that failed. A primer is NOT a governing sentence.
- **§8 — direction-of-change classification.** inert / newly-rejecting / newly-accepting / semantics-changed, computable from the real-input recompile already mandated. Newly-rejecting owes a MEASURED migration (assumed-zero ≠ measured-zero). semantics-changed is the class the gates are weakest against.
- **v2.3 — newly-accepting SPLITS.** v2.2's flat "never ship as a bug fix" was tested against real history within the hour and **over-blocked**. An audit of all 18 SPEC+src co-change landings since adopters arrived found one newly-accepting case (`bdb9b6ac`, E-MATCH-012) whose SPEC delta was ONLY a catalog line-number update and which cited pre-existing sentences making the form legal — impl#1 was wrongly REJECTING SPEC-canonical code. Under v2.2 that correct fix would have been blocked and an implementation defect frozen into the language. Now: **toward the contract** (a pre-existing sentence says it's legal → bug fix, ship it) vs **beyond the contract** (no sentence → amendment, R2+), with the §1 gate as the DECIDER. The two additions now compose.

**The audit's other result — for bryan's adopter-safety question:** no wrong-angle landing found in the dangerous class. 18 co-change landings, exactly one newly-accepting, and it is legitimate. Narrower than feared.

## 🧪 VERIFICATION NOTES (what earned its keep)
- **The non-empty R26 assertion caught a live false-green.** My first tip compile silently emitted 0 files from a bad `--cwd`; `diff` against an empty tree reports "no differences." Without the guard I would have reported a clean R26 off nothing. It then caught the SAME shape again for a dev agent (a non-existent `--outdir` flag).
- **Commit timeouts ≠ commit failure.** Two commits reported timeout and one had FINALIZED. Verify `git log` + `git show --stat`, never exit code. (The tool timeout is the one that matters — `timeout 300000` as a shell verb does nothing.)
- **Count-only test comparisons lie.** A dev agent measured the base failure set itself, found 38 vs the briefed 36, and only the SET diff showed the 2 as a gitignored-dist env artifact. A count comparison would have read as a phantom 2-test improvement.
- **An unfiltered grep is not a measurement.** A dev agent's first corpus scan returned 20 hits; re-scanning with comments and string literals blanked returned **0 across 3091 files** (parser sources carry tag names as DATA). It recorded the wrong number deliberately.

## 📌 known-gaps filed (8)
`g-subparse-span-not-rebased` (MED-HIGH — **compiler-wide**: every diagnostic inside a match arm / `<each>` body reports the wrong line; a real adopter debugging a match-heavy file is misdirected by every error in it) · `g-each-in-match-arm-absent-from-sym-ast` (MED) · `g-if-guarded-main-zero-landmarks` (MED) · `g-capitalized-unknown-tag-neither-normalized-nor-rejected` (MED) · `g-markup-rhs-nonconst-cell-dropped-to-null` (MED — **entry CORRECTED mid-session**; its first revision claimed HIGH + a Pillar-1 violation + "unspecified", all three false; kept as a worked example) · plus the block-comment cloak and the §34 `E-STYLE-001` row, recorded in the delta-log.

## 🧷 Held / retained
- **`worktree-agent-a2ed001a5de228134` @ `8fd5fd07` — RETAINED, do NOT delete.** Still the ONLY copy of Wave-1c pieces 2+3.
- `.claude/worktrees/s251` + 9 `../scrml-spa-ss*` — pre-date this session, not mine, untouched.
- 3 spent worktrees removed (dry-run listed first).

## 🚀 NEXT — the ESM-chunks arc (ruled, unblocked, unstarted)
bryan RULED **ESM chunks**, superseding the S276 IIFE-wrap ruling after a Tier-2 probe invalidated its premise: a blanket IIFE wrap severs cross-chunk linkage, because an imported type compiles to ONE shared chunk whose top-level declarations importing chunks reference BARE — the emitted chunk system uses **shared top-level lexical scope AS its linkage mechanism**.

**ESM likely collapses THREE held gaps, not one:** `g-nav-chunk-lexical-collision` (module scope, direct) · `g-nav-chunk-basename-collision-key` (the ESM registry keys on RESOLVED URL, so the `pages/reports` vs `pages/admin/reports` collision cannot occur) · `g-nav-chunk-loading-flag-race` (`await import(url)` returns a per-call promise — no shared mutable flag to race). Piece 2's boot restructure also simplifies.

**Risks for the brief:** module scripts are deferred + always strict, so boot ORDERING changes — the current emit deliberately loads the shell's `app.client.js` first "so its const declarations are in scope", which IS the shared-lexical-scope dependency and must be replaced by real imports, not preserved. `file://` cannot load module scripts and `compiler/tests/browser/ssr-a-terminus-hydration.browser.test.js` loads that way. The S276 browser-harness fidelity gap must be rebuilt for ESM regardless, so it folds into this arc.

## 📣 Non-code: the adoption question
bryan raised distribution (Rule 1's condition met). Measured: clone traffic is ~100% CI (correlates with our PR cadence; the floor collapses to ~6 uniques on quiet days; "58 unique cloners" ≈ 58 ephemeral runner VMs). The human metric is **171 views / 16 unique visitors / 14 days**, one referrer of size (`t.co`, bryan's own link), 5 stars / 2 forks. Framing offered and NOT acted on: this is ~one distribution attempt, not a rejection; the tractable target is **a second Peter**, not broad attention — one real adopter produced GITI-038/039, #81, #82, #27 and the aM findings. Left with bryan; no marketing work started.

## Tags
#session-277 #pa-base-v2.3 #governing-sentence-gate #direction-of-change #empirical-sufficiency-illusion #three-prs-126-127-128 #agents-corrected-the-pa-4x #ruling-reversed-on-spec-evidence #esm-chunks-next
