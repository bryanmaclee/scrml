# Operator decision queue — COMPLETE enumeration

Swept 2026-08-30. Working checkout `/home/bryan-maclee/scrmlMaster/scrml` was on branch
**`rule/s385-dpa024`** (not `main`) — read-only throughout; both repos verified clean afterward.

## Channel sweep status — all 7 swept
1. `docs/known-gaps.md` — 818 `### ` headings + 125 marker-ids with NO heading (a real blind spot:
   7 bryan-routed HIGH/MED items live only in an un-headed S381-peter trailing block). 838 distinct
   gap ids; **357 open-ish**; 86 matched decision-owed language; 41 survived ruling-verification.
2. `handOffs/dpa-queue.md` — **36 of 36** items; 4 open.
3. `handOffs/incoming/` **3 of 3** unread + `../scrml-support/handOffs/incoming/` **1 of 1** unread
   (S386, 5 items — 2 ruled today) + the S358 bryan-lane queue (29 items across 7 groups).
4. `gh issue list` — **2 of 2** open.
5. `gh pr list` — **9 of 9** open (3 DRAFT).
6. `../scrml-support/docs/deep-dives/` — 287 files, 119 `status: current`, 51 with "PA action
   requested". PARTIAL: the 11 recent dPA-linked ones were cross-checked; **47 pre-S300 ones were not
   individually verified.**
7. `compiler/SPEC.md` — **13 of 13** distinct `SPEC-ISSUE-N` ids; 7 open.

## RAW: gh issues (2 of 2)
- #509 (2026-08-11) Direction: offline / PWA (service-worker + cold boot + sync) — native someday vs host-escape now?
- #471 (2026-08-08) Direction: enterprise document workflows (PDF/print/email/file-upload) — native vs host-escape?

## RAW: open PRs (9 of 9)
- #769 rule(dpa-024): ratified — and the architecture complaint measured, not argued (2026-08-30)
- #727 gaps(S379): session store keyed per compilation unit, not per program (2026-08-27)
- #655 gaps(S365): worktree-sweep probe (2026-08-23)
- #640 inbox: flint -> two silent-wrong-output cases (2026-08-22)
- #580 DRAFT fix(§38.1): nested <program> is a fresh channel-placement scope (2026-08-19)
- #579 DRAFT fix(§14.8.9): route the raw-egress gate structurally (2026-08-19)
- #559 inbox(from scrml-site): soft-nav stylesheet report + owed <outlet/> repro (2026-08-18)
- #529 DRAFT fix(browser-gate): run tier in SORTED file order (2026-08-14)
- #501 feat(§6.8.4): tare(@cell) — statement-position reset baseline (2026-08-10)

## RAW: dpa-queue sweep — 36 of 36 items enumerated (dpa-001..dpa-036)
Authority = the CURRENT STATUS table's rightmost "authority" column (the status-CELL text is stale for
~14 rows: it still reads "awaiting bryan" for items ratified S347-S365).
RATIFIED / dispositioned (NOT open): 001,002,003,004,005,006,007,008,009,012,013,014,015,017,018,019,
020,021,022,023,024(S353 + PR #769),025,026,027,028,030,031,032,033,034,035 = 32.
STILL OPEN (4):
- dpa-010 ADVISORY-not-ratified (reason-VCS vs executable-contracts; flogence-domain; de-facto in force)
- dpa-011 ADVISORY-not-ratified (PA test-rig design; flogence-domain)
- dpa-029 Q1 SHAPE — sequencing ruled S352 ("fix first, re-surface after"); the `Egress<Bytes>` mint
  DEFERRED-not-rejected; ruling artifact scrml-support/docs/rulings-pending/dpa-029-Q1-egress-envelope.md
- dpa-036 Call 5 — "warning->error default-on at v1" explicitly HELD S365, not decided
GATED/deferred, not owed now: dpa-016 (maps-vs-flogence, gate not met), dpa-008 enforcement (Pole-D,
gated on multi-tenant being live).

## RAW: SPEC-ISSUE sweep — 13 of 13 distinct ids
RESOLVED: 006, 007, 013, 026, 027. OPEN: 005 (HTML target version TBD) · 009 (bare-expr re-execution) ·
010 (if= remount, depends on 009) · 011 (reactive <timer interval=>; note: id DOUBLE-ALLOCATED — §19.3
says "SPEC-ISSUE-011 is resolved by this document" about throw->fail) · 012 (concurrent timer ticks;
ALSO double-allocated to Tailwind custom-theme deferrals) · 018 (SQL transactions §44.6) · 025 (server-cell
initial load parallel vs sequential). = 7 of 13 open.

## RAW: deep-dives sweep
287 files; 119 `status: current`; 51 contain "PA action requested". Recent dPA-linked ones cross-checked
against the dpa-queue authority column: dpa-026/027/028/029/030/031/032/033/034/035/036 deep-dive
FRONTMATTER still says "NOT ratified" but ALL were ratified S347-S365 -> STALE FRONTMATTER, not open items.
The 47 pre-S300 "PA action requested" files were NOT individually verified (see gaps section of report).

---

# THE DECISION QUEUE — grouped inventory

Verification key: **VERIFIED-OPEN** = I searched `../scrml-support/user-voice-scrml.md` (16,244 lines,
all sessions to S385) and the six `docs/changes/*/RULING.md` files for a ruling on this item and found
none. **UNVERIFIED** = candidate matched decision-owed language but I could not confirm absence of a ruling.

## A. BLOCKING — work is held, built, or stalled waiting on this

### A1. sqlite-wal-defaults (`g-native-sqlite-connection-lacks-wal-and-busy-timeout-config`)
**Q:** Should scrml open every sqlite database in WAL mode with a 5-second busy timeout by default, or
make the adopter ask for it?
**Options:** (a) safe defaults, no knob · (b) an author-facing `<program journal-mode= busy-timeout=>`
knob only · (c) both — safe default plus override (PA lean; what db.js itself does).
**Held:** the assetManagement db.js -> scrml migration. Cross-process writes get SQLITE_BUSY today.
Routed 2026-08-30 (S387), waiting 1 session. Turnkey brief: `handOffs/incoming/S387-peter-routes.md`.
**MED · VERIFIED-OPEN**

### A2. ssr-if-each-blank-paint (`g-ssr-each-under-if-template-silently-blank-first-paint`)
**Q:** When a list sits inside a conditional and the server already knows the condition is true, should
the server draw the list, or should the compiler just warn that it cannot?
**Options:** (a) fall back to client-render and fire the existing lint — kills the silence, cheap ·
(b) server-render the resolvable branch at first paint (also closes the sibling `if=@serverState`
never-server-evaluated finding).
**Held:** guarded lists in assetManagement paint blank with zero diagnostics. Routed S387, 1 session.
`handOffs/incoming/S387-peter-routes-ssr-if-each.md`.
**HIGH · VERIFIED-OPEN**

### A3. transaction-inside-a-function (`g-transaction-block-not-recognized-inside-a-function-body`)
**Q:** Should a `transaction { ... }` block be usable inside a function body, or is it top-level only?
**Options:** (a) fix the routing so it works inside a function (PA rec — unblocks the migration and
closes an atomicity hole) · (b) declare top-level-only and strike SPEC §19.10.2's own in-function
example plus the shipped sample, and document a safe atomic replace-all path instead.
**Held:** the assetManagement db.js migration arc; SPEC currently contradicts the compiler.
Routed S388, this session. `handOffs/incoming/S388-peter-routes-transaction.md`.
**HIGH · VERIFIED-OPEN**

### A4. given-guard-crash-and-shadowing (S386 route item 5)
**Q:** When a function parameter has the same name as a state cell, which one wins — and should the
compiler refuse the collision at all?
**Options:** (a) resolver-scope decides, parameter shadows the cell silently (today's behaviour) ·
(b) fire `E-NAME-COLLIDES-STATE` on the collision, as the PRIMER already says · (c) rule the shadowing
first, then rebuild the guard lowering on the resolver.
**Held:** a reworked-and-verified branch (`worktree-agent-ac4b2bc97820bea80`) is NOT merged because two
codegen attempts kept finding new shadow holes. `given @user :>` compiles clean and emits an undeclared
identifier. Routed S386 (2026-08-29). `../scrml-support/handOffs/incoming/S386-peter-routes.md`.
**HIGH · VERIFIED-OPEN**

### A5. reset-promise-stamp (`g-reset-writes-pending-promise-when-init-thunk-calls-a-server-fn`)
**Q:** Accept the built fix that makes `reset()` settle a server-backed cell the same way the
declaration path does?
**Options:** (a) stamp it and land · (b) send it back.
**Held:** branch `origin/fix/s360-reset-init-await-parity @ 3540a2d7`, built and verified (22,413 tests
pass), waiting on a stamp since S360 (~28 sessions). Listed under "BUILT + AWAITING YOUR STAMP" in
`../scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`.
**HIGH · VERIFIED-OPEN**

### A6. todomvc-hollow-gate-stamp (`g-todomvc-harness-dangling-runtime-ref-passes-silently`)
**Q:** Accept a change that makes the todomvc browser gate fail loudly on a dangling `<script src>`
instead of silently passing?
**Options:** (a) stamp the accepted-failure change and land · (b) keep the current lenient gate.
**Held:** branch `origin/fix/s359-todomvc-hollow-gate @ 681fdad6`, built, happy path still 44/0.
This is an M1 gate-acceptance change on a gap you authored, so it needs your stamp. Waiting since S359.
**HIGH · VERIFIED-OPEN**

### A7. dpa-029-egress-envelope-shape
**Q:** Now that the raw-egress fix is landing, does a server function that returns bytes get a typed
envelope of its own, or does it keep going out through the untyped escape hatch?
**Options:** (a) mint the typed `Egress<Bytes>` return (4-2 panel preference) · (b) leave it untyped
and rely on the structural redaction floor.
**Held:** your own S352 ruling was "fix first, re-surface after" — the fix is PR #579 (draft). The
`#471` return leg to the adopter is explicitly recorded as STILL OWED. Ruling artifact prepared and
waiting since S349: `../scrml-support/docs/rulings-pending/dpa-029-Q1-egress-envelope.md` (~36 sessions).
**HIGH · VERIFIED-OPEN**

### A8. asis-warning-to-error-at-v1 (dpa-036 Call 5)
**Q:** At v1, should the loud "the compiler could not infer this type" warning become an error by default?
**Options:** (a) default-on error at v1 · (b) stays a warning, opt-in error · (c) decide later, at the
freeze.
**Held:** explicitly HELD at S365 ("ratify 1, take 3 and 4, hold 5"); the rung-0 build on
`feat/s365-asis-split-rung0` is scoped around not knowing. ~20 sessions.
**MED · VERIFIED-OPEN** (the hold is itself the record — no later ruling found)

### A9. cell-initialiser-server-reach (`g-cell-initialiser-and-markup-interp-server-only-reach-do-not-escalate`)
**Q:** When a writable cell's initial value calls a server-only function, should the compiler move that
call to the server, or refuse it the way it refuses the derived-cell case?
**Options:** (a) refuse all three positions uniformly (fail-closed, matches today's derived rule) ·
(b) escalate the one-shot initialiser to the server (more powerful, and a one-way door) .
**Held:** deleting one keyword turns a refused program into a silent leak — `Bun.password` reaches the
browser at exit 0. The derived-cell rationale explicitly does NOT transfer, so nobody will build it
without you. Filed S331-era, open since.
**HIGH · VERIFIED-OPEN**

### A10. giti-returned-closure (`g-async-returned-function-expression-drops-return`)
**Q:** Should a factory that returns a named async function expression be supported, or refused loudly?
**Options:** (a) support it — emit `return async function d(){...}` and stop marking the factory async ·
(b) route it into the existing `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` refusal (giti has confirmed they can
restructure).
**Held:** giti's `server-helpers.scrml` (`composeScrmlFetch`); they shipped a hand-written `.js` instead.
Filed S269 from the adopter inbox — the entry says verbatim "needs bryan disposition". ~119 sessions.
**HIGH · VERIFIED-OPEN**

## B. ADOPTER-FACING — an outside consumer is affected

### B1. issue-509-pwa-direction (GH #509, open since 2026-08-11)
**Q:** The offline/PWA deliberation is done and the technical findings are posted — what design
direction do you want told to the adopter?
**Options:** (a) ship the static-asset floor + a documented recipe, defer the scaffold (the S347 rec) ·
(b) commit to a `scrml generate pwa` one-shot scaffold · (c) declare offline permanently out of scope.
**Held:** your own 2026-08-17 comment on the issue promises "the design direction will follow
separately." It has not been posted. 13 days.
**MED · VERIFIED-OPEN** (dpa-028 was ratified S347; the *return leg* is what is outstanding)

### B2. issue-471-document-workflows (GH #471, open since 2026-08-08)
**Q:** Same shape: the four routed defects are sequenced and the `File` primitive is ruled — what do you
want told to the adopter about the remaining egress-envelope half?
**Options:** (a) post the full direction now including the deferred `Egress<Bytes>` ·
(b) hold the comment until PR #579 lands and A7 above is ruled · (c) close the issue and reopen per-defect.
**Held:** the dpa-029 row records the `#471` return leg as STILL OWED. Last comment 2026-08-16.
**MED · VERIFIED-OPEN**

### B3. component-props-leak-onto-root (S386 route item 3)
**Q:** Should a component's declared props stop appearing as HTML attributes on its root element?
**Options:** (a) drop ALL declared props from the root's emitted attributes — they are bindings, not
attributes (PA lean) · (b) drop only the ones that collide with real HTML attributes (needs an allowlist).
**Held:** measured — 31 corpus files declare props; 5 leak functional attributes today (4x `title`,
1x `role`). SPEC §15 has no governing sentence, so it is a ruling not a fix. Routed S386, 1 session.
**MED · VERIFIED-OPEN**

### B4. render-a-list-of-markup-values (S386 route item 4)
**Q:** Should `<each>` be able to iterate an array of already-built markup values, or should that be
refused with a clear error?
**Options:** (a) REJECT — extend `E-CELL-RENDER-SPEC-NOT-BINDABLE` to markup arrays and add a diagnostic
for the derived form · (b) SUPPORT — make it a sixth door in §1.4.
**Held:** today the writable form crashes at mount and the derived form renders zero elements with no
diagnostic. §1.4's five doors are stated as exhaustive, so widening is a language-surface call.
Routed S386, 1 session.
**HIGH · VERIFIED-OPEN**

### B5. login-session-expiry (`g-program-sessionexpiry-inert-on-separate-login-unit`)
**Q:** When an app declares a 7-day session but the login page is a separate file, should the 7 days
apply to the cookie that login mints — or is the 1-hour default correct there?
**Options:** (a) make the program-level setting propagate to the minting unit (behaviour change) ·
(b) leave the behaviour, add an info-lint saying the setting is inert here · (c) working-as-intended,
document the 1-hour login default.
**Held:** adopter GH #282; declaring 7d silently gets 1h. §20.5 sanctions the 1h, which is why it is a
ruling. Re-filed S339 (~49 sessions).
**HIGH · VERIFIED-OPEN**

### B6. flogence-async-thunk-boundary (`G-ASYNC-STDLIB-IN-SYNC-CALLBACK-OVER-FIRES`, case 2)
**Q:** When an adopter passes an async thunk to their own higher-order function that awaits it, the
compiler refuses because it cannot prove the callee awaits. Do we give them a way to say so?
**Options:** (a) add a typed async-thunk / snippet parameter the compiler can colour ·
(b) document the workaround (inline it, do not thunk) and keep the refusal.
**Held:** flogence's `runGatedAgentic(() => runAider())` idiom. Case 1 was fixed; case 2 was explicitly
deferred "to an R2 design Q, NOT rushed under freeze" at S279. ~109 sessions.
**HIGH · VERIFIED-OPEN**

### B7. auto-lift-killed-by-one-prose-line (`g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line`)
**Q:** One sentence of prose above a helper function makes the helper ship as page text at exit 0 with
zero diagnostics. Is closing this the same held arc as ruling 3, or its own fix?
**Options:** (a) treat it as a plain defect and fix the lift (the entry argues the direction is
inert-to-fixing) · (b) fold it into the held ruling-3 grammar-derived-recognizer successor arc ·
(c) hold it with the arms, as ruling 3's arms are held.
**Held:** peter re-routed it at S386 as "YOUR HELD ruling-3 arc"; the ledger entry argues it is a
DIFFERENT defect and fixing either does not fix the other. This ambiguity is itself the decision.
**HIGH · VERIFIED-OPEN**

### B8. bare-ref-attr-binding (`g-bare-ref-attr-value-emits-literal-not-binding`) — VERIFY FIRST
**Q:** `class=@cls` emits the literal text "cls" instead of a binding. Is this still blocked?
**Options:** (a) confirm it is unblocked and send it to the build lane · (b) it is genuinely still held.
**Held:** the in-source comment and the gap both say "blocked on the #81 writer-ownership ruling."
**That ruling was given at S268** (Axiom 1, option B/C hybrid, built as `E-ATTR-WRITER-CONFLICT`) — so
the stated blocker looks stale and this may need only a confirmation, not a decision.
**HIGH · VERIFIED-OPEN as a routed item; the blocking premise is STALE**

### B9. delta-log-entry-22-kind (flogence bridge is HOLDING on this)
**Q:** One delta-log entry has a two-word kind (`state (deputy)`) while the documented vocabulary is
one word. Normalize the entry, or widen the format to allow a qualifier?
**Options:** (a) edit `[22]`'s kind to a single token (e.g. `state-deputy`, or move `(deputy)` into the
body) — zero parser change, keeps "kind is one token" checkable (flogence's own read) · (b) widen the
format to admit a trailing parenthesised qualifier.
**Held:** flogence's import bridge is REFUSING your stream at the checkpoint — it holds at 2,169 of
2,171 entries rather than importing a partial. They said explicitly "it is your log and your call, and
I will mirror whichever you take." Reported 2026-08-29 (1 session).
Source: `handOffs/incoming/read/2026-08-29-from-flogence-RE-bridge-regex-mirrored-and-a-FIFTH-entry-your-widen-does-not-recover.md`.
Live instance confirmed at `handOffs/delta-log.md:171`; the vocabulary is documented at `:12`.
**MED · VERIFIED-OPEN**

### B10. delta-log-shape-as-a-published-contract (flogence said yes)
**Q:** flogence accepted your offer to publish the delta-log entry shape as a contract instead of three
copies drifting apart. Do you want that authored, and who owns it?
**Options:** (a) scrml publishes the regex + field vocabulary as a versioned contract · (b) leave the
three copies · (c) hand ownership to flogence.
**Held:** the shape has now drifted out from under a consumer twice. Their answer was "Yes, please."
**LOW · VERIFIED-OPEN**

## C. DESIGN — language surface, accept-vs-reject, one-way doors

All of these are in the standing bryan-lane queue at
`../scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md` unless noted. All VERIFIED-OPEN.

### C1. if-attr-subscript (`g-if-attr-subscript-silently-dropped`) — HIGH
**Q:** Should an index like `if=@list[0]` be allowed in an attribute value, or refused?
**Options:** (a) amend §5.2 so the attribute tokenizer accepts brackets · (b) refuse unquoted subscripts
with a diagnostic · (c) leave it and document the parenthesised workaround.
**Held:** today the subscript is silently dropped and the guard tests the wrong value at exit 0 — it is
GENERIC to all unquoted attribute values, not just `if=`. Routed S360 (~28 sessions).

### C2. expr-positions-field-gate (`g-expr-positions-field-gate-blind-plus-hand-rolled-lists`) — HIGH
**Q:** The gate that is supposed to catch every expression position is blind to three fields — do we
make the gate structural, or keep hand-maintained lists?
**Options:** (a) derive the field set from the AST types · (b) keep the list and add the three ·
(c) accept the blindness and document it.
**Held:** confidentiality seed — it is the gate your security lane depends on. Routed S360.

### C3. derived-helper-placement (`g-5c-caller-context-promotes-a-derived-read-helper-to-the-server`) — HIGH
**Q:** When one pure helper is called by both a server route and a client derived cell, which side owns it?
**Options:** (a) fail closed — refuse, extend `E-DERIVED-SERVER-ONLY-REACH` (gate-consistent) ·
(b) dual-place it so both sides get a copy (correct output, needs dual-emit).
**Held:** today the cell renders `[object Promise]`. The gap's own fork, ruled S343/S345 to be its own
arc. ~27 sessions.

### C4. mangler-retirement (`g-lambda-param-renamed-to-fetch-stub-when-a-server-fn-shares-its-name`) — HIGH
**Q:** Do we keep the post-emit regex that renames function names, or retire it for a scope-aware pass?
**Options:** (a) retire the mangler (an architecture arc) · (b) patch this instance and keep it ·
(c) refuse the name collision at compile time.
**Held:** a lambda parameter gets renamed to a fetch stub while its body still uses the old name —
runtime ReferenceError at exit 0. Routed S360.

### C5. server-cell-init-leak (`g-server-cell-init-leaks-const-to-client-reactive-wiring`) — HIGH
**Q:** Should a server-authority cell's initial value (and the constants it reads) be kept out of the
client bundle entirely?
**Options:** (a) treat `server` state-decls as server-only in the reactive-wiring prune ·
(b) narrower: prune only the referenced consts · (c) leave it, document the leak.
**Held:** `<_apiKey server> = SECRET` ships `SECRET` into `index.client.js`. Confirmed by execution on
main. Filed S300 (~88 sessions).

### C6. stdlib-prune-shadow (`g-prune-server-only-stdlib-chunks-keeps-chunk-on-textual-occurrence`) — HIGH
**Q:** A client-side local named the same as a server-only function keeps the server chunk alive — do we
consult route inference here instead of matching text?
**Options:** (a) build the route-inference-consult substrate (the derived-transitive arc) ·
(b) narrow textual masking further · (c) accept the over-inclusion.
**Held:** argon2id reaches the browser at exit 0. String-literal vector closed S361; the shadow vector
re-verified live S372. ~16 sessions.

### C7. param-default-server-reach — HIGH (two gaps: `g-trigger-3-parameter-default-not-scanned` +
`g-destructured-param-default-ships-server-only-stdlib-to-browser`)
**Q:** Should a function *parameter default* that calls a server-only function move the function to the
server, the way its body already does?
**Options:** (a) yes — feed parameter defaults to the same scanner (over-fire is the safe direction) ·
(b) no — refuse the shape instead · (c) leave it.
**Held:** it is a §12 confidentiality boundary failing silently in the unsafe direction, and it changes
placement (programs gain a `.server.js`), so it needs your co-sign plus a corpus differential.

### C8. ws-body-ceiling / maxBodySize (`g-ws-message-door-has-no-body-ceiling-d4-census-missed-it`) — HIGH
**Q:** Where should a maximum request/message body size live — a compiler constant, or an author-facing
`<program maxBodySize="...">` attribute?
**Options:** (a) compiler-owned constant now, no language surface · (b) mint the `<program maxBodySize>`
attribute (a language addition needing ratification) · (c) both.
**Held:** the WebSocket message handler does `JSON.parse(raw)` with no length guard. The source header
explicitly says do not invent the attribute without ratification.

### C9. at-sigil-on-non-reactive-local (`g-at-sigil-on-non-reactive-local-silent-undefined`) — HIGH
**Q:** What should `@name` resolve against — only state cells, or also function parameters and locals?
**Options:** (a) normative §6.1.2 answer: cells only, and refuse the rest · (b) resolve locals too ·
(c) keep silent-undefined.
**Held:** `@nm` on a parameter reads `undefined` silently; `@alias.field` inside `<each>` crashes with an
opaque TypeError. A narrowed fix was built and REVERTED (false fires on the §6.7 canvas-ref pattern).
Full brief + 2 forks in the S358 queue. Note: this item lives ONLY in an un-headed trailing block of
`docs/known-gaps.md`, so heading-based sweeps miss it.

### C10. engine-initial-state-hydration (`g-engine-decl-coupled-bind-dead-on-state-remount`) — HIGH
**Q:** When an engine's initial state is server-rendered and then re-rendered on the client, which copy
owns the bindings?
**Options:** (a) populate the initial state's per-state wire with the client ids · (b) have the engine
adopt the hydrated SSR view and skip the first re-render (alone this leaves Back->Info dead) · (c) both.
**Held:** flagship example 05 (multi-step form) is stuck on step 1 and compiles clean. Root-caused and
turnkey S382; no DOM/e2e gate exists that would catch a mis-wire.

### C11. derived-engine-projection (`g-derived-engine-projection-ignored`) — HIGH
**Q:** `<engine for=T derived=@src>` emits two substrates and consults the wrong one. Do we finish the
rich projection form or retire it?
**Options:** (a) parse and use the `derived=match @x {...}` projection form · (b) retire the rich form
and keep identity · (c) diagnose the unsupported form.
**Held:** flagship 14's risk banner never renders. The identity path is deliberate; the correct map is
built and never consulted.

### C12. fail-variant-shorthand (`g-fail-variant-shorthand-rejected-by-ts-context`) — HIGH
**Q:** Is `fail .Variant` (without the enum name) legal? Two normative sections disagree.
**Options:** (a) amend §19.3.1 to admit the bare form — conformance restoration per §62.2 (PA rec) ·
(b) reject it and rewrite the 5 corpus files to the qualified form (contradicts §14.10, the docs, and a
flagship).
**Held:** flagship `09-error-handling` and `login.scrml` have FAILED TO COMPILE since S236 and no gate
caught it. Root-caused S382, ~3-line fix once ruled.

### C13. checked-boolean-attr (`g-checked-expr-attr-always-checked-for-falsy`) — HIGH
**Q:** Is one-way `checked=<expr>` a supported binding, or is `bind:checked` the only way?
**Options:** (a) support it and wire it reactively · (b) refuse it with a diagnostic (today it silently
renders checked for any falsy value).
**Held:** flagship 18. `class:done` on the same element handles `0` correctly, so the surface is
inconsistent. Also lives only in the un-headed trailing block.

### C14. if-attr-markup-field-limb (`g-if-attr-per-field-synth-cell-crashes-boot`, residual) — HIGH
**Q:** `if=@field.errors` on a markup-typed field is a dead page. Fix it or keep it refused?
**Options:** (a) extend the synth-cell path to markup-typed fields · (b) refuse it explicitly ·
(c) leave dead.
**Held:** the scalar limbs resolved S372; a test PINS `ctl === ""` so it flips loudly the day you rule.
Status literally `ruling-gated`.

### C15. server-call-nested-in-expression (`g-server-call-nested-in-expression-not-awaited-outside-fn-body`) — HIGH
**Q:** The position-invariant await guarantee is delivered by five post-hoc injectors rather than by
construction. Do we converge them now or keep retrofitting?
**Options:** (a) converge to one by-construction site · (b) add a sixth injector for this position ·
(c) narrow the §13.2 SHALL to the positions that actually hold.
**Held:** `onclick=@n = load().length` yields `undefined`. Routed S370 as the profile STAGE
re-examination test.

### C16. E-ROUTE-001-local-bind (`G-E-ROUTE-001-LOCAL-BIND-WORKAROUND-DEFEATS-CHECK-WITHOUT-REDUCING-RISK`) — HIGH
**Q:** The error message tells adopters to do the one thing that hides the problem. Widen the check or
correct the message?
**Options:** (a) run the check on `const`/`let` initializers too (raises the fire rate; owes a measured
migration; current rate is 10 fires across 1,020 files) · (b) accept the check cannot see through a
local bind and rewrite the message.
**Held:** a gate whose escape hatch is its own recommended fix.

### C17-C34 — MED design forks (each is accept-vs-reject or a semantics choice)
| handle | the question | options |
|---|---|---|
| `E-ROUTE-001-severity` | Is the unresolvable-callee route warning an Error or a Warning? §12.4 and the §34 row contradict each other, and one limb never fires. | a promote to Error · b amend §12.4 down to Warning; then separately decide if the missing limb becomes a fire site |
| `schema-composite-unique` | Should a table-level `unique(a, b)` line be grammar at all? Today it is silently dropped. | a add the grammar and emit (newly-accepting, one-way) · b reject loudly with a new diagnostic |
| `foreign-value-block-no-return` | A multi-statement `_{}` value block with no `return` yields undefined. Revise the S216 decision? | a auto-return the trailing expression (PA lean) · b error `E-FOREIGN-VALUE-NO-RETURN` · c keep silent-undefined |
| `session-reserved-key-read` | Should reading `session["csrfToken"]` be blocked at the read side? | a filter own-keys / block reserved reads · b leave it a runtime concern |
| `session-context-scan-bare-form` | Should a bare `session` in a `?{}` outside a route handler be build-blocked? | a build-block everywhere (newly-rejecting) · b record lowering sites instead of text-scanning · c leave it |
| `markup-interp-adjacent-space` | Should one literal space next to an interpolation survive? HTML collapses whitespace, so today's drop may be intentional. | a preserve one adjacent space · b full significant-whitespace in markup text · c working-as-intended |
| `attr-interp-quote-uniformity` (seam C) | `class="x-${...}"` compiles but `class='x-${...}'` is rejected. Support or reject the single-quoted form? | a support (newly-accepting) · b reject both consistently |
| `if-on-structural-element` | `if=` on `<engine>`/`<match>`/`<each>` is silently ignored. | a route them through the §17.1 mount gate · b reject with a diagnostic (§17.1 says "any HTML element or component", so rejecting is defensible) |
| `match-empty-arm-void` | An empty `{ }` match arm yields a truthy `{}` instead of void. 11 live corpus sites. | a make it void (measured migration) · b keep the object · c diagnose the empty arm |
| `match-else-arm-object-literal` | `else :> {obj}` in decl position crashes codegen and false-fires E-SCOPE-001 on object keys. Both fixes are reject->compile. | a accept both (newly-accepting, one-way) · b keep refused and improve the message |
| `bind-value-on-checkbox` | `bind:value` on a checkbox wires text semantics and never updates the bool. | a coerce to checked semantics · b reject with a diagnostic pointing at `bind:checked` |
| `engine-invalid-transition` | An unreachable engine transition throws at runtime; only a lint at compile. | a make it a compile error (engine reachability semantics) · b keep the runtime throw · c strengthen the lint |
| `ssr-each-multi-root` | Should the server pre-render `<each>` rows that have more than one root element? | a accept N-root SSR (a capability extension, not conformance restoration) · b keep the client-only fallback + the INFO lint |
| `value-const-misclassified-as-component` | `export const X = 42` is classified as a user component. | a narrow the classifier (wide blast radius: inlining, client-binding elision, parity gate) · b leave it |
| `conformance-runner-clean-intent` | Should a conformance case that intends to compile clean FAIL when it emits an unexpected fatal error? 22 of 502 clean-intent cases pass today while erroring. | a add the implicit no-unexpected-fatal check + an `allowFatal` opt-in (touches the §62.2 contract) · b leave the superset check |
| `component-worker-handler-reparse` | A worker handler inside a component is rejected by the native reparse path. Fixing it is newly-accepting. | a accept · b keep rejected |
| `parity-canary-gate` | The parity canary is outside every blocking gate and habitually red. | a promote to required (would be instantly, permanently red) · b keep advisory · c a scoped/baselined promotion |
| `cli-emits-artifacts-on-failed-compile` | Should the CLI still write output when a hard error exits 1? | a gate the write phase on no-fatal-error (changes an existing conformance expectation) · b keep writing |
| `sql-dynamic-identifier` | Should scrml offer a checked identifier-interpolation form for SQL, or just diagnose? | a add the checked form (widen) · b diagnostic only (limit) |
| `export-let-normative-home` | `export let` has no normative home in SPEC and the enforcement is not where the corpus says. | a spec the position · b move the enforcement · c reject the form |

### C35-C48 — LOW design forks (mostly direction-of-change on a diagnostic)
`namespace-signal-computed-bracket` (extend E-CG-006 to computed global access — security gate
completeness) · `E-TYPE-046-write-lhs-and-fn-param` (add the missing fire sites — newly-rejecting,
safety) · `route-001-object-literal-value-position` (stop a false-positive warning — 3 adopter reports)
· `tailwind-cross-file-class` (stop a cross-file lint false positive) · `flat-css-vs-author-style`
(which wins when both write `style=`? today the flat block wins by emit order) · `proto-object-key`
(should `{__proto__: v}` set the prototype or make an own property?) · `css-syntax-error-in-hash-block`
(does a broken `#{}` CSS block get a real diagnostic?) · `cleanup-keyword-shadowed` (a user `cleanup()`
declaration is never diagnosed) · `fn-anon-expr-body` + `anon-fn-return-type` (one expression-parser fix
covers both; support-or-reject) · `string-literal-dollar-brace-escape` (§4.18.3 literal-escape) ·
`bare-arrow-binding-false-e-mu-001` · `emit-html-on-prefix-strip` (`only=` becomes `addEventListener("ly")`)
· `bare-onTransition-no-op` · `rcdata-controlflow-interp` · `each-textarea-bindvalue-conflict`
(peter RECOMMENDS CLOSE — premise does not reproduce; your gap, your call) ·
`emit-differential-decline-vs-refuse` (decline or hard-refuse on a shared root) ·
`each-peritem-if-multiroot` + `lift-tier0-if-multiroot` (both `status=deferred`, awaiting a
`_scrml_group` model) · `windows-crlf-ci` (promote the green Windows suite into the blocking gate, or
add a separate non-blocking probe — the first trades a real asset).

## D. HOUSEKEEPING

### D1. commit-gate-on-your-xps-8950 (`g-commit-gate-absent-on-bryan-xps-8950`)
**Q:** Your own machine has no pre-commit gate installed, and installing the standard one would leave it
unable to commit because main is red against that gate. Which way?
**Options:** (a) fix the endpoint/ESM emit first, then install · (b) install and use a documented
per-commit bypass until fixed (weak — the no-`--no-verify` rule exists for a reason) · (c) install and
accept the red gate as a forcing function.
**Held:** you are committing without the gate every session. **MED · VERIFIED-OPEN**

### D2. dpa-010-reason-vcs / D3. dpa-011-pa-test-rig
**Q:** Two deliberations produced verdicts and were never ratified or rejected. Ratify, reject, or close
as flogence-domain and out of scrml's queue?
**Options:** (a) ratify as advised · (b) reject · (c) close as out-of-scope (both are flogence-domain;
dpa-010's "navigation-not-gate" is already de-facto in force).
**Held:** they sit as permanent open rows in the dPA status table, read as owed at every boot.
Advisory since 2026-06-24 (~175 sessions). **LOW · VERIFIED-OPEN**

### D4. spec-issue-005-html-target-version
**Q:** What HTML spec version does the compiler target by default? Marked TBD.
**Options:** (a) pin a version · (b) declare it a compiler config with a documented default ·
(c) strike the issue. **LOW · VERIFIED-OPEN**

### D5. spec-issue-009/010-bare-expression-re-execution
**Q:** Does a bare expression re-run when its scope remounts, or only once ever?
**Options:** (a) ratify "re-runs on each mount" in §17.3 (what §17.1 already assumes) · (b) once ever ·
(c) infer from the dependency graph (today's stated position).
**Held:** 010 is explicitly blocked on 009. Two normative sections currently assume different answers.
**MED · VERIFIED-OPEN**

### D6. spec-issue-011-reactive-timer-interval
**Q:** Should `<timer interval=@userSetting>` be allowed?
**Options:** (a) prohibit it normatively with a rationale · (b) specify reactive interval fully,
including in-flight ticks. The SPEC states both as the acceptance criteria.
**Note:** the id `SPEC-ISSUE-011` is DOUBLE-ALLOCATED — §19.3 also says "SPEC-ISSUE-011 is resolved by
this document" about `throw` -> `fail`. **LOW · VERIFIED-OPEN**

### D7. spec-issue-012-concurrent-timer-ticks
**Q:** When a timer body's async call has not finished and the next tick fires — queue, skip, or cancel?
**Options:** (a) queue (the installed safe default) · (b) skip · (c) cancel the prior call ·
plus: is it configurable per `<timer>`?
**Held:** "must be fully specified before the timer codegen pass is implemented."
**Note:** also double-allocated — §26 uses SPEC-ISSUE-012 for deferred Tailwind theme features.
**MED · VERIFIED-OPEN**

### D8. spec-issue-018-sql-transactions
**Q:** §44.6 says transactions are deferred to SPEC-ISSUE-018 with a `^{}` workaround — but §19.10.2
normatively specs a `transaction {}` block. Which is current?
**Options:** (a) close 018 as superseded by §19.10 · (b) 018 is still the real state and §19.10 is
spec-ahead. **Directly interacts with A3 above.** **MED · VERIFIED-OPEN**

### D9. spec-issue-025-server-cell-initial-load-ordering
**Q:** Does a server cell's compiler-generated initial load run in parallel with other mount-time
fetches, or sequentially?
**Options:** (a) parallel · (b) sequential · (c) specify the interaction with `lift` ordering.
**LOW · VERIFIED-OPEN**

### D10. stale-status-lines (a decision about the instruments, not the language)
**Q:** The dPA status table's status CELLS and the deep-dive frontmatter say "awaiting bryan" for ~14
items that were ratified S347-S365, and several `known-gaps` entries still say "RULING OWED" for
rulings you gave (S268 #81, S331 if-value, S354 handle-onion, S368 bare-call, S371 value-form). Do we
project these from the ratification record instead of hand-keeping them?
**Options:** (a) make the tables generated · (b) add a wrap-time reconcile step · (c) leave it.
**Held:** this is why the queue reads longer than it is, and it is the single biggest source of false
"still open" items. **MED · VERIFIED-OPEN**

---

# COUNTS

| group | items |
|---|---|
| A. BLOCKING | 10 |
| B. ADOPTER-FACING | 10 |
| C. DESIGN | 16 HIGH blocks + 20 MED rows + ~18 LOW = 54 |
| D. HOUSEKEEPING | 10 |
| **TOTAL** | **84** |

Verification: **84 of 84 checked** against `user-voice-scrml.md` + the 6 `docs/changes/*/RULING.md`.
**83 VERIFIED-OPEN · 1 VERIFIED-OPEN-BUT-BLOCKING-PREMISE-STALE** (B8).

## Items DELIBERATELY EXCLUDED because they were already ruled (would have been false positives)
- `g-default-logic-bare-call-is-unspecified-and-ships-as-page-text` — entry still says "OPERATOR RULING
  OWED"; **RULED S368, option (c)**.
- `g-value-form-control-flow-unspecified` — entry says "bryan-lane, NOT YET BUILT"; **RULED S371, limb (b)**.
- `g-block-body-value-position-mislowers` (if-value half) — **RULED S331** ("B. expound Q2").
- `g-handle-onion-applied-per-route-not-top-level-custom-paths-404` — entry says "§40.3 ruling owed";
  **RULED S354** (handle() is a literal onion).
- `G-FORMFOR-PE-FALLBACK-...` — entry says "DESIGN FORK, surfaced to bryan S347"; **RULED S349**
  (retire the mandate, not the capability).
- `G-SPA-RUNTIME-GZIP-BUDGET-KNIFE-EDGE` — **RULED S353**, the hold-vs-raise fork is dissolved.
- `g-nested-block-match-in-dispatched-arm-silently-drops` — **RULED TODAY, S385 ruling 2** ((b) SUPPORT).
- S386 route item 1 (channel mount in a match arm) — **RULED TODAY, S385 ruling 1** ((a) REJECT).
- S386 observation 3 (`<each in=@undeclared>` unchecked) — **RULED TODAY, S385 ruling 3**, and is now
  self-dispositioning under the new 4(b) PA mandate.
- `g-chunk-reachability-is-approximated-not-computed` — **RULED S372** (land wide); build-owed.
- `g-tenant-raw-egress-is-a-byte-identical-twin-of-the-protect-gate` — entry states "Ruling status: NONE NEEDED".
- `g-onmount-request-no-refire-on-soft-nav`, `g-route-timer-poll-not-stopped-on-soft-nav`,
  `g-e-import-007-triple-allocated-no-impl`, `g-channel-in-nested-program-inside-page-ordering` — all
  carry a `ruling-gated`-looking label but were RULED (S313 / S297 / S353); build-owed only.
- dpa-024 (RATIFIED S353 + S385, PR #769) · dpa-022/025/026/027/028/030/031/032/033/034/035/036 —
  all RATIFIED S338-S365 despite "awaiting bryan" status cells.
