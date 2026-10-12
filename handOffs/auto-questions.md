# AUTO questions — what bryan reads when he breaks in ("the Qs")

Newest first. One at a time (axiom floor). Each: context · options · recommendation · what it blocks.

## 2026-10-11 (S465 AUTO) · merge-denied — this run could not merge anything; PRs below are ready for you to merge
- The cloud session's permission classifier refused `gh api -X PUT …/pulls/1405/merge` ("Merge Without Review") — the S462 wrap PR, docs-only, `gate` green. pa-auto §1 forbids working around a denial, so this run merged NOTHING: every finished item is a pushed branch / open PR, listed under "ready to land" below.
- **Ready to land** (each `gate` green on its head; code PRs carry a CLEAN S239 review on a frozen commit, summarised in the PR body): **#1407** P0 SQL chain (`.get().name` returned the whole row incl. the hash) · **#1409** lift `<pre>`/`<code>` XSS · **#1408** brace-less else miscompile · **#1410** `<md>` phase 2 · **#1411** 237-site bare-return migration (emit byte-identical) · **#1412** PRIMER/kickstarter + maps · **#1406** gap filing. Suggested order: #1407, #1409, #1408, #1410, #1411, #1412, #1406 (each later one may need "Update branch" after the one before merges; none conflict by file except `docs/known-gaps.md` counts, which `bun scripts/state.ts --write` regenerates). S461 merged via the same REST call without a refusal, so this is new classifier behaviour, not a token problem.
- (a) [rec] you merge the listed PRs by hand (each has a green `gate` and, for code, a CLEAN S239 review recorded on the PR). (b) add a standing permission rule for the cloud environment so AUTO's `gh api … /merge` is allowed (then AUTO lands its own work again). (c) both.
- Blocks: every landing; and the queue items that must start AFTER another lands (7 after 3, 8 after 4, 11 after 5).

## 2026-10-12 (S465 AUTO) · cfor-comma — is a comma in a C-style `for` header (`for (i = 0, j = 5; …; i++, j--)`) refused like any other comma sequence?
- The await-fix branch refuses comma sequences on the server, citing §40.8 (S441 bullet) / §4.18.2 "scrml has no comma operator". The SPEC names no exception for `for` headers, so the server also refuses `i++, j--` there; the client still lowers it as JS.
- (a) [rec] refuse it everywhere (client too) — one rule, matches the SPEC sentence; (b) allow commas only in C-for init/update, on both sides, with one SPEC sentence; (c) leave the client/server split.
- Blocks: nothing — the branch refuses on the server either way.

## 2026-10-11 (S465 AUTO) · md-unclosed-quote — OK to keep one new §67.2 sentence: an unterminated quote inside an `<md>` slot makes the `${` unclosed?
- The S462 review of `<md>` phase 2 found that `` `${"}` `` in prose, followed by a `}` on a later line, swallowed the prose between them into an expression. The S465 fix lexes the slot like §4.18.1b: a quote that reaches its line end unclosed means the `${` is unclosed → E-MD-INTERP-UNCLOSED (existing code). The agent recorded this as one new §67.2 sentence marked "PA reading, s462-md-phase2 review fix MED-B". It only refuses shapes that are already invalid JS (a regex holding a quote was a false positive — being fixed in round 2).
- (a) [rec] keep it (newly-rejecting only for broken slots; fails closed). (b) strike the sentence and treat it as implementation detail of §4.18.1b. (c) prefer code-span-aware slot scanning (a `${` inside backticks is never a slot) — a bigger change to §67.2.
- Blocks: nothing — the `<md>` phase 2 PR states the sentence is pending your OK.

## 2026-10-11 (S465 AUTO) · value-fn-migration — the "no value holds a function" refusal newly refuses 6 corpus files and ~108 test fixtures; migrate them?
- You ruled (S462 "a" + "go on the package") that an object/array literal storing a function is refused, and that a non-zero corpus count comes back to you. AUTO built the check (branch `auto/s465-value-function-stored` @ 51f2b60c, type stage, read from the tree; 18 unit tests; stopped before SPEC rows / conformance cases) and measured 3,621 files.
- Newly refused (all real positives under the ruling): `conformance/cases/error/handler-failable-reference-exempt-neg` (`<fns> = [plain]`), and five old repros under `docs/changes/s441-*` (`{ m: (x) => x + 1 }`, `{ f: check }` ×2, an object field holding an arrow, `{ run() { return 7 } }`). Plus ~108 tests in 11 files whose inline scrml stores functions (mostly one thenable prelude `{ then: (f) => f(x) }` in the s457 handler tests, `toString`/iterator hooks in protect egress tests, #284 dispatch maps).
- (a) [rec] migrate: rewrite the conformance case and the fixtures to pass functions instead of storing them; leave the historical `docs/changes` repros as-is (they are records, not live code) or mark them. Then land the refusal + §34 row + §14.3/§15.11.5 sentences. (b) exempt the test-fixture shapes the thenable/iterator tests need (a host-protocol carve-out) — widens the ruling. (c) hold the refusal.
- Also decide: map-literal values are refused too (AUTO read "every value" to include them).
- Blocks: queue item 9, and the narrowing-checker simplification after it.

## 2026-10-11 (S465 AUTO) · markup-stmt-code — what is the error code for "statement-position markup that would not render" (your Q24 "a")?
- You ruled (S462 Q24 "a") that markup in a logic body that would not be rendered is a compile ERROR naming `lift`, never a silent drop. No existing code fits (E-CG-003 is a compiler-defect code; E-STMT-NO-EFFECT / E-LIFT-* / E-CTX-* / E-MARKUP-001 mean other things), and a new code name sets direction, so AUTO may not mint one.
- Shapes that need it: two elements in one `if`/`given` arm; an element after a statement in an arm (`let k = 1⏎<b>…</b>` — today that one even runs the display text as code, gap `g-statement-markup-after-statement-text-runs-s462`, HIGH); a `for` body without `lift`; a logic `match` arm `{ <p>…</p> }`; a nested `${ if }` inside an implied-lift element; an arm the implied-lift desugar declines (`a < b` or a quoted `"</p>"` in its text).
- (a) [rec] `E-MARKUP-STATEMENT-NOT-RENDERED` — the name the S462 draft used; message: "this markup is in statement position and is not rendered — write `lift <p>…</p>`". (b) `E-LIFT-REQUIRED`. (c) another name you prefer.
- Worked code: `${ if (@ok) { const n = 2⏎ <p>count ${n}</p> } }` → (a)/(b): compile error naming `lift`; today: renders nothing, or runs `count` as code.
- Blocks: queue item 4 (branch `wip/s464-markup-text-not-code` @ 5d0debf2 — done except this; reverting commit dee0e1d5d restores the full draft once the name is ruled) and queue item 8 (Q24 build).

## 2026-10-11 (S465 AUTO) · enum-cell-context — does `<col> = Col.Red` (no `: Col`) let a later bare `.Blue` resolve?
- Today a bare variant write into an UNANNOTATED cell is E-VARIANT-AMBIGUOUS in a function body; in a one-line if/else event handler it used to compile (the handler body was never type-checked). The brace-less-else fix routes those handlers through the statement path, so they now report the same error. A dev round made the cell's initializer enum count as context (so both forms compile); the review showed that rests on the §66.3 rule 5 "PA reading S462 — veto window" (`E.V` is a literal of `E`), which you have not ratified and which is about §66 own values, not `<x> = …` cells. AUTO backed it out: handlers now match function bodies (newly-rejecting, measured corpus impact required to be 0 before landing).
- (a) [rec] ratify the reading for cells too: an unannotated `<col> = Col.Red` has type `Col`, so `.Blue` resolves everywhere (newly-accepting in function bodies; one sentence in §14.10). (b) keep §14.10 literal: annotate (`<col>: Col = .Red`) or write `Col.Blue`.
- Worked code: `type Col:enum = { Red, Blue }` · `<col> = Col.Red` · `function go() { @col = .Blue }` → (a) compiles; (b) E-VARIANT-AMBIGUOUS, fix by `<col>: Col = .Red`.
- Blocks: nothing — the brace-less fix lands either way; (a) would be a small follow-up.

## 2026-10-11 (S465 AUTO) · cps-control-guard — may a browser-side check that reads a server value gate later server work? (§19.9.9.8 rule 3)
- The S239 review of the P0 CPS branch found (PA-reproduced by emission): `@ok = vp(pass, ?{SELECT pw …}.get().pw); if (!@ok) { alert("wrong"); return }; ?{INSERT … session-granted}.run()` compiles into two server routes with the `if` running in the browser. Anyone can call the second route directly, so a wrong password still gets the INSERT. Same with a role check before a DELETE. A pure `if (!@ok) { return }` IS refused (E-RI-002); adding any browser call (`alert`) to the guard re-opens it. Base main behaves the same, so this is old, but the branch claims to close this class.
- Why AUTO stopped: §19.9.9.8 rule 3's last sentence (*"permitted only if no later server statement reads anything it derived"*) allows it — the later INSERT reads nothing the guard derived; it only depends on the guard by CONTROL flow. Refusing it means amending a sentence you ratified at S464, which is your call.
- (a) [rec] amend rule 3: a browser statement that reads a server-originated value and can skip or end the function (`return` / `fail` / `break`, or an `if` whose body holds later server statements) is server-tier; if it also needs the browser, E-RI-002. Newly-rejecting; the reviewer measured 0 such sites in 951 example/sample files. (b) keep rule 3 as is and document that a browser-side guard is not a security check. (c) refuse ANY browser statement between two server batches in a CPS-split function (strictest; more refusals).
- Worked code: the snippet above → (a)/(c): E-RI-002 at the `if`, telling you to move `alert` after the server work or split the function; (b): compiles, the INSERT route is callable by anyone.
- Blocks: landing the P0 CPS branch (queue item 1). The other findings are in fix round 2.

## 2026-10-11 (S465 AUTO) · lost-gap-list — the S462 wrap's list of gaps to file is gone
- The S462 wrap-gaps agent read its input from `gaps-to-file.md` in the S462 session scratchpad on the ASUS. That file is not in either repo. The agent had finished only ONE entry (the unquoted `attr=@cell` widening → PR #1406). Everything else on that list is unfiled.
- (a) [rec] if the ASUS scratchpad still exists (`/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/ded336eb-…/scratchpad/wrap/gaps-to-file.md`), commit it to scrml-support and queue the filing for the next AUTO run. (b) drop it; the reviews' findings will resurface.
- Blocks: nothing queued.

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
