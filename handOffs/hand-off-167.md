# scrmlTS — Session 162 (CLOSE)

**Date:** 2026-06-04
**Previous:** `handOffs/hand-off-166.md` (= S161 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-167.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). Full session-start completed.

---

## 🏁 S162 CLOSE — #2f EACH-PROMOTION ARC CLOSED + PUSHED · swap reframed (6 families, not 199 files) · F3 same-line match arms landed

The native-parser-swap strategic line (direction-a, S161). **(1)** #2f each-promotion CLOSED end-to-end (3 units + MK2.1 + SPEC recon) + PUSHED. **(2)** Flip re-measure corrected the S161 "70%" → **~31%** (each was the real broken structural element; match was already done). **(3)** Swap-grind triage REFRAMED the remaining ~790 flip-fails as **~6 parser-FAMILIES, not 199 files** (true swap-work ≈6 fixes; F1 engine arm-body dominant at ~168). **(4)** F3 (same-line match arms, family F3) landed. **(5)** F8 await-in-`^{}` ruled (migrate stdlib). **NEXT-SESSION OPENER: F1 (engine arm-body, ~168, L-sized) — survey-then-fix.**

### Sync / repo state at CLOSE
- **scrmlTS:** **7 PA commits this session** (`810ce386` session-start · `39b1424a` unit A · `178cc5dc` unit B+MK2.1 · `d99403b1` unit C · `e5b673dc` SPEC recon · `2af1e3dd` F3 · + this wrap commit). PUSHED this wrap → origin **0/0**.
- **scrml-support:** S162 user-voice append (F8 ruling + the swap reframe) — committed + pushed this wrap. (0/0 at open.)
- **Tests at close:** full `bun test compiler/tests/` **22,986 pass / 0 fail / 220 skip / 1 todo across 906 files** (23,207 ran; +65 from S161's ~22,921 = #2f's +44 each tests + F3's +21). 0 fail = no regression. NB the native-parser-swap parity tests are LIVE-default → flip-gated (exercise native only at the eventual swap); the ~790 flip-fails are measured separately via the throwaway-worktree flip harness, NOT in this default-parser count.
- **Worktrees:** main only (all 4 dispatch worktrees + the re-measure throwaway worktree cleaned at their resolutions). **Inbox:** EMPTY at open + close.
- **Version:** on top of **v0.7.0** (pkg.json unchanged; no tag — parity-closer + bug-fix work, not a release cut).
- **Maps:** STALE — reflect `9f01f6cd`; HEAD is now 7 commits ahead, incl. native-parser changes (parse-file.js / tag-frame.js / lex-in-code.js / parse-expr.js) + emit-each.ts + SPEC. **REFRESH before the F1 dispatch** (F1 is `parse-state-body.js` + markup classification — the maps cover native-parser thinly; the F3/triage findings supersede for the expr-parser, but F1's locus needs fresh coverage).
- **Hooks:** config B. S100 path-discipline hook FIRED correctly (rejected a unit-C agent Write → agent switched to Bash-edit per S126; no main leak). The F3 agent had an S126 #16 `cd <main> && $(pwd)` leak → self-recovered → PA-verified main clean (git diff HEAD empty). Pre-push gate PASSED (the 2 known parity-timing flakes did not trip).

### known-gaps §0 state at CLOSE
- **HIGH 0** (holds since S139). **MED 9** (unchanged — the swap-family gaps are tracked under the native-parser-swap arc, not the MED bug backlog). **LOW** +3 NEW this session: `.scrml`-mirror feature-staleness (the big F3 finding — supersedes/absorbs the is-given predicate-drift LOW), native is-pattern-arm gap (`is .Ok => 1`, both same-line+newline), native if-as-expr gap. (The SPEC §4.15/§24.4 registry-gap LOW CLOSED via `e5b673dc`.)

### #2f each-promotion arc — DONE + PUSHED (6 PA commits)
- `810ce386` — session-start (rotate hand-off-166 + fresh hand-off).
- `39b1424a` — **unit A** — native `<each>` structural promotion: `each` in `STRUCTURAL_ELEMENTS` (tag-frame.js) + `isEachBlock` + `synthEachBlockNode` (parse-file.js, mirrors `synthMatchBlockNode`) producing the live `each-block` FileAST node + `synthMarkupNode` colon-shorthand body + standalone-HTML body-child synthesis + `colonIntroducesDirectiveAttr` guard. tag-frame.scrml mirror. emit-each.ts consumes unchanged.
- `178cc5dc` — **unit B + MK2.1** — emit-each.ts honors the exprNode contract (mirrors emit-html.ts:1888) for native per-item `${expr}` interp (closes as-name/key bare-body shapes); + fixed the MK2.1 `parser-conformance-markup.test.js` "exactly 7"→8 stale assertion (coupled-test miss from `39b1424a` — full-suite-RED, pre-commit-subset-green).
- `d99403b1` — **unit C** — native lexer `@.` contextual-sigil recognition (lex-in-code.js new `@`-then-`.` branch BEFORE `@ident`, consumes `@.`+chain as one ScrmlAt token → `ident{name:"@.name"}` → existing emit-each `rewriteContextualSigil`; NO bridge/codegen/SPEC change). lex-in-code.scrml mirror (S115 lockstep). +happy-dom render canary.
- `e5b673dc` — **SPEC §4.15/§24.4 reconciliation** — `<each>` added to both registry tables + classify list + `E-NAME-COLLIDES-RESERVED` reserved-name list + attr-catalog + cross-refs (catch-up to §17.7/§18.5.6 S130 HU-1, which the native registry already followed). SPEC-INDEX regenerated.

**Verification:** ALL 8 each shapes byte-identical native ≡ default (in-collection/of-count/colon-shorthand/standalone-shorthand/in-match-arm/as-name/key/`@.`-sigil). within-node parity 1005/0. +44 tests across the arc (incl. 2 real-DOM render canaries). 0 regression. PA-independent R26 at every landing. S147 coherence every commit. Briefs archived (S136) under `docs/changes/native-each-block-promotion-2026-06-04/`, `native-each-interp-codegen-2026-06-04/`, `native-each-contextual-sigil-2026-06-04/`.

### Flip re-measure (the strategic payoff) — corrected the S161 "70%" headline
- **1,150 (S161) → ~790 fails / 199 files (now).** #2f killed **~360 (≈31%)**, NOT 70%. The S161 "804/70%" CONFLATED each+match; `<match>` was already promoted (byte-identical under flip; the #2f survey proved this — root-cause hypothesis was HALF-WRONG, corrected via Rule 4/S138). Only `<each>` was the real broken structural element.
- **What remains is a LONG TAIL** — no dominant unit. Top buckets: §90 API per-stage (13, SUSPECTED BRITTLENESS — likely the `I-PARSER-NATIVE-SHADOW` info-diag), R25-Bug-42 SSE+`?{}` lowering (11, REAL), §1 structural-misplacement-in-`${}` (9, REAL — native doesn't fire `E-STRUCTURAL-ELEMENT-MISPLACED`), engine-routing (8), Bug 71 match-exhaustiveness (7, likely KNOWN-RESOLVED-LEGACY-ONLY), Bug 58 formFor (7), MCP V0 (~17 across 3 files), match-arm-inline (6), `.advance` two-plane (6)… then ~190 files at ≤5.
- **Re-measure mechanism (for next time):** `compiler/src/api.js:630` `parser = null` → `parser = "scrml-native"` in a throwaway `git worktree`, `bun install && bun run pretest && bun test compiler/tests/`. Control (default) = 0 fail. (S161's harness was not committed; this is the reproducible recipe.)

### Swap-grind triage — DONE (agent `a754f880bccfc1a97`) — the 790 is ~6-9 PARSER FAMILIES, not 199 files
**Brittleness hypothesis REFUTED:** `I-PARSER-NATIVE-SHADOW` drives ZERO of the 790 (info-severity → `result.warnings`, never `result.errors`; only 7 suite-wide tests assert `warnings.length===0`, none in top buckets). The 790 is **~95%+ REAL parity gaps**, collapsing into **root-cause families** (one native-parser locus each, serving many buckets). **TRUE remaining swap-work ≈ 6 parser fixes, NOT 199 file-fixes** — a real upgrade to the v0.8 calculus.

| Family | ~fails | Root cause | Locus | Size |
|---|---|---|---|---|
| **F1 engine arm-body parse** | **~168** | spurious `E-UNQUOTED-DISPLAY-TEXT` on `<engine>` arms + DROPS whole engine (+each-in-arm). THE GATE (§51.0.S/G.1, C1, bug62, engine-a7, engine-gated-each, Option A, MCP, mario) | `parse-state-body.js`+markup-classification | L |
| **F3 match/if-as-expr** | ~44 | native can't parse SAME-LINE match arms; one boundary tweak clears Bug 71/67/match-arm-inline | `parse-expr.js` `isAtArmBoundary` | M |
| **F2 SQL `?{}` in server-fn** | ~58 | native drops SQL body in top-level server fns | `parse-sql-body.js` | M |
| **F4 formFor expansion** | ~32 | `<formFor>` parses but field-markup expansion dropped | native parse→bridge→form pass | M |
| **F5 `const @name` derived-decl** | ~20 | native rejects `@`-prefixed decl (→Bug 4 mis-emit) | `parse-stmt.js` | S-M |
| **F6/F9 fn param / export-fn-body** | ~16 | `lin`/destructured params; export-fn body stripped | `parse-stmt.js`/`parse-expr.js` | S-M |
| **F7 missing diagnostics** | ~15 | native swallows `E-STRUCTURAL-ELEMENT-MISPLACED` etc. | body-parser gates | S |
| **F8 stdlib `await import()`** | 13 | native rejects `await` (canonically correct); stdlib bootstrap uses it in `^{}` | `parse-expr.js` parseUnary | S/**ruled** |

The "KNOWN-RESOLVED" buckets (Bug 71/58/4) are NOT unported fixes — they fail because native never produces the AST those parser-agnostic fixes consume (upstream PARSE gap) → roll up into F1/F3/F4/F5.

### F8 — USER RULING (S162, durable design directive — append to user-voice at wrap)
**The await-in-`^{}` tension ("live tolerates legacy / native canonical-enforcer"): user ruled → MIGRATE THE STDLIB OFF `await import()`. Native stays the STRICT canonical enforcer (no `await`, anywhere, incl. compile-time `^{}` meta). The stdlib bootstrap's `await import()` is MIGRATION BACKLOG, not a reason to relax native.** Aligns with the no-async/await public-claim (await = forbidden vocabulary). F8 disposition = the stdlib migration (its own backlog task), NOT a native-parser relax. (User AskUserQuestion S162.)

### F3 — DONE + LANDED `2af1e3dd` (the warm-up; user picked "start smaller" over the L-sized F1)
Fixed same-line match-arm boundary in `parse-expr.js` `isAtArmBoundary`: dropped the redundant NEWLINE gate → boundary = `inMatchArmBody` + `peekStartsArmPattern` (arrow-anchored + uppercase-gated, so lowercase `.field` member-access continuation is NOT mis-classified). Phase-0-STOP PROCEEDED (clean local extension). Verified (R26): same-line `=>`/`:>`/`->` parse; PROPER fixture (with enum) native client.js BYTE-IDENTICAL to default; `E-EXPR-MATCH-PATTERN` count 0; member-access/object-literal/nested-match controls preserved. within-node GREEN (match-001 arm-count mismatch GONE corpus-wide; +FIELD-SHAPE/SPAN-COORD on newly-parsed arm nodes, S161-tolerated). +21 tests. **NO `.scrml` mirror change** — see the staleness finding above (the function to mirror doesn't exist in the stale `.scrml`).

**NEXT-SESSION OPENER — F1 (engine arm-body, the ~168 gate, L-sized).** Locus: `compiler/native-parser/parse-state-body.js` + the markup-classification path. The bug: native fires spurious `E-UNQUOTED-DISPLAY-TEXT` on `<engine>` state-child arm bodies + DROPS the whole engine (+ each-inside-arm content). Almost certainly a Phase-0-survey-STOP dispatch (most complex native surface: state-children + arm bodies + nested each/match + §4.18 code-default body mode). **Refresh maps first** (F1 locus needs fresh coverage). **Re-measure the flip AFTER F1** (count should drop steeply — validates F2-F9 estimates). Then F2 (SQL `?{}` in server-fn, ~58) / F4 (formFor, ~32) / F5 (`const @name`, ~20) / F6+F9 / F7 (diagnostics). F8 = the stdlib `await import()` migration (per the S162 ruling — its own backlog task).

---

## OPEN QUESTIONS / DESIGN CALLS
1. **Phase-A default-flip is a STANDING USER DECISION** (STOPped+reverted once at `404fc619`). PA dispatches PARITY-CLOSERS feeding the eventual user-authorized flip — never "the flip" itself.
2. **v0.7 → v0.8 placement** — the swap is realistically a v0.8 target (long-tail grind, not a few levers — the re-measure made this concrete). Confirm with user when relevant.
3. **M6.5 emit-logic path-(a) shims vs path-(b)** — needs ratification BEFORE that dispatch (cutover-plan). Not on the current critical path.

## CARRY-FORWARD (backlog)
- **NEW LOW to file (at wrap):** systemic `is given` / `is not given` `.scrml`-mirror predicate drift — 22 occ / 6 files (tag-frame.scrml ×7, parse-markup.scrml ×4, parse-expr.scrml ×4, body-mode.scrml ×3, block-context.scrml ×1, ast-expr.scrml ×1). S115-class (mirrors are not compiled/run → zero runtime impact today; matters at self-host). NOT a mechanical `is given`→`is some` sweep — they mirror JS boolean/`typeof` checks; needs a canonical-form decision. Caught via the S115 grep on the each-promotion landing; the unit-C agent confirmed it did NOT add more.
- **SPEC registry-gap LOW — CLOSED** this session via `e5b673dc`.
- **Bug backlog (MED 9):** Bug 1 Tailwind · V-kill READ-side · MCP V0 deferrals · Generator policy (design-call) · L19 multi-statement-handler (design-call) · A5 freeze-extension · R28-1d (NOT-REPRODUCED S147) · C6 (likely stale-resolved) · Bug 14 MCP-partial.
- **LOW 16** (+the 2 S160 (b)-surfaced) — carried.
- **Swap line:** the grind (triage-ranked real-gap buckets) → eventually the D8a fn param/return cluster + `^{}` host-fence (D8b) + the Phase-A flip authorization. The within-node parity test + the flip-test re-measure are the two parity axes.
- **S154 carry:** body-split/CPS debt (Ext 2/3) · per= per-instance engines (DD) · self-tree-shaking compiler build-story DD-candidate (S155 parked) · self-demo scrml.dev F1/F2 debate (website now in sibling scrml-site) · 6NZ caps stray.

## pa.md directives in force
- Rules R1–R5. `---` delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Largest-ratified-target / autonomous / park-on-input / surface-on-real-failure-or-design-ruling.
- Dispatch discipline ALL held this session: S88 isolation · F4 startup-verify · **S112 merge-startup** (every fix dispatch) · S99/S126 Bash-edit + no-`cd` (S100 hook fired on unit C, agent complied) · S136 BRIEF.md (all 3 fix dispatches) · S138 R26/dual-verify (PA-independent every landing) · S147 branch-leak coherence (every commit) · S115 `.scrml` grep (each-promotion + unit-C). `--no-verify` forbidden (held — pre-push ran clean).
- **CWD discipline (S159):** held — `cd <main>` / `pwd` checks before main-side writes post-dispatch; no S100 false-rejects on PA writes this session.
- Canonical dev-agent `scrml-js-codegen-engineer`. Reconnaissance/triage via `general-purpose` (read-only). Reviewer-gate `scrml-language-design-reviewer` not needed this session (no design ratification — the unit-C "design call" was a contained representation choice resolved by reading the codegen contract).

## Tags
#session-162 #IN-PROGRESS #profile-a-full-start #2f-each-CLOSED #pushed #flip-remeasure-790-from-1150 #each-31pct-not-70 #long-tail #swap-grind #triage-in-flight #high-0
