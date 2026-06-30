# scrml — Session 230 (CLOSE)

**Date:** 2026-06-28 → 2026-06-29 (spanned the date change; ONE session = S230, follows S229). **Profile:** A — FULL (booted via `/boot`). A **foundational strategy session**: picked up + ratified the dpa-017 protect-leak debate, adopted `@adv`, kicked off + built the **scrml Rosetta** dictionary (v0), then ran a **V1-scoping deliberation that reframed V1 entirely** — the language/compiler split. Mechanical stream → `handOffs/delta-log.md` [211]–[222].

## 🚨 NEXT-START
Boot Profile A. Board unchanged @ close: **HIGH 0 · MED 6 · LOW 9 · Nom 7 · v0.7.1** (no code landed — pure SPEC/docs/strategy). **PUSH-PENDING** (user said "wrap", not "wrap and push"): scrml + scrml-support both have committed-but-unpushed work — say **push** to ship. The **exhaustive genome** of this session is `scrml-support/docs/deep-dives/language-compiler-split-2026-06-29.md` — READ IT FIRST next session; it is the authority for everything below.

**Two open execution threads waiting on the user:**
1. **dpa-017 → the protect-floor BUILD** is now scoped + sPA-slot-able: `docs/changes/g-sql-row-protect-leak-2026-06-28/RULING.md`. The §14.8.9 contract is ratified (Nominal/spec-ahead); the floor build (query-lowering origin descriptor + egress-serializer strip + SSR coverage) is the residual. Now ALSO a V1 security item (see below).
2. **Finish the V1-scoping** — N4/N5/N6 (quick, expected-defers) + the robustness floor (6 MED + 9 LOW + silent-footgun diagnostics) + the **build-scoping** (the conformance-suite extraction = the load-bearing D3 build).

## 🎯 Design narrative (IRREDUCIBLE — this is the session)

**THE headline: V1 = scrml-language-1.0. We split the language from the compiler.** Today "scrml" = whatever the TS compiler does (version=compiler-version, legacy-tolerance=impl-accident). The reframe makes the **language** a first-class versioned artifact = a partitioned spec (1.0 / deprecated-accepted / future) + a **conformance suite** (codes + runtime; the contract every impl answers to) + **compilers as implementations** (TS=impl#1, native/Road-B=impl#2). **This dissolves the native-cutover breaking-change** (breaking changes become deliberate language-*version* events; the native cutover = a non-event, a 2nd conformant impl) AND is the **Road-B de-risking oracle** (native is correct iff it passes the suite). Grounding: the substrate is RICHER than blank — conformance exists in seed (`conf-CODE` diagnostic + `parser-conformance` + the within-node parity canary = proto cross-impl oracle); deprecation has a W→E lifecycle seed; only the language-VERSION is net-new → "promote+label," not greenfield. **D3 RATIFIED** (codes+runtime only; text/JS-shape/AST = impl freedom). D1/D2/D4/D5 = leans. **FULL detail + ratification ledger + user-voice anchors: the deep-dive.**

**The V1-scoping map (the triage that produced the reframe):**
- **N8** (§40.9.5 server-render gating / SSR) → **V1-REQUIRED (RATIFIED).** The "perfect language for the browser" CLAIM requires true SSR — absence = a hole in the thesis (Rule 3). My prior "defer, target=auth-apps" was RETRACTED as the S66 corpus-narrowing error. Commits: the 3 SSR Step-0 rulings → V1-gating design; §58 dynamic-deployment-target rides along; v0.8's old SSR-milestone identity DISSOLVED.
- **N1** (Build Story Merkle) → **DEFER** (native-era); BUT the **`_{}` capability-declaration vocabulary → V1** (dpa-008 closing window — shipped S218 `_{}` runs ambient). Build Story REFRAMED (user) = scrml's *differentiated supply-chain answer* → the **security MODEL is V1-core** ("not great-unless-security"). Owed: a V1 security-positioning statement.
- **N2** (`import:host`) → **DEFER** (clean). **N3** (quoted-text) → parser DEFER / **discipline (E-UNQUOTED-DISPLAY-TEXT + corpus-migration) → V1** (so the native cutover is non-breaking; the N3 known-gaps entry was STALE — corrected).
- Two cross-cutting V1 criteria: **claim-requires-it** (flipped N8) + **discipline-forward/mechanism-deferred** (pending breaking change → bring the source discipline to V1, defer the mechanism).

**Two downstream threads opened + handled:**
- **PA-mitosis** — the artifact split forces a PA split (language-PA = stem [spec/conformance authority, inherits this PA's design-partner soul]; compiler-PA(s) = differentiated daughters). GUARDRAIL (lock now): the flobase migration must REPLICATE-not-MUTATE the genome (this PA's contract+methodology+memory), gated until the artifact split lands. Generalized mechanism → flogence (S228); scrml-specific shape → ours.
- **Inter-PA push-notification** — SPEC'd + routed to flogence (`flogence/handOffs/incoming/2026-06-29-1003-…`). The operator is the lossy human relay between parallel PAs; a push layer on the dropbox (urgency-gate via `needs:`, checkpoint-not-interrupt, bidirectional, blocking-flag, operator-visible) closes the loop. The nervous system for the post-mitosis world.

**Earlier in the session (committed):**
- **dpa-017 protect-leak RATIFIED** (HYBRID: B origin-keyed structural-redaction floor + A demoted DX-layer + field-level `reveal`). PA authored **SPEC §14.8.9** + minted `E-PROTECT-004`/`I-PROTECT-STRIP-001` + fixed the stale `E-ROUTE-003` cite + landed the design-insight.
- **`@adv:<thread-id>` adopted** (flogence proposal) — the authored cross-grade delta-tag; recorded in the delta-log header; co-adopt reply sent.
- **scrml Rosetta v0** — a parallel-intent dictionary/thesaurus (→ a post-trained scrml-dev training corpus). v0 schema LOCKED: neutral intent-level pivot · thesaurus many→one · impedance = 4 delta-flavors (synonym/scrml-sharper/gap?/divergence?) · shape:value|flow|struct · TWO axes (UI-frameworks antonym + Rust/TS synonym pole). `scrml-support/docs/rosetta/` (SPEC + 2 datasets). Memory `project-scrml-rosetta-dictionary`.

## 🛟 Recovered anomalies / lessons
- **Detached-HEAD recovery (clean).** The `[cockpit] save from cockpit` auto-save left HEAD detached; my first commit (delta-log residual) landed at `0108ca37` on the detached line. Caught via the coherence check (main never moved — both commits beyond it on a detached HEAD). Reattached `main` to the work via FF (`main ⊆ HEAD` verified — zero loss). **Watch:** the cockpit auto-commits with generic `[cockpit] save` messages + can leave HEAD detached — verify branch-attachment after a cockpit save.
- **Session-number drift.** I mislabeled [214]→[222] + the deep-dive "S231" after the 06-28→06-29 date change; a date change does NOT increment the session. Reconciled to S230 via sed.
- **Two stale-doc currency catches:** the N3 known-gaps entry ("spec-ahead/unbuilt" — wrong; native parser HAS body-mode + current pipeline classifies the loci); the dpa-017 §14.8.7 `E-ROUTE-003` cite (taken by S179). Both caught by grounding-before-claiming (Rule 4).

## Board @ close
**HIGH 0 · MED 6 · LOW 9 · Nom 7 · v0.7.1.** No code landed (SPEC §14.8.9 Nominal + docs/strategy). Commits this session: `0048d68d` (cockpit save — carries the §14.8.9 work) + `0108ca37` (Rosetta delta-log residual) on scrml; `4d79e01` (Rosetta v0 + dpa-017 artifact + user-voice) on scrml-support; + the wrap commit. Delta-log [211]–[222]. 0 worktrees.

## §push / cross-repo
**PUSH-PENDING** (both repos committed-not-pushed). scrml: 2-ahead + the wrap commit. scrml-support: 1-ahead + the wrap commit (deep-dive + user-voice). **Sent → flogence:** the `@adv` co-adopt reply + the inter-PA-notification spec. **Owed:** scrml-support has 3 pre-existing untracked inbox strays (not mine; left).

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · S228 flobase-routing · S219 PRIMARY-GOAL + flogence digest-boot · S227 dock · S226 landing-concurrency + inversion-op · S215 adversarial-verify · S138 R26 + reverse-direction · S147 coherence · S94 bump-on-tag · S136 BRIEF archival · S88/S99/S126 path-discipline · wrap 8-step. **NEW S230:** the language/compiler split + V1=language-1.0 reframe (deep-dive is authority); the PA-mitosis genome-preservation guardrail; `@adv` authored cross-grade delta-tag.

## Tags
#session-230 #close #v1-scoping #language-compiler-split #scrml-language-1.0 #conformance-codes-runtime #N8-SSR-V1 #pa-mitosis #inter-pa-notification #dpa-017-ratified #adv-adopted #rosetta-v0 #detached-head-recovered #push-pending
