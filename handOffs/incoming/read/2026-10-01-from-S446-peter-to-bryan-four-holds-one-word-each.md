---
from: S446-peter (P-Tech1 — PA)
to: bryan
date: 2026-10-01
subject: "four reviewed drafts, each waiting on one word from you — plus four language questions with a recommendation"
needs: action
status: unread
---

# Four held drafts, one word each

Each is a **draft PR**, built and adversarially reviewed (S239 + a narrow re-review after every fix round), merged up to
main at or after 78e4ddad. Your answer is a stamp; landing is one merge from us (re-sync + merge-on-green).

## 1. #1208 — defer SPEC calls B1/B2/B3/A2 (your S439 item 6) **+ "Part A"**
- **Ruled:** the four SPEC calls (S439 #6, "yes to all four").
- **Not explicitly ruled — Part A:** widens `E-DEFER-OUTSIDE-FUNCTION` to `when` bodies, handler attributes, component
  definitions, `<match>` arms, exported components, `<channel>` `<onchange>` arms, `!{} catch` arms. It appears only in
  our S432 gift-wrap note ("merge the hold after A lands"), not in the ratified text; under the S435 TS policy it is neither
  security nor bootstrap. Evidence for: it applies S430-P3 rule 4 ("every other position") to bodies it had missed, and it
  only rejects programs that shipped `defer` verbatim into client JS. Corpus diagnostic diff (2228 files, both front-ends): 0.
- **Known misses (filed, SPEC text softened, not fixed):** `g-defer-ambiguous-lead-binder-census-misses-four-shapes`.
- **Ask:** "stamp Part A" → we land #1208. "No" → we rebuild the four SPEC calls on main without Part A.

## 2. #1211 — client-JS relative `.js` helpers copied into dist (your S440 item 16)
- Ruled: copy the helpers (the import is legal).
- **Not explicitly ruled, needs your stamp:**
  - (a) **`E-IMPORT-011` for a helper OUTSIDE the project root** — rejects an import the ruling calls legal (no
    `scrml.toml`/`.git` → root falls back to the source root; monorepo helpers above the root). Alternative: a namespaced copy.
  - (b) **classic pages whose bundles carry an ES import get `type="module"` on every bundle tag** — required for the copy
    to load at all. Checked across 58 example pages in real Chrome: 0 behavioural diffs vs classic.
  - The denied-class (`E-IMPORT-011` on `*.server.*`, dot-paths, 8.3 short names) and missing-file (`E-IMPORT-006`)
    errors fit your S440 #12 security carve-out.
- Corpus impact of (a)+(b): zero (examples, samples, aM, flogenceP — byte-identical builds).
- **Recommendation:** stamp (b) and the denied/missing errors; keep (a) fail-closed.

## 3. #1210 — impl#1 F11/F15/F16/F17 (bootstrap blockers) — bare-dot ctor typed from the callee's parameter
- Mechanism: a bare `.Neg(x)` takes the type it flows into — including an **imported** function's declared parameter type
  (read from the import graph, no new inference). An unstamped ctor never gets a by-name guess for an imported-only name.
- Gate held across 284 rows (6 rounds, each re-reviewed): **nothing correct on main returns wrong data.** The 18 F-variants
  pass (main: 6). r6's final independent check: **LAND-READY-PENDING-RULING** — no under-count to wrong data; component and
  lift expansion are counted; main-correct → wrong = 0 / 284 rows.
- **Your ruling — newly loud (fail-closed) where main guessed right:** when a local enum and an imported enum declare the
  same payload variant with different fields, every position TS cannot stamp is now `E-VARIANT-AMBIGUOUS` (38 rows: a
  comparison operand `k == .Neg(1) ? …`, `&&`/comma operands, a callee shadowed by another binding, a name declared as a
  function twice in the file, an untyped return). Main picked the local enum by name — right whenever the local was the
  destination, silently wrong otherwise. §14.10 already says bare variants need type context.
- **Residual (filed):** M11/S21/S22 — a call argument inside a string-lowered match-arm result is a TYPED §14.10 position
  impl#1 can't type; fix = give every arm result a TS-typed node (option a). S2/S3/S4/S17b — context-less positions §14.10
  says should be `E-VARIANT-AMBIGUOUS`; impl#1 lowers a local enum by name.
- **Ask:** "accept the newly-loud class" → we land #1210. Or name which positions must stay accepted.

## 4. Language questions surfaced this session (recommendation in each)
- **Commented-out `<schema>` copy** (`g-schema-commented-out-declaration-shadows-live-table`): a union over declarations
  alone OVER-scopes when a stale commented copy carries `tenant_id` (runtime: `SELECT *` silently `[]`). **Rec:** union +
  a loud diagnostic when same-name declarations disagree on `tenant_id` (new code — yours).
- **`CREATE TABLE x (LIKE tmpl INCLUDING ALL)`** (`g-schema-create-table-like-template-columns-not-declared`): the floor
  misses the copied `tenant_id`. Ambiguous with a column named `like`. **Rec:** treat `LIKE <ident>` followed by
  `INCLUDING|EXCLUDING|,|)` as a template reference and fail closed (E-SCHEMA-014).
- **Nested-sequence stale read** (`g-handler-nested-sequence-server-write-stale-read`): `${ if (@c) { @x = save(); @y = @x + 1 } }`
  still reads stale (#1217 fixed only top-level lists). **Rec:** keep the fire-and-forget skip only when the cell write is
  the handler's SOLE root statement; await in place everywhere else.
- **Generated prod/headless servers bind every interface** (`g-generated-headless-and-prod-servers-bind-all-interfaces`):
  #1207 made `dev`/`serve` loopback-by-default. **Rec:** headless serve targets default to loopback; prod stays all-interfaces.
- **E-ATTR-MULTI-STATEMENT** (from the retired S432 handler hold): a multi-statement value in a non-handler attribute
  (`title=(f(); "t")` silently drops the attribute today). Unruled new code. **Rec:** yes, fail closed.

## FYI — landed this session (merge-on-green; every one S239-reviewed)
#1212 handler statement lists (ruled S439 #4) · #1209 schema holes fail-closed (S440 #15) · #1207 loopback default +
`--host` shorthand/whitespace refusal (S439 #1) · #1217 server-call write awaited in a handler list (S439 #4) · #1219
test hygiene (58 files leaked happy-dom globals) · #1220 §K test POSIX-only path (main windows was red since c12b52c2 —
S447's #1215 test; fixed at Peter's direction, S447 notified on the board).

— S446-peter
