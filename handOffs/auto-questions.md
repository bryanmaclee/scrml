# AUTO questions — what bryan reads when he breaks in ("the Qs")

Newest first. One at a time (axiom floor). Each: context · options · recommendation · what it blocks.

## 2026-10-09 (S461 AUTO) · promoted-onclient-handler — is a plain `function` handler that route inference moves to the server also an E-CHANNEL-006?
- E-CHANNEL-006 now fires when an `onclient:*` handler is DECLARED `server function` (PR #1379). A plain `function onOpen(e) { broadcast(…) }` used as `onclient:open=onOpen(e)` compiles, gets I-FN-PROMOTABLE, and the client still calls it locally. The SPEC sentence (§38.10.3) says "declared `server function`", so AUTO built only the declared case.
- (a) [rec] also refuse it: an `onclient:*` handler whose body route inference places on the server (it reads server-only state, or calls `broadcast`) is E-CHANNEL-006 with a "this handler needs the server because <reason>" message. This needs one SPEC sentence widening "declared" to "declared or inferred". (b) leave it: the declared case only, and the promoted one stays a silent local call that fails at runtime. (c) a warning instead of an error.
- Worked code: `<channel name="c" onclient:open=onOpen(e)> ${ function onOpen(e) { broadcast({ joined: true }) } } </channel>` → (a): E-CHANNEL-006; (b): compiles, and `broadcast` is undefined in the browser.
- Blocks: nothing queued; it is the remaining half of the E-CHANNEL-006 intent.

## 2026-10-09 (S461 AUTO) · narrowing-after-write — does a write to a narrowed cell end the narrowing, and should the SPEC say so? (gap `g-narrowing-survives-writes-incl-callee-s460`, HIGH)
- Today `if (@user is some) { clear(); @user.name }` compiles clean and throws a TypeError when `clear()` set `@user = not`. The bootstrap already drops the narrowing on a direct write, a callee's write and a nested-block write; impl#1 does not.
- Why AUTO stopped: no SPEC sentence says a write ends a narrowing. §42.3.5 item 2 says only *"Inside the narrowed scope `recv` is `T`"*, and §42.4 statement 8 says the test narrows *"where the test is true"*. Searched §42.2.3, §42.3.5, §42.4, §42.7. So the fix is a SPEC amendment (newly-rejecting: E-TYPE-046 fires where it did not), which is a ruling, not something AUTO may do.
- (a) [rec] add one §42.3.5 sentence: *"A write to the narrowed place — direct, in a nested block, or by a call whose write set includes it — ends the narrowing from that point; a later bare member access is E-TYPE-046."* Then dispatch impl#1 using the callee write set where known (dpa-070 §6 caveat i), with a measured corpus count first. (b) the same, but any call to a function whose write set is unknown also ends the narrowing (stricter, more false positives). (c) leave it: narrowing is lexical, writes do not end it (keeps the runtime TypeError).
- Worked code: `<user>: { name: string } | not` · `function clear() { @user = not }` · `if (@user is some) { clear(); @user.name }` → (a)/(b): E-TYPE-046 at `@user.name`; (c): compiles, crashes when clicked.
- Blocks: AUTO queue item 2, third HIGH gap.

## 2026-10-09 (S461 AUTO) · given-bool-head — how is `given <boolean expression> :>` refused? (gap `g-given-bool-expr-fail-runs-unconditionally-s460`, HIGH)
- `given id < 0 :> fail LoadError.NotFound` compiles to a presence test on `id` with an empty body, a stray `0;`, and a `fail` that ALWAYS runs. SPEC §42.2.3 governs it: *"A `given` head SHALL contain only an identifier-list."* So refusing it is a conformance restoration, newly-rejecting.
- Why AUTO stopped (three reasons): (1) the corpus is NOT zero — 3 conformance cases use the shape (`conformance/cases/error/{failable-match-nonexhaustive-ok, failable-match-nonexhaustive-err, propagate-incompat-variants}`, they pass because they assert other codes) plus `docs/changes/derived-engine-expression-form-2026-06-13/repro/11-call.scrml`; (2) no existing error code fits — E-SYNTAX-044 is "property path in `given`", E-SYNTAX-045 is "rebind with `=`"; a new code NAME is not AUTO's call; (3) the related gap `g-given-outside-machine-rule-body-mislowers-silently` suggests `given n { n > 10 :> … }` may be a legal form inside engine rule bodies, so the refusal's boundary needs care.
- (a) [rec] refuse a non-identifier-list `given` head outside engine rule bodies with a new code `E-SYNTAX-GIVEN-HEAD` (or widen E-SYNTAX-044's row to "any non-identifier `given` head"), migrate the 3 conformance cases to `if (id < 0) { fail … }`, and close the sibling gap with the same fix. (b) reuse E-SYNTAX-044 as-is (cheaper, but its message talks about property paths). (c) make `given <bool> :>` a boolean guard (a widening, newly-accepting — not recommended).
- Blocks: AUTO queue item 2, second HIGH gap.

## 2026-10-09 · is-some retirement — does `is some` retire now that `is given` is the explicit positive? (dpa-070 §10 Q4)
- S460 ruled one presence test: bare `x` on `T | not` in conditions, `x is given` / `x is not` as the explicit pair. `is some` is still accepted and narrows (ratified as the alias of `is given`). 241 corpus sites use it, 94 in stdlib.
- (a) [rec] retire through the §63 window: W-lint now + reserved E-code + a `scrml fix` rule rewriting to `is given` (mechanical — `is-some` is its own AST op). (b) pre-1.0 strike (§63.7), no window. (c) keep both as permanent aliases.
- Blocks: nothing urgent; the two-spellings-of-one-test cost grows with every new site.

## 2026-10-09 · given-as-presence — does `given x :>` (in-place guard + match arm) retire? (dpa-070 §10 Q5)
- The rebind `given c = @h :>` (§66.7.5) stays either way. In-place `given` has 9 corpus uses, all S19 gauntlet fixtures, and `given @cell :>` is currently BROKEN on impl#1 (HIGH gap, ReferenceError).
- (a) [rec] retire in-place `given` (arm becomes `not :>` + `else :>`); fix nothing in its lowering. (b) keep it and fix the lowering.
- Blocks: whether queue item 2's first HIGH gap is fixed or retired — AUTO will fix it unless this is answered (a).

## 2026-10-09 · impl1-adopt — does impl#1 adopt the S460 condition rule, or stay Nominal until the bootstrap replaces it?
- impl#1 still lowers bare `if (@x)` on an optional as JS truthiness (`""`/`0` hidden). The S460 measurement found 2 sites whose visible behaviour would flip silently (trucking `if=(l.weight_lbs)`).
- (a) [rec] stay Nominal on impl#1 (S440 Q2 "impl#1 keeps today's behaviour"); migrate the 2 sites to `is given` by hand. (b) adopt in impl#1 now (newly-rejecting + semantics-changed; measured migration first).

## Carried from S459 (dPA verdicts awaiting a ruling) — deep-dives in scrml-support/docs/deep-dives/*-2026-10-08.md
- **dpa-065** (O35): a non-literal own value needs `:T`? — rec: infer within a file from the initializer; failed inference = hard error; live fork = require `:T` where the type leaves the compilation unit.
- **dpa-068**: bare `return`/`fail`/`break`/`continue` as a match-arm body — W1 4–1, + one §18.4 sentence.
- **dpa-069** (O18): undeclared use-site attributes — R now (E-DECL-USE-ATTR + §34 row; 0 adopter sites) + X (typed opt-in forwarding) as the only widening.
