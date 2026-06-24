# scrml — Session 218 (CLOSE)

**Date:** 2026-06-24. **Profile:** A — FULL. **Boot:** digest `current`. A **two-adopter-bug + new-primitive + PA-infrastructure** session: 2 render bugs fixed+verified, the ratified `_{}` inline foreign-code primitive built end-to-end, and the PA boot path hardened.

> **Thinned (S205).** Board/counts → `bun scripts/state.ts` + `handOffs/digest.md`. Fine-grained stream → `handOffs/delta-log.md` [56]–[63]. This carries the IRREDUCIBLE + open threads.

## Board @ close
**HIGH 0 · MED 15 · LOW 15 · Nom 8** (+4 deferred gaps filed this session). v0.7.0. Full suite **25050/0/213**. **6 commits pushed this wrap** + scrml-support (pa-global pointer + the boot-gate authority). origin scrml `85e0d687`+wrap, scrml-support `90f1e24`+wrap.

## ✅ DONE
1. **GITI-032 (HIGH) `e493bace`** — markup-as-value dropped inside `<match>`/`<engine>` arm body. Root CORRECTED from the dispatch hypothesis: the native→live bridge `translate-expr.js` translated `MarkupValue` to an EMPTY escape-hatch (not emit-match.ts as guessed). Fixed to the live `markup-value` node + a separate engine-path `isHtmlFragment` over-fire. PA R26 dual-verified. giti's first external HIGH.
2. **6nz Bug AI (MED) `e64c4095`** — `<each>`/`<empty>` fallback not torn down on empty→non-empty. Shared runtime `_scrml_reconcile_list` `oldNodes.size===0` bulk-create didn't clear the stray non-keyed fallback. 9-line fix + happy-dom test w/ R26 adversarial proof.
3. **`_{}` inline foreign-code primitive BUILT `85e0d687`** (dpa-003, ratified S215/S216) — see narrative below. A NEW PRIMITIVE + a SPEC §23.2.4 amendment; PA-reviewed the normative change + fixed a `§23.2.6→§23.2.4a` cross-ref typo; PA R26-verified end-to-end.
4. **BOOT GATE + CLAUDE.md trim** (PA infra) — stub hardened (boot-only-on-explicit-command + boot-atomicity) + propagated to giti/6nz/scrml-support; `~/.claude/CLAUDE.md` 86→16 lines, ~70 lines relocated → NOT-auto-loaded `~/.claude/pa-global.md`. Backup `~/.claude/CLAUDE.md.bak-s218-2026-06-24`.

## 🎯 The `_{}` primitive — design-narrative (IRREDUCIBLE; the deputy can't synthesize this)
The inline value-returning form `const x = _={ in:{names} … }=` in a **server function body**, `lang=ts/js`, **in-app** only. Before: §23 `_{}` was spec+markup-parse-only with NO codegen consumer; in logic `_={` mis-tokenized as `_ = {` → E-CODEGEN-INVALID-JS. Built per the ratified **Approach B** (logic recognition + ts/js value-flow mirroring `?{}` + explicit named-pass capture) + the **S216 `<api>`-OUT-typing hybrid** (asIs default + annotation + parseVariant). **Two user rulings this session (FINAL):** crossing syntax = the **`in:{}` header** form; first target = **in-app** (AskUserQuestion). The slice is server-colored (stripped from client) + opaque to RI/TS/DG; only the `in:{}` names + the OUT value are scrml-visible. **This unblocks flogence's in-app dispatch loop** (the primitive they requested). **NOT built (separate items, not gated on this):** standalone `dispatch.scrml` (needs library-mode-db `?{}` §44.7.1 W5a/W5b — OQ-F1); arbitrary-lang inline (dpa-009, no runtime model); the §23 sidecar (coexists, untouched). Authority: `scrml-support/docs/deep-dives/foreign-code-{logic-context-codegen,inline-typed-boundary}-2026-06-23.md` + `~/.claude/design-insights.md` [S216/dpa-003].

## ⏸️ OPEN — S219 (priority order)
0. **Outbox replies SENT this wrap** (verify in giti/6nz/flogence inboxes if a reply is owed back): giti GITI-032 RESOLVED (+ the nested-`${}`-in-markup caveat for status.scrml `<section>` bodies + the payload-binding-by-name note); 6nz Bug-AI RESOLVED; flogence `_{}` inline BUILT (their requested primitive). *(If any didn't send at wrap, first S219 action.)*
1. **4 NEW deferred gaps** (filed, MED 15/LOW 15): `g-each-peritem-markup-value-ternary` (MED — `${@. ? <markup>:""}` in `<each>`; dedicated dispatch) · `g-nested-interp-in-markup-value-literal` (LOW) · `g-nested-each-outer-key-reuse-inner-frozen` (MED — Bug-72 residual) · `g-foreign-inline-crossing-shadow` (LOW — → future `E-FOREIGN-006`).
2. **dpa-003 follow-ons:** standalone/library-mode-db `?{}` (OQ-F1, the standalone `dispatch.scrml` path) · dpa-009 arbitrary-lang inline marshaling (banked candidate) · dpa-006 build-story×`_{}` (banked) · dpa-008 `_{}` capability-gating (banked).
3. **escalation-2 typer-scope follow-on** — `g-sse-route-object-typer-scope` (MED; blocks resumable-SSE cursor).
4. **Half-2 convergence** (`<each>` bind: + buildHandlerExpr dedup, Family-A) · g-enum-toenum-not-lowered-server-side (MED) · giti three-codegen library-mode cluster.
5. **Multi-user PA MVP refinements** (now intertwined with today's pa-global.md): user-voice-scrml→-bryan rename · methodology-memory-lift residual · **full pa-scrml→pa-base+overlay migration (should coordinate with/absorb pa-global.md)** · `$SCRML_HOME` path-param. **User's step: add Ryan (rjantz3) as a scrml-support GitHub collaborator.**
6. **S215 random-sample-10× audit:** all 3 substantive landings (GITI-032/6nz/`_{}`) already got per-fix adversarial passes (the agents ran /code-review + R26 adversarial; `_{}` agent found+fixed 2 real bugs; PA dual-verified all 3) — the formal random-sample-10× was DEFERRED (low marginal value given full per-fix adversarial coverage). Re-run normally at S219+.
7. **Maps 12 commits behind HEAD** (watermark 489951aa) — OWED to the deputy's next maps tick (this session's deputy ticks were digest-only). WARN-only, not gated.

## Anomalies / lessons
- **Push-rejection = benign GitHub PR merge.** origin advanced via a GitHub merge of Ryan's PR #4 (CSRF) — which S217 had ALREADY cherry-picked (`939d673e`/`d706f111`) → the merge was a content NO-OP (empty `ca12a295..edb812d1` diff), no revert (S216/S217 intact). Integrated via `git merge` (preserves deputy SHAs). **Process note for Ryan-coordination: a PR already cherry-picked should be CLOSED, not merged** (avoids the duplicate-history wrinkle).
- **`_{}` is a new PRIMITIVE landing** — heavier PA review than a bug fix: read+verified the SPEC §23.2.4 amendment (faithful to the ratified design), fixed the cross-ref typo, R26-verified end-to-end (server-only emit + node-check + negatives) + full suite. The agent's S215 adversarial gate found+fixed 2 REAL bugs (level-2 `_=={}==` orphan-brace counter; nested-arrow `return` regex breaking value-flow) — the gate works.
- **Root-cause hypotheses were corrected twice by the agents** (GITI-032: not emit-match.ts but the native→live bridge; 6nz: PA direction was exactly right). The depth-of-survey discount + Rule-4 cross-checks held.

## pa.md directives in force
R1–R5 · `---` · Profile A · digest-first · S88/S99/S126 path-discipline · S136 BRIEF · S138 R26 (fwd+reverse) · S147 coherence · S199/S205 deputy + merge-before-push · S119 explicit-pathspec · S215 adversarial-verify + random-sample-10× · S217 per-user profile · **S218 NEW: BOOT GATE in the stub (boot-only-on-explicit-command + atomicity) + the `~/.claude/pa-global.md` relocation (CLAUDE.md trimmed)** · wrap 8-step.

## Tags
#session-218 #close #giti-032-markup-value-in-arm #6nz-bug-ai-each-empty-fallback #foreign-inline-_{}-primitive-built #boot-gate #claude-md-trim #pushed
