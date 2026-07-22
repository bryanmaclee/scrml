# README flagship example — triage of the 8 compile errors

**S280 · 2026-07-22 · compiled on main `7caf8f34`**
Method: concatenated README's 4 ` ```scrml ` blocks (they are one program — block 1 opens `<program>`, block 4 closes `</>`), compiled with `compiler/bin/scrml.js`. Every classification below is checked against a **quoted normative SPEC sentence**, not inference.

## Headline

**0 of 8 are nominal. 7 contradict the SPEC. 1 is downstream of those 7.**

README's disclaimer says: *"the language as designed, the shape the compiler is actively converging on. Some snippets may not compile clean against any given commit."* That covers **compiler-lags-spec**. Not one of these is that. Every one is a place where the README describes a form the **spec itself forbids** — so the disclaimer does not cover them, and no amount of compiler progress will make them compile.

## Class A — CONTRADICTS SPEC (7)

| # | Code | What README does | Governing sentence |
|---|---|---|---|
| 1 | `E-SCHEMA-001` | `<program>` (no `db=`) + a separate `<db src="tasks.db"/>` element | §39.12: *"A `<schema>` block **SHALL** be valid only inside a file whose `<program>` root element has a `db=` attribute."* |
| 2 | `E-SCHEMA-004` | `passwordHash: (not to string)` as a schema column type | §39.12.8: *"The compiler does NOT auto-infer schema column constraints from lifecycle annotations; **the two surfaces are orthogonal. Adopters declare each explicitly.**"* Legal column types: text, integer, real, blob, boolean, timestamp. |
| 3 | `E-SCHEMA-004` | `completed_at: (not to timestamp)` as a schema column type | same as #2 |
| 4 | `E-CHANNEL-007` | `<channel name="tasks" topic="user-${@user.id}">` | §38.11: *"The compiler **SHALL** emit `E-CHANNEL-007` when `name=` (or `topic=`)"* contains interpolation — *"static literal required"* |
| 5 | `E-REACTIVE-003` | `loadTasks()` reads `@user` inside a server-escalated fn | §6.6.9 *"Reading Client Cells Inside Server Functions"*: reading a client cell *"inside a WHOLLY server-escalated function **is a compile error**"* |
| 6 | `E-REACTIVE-003` | `createTask()` reads `@user`, same shape | same as #5 |
| 7 | `E-AUTH-GRAPH-003` | `<auth role="User">` where `User` is a **`:struct`**, and no role enum declares a `User` variant (resolver fell back to `Filter`) | §40.1.1: the gate must reference *"a variant tag that is ... in the resolved role-enum's variant set"* |

## Class B — DOWNSTREAM (1)

| # | Code | Note |
|---|---|---|
| 8 | `E-CG-001` | Client bundle failed to parse, so the §14.8.9 protected-field egress check fails **closed**. A cascade of the 7 above, not an independent finding. |

## ⚠️ Three of these are taught as features in the prose

Not merely broken code — the surrounding paragraphs explain the broken form as a capability:

- *"`completed_at: (not to timestamp)` is a lifecycle gate — the column starts unset and becomes a timestamp when written"* → §39.12.8 says lifecycle and schema columns are orthogonal surfaces. **The README teaches a composition the spec explicitly separates.**
- *"that state auto-syncs across every device signed into the same account"* → depends entirely on the interpolated `topic=`. The diagnostic states the interpolation *"silently breaks any per-instance scoping the adopter intended."* **The claimed behaviour is the exact behaviour that does not happen.**
- *"`protect="passwordHash"` makes that field server-only"* → sits on a schema column that does not parse (#2).

## Every fix is named by its own diagnostic — this is not a redesign

| # | Fix |
|---|---|
| 1 | `<program db="tasks.db">` instead of bare `<program>` + `<db src=>` |
| 2,3 | schema declares `passwordHash: text` / `completed_at: timestamp`; the lifecycle annotation moves to the `:struct` field per §39.12.8 |
| 4 | static `name=`/`topic=` + payload-side filtering on `targetId` (the fix the diagnostic names) |
| 5,6 | pass the user explicitly — `loadTasks(@user)` with a matching parameter (arguments ARE marshalled; the fix §6.6.9 names) |
| 7 | declare `type Role:enum = { User, Admin }` and gate `<auth role="User">` against it |
| 8 | resolves once 1-7 do |

## Two warnings worth a separate look

- **`W-AUTH-CONTENT-NOT-GATED`** — *"`<auth role="User">` gates only JS mount/behaviour (and only under `--emit-per-route`), NOT served HTML content."* README's framing is *"auth-gated"*. That is a claim-accuracy question independent of the 8.
- **`E-DG-002` ×2** — `@user` and `@tasks` reported *"declared but never consumed"*. But `@tasks` **is** read by `const <visible> = match @filter { .All :> @tasks … }`. Possible false positive in the consumed-detector; worth a probe, and if confirmed it is a compiler finding rather than a README one.

## Recommendation

These are not a nominal-content policy question. Whatever policy bryan wants for spec-ahead README content, **7 forms here are wrong against the current spec and teach adopters patterns the compiler is correct to reject.** The fixes are mechanical and named by the diagnostics.

**Timing:** the outreach letter to Tris Oaten points at this repo, and the flagship example is the first code a visitor reads.

**Once fixed:** the corrected program should land as `docs/readme-snippets/tasks-app.scrml` inside the U1 snippet corpus (`scripts/snippet-gate.js`, merged #140), so README's blocks become excerpts of a gated file and this class cannot recur.
