# scrml — Session 234 (CLOSE)

**Date:** 2026-07-01 → 07-02. **Profile:** A — FULL (booted via `/boot`; full expert reads). A **big execution session** on the **KEEP DRIVING** register (~8 landings): landed the **D1/D4 contract-half of the language/compiler split** (SPEC §62/§63), **started the Road-B compiler build** (the self-host-v2 lexer, token-complete), fixed a `match` soundness family, closed the isServer ghost, and **started the SSR A-terminus** (D1 server-render landed). Mechanical stream → `handOffs/delta-log.md` [257]–[275].

## 🚀 NEXT-START
Boot Profile A. Board @close: **HIGH 0 · MED 9 · LOW 11 · Nominal 7 · v0.7.1 · all pushed (`d05cf40c`, 0/0)**. **Two owed at boot:** (1) **maps refresh** — DEFERRED at this wrap (project-mapper skipped after the ~4hr agent stall + extreme depth; maps are ~12 commits stale — run `project-mapper` incremental at boot, or note load-bearing-verify-against-source). (2) The bookkeeping is committed+pushed.
**Next priority = the SSR A-terminus arc (finish the last V1-required item):** **D2 = DOM-adoption hydration** — teach `runtime-template.js` `_scrml_reconcile_list` (~1541) to ADOPT the D1 server-rendered rows (match `data-scrml-key`) instead of rebuilding → kills the client-rebuild double-render. **D3 = retire W-AUTH-002** (`type-system.ts:8322-8343`) → closes `g-tier1-ssr-prerender` = **V1 SSR DONE**. D1 already emits the `data-scrml-key` anchors D2 needs; the design is set. (Then: D1/D4 codegen follow-on · the remaining lexer slice-4 refinements + the F4/F5/F8 typer dogfood gaps · widen the SSR render subset.)

## 🚦 STATE @ close
- **git:** scrml `origin/main == HEAD == d05cf40c`, **coherence 0/0** (everything pushed; **Road-B lexer token-complete · match-arm soundness family FIXED · SSR A-terminus Dispatch-1 [server-side markup render] LANDED**). scrml-support 0/0 (uncommitted doc edits — resolver design-insight; rides wrap). Uncommitted bookkeeping in scrml: hand-off + delta-log + known-gaps + master-list §0-banner+regen + derisk RULING pointer + 6 change-dir BRIEFs + hand-off-236 rotation → all ride the wrap.
- **SSR A-terminus arc (the last V1-required item):** **D1 (server-side markup render) DONE** `d05cf40c` — first-paint HTML contains the server-rendered redacted rows, keyed `data-scrml-key`. **D2 = DOM-adoption hydration** (`runtime-template.js` `_scrml_reconcile_list` matches the keys → kills the client-rebuild double-render). **D3 = retire W-AUTH-002** → closes `g-tier1-ssr-prerender` = V1 SSR item DONE. (Recovered D1 from the a2d20327 ~4hr S164-stall via salvage→finish.)
- **Board:** v0.7.1 · **HIGH 0 · MED 9 · LOW 11 · Nominal 7**. Full suite green at every landing (18630/0 at the match-arm fix). **The dogfood loop CLOSED once: built the lexer in scrml → found the match-arm-drop family → FIXED it (incl. the F3 silent-soundness bug + a fail-closed net) → the lexer's own F2/F6 workarounds are now droppable.**
- **In flight:** NONE (all 4 dispatches landed+pushed). **Next: slice-4 (lexer refinements) · the match-arm-drop soundness fixes (F2/F3/F6) · the parser wave (F1 decision comes due).**
- **Maps:** ~5 commits stale (owed refresh at wrap — heavy source landed). **Digest:** stale (booted off authoritative reads).

## 🎯 THE TWO DURABLE THREADS OF S234

### 1. D1/D4 — the contract-half of the language/compiler split (LANDED+PUSHED `495a041b`)
Ratified (user "your lean, go"; **Fork 1 = permanent-soft**, delegated). RULING: `docs/changes/language-version-and-deprecation-lifecycle-2026-07-01/RULING.md`.
- **§62 Language Versioning** — the `scrml-language` semver axis, distinct from the compiler (§47.5). Two-axis contract⟂impl · corpus-anchored MAJOR/MINOR/PATCH · `chunks.json` `language` field · `scrml.toml [language]` pin · `lang:` 1.0/deprecated/future vocab · the 3-part 1.0-final gate (single-impl-conformance FREEZES; impl#2/native NOT a gate) · NO editions. +2 reserved codes NAMED (`E-LANGUAGE-VERSION-TOO-NEW`/`E-LANGUAGE-COMPILER-TOO-OLD`, §34-land-with-impl).
- **§63 Deprecation Lifecycle** — SANCTIONED→SOFT→SCHEDULED→REMOVED stage machine · the well-formedness invariant (kills the "planned-for-vX" floating-schedule anti-pattern) · **permanent-soft 1.0 freeze = ZERO scheduled removals → no pending breaks by construction** · `scrml fix` verb split from DB `scrml migrate`.
- **Disposition executed:** struck the dead `in P3`/`v0.3.0` schedule labels on `<machine>`/whitespace/CPS; struck the §17.4 promotion-nudge "sunset path" sentence. Nominal/spec-ahead — **compiler wiring is the follow-on wave** (the `language`-field emit, `[language]` pre-parse read, `expected.json` schema split).
- **Owed:** the D1/D4 codegen/config follow-on (deferred; Nominal is fine for now).

### 2. Road-B compiler build STARTED — the self-host-v2 lexer (impl#2's first pieces)
User ratified the home + approach (**"1b 2 fresh"**): impl#2 lives in a **fresh `compiler/self-host-v2/`**, built as **Approach B** (pure `fn lex(src) -> Token[]` folding `step(st)` over `match (mode, event)` — no engine). The existing `native-parser/lex*.scrml` (Approach-A) is untouched as the live TS front-end.
- **Slice-1 LANDED+PUSHED `a8df839a`** — substrate + fold + core scanners (idents/keywords/numbers/operators/punct). 34/34 token-diff green vs impl#1 (`native-parser/lex.js`). Oracle adversarially-verified (genuine cross-impl differential, not circular). **8 dogfood findings F1-F8.**
- **Slice-2 LANDED+PUSHED `4c9c113b`** — strings + comments. 31/31 green; slice-1 unchanged (65/65). **ZERO new findings** — the Approach-B design compiles clean on the slice-1 workarounds (product-match with a payload-variant-in-tuple-slot WORKS, distinct from F3).
- **Slice-3 LANDED+PUSHED `8c8ef0aa`** — regex + template-interp, both fully token-diff green (nesting verified 3-level). **LEXER TOKEN-CLASSES COMPLETE** — 119/119 across the 3 self-host-v2 lexer files (idents/kw/num/ops/punct + strings/comments + regex/templates). +1 dogfood F9 (`g-string-literal-dollar-brace-interp-no-literal-escape` LOW — string `${` interp SPEC-OQ). Then **slice-4** = full typed BracketStack/ErrorRecovery threading + precise cooked-decode (refinements — NOT new token classes).
- **THE STRATEGIC FINDING (F1):** library-mode `emit-library.ts` is a shallow regex-transform that **can't lower typed-payloads + `match`** — so the reimagined compiler can't be authored as importable library modules until `emit-library.ts` routes through the real AST emitter. **PA-R26-verified.** **Lean (surfaced, user not overridden): DEFER the emit-library fix until the PARSER wave** (when the compiler first needs real cross-module imports — parser importing the lexer's `Token`/`TokenKind`). The lexer slices proceed on the `<program>`-wrap workaround.

## 🐛 Dogfood findings (5 gaps filed; detail in committed `compiler/self-host-v2/progress.md`)
- `g-library-mode-no-typed-payload-match` (F1, MED, **strategic Road-B blocker**)
- `g-match-lowering-arm-drop` (F2/F3/F6, MED — **F3 is a SILENT product-match arm-drop = soundness**)
- `g-typer-bare-variant-non-return-ambiguous` (F4, MED)
- `g-typer-hostmethod-return-asis-and-anon-struct-poison` (F5/F8, MED — F8 cross-fn poison)
- `g-ri-dead-function-match-arm-edges` (F7, LOW, benign)

## 🛟 Recovered / lessons
- **isServer double-fire = NOT-REPRODUCED (R26 reverse-direction WIN).** The S233 owed "dedup" was a ghost — an aggregate-counter illusion across a multi-compile test run; every code fires once per decl (13/13 single-visit, instrumented). No fix forced; a single-fire regression lock-in landed (`398c797d`). **S233 owed-item CLOSED as not-a-bug.** Deferred obs: `W-AUTH-001` shares its code across 2 legit fire-sites (`type-system.ts:9546` vs `route-inference.ts:4094`) — taxonomy smell, not filed.

## 🧾 Owed at wrap
- **Land+verify+push slice-3** (in flight) · then slice-4 (refinements).
- **Maps refresh** (project-mapper — heavy source landed) · **master-list §0 detailed refresh** (still v0.2.0-dashboard).
- Commit the bookkeeping (hand-off/delta-log/known-gaps/master-list-regen/derisk-pointer/BRIEFs) + push scrml-support (resolver design-insight) at wrap.
- Carried from S233: SSR A-terminus (V1-required, the big build) · D1/D4 codegen follow-on · resolver design-insight is DONE (this session).

## 🔓 Open threads for next PA
- **Slice-3 landing** (I land on completion) → then slice-4 → then the PARSER wave (where F1/emit-library becomes load-bearing — decide fix-vs-continue then).
- **F1 emit-library fix** — deferred to parser wave (lean); user may pull forward.
- The **match-arm-drop soundness bugs** (F3 silent) are real compiler bugs affecting all scrml — worth a fix arc.

## pa.md directives in force
R1–R5 · Profile A · **S234: commit `timeout:600000` (300 STALE, memory bumped); D1/D4 permanent-soft; self-host-v2 = fresh Approach-B lexer.** Carried: S233 V1=language/D5-off-gate + arch-skeleton; S226 landing-concurrency; S219 PRIMARY-GOAL; S215 adversarial-verify; S138 R26 (paid off on isServer); S147 coherence; S136 BRIEF archival; S88/S99/S126 path-discipline.

## Tags
#session-234 #in-progress #keep-driving #d1-d4-contract-half-landed #road-b-lexer-started #slices-1-2-landed #slice-3-in-flight #permanent-soft #f1-library-mode-blocker #isserver-not-reproduced #5-dogfood-gaps
