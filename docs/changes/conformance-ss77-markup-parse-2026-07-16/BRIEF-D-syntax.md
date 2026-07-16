# BRIEF D — syntax codes: `not` value-position + `@.` contextual sigil (§42, §17.7.3)

Preamble: `BRIEF-COMMON.md` (read it — setup, method, escalation discipline).
Suggested category dir: `conformance/cases/parse-syntax/` (create it) — or extend
`conformance/cases/equality/` for D1 if that reads more naturally. Do NOT modify existing cases.

## Items — one code per item, each a reject-path POS + a clean NEG

### D1. `E-SYNTAX-042` — a `not`-value-position syntax error (§42)
- Fire sites: `compiler/src/gauntlet-phase3-eq-checks.js:553` and `:655` (**two sites**).
- The diagnostic message begins "In value position, replace …".
- **Read §42 (`not`) before authoring.** `not` is scrml's single absence value — there is no
  `null` and no `undefined`; both map to `not`. But `""`, `0`, `false`, `[]`, `{}` are DEFINED
  values, NOT absence. The code is about `not` used in a **value position** where the language
  requires a different form.
- **Predicate-form trap:** `is not not` is NOT scrml. A presence test is `is some`. If you write a
  malformed predicate your case will fire the wrong code (or nothing). Grep the guard and read §42
  rather than inventing the surface syntax.
- POS + NEG. Report which of the two guards your POS hits and what the message-suggested
  replacement is (do NOT assert the message text — impl freedom — but it tells you the intent).

### D2. `E-SYNTAX-064` — the `@.` contextual sigil used outside its valid context (§17.7.3, Bug 70)
- Fire sites found by the sPA: `compiler/src/type-system.ts:9088`, `:11431`, `:12594`
  (**three sites**). NOTE: the original list cited `type-system.ts:13819`, which did **not** appear
  in the sPA's grep — that ref is stale or there is a fourth site. **Grep `E-SYNTAX-064` across
  `compiler/src` yourself and enumerate every site** before choosing your trigger; report what you
  find (including whether `:13819` exists).
- Read **§17.7.3** for what the valid `@.` context IS — the code fires when `@.` is used OUTSIDE it.
- POS: `@.` outside a valid context → `E-SYNTAX-064`.
- NEG: `@.` **inside** a valid context → silent. The NEG is the load-bearing half here: it pins the
  boundary. A NEG that just omits `@.` entirely proves nothing.
