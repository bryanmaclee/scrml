# BRIEF — E-SQL-004 corpus data-loss disposition (RULED S264: option B)

The E-SQL-004 R26 sweep (S263) surfaced 11 samples/examples with a genuine `?{}`-without-`db=`
data-loss bug the silent `new SQL(":memory:")` fallback was masking — 6 were compiling CLEAN
(the fix flips them to E-SQL-004), 5 already had other errors (E-SQL-004 additive). None gate
the test suite. **bryan RULED (S264, option B): migrate the 2 shipped `examples/`, track the 9
`samples/`.**

## DONE — migrated (S264, PR `feat/s264-e-sql-004`)
- `examples/05-multi-step-form.scrml` — `<program db="./signups.db">` + `<schema> signups` (the
  signup INSERT now has a real db + table; was silently dropped to `:memory:`).
- `examples/29-engine-vs-flags.scrml` — `<program db="./items.db">` + `<schema> items`.
- Both re-verified via the post-fix compiler (compile exit 0, no E-SQL-004). **Human RE-VERIFY
  owed** — these are `examples/VERIFIED.md` teaching material; only bryan marks verified.

## REMAINING — tracked (9 `samples/`; later corpus-cleanup pass — none gate the suite)
- **4 clean-before** (compile today, flip to E-SQL-004 under the fix — the actionable set):
  `samples/compilation-tests/server-005-mixed.scrml` ·
  `samples/compilation-tests/gauntlet-r10-react-wizard.scrml` ·
  `samples/compilation-tests/server-008-form-handler.scrml` ·
  `samples/gauntlet-r14/htmx-forms.scrml`
- **5 already-erroring** (E-SQL-004 is additive noise; `db=` alone won't make them compile —
  low value to touch in isolation): `samples/debate-async-dashboard-react-perspective.scrml` ·
  `samples/multi-step-form.scrml` · the `samples/compilation-tests/gauntlet-s19-phase2-*097`
  case · `samples/gauntlet-r13/htmx-forms.scrml` · `samples/gauntlet-r13/react-auth-dashboard.scrml`

## DONE (S274 — bryan ruled option (a): migrate + document the native-parity growth)
The **4 clean-before samples** migrated (wrapped in `<program db="./X.db">` + a `<schema>`
matching each `?{}` query): `server-005-mixed` (articles) · `gauntlet-r10-react-wizard`
(registrations) · `server-008-form-handler` (users) · `gauntlet-r14/htmx-forms` (messages).
All compile clean (E-SQL-004 gone), PA-verified.

**Native-parity tradeoff (bryan-ruled).** The added `<program>` wrapper hits a PRE-EXISTING
native-parser divergence on program-node structure (proven: even a minimal `db=`-only wrapper,
no schema, grows it identically — it's the wrapper, not the schema). So 4
`parser-conformance-within-node-allowlist.json` entries grew: server-005 MISSING-FIELD 9→10 +
SPAN-COORD 2→4 · r10 SPAN-COORD 273→275 · server-008 SPAN-COORD 12→14 · htmx MISSING-FIELD
132→133. A known native gap newly-exercised, NOT a fresh regression; grows against the
allowlist's shrink-only default by explicit S274 ruling (option (a)). The test is a
non-required baseline (already 17-fail on main). r10's e2e-render-map cell returns to its
existing `renders-clean` baseline (no baseline edit needed).

## STILL TRACKED — the 5 already-erroring samples (unchanged; low-value — `db=` alone won't compile them)
`samples/debate-async-dashboard-react-perspective.scrml` · `samples/multi-step-form.scrml` ·
the `gauntlet-s19-phase2-*097` case · `samples/gauntlet-r13/htmx-forms.scrml` ·
`samples/gauntlet-r13/react-auth-dashboard.scrml`

DONE-PROBE: grep -q 'db=' samples/compilation-tests/server-005-mixed.scrml
