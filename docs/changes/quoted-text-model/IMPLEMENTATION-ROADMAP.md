# Quoted-Text Model — Implementation Roadmap (scope b, v0.4)

> ## ⚠️ STATUS SUPERSEDED — S111 charter-B pivot
>
> **Waves 2-7 below are PAUSED.** S111 ratified native-parser **charter B**: the
> scrml-native parser expands to replace the WHOLE compiler front-end (block-splitter
> + Acorn). The block-splitter is slated for **deletion** — so the BS-retrofit Waves
> 2-7 retrofit a doomed layer and are throwaway work.
>
> **Wave 1 (SPEC §4.18) LANDED S111 and STANDS** — it defines the quoted-text
> *language*. The native parser implements §4.18 **natively, once, cleanly** as
> first-class design. Quoted-text now ships **with the native parser**, not as a
> standalone v0.4 BS-retrofit.
>
> The wave decomposition below is **retained as input** to the native-parser charter
> deep-dive (`scrml-support/docs/deep-dives/scrml-native-parser-front-end-charter-2026-05-20.md`)
> — it is the per-compiler-layer analysis of what implementing §4.18 entails. It is no
> longer a live dispatch plan. A *minimal* interim BS fix (Wave 2 only) is an open
> question the charter dive prices.

**Status:** SUPERSEDED at S111 (charter-B pivot — see banner). Wave 1 LANDED + stands;
Waves 2-7 PAUSED. Go/no-go was CLOSED **GO** at S111 (2026-05-20).
**Investigation:** see `INVESTIGATION-PLAN.md` (sibling) — Phases 1-5 complete.
**Cost basis:** DD-3 — `scrml-support/docs/deep-dives/quoted-text-model-depth-of-fix-2026-05-20.md`.
**Target:** v0.4. DD-3 midpoint estimate ~120h (range ~79-167h).

---

## Locked design (S111 — do not relitigate)

| Decision | Resolution | Source |
|---|---|---|
| Go/no-go | **GO** | S111 user ruling |
| Scope (Q-QT-6) | **(b) code-bearing-only** — quoting required in engine state-children, match block-form arms, `:`-shorthand bodies. Plain markup (`<p>`/`<h1>`/`<li>`/`<button>`/…) stays free-text. | Phase-3 debate verdict + DD-3 pricing |
| Interpolation (Q-QT-1) | **Option A** — `${...}` inside the quoted display-text literal (syntax-quote/unquote shape). | Phase-3 debate lean |
| Quote char (Q-QT-3) | **`"` only** — apostrophe is a free character. "Both quotes" rejected as a Bug-2 regression. | Phase-3 debate, 4-0 |
| BS inversion shape (Q-QT-5) | **Option B** — block-splitter gains a code-default body mode-flag; NOT a full BS rewrite. | DD-3 |
| Whitespace (Q-QT-2) | Quoted loci are verbatim; `<p>` keeps HTML-collapse (resolved-by-coupling with scope b). | DD-2 |
| `<pre>`/`<code>` (Q-QT-4) | Keep raw-content status — do NOT relitigate S101. | DD-2 / DD-3 |
| Auto-HTML-escape (Q-DD2-A) | Codegen **auto-escapes** code-bearing-body display text. `escapeHtmlText` already exists + wired. | DD-3 |
| Migration strictness (Q-DD2-C) | **Hard cutover**, codemod-driven. ~45-file migration. No dual-path parser. | DD-3 |

**`TextNode` survives** under scope (b) — it stays the node kind for plain-markup free
text. No `TextNode` deletion, no snapshot storm. (That is the scope-(a) cost the v0.4
decision deliberately did not buy.)

---

## What scope (b) delivers (DD-3 findings — set expectations correctly)

- Retires the misclassification bug class **within code-bearing bodies** (engine / match /
  `:`-shorthand). Bugs of the Bug-2 / `?{`-leak family cannot fire there anymore.
- Deletes **~900-1200 LOC of re-tokenizer scaffolding** across the two statechild-parsers
  — this is (b)'s real benefit, NOT retired BS heuristics.
- Retires only ~0.5-1.5 of the 12 BS heuristics (the rest serve plain markup, untouched).
- Leaves ONE named residual: the "Broad-C" bare-`/` false-positive in plain-markup prose
  — low-severity, rare (one cited occurrence in ~1yr), one-char workaround. Accepted.
- Does NOT touch BPP / function-body raw-text deferral (orthogonal — see Q-DD3-D).

---

## Wave decomposition

DD-3's 11 priced work items, sequenced. SPEC-first per pa.md Rule 4. Hours are DD-3
ranges (low = existing-infra covers; high = new-infra needed).

| Wave | Work | Est | Depends on | Dispatch shape |
|---|---|---|---|---|
| **0** | **Pre-impl spike** — BS mode-flag boundary logic (Q-DD3-C). De-risk the highest-variance line item; recommend the mode-flag architecture. | (spike, ~2-4h) | — | research/diagnostic — **dispatched S111** |
| **1** | **SPEC amendment** — §4 (code-default body mode + `"..."` display-text literal grammar), §4.14 (`:`-shorthand), §18.0 (match arms), §51.0 (engine state-children), §34 (new error codes — unquoted-text-in-code-body, mode-leak). | 6-12h | Wave 0 | general-purpose / spec-rewrite |
| **2** | **block-splitter.js** — code-default body mode-flag + `"..."` literal scanner (re-home the `_inBacktick` pattern). Critical path. | 12-24h | Wave 1 | dev-pipeline, worktree |
| **3** | **tokenizer.ts** `${}`-inside-literal (5-12h) + **ast-builder.js** code-default body-builder branch (8-16h). | 13-28h | Wave 2 | dev-pipeline, worktree |
| **4** | **Re-tokenizer shrink** — `engine-statechild-parser.ts` (10-20h) + `match-statechild-parser.ts` (5-10h) + `multi-statement-scan.ts` minor (2-5h). ~900-1200 LOC deleted; semantic shim survives. | 17-35h | Wave 3 (BS must emit structured child blocks first) | dev-pipeline, worktree |
| **5** | **codegen** — new node-kind emit path in `emit-html.ts`/`emit-engine.ts`/`emit-match.ts` + Q-DD2-A auto-escape route through existing `escapeHtmlText`. | 5-12h | Wave 3 | dev-pipeline, worktree |
| **6** | **Codemod + migration** — build the codemod, migrate ~45 corpus/example/self-host files, Q-DD1-E ouroboros diff-review (strip stale defensive escapes; derive rule from SPEC not corpus). | 10-20h | Wave 5 | dev-pipeline + PA review of un-escaping diffs |
| **7** | **Tests + integration + mode-leak hardening** — engine/match unit + sample regression (no snapshot storm — `TextNode` survives) + mode-leak hardening (highest-variance: 8-20h). | 16-36h | Waves 2-6 | dev-pipeline, worktree |

**Total:** ~79-167h, midpoint ~120h. Matches DD-3.

**Parallelism:** Waves 2→3→4 are a chain (4 needs the BS emitting structured blocks).
Wave 5 can start once Wave 3 lands. Wave 6 needs Wave 5. Wave 1 (SPEC) gates everything.

---

## Open implementation questions (DD-3 surfaced — resolve before / during the relevant wave)

- **Q-DD3-C — mode-leak hardening** (Wave 0 spike + Wave 7). The BS mode-flag depends on
  the classifier functions it does NOT retire to detect body boundaries. Mode-leak
  (entering a body in the wrong mode) is a new bug shape; DD-1's S93 precedents show
  body-boundary detection is where the BS already fails. The Wave 0 spike addresses this.
- **Q-DD3-B — the 5 BS classifier functions** also resolve markup-vs-state-declaration,
  not just text-vs-code. Wave 2 scoping must confirm exactly how the mode-flag interacts
  with them.
- **Q-DD3-A** — snapshot-corpus size — **N/A for scope (b)** (`TextNode` survives; no
  snapshot regeneration). Only mattered for scope (a).
- **Q-DD3-D — BPP / function-body raw-text deferral** — orthogonal; NOT in this roadmap.
  Flagged by the user as a separate discussion ("the raw-text problem solved whole").

---

## PA operational notes

- **Maps are 18+ commits stale.** Refresh `.claude/maps/` (`/map incremental` or cold)
  BEFORE the first dev-pipeline dispatch (Wave 2).
- Compiler-source waves (2-7) dispatch via `scrml-dev-pipeline` with `isolation: "worktree"`,
  the F4 startup-verification block, and S99 path-discipline counter. Per S88 — `isolation`
  is explicit on every Agent() call.
- Wave 1 (SPEC text only) can dispatch via `general-purpose` per pa.md (no T1/T2/T3 tier
  classification needed for spec-text-only).
- Pre-commit hook is Config B; `--no-verify` needs explicit authorization.
- Decision authority: SPEC.md is normative (Rule 4). The Wave 1 SPEC amendment becomes
  the authoritative source the implementation waves verify against.

## Tags

#quoted-text-model #implementation #roadmap #v0.4 #scope-b #s111
