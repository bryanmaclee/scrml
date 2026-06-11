# SCOPE — `fn` / `pure function` canonicity-framing currency reframe (close the S176 deprecate-pure prose tail)

**Change-id:** `fn-pure-canonicity-reframe-2026-06-11`
**Session:** S183 · **Origin:** dog-food finding (I-FN-PROMOTABLE lint teaches the deprecated form) · **User ruling S183:** Full SPEC §48.11 reframe (option C — close the currency tail properly, Rule-3).

## The finding

The **S176 deprecate-pure amendment** (2026-06-09) reframed the canonical home — §33 head banner, §34 W-PURE-DEPRECATED/W-PURE-REDUNDANT-superseded rows, §48.11 head (23064), §23048 — to: **`fn` is THE canonical pure form; `pure function` is the DEPRECATED long-form synonym (identical semantics); bare `function` is impure.** But it left **~14 derived sites still framing `pure function` as the live canonical long-form `fn` abbreviates** ("ergonomic shorthand for `pure function`") and several teaching the now-dead `W-PURE-REDUNDANT`. A dog-food hit the adopter-visible one (the I-FN-PROMOTABLE lint).

## The reframe principle (propagate the EXISTING §48.11 framing — do NOT invent new wording)

The canonical target framing already lives in SPEC §48.11 (23064) + §33 head (16542) + §23048. Propagate it:
- **"ergonomic shorthand for `pure function`"** → **"the canonical pure form"** (drop the canonicity inversion — `fn` is canonical, `pure function` is the deprecated synonym).
- **"`fn` ≡ `pure function`" framed as `pure function` being canonical** → keep the equivalence FACT but note `pure function` is deprecated: "`fn` is the canonical pure form; `pure function` is its deprecated synonym (identical purity contract)."
- **"new code MAY use either form"** → **"new code SHALL use `fn`; `pure function` is deprecated (W-PURE-DEPRECATED)."**
- **"`pure fn` is valid/redundant (W-PURE-REDUNDANT)"** → **"`pure fn` is DEPRECATED (W-PURE-DEPRECATED, which supersedes the former W-PURE-REDUNDANT)."**
- kickstarter: kill the "reach for the explicit `pure function` form" recommendation entirely.

## INVARIANTS (do NOT change these)
- **Semantic equivalence stays TRUE.** `fn` and `pure function` enforce the identical §33.3 purity contract — that is what makes the deprecation safe. KEEP every statement of the equivalence-as-fact (just mark `pure function` deprecated where the framing implies it is the live canonical form).
- **CONF-S32-004 unchanged.** `compiler/tests/conformance/s32-fn-state-machine/s48-fn.test.js` locks "`fn` SHALL be semantically equivalent to `pure function`" (body-invariant equivalence). That conformance test + its assertion stay — only surrounding framing prose (if any) clarifies `pure function` is deprecated.
- **§33's BODY is the legacy-semantics reference BY DESIGN.** Its head banner says "The §33 body below documents the legacy semantics." Do NOT reframe §33.1/§33.2/§33.3 examples (`pure function add(...)` etc.) — they intentionally document the deprecated form. Only fix §33 sub-sites that frame `pure fn` as *valid/non-deprecated* (e.g. the §33.6 "redundant but valid" framing if it contradicts W-PURE-DEPRECATED).
- **ZERO behavior change.** No codegen, no logic, no lint-firing change. W-PURE-REDUNDANT is already dead (superseded); the lint still fires the same I-FN-PROMOTABLE on the same sites — only its message text changes. No new/removed error codes.

## Site inventory (the stale tail — verify each against current SPEC before editing; line numbers drift)

### SPEC.md
1. **§48.13:23087** — "`fn` is semantically equivalent to `pure function`" — equivalence; add "(deprecated synonym)" qualifier, keep the fact.
2. **§48.13:23095** — "**Amended 2026-04-20 (S32).** … new code MAY use either form." — STALE → "new code SHALL use `fn`; `pure function` deprecated."
3. **§48.13:23107** — "The `pure fn` combination is valid. `pure` adds memoization…" — STALE → "`pure fn` is deprecated (W-PURE-DEPRECATED); `fn` carries the contract."
4. **§34 I-FN-PROMOTABLE row (~16987)** — "promote … to the `fn` shorthand (`fn` ≡ `pure function` per §48.11)" — STALE → "promote … to the canonical pure form `fn`."
5. **§5643 table row** — "`fn name { … }` | Ergonomic shorthand for `pure function`" — STALE → "the canonical pure form (`pure function` is the deprecated synonym)."
6. **§16599** — "`fn` is an ergonomic shorthand for `pure function`. Both forms enforce identical purity constraints…" — STALE framing → "the canonical pure form; `pure function` is the deprecated synonym, identical purity contract."
7. **§22609** — "`fn` is now declared as an ergonomic shorthand for `pure function`." (S32 prologue prose) — STALE → canonical-form framing.
8. **§22613** — "It is an ergonomic shorthand for `pure function` (§33); the two forms are semantically equivalent…" — STALE → canonical-form framing.
9. **§23309** — "`pure fn` is valid but redundant (W-PURE-REDUNDANT, §33.4)." — STALE (W-PURE-REDUNDANT dead) → "`pure fn` is deprecated (W-PURE-DEPRECATED)."
10. **§56 promotion prose ~31425 / ~31483** — "`fn` ≡ `pure function` per §48.11" / "`fn` is the ergonomic shorthand for `pure function`" — STALE → canonical-form framing.

### Compiler source
11. **`lint-i-fn-promotable.js:289`** (the EMITTED lint message — adopter-visible, the dog-food hit) — "`fn` is the ergonomic shorthand for `pure function` (§48.11)" → "`fn` is the canonical pure form (§48.11)".
12. **`lint-i-fn-promotable.js:14`** (file doc comment) — "fn ≡ pure function" → canonical-form note.
13. **`ast-builder.js:6718, :6733, :9640`** + **`type-system.ts:7876`** — comments using "fn ≡ pure function" / "redundant pure (W-PURE-REDUNDANT)". Update the ones that frame LIVE behavior wrong (the W-PURE-REDUNDANT-emit comments now emit W-PURE-DEPRECATED). `type-system.ts:8138` already says "SUPERSEDES the former W-PURE-REDUNDANT" (current — leave).

### Docs
14. **`docs/articles/llm-kickstarter-v2-2026-05-04.md:1929`** (WORST adopter-facing) — "**`pure fn` is REDUNDANT** (§33.6 … `fn` ≡ `pure function`) … fires `W-PURE-REDUNDANT`. … reach for the explicit `pure function` form…" → reframe: "`pure fn` / `pure function` are DEPRECATED (W-PURE-DEPRECATED); `fn` is the canonical pure form. Run `bun scrml migrate --fix`."

### Test docstrings (low priority — comments, not adopter-visible; update for currency)
15. `m67-d2-server-function-parse.test.js:18`, `transition-decl-purity.test.js:4`, `ast-builder-nested-fn-keyword.test.js:13` — "§33.6: fn ≡ pure function" docstring comments. Optional; update the framing if cheap, leave the assertions.

## Tests
- No test asserts the I-FN-PROMOTABLE message text (verified S183 — the reword breaks no test). Confirm the full gate stays green.
- CONF-S32-004 must stay GREEN unchanged (it tests body-invariant equivalence, not framing prose).
- Smoke: a promotable `function` still fires I-FN-PROMOTABLE (with the new message) — confirms the message change didn't break the lint.

## Out of scope
- §33's legacy-semantics body examples (intentional legacy reference).
- The semantic-equivalence FACT + its conformance test.
- Any codegen / lint-firing / error-code change (none — this is prose + 1 message string).
