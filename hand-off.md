# scrmlTS — Session 164 (CLOSE)

**Date:** 2026-06-04 → 2026-06-05
**Previous:** `handOffs/hand-off-168.md` (= S163 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-169.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"; default A). Full session-start completed.

---

## 🏁 S164 CLOSE — native-parser-swap AUTONOMOUS LOOP: 5 families landed (flip 674→509, −165); §51.0.S engine message-dispatch family FULLY native-parity end-to-end · WRAP + PUSH

User drove the native-parser-swap grind via an autonomous-flow grant ("land on clean R26, move to the next, autonomous flow"). The loop: triage → dispatch with a Phase-0 survey-STOP gate → PA-independent R26 byte-compare → file-delta land → pick next from the persisted triage → repeat. **The clean-single-gap native-parser families are now largely EXHAUSTED**; the remaining 509 are meatier native gaps / §4.18 corpus-migration (not native bugs) / missing-enforcement. User banked here.

### Sync / repo state at CLOSE
- **scrmlTS:** **11 PA commits this session** + the wrap commit. **PUSHED this wrap → origin** (authorized "wrap + push"). Coherence held every commit (0/N, N==PA-authored); two transient mid-commit-race reads showed stale 0/N-1 (resolved on the commit's completion — lesson banked below).
  - `154a1799` session-start (rotate hand-off-168 + fresh) + **flip re-measure 674** + maps refresh (F1-substrate CLOSED framing corrected, B2 next) · `7cbad5dd` **F1-narrow + B2 §51.0.S message-arm** (parser-level) · `0aa94d2f` docs (message-arm landed, exprNode next) · `c1566faa` **exprNode + argExprNodes population** (§51.0.S FULLY native-parity) · `e9d1f3cb` docs (exprNode landed, 674→631) · `649f4ef8` **lift `<markup>` close-tag** (lexer fix) · `848334b0` docs (loop-status + TRIAGE.md persisted) · `df5a7702` docs (F2a landed + F2 decomposition) · `7e54f321` **F2a chained `?{}.method()` SQL** · `66301357` **table-for typeBodyText newline** (cross-cutting) · + this wrap commit.
- **scrml-support:** NO writes this session (pulled 0/0 at OPEN; no new durable user-voice directives — the autonomous-flow grant is session-scoped, not durable).
- **Tests at close:** full `bun run test` **23,037 pass / 0 fail / 220 skip / 1 todo / 911 files** (23,258 ran; +39 from S163's 22,998 = the 5 families' new tests). Within-node parity **1005/0** held throughout (rebumps were SPAN-COORD/EXTRA-FIELD-only benign convergence; table-for needed NO rebump).
- **Worktrees:** main only (all 6 dispatch worktrees + 3 throwaway re-measure worktrees file-delta-landed/cleaned). **Inbox:** EMPTY at open + close.
- **Version:** on top of **v0.7.0** (pkg.json unchanged; native-parser parity-closers, shadow-only, default output UNCHANGED — no tag, no adopter/cross-repo notice needed).
- **Hooks:** config B. Multiple agents hit the recurring `--no-verify` reflex on docs commits; ALL self-flagged + self-remediated (one via `git commit --amend` re-running the gate); the prohibition HELD — no `--no-verify` residue in any landed commit (PA landing commits re-gate regardless).

### THE 5 FAMILIES LANDED (all PA-independent R26 byte-identical native==default)
1. **§51.0.S message-arm — F1-narrow + B2 (`7cbad5dd`).** B2-only first dispatch survey-STOPped (hand-off anchor `native-parser/native-walker/...:516` was STALE; real path `compiler/src/native-walker/engine-statechild-walker.ts:516`; B2 gated by an upstream F1 parse bug). Re-dispatched combined: F1-narrow (`parse-markup.js dispatchCodeDefaultBody` + `scanMessageArmRegionExtent` — recognizes the leading-`|` message-arm region, was spurious E-UNQUOTED) + B2 (`parseMessageArms(bodyRaw).arms` into the walker + `acceptsType` capture in `collect-hoisted.js`).
2. **exprNode + argExprNodes population (`c1566faa`).** The R26 blocker for #1 + cross-cutting: native attr-values lacked `exprNode` (expr/variable-ref) AND `argExprNodes` (call-ref — `@x.advance(.Drop(...))` parses as call-ref). NEW `compiler/src/native-walker/attrvalue-exprnode-walker.ts populateNativeAttrValueExprNodes` (run from `api.js` native branch; reuses live `safeParseExprToNodeGlobal`, exported from ast-builder.js). **§51.0.S family FULLY native-parity end-to-end** (R26 on the message-dispatch fixture byte-identical with both fixes).
3. **lift `<markup>` close-tag (`649f4ef8`).** The triage's span hypotheses were both DISPROVEN; real root one layer down: native `lex-in-code.js` reads `</li>`'s `/` (source-adjacent to the `<`) as a runaway regex-to-EOF, destroying the token stream. Fix = `/`-adjacent-to-`<` → division (+ `translate-stmt.js` sliceSource for child-text recovery). ~50-file lift family; within-node −19 pure convergence (no rebump).
4. **F2a chained `?{}.method()` SQL (`7e54f321`).** F2 survey-STOPped MULTI-ROOT → decomposed (see below); F2a is the clean PROCEED subset: `translate-stmt.js reconstructChainedSql` mirrors the bare-form M6.5.b.4 promotion for the chained form (return/let/const/bare-expr). R26 6/6; within-node −761 net convergence (63 SPAN-COORD rebumps benign).
5. **table-for typeBodyText newline (`66301357`).** Triage locus WRONG (3rd time) — NOT tableFor-specific: `parse-stmt.js typeBodyText` did `parts.join(" ")`, collapsing `\n` field-separators → type-system (which splits struct body on `,`/`\n`, not spaces) saw one field clause → only `id` captured → tableFor dropped columns. Fix = line-aware `joinWithNewlines`. **CROSS-CUTTING POSITIVE** — also restored formFor + schemaFor field-capture (all parseStructBody consumers); killed −67 at re-measure.

### Flip-failure trajectory (line-agnostic flip harness; throwaway worktree)
**674 (S164-open) → 631 (message-arm+exprNode) → 576 (lift+F2a) → 509 (table-for).** −165 cumulative. The §51.0.S closures: E-ENGINE-ACCEPTS-NOT-ENUM 4→0, E-VARIANT-AMBIGUOUS 4→0, E-TYPE-063 15→3, E-CODEGEN-INVALID-JS 18→12, the lift E-STMT-MISSING-SEMICOLON/UNCLOSED cluster gone, E-PA-002 (F2) reduced. Honest: modest per-family raw-count moves (the test-suite flip-failures concentrate in feature fixtures; the cross-cutting wins — exprNode, table-for — show more in the adopter corpus). Correctness wins (whole families byte-parity) >> raw-count moves.

## THE TRIAGE + REMAINING 509 (the next-session map)
**`docs/changes/native-swap-triage-s164/TRIAGE.md`** is the authoritative family map (631 grouped by native parse-gap ROOT, each reproduced default-clean/native-fail; ranked + avoid-list + provenance; updated through this session's landings + reclassifications). The remaining 509 are THREE characters:

1. **Meatier native gaps (real swap work, higher effort):**
   - **F2-generator** — `server function*` is dropped ENTIRELY from the native AST (function* lift gate + no native yield-stmt arm in translate-stmt.js — NEW machinery needed). The yield-`?{}` leg of F2 gated on it.
   - **F2-match arm (F3 family)** — native `match action { "add" => {...} }` arm-parse FAILS (E-EXPR-MATCH-PATTERN / "unexpected Arrow") even with NO `?{}` — native string-literal-pattern + `=>` match-arm recognition gap.
   - **mario PowerUp payload-enum** — native captures only the first enum variant (`["Mushroom"]`), mis-emits payload variants.
   - **enum-subset struct-ctor** (~22) — native can't parse `TypeName { field: val }` in expr position (parser + downstream type-res; multi-stage — AVOID single dispatch).
   - **r24-bug-31** (~12) — MULTI-GAP (2 roots: `<state>` block close-mismatch + `!{}` failable arm-drop; AVOID — decompose first).
   - **F2 assign-RHS** `@x = ?{}.all()` — state-decl-routed / E-RI-002 (out-of-locus for translate-stmt; small).
2. **§4.18 corpus-migration — NOT native bugs (engine-body-render ~11 + others):** native CORRECTLY fires `E-UNQUOTED-DISPLAY-TEXT` on BARE arm-body text (§4.18.7 enforcement per the S163 ruling); QUOTED arm-body text is BYTE-IDENTICAL native==default (PA-verified both forms). These resolve via the deferred bare→quoted corpus migration OR accepted-as-known-divergence until M6 deletes the live pipeline. **NOT a native dispatch — needs a user ruling on whether to do the §4.18 migration now or keep deferring.**
3. **Missing-enforcement / lower-leverage** (lifecycle-shape1 ~12, structural-in-logic ~11): native compiles clean where default fires an error (inverse-shape); real parity work but no adopter-corpus emit move — schedule after the emit-producing families.

**Other downstream codes in the 509** (E-TYPE-001 14, E-TYPE-020 12, E-CODEGEN-INVALID-JS 12, E-MATCH-NOT-EXHAUSTIVE 6) need per-fixture triage to find the native parse ROOT (the surface code is downstream).

## NEXT-SESSION OPENER (recommended)
Given the clean-single-gap phase is exhausted, the highest-value next moves (pick per appetite):
- **Re-triage the current 509** (the original triage's clean targets are consumed + its loci were wrong 3×) to find any remaining clean single-gaps before grinding a meaty family blind. OR
- **F2-match (F3)** or **F2-generator** — the next real native gaps (meatier; survey-STOP gate stays on). OR
- **§4.18 corpus-migration ruling** — surface to the user: do the bare→quoted migration now (kills engine-body-render + others) or keep deferring to M6.
- The Phase-A default-flip itself remains a STANDING USER DECISION; PA ships parity-closers feeding it. v0.8 target.

## OPEN QUESTIONS / DESIGN CALLS
1. **Phase-A default-flip = STANDING USER DECISION.** PA never dispatches "the flip."
2. **§4.18 corpus migration** (bare→quoted arm-body text) — DEFERRED per S163; needs a ruling on do-now-vs-defer. ~11+ flip-failures (engine-body-render) are this, NOT native bugs.
3. **v0.7 → v0.8 placement** — the swap is a v0.8 target; 509 remaining (meatier).

## CARRY-FORWARD (backlog)
- **F2 sub-families queued:** F2-generator (`server function*`) · F2-match (F3) · F2 assign-RHS.
- **FLAGGED native follow-ups (benign, from this session):** native attr-value `span.start` is block-relative inside lift/each markup-as-value subtrees (pre-existing; the exprNode pass propagates it → benign SPAN-COORD residuals; emit byte-identical) · nested-engine `acceptsType:null` pairing (benign EXTRA-FIELD on hierarchy fixtures).
- **native `.scrml` mirrors FEATURE-stale (S162)** — all native fixes this session were `.js`/`.ts` only; the `.scrml` mirrors untouched (moot until a re-sync).
- **Bug backlog (MED 9):** Bug 1 Tailwind · V-kill READ-side · MCP V0 deferrals · Generator policy · L19 · A5 freeze · R28-1d (NOT-REPRODUCED) · C6 · Bug 14 MCP.
- **LOW backlog** (incl. the S162 `.scrml`-mirror feature-staleness, `is given`/`is not given` predicate-drift).
- **S154 carry:** body-split/CPS debt · per= per-instance engines (DD) · self-tree-shaking build-story DD-candidate · self-demo scrml.dev F1/F2 debate · 6NZ caps stray.

## PROCESS LESSONS BANKED (S164)
- **Triage loci are HYPOTHESES, not ground truth** — wrong 3× this session (F2 parse-sql-body→translate-stmt; lift parse-expr-span→lex-in-code; table-for tableFor-capture→typeBodyText). Every brief treats the triage locus as a hypothesis the agent's Phase-0 VERIFIES; the default-clean/native-fail SYMPTOM + byte-diff is reliable.
- **Survey-STOP gate earned its keep 2× more** (B2→F1-narrow+B2 reframe; F2→3-root decomposition). Multi-root families get decomposed + the clean PROCEED subset dispatched; the rest queued.
- **§4.18 enforcement is NOT a native bug** — native correctly fires E-UNQUOTED on bare arm-body text; verify quoted-vs-bare before classifying an "arm-body drop" as a native fix.
- **flip-remeasure perl MUST be line-agnostic** (`s/^    parser = null,$/.../` regex-only, NO `$.==N` gate) — api.js line drifts after every landing (a hardcoded `$.==630` silently produced a bogus "2-fail" control reading after the exprNode landing shifted it to 631).
- **Wait for a background commit's completion notification before reading HEAD/coherence or doing the next git-index op** — reading mid-commit shows stale 0/N-1 (happened 2×; harmless but confusing; the commit lands a few sec later).
- **isolation:worktree branches from origin/main** (`f11db672`, unpushed-behind) — every dispatch's startup `git merge <latest-local-HEAD>` to inherit the session's landings + fresh maps (worked cleanly all session); file-delta must filter the resulting stale-views (docs the agent's base lacks).

## pa.md directives in force
- Rules R1–R5. `---` delimiter (S152). Profile A/B (S156). `full wrap`/88% floor (S139). Standing-autonomy grant (this session: review→land→R26→next, surface on STOP-needing-ruling / family-decision / re-measure milestone).
- Dispatch discipline ALL held: S88 isolation · F4 startup-verify · S112 merge-startup (every dispatch merged latest HEAD) · S99/S126 Bash-edit + no-`cd` (S100 hook active) · S136 BRIEF.md (all 6 dispatches archived) · S138 R26/dual-verify (PA-independent EVERY landing) · S147 branch-leak coherence (every commit). `--no-verify` forbidden (agents self-remediated; held).
- Canonical dev-agent `scrml-js-codegen-engineer` (all fix dispatches). Triage via `general-purpose` (read-only). Re-measures PA-direct (throwaway worktree).

## Tags
#session-164 #profile-a-full-start #native-parser-swap-loop #51.0.S-fully-native-parity #message-arm #exprNode #argExprNodes #lift-closetag #f2a-chained-sql #table-for-typebody-newline #flip-674-to-509 #5-families-landed #triage-loci-are-hypotheses #survey-stop-gate-x2 #4.18-not-a-native-bug #wrap #pushed #high-0
