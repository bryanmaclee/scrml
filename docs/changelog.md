# scrml — Recent Fixes & Work In Flight

A rolling log of what just landed and what's actively underway in the compiler. For the full spec and pipeline docs see `compiler/SPEC.md` and `compiler/PIPELINE.md`.

Current baseline (2026-05-04 after S55 close): **8,576 tests passing / 40 skipped / 0 failing** (~29,789 expects across 426 files) — **UNCHANGED from S53 close**. Zero compiler/code changes this session — S55 was a pure deliberation session that closed the v0.next architectural design arc.

Previous baseline (2026-05-03 after S53 close): **8,576 tests passing / 40 skipped / 0 failing** (~29,789 expects across 426 files). Eleven dispatches landed in S53 (4 architectural fixes + 4 mechanical paperwork + DOC-E-RENAME + P4 CLI + AST-SHAPE-RENAME); **+85 tests vs S52 close, 0 regressions across all 11 dispatches**. F-ENGINE-001 RESOLVED + F-CHANNEL-003 FULLY RESOLVED + NR AUTHORITATIVE + state-type-routing.ts disposed + engine rename arc COMPLETE (keyword + TAB type-decl synthesis + internal vars + SPEC worked examples + error codes + user-facing docs + AST shape) + `scrml migrate` CLI shipped (Migrations 1+2). 44 commits past S52 close, all pushed. S51 was the systemic silent-failure sweep session: 12 dispatches (2 deep-dives + 10 fix dispatches) shipped in a single day, closing 9 P0s + many P1/P2s. Net +184 tests, 0 regressions across all dispatch waves. The validation principle (S49) is now mechanically realized for M1/M3/M4/M5/M6/M11 mechanisms; UVB (Unified Validation Bundle) closed 4 silent-failure mechanisms in one focused dispatch.

**Backfill note:** S40, S41, S42 entries are missing from this log — captured in hand-offs + git log. S43 + S44 + S45 + S46 + S47 + S48 + S49 entries below; full backfill is open content todo.

---

## Recently Landed

### 2026-05-04 (S55 CLOSED — **PIVOTAL session, massive wrap, deliberation arc complete**; 0 tests, 0 compiler changes, but the v0.next language design is locked)

S55 opened by recovering from an S54 interrupt (the v0.next deliberation pipeline had completed Phase 0 synthesis + Phase 1+2 dives DD5-DD10 + Phase 3 DD5 debate, then crashed). User authorized a mode shift away from the dive/debate cadence in favor of direct PA-user discussion of the open-questions list surfaced by the v0.next-Mario design artifact. The session ran one sustained discussion thread; **21 architectural moves were locked**, the **north star ("UI as a fully-handled state machine") was articulated**, and at session end the **migration design surface dissolved entirely** when the user clarified there are no production scrml adopters (all current code is throwaway experimental).

**Architectural moves catalog at S55 close (21 total):** Moves 1-6 + 8 from S54 synthesis; Moves 9-20 added/refined in S55. Move 7 (multi-close `<///>`) DROPPED — handled by 6nz editor auto-expansion (cross-repo message dropped). Move 21 (two-phase migration) DROPPED — no users to migrate.

**Decisions locked S55 (verbatim user inputs preserved in `scrml-support/user-voice-scrmlTS.md` Session 55):**

- **Move 9 (no debate):** bare-variant `marioState = .Small` parses as qualified when LHS/parameter type known. TS-shape inference.
- **Move 10:** positional binding `<state a b c> = (1,2,3)` legal only when state's shape is fixed by predefined enum/match/engine type. Compiler-gated.
- **V5-strict (Move 3 revised):** `@` is canonical, NOT sugar. Bare names in expressions are LOCALS only. Two-form access (`<v>` structural + `@v` canonical). C9 rescinded — `@` is not JS-framework concession; framework precedent was correct.
- **Move 11:** scoped hoisting (Position D) + lint warning on out-of-order use + `pinned` per-declaration opt-out keyword (upgrades lint to error). TDZ-1 model — no user-visible TDZ window.
- **Move 7 DROPPED:** multi-close shorthand → 6nz editor auto-expansion. General principle: ergonomic shortcuts that fail readability test belong in editor, not grammar.
- **Move 12:** engine validates direct writes via `rule=` contract. `@marioState = .Big` silent-validated; throws on invalid; compile-time check inside state-child bodies.
- **Move 13:** `.advance(.X)` explicit-throws variant for assert-must-work transitions. `.tryAdvance` (silent no-op) explicitly rejected — silent failures hide bugs.
- **Move 14:** `effect=` attribute (single-target one-shot) + `<onTransition to/from once if=...>` structural element (multi-target / attribute-bearing). On-leave default semantics. Lifecycle elements `<onEnter>`/`<onLeave>` skipped — covered by `<onTransition from/to>`.
- **State-children-as-sugar refinement:** `<Small rule=...>{body}</>` is sugar over `if=(@engineVar == .ThisVariant)` + rule= contract. Bodies optional. Mixed engines (some bodied, some bare) legal.
- **Snippets handle shared chrome** — no `<chrome>` template, no `<*>` matcher. Existing language mechanism suffices.
- **Move 15:** `:`-shorthand for single-expression body when no `</>` closer present. `<tag attrs> : expr`. Bare body otherwise (canonical HTML semantics preserved). Mandatory whitespace around `:`.
- **`W-LIFECYCLE-CANDIDATE` lint (opt-out):** boolean state in 3+ structural `if=` sites flags as enum-engine-promotion candidate. Lifecycle-as-engine is the design pattern. Connection to "exhaustively provable" goal — booleans defeat the prover; enum-engines enable it.
- **Move 16:** auto-derived var name = lowercase-first-run of `for=` type. `var=` attribute for override / disambiguation.
- **Move 17:** `initial=` attribute required on non-derived engines (lint warns if omitted, defaults to first state-child). Forbidden on derived engines.
- **Move 18:** engine `<EngineName/>` use-site lives only for cross-file mount; same-file decl-IS-mount; multi-instance marinates.
- **Move 19:** channel shape under v0.next: file-level (NOT inside `<program>`); drops `@shared` modifier; auto-declares variable per Move 16; V5-strict body.
- **Schemas unchanged** — principled exception survives.
- **Move 20:** components stay distinct from engines (Position 1 from multi-instance thread). Components are multi-instance vehicle; engines/channels/schemas are singleton-by-design. Heuristic: app-lifecycle/singleton → engine; widget/reusable/per-instance → component.
- **Move 21 DROPPED at session end** — no migration story; v0.next IS scrml.

**The north star (proposed §1.4 of synthesis, captured S55):**
> the UI of an application SHOULD be a fully handled state machine (engine in scrml case). but development is a process

The structural shape of the UI tree IS the structural shape of the application's state. With the process clause: apps don't START at the north star; they EVOLVE toward it. Compiler nudges (lint), kickstarter teaches the destination, language doesn't ENFORCE the shape. Connection to S54's "exhaustively provable" goal: enum-engines enable structural exhaustiveness checking; booleans-as-lifecycle defeat it.

**THE PIVOTAL CORRECTION — no migration:**
> there is NO ONE writing anything but purely experamental scrml, 100% throw-away code, we dont need to worry about any of that. we just need to fix the compiler, kickstarter, turorial, docs, etc.

This collapsed Move 21, dropped the v0.compat coexistence design, and reframed implementation as "fix scrml to be what it should be" rather than "migrate the world to a new version." Implementation work surface named: compiler + SPEC + PIPELINE + kickstarter + tutorial + examples + samples + self-host + stdlib + LSP/editors + articles. Multi-month effort. Implementation phase opens at S56.

**Files written this session:**

scrml-support:
- `user-voice-scrmlTS.md` — Session 55 entry appended (~14 verbatim quotes + interpretations; ~+450 lines)
- `docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md` — NEW clean decisions ledger
- `docs/deep-dives/v0next-mario-design-2026-05-04.scrml` — header annotation marking 11 superseded constructs (V5-strict, Move 7 dropped, etc.)
- `docs/deep-dives/phase-2-dispatch-briefs-2026-05-03.md` + 3 `progress-dd5/dd6/dd7-...-2026-05-03.md` — S54 leftover untracked artifacts, committed at this wrap as historical preservation

scrmlTS (this wrap commit):
- `hand-off.md` — S55 close fat hand-off (289 lines)
- `handOffs/hand-off-56.md` — pre-save mirror of hand-off.md (forensic preservation)
- `master-list.md` — S55 close inventory update
- `docs/changelog.md` — this entry

6nz (cross-repo outbox):
- `6NZ/handOffs/incoming/2026-05-04-0958-scrmlTS-to-6nz-multi-close-editor-option.md` — request for editor-side `<//>` auto-expansion since Move 7 dropped from language

**Open queue at S55 close (substantially shrunk):**
- Tagline refresh — design polish, not blocking
- Components props/slots/lifecycle internals — sub-thread under Move 20, design AS implementation proceeds
- Mario design file regen under post-S55 rules — useful canonical reference, not blocking
- Self-host migration plan — operational, not design

**Carry-forward findings (deferred into implementation phase):** ast.machineDecls file-level container rename + 3 small S54 dispositions (scrml migrate / SPEC §39.8 collision, SPEC-INDEX.md `E-MACHINE-DIVERGENCE` typo) + pre-S52 findings (F-COMPONENT-003, F-PARSER-ASI sweep, W5a/b, W7, W8, W9-11). Most folded into v0.next implementation; some may be obsoleted; triage at implementation-phase planning.

**Push state:** scrmlTS at this wrap commit pending push; scrml-support at user-voice + outcomes-doc + Mario annotation + S54 leftovers commit pending push. Push authorization pending user greenlight at S56 open.

**Authorization scopes:** "no holds barred" S54 framing was scoped to S55 (deliberation) by hand-off-55 — DOES NOT carry into S56. "PIVOTAL wrap" authorization is for THIS WRAP only. S56 implementation work needs its own authorization scope.

### 2026-05-03 (S53 CLOSED — fixit session, fat wrap, push complete; engine rename arc complete + 4 architectural fixes; 11 dispatches landed, +85 tests, 0 regressions)

S53 opened on the same calendar day as S52 close (2026-05-02). User direction: *"P3 recos good, go"* + *"this is fixit session. we go go go."* + *"keep going on what ever you have answers for or seems obvious."* — high-velocity per-action greenlights, P3 dive recommendations ratified across the board.

**S53 ratifications (per OQ-P3-1..8):** UCD over SP for category dispatch (51/60 vs 46/60); separate dispatches with P3.B first; per-category NR routing for P3.A/B + P3-FOLLOW for the 75-ref migration; W6 worktree DISCARDED entirely (mechanism preserved verbatim in P3 dive §3.1); PURE-CHANNEL-FILE auto-recognized (analogous to §21.5); E-CHANNEL-008 hard error on cross-file `name=` collision; `channels/` at app-root convention; ship P3.A with SQL-via-page-ancestor pattern documented (W5-FOLLOW continues independently).

**Track A — W6 worktree discard.** Branch `changes/w6` deleted (was at `b05812c`); worktree `agent-a566c25e34a40eb59` removed. P3 dive §3.1 preserves the W6 mechanism verbatim for re-implementation. Zero information loss.

**Track B — P3.B (T2-medium primary + T1-small continuation, +21 tests, merge `b794f64`).** TAB synthesizes `type-decl` AST node when parsing `export type X:kind = {...}` (in addition to existing `export-decl`); cross-file `<engine for=ImportedType>` resolves through the import graph. Closes F-ENGINE-001 architecturally. **Primary agent crashed mid-flight on ECONNRESET after 41 min / 110 tool uses** with 7 WIP commits (pre-snapshot + diagnosis + core TAB fix +90 LOC + 4 test tranches +804 LOC) — architectural fix and tests landed and proven (8,512 pass / 0 fail). **T1-small continuation dispatch** (worktree-isolation OFF; operated in existing P3.B worktree) finished SPEC §51.3.2 message correction + §51.16 NEW (cross-file engine subsection) + §21.2 normative + PIPELINE Stage 3 amendment + adopter integration (`pages/driver/hos.scrml` workaround removed; imports `DriverStatus` from `../../schema.scrml`; ~6 LOC eliminated; FRICTION marks F-ENGINE-001 RESOLVED). 4 pre-existing F-NULL-001 errors on `null` literals in hos.scrml verified out-of-scope (compile pre-change baseline shows same errors). 11-commit FF-merge clean.

**Track C — P3.A (T2-large, +27 tests, merge `00c533a`).** Channel cross-file inline-expansion via CHX (CE phase 2 under UCD). Closes F-CHANNEL-003 architecturally. ~700 LOC compiler refactor: `compiler/src/types/ast.ts` (+45, ChannelDeclNode + FileAST.channelDecls + ExportDeclNode.kind="channel") + `ast-builder.js` (+200, top-level `export <channel>` recognition + ChannelDeclNode synthesis + `_p3aIsExport` propagation + quoted-name import handling) + `module-resolver.js` (+30, channel exports registered with `category` field) + `component-expander.ts` (+270, UCD refactor with Phase 1 component + Phase 2 channel expansion + cross-file inline algorithm) + `state-type-routing.ts` NEW (+119, transitional category routing table per OQ-P3-2 b) + `codegen/emit-channel.ts` (+15, defensive `_p3aIsExport` filter) + `gauntlet-phase1-checks.js` (+12, E-IMPORT-001 suppression extended to channel exports). ~970 LOC tests across 8 new files: TAB recognition (6) + MOD registry (3) + CHX same-file pass-through (5) + CHX cross-file inline (5) + multi-page broadcast (3) + PURE-CHANNEL-FILE (2) + E-CHANNEL-008 collision (2) + diagnosis closure (1) + self-host parity ignore filter for `channelDecls`+`specifiers`. SPEC §21.2 + §38.12 NEW (~150 LOC) + §15.15.6 (~10 LOC) + PIPELINE.md Stage 3.2 Phase 2 (~80 LOC). FRICTION marks F-CHANNEL-003 ARCHITECTURALLY RESOLVED. New error codes: E-CHANNEL-008 (cross-file name= collision) + E-CHANNEL-EXPORT-001 (channel exports without string-literal name=). **3 surprising findings agent flagged:** quoted import-name handling (kebab-case channel names like `"dispatch-board"`) added as discrete fix; gauntlet Phase 1 fix (E-IMPORT-001 suppression mirroring P2 component pattern); P3 dive §6.2 worked-example has subtle scoping bug (`topic=@dispatcherId` referring to consumer-scope var doesn't naturally inline; agent used canonical self-contained pattern from `examples/15-channel-chat.scrml` instead) — flagged as P3.A-FOLLOW design consideration. 15-commit FF-merge clean.

**Track D — P3.A-FOLLOW (T1-small, +8 tests, merge `32a330b`).** Dispatch-app channel sweep. **4 channels of 4 migrated, none skipped:** `dispatch-board` (5 pages, ~60 LOC), `customer-events` (5 pages, ~70 LOC), `load-events` (3 pages, ~45 LOC), `driver-events` (2 pages, ~30 LOC). 4 PURE-CHANNEL-FILE exports created under `examples/23-trucking-dispatch/channels/`. 12 consumer pages updated. ~205 LOC inline boilerplate eliminated. FRICTION marks F-CHANNEL-003 → FULLY RESOLVED with migration table + LOC delta + zero-skip rationale. None of the channels had consumer-scope-bound `topic=@var` references (the dispatch app uses default `topic=name` semantics throughout, so the SPEC §38.12 worked-example scoping caveat doesn't apply). 6-commit FF-merge clean.

**Track E — P3-FOLLOW (T2-medium, +4 tests, merge `ab589b3` post-rebase).** Global migration of `isComponent` routing reads to NR-authoritative `resolvedKind` / `resolvedCategory`. **25 routing reads migrated** (the dive's ~75 estimate was misleading — actual: 103 in compiler/src/ + 154 in compiler/tests/, but read-site count is ~25; the rest are write-side stamps + intra-stage syntactic predicates + doc comments, all bounded by the new allowlist test). `compiler/src/state-type-routing.ts` **DELETED** (transitional file disposed; zero in-tree consumers). SPEC §15.15.6 rewritten ("Shadow Mode (P1 Only)" → "NameRes Authority (Post-P3-FOLLOW)") + PIPELINE Stage 3.05 status flipped to "AUTHORITATIVE". Files modified: `component-expander.ts` (added `isUserComponentMarkup` helper, 7 routing-read sites flipped) + `module-resolver.js` (vocabulary aligned: `category: "user-component"` from `"component"`) + `name-resolver.ts` (importedRegistry derivation prefers `info.category`; walker traverses `lift-expr.expr.node`) + `type-system.ts` (§35 attr validation gate flipped) + `validators/post-ce-invariant.ts` (VP-2 gate flipped to `resolvedKind` + uppercase-first-char heuristic) + `types/ast.ts` (deprecation note on `isComponent`; new fields declared) + `lsp/handlers.js` + `lsp/workspace.js` (cross-file completion classification). New allowlist test `p3-follow-no-isComponent-routing.test.js` (4 tests). 9-commit FF-merge clean (post-rebase onto post-P3.A-FOLLOW main).

**5 surprising findings flagged by P3-FOLLOW agent:**
1. **Vocabulary divergence between NR and module-resolver** — NR used `resolvedCategory: "user-component"`, MR used `category: "component"`. P3.A never aligned them. P3-FOLLOW unifies — single canonical name. One P3.A test (`p3a-mod-channel-registry.test.js`) updated.
2. **NR walker did not traverse lift-expr expressions.** VP-2's `walkFileAst` did. Without NR also walking, residual `<UserBadge>` inside `lift <li><UserBadge/></li>` had no NR stamps. NR walker now mirrors VP-2's lift-expr handling.
3. **VP-2 semantic widening.** NR resolves unknown identifier as `resolvedKind: "unknown"` (NOT `"user-component"`). Literal swap would have lost F-COMPONENT-001 silent-failure case. Gate widens to: `resolvedKind === "user-component" OR (resolvedKind === "unknown" AND uppercase-first-char tag)` — mirrors BS's `isComponentName` predicate without reading `isComponent`.
4. **NR-prefer-with-fallback pattern.** Many CE/VP-2 unit tests bypass NR. Pure NR-only routing read would have broken 105+ tests. Implemented: `resolvedKind === "user-component" OR (resolvedKind === undefined AND isComponent === true)`. NR wins when present (authoritative); legacy fallback for unit-test paths.
5. **Dive's ~75-reference estimate was low.** Actual: 103 in compiler/src/ + 154 in compiler/tests/. Most of the gap was BS/ast-builder write-side stamps and parseAttributes parameters that don't need migration. Read-site count (the actual migration scope) is closer to ~25.

**Track F — three mechanical paperwork dispatches (T1-small × 3, dispatched in parallel; all merged with PA-side rebase + conflict resolution).**

- **P3-SPEC-PAPERWORK** (`7c0468e`, 6 commits, FF). SPEC.md worked-example sweep `<machine>` → `<engine>`. **19 replacements, 67 kept** (deprecation references, normative concept text, error-message templates, grammar rules, section headings, attribute-registry cross-reference list). Plan revision during execution: line 20623 (§52.13.3 closed-attribute-set list) reversed REPLACE→KEEP because cross-references `compiler/src/attribute-registry.js`'s internal `"machine"` key. Migration plan documents per-occurrence rationale.
- **P3-RENAME** (`7a575c0`, 6 commits, FF after rebase). Internal compiler `machineName→engineName` identifier rename across 8 files (`ast-builder.js`, `type-system.ts`, codegen × 6). **58 internal renames, 11 references preserved** (1 AST field name `machineName` on AST node + 2 reads + 8 user-visible-text placeholders in JSDoc/error messages). Inventory delta vs dive's ~350 estimate: real read-site count is 68 in 9 files; renamed 58 of those. Future "AST shape rename" dispatch will handle `kind: "machine-decl"` literal + AST field name.
- **P3-ERROR-RENAME** (`b302ede`, 3 commits, FF after rebase + 3-file conflict resolution). Error code rename E-MACHINE-* → E-ENGINE-* across **20 codes / 367 occurrences across 34 files** (compiler/src 5 files / SPEC.md / tests 26 files / examples 2). Surprising finding: naive `s/E-MACHINE-/E-ENGINE-/g` is unsafe — `E-STATE-MACHINE-DIVERGENCE` contains `E-MACHINE-` as substring; agent adopted negative-lookbehind regex `(?<![A-Za-z0-9])E-MACHINE-`. PA-side conflict resolution at merge: 3 files (`ast-builder.js`, `codegen/emit-machines.ts`, `type-system.ts`) had P3-RENAME's `engineName` and P3-ERROR-RENAME's `E-ENGINE-*` changing adjacent lines; resolved by `git checkout --ours` (taking main's post-P3-RENAME state with `engineName` + old `E-MACHINE-*`) + Python re-application of `E-MACHINE-*` → `E-ENGINE-*` substitution (4 + 12 + 75 = 91 replacements). Combined result is the union: `engineName + E-ENGINE-*`. Rebase completed, FF-merged.

**Engine rename status (post P3.B + P1 + P3-RENAME + P3-SPEC-PAPERWORK + P3-ERROR-RENAME):** the rename arc is functionally complete except for: AST `kind: "machine-decl"` literal rename, AST field name `machineName` rename on AST nodes (deferred to future "AST shape rename" dispatch — affects 20+ test references), user-facing docs flagged by P3-ERROR-RENAME (docs/tutorial.md 3 refs, docs/articles/mutability-contracts-devto-2026-04-29.md, docs/tutorial-snippets/02l-derived-machine.scrml, compiler/SPEC-INDEX.md `E-MACHINE-DIVERGENCE` shorthand).

**Test count timeline this session:** S52 close 8,491 → P3.B merge 8,512 (+21) → P3.A merge 8,539 (+27) → P3.A-FOLLOW merge 8,547 (+8) → P3-FOLLOW merge 8,551 (+4) → P3-SPEC-PAPERWORK merge 8,551 (0 — paperwork) → P3-RENAME merge 8,551 (0 — paperwork) → **P3-ERROR-RENAME merge 8,551 (0 — paperwork)**. **Net S53: +60 tests, 0 regressions across 7 dispatches.** Pre-push validation green at every push.

### 2026-05-02 (S52 CLOSED — fat wrap, push complete; architectural pivot; state-as-primary unification ratified; 4 deep-dives + debate + 5 fix dispatches + 1 P3 design dive; +111 tests, 0 regressions)

S52 ran 2026-04-30 → 2026-05-02 (long session crossed midnight twice, machine-A) following S51 close (8,380p baseline). **The architectural-pivot session.** Triggered by a single user observation that scrml has been silently capitulating to JSX conventions for years; resulted in ratification of state-as-primary unification (Approach A, 93/110 vs B 71.5/110 in 6-expert debate), engine rename (machine→engine) folded into P1, whitespace warn-then-error decided, body grammar uniform-with-extension-points decided.

The catalyst was the W6 dispatch (carry-over from S51 plan): it shipped a §21.2 SHALL NOT against `export <markup>` to close F-CHANNEL-003 silently, and the user identified that within hours as "basically unacceptable" — locks in the wrap-in-const concession. That single rejection triggered the architectural pivot.

**Track A — W6 dispatch (PARKED, NOT MERGED).** F-MACHINE-001 fully RESOLVED (TAB synthesizes sibling type-decl for `export type X:kind = {...}`; cross-file `<machine for=ImportedType>` works; SPEC §51.3.2.5 + §41.2). F-CHANNEL-003 PARTIAL — agent unilaterally shipped the §21.2 SHALL NOT against `export <markup>` (E-EXPORT-001) instead of the diagnosis's recommended inline-expansion. User identified the SHALL NOT as wrong direction (locks in wrap-in-const concession permanently). W6 worktree at `changes/w6` 10 commits never merged. F-MACHINE-001 fix in W6 is salvageable but redundant once P3 lands cross-file resolution architecturally.

**Track B — Three parallel deep-dives (DD1+DD2+DD3).** User direction: *"deep dive. start multiple if its worth it"*. PA dispatched 3 parallel scrml-deep-dive agents.
- **DD1 — State-as-Primary Architectural Unification** (master conceptual, T3) at `scrml-support/docs/deep-dives/state-as-primary-unification-2026-04-30.md` (~1170 lines). Recommends Approach A. Scores A 51/60 vs W6-shipped C 28/60 on 12-dimension matrix. Catalogs 8 historical concessions Approach A removes (PascalCase, wrap-in-const, whitespace-after-`<`, separate state/markup categories, dual naming patterns, §21.2 SHALL NOT, §38.4.1 channel carveout, F-AUTH-002 modifier prefix asymmetry). Convergent dev-agent signal: 3 friction reports independently reach for Approach A-shaped fixes. 7 OQs with defaults proposed.
- **DD2 — Parser Disambiguation Feasibility** (T2-large) at `parser-disambiguation-feasibility-2026-04-30.md` (~700 lines). Verdict **FEASIBLE-WITH-COST**. T2-large × 3 phases (~2-3 weeks). Built on existing W2 canonical-key infrastructure already in LSP. Eliminates Approach B (name-table-at-parse breaks per-file parallelism, lexer-hack risk).
- **DD3 — Prior Art Survey** (T2-large) — **FAILED at 600s agent stall**. PA decided to skip re-launch (DD1 §7 had 14-system catalog autonomously). Progress file remains as untracked artifact.
- Both DD1 and DD2 agents delivered as inline messages instead of writing to disk; PA had to manually persist them. Pattern noted for future deep-dive briefs.

**Track C — DD4 (state-type body grammar).** User-floated questions about `<machine>` body restriction and engine rename led to pre-decided direction: bodies should be uniform with extension points. PA dispatched DD4 with that as input.
- **DD4 — State-Type Body Grammar Uniform-with-Extensions** (T2-large) at `state-type-body-grammar-uniform-extensions-2026-04-30.md` (1187 lines). Confirmed reusability hypothesis (uniform bodies INCREASE reusability). **Killer finding:** SPEC §54.2-§54.3 (Nested Substate Declarations + State-Local Transition Declarations) ALREADY ships the extension-point pattern for type-with-body. DD4 GENERALIZES existing scrml shape, not invents.
- Recommended phasing: T1+T2 (~10-13 days dispatch). `<schema>` stays compile-time-only (principled exception). `<formResult>` default-rendering deferred to T3.
- DD4 wrote to disk correctly (the agent followed the explicit "WRITE this to disk" brief).

**Track D — Debate (Approach A vs B, "for shits and giggles").** User authorized debate even though technical case for A was already strong. debate-curator dispatched with full pipeline. 6 panelists: A camp (scrml-dev-elixir + scrml-dev-htmx + racket-hash-lang-expert) vs B camp (scrml-dev-react + scrml-dev-typescript + scrml-dev-vue). **Verdict: Approach A wins 93/110 vs Approach B's 71.5/110** on extended 11-dimension rubric. Largest spreads favoring A: Paradigm fit (+7), Idiomaticity to user vision (+5.5), Cross-file architectural cleanup (+5), Spec coherence (+4.5). Tie-breaker: convergent dev-agent signal. Honest minority position from B camp on per-category type distinctness — informs implementation: A's `StateTypeDeclNode` must carry strong `category` discriminator (DD4's `StateTypeRegistration` already does this). Insight appended to `~/.claude/design-insights.md`.

**Track E — User ratification.** *"ratify yes. engine yes . other qs default. go"* — Approach A locked, engine rename folded into P1 (overrode DD4's defer recommendation), all 7 OQs at defaults.

**Track F — P1 dispatch (T2-large, +8 tests, merge `0334942`).** Lowest-risk first commit per DD1 §9.1. SPEC §4.3 + §15.6 + §15.8 + §15.12 case-rule softening (SHALL → MAY); SPEC §15.15 NEW unified state-type registry section; 3 new warning codes catalogued (W-CASE-001/W-WHITESPACE-001/W-DEPRECATED-001); TAB recognizes both `<engine>` and `<machine>` keywords; W-DEPRECATED-001 runtime emission on `<machine>` (8 tests); 2 examples migrated to `<engine>` (mario, dispatch app hos.scrml); SPEC §51.3.2 engine canonical; PIPELINE Stage 3.05 NameRes design contract documented. **PARTIAL but adequate** — implementation of NR + warning emissions + uniform opener deferred to P1.E (depends on uniform opener landing first to avoid W-WHITESPACE-001 noisiness flood).

**Track G — P1.E dispatch (T2-medium, +56 tests, merge `1a89e84`).** Builds on P1. **NameRes Stage 3.05** at `compiler/src/name-resolver.ts` (~410 LOC, bigger than 150 estimate; shadow mode — advisory). Wired post-MOD. Walks tag-bearing nodes; stamps `resolvedKind` + `resolvedCategory`. Downstream stages (CE, MOD, TS, codegen) STILL route on `isComponent`; the 63 isComponent references DO NOT migrate yet (deferred). **Uniform opener:** both `<id>` and `< id>` produce equivalent AST for db, schema, engine, machine, channel, timer, poll, request, errorBoundary. **W-CASE-001 + W-WHITESPACE-001 runtime emission live** (NR-driven). Samples migrated to `<engine>` (machine-basic, machine-002-traffic-light, rust-dev-debate-dashboard). Dedicated W-DEPRECATED-001 regression tests replaced sample-based coverage. SPEC §15.15 + §34 + PIPELINE Stage 3.05 flipped from "documented" to "implemented (shadow mode)". Performance within 10% (14.45-15.91s vs 14.51 baseline). Wart: agent renamed gauntlet stage labels in api.js (3.05/3.06 → 3.005/3.006) to avoid clash with NR. New finding: 60 new W-WHITESPACE-001 warnings firing on `samples/compilation-tests/` (pre-existing samples use `< db>` style; deprecation warning doing its job; not a bug).

**Track H — P2 dispatch (T2-medium-to-large, +18 tests, on `changes/p2`).** The user-visible win: `export <ComponentName attrs>{body}</>` direct grammar at top level. SPEC §21.2 amendment with both forms documented (Form 1 canonical + Form 2 legacy `export const Name = <markup>` as transitional sugar per OQ-DD1-3). TAB recognizes `export <Identifier ...>` at top level. MOD's exportRegistry shape-equivalent for both forms. Cross-file imports work for both. Both forms coexist. **Wrapper semantic gap surfaced:** agent shipped Form 1 by desugaring to `export const UserBadge = <UserBadge attrs>{body}</>` — body wrapped in `<UserBadge>` custom-element shell at render time. NOT byte-equivalent to Form 2. Agent documented as "deferred refinement"; PA surfaced; user chose option (a) — block merge until wrapper fixed.

**Track I — P2 wrapper fix dispatch (T1-medium, +17 tests, merge `966a493` via `changes/p2-wrapper`).** Builds on P2. TAB desugaring rewritten — body's root element absorbs outer attrs (typed-prop declarations + non-typed attrs). E-EXPORT-002 fires on empty/multi-rooted body. E-EXPORT-003 fires on outer/inner attr name conflict. SPEC §21.2 caveat dropped — byte-equivalence is now normative. SPEC §21.6 — new error codes catalogued. 14 unit tests (AST equivalence) + 3 integration tests (HTML byte-equivalence) verify Form 1 + Form 2 are equivalent. **New finding (pre-existing, not P2-introduced) — F-COMPONENT-004:** `substituteProps` in CE walks markup text + attr values but NOT into logic-block bodies (ExprNodes inside `${...}` blocks within component bodies); affects both Form 1 and Form 2 equally.

**Track J — F-COMPONENT-004 fix (IN FLIGHT at this changelog entry).** First dispatch HALTED at startup verification — harness gave the worktree a stale base (S51 close `3338377` instead of current main `966a493`). Agent correctly halted per startup-verification protocol; clean exit. Re-dispatched with explicit stale-base recovery prelude (`git reset --hard main` + symlink check + pretest regen). Scope: extend `substituteProps` to walk into logic-block bodies (ExprNodes); shadowing-aware (lambda parameters, local declarations, template literals, nested logic blocks); new helper `substitutePropsInExprNode(node, propMap, shadowedSet)`; Form 1 + Form 2 parity test updated from "same errors" → "same success".

**Status of original 6 S50 P0s (carry-forward):** unchanged from S51 close — F-AUTH-001 silent-window UVB-closed (ergonomic W7 deferred), F-AUTH-002 Layer 1 only (W5a + W5b deferred), F-COMPONENT-001 W1+W2 + F4 caveat (F-COMPONENT-003 nested-PascalCase open), F-RI-001 fully resolved W4, F-CHANNEL-001 W1, F-COMPILE-001 W0a; F-COMPILE-002 + F-BUILD-002 + F-SQL-001 closed S51.

**8 historical concessions catalogued (DD1 §3) for Approach A removal across P1-P4 phases:** PascalCase as discriminator (C1 — first concession identified) / wrap-in-const for components (C2) / whitespace-after-`<` discriminator (C3) / separate state-type categories (C4) / dual naming patterns (C5) / §21.2 SHALL NOT W6 amendment (C6 — never merged) / §38.4.1 channel per-page carveout (C7 — never merged) / `export pure/server function` modifier prefix asymmetry (C8).

**1 newly-surfaced finding open at S52 close:** F-COMPONENT-004 (substituteProps doesn't walk logic-block bodies — IN FLIGHT, expected to land soon).

**Carry-forward queue from S51:** F-COMPONENT-003 (nested-PascalCase Phase-1 limitation), F-COMPILE-003 (pure-helper export emission), W5a (pure-fn library auto-emit), W5b (cross-file `?{}` resolution), F-PARSER-ASI batch (30 trailing warnings), W7-W12 dispatches.

**Multi-session phase plan ahead (per DD1 §9.1 + DD4):** P3 (T3, ~10-15 days — cross-file `<channel>`/`<engine>` inline-expansion; closes F-CHANNEL-003 + F-MACHINE-001 architecturally; supersedes W6's tactical fixes); P4 (T1-small — `scrml-migrate` CLI); internal compiler rename `machineName→engineName` (~350 refs T2-small mechanical); SPEC §51 keyword sweep (T1-small paperwork); E-MACHINE-* → E-ENGINE-* rename (T1-small paperwork); NameRes promotion to authoritative routing (63 isComponent → kind switches; T2-medium, likely part of P3).

**Test count timeline this session:** S51 close 8,380 → P1 merge 8,388 (+8) → P1.E merge 8,484 pre-pretest / 8,444 post-pretest (+96 / +56 effective) → P2 worktree 8,462 (+18) → P2-wrapper merge 8,479 (+17) → P2-wrapper post-pretest 8,519 / 410 files (current). **Net delta from S51 close: +139 pass, 0 skip change, 0 fail change, +10 files. Zero regressions across all 5 fix-dispatch waves.**

**Authorization scope (closing note):** S52's per-action greenlights ("go", "fine to merge", "ratify yes", "2 fix go", "park w6", "go your reco") were per-action throughout. Does NOT carry into S53. Per pa.md "Authorization stands for the scope specified, not beyond." Re-confirm before any merge / push / cross-repo write / dispatch.

**Track K-M close additions (post-mid-flight):** F-COMPONENT-004 fix landed (substituteProps walks logic-block bodies; shadowing-aware; SPEC §15.10.1; FRICTION RESOLVED; +12 tests; merge `e95aa87`). Bookkeeping commit `6e2aa4c` mid-flight. Both repos pushed (scrmlTS `3338377..6e2aa4c` 32 commits; scrml-support `2687e48..f016dad` 1 commit). P3 design dive completed and on disk at `scrml-support/docs/deep-dives/p3-cross-file-inline-expansion-2026-05-02.md` (1029 lines). P3 recommendations: channel via CHX/UCD; engine via Tier 1 TAB type-decl synthesis (W6 Option A pattern preserved); UCD over SP (51/60 vs 46/60); per-category NR promotion; 75 isComponent migration to P3-FOLLOW; W6 worktree disposition = discard entirely. P3.B first (T2-medium), P3.A second (T2-large), P3-FOLLOW third (T2-medium). **Push state at S52 close:** scrmlTS pushed clean to origin (33 commits past S51 close including final wrap commit); scrml-support pushed clean (P3 dive + progress committed in this wrap). **Push complete via "do it fat" wrap directive.**

### 2026-04-30 (S51 close — fat wrap; systemic silent-failure sweep, 12 dispatches, +184 tests, 0 regressions)

S51 ran 2026-04-30 (single long day, machine-A) following S50 close (8,196p baseline). User directive: *"anywhere, we're fixing everything"* + *"lets deep dive with everrything first"*. The session opened with a structured 5-phase deep-dive at `scrml-support/docs/deep-dives/systemic-silent-failure-sweep-2026-04-30.md` (1,026 lines) cataloging 35 items across 16 mechanisms and recommending the **Unified Validation Bundle (UVB)** as the critical path. Twelve dispatches followed in sequence + parallel.

**Track A — parent silent-failure deep-dive (research, 1,026 lines).** Cataloged every open architectural defect from S50 + 5+ pre-existing carry-forwards. Identified 16 failure mechanisms (6 P0-bearing). Discovered M17: test-scaffolding-masks-production (F-COMPONENT-001 + F-RI-001 both have unit tests that pass while production is broken — synthetic key fixtures + isolated narrow shapes mask real cross-file bugs). Recommended UVB unified bundle (4 validation passes shipped in one focused T2 dispatch) as critical path. 12 OQs surfaced; user accepted defaults. Prior art: Cargo / MSBuild / Astro / Bazel / Salsa / Roc / Lean / Rust / Elm — all have fail-loud invariants for the same defect classes.

**Track B — W0a F-COMPILE-001 fix (T2, +17 tests, merge `268f190`).** `scrml compile <dir>` was flattening output by basename: 32 source → 17 HTML / 47 distinct (15 collisions) for the dispatch app pre-fix. Two-part fix: Option A (preserve source dir structure in dist/ — `pages/customer/home.scrml` → `dist/pages/customer/home.html`) + Option B (E-CG-015 hard-error on basename collision pre-write). SPEC §47.9 (output path encoding) added. Dispatch app now produces 32 → 74 distinct outputs with 0 collisions. Discovered F-BUILD-002 candidate (`_scrml_session_destroy` duplicate import) and E-CG-002 spec/impl drift (E-CG-002 was already taken by `emit-server.ts:76`; SPEC corrected; W0a used E-CG-015 next-available).

**Track C — W0b OQ-2 dev-server bootstrap (T2, +9 tests, merge `70eb995`; CRASHED + RESUMED).** Codegen emitted literal `import { ... } from "scrml:auth"`; Bun cannot resolve `scrml:*` scheme. Fix: hand-written ES module shims for auth/crypto/store at `compiler/runtime/stdlib/<name>.js`; `bundleStdlibForRun()` copies them to `<outputDir>/_scrml/<name>.js`; `rewriteStdlibImports()` rewrites emitted `from "scrml:NAME"` to relative path computed from each file's `targetDir` (so nested-output files emit `../../_scrml/...`). First dispatch crashed at tool_use 184 with API ConnectionRefused. Resumed via fresh dispatch on existing worktree; rebased against post-W0a main with manual conflict resolution in api.js (preserved W0a's `pathFor()`/`writeOutput()`/`writtenPaths` AND W0b's stdlib bundling). Why hand-written shims: stdlib `.scrml` sources contain `server {}` blocks the standard pipeline doesn't lower at TS time today (separate M16 gap). Discovered F-COMPILE-002 candidate (`.scrml` extension imports not rewritten) + SQL Class B parse failures (13 of 17 dev-server failures emit `sql-ref:-1`).

**Track D — W1 UVB unified validation bundle (T2, +44 tests, merge `1f640d5`).** 4 validation passes: VP-1 per-element attribute allowlist with W-ATTR-001 (unrecognized name) + W-ATTR-002 (unrecognized value-shape); VP-2 post-CE invariant E-COMPONENT-035 on residual `isComponent: true`; VP-3 attribute-interpolation E-CHANNEL-007 on `${...}` in `<channel name=>`/`<channel topic=>`; VP-4 subsumed by W0a's E-CG-015. New `compiler/src/attribute-registry.js` (per-element attribute schema for scrml-special elements). New `compiler/src/validators/` directory (4 files + AST walker). SPEC §15.14 + §38.11 + §52.13 amendments. PIPELINE Stage 3.3 added. Smoke-test confirmed: `examples/22-multifile/` now FAILS LOUDLY with E-COMPONENT-035 instead of silently emitting `document.createElement("UserBadge")`. Dispatch app's `pages/dispatch/board.scrml` errors with 3× E-COMPONENT-035.

**Track E — W2 architectural deep-dive child (research, 1,093 lines).** Killer finding: the LSP at `lsp/workspace.js` already ships canonical-key + auto-gather. CE is the outlier among 4 cross-file consumers (TS-pass, module-resolver, LSP all use absolute-path keying correctly; only CE reads `imp.source` raw). Trade-off matrix decisive: Approach B (unified canonical-key + recursion + auto-gather) leads by 11 over A, 13 over D, 17 over C. **No debate needed** per deep-dive §15. Compresses parent's T3 estimate to T2-large.

**Track F — W2 architectural fix (T2-large, +10 tests, merge `1f4430d`).** Approach B + B2-b sub-decision (CE consumes `importGraph` directly; mirrors TS-pass pattern at `api.js:626-660`). F1 (CE recursion fix in `hasAnyComponentRefsInLogic`) + F2 (canonical-key via importGraph + lookupKey helper) + F3 (CLI auto-gather transitive `.scrml` import closure with `--no-gather` opt-out + sane-limit guard E-IMPORT-007). Bonus discovery NOT in deep-dive's catalog: TAB classifies `${ export const X = <markup/> }` as `export-decl` (not `component-def`), so cross-file `ast.components` was empty for export-const components; CE now also scans `ast.exports` and synthesizes a component-def. New integration tests `compiler/tests/integration/cross-file-components.test.js` close M17 scaffolding-mask gap. SPEC §15.14.4/§15.14.5/§21.6/§21.7 + PIPELINE Stage 3.2 amendments. G1-G4 PASSED (22-multifile compiles clean + emits expanded markup + integration tests pass). G5 partial — F4 nested-PascalCase Phase-1 limitation surfaced (`parseComponentBody` produces 0 blocks for `<LoadCard>` containing `<LoadStatusBadge>`; same-file fails identically; pre-existing not W2-caused; filed F-COMPONENT-003 candidate). `examples/22-multifile/` master-list row flipped `[x][❌]` → `[x][✅]`. Kickstarter v1 multi-file section dropped KNOWN-BROKEN flag.

**Track G — W3 F-NULL-001 + F-NULL-002 paired fix (T2, +15 tests, merge `37c9f8d`).** Diagnostic finding: F-NULL-001's "machine-context-dependent" trigger was incidental at post-W1 baseline. Real root cause: GCP3 walker's `walkAst` inspected `condExpr/initExpr/exprNode/argsExpr` but never visited `markup.attrs[*].value.exprNode` (server-fn bodies routed through `if-stmt.condExpr` visited; markup-attr expressions at `attrs[*].value.exprNode` unreached). Plus separate diagnostic-quality bug: `spanFromEstree` hard-coded `line:1, col:1`. SPEC §42.7 amendment (uniform rejection across all source positions). **`--no-verify` violation by commit `7d2c4e7`** (TDD red intermediate; bypassed pre-commit hook for failing-tests-then-fix cycle; next commit `09cca5e` was clean). Per pa.md this requires explicit user authorization; flagged for next-session attention.

**Track H — W3.1 + W3.2 paired follow-on null sweeps (T2, +39 tests, merge `e69ecac`).** W3.1 bare-null literals: detector only caught `==`/`!=` operands; missed bare `null`/`undefined` in declaration init / return / object property / array element / ternary branch / default param. Fix: `forEachLitNull` walker visits every exprNode subtree + emits E-SYNTAX-042 on lit-null. Suppression for `is-not`/`is-some`/`is-not-not` synthetic operands. W3.2 string-template attribute interpolation: `<div class="${@x == null ? a : b}">` silently passed because `${...}` was preserved as raw text inside `kind:"string-literal"`. Fix shape (b) tactical: `extractTemplateInterpSegments` scans for `${...}` with brace-depth tracking; each segment re-parsed via existing `parseExprToNode`; resulting exprNode fed back through `inspectExprNode`. SPEC §42.7 enumerated 3 rejection categories + suppression rule. Cascade fixture updates: TodoMVC `app.scrml` (3 sites) + `fn-expr-member-assign.test.js` (3 fixtures) — both used `null` as semantically-equivalent placeholders for `not`; updated to spec-compliant `not` in same commit as detector.

**Track I — F-COMPILE-002 + F-BUILD-002 paired (T2, +15 tests, merge `9ac3731`).** F-COMPILE-002 two-layer bug: (1) `emit-server.ts:111-122` emitted `stmt.source` verbatim (no `.scrml` rewrite); (2) post-emit `rewriteRelativeImportPaths` would mis-relocate `.server.js`/`.client.js` back into source tree. Fix: extension rewrite in emit-server + rewriter skip for compiled-output extensions. F-BUILD-002 single-source bug: `emit-server.ts:166` emits `_scrml_session_destroy` from EVERY auth-middleware server.js; `generateServerEntry` imported each module's exports under name → N copies → SyntaxError. Fix shape: option (d) skip-duplicate (first-importer-wins). SPEC §47.10 + §47.11 + §47.12 amendments. Discovered F-COMPILE-003 candidate (pure-helper `.scrml` files compile to near-empty `.client.js` and no `.server.js`).

**Track J — F-SQL-001 `?{}` parser (T2, +17 tests, merge `5c35618`).** Diagnostic finding: regex `/\?\{[^}]*\}/g` in `compiler/src/expression-parser.ts:137,169` cannot handle `?{...${expr}...}` — non-greedy `[^}]*` stops at first `}`, which in real SQL templates is the closing brace of `${}` interpolation. Acorn then sees truncated input. The dispatch's reference to `sql-ref:-1` was a slight mis-statement; real bug was regex truncation. Fix shape (C) both ergonomic + hard-error: `replaceSqlBlockPlaceholder()` context-mode-stack scanner with frames `js{depth}` / `template` / `single` / `double`; `?{` enters JS-context, `` ` `` enters template, `${` inside template enters nested JS, pops correctly; quoted strings respected. When scanner reaches end-of-input with outer JS-frame still open, `ParseResult.sqlDiagnostic` carries E-SQL-008. SPEC §44.8 + E-SQL-008 amendments. Trailing-content warnings dispatch app: 146 → 30 (eliminated 116; 30 remaining are pre-existing non-SQL ASI cases — F-PARSER-ASI-* / F-PARSER-MARKUP-FRAG-* candidates).

**Track K — W4 F-RI-001 deeper (T2-large, +6 tests, merge `474cce0`).** Most surprising finding of the session: `route-inference.ts` `collectReferencedNames` extracted identifier names via regex applied to **flat-stringified ExprNodes**. The regex matched identifier-shaped tokens **inside string-literal contents**. The capture-taint loop then resolved those bogus names against the global cross-file `fnNameToNodeIds` map. In the dispatch app, `transition()`'s `"/login?reason=unauthorized"` string literal collided with `app.scrml`'s `server function login`, false-tainting `transition`, firing E-RI-002 — but only in directory (multi-file) compile mode, which is why S50's narrow regression tests (single-server-fn shapes) didn't catch it. Fix: replace regex with structural ExprNode walk via existing `forEachIdentInExprNode` (visits only `IdentExpr` nodes, skips `LitExpr` content, skips `MemberExpr.property`, skips `LambdaExpr` bodies). M2 workaround reverted across **10 dispatch-app pages**: dispatch/load-detail, dispatch/billing, customer/load-detail, customer/quote, customer/invoices, driver/load-detail, driver/home, driver/hos, driver/messages, driver/profile. SPEC §12.4 per-fn invariant amendment. **F-RI-001 went PARTIAL → FULLY RESOLVED.** No E-RI-002 fired anywhere on dispatch app post-fix.

**Track L — W5 F-AUTH-002 PARTIAL (T2, +13 tests, merge `56b80ad`).** 3-layer diagnosis: (Layer 1) `ast-builder.js` EXPORT branch's regex was blind to `pure`/`server` modifier tokens; `collectExpr` stopped at `function` STMT_KEYWORD after consuming `server`; left `exportedName=null` and broke cross-file imports of `export server function NAME` with E-IMPORT-004. (Layer 2) Pure-fn files in browser mode produce empty `.client.js` regardless of exports — SPEC §21.5's "auto-detect" promise is unimplemented. (Layer 3) Cross-file `?{}` resolution against importing `<program db=>` has no spec contract. **Layer 1 only fixed.** Modifier parsing fix + SPEC §21.5.1 + §44.7.1 + E-SQL-009 contract direction. **Layers 2 + 3 deferred as W5a (pure-fn library auto-emit) + W5b (cross-file `?{}` resolve)**; W5a is prerequisite for W5b. Architectural cross-file emission gap is broader than F-AUTH-002 (also affects non-SQL pure-fn exports).

**Bookkeeping:** mid-session commit `8dddd27` added 5 newly-surfaced findings to dispatch-app FRICTION.md (F-COMPILE-002, F-BUILD-002, F-SQL-001, F-NULL-003, F-NULL-004) before their respective fix dispatches.

**Status of original 6 S50 P0s:** 5 closed (F-AUTH-001/W1, F-COMPONENT-001/W1+W2, F-CHANNEL-001/W1, F-COMPILE-001/W0a, F-RI-001/W4 fully resolved); 1 partial (F-AUTH-002/W5 Layer 1; W5a + W5b queued). **3 newly-surfaced P0s all closed** (F-COMPILE-002, F-BUILD-002, F-SQL-001).

**5 newly-surfaced findings still open at S51 close:** F-COMPONENT-003 candidate (nested-PascalCase Phase-1 limitation in `parseComponentBody`); F-COMPILE-003 candidate (pure-helper export emission); W5a (pure-fn library auto-emit) + W5b (cross-file `?{}` resolve); F-PARSER-ASI / F-PARSER-MARKUP-FRAG batch (30 trailing warnings post-F-SQL-001).

**Authorization scope (closing note):** S51's "go"/"green"/"a"/"b"/"c"/"greenlight fat wrap" pattern was per-action throughout. Does NOT carry into S52. Per pa.md "Authorization stands for the scope specified, not beyond." Re-confirm before any merge / push / cross-repo write / dispatch.

**Push state:** scrmlTS 67 commits ahead of origin pre-wrap; wrap commits add 3-4 more. scrml-support 4 untracked deep-dive files + needs user-voice S51 append. **Push authorized via "greenlight fat wrap" directive at session close.**

### 2026-04-30 (S50 close — fat wrap; 4 tracks + 6-milestone dispatch app + 26+ findings)

S50 ran 2026-04-29 → 2026-04-30 (crossed midnight during dispatch app M2). Four major tracks shipped:

**Track A — Phase 2g.** Chain branches `if=`/`else-if=`/`else` mount/unmount via per-branch B1 dispatch + single chain wrapper `<div data-scrml-if-chain="N">` + per-branch mixed-cleanliness handling. Greenlit from structured 5-phase deep-dive at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` (753 lines) — surfaced 2 findings the dispatch missed (§17.1.1 line 7533 normative-by-implication; mixed-cleanliness chains the DOMINANT pattern, 5/10 audited samples). User accepted all 4 OQ suggestions on first read. T2 pipeline dispatch with worktree-isolation; first dispatch timed out at 43min/68 tool calls, resumed via fresh dispatch on the existing worktree (SendMessage tool not available in this env), completed cleanly in 10min. Merged via `b362b33`. +31 tests in new `chain-mount-emission.test.js`. No new runtime helpers (Phase 2c B1 reused verbatim). No spec amendment.

**Track B — F-RI-001 triage.** PARTIAL resolution. Triage agent found F-RI-001 was filed against an OLDER RI mental model (commit `7462ae0` S39 boundary-security had already removed callee-based escalation). Doc-comment fix in `route-inference.ts:34-47 + 1387-1394` to remove misleading "purely-transitively-escalated function is suppressed" wording. **7 regression tests** in new `route-inference-f-ri-001.test.js` (§A 3 narrow-canonical / §B 2 server-bound-still-fires / §C 2 CPS-applicable still splits). PA attempted to revert M2's workaround in `pages/dispatch/load-detail.scrml` post-merge — discovered `transition` STILL fires E-RI-002 in real-app file context when `saveAssignment` coexists. Workaround restored. **Two adjacent findings split:** F-RI-001-FOLLOW (P1, `obj.error is not` fails E-SCOPE-001 — `is not` doesn't support member-access targets); F-CPS-001 (P1, architectural — `analyzeCPSEligibility` doesn't recurse into nested control-flow while `findReactiveAssignment` does). F-RI-001 downgraded from STALE to PARTIAL.

**Track C — F-COMPONENT-001 architectural diagnosis.** Triage dispatch refused conservative fix; surfaced as architectural BLOCKED. **Cross-file component expansion does not work end-to-end** on current scrmlTS — three intersecting faults: (F1) `hasAnyComponentRefsInLogic` doesn't recurse into nested markup (wrapped patterns silently skip CE); (F2) `runCEFile` looks up `exportRegistry.get(imp.source)` by raw path string but production registries are keyed by absolute filesystem path; (F3) CLI reads `inputFiles` only, never auto-gathers files reachable through imports. **Independent confirmation:** compiled `examples/22-multifile/`, dist/app.client.js line 12 contains `document.createElement("UserBadge")` — phantom custom element. The canonical multi-file scrml example renders blank. Existing `cross-file-components.test.js` masks the bug via test-only key synthesis that bypasses production paths. **Plan B parked** per user direction: examples/22-multifile flipped to `[x][❌]` in master-list §E; kickstarter v1 multi-file section now flags cross-file components KNOWN-BROKEN; recommends import-types+helpers+inline-markup pattern; deep-dive scheduled post-S50. Diagnosis writeup at `docs/changes/f-component-001/diagnosis.md` (322 lines).

**Track D — Trucking dispatch app.** 6-milestone language stress test at `examples/23-trucking-dispatch/`. Domain matches user's actual operation (NE Utah, oil and gas, owner-operator). User locked: all-three slices integrated (load tendering + driver log + customer billing), 3 personas (dispatcher / driver / customer), real-time channels, 5,000+ LOC ceiling, **Option A `auth="role:X"` syntax** (deliberately surface the silent-inert friction; server-side fallback layered), customer self-register open. 6 sequential dispatches via Agent (general-purpose, opus, worktree-isolated):

- **M1** schema + auth scaffold (1,587 LOC, 5 commits) — 9 tables, login/register flow, NE Utah seed data (Basin Energy / Uintah Field / Vernal Operations etc.). 7 friction findings.
- **M2** dispatcher slice (2,199 LOC, 10 commits) — 6 pages + 8 components dir (latter unused after F-COMPONENT-001). 4 friction findings including the original (since-found-stale) F-RI-001 framing + F-COMPONENT-001 first surface.
- **M3** driver slice + HOS state machine (2,259 LOC, 7 commits) — 6 pages + `<machine name=HOSMachine for=DriverStatus>` with 8 transitions (off_duty ↔ on_duty ↔ driving + sleeper_berth cycle). 3 friction findings (F-MACHINE-001 / F-NULL-001 / F-PAREN-001).
- **M4** customer slice (1,799 LOC, 5 commits) — 6 pages + rate-quote → tendered-load flow. 2 friction findings (F-NULL-002 / F-CONSUME-001).
- **M5** real-time channels (587 LOC net, 5 commits) — 4 channels (`dispatch-board`, `driver-events`, `load-events`, `customer-events`) wired across 12 pages. 6 friction findings (F-CHANNEL-001 P0 + 5 others).
- **M6** lin tokens + README + final summary (343 LOC net, 6 commits) — acceptance + BOL + payment lin tokens with two-layer enforcement (compile-time `lin` parameter + DB UPDATE-with-NULL durable single-use guard). 2 friction findings (F-LIN-001 / F-DG-002-PREFIX).

**26+ FRICTION findings logged** at `examples/23-trucking-dispatch/FRICTION.md` — the load-bearing artifact of the entire exercise. Severity breakdown: 6 P0 / 10 P1 / 5 P2 / 1 P2 observation / 5 reconfirmations / 1 partial-resolution.

**Two user-prompted findings (high-value extras the dispatch app didn't surface autonomously):**

- **F-IDIOMATIC-001 (P2 observation)** — User asked "has any code used 'is not' 'is some'?" — grep showed **zero usage as operators across 8,200 LOC** of natural scrml writing by 4 distinct general-purpose agents. Adopters reach for `!x` truthiness, `== null`, `==` instead. SPEC §42.2 + kickstarter v1 §3 document `is not`/`is some` as canonical, but it's not landing in practice. Three plausible chilling effects: familiarity bias / F-RI-001-FOLLOW chilling effect / F-NULL-001+002 chilling effect.

- **F-COMPILE-001 (P0)** — User asked "are we actually compiling all code?" — audit revealed `scrml compile <dir>` flattens output by basename. **32 source .scrml → 17 HTML + 28 client.js + 17 server.js in dist/ = 15 silent overwrites.** Customer's `home.scrml` + `profile.scrml` + 2/3 of `load-detail.scrml` were silently overwritten by driver versions. Verified via grep on emitted JS (`driver-events` channel ref in `home.server.js` proves driver/home won; `cdl_number` SQL in `profile.server.js` proves driver/profile won). The "compile clean" verdict from M3-M5 dispatches was misleading — agents didn't audit input-count vs output-count. **The dispatch app cannot run as advertised** — adopters logging in as customer would see driver UI and bounce off role-checks.

**The systemic silent-failure meta-finding:** scrml repeatedly accepts inputs that produce silently-wrong outputs. At least 5 distinct mechanisms violate the S49 validation principle:
1. F-AUTH-001 — `auth="role:X"` silently inert
2. F-CHANNEL-001 — `<channel name="dynamic-${id}">` mangles to literal underscore
3. F-COMPONENT-001 — phantom `document.createElement("Component")` emission
4. F-COMPILE-001 — basename collision silent overwrite
5. F-RI-001 partial — file-context-dependent escalation

Belongs in a unified post-S50 deep-dive sweep, NOT 5 independent triages.

**Other sundries:**
- Authorization scope discipline maintained per pa.md — every action explicitly authorized; "go" cadence per-action, never session-scoped.
- Worktree-creation off stale main was recurring — every `isolation: "worktree"` dispatch needed an explicit rebase prelude in the brief. Cause: harness uses origin/main as branch base. Workaround stable across all dispatches this session.
- Cross-machine sync hygiene clean entering S50 (both repos 0/0 origin); push at S50 close pushes 57+ commits to origin.

### 2026-04-29 (S50 mid-session — Phase 2g: chain branches mount/unmount via per-branch B1 dispatch)

Continued from S49 close (`a70c6aa`). Two-step session: structured deep-dive at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` (753 lines) → T2 pipeline implementation. Greenlit design: **Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch.**

**Tests at Phase 2g merge:** 8,125 pass / 40 skip / 0 fail / 384 files. Net delta vs S49 close: **+31 tests, +89 expects, +1 file. No regressions.**

- **Phase 2g — chain branches mount/unmount** (merge `b362b33`). Extends Phase 2c B1 (single-`if=`) to chain branches. Each `if=`/`else-if=`/`else` branch now compiles per its cleanliness: clean branches → `<template id="..."><inner></template><!--scrml-if-marker:...-->` (per-branch B1 emission inside a single `<div data-scrml-if-chain="N">` chain wrapper); dirty branches → `<div data-scrml-chain-branch="K" style="display:none"><inner></div>` retained as fallback. New `isCleanChainBranch()` helper strips chain attrs then defers to `isCleanIfNode` so cleanliness criteria match Phase 2c B1 verbatim. Strip-precursor (`stripChainBranchAttrs`) preserved in BOTH paths. Chain controller (`emit-event-wiring.ts`) emits `_update_chain_<chainId>()` that dispatches per `branchMode: "mount" | "display"` — clean branches go through `_scrml_create_scope` + `_scrml_mount_template` / `_scrml_unmount_scope`; dirty branches toggle `style.display`. `LogicBinding` interface in `binding-registry.ts` extended with `branchMode`, `templateId?`, `markerId?`, `branchIndex` for the controller. **Honors §17.1.1 line 7533** ("only one span exists in DOM at any time") for clean branches; dirty branches retain pre-Phase-2g behavior (display-toggle inside chain wrapper). **No new runtime helpers** — Phase 2c B1 helpers reused verbatim. **No spec amendment.** New `chain-mount-emission.test.js` with 31 tests (N1-N31) covering all 4 emission shapes (all-clean / mixed / all-dirty / multi-branch) + controller wiring + initial render + branch swap + strip-precursor + reactive flip. ~5 assertion updates in `else-if.test.js` for new chain-clean shape; N31 anti-leak invariant unchanged. +1,035 / -79 across 7 files.

- **Phase 2g deep-dive** at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md`. 753 lines, 5-phase structure. Surfaced two findings the dispatch missed: (1) §17.1.1 line 7533 is normative-by-implication ("Only one span exists in the DOM at any time") and applies to chains too — today's wrapper-+-display-toggle violates this verbatim; (2) mixed-cleanliness chains are the DOMINANT pattern (5/10 audited samples), not a corner case. These findings drove the per-branch dispatch decision over whole-chain fallback. Eliminated Approach C (DOM-keep + scope-swap) on §17.1.1 amendment cost + cross-ecosystem reversal + S49 validation principle. Deep-dive carried 7 OQs, 4 of which were greenlit-block; user accepted all 4 suggestions on first read, no debate needed.

- **Routed-to-Phase-2h findings** (NOT 2g regressions, surfaced during 2g implementation): (a) **Pre-existing chain-controller condition-emission bug** for expression conditions like `if=@step == 1` — compiles to `_scrml_reactive_get("step")` instead of `(_scrml_reactive_get("step") == 1)`. Confirmed pre-existing on main (`a70c6aa`), preserved verbatim by Phase 2g. Likely TAB-stage `branch.condition.raw` not populated for `@var == literal`. (b) **6/6 deep-dive §7 allow-list samples** (recipe-book, blog-cms, quiz-app, kanban-r11, api-dashboard, gauntlet-r11-task-dashboard) fail upstream BS/TAB/TS pipeline errors — pre-existing, deep-dive §7/§8 warned. (c) 3/4 chain compilation-test fixtures pass; 4th (099) is expected E-CTRL-001 chain-break test.

- **Phase 2h scope reality check.** Originally framed as "small T1 sample-suite verification sweep." With 6/6 allow-list samples blocked on upstream errors, Phase 2h is no longer small — it's "triage 6 upstream failures + then verify chain semantics." Phase 2g is well-tested at the unit level (31 new tests covering all observable shapes); Phase 2h's value is reduced; user opted to skip 2h and pivot to the 3-5k LOC trucking dispatch app instead. Upstream sample failures remain open as a separate (lower-priority) work-item.

### 2026-04-29 (S49 — multi-track parallel fix-the-cracks; 8 tracks shipped; 4 of 5 audit items closed; all phantoms cleared)

Cross-machine pickup on machine-A continuing from S48's machine-B work. User mode: "go go go" — broad autonomy directive across all dispatched fix work. Validation principle stated mid-session and applied to all current/future feature design: *"if the compiler is happy, the program should be good."* No silent failures at compiler/runtime boundary. PA recommendations of "pass-through; runtime will reject" treated as anti-patterns going forward.

**Tests at S49 close:** 8,094 pass / 40 skip / 0 fail / 383 files. Net delta vs S48 close: **+153 pass, -2 fail (pre-existing fails resolved as side effect of compiler.* meta-checker work)**.

- **compiler.* phantom closed (Option B)** (merge `4fb5cec`). The S48 audit's #1 phantom: `compiler.*` was classified by meta-checker but never implemented by meta-eval — user code passed classification then ReferenceError'd at eval. Recon found user-code surface was the empty set (zero samples, zero examples, zero tests). Option B locked over A (implement) and C (partial impl) on asymmetric-regret + simplicity-defender grounds. Removed regex from `COMPILE_TIME_API_PATTERNS`; deleted `exprNodeContainsIdentNamed("compiler")` wire-up; mirror deletion in `compiler/self-host/meta-checker.scrml` AND `stdlib/compiler/meta-checker.scrml` (2-copy self-host surfaced during impl); added E-META-010 (reserved-namespace diagnostic); backfilled E-META-009 (nested ^{} inside compile-time meta) into §22.11 + §34. SPEC §22.4 amended; §22.8 example trimmed. **All 4 audit phantoms closed by this single mechanism** (rows 2/3/4 were "subset of phantom" — same issue; verified via separate recon). +3 net tests; -2 pre-existing fails resolved as side effect.

- **W-TAILWIND-001 warning + PA-corrective edit** (merges `c543859` + commit `2a10d04`). New `findUnsupportedTailwindShapes()` detector wired into pre-BS lint loop. `maskInterpolations()` brace-balances over `${...}` regions to avoid ternary false-positives (caught real adopter scenario in gauntlet-r10-svelte-dashboard sample). Initial detection had a contradiction in PA's brief (always-fire on shape vs skip-on-engine-match) — agent flagged + resolved shape-based; PA-corrective edit then aligned impl with intended rule. **Bonus fix:** `parseClassName` silent-strip bug closed — `weird:p-4` previously returned CSS for `.p-4` (selector mismatch with source class — silent failure violating S49 validation principle). +44 net tests across both commits.

- **Phase 2c B1 — if= mount/unmount via template + marker** (merges `c543859`-precursor + `7ce8b55`-main). After a structured 5-phase deep-dive at `scrml-support/docs/deep-dives/if-mount-unmount-implementation-strategy-2026-04-29.md` locked B1 over B4 (DOM-keep + scope-swap; eliminated on cross-ecosystem + stale-DOM event hazard + Svelte 5 PR #603 separating-unmount-from-destroy grounds) and B5 (compile-time-static + hide-on-init; parked for SSR work). Re-enabled the deferred Phase 2b emit-html block; clean-subtree if= elements compile to `<template id="...">` + `<!--scrml-if-marker:N-->` + client-JS controller calling `_scrml_create_scope` + `_scrml_mount_template`/`_scrml_unmount_scope`. SPEC §17.1 (DOM existence) + §6.7.2 (LIFO scope teardown) honored. **Precursor commit closed a latent if-chain bug** — `stripChainBranchAttrs()` strips `if=`/`else-if=`/`else` from chain branch elements before recursive emit, preventing B1 double-fire on chain branches. **Most surprising finding the recon missed:** today's display-toggle has flash-of-wrong-content bug for initial-false (no inline `display:none`) — B1 IMPROVES initial-false FCP; only "regression" is initial-true blank, industry-standard prior-art cost. **Phase 2c covers ONLY narrow path** (lowercase tag, all-static descendants); cleanliness gate rejects events/reactive-interp/lifecycle/components/bindings/transitions which fall back to display-toggle. Phase 2 verification recon found 2d/2e/2f are NON-tasks (closed by gate); 2g is real T2 work (chain branches still display-toggle, §17.1 spec divergence); 2h is small T1 sweep. +26 net tests in new `if-mount-emission.test.js`.

- **Tailwind 3 — arbitrary values + variant expansion** (merge `b18fa8e`). New §26.4 "Arbitrary Values" with §26.4.1 validation rules + §26.4.2 cross-feature interaction; new `parseArbitraryValue`/`validateArbitraryCss`/`resolveArbitraryValue`/`wrapWithVariants`/`balancedParens`/`validateUrlBody` helpers. **E-TAILWIND-001 minted** — invalid bracket content fires compile-time error (per S49 user validation principle). Validation surface: hex digit lengths, full v3+v4 unit set (32 units), color function whitelist (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color/color-mix), math function whitelist (calc/min/max/clamp/var), url() body parsing, var() identifier validation, balanced-parens. Plus 4 new theme variants (dark/print/motion-safe/motion-reduce). `parseClassName` rewritten to `{breakpoint, theme, state, base, hasUnrecognizedPrefix}` (preserving silent-strip-bug fix from W-TAILWIND-001 corrective). Cross-feature: `md:p-[1.5rem]`, `lg:hover:bg-[#ff00ff]`, `dark:bg-[var(--theme)]` all work. 64 new tests in §19/§19b/§19c/§19d. Closes audit drift item #3 (intro article SPEC-ISSUE-012 caveat) by shipping the implementation rather than amending the article. +71 net tests.

- **Tutorial Pass 2** (merges `49b623e` Subgroup A + `a29295a` Subgroup B). 14 mechanical edits per recon: new §1.8 promoting `if=` to Layer 1; new `01h-if-chains.scrml` snippet (~25 LOC); §2.5 trim; §1.1 11-element state-opener list per SPEC §4.2; glossary line 1615 fork. Observable-behavior wording for the if= mount/unmount-vs-display drift; bare-attribute `else` callout. 3 files +106/-16. Pass 3-5 (~30h) NOT STARTED.

- **lin Approach B verified — FALSE ALARM** (doc-only). Audit's "implementation status uncertain" was an inventory miss: `compiler/tests/unit/gauntlet-s25/lin-cross-block.test.js` already had 6 cross-block tests covering §35.2.2's normative surface. Audit row 124 amended 🟡 → ✅. No code change required.

- **E-META-004 numbering gap closed** (commit `c116331`). Added explicit "Reserved — do not reuse" rows to §22.11 + §34. Future codes SHOULD start at E-META-011.

- **Hook drift fix** — `.git/hooks/pre-commit` synced to in-repo canonical `scripts/git-hooks/pre-commit` (excludes browser, adds `--bail`, branch-warning). Worktree commit failures during S49 surfaced this.

- **9 recons + 1 structured deep-dive** produced. compiler.* decision recon, Phase 2c test-impact recon, Tutorial Pass 2 edit list, Phase 2c implementation-strategy deep-dive (5-phase, persisted to scrml-support), lin Approach B verification, audit phantoms (3 settled into 1 issue), Tailwind 3 scoping, Phase 2 completion status (2d-2h verification), audit ❌ rows verification (7 TRUE / 1 false-alarm row 139 / 3 settled). All in `docs/recon/` or `scrml-support/docs/deep-dives/`.

- **Audit "fix-the-cracks" 4 of 5 closed.** Item 1 (show= tutorial fix) — closed by Phase 1 in S48. Item 2 (browser-language article amendment) — DEFERRED per user "no amendments for now." Item 3 (intro article Tailwind caveat) — closed by Tailwind 3 implementation. Item 4 (compiler.* decision) — closed by Option B. Item 5 (component overloading tutorial) — DEFERRED until SPEC-ISSUE-010 closes the syntax (impl is 60-LOC scaffold, no tests, no samples).

- **Audit distribution shift** (post-amendments): 53 ✅ → **57** (+4: lin B, show=, Tailwind arbitrary, Tailwind variants); 22 🟡 → **21** (lin B promoted); 10 ❌ → **7** (-3: 2 Tailwind false alarms + custom-theme remains as v2 deferral); 4 👻 → **0** (all closed by compiler.* Option B).

- **Validation principle captured to user-voice S49 as load-bearing.** Verbatim user directive: *"the only change to everything is that im pretty sure I want comp-side validation of anything valid including css. everything else is, if the compiler is happy, the program should be good."* Cascading effects mapped across Tailwind 3 (compile-time CSS validation), Phase 2c B1 (already aligned — deterministic emission), W-TAILWIND-001 (manifestation of principle), compiler.* (explained why Option B was right). Future feature design must validate compiler-accepted inputs at compile time — no silent failures at compiler/runtime boundary.

- **24 commits on scrmlTS, 3 on scrml-support, all pushed to origin at session close.**

### 2026-04-29 (S48 — articles batch + 3 audits + Phase 1 if/show + Phase 2 foundation; cross-machine wrap)

Two-mode session that pivoted mid-stream. **First half** continued S47's voice-author work (article batch). **Pivot** triggered by user direction — *"I think we need to do a serious investigation on this language. what done, what it needs, what is prommised but not delivered"* + a request for a 3-5k LOC trucking dispatch example app to surface real friction. **Second half** turned audit findings into fix-the-cracks compiler work. Wrap was mid-Phase-2-prep due to machine switch; user *"do it fat, im switching machines, and I hate it when we're mid-progress and the next pa start screwing everything up."* All commits pushed to origin before machine switch; receiving machine pulled cleanly the following day.

**Tests at S48 close:** 7,941 pass / 40 skip / 2 fail / 381 files. Net delta vs S47: -11 tests (5 obsolete `show=` cases deleted that locked in pre-Phase-1 semantics; 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; behavior coverage net-increased despite the count drop). The 2 fails are pre-existing.

- **Articles batch — 3 published to dev.to** (Bryan MacLee 2026-04-28, commit `45913e5`): `What npm package do you actually need in scrml?`, `What scrml's LSP can do that no other LSP can, and why giti follows from the same principle`, `The server boundary disappears`. Closes the dead Further-reading links from the previously-shipped browser-language overview piece. Cross-links between the three patched in `cf81908` after publish (user must trigger dev.to re-sync OR re-paste content for the live versions to pick up the patched URLs).

- **Articles batch — 5 deep-dive drafts staged but UNPUBLISHED** (commit `a1b9bc4`). Series unpacking the shipped browser-language overview: `components-are-states`, `orm-trap`, `mutability-contracts`, `css-without-build-step`, `realtime-and-workers`. All in `docs/articles/*-devto-2026-04-29.md` + private drafts in `scrml-support/voice/articles/`. Slate item #7 (Why scrml *Feels* Faster) deferred until smart-app-splitting deep-dive's Approach A ratifies. **User-locked: "no amendments to published articles for now"** — the intro article's "Built-in Tailwind engine" overclaim and the browser-language piece's sidecar/WASM/supervisor overclaim stay live (parked, not abandoned).

- **Voice constraint added — never fabricate audience reception.** Article voice was corrected mid-session: "the end of the npm article calls scrml 'opinionated'... I really tried avoiding the rails model" → swapped to "first-principles, full-stack language." Reception-fabrication patterns ("people tell me", "I keep hearing", "most often dismissed") were also corrected. Future article work must NEVER fabricate audience reception — user has not yet had public reception. Strawman framing fine; reception-claiming is a do-not-claim violation.

- **Audit #9 — language-status audit** (`scrml-support/docs/deep-dives/language-status-audit-2026-04-29.md`). 89 features audited across 10 categories: 53 ✅ shipped / 22 🟡 partial / 10 ❌ spec-only / 4 👻 phantom. Top-5 most consequential drifts surfaced: (1) `compiler.*` is a phantom (meta-checker classifies, meta-eval doesn't implement — worst-of-both-worlds); (2) nested `<program>` sidecar (`lang=`), WASM (`mode="wasm"`), supervised restarts spec-defined with no codegen; (3) Tailwind utility engine narrower than intro article advertised (SPEC-ISSUE-012); (4) `lin` Approach B normative in §35.2.2 with type-system plumbing but no test fixture exercising cross-block discontinuous case; (5) `show=` directive taught in tutorial, not in spec, not handled by compiler — corrected by Phase 1 this session.

- **Audit #13 — scrml8 archaeology map** (`scrml-support/docs/deep-dives/scrml8-archaeology-map-2026-04-29.md`). Relevance map of `/home/bryan/projects/scrml8` (predecessor implementation). 290+ entries surveyed. **Critical finding:** all 79 scrml8 deep-dives have filename twins in scrml-support but the scrml-support copies are AMENDED — scrml8 holds the as-originally-debated pre-edit snapshot. **Single biggest non-forwarded artifact:** `/home/bryan/projects/scrml8/docs/giti-spec-v1.md` (1,386 lines) — already cited from current materials but never lifted forward in full (this is what the lsp+giti article had to source-cite "internally" for the 6 git-pain percentages). Bio extension target: 9 user-voice-bearing deep-dives in scrml8 — estimated 15-30 net-new verbatim quotes for bio §3a (npm-evil), §3c (colocation), §3d (mutability-contracts etymology), §3i (meta system). NOT YET CRAWLED.

- **Audit #8 — tutorial freshness audit** (`scrml-support/docs/deep-dives/tutorial-freshness-audit-2026-04-29.md`). 47 sections walked, 33 snippets walked. Distribution: 4 clean / 18 drift / 4 broken / 3 ghost / 11 gap / 4 superseded / 3 stale-deferral. **Crucial spec-vs-impl finding:** `if=` / `show=` is a THREE-WAY drift — tutorial said Vue-style split (mount/unmount vs visibility-toggle), spec §17.1 said `if=` removes-from-DOM, implementation did display-toggle for `if=` and inert-attribute for `show=`. Tutorial, spec, and implementation were mutually contradictory. Phase 1 resolved the `show=` half; Phase 2 in flight resolves the `if=` half.

- **Tutorial Track A (9 small fixes from freshness-audit Pass 1) shipped** (commit `9873e0e`, bundled with Phase 1). `@@user` ghost removal, `@server` non-feature note correction, `lin` deferral language update, snippet bugs, `onkeydown` event-arg correction, et al. Track B (the if/show wording realignment) is gated on Phase 2c completing the impl flip. Tutorial Pass 2-5 (ordering rewrites + missing sections + polish) NOT STARTED — ~30h estimated, deferred.

- **Phase 1 of if/show split shipped** (commit `9873e0e`). `show=` is now a real visibility-toggle directive — pre-S48 it was tutorial-taught with NO codegen support and `show=@x` compiled as a generic HTML attribute. Codegen path: `data-scrml-bind-show` placeholder + `el.style.display` toggle wrapped in `_scrml_effect`; SPEC §17.2 already had correct normative text — no spec change needed. End-to-end verified `<p show=@verbose>` → `<p data-scrml-bind-show="X">` + `el.style.display = _scrml_reactive_get("verbose") ? "" : "none"`. Test fixtures `samples/compilation-tests/control-show-{basic,expr}.scrml`. 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; `show=count` (no `@`) still produces literal HTML attribute (no regression).

- **Phase 2 foundation shipped** (commit `90f8d16`). Runtime helpers added to `compiler/src/runtime-template.js`: `_scrml_create_scope` (fresh scopeId per mount cycle, counter-based), `_scrml_find_if_marker` (TreeWalker over comment nodes), `_scrml_mount_template` (clones `<template>` content, inserts before marker), `_scrml_unmount_scope` (LIFO destroy honoring SPEC §6.7.2 four-step). LogicBinding interface extended with `isMountToggle?: boolean`, `templateId?: string`, `markerId?: string` (parallel to existing `isConditionalDisplay`, `isVisibilityToggle`). Runtime already had scope teardown infrastructure used by `<timer>`, `<poll>`, `<keyboard>` — Phase 2a just adds the mount-side helpers and the if=-specific marker scan.

- **Phase 2b emit-html integration WRITTEN + DEFERRED to Phase 2c** (commit `e62a11f`). The codegen logic exists in `emit-html.ts` but is COMMENTED OUT. Activating it simultaneously fails ~22 existing tests across `if-expression.test.js`/`allow-atvar-attrs.test.js`/`code-generator.test.js` that lock in the OLD `data-scrml-bind-if` + `el.style.display` shape. Group the test churn into a single disciplined Phase 2c commit. Verified emission shape (hand-compiled, before deferral): `<template id="...">` + `<!--scrml-if-marker:...-->` HTML; client controller wraps mount/unmount in `_scrml_effect`. To re-enable: uncomment block at marked location in `emit-html.ts`, update failing assertions, validate.

- **Trap surfaced for Phase 2c — JSDoc backticks in template-literal runtime.** `compiler/src/runtime-template.js` is a single giant template literal (`export const SCRML_RUNTIME = \`...\`;`). Backticks inside JSDoc must be escaped (`\\\`text\\\``) or the template literal closes early and the rest of the runtime parses as JS. Same trap for `<!--` strings — bun treats them as JS legacy HTML comments. Existing escapes at line 623 are the reference pattern.

- **`auth=` design-completeness deferred** per user *"I would really like to see the gap first"*. Today only `auth="required"` is recognized; `loginRedirect=` / `csrf=` / `sessionExpiry=` siblings work but are tutorial-untaught. Decision deferred until the 3-5k LOC dispatch app's role-based gating needs surface real friction.

- **User direction summary (the through-line):** Articles batch → "I want to blast some articles, Im talking a grip of them" → 5 deep-dive drafts. Pivot → "I think we need to do a serious investigation on this language" + "build a 3-5k LOC trucking dispatch example app" → audits dispatched. Pivot 2 → "lets fix, we need to make sure we fix things right" → Tutorial Track A + Phase 1. Mid Phase 2 confirmation → "we may not [need mount/unmount production-grade]. but these features exist for a reason... so if thats the case then A: scrml is not a production level language B: im missing something scrml already does to nullify the issue. so which?" → confirmed Phase 2 is the right work; foundation shipped. Through-line: adopter-friction is the priority; production-grade language is the goal; gap-driven design (auth=, mount/unmount details) over abstract redesign; honesty over over-claim in articles, spec, tutorial.

- **Cross-machine wrap.** All 8 scrmlTS commits + 2 scrml-support commits pushed to origin before machine switch. Receiving machine pulled cleanly the following day; both repos clean / 0-ahead / 0-behind. master-list and changelog (this entry) updated post-switch on the receiving machine.

### 2026-04-28 (S47 — cross-machine pickup + voice-author bio v0 → v1 + sibling-sweep + carry resolution)

Cross-machine pickup session. S46 ran on the OTHER machine as a scrml-voice-author session; S47 picked up here with a 26-commit pull on scrml-support to integrate machine-B's deliverables. No compiler changes; tests held at S46/S45 baseline.

- **Bio v0 signed off** — user *"sign off start the next bio-crawl"* cleared the bio gating clause and authorized Tier 2-3 incremental crawl in one phrase. Bio status flipped from `DRAFT — v0 initial seed` → `v1 — Tier 1 baseline SIGNED OFF`. Article mode unblocked.
- **Tier 2-3 bio increment** (`scrml-voice-author` background dispatch) — 339 → 392 lines (+53). 6 net-new verbatim quotes: 2 in §3a (NPM/Odin from `transformation-registry-design`, originally pre-archive `user-voice.md:1739/1747`), 4 in §3j (workflow-style from `hand-off-47`). 1 v0 gap closure (R13 "see how it feels" was in Tier 1 all along; v0 missed it). Zero contradictions; zero position shifts. §10 (provenance) + §11 (sibling-repo coverage gap) added. Two scrml-support commits: `1ead983` + `782551b`.
- **Sibling-repo sweep CLOSED EMPIRICALLY** — second `scrml-voice-author` dispatch with PA-enumerated file paths reached `scrml/` (3/3 read, 0 net-new — pure PA-admin) but Read-blocked at sub-agent permission level for `giti/` + `6nz/` (Bash universally denied). PA closed the gap directly via `grep -c` from PA shell across all 20 sibling-repo hand-offs: giti/ → 0 file matches → 0 quotes; 6nz/ → 1 match (`hand-off-4.md:52`) → 1 quote (`> strip shift from roll`, captured in §3h). All sibling-repo coverage gaps closed. §11 rewritten from "STILL BLOCKED" to "CLOSED EMPIRICALLY". **PA-direct empirical-closure recipe** documented as durable methodology for future sandbox-restricted scopes.
- **`design-insights-tmp-G.md` carry-over from S45 §1.9 RESOLVED via lift-then-delete** — PA-direct read showed canonical `design-insights.md` §"scrml G" preserved the headline insight (B-as-category-error, A-now-C-later, tar test, oss-transcripts, §47 stay artifact-scoped) but lossy-compressed the §"Debate-worthy follow-ups" section. 5 specific gates (3 measurement: gauntlet hot-loop wall-clock, parsing-fraction breakdown, parallel-parsing-first; 2 policy: LSP regime shift, SPEC §47 lift separability) lifted into `scrml-support/docs/debate-wave-2026-04-26-actionables.md` §"G-debate storage-model migration gates" with attribution. Temp file deleted. Zero actionable loss.
- **Cross-machine rotation gap convention** — first occurrence on record. When one machine runs a session-N that's sibling-repo-only (e.g. machine-B S46 was scrml-voice-author work, only one scrmlTS commit `b1f6a00`), the OTHER machine's `handOffs/` slot N stays empty when picking up. Sequential numbering preserved by rotating S(N-1)-close to slot (N+1). Slot 46 is permanently empty on this clone.

### 2026-04-27 (post-S45 — article-author agent shipped + first article landed in `docs/articles/`)

Side session post-S45 close. No compiler changes. Tests held at S45 baseline (7,952 / 40 / 0 / 381). New article landed at `docs/articles/why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` — dev.to-ready format (`published: false`, will flip when user uploads). Authored by the new `scrml-voice-author` agent (commissioned scrmlTS S38, built today). Agent file at `~/.claude/agents/scrml-voice-author.md` is outside this repo. Working drafts + bio + tweet drafts live in `scrml-support/voice/` (private). User direction 2026-04-27 whitelisted `scrmlTS/docs/articles/` as the agent's only writable path on the public side; everything else (compiler source, spec, root) remains hard-prohibited for the agent.

### 2026-04-27 (S45 — 4-debate wave: Bug B / G / A / C; 4 design insights; tracking doc; scrml-support push cleared)

Design-only session. User direction at session open: "defer push go to debate waves." Four
sequential debates fired with full expert rosters (5 + 5 + 5 + 4 = 19 expert dispatches);
4 design insights recorded to `scrml-support/design-insights.md` (lines 498/533/560/669).
A condensed tracking doc — `scrml-support/docs/debate-wave-2026-04-26-actionables.md` —
distills the 5 v1 commitments + 1 open user-decision + explicit non-goals from the wave.
scrml-support pushed at `d177afe` (20 files / 8,299 insertions), clearing the 2-session
push hold from S43+S44.

**No compiler changes. No test changes.** Tests at S45 close: 7952 pass / 40 skip / 0 fail
across 381 files (unchanged from S44 close).

- **Bug B debate (tier ladder).** Roster: haskell-language-pragma + rust-edition +
  lean-tactic-mode + racket-hash-lang + simplicity-defender. Final: simplicity-defender
  50.5/60 > rust-edition 49 > racket-hash-lang 45 > haskell-language-pragma 43 >
  lean-tactic-mode 41. Decision for v1: no-knob, ship `scrml fmt --upgrade-syntax` first;
  reach for `#lang` only when Superposition lands as a non-default dialect.

- **G debate (file storage model).** Roster: salsa (C-hybrid) + unison (B-pure) +
  simplicity-defender (A-pure) + nix + bazel as CAS witnesses. Final: A 52 > C 48.5 >
  B 32.5. Decision: stay on A (source-canonical); B falsified empirically by Unison's own
  `oss-transcripts` (LLM/AI-agent friction); C-with-Salsa deferred until measurement
  justifies. The G-judge stream timed out on first attempt; recovered with a condensed
  retry.

- **A debate (recoverability + comp-time-shape capture).** Roster: unison (B-pure CA-AST) +
  nix (C-layered Merkle DAG) + lean-lake (R3 hybrid `.olean`) + bazel (C-action-graph +
  toolchain transitions) + security (provenance/DDC/SLSA). Final: lean-lake 49 > unison-B
  46.5 > security-hybrid 44.5 > nix-C 43 > bazel-C 41.5. The B-vs-C dispute resolves via
  hybrid: AST-as-identity (B's win) orthogonal to hermetic-build-with-signed-provenance
  (C's win). v1 capture format = `.scrml-shape/objects/<hash>` + `manifest.toml` carrying
  `(root, compiler, target)` — designed now to carry SLSA L3 attestation later. **Open
  user-side question flagged by lean-lake-expert:** "Is R4 a real workflow or a wish?"
  Mathlib's 1.5M LOC ships entirely on R1+R3, never R4; Bazel says R4 operational at
  Google/Meta scale.

- **C debate (bridges architecture).** Roster: roc + gingerbill + security + unison.
  Final: roc 47 > gingerbill 46.5 > security 44 > unison 42.5. The 4 positions converge
  to a single composite: distribution + identity + execution + trust are 4 orthogonal
  layers. v1: BLAKE3 hash-of-tarball + URL+hash transport (no registry) + §41.6 vendored
  floor + `scrml vendor add` does NOT execute bridge code + comp-time bridge code in
  kernel-enforced capability sandbox.

- **The single highest-leverage commitment surfaced across all 4 debates:** specify the
  comp-time capability boundary in SPEC BEFORE any `^{}` / bridge / build-time feature
  ships. Cargo `build.rs` RFC#475 is stuck 7 years because they tried to retrofit. scrml
  has the structural advantage of writing the boundary now. **The window closes once the
  first popular bridge ships needing $HOME or network at compile time.**

- **scrml-support push** at `d177afe` (origin/main). 20 files / 8,299 insertions: 4 new
  design-insight entries + tracking doc + 8 deep-dives + 8 progress files +
  joint-coupling synthesis + user-voice-scrmlTS.md. Stray draft `design-insights-tmp-G.md`
  (from G-judge timeout retry) left unstaged.

- **Forged-agent harness load:** S44's YAML format fix took effect on session restart.
  All 17 forged experts + scrml-voice-author + simplicity-defender visible at S45 open.
  19 expert dispatches across the wave executed cleanly.

### 2026-04-26 (S44 — compiler-bug throughput: 3 fixes shipped + 12 debate experts forged + systemic YAML loader bug diagnosed/fixed)

High-throughput session immediately following S43. Three compiler bugs cleared from the
inbox/carry queue, all shipped to main and pushed (`8d1e07f..150c553`). Twelve debate
experts forged across three waves. Diagnosed and fixed a systemic YAML format defect in
all 18 forged-agent files (gap-0 between `</example>` and `model:` was breaking the
harness loader; fix takes effect on next session start). Superposition formalization debate
held per user direction; pillar commitment standing.

- **Bug M — `obj.field = function() {...}` mis-emits.** `08ca2f8`. Property/member
  assignment of a function expression was emitting as two statements with empty RHS,
  producing `SyntaxError: Unexpected token ';'` on JS load. Two-file fix:
  `compiler/src/ast-builder.js` `collectExpr` (keep function-expression as part of
  AssignmentExpression RHS rather than detaching as sibling stmt) +
  `compiler/src/expression-parser.ts` `AssignmentExpression` branch (thread `rawSource`
  through so function-expression child receives source context). Filed by 6nz from
  playground-six WebSocket setup. **+18 regression tests.** Anomaly noted: the same
  rawSource-threading gap exists in 5 other expression-parser branches (BinaryExpr,
  NewExpr, ArrayExpr, ObjectExpr, ConditionalExpr); function-expression children of those
  nodes will fall back to `raw=""` until that sweep lands. Probably masked in practice by
  scrml's arrow-callback convention.

- **Bug O — for-of loop variable leaks into `^{}` meta-effect frozen-scope.** `50b431e`.
  Markup-embedded `for (it of @list) { lift <li>${it}</li> }` was leaking `it` into the
  surrounding meta-effect's frozen-scope object as `it: it`, producing
  `ReferenceError: it is not defined` at module load. Single-file fix in
  `compiler/src/meta-checker.ts` `collectRuntimeVars` — skip for-loop bodies during
  module-scope walk (parallel to existing function-decl skip from Bug 6). Filed by 6nz
  from playground-six diagnostics list. **+13 regression tests** (6 unit + 7 integration).
  **Bonus discovery:** the duplicate `_scrml_meta_effect` emission in O's repro is a
  SEPARATE BS-stage bug — HTML `<!-- ... -->` comments aren't opaque to the block splitter,
  so `^{}` text inside a comment parses as a real meta block. After O's fix the phantom
  emission has clean capture (no crash); severity dropped to "phantom side-effect on
  module load." Filed as standalone intake at `docs/changes/fix-bs-html-comment-opacity/intake.md`.

- **A7 + A8 — HTML void elements leak `angleDepth` in component-def body.** `150c553`.
  Resolves both Scope C tracker findings A7 and A8 with a single fix. The original A7
  hypothesis pointed at `${@reactive}` BLOCK_REF interpolations; trace proved the
  BLOCK_REF was a red herring — the actual trigger was HTML void elements (`<input>`,
  `<br>`, `<hr>`, `<img>`, etc.) leaking `angleDepth` in `collectExpr` because the
  element-nesting tracker (added in A3 `bcd4557`) treated `<void>` opens without ever
  seeing closing tags. Depth counter went up, never came down, swallowing later
  component-def declarations into the first def's body. A8 was a side-effect of the same
  root cause: PreferencesStep's failure was the void
  `<input bind:value=@newsletter>`, not the `<select><option>` shape. Fix in
  `compiler/src/ast-builder.js`: added `HTML_VOID_ELEMENTS` const list (the standard 14)
  and updated `collectExpr` / `collectLiftExpr` / `parseLiftTag` to NOT increment
  `angleDepth` for void elements. **+15 regression tests.** `examples/05-multi-step-form`
  now compiles clean — all three components register. **A8 closure note** filed at
  `docs/changes/fix-component-def-select-option-children/closure-note.md`. **New finding
  A9 surfaced:** components inside if-chain branches are not expanded by component-expander;
  distinct downstream concern, tracker entry filed (intake pending next session).

- **Bug N — closure pending 6nz confirmation.** Two `@x = ...` reactive writes inside an
  inline function expression were producing missing-paren-on-set + assignment-to-get
  emit on `c51ad15`. On current main `82e5b0d`+ the codegen now emits cleanly with
  `node --check` passing. Likely fixed incidentally by `ed9766d`
  (arrow-object-literal-paren-loss) or `2a5f4a0` (BS string-aware brace counter). 6nz
  follow-up dropped at `2026-04-26-1530-scrmlTS-to-6nz-bugs-mo-shipped.md` requesting
  re-verification on a `82e5b0d`+ 6nz clone before closing.

- **12 debate experts forged in 3 waves (`~/.claude/agents/`):**
  - **Wave 2 (Bug B's tier-ladder set, 4 experts):** `racket-hash-lang-expert` (file-pragma
    via DSL), `haskell-language-pragma-expert` (file-pragma + project-default-baseline),
    `rust-edition-expert` (project/lockfile + migration), `lean-tactic-mode-expert`
    (block-tier extensibility).
  - **Wave 3 (Superposition set, 4 experts — all forged before Superposition was held):**
    `modal-logic-expert` (formal substrate), `quantum-PL-expert` (E hardline,
    type-primitive), `haskell-laziness-expert` (B-leaning hybrid), `erlang-hot-reload-expert`
    (runtime/distributed perspective).
  - **Wave 4 (G + C debate completers + cross-debate voice, 4 experts):**
    `salsa-incremental-compilation-expert` (G C-hybrid), `simplicity-defender`
    (cross-debate conservative voice; synthesizes Hickey + gingerBill + Armstrong + Wirth),
    `roc-expert` (C platform abstraction + URL distribution),
    `gingerbill-expert` (C distributed-hash-refs / no central registry).

- **Systemic YAML loader-bug diagnosis + fix.** All 18 forged-agent files (S43's 5 +
  scrml-voice-author + S44's 12) had `</example>` immediately followed by `model: ...`
  with no blank-line separator. The harness's YAML loader treated this as a malformed
  block scalar and silently dropped the agents — every dispatch attempt returned
  `Agent type 'X' not found`. Diagnosed by comparing agent-forge output to working agents
  (gauntlet-overseer, scrml-deep-dive). Fixed all 18 files via awk script (insert blank
  line before `^model: `). Latency: harness loaded the agent list at S44 start; fix takes
  effect on next session. **Backlog:** update agent-forge template to emit a blank line
  before `model:` so future forges aren't broken.

- **Color collisions caught + fixed:** rust-edition-expert + lean-tactic-mode-expert
  both forged with `purple` (fixed lean-tactic-mode → `teal`); modal-logic-expert +
  quantum-PL-expert both with `pink` (fixed quantum-PL → `coral`). Pre-existing yellow
  collision between security-expert + unison-expert (S43 carryover) NOT fixed this
  session.

- **Superposition formalization debate HELD.** Per user direction mid-session ("we can
  hold superposition off in the plan"), the B-vs-E formalization decision is deferred;
  the Superposition pillar commitment from S43 standing. 4-debate queue remaining for
  next session: B → G → A → C (in dependency order).

- **scrml-support push STILL HELD** — 18 untracked files (8 deep-dives + 8 progress
  files + joint synthesis + user-voice-scrmlTS.md) sustained from S43 close through
  S44 close. **Now 2 sessions held**, flagged as the immediate next-session decision
  per the cross-machine sync hygiene rule.

- **Cross-repo:** dropped 2 messages into 6nz inbox: `2026-04-26-1430-...mno-triage.md`
  (initial triage) and `2026-04-26-1530-...mo-shipped.md` (post-fix follow-up with commit
  SHAs + workaround revert points + bonus-bug intake notice + Bug N re-verification
  request).

- **Anomaly inventory at S44 close:** A9 candidate (if-chain branch expansion gap),
  rawSource-threading gap in 5 expression-parser branches, BS-html-comment opacity (intake
  filed), agent-forge template needs update, fresh-worktree dist regen requirement,
  voice-author bio bake blocked through S44 (resolves on next session start).

- **Tests:** 7906 → 7952 / 40 / 0 / 381 files. **+46 net tests across 3 fixes, 0
  regressions.** Per fix: M +18, O +13, A7+A8 +15.

### 2026-04-26 (S43 — living-compiler investigation arc: 8 deep-dives + 5 expert agents + voice-author + permission fix + cross-machine sync hygiene)

Design-heavy session. NO compiler changes. The work product is the largest single-session
deep-dive yield in project history plus the agent infrastructure to run debates from it.

- **8 deep-dives all landed**, output to `scrml-support/docs/deep-dives/*-2026-04-26.md`.
  The "living compiler" thread fired full-bore per the user's "keep pulling on every thread,
  dd and debate wherever the trail leads" methodology directive. Two dives stalled silently
  on Phase 4 single-shot writes; both recovered (C re-dispatched from progress file; H
  re-dispatched with strict per-section enforcement; Superposition recovered via PA-write
  hybrid pattern after a 3rd stall). Dive titles:
  - **A** — Recoverability + compile-time-shape capture (1,068 lines). User disambiguation:
    R4 with R1+R4 combo target. Approach A (Lockfile) eliminated by user choice; debate is
    B (Content-Addressed AST) vs C (Pipeline-Stage Merkle Tree).
  - **B** — Mid-compile config swap via `<compiler config=...>` blocks (876 lines). Of 14
    industry languages, only 3 have working block-scope mode swap. Recommendation: defer
    block-tier; floor on lockfile + per-`<program>` attr.
  - **C** — Bridge architecture (re-dispatched). 5 spec rules drafted (§X.1-§X.5):
    bridges are content units, hashes are identity, names are convenience, no global
    registry as authority, post-Stage-7 phasing constraint, deterministic at compile time.
    Approach D (Curated Registry) eliminated.
  - **E** — Meta-system capability frontier `^{}` (638 lines). Three critical findings:
    `compiler.*` is a phantom (named in SPEC, not implemented); determinism is unenforced
    (the largest spec-vs-checks gap); phasing inversion confirms `^{}` operates Stage 7-8
    only — independent agreement with B's same finding.
  - **F** — Per-dev keyword alias layer. Big surprise: scrml's SPEC already has the
    canonical+alias precedent in §14.5 (`./::`), §18.2 (`=>/->`), §18.6 (`else/_`),
    §48.11 (`fn`/`pure function`) — all with the normative line *"the compiler preference
    setting controls which form the formatter normalizes to."* The user's idea generalizes
    that single-global mechanism to per-dev. Phase 5 explicitly recommends NO debate.
  - **G** — File storage source-vs-AST-canonical. After user disambiguation #4 ("AI agents
    can figure it out. they will NOT be limiting factors of this language"), Approach B
    (Unison-flavor full AST) was re-included after initial elimination. Final framing:
    A (source-canonical + lockfile + editor-alias) vs B (Unison-flavor) vs C-hybrid
    (source-canonical + AST-cache).
  - **H** — Smart app splitting / "feel of performance" (588 lines). Centerpiece:
    `playable_surface(entry_point, N)` formalized as a closure over initially-rendered
    + reactive-dep + server-fn-reachable + auth-gated + vendor-units. Honest assessment:
    structural advantage real but narrower than framing suggests; contingent on three
    implementation gaps (reactive-graph static-resolvability, server-fn interaction-graph
    modeling, §40 auth depth).
  - **Superposition** (788 lines) — committed as an explicit language pillar after user
    disambiguation #5. 8 strong-fit constructs catalogued (auto-await, RemoteData, sum
    types, Optional, `?{}` SQL, `<request>`, `^{}` meta classification, multi-version
    coexistence). 3 NOT-fits (reactive `@vars`, lin, machines) demoted via radical-doubt
    discipline. Debate framing: B (Dedicated SPEC section) vs E (Composite: B + selective
    sigil/type-primitive).

- **Joint A+B coupling synthesis written by PA** (~150 lines) — pre-debate anchor on the
  4 coupling points (shape-capture granularity, cache-key derivation, replay correctness,
  diagnostic provenance). Collapses 6 pre-debate disambiguations to 3 real debate questions.

- **5 foundational tech-experts forged** at `~/.claude/agents/`: nix-expert, unison-expert,
  bazel-expert, lean-lake-expert, security-expert. Cover A + C + G + Superposition + parts
  of B/E debates. Specialized experts for B (racket-#lang, haskell-pragma, rust-edition,
  lean-tactic) and Superposition (modal-logic, quantum-PL, haskell-laziness, erlang-hot-reload)
  remain to forge in next wave.

- **Custom `scrml-voice-author` agent** (298 lines) at `~/.claude/agents/` — bio curator +
  article-drafter that crawls user-voice + hand-offs + deep-dives for verbatim quotes,
  maintains a structured bio at `scrml-support/voice/user-bio.md`, and drafts articles
  citing only attested positions (never fabricates expertise the bio doesn't attest).
  First article queued: *"Why programming for the browser needs a different kind of
  language"* — to draft after bio is baked.

- **Settings.json permission fix** at `~/.claude/settings.json` — added `permissions.allow`
  for `Write/Edit/Read` on `~/.claude/agents/*` paths. First wave of forges hit Write-denied;
  permission fix unblocked the workflow; remaining forges landed clean.

- **scrmlTS pa.md updates:** Added "Cross-machine sync hygiene" section (session-start
  fetch + ahead/behind, session-end push verify, machine-switch protocol, recovery
  procedure). Updated "wrap" step 3 to point at this in-repo `docs/changelog.md` (was
  briefly pointing at a now-retracted `scrml-support/CHANGELOG-scrmlTS.md`).

- **Strategic vector confirmed** across 6 independent investigations: content-over-name,
  source-canonical (now conditional after AI-friction disambiguation), deterministic-at-
  compile-time, distributed-not-centralized, phasing-constraint-respected, superposition-
  as-foundational. 6 dives converging on compatible constraints = highest-confidence
  signal radical-doubt has produced.

- **Five durable methodology directives surfaced** (captured in user-voice): radical
  doubt is a SAFETY mechanism not skepticism; track 1 (preference) bias conservative,
  track 2 (power) bias extension; AI-agent friction is NOT a language-design constraint;
  "make no mistakes" for irreversible operations; cross-machine sync hygiene codified.

- **scrml-support staleness reconciliation arc.** Discovered local clone 12 commits behind
  origin (S40-S42 cross-repo writes built on stale baseline). Forensic audit + checksums +
  /tmp backups + reflog anchor → `git reset --hard origin/main` → keepers preserved →
  master-PA inbox message dropped. Demonstrated the "make no mistakes" principle in
  practice. user-voice-archive.md (2,837 lines) brought into local tree.

- **Tests unchanged from S42 baseline:** 7,906 pass / 40 skip / 0 fail / 378 files.
  No compiler changes this session — confirmed by `bun test` at S43-close.

- **Commits this session:** 2 on scrmlTS (`82e5b0d` cross-machine sync work + S43 close
  hand-off/master-list/changelog). scrml-support push HELD — 18 untracked design files
  remain uncommitted in scrml-support pending push authorization.

---

### 2026-04-24 (S39 — boundary security + 6 bug fixes + ExprNode Phase 4d + multi-DB scoping)

Largest single-session output in project history. Boundary security deep-dive
+ 3-expert debate produced a compiler-enforced closure-capture taint model.
All 6 inbox bug reports (4 from 6nz, 2 from giti) fixed and verified. ExprNode
Phase 4d advanced through structured inline match arms + render preprocessor.
Multi-DB SQL driver support scoped via deep-dive. Suite 7,463 → 7,562
(+99 net tests), zero regressions.

- **Boundary security — closure-capture taint propagation.**
  Deep-dive identified 5 root causes: transitive escalation deliberately
  disabled in RI (correct for calls, wrong for captures), `extractReactiveDeps`
  string-only scan (Bug J), global regex name-mangling (Bug I), fail-open
  `_ensureBoundary` (NC-4), SPEC §15.11.6 violation (prop-passing not detected).
  3-expert debate: Type Tags (42/60), Crossing Points (48/60), Extended
  Interprocedural Taint (54/60 — winner). Implementation: `closureCaptures`
  map + fixed-point taint propagation in `route-inference.ts`, call-graph BFS
  for transitive reactive deps in `reactive-deps.ts`, `_ensureBoundary`
  graduated to diagnostic fail-safe with `SCRML_STRICT_BOUNDARY=1` strict mode.
  +15 tests in `boundary-security.test.js`.

- **Bug I (codegen) — name-mangling bleed through spaced member expressions.**
  Lookbehind `(?<!\.)` missed emitter's spaced `.` output (`n . lines`).
  Fix: variable-length `(?<!\.\s*)`. +7 tests.

- **Bug H (codegen) — function return-type match drops return.**
  Missing `return` before match-expression IIFEs when `function` (not `fn`)
  has `-> T` or `: T` return-type annotation. Fix: `hasReturnType` flag on
  function-decl AST nodes; `emitFnShortcutBody` applies implicit return when
  set. +5 tests.

- **Bug K (runtime) — sync-effect throw halts caller.**
  `_scrml_trigger()` dispatched effects without try/catch. A throwing derived
  expression propagated through `_scrml_reactive_set` → user function, halting
  subsequent reactive writes. Fix: try/catch per effect, consistent with
  existing subscriber pattern. +5 tests.

- **GITI-009 (codegen) — relative-import forwarding against source path.**
  Server JS emitted import paths verbatim from source `.scrml`; wrong when
  output directory differs. Fix: `rewriteRelativeImportPaths()` post-processor
  in `api.js` resolves against source dir then computes relative from output dir.
  +16 tests.

- **GITI-011 (tokenizer+codegen) — CSS at-rule handling.**
  `tokenizeCSS()` had no `@` handler. `@import`, `@media`, `@keyframes` etc.
  mangled into property declarations (`media: ;`). Fix: new `CSS_AT_RULE` token
  type with depth-tracked brace matching for block at-rules, semicolon-terminated
  for statement at-rules. AST builder stores verbatim text; `emit-css.ts`
  passthrough. +19 tests.

- **ExprNode Phase 4d — structured inline match arms.**
  Inline match arms (`. Variant => result`) now produce structured
  `match-arm-inline` AST nodes instead of raw `bare-expr` strings. Codegen
  uses pre-parsed fields (test, binding, result, resultExpr) instead of
  regex-parsing `.expr` at emit time. Also fixed two token-kind bugs in S27
  arm-boundary detection (`=>` is OPERATOR not PUNCT, `::` is OPERATOR not
  PUNCT). +19 tests.

- **ExprNode Phase 4d — render preprocessor.**
  `render name()` → `__scrml_render_name__()` in `preprocessForAcorn`,
  following the same pattern as 6 existing preprocessor rules. Produces
  proper `CallExpr` ExprNode instead of escape-hatch. Enables CE to switch
  from string regex to ExprNode structural matching, unblocking
  `bare-expr.expr` field deletion.

- **ExprNode Phase 4d — steps 1-7 merged.** ExprNode-first paths across
  `body-pre-parser.ts`, `component-expander.ts`, `type-system.ts`,
  `dependency-graph.ts`, `meta-checker.ts`. `bpp.test.js` GIT_DIR leak fix.

- **Multi-DB SQL deep-dive.** Bun.SQL template literals (SPEC §44 mandate).
  4-phase plan: (1) SQLite→Bun.SQL, (2) Postgres, (3) MySQL, (4) edge DBs.
  Per-stage change assessment with file:line references. Phase 1 code
  complete in concept; merge deferred to S40 due to branch divergence.

- **README:** giti added to Related Projects, broken 6nz relative links
  fixed to absolute GitHub URLs.

- **Maps refreshed:** 11 maps + non-compliance report regenerated.

- **master-list.md refreshed** to S39 (was ~15 sessions stale).

### 2026-04-22 (S38 — adopter-bug wave + CSRF bootstrap + SPEC §22.3 multi-`^{}`)

Eight commits, all pushed to origin/main. Four adopter bugs from the 6nz
2026-04-21 batch shipped (Bugs 1, 3, 4, 5), GITI-010 CSRF bootstrap blocker
resolved, Bug-5 mixed-case follow-on hoist, SPEC §22.3 terminal bullet
ratifying multi-top-level `^{}` source-order semantics (5-expert debate,
minimum-delta won), and a classifier bug surfaced during multi-`^{}`
testing fixed the same day. Suite 7,383 → 7,463 (+80 net tests), zero
regressions throughout.

- **Bug 1 (ast-builder) — string literal escapes double-escaped in emit.**
  8 identical `STRING`-token re-quote sites in `ast-builder.js` used
  `.replace(/\\/g, "\\\\").replace(/"/g, '\\"')` on the tokenizer's raw
  inner text. Tokenizer stores source-as-written (`"a\n b"` → 4 chars:
  `a`, `\`, `n`, `b`); the `.replace` doubled every backslash → `"a\\nb"`
  in emitted JS → parses as literal backslash+n, not LF. Every escape
  sequence affected; leaked into bug-2 and bug-6 reproducers too. Fix:
  new `reemitJsStringLiteral(rawInner)` helper interprets standard
  escapes (`\n \t \r \\ \" \' \0 \b \f \v \xHH \uHHHH \u{HHHHHH}`) then
  `JSON.stringify`s — canonical double-quoted JS literal. 11 unit tests.
  Commit `41aa7c0`.
- **Bug 3 (ast-builder) — `return X + y` dropped after `const y = A ? B : C`.**
  Root cause: `collectExpr`'s angle-bracket tracker bumped `angleDepth`
  unconditionally when `<` was followed by IDENT. In `base < limit`,
  no matching `>` appeared — `angleDepth` stayed at 1, disabling the
  `STMT_KEYWORDS` boundary check. Greedy collect ate `return base + min`
  into the expression; meriyah rejected the mashed string; downstream
  silently dropped the tail. Fix: before bumping `angleDepth`, check
  whether the previous consumed token is a clearly value-producing token
  (IDENT, AT_IDENT, NUMBER, STRING, `)`, `]`). If so, `<` is a less-than
  comparison. 11 unit tests. Commit `3778d76`.
- **Bug 5 (codegen) — pure keyed-reconcile skips outer `_scrml_effect`.**
  `emit-reactive-wiring.ts` unconditionally wrapped any reactive-deps
  lift group in `_scrml_effect`. Reactive for-lift emits already contain
  `_scrml_effect_static(renderFn)` which handles re-reconciliation on
  `@items` mutation in-place. The outer effect re-created the list
  wrapper div per mutation — 6nz observed `3 → 8 → 15` `<li>` children
  on sequential clicks. Fix: detect pure-keyed-reconcile (combinedCode
  has `_scrml_reconcile_list(` AND no other `_scrml_reactive_get(`
  outside reconcile calls, via balanced-paren `stripReconcileCalls`
  helper) and skip the outer wrap. 6 unit tests. Narrow-scope caveat:
  mixed-case (keyed reconcile + other reactive reads) still had a
  pre-existing wrapper-re-creation issue — shipped as separate follow-on
  `8691f75` the same session. Commit `b37769c`.
- **GITI-010 (codegen) — CSRF bootstrap mint-on-403 + client single-retry.**
  Baseline CSRF 403 response emitted no `Set-Cookie`, so cookie-less
  first POST returned 403 forever. User ratified Option A after A/B/C
  trade-off analysis. Three-sided fix: (1) server baseline path — 403
  now includes `Set-Cookie: scrml_csrf=${token}; Path=/; SameSite=Strict`;
  (2) middleware CSRF paths — split missing-vs-mismatched cookie (missing
  gets mint+retry, mismatched gets terminal 403); (3) client — new shared
  `_scrml_fetch_with_csrf_retry(path, method, body)` helper that retries
  exactly once on 403 re-reading `document.cookie`. Helper emission gated
  behind `hasMutatingCsrfServerFn` so SSE-only files don't emit dead
  code. Auth-middleware CSRF path deferred to its own fix. 9 unit tests.
  Commit `40e162b`.
- **Bug 4 (codegen) — named derived reactive refs get DOM wiring.**
  Two-layered root cause: (1) `collectReactiveVarNames` in `reactive-deps.ts`
  collected `reactive-decl` and `tilde-decl` but not `reactive-derived-decl`
  — `${@isInsert}` had `reactiveRefs` computed as empty, emit-event-wiring
  saw `varRefs.length === 0`, skipped the wiring block entirely (silent
  render bug). (2) Once wiring emission was restored, the rewrite emitted
  `_scrml_reactive_get("isInsert")` instead of `_scrml_derived_get(...)`
  because `emitExprField` calls in emit-event-wiring didn't pass
  `ctx.derivedNames`. Fix: (a) add `reactive-derived-decl` to the name
  collector; (b) populate `ctx.derivedNames` via `collectDerivedVarNames`
  at both CompileContext construction sites; (c) thread `derivedNames`
  through the markup-interpolation `emitExprField` calls. 8 unit tests.
  Commit `adbc30c`.
- **Mixed-case for-lift wrapper hoist (follow-on to Bug 5).** Logic blocks
  combining keyed for-lift with other reactive content stacked two bugs:
  (a) wrapper re-created per outer-effect fire; (b) conditional lift
  accumulated without `innerHTML=""` (skipped to preserve wrapper). Fix:
  detect mixed case and hoist for-lift setup OUTSIDE the outer effect
  via `hoistForLiftSetup(combinedCode)` — regex + balanced-brace
  extraction of wrapper decl, `createFn`, `renderFn`, first `renderFn()`
  call, `_scrml_effect_static(renderFn)`. Effect body retains
  `_scrml_lift(wrapper)` which re-mounts the same node (appendChild
  MOVES, wrapper's reconciled children persist). With wrapper hoisted,
  `innerHTML=""` restored at effect top — safe. Fixes both (a) and (b)
  in one pass. 11 unit tests. Commit `8691f75`.
- **SPEC §22.3 — multi-top-level `^{}` source-order normative rule.**
  Ratified by 5-expert debate (elm-architecture 34, template-haskell 45,
  zig-comptime 46, racket-phases 44, scrml-radical-doubt **53/60 — winner**).
  Minimum-delta wins: codify existing compiler behavior, **do NOT**
  introduce `^init{}`/`^mount{}`/`^teardown{}` keywords. One bullet
  appended to §22.3 Normative statements (top-level = file scope; each
  block classified independently per §22.4/§22.5; source order within
  phase; DOMContentLoaded-already-fired clause; mixed compile-time+runtime
  permitted). scrml-language-design-reviewer 2-pass review: pass 1 REVISE
  (4 issues) → pass 2 CLEAN. Two debate-curator hallucinated citations
  caught + stripped before merge (nonexistent "insight 40" and "file-
  scoped compile-time accumulator"). 6 unit tests + 1 sample. Commit
  `6609fb6`.
- **`emit.raw(...)` classifier compile-time detection (surfaced same day).**
  `^{ emit.raw("<p>...") }` was classifying as runtime meta — emitting
  `_scrml_meta_effect(...)` with body `emit.raw(...)` that would CRASH
  at runtime (per §22.5.1, `emit.raw` has no runtime counterpart). Root
  cause: `testExprNode` in `meta-checker.ts` used `exprNodeContainsCall(exprNode, "emit")`
  which only matches bare `emit(...)`; for `emit.raw(...)` the callee
  is a MemberExpr, not an IdentExpr. String-fallback regex DID catch
  it, but ExprNode path runs first and short-circuits. Fix: new
  `exprNodeContainsEmitRawCall` helper walks for CallExpr with
  MemberExpr callee matching `emit.raw`. Wired into `testExprNode`.
  7 unit tests. Commit `cfb1a14`.

Process highlights:
- Verify-before-fix applied throughout — every bug had a confirmed repro
  before any source edit.
- Write-test-always applied throughout — each fix shipped with tests.
- SPEC edit gated by 2-pass scrml-language-design-reviewer discipline
  (1 REVISE → 1 CLEAN).
- Radical-doubt debate-curator flow executed on the multi-`^{}` question.
- Two debate-agent hallucinations (invented insight + invented compiler
  concept) caught during the pre-merge review and stripped.

### 2026-04-19 → 2026-04-21 catch-up (S29–S37, consolidated)

Nine sessions' worth of commits that were never individually logged. Organized by arc rather than session-by-session for readability.

**S29 — ast-builder component-def gate (2026-04-19).** `const X = <markup>`
without explicit RHS markup was parsing as a runtime const-decl but
being treated downstream as a component. Fix at `b189051` adds markup-
RHS requirement for uppercase-name const decls. Wrap at `4823519`.

**S30 — adopter friction audit, 4 fixes (2026-04-19/20).** Four
adopter-facing polish items landed:
- `8217dd9` — `package.json` bin points to `compiler/bin/scrml.js` (executable entry fixed for users installing via npm link).
- `2eb4513` — CSS tokenizer no longer collapses element-leading compound selectors to declarations.
- `f0e7222` — CLI surfaces ghost-pattern lint diagnostics by default (W-LINT-011..015).
- `e8ddc8d` — W-LINT coverage extended to Vue and Svelte ghost patterns.
Wrap at `a6ce8c6`.

**S31 — adopter polish + fate-of-fn debate verdict (2026-04-20).**
Two adopter fixes (`ebd4d1d` F5 — bare ident referencing reactive
without `@` is now E-SCOPE-001; `26df45d` F6 init-safety + F10 README
bun link step) plus a multi-expert inline debate on whether `fn` should
be retired, merged with `pure function`, or elevated into a state-
typestate contract. Insight 21 ratified (commit `1d1c49d`): fate-of-fn
verdict leans toward `pure fn` as redundant-but-permitted, deferred the
state/machine-completeness strengthening to S32's phased implementation.
Wrap at `696b787`.

**S32 — state/machine cluster, Phases 1–3 (2026-04-20/21).** Fate-of-fn
verdict translated to incremental compiler work:
- Phase 1a/1b: E-FN-006 renamed E-STATE-COMPLETE; widened to `function`
  bodies (§54.6.1 universal scope).
- Phase 2: `pure fn` parser support + W-PURE-REDUNDANT warning.
- Phase 3a–3e: substate blocks tagged with `isSubstate` + `parentState`;
  registered with parent's `substates` set; substate match exhaustiveness
  wired; `resolveTypeExpr` falls back to `stateTypeRegistry`;
  `< Substate>` recognized as match arm pattern. Substate match is now
  end-to-end live.
- 31 normative statements from Insight 21 registered as skipped gating
  conformance tests (commit `328b6ab`) — to be un-skipped as phases
  land.
Wrap at `593f52f`.

**S33 — state Phase 4a–4g + adopter bug salvo (2026-04-21).** Phase 4
of the state cluster plus 9 adopter bugs shipped:
- Phase 4a/b: block-splitter recognizes transition-decl body + AST
  transition-decl node.
- Phase 4c: `StateType.transitions` registry hook.
- Phase 4d: `from` contextual keyword + params binding in transition
  bodies.
- Phase 4e: E-STATE-TRANSITION-ILLEGAL at call site.
- Phase 4f: E-STATE-TERMINAL-MUTATION on field writes to terminal
  substates.
- Phase 4g: fn-level purity enforcement in transition bodies (§33.6).
- 9 adopter bugs: Object.freeze comma emission (E); `event` threading
  in bare-call handlers (A); scope-aware mangling to skip property
  access (D); GITI-002 imported names in scope; declaredNames threading
  through control-flow (B + F); block-body arrows in call-arg position
  (C); GITI-005 `${serverFn()}` markup interpolation wiring; GITI-003 +
  GITI-004 server/client boundary import pruning + server-context lift;
  GITI-001 await server-fn reactive-set + skip empty-url `<request>`.
- S32 conformance tests un-skipped for the 9 Phase-4 statements now
  covered (`36eadb9`).
Wrap at `eab5251`.

**S34 — map refresh + 2 GITI lift/css adopter fixes (2026-04-21).**
Narrow session:
- `3f79d71` — GITI-008: coalesce consecutive text tokens in lift markup.
- `b8f3b51` — GITI-007: descendant combinator selector recognition.
- Project-map + master-list refresh. Wrap at `d6e8288`.

**S35 — codegen refactor C-arc (2026-04-21).** Nine-step codegen cleanup
migrating call sites from legacy `rewriteExpr` to the
`emitExprField`-with-`derivedNames` pattern. Steps 1–9 commits
`3f8d88c`, `099a30a`, `36b02ec`, `03aad3d`, `6cdcc7f`, `3c2e848`,
`03a0c56`, `9501371`, `54bcab7`. Also `fd51d70` required boundary on
`EmitLogicOpts` (B2 refactor gate — boundary is no longer optional);
`8c64a98` added per-file WinterCG fetch handler + aggregate routes.

**S36 — context-carry snapshot (2026-04-21).** No commits shipped;
interrupted mid-arc. Content rolled into S37.

**S37 — fn/pure unification + Bug G + Bug 6 + adopter external-JS doc
(2026-04-21 → 2026-04-22).** Major arcs:
- `83e6896` — Bug G parser: `fn` shorthand accepts `-> ReturnType` annotation.
- `d40afbe` — Bug G codegen: `fn` shorthand implicit-return for tail
  expressions (match, switch, bare-expr).
- `6d9b62a` — §33.3 / §48 spec consolidation: unify `fn` ≡ pure function,
  retire E-RI-001, absorb non-determinism + async into §33.3. Three
  `scrml-language-design-reviewer` passes surfaced 6 cross-section
  contradictions the first-pass eyeball missed.
- `ccae1f6` — E-RI-001 code cleanup across PIPELINE.md, route-inference.ts,
  lsp/server.js, stale test headers.
- `c7198b6` — Phase 0 item 2: adopter-facing `docs/external-js.md`
  translation table (zod→§53 is the anchor; lodash/date-fns/cm6 etc.).
- `f6fb0cc` — Bug 6: `^{}` meta-checker no longer collects function-local
  decls as module-scope (over-capture fix).
- 2 ratified debates: B1+B3 refactor DEFER (insight 23 staged) and
  NPM compat-tier Phase-0-first verdict (insight 24 staged). Radical-
  doubt explicitly overturned user bias on the compat-tier question —
  user: "Accept verdict, I'm thrilled to be wrong here."
- 6-bug triage of 6nz batch: 1, 4 confirmed HIGH; 3, 5 confirmed; 2
  dismissed (downstream effect of bug 4); 6 fixed same session.
- Wrap + pa.md rule updates at `9540518`.

### 2026-04-19 (S28 — validation elision arc + 5 adjacent fixes)

The S27-queued static-elision deep-dive shipped end-to-end across four
codegen slices plus a §51.5.2 spec amendment. Five additional gaps closed
on the warm context: §51.13 phase 7 (guarded projections), §51.14
E-REPLAY-003 (cross-machine replay), two long-standing parser bugs,
test-helper centralization, and §19 error-arm scope-push (S25-queued).
Suite 7,126 → 7,183 pass (+57 new tests). Dual-mode parity verified
(default vs. `SCRML_NO_ELIDE=1`).

- **§51.5 validation elision (4 slices + spec).** `classifyTransition` +
  `emitElidedTransition` in `emit-machines.ts` drop variant extraction,
  matched-key resolution, and the rejection throw for transitions the
  compiler can prove legal at compile time. Side-effect work — §51.11
  audit push, §51.12 timer arm/clear, §51.3.2 effect block, §51.5.2(5)
  state commit — is preserved on every elided site (spec normative).
  Coverage: Cat 2.a/2.b literal unit-variant against unguarded wildcard
  rule with no specific shadow; Cat 2.d payload constructors via
  balanced-paren scanner; Cat 2.f trivially-illegal target → compile-
  time **E-MACHINE-001** (closes §51.5.1's symmetric obligation). Slice
  4 adds `setNoElide()` / `SCRML_NO_ELIDE=1` env var for CI dual-mode
  parity. §51.5.1 illegal detection runs BEFORE the no-elide gate
  (normative obligation, not optimization). Spec §51.5.2 normative
  bullets rewritten to clarify "runtime guard" = validation work
  specifically. Commits `01f5847` `cb25aaa` `59b35a1`. Backed by
  `scrml-support/docs/deep-dives/machine-guard-static-elision-2026-04-19.md`.
- **§51.13 phase 7 — guarded projection-machine property tests.** Mirrors
  phase 2's parametrization model. Inlined projection harness takes a
  `guardResults` map keyed on rule label; generator walks each source
  variant's rules in declaration order emitting one test per guarded
  rule (truthy case) plus a terminal test (unguarded fallback or
  `undefined` when all-guarded). Same labeled-guards constraint carries
  over from phase 2. Commit `2f3f95e`.
- **§51.14 E-REPLAY-003 — cross-machine replay rejection.** §51.14.6
  non-goal lifted. Reverse map `auditTarget → machineName` via existing
  `machineRegistry` lets the compile-time validator detect when `@log`
  is the audit target of machine A and `@target` is governed by
  machine B. Synthetic-log replays (logs not declared as any machine's
  audit target) still permitted — user-managed. No audit-entry-shape
  change required. Commit `6c1dfe7`.
- **§51.3 multi-statement effect bodies.** `parseMachineRules` previously
  split rule lines on `raw.split(/[\n;]/)`, which fragmented effect
  bodies containing `;` like `.A => .B { @x = 1; @y = 2 }` into three
  broken lines (silent — first rule had unterminated brace, second was
  dropped). Replaced with depth-tracking `splitRuleLines` that respects
  `{}` / `()` / `[]` depth, strings (single/double/backtick), and
  comments (line/block). Surfaced in S27 wrap. Commit `17b8972`.
- **§14.4 single-line payload enums.** `parseEnumBody` split the variants
  section on `\n` only, so a declaration like
  `{ Pending, Success(value: number), Failed(error: string) }` collapsed
  into one "line" that the payload branch silently rejected, registering
  zero variants. Downstream symptom: any `< machine for=Result>` reference
  fired E-MACHINE-004 "Valid variants: ." (empty list). Fixed by splitting
  on `["\n", ","]` at top level — `splitTopLevel` already tracks `()`
  depth so payload field commas stay with their variant. Backfilled the
  slice-2 runtime-E2E tests deferred earlier in the session. Commit `fdb43f0`.
- **§19 error-arm handler scope-push (S25 queue).** Pre-S28 the
  `guarded-expr` case in `type-system.ts` did exhaustiveness analysis on
  `!{}` arms but never walked arm.handlerExpr through the scope checker —
  undeclared idents in handlers compiled cleanly, and the caught-error
  binding (`::X(e) -> use(e)`) was invisible. Symmetric with propagate-
  expr's binding push: enter a child scope per arm, bind `arm.binding`,
  walk the handler, pop. Commit `a15cdb6`.
- **Test-helper centralization + bare-keyword gotcha.** New
  `compiler/tests/helpers/extract-user-fns.js` replaces 8 duplicated
  `knownInternal` regexes across S27/S28 test files. Bare-word entries
  (`effect`, `lift`, `replay`, `subscribe`, etc.) gain `(?!_\d)` negative
  lookahead so a user fn named `effect` (which mangles to `_scrml_effect_5`)
  no longer gets filtered as the internal `_scrml_effect` helper. Doc
  comment in `var-counter.ts` documents the `_scrml_<safe>_<N>` mangle
  convention. Commit `5c61438`.
- **Regression tests (+64).** New `compiler/tests/unit/gauntlet-s28/`
  with 6 files: elision slice-1 (22 tests), slices 2-4 (17 tests),
  multi-stmt effect body (6), payload-enum comma-split (5), projection-
  guard phase-7 (8), error-arm scope (6). Plus 8 S27 test files refactored
  to use the shared helper, 3 S25 temporal tests retargeted (assignments
  to undeclared targets are now compile-errors), 1 S26 phase-6 test
  retargeted (unlabeled vs labeled-guarded projection), 1 S27 cross-
  machine replay test flipped to assert E-REPLAY-003.

### 2026-04-19 (S27 — §2b G free audit/replay shipped + 4 silent runtime fixes)

Single-arc session: §2b G (the audit/replay deep-dive item) shipped end-
to-end across two slices, but the real story was the four pre-existing
silent-runtime bugs that surfaced during testing. S26's auto-property-
test harness synthesized its own `{variant, data}` objects which
ironically masked the fact that the real transition guard was broken
for unit-variant enums. Suite 7,069 → 7,126 pass (+57 new tests).

- **§51.11.4 audit entry shape extension.** Audit entries gain `rule` +
  `label` fields alongside `from` / `to` / `at`. `rule` is the canonical
  wildcard-fallback-resolved table key (`"A:B"` exact, `"*:B"` wildcard
  target, etc.); `label` is the identifier from a `[label]` clause on the
  matched rule. `emitTransitionTable` bakes labels into table entries
  (`{ guard: true, label: "foo" }`); `emitTransitionGuard` computes
  `__matchedKey` alongside `__rule` via a parallel ternary fallback chain.
  Commit `224847d`.
- **§51.11 audit completeness — timer transitions + freeze.**
  `_scrml_machine_arm_timer` signature extended with a `meta` payload
  carrying `auditTarget` + `rulesJson`. Timer expiry now both pushes the
  audit entry AND re-arms downstream temporal rules so chained temporals
  (A after 1s => B, B after 1s => C) cascade automatically. Every audit
  entry is `Object.freeze`'d on both push paths (transition guard and
  timer expiry) per §51.11.4. Commit `267ed61`.
- **§51.14 replay primitive — `replay(@target, @log[, index])`.** New
  spec section (~210 lines). Function-call syntax (no new keyword);
  target is name-string via @-ref, log is reactive_get, index is any
  integer expression. Runtime helper `_scrml_replay(name, log, endIdx?)`
  bypasses transition guard, audit push, and clears pending temporal
  timers; fires subscribers + derived propagation + effects normally.
  Compile-time recognition in `emit-expr.ts` structured-call path +
  fallback `rewriteReplayCalls` pass for non-structured contexts.
  Commit `00ba7d3`.
- **§51.14 replay compile-time validation (G2 slice 2).** **E-REPLAY-001**
  (target must be machine-bound reactive) and **E-REPLAY-002** (log must
  be declared reactive) via duck-typed recursive AST walker that visits
  every `CallExpr` whose callee is `ident "replay"`. Two sub-messages
  for E-REPLAY-001 distinguish "declared but not machine-governed" from
  "undeclared in scope". Commit `2453062`.
- **§51.5 unit-variant transitions crash at runtime — fix.** Pre-S27
  `__prev.variant` extraction fell back to `"*"` for bare-string unit
  variant values, producing key `"*:*"` that missed every declared rule
  and threw E-MACHINE-001-RT. Every machine-governed unit-variant enum
  was unusable in practice. Hidden by shape tests + the S26 property-
  test harness that synthesized its own variant objects. Three real
  end-to-end tests now compile + execute the guard via SCRML_RUNTIME in
  a `Function()` sandbox. Commit `eff8188`.
- **§51.5 guarded wildcard rules fire guard + effect — fix.** `* => .X
  given (…)` was treated as unguarded at runtime because the guard /
  effect comparisons keyed on `__key` (literal `prev:next`) instead of
  the `__matchedKey` the runtime actually resolved to. One-line fix in
  each branch. Commit `abfe637`.
- **§51.5 effect-body @-refs compile through `rewriteExpr` — fix.** Effect
  bodies like `{ @trace = @trace.concat(["x"]) }` emitted literal `@`
  tokens (invalid JS) because emit-machines inserted `rule.effectBody`
  raw. Wrapped in `rewriteExpr` so effect bodies behave like any other
  bare statement. Commit `73225f7`.
- **§18 match-arm expression-only form on a single line — fix.**
  `match x { .A => 1 .B => 2 }` triggered E-TYPE-020 because
  `splitMatchArms` only split on newlines, hiding B and later arms from
  the exhaustiveness checker. Replaced with a char-level scanner that
  tracks brace/paren/bracket depth, strings, and comments, recognizing
  arm-header starts inline. Defensive `collectExpr` tightening in
  `ast-builder.js` as a second layer. Commit `5d0bdc6`.
- **Runtime-test convention established.** Several S27 tests execute
  compiled output via `SCRML_RUNTIME` in a `Function()` sandbox to catch
  silent-runtime bugs. Pattern: regex-extract user fn names from compiled
  JS, closure-capture them into a `userFns` object. New compiler features
  that claim runtime behavior should use this pattern rather than shape-
  only assertions — every pre-existing bug closed in S27 went undetected
  for months under shape-only testing.

### 2026-04-18 (S26 — §2b F: auto-generated machine property tests, phases 1-6)

§51.13 `--emit-machine-tests` shipped end-to-end across six phases in a
single session. Slogan: **machine = enforced spec**. The declared
transition table IS the oracle; generated tests confirm the compiled
machine refuses everything the table doesn't allow. Suite 7,006 → 7,069
pass (+63 new tests).

- **§51.13 phase 1 — exclusivity (property a).** Generator emits a bun:test
  suite per `< machine>` declaration: for every reachable variant V and
  every variant W in the governed enum, declared `(V → W)` pairs SHALL
  succeed and undeclared pairs SHALL throw E-MACHINE-001-RT. New
  `compiler/src/codegen/emit-machine-property-tests.ts` (425 LOC) +
  CLI flag `--emit-machine-tests` writes `<base>.machine.test.js`
  alongside the user-test `<base>.test.js`. Inlined `tryTransition`
  harness uses `globalThis._scrml_reactive_store` so tests don't bleed
  into the real reactive runtime. Commit `24089c5`.
- **Machine guard rewriteExpr fix.** `< machine>` rule guards captured raw
  scrml text but emitted unmodified, so guards referencing `@reactive`
  refs emitted invalid JS (raw `@name` token). Now run through `rewriteExpr`
  before emission. Same root cause that S27 found in effect bodies.
  Commit `b84dadf`.
- **Parser fix — typed `const @name:` decls preserve initializer.** Pre-
  S26 `const @gate: boolean = true` lost its `= true` initializer because
  the typed-const parser branched into a path that didn't capture the
  RHS. Surfaced while writing phase-1 tests that needed reactive-bound
  gate vars. Commit `19e8b29`.
- **§51.13 phase 2 — guard coverage (property c).** Each LABELED `given`
  guard SHALL receive one passing test (truthy → succeeds) and one
  failing test (falsy → E-MACHINE-001-RT). Tests parametrize the guard
  result rather than evaluating the real expression — harness takes a
  `guardResults: Map<ruleKey, boolean>` and dispatches on it. Real-
  expression evaluation deferred to a future phase that needs input
  synthesis. Unlabeled guards skip the enclosing machine entirely so
  every guard in a generated suite has a human-readable identifier.
  Commit `81d6d5c`.
- **§51.13 phase 3 — payload-bound rule support.** §51.3.2 binding-group
  rules now in scope. The harness is binding-transparent — it never
  invokes the real machine IIFE, so declared destructuring is never
  executed in generated tests. Filter relaxed accordingly. Commit `4bd9ca6`.
- **§51.13 phase 4 — wildcard rule support.** `*` as the from-variant
  matches any already-reachable variant; `*` as the to-variant expands
  the reachable set to every variant declared on the governed enum.
  Pair resolution follows the four-step fallback chain used by
  `emitTransitionGuard`: exact → `*:To` → `From:*` → `*:*`. Harness
  tracks the matched table key so `guardResults` keys on the matched
  (possibly-wildcard) rule rather than the concrete input pair. Commit
  `3156b5d`.
- **§51.13 phase 5 — temporal rule support.** §51.12 temporal rules
  contribute exclusivity + guard-coverage tests just like non-temporal
  rules — the `(.From, .To)` pair is a declared transition regardless of
  how it fires. Test titles get an `(after Nms)` annotation so temporal
  rules are visible in the suite. EXPLICITLY OUT OF SCOPE: timer lifecycle
  itself (arm/clear/reset on variant entry/exit/reentry). Verifying that
  needs a live runtime with fake-timer control; the self-contained
  harness doesn't invoke runtime code. Generated file emits a header
  comment surfacing this scope boundary so users cover timer lifecycle
  with hand-written integration tests. Commit `eecaa89`.
- **§51.13 phase 6 — projection machine support.** §51.9 derived
  machines emit through a distinct path. No transition table; reading
  `@projected` delegates through `_scrml_project_<Name>(source)`. The
  property under test is **(d) Projection correctness** — for every
  source variant V, the projection function returns the target variant
  declared by the first matching rule. Generated suite inlines a minimal
  copy of the projection function (mirroring `emitProjectionFunction`)
  and emits one test per source variant. Phase 6 covered unguarded
  projections only; guarded projections deferred to phase 7 (shipped
  S28). Commit `0af336e`.

### 2026-04-18 (S25 — §2h lin redesign cleanup + §51.12 temporals + §51.11 audit clause)

Two arcs in one session: closing the lin redesign work (Approach B —
restricted intermediate visibility) and shipping §51.12 temporal
transitions (`.From after Ns => .To`). Plus the §51.11 `audit @log`
clause that S27 would later build replay on top of. Suite 6,949 →
7,006 pass (+57 new tests).

- **§35.5 E-LIN-005 — reject let/const/lin shadowing an enclosing lin.**
  Per Approach B, intermediate visibility means a lin in an outer scope
  is visible (and consumable) by inner scopes, but cannot be SHADOWED
  by an inner declaration of the same name. New error fires for `let x`,
  `const x`, and `lin x` declarations that would shadow an enclosing
  `lin x`. Commit `6f5b90c`.
- **§35.5 push scope for while-stmt so E-LIN-005 fires in while bodies.**
  Companion fix — without scope-push, while-body declarations weren't
  checked against the enclosing lin. Commit `b6c4f5d`.
- **§51 emit effect blocks for rules without a `given` guard — fix.**
  Pre-S25 the effect-block emission filter ran over `guardRules`, which
  silently dropped effect-only rules (no guard). Now uses `effectRules`.
  Commit `3556b22`.
- **§35.1 / §35.2 wording — Approach-B restricted intermediate visibility.**
  Spec text aligned with the implemented semantics: lin variables are
  visible across all sibling and child scopes within the same `${}`
  block, but shadowing is rejected. Companion §35.2.2 ratifies cross-
  `${}` block lin via the same model. Commits `0e52306` `83101c7`.
- **§2a scope push for match-arm-block + if-stmt branches.** Match arms
  and if branches each get a fresh child scope so declarations inside
  one branch don't leak into siblings. E-SCOPE-001 now fires correctly
  for refs inside an arm body that don't resolve up the chain. Commits
  `5ab63ac` `4b1e8b2`.
- **§35.5 E-LIN-006 — reject lin consumption inside `<request>` /
  `<poll>` body.** Async lifecycle elements re-execute their body on
  every refresh cycle, which would consume the lin multiple times.
  Compile-time check + diagnostic naming the lin and the lifecycle
  element. Commit `e171e33`.
- **`docs/lin.md` how-to guide.** User-facing walkthrough of the lin
  keyword: declaration, consumption, scope visibility, shadowing rules,
  E-LIN-005/006 examples. Commit `3b8f2db`.
- **§51.3.2 machine opener migration — sentence form → attribute form.**
  `< machine OrderFlow for OrderStatus { ... } /` (sentence form)
  migrated to `< machine name=OrderFlow for=OrderStatus> ... </>`
  (attribute form). The attribute form aligns with how every other
  custom-element opener parses. The old sentence form stays parseable
  for back-compat but the canonical form is now the attribute one.
  Touched all examples, docs, and the spec. Commit `347ac02`.
- **§51.12 temporal machine transitions — `.From after Ns => .To`.** New
  rule grammar: `after Ns` (or `0.5s`, `500ms`, `3m`, `1h`) between
  `.From` and `=>`. Wildcard `from` rejected at parse time
  (E-MACHINE-021); concrete from-variant only. Each temporal rule arms
  a timer when the machine enters its from-variant; on expiry the
  timer commits the transition and re-arms downstream temporals.
  `_scrml_machine_arm_timer` / `_scrml_machine_clear_timer` runtime
  helpers. Cross-cutting interaction with §51.11 audit (S27 closed
  the audit-completeness gap for timer-fired transitions). Commit
  `7305ac1`.
- **§51.11 audit @varName clause.** New machine-body clause `audit @log`
  declares a reactive array as the destination for transition entries.
  Each successful transition appends `{from, to, at}` (extended to
  `{from, to, at, rule, label}` in S27). Foundation for S27's `replay`
  primitive. Commit `c5e41b3`.
- **Parser fix — statement boundary on `@name:`.** S22 had a known
  pre-existing BPP bug where two consecutive `@foo: SomeMachine = ...`
  reactive-decls on adjacent lines silently dropped the second one. S25
  fixed it: the boundary detector now recognizes `@<ident>:` as a
  statement start. Commit `e37a6fd`.

### 2026-04-18 (S24 — §2a E-SCOPE-001 coverage sweep + §2b/c/d/e/f/g fixes)

§2a scope-checker rolled out across the full statement / expression
surface in nine slices. Plus a clutch of small §2b–§2g fixes from a
gauntlet pass. Suite 6,889 → 6,949 pass (+60 new tests).

- **§2a E-SCOPE-001 sweep — nine slices.** Pre-S24 `E-SCOPE-001`
  (undeclared identifier in logic expression) only fired in a few
  expression contexts. S24 extended coverage to: let/const initializers
  (`9e06884`), reactive-decl initializers (`234f116`), loop-scope
  plumbing + if/return/match-subject/propagate (`e1e21a5`), lin / tilde
  / reactive-derived decls (`ec26c63`), structured assignment RHS
  (`740de7d`), throw / fail / debounced / value-lift (`a758fe1`), and
  bare-expr statements + two supporting fixes (`bb01644`). Each slice
  shares the same pattern: walk the expression's ExprNode (or string
  fallback) through `checkLogicExprIdents` against the current scope
  chain, raising E-SCOPE-001 with a context-specific suggestion.
- **§2b/d phase separation + nested `^{}` at checker-time.** Two meta-
  context fixes: (b) the phase-separation check (compile-time `^{}` vs
  runtime `^{}` content) now runs at meta-checker time instead of eval-
  time, catching the error before it'd crash the eval; (d) nested `^{}`
  in compile-time meta no longer crashes — it's flagged as a clear
  E-META error. Commit `9f2a247`.
- **§2c match subject narrowing for local let/const + function params.**
  Match expression subject narrowing previously only worked for top-
  level reactives. Extended to let/const-bound locals and function
  parameters via the same scope-chain lookup. Commit `c1d71dd`.
- **§2c/§2a meta DG fixes.** Dependency graph credits `meta.get` /
  `meta.bindings` reads as @var consumers (so the dep-graph properly
  tracks reactive dependencies through compile-time meta plumbing); lin
  consumption is now counted at `^{}` capture time rather than later.
  Commit `8711056`.
- **§2d DG credits @var refs in compound `if=(...)` attributes.** Custom-
  element `if=(@a + @b > 5)` previously credited only the leftmost @ref
  (S22 regression). Now every @ref in the parenthesized expression is
  added to the dep-graph so changes propagate correctly. Commit `e377223`.
- **§2e DG credits @var refs inside runtime `^{}` meta html-fragment
  content.** When meta html-fragment content references reactives
  (`^{ <p>${@count}</p> }`), every @ref is added to the dep-graph.
  Commit `ccfc0c0`.
- **§2f trim whitespace after variant-ref prefix in in-enum transitions.**
  `transitions { . Pending => .Processing }` (space after the dot)
  previously fired E-MACHINE-004 against a variant called `" Pending"`.
  Variant-ref normalization now trims whitespace between the prefix and
  variant name. Commit `4f72a45`.
- **§2g extension-less relative imports.** `import { x } from "./foo"`
  now resolves to `./foo.scrml` if the bare path doesn't exist. Aligns
  with TS / JS convention while keeping the explicit `.scrml` form valid.
  Commit `9da03a7`.
- **§4.11.4 / §51.3.2 spec ratification — machine cohesion.** After
  debate the team kept `given` (vs. moving guards to a separate `where`
  clause) and queued the machine-opener migration to attribute form for
  S25. Commit `d2bee47`.

### 2026-04-17 (S23 — meta-checker debt cleanup + DOM read-wiring + tutorial revamp)

Tighter session focused on closing meta-checker debt items, adding the
last piece of §51.9 derived machines (DOM read-wiring), and a tutorial
content sweep. Suite 6,875 → 6,889 pass (+14 new tests).

- **§51.9 DOM read-wiring for projected vars (`${@ui}`).** S22 slice 2
  shipped projection runtime but reading `@ui` in markup left the
  display element unwired because the dep-graph didn't know `@ui` was
  reactive. S23 synthesizes a reactive-decl-like AST node for the
  projected var during annotation so the dep-graph treats it as a
  consumer of the source @order. Reading `${@ui}` now updates correctly
  on @order writes. Closes the S22 known-blocker. Commit `5b5d636`.
- **Meta-checker fixes (4 items).** Phase separation runs at checker time
  (was eval time); nested `^{}` doesn't crash; DG credits `meta.get` /
  `meta.bindings` reads as @var consumers; lin captured by `^{}` is
  counted as consumed. Companion to S24's broader §2a coverage sweep.
  Commits `9f2a247` `8711056`.
- **Examples + tutorial refresh.** `examples/14-mario-state-machine.scrml`
  rewritten to showcase S22 §1a payload variants + §51.9 derived
  machines (the deferred S22 example update). All non-gauntlet sample
  files brought up to current idiomatic scrml. Tutorial §2.3/§2.4 updated
  to canonical syntax + new §2.10 state machines section. Commits
  `7045adf` `2ba4ccd` `e0455b6`.
- **MIT license + GitHub Pages landing.** scrmlTS went public under MIT.
  GitHub Pages landing page at `docs/landing/index.html` + SEO checklist
  in `docs/SEO-LAUNCH.md`. Custom domain CNAME set/unset cycle as the
  domain config landed. user-voice relocated out of the public repo to
  `scrml-support/user-voice-scrmlTS.md` (verbatim history split:
  pre-public archived, post-public continues in scrml-support per the
  per-repo PA scope rules). Commits `427b9ec` `46f007a` `99d9286`
  `5811ed2` `0801d98` `3e8f545`.

---

### 2026-04-17 (S22 — §51.9 slice 2: derived machines runtime + write rejection)

- **Projection function codegen.** `emit-machines.ts` now exports `emitProjectionFunction(machine)` producing `function _scrml_project_<M>(src) { ... }` that walks the projection rules top-to-bottom, dispatches on `src.variant ?? src`, and emits the destination variant as a plain string. Guarded rules emit `if (tag === X && (guard)) return Y;` so `given` clauses run at read time. Rules after an unguarded match are unreachable per §51.9.3 (unguarded terminates the alternation group).
- **Derived reactive registration.** `emitDerivedDeclaration(machine)` emits `_scrml_derived_fns["ui"] = () => _scrml_project_UI(_scrml_reactive_get("order"));` + dirty flag + downstream subscription. Reuses the existing §6.6 infrastructure: `_scrml_reactive_get("ui")` already delegates to `_scrml_derived_get` when the name is in `_scrml_derived_fns`, and writes to `@order` propagate a dirty flag via `_scrml_propagate_dirty` so DOM bindings on `@ui` re-read the projection.
- **emit-reactive-wiring.ts** routes derived machines past the transition-table emit (they have no runtime transitions to enforce) and into the new projection + declaration path. Transition tables are only emitted for non-derived machines.
- **E-MACHINE-017 write rejection** (type-system.ts `rejectWritesToDerivedVars`). Walks the AST once after `validateDerivedMachines`, flagging two kinds of writes: (a) a `reactive-decl` whose name is a projected var (someone wrote `@ui: UI = X`) and (b) a `bare-expr` starting with `@ui = X` or any compound assignment (`@ui += X`). Messages name both the source var and the machine so the user knows where to assign instead.
- **SPEC §51.9** flipped from `(parser + validator landed S22, runtime codegen pending)` to `(landed S22)`, with implementation notes on the runtime wiring added.
- **Regression tests (+10)**. Slice 2 additions to `compiler/tests/unit/gauntlet-s22/derived-machines.test.js`: projection-function shape + runtime round-trip (guarded + unguarded dispatch), derived-declaration shape + dirty-propagation end-to-end, E-MACHINE-017 on reactive-decl + `=` + `+=` + non-projected-vars-untouched, full-file compile + shadow-boolean-collapse example.
- **Known blockers (tracked for follow-up):**
  - Pre-existing BPP statement-boundary bug: two consecutive `@foo: SomeMachine = ...` reactive-decls on adjacent lines can silently drop the second one. Not new in this slice — exposed while writing the end-to-end write-rejection test. The test now sidesteps by splitting the two decls into separate `${}` blocks; a proper fix belongs in the body-pre-parser.
  - Reading `@ui` in markup (`${@ui}`) inserts a `<span data-scrml-logic>` placeholder but the reactive display wiring is not yet emitted because the dep-graph doesn't know `@ui` is reactive. Fix: synthesize a reactive-decl-like AST node for the projected var during annotation so the dep-graph treats it as a consumer of `@order`. Deferred to a follow-up slice.

### 2026-04-17 (S22 — §51.9 slice 1: derived/projection machines — parser + validator)

- **§51.9 derived machine syntax parsed.** `< machine UI for UIMode derived from @order>` — the `derived from @SourceVar` clause is now recognized by the ast-builder, captured into the machine-decl node's new `sourceVar` field, and registered as a derived machine in the type system with `{ isDerived: true, sourceVar, projectedVarName }`. The projected variable name is the machine name with its leading uppercase run lowercased (`UI` → `ui`, `OrderStatus` → `orderStatus`, `HTTPStatus` → `httpStatus`).
- **E-MACHINE-018 exhaustiveness** validated after type annotation finishes: for every derived machine, the compiler looks up the source reactive's governed enum and confirms every variant has at least one unguarded projection rule covering it. Missing variants produce one error each, naming the variant and the source enum.
- **Source-var resolution.** `E-MACHINE-004` fires when `derived from @order` names a reactive that doesn't exist or isn't machine-bound, and a second form of `E-MACHINE-004` rejects transitive projections (source is itself a derived machine — deferred to §51.9.7 future work).
- **Projection RHS still validated** against the projection enum (`E-MACHINE-004` on unknown projection variants); LHS (source variants) intentionally skipped in `parseMachineRules` since the source enum isn't known at that point.
- **SPEC §51.9.6** naming rule tightened: "named by the machine's governed TypeName" → "named by the machine name with its leading uppercase run lowercased" (matches the worked example `< machine UI ... > → @ui`).
- **Deferred to slice 2** (this commit NOT runtime-ready):
  - Runtime codegen — projection function (`_scrml_project_<M>`), `_scrml_derived_declare` wiring, dep-graph edges from derived vars to source. Reading `@ui` at runtime today will see `undefined` from the reactive store; compile-time exhaustiveness catches the design error but doesn't yet produce running code.
  - **E-MACHINE-017** on writes to the projected var — user code that writes `@ui = X` is not yet rejected. Will land with codegen.
  - Projection `given` guards at read time (rules table still records the guard expression, codegen for evaluating it at read time lives in slice 2).
- **Regression tests (+9).** `compiler/tests/unit/gauntlet-s22/derived-machines.test.js`: registration of derived machines with correct projected var naming, LHS-not-validated-as-projection-enum, RHS validated, E-MACHINE-018 on missing variants, exhaustive passes, source-var-not-bound, transitive-projection rejected, guarded-without-unguarded-sibling.

### 2026-04-17 (S22 — §1b payload binding in machine rules)

- **§51.3.2 payload bindings in machine transition rules.** The `variant-ref` grammar now accepts an optional `(binding-list)` on either side of `=>`. On the `From` side, bindings expose the pre-transition variant's payload fields as locals inside the rule's `given` guard and effect block; on the `To` side, they expose the incoming variant's payload. Positional bindings (`.Charging(n)`) resolve to declared field order at parse time; named bindings (`.Reloading(reason: r)`) name the field directly; `_` discards drop a positional slot. The resolved bindings emit as `var <local> = __prev.data.<field>;` (from) or `var <local> = __next.data.<field>;` (to) inside the keyed `if (__key === "From:To") { ... }` block — rule-local scope, no leakage to sibling rules. Parser in `type-system.ts:parseMachineRules` + helper `resolveRuleBindings`; emitter in `emit-machines.ts:emitTransitionGuard` with new `buildBindingPreludeStmts` helper exported for tests.
- **E-MACHINE-015** fires on three cases: binding against a unit variant, a named binding of a non-existent field, and more positional bindings than declared fields. Message names the variant and lists the declared fields.
- **E-MACHINE-016** fires when `|` alternation alternatives disagree on binding shape (either all alternatives bind the same names, or none bind). Detection uses a sort-stable signature of each alternative's binding group.
- **`expandAlternation` rewritten** to respect paren-balanced variant refs: the `|` splitter now tracks paren depth so `.Charging(n)` is not split at internal binding parens, and the suffix-detector (identifies where the `given`/`[`/`{` suffix starts on the RHS) scans at depth 0 rather than using a naive regex — otherwise `given (n > 0)` could be cut off mid-expression by a binding-list that happens to contain `(`.
- **Rule regex tightened.** The old `(\w+|\*)?` variant-name capture backtracked correctly for the original grammar but produced wrong captures once optional binding-groups were added (`given` would be greedily captured as a variant name). Narrowed to `([A-Z][A-Za-z0-9_]*|\*)?` — variants are PascalCase per §14.4, keywords are lowercase.
- **Regression tests (+15).** `compiler/tests/unit/gauntlet-s22/machine-payload-binding.test.js`: positional, named, `_` discard, E-MACHINE-015 (unit variant / unknown field / overflow), E-MACHINE-016 (mismatched alternation / some-bind-some-don't), wildcard `* => *` passes through unaffected, `buildBindingPreludeStmts` standalone helper, and the emitter asserts that bindings land inside the keyed block (not outside).
- **Deferred:** rewriting `examples/14-mario-state-machine.scrml` to demonstrate a payload variant. Mario's current machine-guard runtime wiring has a pre-existing gap (assignments inside function bodies don't go through `emitTransitionGuard`), and changing `MarioState` from unit-only to a payload variant would break its equality checks (`@marioState == MarioState.Small`) and string interpolations. Tracked for a later slice that fixes the wiring gap first.

### 2026-04-17 (S22 — §1a enum payload variants: construction + match destructuring)

- **Enum payload variant construction (prereq for §51.3.2 payload binding in machine rules).** Before S22, `Shape.Circle(10)` threw `TypeError: Shape.Circle is not a function` because `emitEnumVariantObjects` only emitted string entries for unit variants and short-circuited entirely when an enum had zero unit variants. Now `emit-client.ts:emitEnumVariantObjects` iterates every variant and emits a constructor function for each payload variant: `Shape.Circle(10) === { variant: "Circle", data: { r: 10 } }`. Unit variants still emit as strings (`Shape.Square === "Square"`). The tagged-object shape aligns with §19.3.2 `fail` (minus the `__scrml_error` sentinel) so one runtime dispatches both error and regular variants by inspecting `.variant`. The inline `EnumType.Variant(args) → { variant, value: (args) }` rewrite in `rewrite.ts:rewriteEnumVariantAccess` was removed — the constructor function is now the single source of truth, and the old shape (`value` vs the correct `data`) couldn't carry multi-field / named-field payloads anyway. SPEC §51.3.2 prereq text flipped from "blocked" to "landed S22". Commit `2fbc332`.
- **Match destructures tagged-object payload variants.** Before S22, `.Circle(r) => r * r` parsed the binding but the emitter dropped it; `r` was referenced undeclared in the generated JS. Multi-arg `.Rect(w, h)` wasn't parsed at all. Now `parseMatchArm` captures the raw paren contents; a new `parseBindingList` splits on commas and recognizes positional (`r`), named (`reason: r`), and `_` discard forms. `emitMatchExpr` + `emitMatchExprDecl` emit `const __tag = (v && typeof v === "object") ? v.variant : v;` when at least one arm needs tagged dispatch (unit-only and scalar matches stay on the plain `tmpVar === "X"` path). Variant arms with bindings emit `const loc = tmp.data.<field>;` — positional bindings resolve via a per-file variant-fields registry (`buildVariantFieldsRegistry(fileAST)` populates it at the top of `generateClientJs`, clears after), named bindings use the field name directly. Collisions / unknown variants produce a diagnostic comment instead of a runtime `ReferenceError`. A `splitMultiArmString` bug was also fixed — the §42 presence-arm detector was splitting `.Circle(r) =>` at the `(` because it didn't notice the paren belonged to a variant binding. Commit `d8ebfb3`.
- **Regression tests (13 new, 2 updated).** New `compiler/tests/unit/gauntlet-s22/payload-variants.test.js` (6 tests: all-payload, mixed unit/payload, single- and multi-field round-trip, `.variants` ordering, §19.3.2 `fail` alignment). New `compiler/tests/unit/gauntlet-s22/payload-variants-match.test.js` (7 tests that compile + execute the emitted client JS: positional, multi-field, named, mixed unit/payload, `_` discard, scalar, unit-only). `emit-match.test.js:45` flipped from "binding ignored" to registry-aware positional and named destructuring. Existing `enum-variants.test.js` §6–§13b and `codegen-struct-rewrite.test.js` "enum variant in chain" updated to the constructor-function model (calls are preserved by rewrite, shape is asserted via `emitEnumVariantObjects` eval).
- **Known limitation, deferred.** Short-form `.Circle(10)` in a typed-annotation context `let s:Shape = .Circle(10)` still lowers to `"Circle"(10)` by the standalone-dot pass (a type-inference concern, not codegen). Fully qualified `Shape.Circle(10)` works. Live repro remaining at `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-payload-positional-031.scrml` — match destructures correctly now, only the construction line is still broken.

### 2026-04-17 (S21 — §19 codegen, §21 imports, §51 alternation, README/tutorial polish)

- **§51 `|` alternation in machine transition rules.** Grammar extended: `machine-rule ::= variant-ref-list '=>' variant-ref-list guard? effect?`, where `variant-ref-list ::= variant-ref ('|' variant-ref)*`. Both sides of `=>` may list variants; the rule desugars to the cross-product of single-pair rules before the type checker (`expandAlternation` at `type-system.ts:1902`). Any guard or effect block attaches to every expansion. Duplicate `(from, to)` pairs — within a line or across lines — emit new **E-MACHINE-014**. Mario example collapses from 8 lines to 3. Commit `eef7b5e`.
- **§19 error handling codegen rewrite.** `fail E.V(x)` now parses and emits a tagged return object inside nested bodies (if/for/function); `?` propagation works in nested bodies; `!{}` inline catch checks `result.__scrml_error` and matches on `.variant` rather than using try/catch (per §19.3.2 "fail does not throw"). E-ERROR-001 (fail in non-failable function) now fires — was unreachable before because `fail` never parsed inside function bodies. Parser also accepts canonical `.` separator alongside `::` alias. `ast-builder.js` parseFailStmt + parseOneStatement dispatch; `emit-logic.ts` guarded-expr rewrite. Commit `37049be`.
- **E-IMPORT-006 on missing relative imports.** Module resolver previously resolved the absolute path but never checked `existsSync`, so `import { x } from "./missing.scrml"` compiled clean. `buildImportGraph` now flags E-IMPORT-006 when the target is not a `.js` specifier, not in the compile set, and absent on disk; synthetic test-path importers are skipped so self-host / resolver unit tests stay green. Commit `86b5553`.
- **README "Why scrml" rewrites.** "State is first-class" redefined from "@var reactivity" to "state is named, typed, instantiable" per the S10/S11 memory. "Mutability contracts" rescoped from a machine-only paragraph to an opt-in three-layer story: value predicates (§53) + presence lifecycle (`not`/`is some`/`lin`) + machine transitions. Features-section bullet that still held the `server @var`/`protect` grab-bag renamed to "Server/client state." Commits `d802707` and the preceding §51 commit.
- **Tutorial v2 promoted.** `docs/tutorial.md` now contains the former v2 content (v1 deleted). Snippets renamed `docs/tutorialV2-snippets/` → `docs/tutorial-snippets/`. Commit `41e4401`.
- **Regression tests (3 new files, 22 tests).** `compiler/tests/unit/gauntlet-s20/error-handling-codegen.test.js` (11), `.../import-resolution.test.js` (3), `.../machine-or-alternation.test.js` (8). Updated `emit-logic-s19-error-handling.test.js` (14 tests) to the new return-value model.

### 2026-04-16 (S20 — gauntlet phases 5-12)

Executed gauntlet phases 5-12 against SPEC.md: meta, SQL, error/test, styles, validation/encoding, channels, integration apps, error UX. Fixed 5 compiler bugs, documented 11 more for batch treatment.

- **Bugs fixed (5).** `reflect(@var)` misclassified (now runtime per §22.4.2); E-META-008 now fires for `reflect()` outside `^{}`; E-META-006 now catches `lift <tag>` inside `^{}`; no spurious E-META-001/005 alongside E-META-003 on unknown types in `reflect()`; E-FN-003 now catches `@var = …` / `@var += …` inside `fn` bodies.
- **Bugs documented for future batch.** `fail` compiles to bare `fail;` (fixed in S21); E-ERROR-001 not enforced (fixed in S21); `?` emits as literal `?;` (fixed in S21); `!{}` try/catch vs `fail` return mismatch (fixed in S21); `lin + ^{}` capture not counted as consumption; phase separation detected at eval-time; DG false-positive for `@var` via `meta.get()`/`meta.bindings`; nested `^{}` in compile-time meta crashes eval; E-SCOPE-001 doesn't fire for undeclared variables in logic blocks; **E-IMPORT-006** for missing modules (fixed in S21).
- **Test artifacts.** 80 fixture files under `samples/compilation-tests/gauntlet-s20-{channels,error-test,error-ux,meta,sql,styles,validation}/` and 16 regression tests under `compiler/tests/unit/gauntlet-s20/`. End-of-S20 baseline: 6,802 pass / 10 skip / 2 fail.

### 2026-04-14–15 (S19 — gauntlet phases 1-4)

Language gauntlet across declarations, control-flow, operators, and markup. Multiple bug fixes + fixture additions across commits `8e95226` (error-system §19 compliance), `dd25311` (reject JS-reflex keywords), `cf426a1` (animationFrame + `ref=`), `36a99bd` (loops/labels/assignment-in-condition), `a9ab734` (`_` wildcard alias + E-LOOP-003 disable), `cee9fc1` (markup fixture corpus). Full Phase 2 triage documented under `docs/changes/gauntlet-s19/` (pending archival to scrml-support/archive).

### 2026-04-14 (S18 — public-launch pivot)

- **README SQL-batching expansion.** Five new Server/Client bullets (Tier 2 N+1 rewrite, Tier 1 envelope, mount coalescing, `.nobatch()` opt-out, batch diagnostics) plus a sharper "Why scrml" paragraph (adds `D-BATCH-001` near-miss + `.nobatch()` escape hatch) plus `?{}` row in the Language Contexts table noting auto-batching. Commit `d20ffa4`.
- **Lift Approach C Phase 2c-lite — drop dead BS+TAB re-parse block.** The inline re-parse fork inside `emitLiftExpr` (~50 LOC) that normalized tokenizer-spaced markup and rebuilt a MarkupNode via `splitBlocks` + `buildAST` was confirmed dead by S14 instrumentation (0 hits across 14 examples + 275 samples + compilation-tests). Deleted. Commit `f5d78df`. Full Phase 2 deferred (helpers still reached via `emitConsolidatedLift` for fragmented bodies).
- **Bug fix: `export type X:enum = {...}` misparsed.** `ast-builder.js` `collectExpr` treated `:` + IDENT + `=` as a new assignment-statement boundary, breaking the decl because `enum`/`struct` tokenize as IDENT (not KEYWORD). The leftover `enum = {...}` was reparsed as a standalone let-decl, firing `E-MU-001` on `enum`. Fix: added `:` to the lastPart skip-list alongside `.` and `=`. Commit `b123ed1`. **Affects any user writing an exported named-kind type — high public impact.**
- **Bug fix: reactive-for `innerHTML = ""` destroys keyed reconcile wrapper.** `emit-reactive-wiring.ts` unconditionally emitted the clear inside `_scrml_effect`, so every re-run destroyed the `_scrml_reconcile_list(` wrapper before the diff could run. Fix: skip the clear when `combinedCode` contains `_scrml_reconcile_list(` (mirrors the existing single-if branch guard). Commit `b123ed1`.
- **Test fixture: `if-as-expr` write-only-let.** Not a compiler bug — MustUse correctly flagged `let x = 0; if (true) { x = 1 }` (no read of `x`). Test intent was if-stmt codegen, not MustUse semantics — fixture updated to `log(x)` after the if-stmt. Commit `b123ed1`.
- **8 TodoMVC happy-dom tests skipped with notes.** The harness wraps the runtime in an IIFE, scoping `let _scrml_lift_target = null;` to that IIFE; client-JS IIFE can't see it, throws `ReferenceError: _scrml_lift_target is not defined`. Real browsers share global lexical env between classic `<script>` tags — works there. Puppeteer e2e (`examples/test-examples.js`) covers 14/14 examples. Tests marked `test.skip` with top-of-file annotation documenting root cause and unskip condition. Commit `b123ed1`.
- **S19 gauntlet plan queued.** Full 12-phase language gauntlet plan (decls, control-flow, operators, markup, meta, SQL, error/test, styles, validation/encoding, channels, integration apps, error UX) left at `handOffs/incoming/2026-04-14-2330-scrmlTS-to-next-pa-language-gauntlet-plan.md`. 31 agents identified from `~/.claude/agentStore/` with wave-staging recommendation.

### 2026-04-14 (S17)

- **SQL batching Slice 6 — §8.11 mount-hydration coalescing.** When ≥2 `server @var` declarations on a page have callable initializers (loader functions), the compiler emits one synthetic `POST /__mountHydrate` route whose handler runs every loader via `Promise.all` and returns a keyed JSON object. The client replaces per-var `(async () => { ... })()` IIFEs with one unified fetch that demuxes results via `_scrml_reactive_set`. Non-callable placeholders (literal inits, `W-AUTH-001`) are excluded; writes stay 1:1 per §8.11.3. Route export follows the existing `_scrml_route_*` convention. Tier 1 coalescing (§8.9) applies automatically inside the synthetic handler because loaders are sibling DGNodes.
- **SQL batching Slice 5b remainder — §8.10.7 guards.** `E-PROTECT-003` fires when a Tier 2 hoist's `SELECT` column list overlaps any `protect`-annotated column on the target table — the hoist is refused and CG falls back to the unrewritten for-loop. `SELECT *` expands to every protected column on the table. New exported `verifyPostRewriteLift` runs after Stage 7.5 and emits `E-LIFT-001` if any hoist's `sqlTemplate` contains a `lift(` call (defensive — §8.10.1 construction makes this unreachable today, but the pass is the spec's required re-check gate).
- **SQL batching microbenchmark.** New `benchmarks/sql-batching/bench.js` measures the exact JS shapes the compiler emits before/after the batching passes on on-disk WAL `bun:sqlite` (synchronous=NORMAL). Results in `benchmarks/sql-batching/RESULTS.md`. Headline: Tier 2 loop-hoist speedup is **1.91× at N=10, 2.60× at N=100, 3.10× at N=500, 4.00× at N=1000**. Tier 1 shows ~5% on read-only handlers — the envelope's real value is snapshot consistency and contention amplification under concurrent writers.
- **README promotion.** "Why scrml" now states "the compiler eliminates N+1 automatically" with a link to the measured results.

### 2026-04-14 (S16)

- **SQL batching Tier 1 + Tier 2 end-to-end** — spec §8.9 / §8.10 / §8.11 + PIPELINE Stage 7.5 + CG emission all landed (11 commits on `main`).
  - **Tier 1 per-handler coalescing (§8.9)**: independent `?{}` queries in a single `!` server handler execute under an implicit `BEGIN DEFERRED..COMMIT` envelope with catch-`ROLLBACK`. One prepare/lock cycle instead of N. `.nobatch()` chain method opts out of any site. `E-BATCH-001` fires on composition with explicit `transaction { }`; `W-BATCH-001` warns when `?{BEGIN}` literals suppress the envelope.
  - **Tier 2 N+1 loop hoisting (§8.10)**: `for (let x of xs) { let row = ?{... WHERE col = ${x.field}}.get() }` rewrites to one `WHERE IN (...)` pre-fetch + `Map<key, Row>` + per-iteration `.get(x.id) ?? null`. `.all()` groups into `Map<key, Row[]>`. Positional `?N` placeholders preserve parameter safety. `D-BATCH-001` informational diagnostic on near-miss shapes (`.run()`, tuple WHERE, multiple SQL sites, no match). `E-BATCH-002` runtime guard on `SQLITE_MAX_VARIABLE_NUMBER` overflow.
  - **CLI**: `scrml compile --emit-batch-plan` prints the Stage 7.5 BatchPlan as JSON.
- **`.first()` → `.get()` reconciliation (§8.3)** — 17 occurrences renamed in SPEC. `.get()` matches bun:sqlite convention; `.first()` dropped.
- **README refinements** — new "Free HTML Validation" subsection explains predicate → HTML attr derivation; "Variable Renaming" rewritten with real §47 encoding (`_s7km3f2x00`) + tree-shakeable decode table story.

### 2026-04-14 (S14)

- **Match-as-expression (§18.3)** — `const x = match expr { .A => v else => d }` now works end-to-end. Follows the same pattern as `if`/`for` as expressions.
- **`:>` match arm arrow** — codegen support complete. Both `=>` and `:>` are canonical; `->` retained as a legacy alias. `:>` avoids overloading JS arrow-function syntax and reads as "narrows to."
- **`</>` closer propagation** — the 2026-04-09 spec amendment (bare `/` → `</>`) was incompletely applied; the AST builder still accepted bare `/` as a tag closer. Now uniformly enforced across parser, codegen, and all 11 affected sample files.
- **Lift Approach C Phase 1** — `parseLiftTag` produces structured markup AST nodes directly during parsing. Previously 0% of real inline lift markup went through the structured path; now it's 100%. The fragile markup re-parse path is dead in production (retained only for legacy test fixtures pending Phase 3).
- **Phase 4d (ExprNode-first migration)** — all compiler consumers now read structured `ExprNode` fields first, with string-expression fields deprecated across 20+ AST interfaces. Expression handling is now AST-driven end-to-end.

---

## In Flight

- **Phase 3 — Legacy test fixture migration.** ~21 fixtures still use the old `{kind: "expr", expr: "..."}` shape. Rewriting them unlocks deletion of ~250–300 LOC of dead string-parsing fallback code in `emit-lift.js`.
- **Lin Approach B (discontinuous scoping).** Design complete, spec amendments drafted. Multi-session work to land an enriched `lin` model beyond Rust-style exact-once consumption.
- **SPEC sync.** Formalizing the `:>` match arm, match-as-expression, and Lift Approach C changes in `compiler/SPEC.md`.

---

## Queued

- **Phase 2 reactive effects** — two-level effect separation for `if`/`lift`. Design settled; will land when a concrete example drives the need.
- **SQL batching (compiler-level).** Two wins on the table:
  - *Per-request coalescing* — independent `?{}` queries in one server function get emitted together, one prepare/lock cycle instead of N.
  - *N+1 loop hoisting* — detect `for (let x of xs) { ?{...WHERE id=${x.id}}.get() }` and rewrite to a single `WHERE id IN (...)` fetched once before the loop. This is only tractable because the compiler owns both the query context and the loop context.
  - Cross-call DataLoader-style batching is parked until beta.
- **Remaining 14 test failures** — triaged, pre-existing, none block beta.
