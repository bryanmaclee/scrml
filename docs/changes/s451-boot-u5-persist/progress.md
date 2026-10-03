# s451-boot-u5-persist — progress (append-only)

## 2026-10-03 — start
- Worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-abb31119662c1a981, base b490f3b75 (== origin/main).
- Branch feat/s451-boot-u5-persist. bun install + pretest OK.

## 2026-10-03 — baseline + governing sentences (before any implementation)

Counter baseline (`bun scripts/bootstrap-conformance.ts` @ b490f3b75): PASS 42 · CODES-ONLY 0 · FAIL 18 ·
LEGACY 951 · UNSUPPORTED 277 · graded 60 (27 non-vacuous). No case in conformance/cases mentions `persist=`.

Verified (plan row "relayed"): `persist=` / `key=` land in `ADecl.mods` and were refused by
analyze.scrml `openerWordDiags` → `unknownOpenerMessage` ("§6.14 persist= is not in the bootstrap yet").
`<theme>` is refused as a whole by the bootstrap (counter: style/theme-* "not in the bootstrap") — so the
§6.14.2 rule 8 theme pre-paint combination is refused by construction.

Governing sentences (compiler/SPEC.md):
- §6.14.1 r1 — "`persist=` takes exactly one of two values: **`"local"`** … or **`"session"`** … Any other value SHALL be `E-PERSIST-STORAGE-UNKNOWN`."
- §6.14.1 r2 — "`persist=` without `key=` SHALL be `E-PERSIST-KEY-REQUIRED`. … the compiler SHALL NOT derive one."
- §6.14.1 r3 — "`persist=` is legal on client-owned state cells. On a §66 declaration it governs the **shared instance only**"
- §6.8.4 (opener position) — "In the §66 opener it is a **modifier** — the same class as `debounced=` (§6.13), `persist=` (§6.14) and validators — and so it stays INSIDE the opener" (resolves the bootstrap's spelling `let <x:T=v persist="local" key="k"/>` for a PROGRAM cell; a field's / per-instance position stays O-061-9 → refused).
- §6.14.2 r1 — "A `persist=` cell's stored value SHALL be read synchronously when the cell is constructed, before the first client render, inside a compiler-emitted host-JS storage guard … Restore is construction, not a transition."
- §6.14.2 r2 — "encoded and decoded with the §57 wire format and the §59.10 lossless codec" (+ §57.1 storage sink bullet).
- §6.14.2 r3 — "decoded against the cell's **current** declared type and its full declared contract … If the key is absent, storage is unavailable, the decode fails, or the decoded value does not satisfy the contract, the cell SHALL take its default … SHALL NOT be coerced … **§55 validators are not part of this contract** … a restore does not set `touched`."
- §6.14.2 r4 — "When the cell's value changes, the compiler-emitted code SHALL encode the new value and write it to storage under `key`, inside the storage guard."
- §6.14.2 r5 — "A `persist="local"` cell SHALL subscribe to the Web `storage` event for its key and apply a changed value written by another same-origin document, decoded under rule 3. A `persist="session"` cell has no cross-tab sync"
- §6.14.2 r6 — "A storage write that fails … SHALL NOT throw into user code. It SHALL be reflected in a read-only, compiler-synthesized status property … The property's name and shape are OPEN (O-061-1)." → no-throw implemented; the property has no name → not emittable (gap, below).
- §6.14.2 r9 — "`reset(@x)` on a persisted cell — including a `reset-on=` reset … SHALL write the reset value to the cell … and SHALL **remove** the cell's storage key instead of storing that value."
- §6.14.5 O-061-6 CLOSED — "a restore at construction fires no `<effect>` and no `reset-on=` reset".
- §6.7.4 — an effect drives the outside world "whichever writer changed that state (a handler, a `<channel>` push, a `<request>` result, a cross-tab `persist=` sync, a timer)" → a cross-tab sync IS a change for `<effect>`.
- §6.8.4 rule 7 — "whether a cross-tab `storage`-event write to a trigger is a change follows O-061-5." → OPEN → a `persist="local"` cell used as a `reset-on=` TRIGGER is REFUSED.
- §6.14.5 O-061-5 (OPEN) — "is it judged as a write under the §66.11 write contract (e.g. `rule=` guards) or applied as construction-like hydration?" → the two readings agree only for a cell whose contract grants `replace` and has no `rule=` graph; `persist="local"` on any other cell is REFUSED. Its other half ("what happens when it fails to decode … and when the key is removed") is read from r5's normative "decoded under rule 3" → the default (r3: "If the key is absent … the decode fails … the cell SHALL take its default"); agent reading, flagged for PA.
- §6.7.7.3 r3 — a "`persist=` cross-tab `storage`-event sync write" is server-origin; it matters only to write `<request>`s (re-baseline) and `debounced=`; both `<request>` and `debounced=` are refused by the bootstrap, so no write path exists to honor or violate.
- §6.14.3 r3 — "`persist=` on a server-authority cell (§52: `<x server>` …) SHALL be `E-PERSIST-WITH-SERVER`." → `server` in the same opener is detectable syntactically → fires (the `server` word is still refused on its own).
- §6.14.3 r1/r2 (REVEALED / LIN) — searched §6.14.3, §35, §14.8.9: the bootstrap parses neither `lin` cells nor `reveal` → cannot be expressed; not fired.
- §6.14.4.2 r2 — "`prepaint` on a cell without `persist=` SHALL be `E-PREPAINT-WITHOUT-PERSIST`" → fires; `prepaint` WITH `persist=` → E-BOOTSTRAP-UNSUPPORTED (no pre-paint script).
- §6.14.4.3 r2 — "A `hold=` whose operand is not a `persist=` cell SHALL be `E-HOLD-WITHOUT-PERSIST`" → fires; `hold=@persistedCell` → E-BOOTSTRAP-UNSUPPORTED (no HOLD). Before this change `hold=@x` was silently lowered as a plain DOM attribute (fail-open).
- Searched §6.14, §6.8, §66.9 for `persist=` on a LOCKED or DERIVED cell — none (derived = O-061-10 OPEN) → refused.
- Searched §6.14, §66.12 for a FIXED-length sequence under restore — §66.12 makes `Fixed` a write contract with no static length; restore is construction → no rule fixes whether a stored length may differ → refused.
- Searched §6.14 for two cells sharing one key — none (§6.14.1 r2 only calls the key "an external storage contract"; §6.14.4.2 r4 says "`key=` is unique per origin by the §6.14.1 rule 2 author contract") → same store + same key REFUSED (E-BOOTSTRAP-UNSUPPORTED), flagged as a SPEC question.
- O-061-7 (OPEN, write timing) — the store runs in the writing batch's flush (one store per batch, of the latest value). Needed for r9's "instead of storing": the reset's key removal cancels the queued store of the reset value.
