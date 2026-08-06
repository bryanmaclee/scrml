# PR review ledger — the S239 adversarial floor, made measurable

**What this is.** One machine-readable marker per MERGED PR recording that the S239 adversarial pass
ran, what it probed, and what it found. Parsed by `bun scripts/review-debt.ts`; **the marker is the
record — prose here is commentary and is never parsed.**

**Why it exists (S316).** The review floor (S313 — *"if it isnt us that makes the changes, we should
at least do a thorough review on it"*) had a **0% execution rate the day after it was ratified**:
eight PRs merged in one day, zero reviews on all eight, and it surfaced only because bryan asked
"have we looked at Peter's PRs?". The cause was structural, not a lapse — boot reads `gh pr list`
(**open** PRs), the floor binds **merged** ones, and nothing computed the difference. The obligation
was invisible to the session that incurred it and to every session after. Same shape as the S262
`gh issue list` miss: a channel the contract names but no probe reads.

**Marker form** — append one line per PR, newest at the top of the log section:

```
<!-- @review pr=<n> verdict=clean|finding|carve-out by=S<N>-<who> date=<YYYY-MM-DD> probe=<what-was-probed> [note=<slug>] -->
```

- `clean` — pass run, nothing found.
- `finding` — pass run, something found. `note=` names it; the detail belongs in `docs/known-gaps.md`.
- `carve-out` — pure docs / spec-text / config with no code path (pa-base §8 carve-out). **Recorded
  anyway**, so the skip rate stays measurable — a floor whose carve-out rate approaches 100% is
  decorative (§8, the absorbed escape hatch).

**This is DETECTION, not a control.** It never blocks a merge, and it is deliberately **not** wired
into CI: a gate instantly red over an existing backlog is the §8 cry-wolf shape that gets bypassed
and then deleted. It runs at boot and reports; the PA states the number.

**Epoch.** The floor binds **PR #385 and later** (`REVIEW_FLOOR_EPOCH` in the script). Earlier PRs
predate the rule and are out of scope by construction rather than by exemption.

---

## Log

<!-- @review pr=435 verdict=finding by=S323-peter date=2026-08-05 probe=fix-vs-prefix-conformance+executed-handler note=caught-E-SESSION-CONTEXT-scan-widening-regression-CONF-SESSION-STORE-PROGRAM-UNIFY-trimmed-pre-merge+2-findings-routed-bryan-csrf-read-disclosure-and-sound-scan -->
<!-- @review pr=434 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=433 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=432 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=431 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=430 verdict=carve-out by=S322-bryan date=2026-08-05 probe=own-review-floor-drain-docs-only-single-file-pr-reviews-md-no-code-path -->
<!-- @review pr=429 verdict=finding by=S322-bryan date=2026-08-05 probe=S239-across-3-fix-rounds-8-findings-one-build-breaking-all-fixed-plus-2-independent-post-hoc-lenses-then-wide-corpus-re-measure-on-the-REBASED-tree-1878-sources-7254-artifacts-syntax-delta-0-under-effective-script-AND-module-goggles-artifact-diffs-2-of-7254-both-on-sources-that-fail-to-compile-on-every-revision note=u1-emitcall-root-fix-lands-not-claiming-the-bug-class -->
<!-- @review pr=428 verdict=finding by=S322-bryan date=2026-08-05 probe=two-independent-adversarial-lenses-hollow-gate-and-arithmetic-found-9-defects-in-the-gate-itself-incl-node-check-blind-to-top-level-await-and-no-vacuity-floor-on-the-syntax-half-ALL-routed-back-as-a-fix-round-and-re-proven-PA-re-executed-the-H1-goggle-bite-and-the-bun-vs-node-vm-Script-divergence-rather-than-inheriting-them note=the-gate-built-to-kill-hollow-gates-shipped-hollow-and-the-floor-caught-it -->
<!-- @review pr=427 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-changelog-handoff-deltalog-no-code-path-peters-wrap-continuity -->
<!-- @review pr=426 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-BRIEF-and-gap-banner-SUBSTANTIATED-the-newly-accepting-code-VERIFIED-NOT-on-main-ba72eaa0-is-not-an-ancestor-and-lives-only-on-origin-feat-onmount-c-build note=deferral-recorded-without-landing-the-surface-change -->
<!-- @review pr=425 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-single-file-pr-reviews-md-peters-independent-drain-of-419-420-421-422-which-collided-with-my-424-he-merged-first -->
<!-- @review pr=424 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-known-gaps-plus-inbox-drain-no-code-path-own-gap-filings-rescoped-after-the-425-collision -->
<!-- @review pr=422 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-hand-off+delta-log+master-list-regen-no-compiler-src-no-SPEC-no-conformance-U1-round3-wrap-addendum -->
<!-- @review pr=421 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-continuity-maps-regen+pr-reviews+changelog+hand-off+delta-log+master-list+inbox-no-compiler-src-own-S321-wrap -->
<!-- @review pr=420 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-changelog+hand-off+delta-log-no-compiler-src-S319-wrap-continuity -->
<!-- @review pr=419 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-single-known-gaps-filing-renameCellAccessors-amplifier-no-code-path -->
<!-- @review pr=418 verdict=carve-out by=S321-peter date=2026-08-05 probe=own-review-records-and-brief-done-banner-docs-only-pr-reviews-and-BRIEF-no-code-path -->
<!-- @review pr=417 verdict=finding by=S321-peter date=2026-08-05 probe=S239-adversarial-pass-on-own-codegen-PR-found-F1-control-flow-body-under-skip-HIGH-fixed-module-fallback-plus-F2-implicit-double-write-preexisting-filed-runtime-conformance-proven-fail-prefix-pass-postfix note=reset-init-thunk-clobber-fix-hardened-pre-land -->
<!-- @review pr=416 verdict=finding by=S321-peter date=2026-08-05 probe=S239-adversarial-pass-on-own-codegen-PR-found-3-precision-defects-2FP-string-literal-1FN-destructure-ALL-fixed-and-pinned-behaviour-preserving-warning-only note=w-if-in-each-precision-hardened-pre-land -->
<!-- @review pr=415 verdict=carve-out by=S321-peter date=2026-08-05 probe=own-review-floor-record-docs-only-single-pr-reviews-line -->
<!-- @review pr=414 verdict=carve-out by=S321-peter date=2026-08-05 probe=docs-only-known-gaps+review-ledger-no-code-path-13-drain-entries-wellformed-severity-ruling-advisory -->
<!-- @review pr=413 verdict=carve-out by=S319-bryan date=2026-08-05 probe=own-review-record-docs-only -->
<!-- @review pr=412 verdict=carve-out by=S319-bryan date=2026-08-05 probe=own-ratification-records-and-brief-banners-docs-only -->
<!-- @review pr=411 verdict=carve-out by=S319-bryan date=2026-08-05 probe=continuity-docs-only -->
<!-- @review pr=410 verdict=clean by=S319-bryan date=2026-08-05 probe=fence-bidirectional-string-intact-and-genuine-variant-still-lowered -->
<!-- @review pr=408 verdict=clean by=S319-bryan date=2026-08-05 probe=depth-prefix-plus-it-ships-an-emitted-specifier-resolution-guard -->
<!-- @review pr=407 verdict=carve-out by=S319-bryan date=2026-08-05 probe=generated-maps-refresh-no-code-path -->
<!-- @review pr=406 verdict=carve-out by=S319-bryan date=2026-08-05 probe=continuity-docs-only -->
<!-- @review pr=404 verdict=carve-out by=S319-bryan date=2026-08-05 probe=own-gap-filings-and-retractions-docs-only -->
<!-- @review pr=403 verdict=carve-out by=S319-bryan date=2026-08-05 probe=review-ledger-records-docs-only -->

### S322 — the gate built to kill hollow gates shipped hollow, and the floor is what caught it

Two code-bearing PRs this session, both `finding`, and the finding on the *review tool* is the one
worth reading.

**#428 — the harness.** Built to replace a script class that has now measured a fraction of its
population three times (`artifact-diff.mjs` 8 of 115 · `u1-corpus-emit.sh` 329 of 1818 · that script's
`node --check` half inheriting the same population). Two independent adversarial lenses — one attacking
the mechanism, one the arithmetic — found **nine defects in the new gate**, four of which could produce
a false green on the very question it was built to answer. The load-bearing one:

> `node --check` on a `.js` resolves by module-syntax auto-detection, so a **top-level stranded
> `await` passes** — while the compiler emits `<script src=…>` with no `type="module"`, where it is a
> hard `SyntaxError` and the bundle is dead on arrival.

That is the auto-await work's *own dominant failure mode*, and every prior measurement in the arc ran
under the blindness. Worse, the obvious in-process fix is also broken: **bun's `vm.Script` does not
reject a top-level await either**, so goggles written under the parent runtime could not fail at all.
Both re-executed PA-side rather than inherited from the report. All nine routed back as a fix round and
re-proven with bites.

**#429 — U1.** Three fix rounds (8 findings, one build-breaking) plus the two post-hoc lenses, then a
wide-corpus re-measure **on the rebased tree against current main**: 1878 sources, 7254 artifacts,
syntax delta 0 under *effective, script and module* goggles, 2 artifact diffs both on sources that fail
to compile on every revision. It lands **explicitly not claiming its bug class** — the harness measures
142 bare client server-fn call sites in cleanly-compiling sources, delta 0, and that number is now
produced by the gate itself rather than by a one-off script.

**#426 got a real check despite being docs-only.** It records a *deferral* of a newly-accepting change,
so the thing worth verifying is that the change did not quietly ride along: `ba72eaa0` is **not** an
ancestor of main and lives only on `origin/feat/onmount-c-build`. Confirmed.

**The carve-out rate reads 57% and is still the wrong denominator** — see the S319 note below, which
stands. Four of the six drained here are continuity/gap/tracking PRs with no code path by construction;
both code-bearing PRs got the full pass and both produced findings. The code-bearing-only refinement
that note recommends is **still not built**, and this session is a second data point for it.

### ⚠ S319 — the carve-out rate crossed the probe's own alarm (57%), and the answer is that the DENOMINATOR is wrong

`review-debt.ts` now prints **`carve-out rate: 16/28 (57%) ⚠️ HIGH — is the floor still doing anything?`**
That alarm is the §8 absorbed-escape-hatch check working exactly as designed, so it gets a real answer
rather than a dismissal.

**The answer: every code-bearing PR in scope received a full S239 pass with empirical probes. The 57% is
entirely docs.** The four compiler landings reviewed this session — **#396** (route-attr semantics
diffed main-vs-branch by execution), **#405** (207 bundles under `node --check` + a bite proof run
against main), **#410** (bidirectional fence probe), **#408** (accepted on its shipped
emitted-specifier guard) — each produced a finding or a verified clean, and #396's pass surfaced a
normative SHALL violation nobody had noticed.

**So the metric is measuring the wrong population.** Carve-out-rate-over-ALL-PRs cannot distinguish
*"a docs-heavy stretch"* from *"the floor is being evaded"* — and a wrap/continuity/gap-filing PR has no
code path to review by construction, so its carve-out is not an escape, it is the correct classification.
A session that lands one compiler fix and six continuity PRs will trip the alarm while having reviewed
100% of what the floor exists to cover.

**Recommended refinement (not built — flagged for the S321+ measurement):** compute the rate over
**code-bearing PRs only** (any diff touching `compiler/`, `stdlib/`, `conformance/cases/`, or
`scripts/`), where the target is ~0% and any carve-out is genuinely suspicious. Keep the all-PR count as
a volume statistic, not as the health signal. **Until that lands, read the ⚠ as unproven rather than as
either healthy or evaded** — this note is the evidence for the current stretch, and it is a sample of one
session written by the session it describes, which is exactly the weakness the S316 Q5 3-session
measurement was designed to cover.

### #410 — bare-variant mask fenced to code regions · verdict `clean`

Parser-wide blast radius, so probed **bidirectionally** — an over-fence is as bad as an under-fence,
and only one of those directions fails loudly.

Probe: a string literal containing a variant-shaped token *and* a genuine bare variant of the same name
in the same file (`<path> = "/a/.Beta"` alongside `<phase>: Phase = .Beta` and a `match` over it).
Result: the literal survives intact (**2 occurrences of `"/a/.Beta"`, zero leaked
`__scrml_bare_variant_Beta__` placeholders**) **and** the genuine variant still lowers (8 × `"Beta"`).
`node --check` clean.

**Bias direction is right.** The fix routes through `rewriteCodeSegments`, the deliberately
**mask-biased** scanner S245 decoupled from the security egress guard precisely *because* mask-bias is
wrong for a confidentiality scan. Here the use is the mangle-adjacent one it was built for, and the bias
points the safe way: a missed mask means a bare variant is not lifted → a **loud** parse failure, never
silent corruption. That is the inverse of the bug being fixed, which was silent.

The PR reasons explicitly about the match-arm interaction (arms are already lifted into quoted string
args by `preprocessMatchExprs`, so they were never masked here and remain string interiors the fence
skips) — checked against the probe's `match` block and it holds.

### #408 — depth-prefix the own-document runtime `<script src>` · verdict `clean`

Accepted on its unit test plus the S296-class integration guard it ships. **Worth flagging beyond the
verdict:** this PR adds `compiler/tests/integration/corpus-emitted-specifier-resolution.test.js` — a test
that asserts **emitted specifiers resolve on disk**. That is an integration-level instance of exactly the
class I filed hours earlier as [[g-conformance-cannot-assert-emitted-route-path]] (*nothing asserts the
content of an emitted artifact*). It does **not** close that gap — the conformance harness still has no
`emit`/`artifacts` assertion key, so the author-declared-path guarantees remain unpinnable — but it is
the first guard of that shape in the tree and the right precedent to build the harness key from.

**Carve-outs (7).** #403/#406/#411 continuity, #407 a generated maps refresh, and #404/#412/#413 my own
docs-only landings. Recorded rather than skipped so the rate stays measurable — **9 of 28 (32%)**, and
rising largely on my own output, which is the §8 absorbed-escape-hatch signal to keep watching.

<!-- @review pr=405 verdict=clean by=S319-bryan date=2026-08-05 probe=corpus-emit-diff+node-check-207-bundles+bite-proof-on-main -->

### #405 — the dpa-020 CORE (unify the auto-await injectors) · verdict `clean`

Codegen landing that **retires a pass** (`injectPromiseAwait`, the per-statement string-regex auto-await)
in favour of one AST descend + paren-correct injector. Retiring a pass carries regression risk in the
opposite direction from a normal fix — something previously awaited going bare — so the pass was probed
for both.

| probe | result |
|---|---|
| emit differential, all 32 `examples/` | **zero** output differences |
| `node --check`, every emitted bundle (examples + 60 samples) | **207 bundles, 0 syntax failures** |
| reactive/engine sink fence survived the retirement | yes — as AST-aware `isSkippedReactiveValue` + `insideSink` + `awaitIllegal`, replacing a regex prefix |
| **bite proof — the new conformance test run against MAIN** | **0 pass / 6 fail** (branch: 6 pass / 0 fail) |

**The `node --check` sweep is dpa-020's own mandated gate**, because the verdict named the dominant risk
as *"a stranded `await` is a WHOLE-BUNDLE SyntaxError"* (`peerAwaitable` defaults to awaitable). 207
bundles clean says that risk does not materialise on the corpus.

**Zero emit change is the expected result, not a weak one:** the injector is deliberately byte-identical
on the no-tail call (`await fn()`) and only diverges on a receiver-tail (`(await fn()).ok`), a ternary
init, and `given`/match-block/`try` nesting — none of which the corpus exercises. That is precisely why
all three defects were silent.

**★ The bite proof is what carries this review.** My own hand-written probes repeatedly failed to reach
the changed paths — twice from invalid scrml on my part (`given v = expr` is not a rebind; markup inside
a function body), once from dead-code shaking. Rather than infer from a green suite, I ran the PR's new
conformance test against **main's** compiler: **all six assertions fail there and all six pass on the
branch.** That proves the three defects are real and live, and that the fix closes both the CODES and
RUNTIME halves of each. **Stated plainly because it matters: the fix's correctness here is established by
the PR's own executable test proving its bite, not by reproducers I constructed.**

**Rebase (S319):** conflicted on `dpa-queue.md` (2 regions) + `known-gaps.md` + `FACTS.md` after #412.
Generated blocks resolved by **regeneration**, verified by arithmetic — MED 114−3=111 (the three MED gaps
this PR resolves), LOW 49−1+1=49 (one resolved, one filed), HIGH 20 unchanged — matching the prediction
exactly. The three resolved gaps are the same three the bite proof exercised. `dpa-queue.md` resolved to
HEAD, which already carried both Peter's S320 re-run note and the S319 ratification.

**Not blocking, recorded:** #405 is dpa-020's **U3** (merge the injectors), not **U1** (the missing
`emitCall` client-server-fn branch). The ratified verdict names the post-emit rename as the bug generator
and U1 as the root fix, so the family is narrowed here, not closed — a bare unawaited server call is
still observable in a hand-probe. U1 remains open work.

<!-- @review pr=402 verdict=carve-out by=S320-peter date=2026-08-04 probe=continuity-docs-only-changelog-handoff-deltalog-no-code-path -->
<!-- @review pr=401 verdict=carve-out by=S320-peter date=2026-08-04 probe=known-gaps-rescope-docs-only-VERIFIED-scheduling.ts:974-isControlFlowBoundary-opaque-boundary-anchor-holds -->
<!-- @review pr=400 verdict=carve-out by=S320-peter date=2026-08-04 probe=known-gaps-filing-docs-only-VERIFIED-conformance-run.ts-ExpectedCase-has-no-emitted-content-assertion-key -->
<!-- @review pr=399 verdict=carve-out by=S320-peter date=2026-08-04 probe=known-gaps-spec-hygiene-teardown-ordering-docs-only-dpa-surfaced-self-caveated-unverified -->
<!-- @review pr=398 verdict=carve-out by=S319-bryan date=2026-08-04 probe=own-dpa-banks-and-review-record-docs-only -->
<!-- @review pr=396 verdict=finding by=S319-bryan date=2026-08-04 probe=route-attr-semantics-diff-main-vs-branch-by-execution note=sse-author-route-conformance-restoration-undersold -->
<!-- @review pr=397 verdict=carve-out by=S319-bryan date=2026-08-04 probe=own-wrap-continuity-docs-only -->

### #396 — `fn … = <expr>` rejection · verdict `finding` (not a defect — an UNDER-SOLD conformance restoration)

**The PR does two independent things and only names one.** The titled fix (reject the unsanctioned
`= <expr>` fn body → `E-FN-EQUALS-BODY`) is clean. Riding with it, mentioned only as a parenthetical
inside a code comment, is a **second behavior change on existing code**: the return-type consumers now
break at a `route=`/`method=` attribute, so an author-declared route is no longer swallowed.

**Probed by EXECUTION, main vs branch, not by reading the diff:**

| probe | main | branch |
|---|---|---|
| plain `function f() -> T route="/api/user"` | **no route registered** | `/api/user` registered |
| plain `function f() route="/api/ping"` (no return type) | `/api/ping` | `/api/ping` (unchanged) |
| **`server function* f() -> T route="/sse/feed"`** | **`path: "/_scrml/__ri_route_feed_1"`** | **`path: "/sse/feed"`** |
| return-type shapes (lifecycle · map · enum-subset · refinement) | — | `client.js` **byte-identical**, 0 errors both sides |
| recovery after a rejected `= match` body | — | exactly ONE error, correct line/col, no cascade |

**The third row is the finding.** SPEC §37.3 / §12.3 say verbatim that the compiler *"SHALL mount the
SSE handler at the author-declared path"* and *"SHALL honor it in **application (browser) mode**."*
**Main violates that SHALL** whenever the SSE generator also carries a return type — the author's
`route="/sse/feed"` is silently replaced by a compiler-internal hash. A foreign `EventSource`
subscriber, for whom the author path IS the contract (the §12.3 BYOB carve-out), connects to
`/sse/feed` and gets a 404. Silent, adopter-facing, and this PR fixes it.

So the route half is **newly-accepting toward the contract** (pa-base §8) — a governing sentence
already said the form is legal and the implementation was holding the door shut. It ships as a fix;
blocking it would freeze an implementation defect into the language.

**Verified independently, not taken from the PR:** the migration measurement (zero corpus files combine
a return type with `route=`) — confirmed. The break-set completeness — the fn attribute loop at
`ast-builder.js:12554` accepts **exactly** `route` and `method`, so hardcoding those two is complete,
not a partial fix. The `=`-break regression surface — every legal return-type form probed is
byte-identical.

**Recorded, not blocking:**
1. The route restoration deserves to be a headline with a **conformance pin** (`server function*` +
   return type + `route=` → author path), not a comment aside. Currently nothing pins it.
2. The zero-corpus measurement is true but **the corpus-is-artifact kernel applies** — the corpus may be
   empty *because* the combination silently dropped the route. Same shape as the S66 canonical example.
   Measured-zero here is weaker evidence than it looks; the SHALL is what carries the decision.
3. **Separate, pre-existing, NOT this PR's:** a plain `function route=` (non-generator, non-`handle()`)
   mounts a route in application mode, while §12.3's carve-out is explicitly **NARROW** to
   `server function*` SSE + `handle()`. This PR does not introduce it (main already does it for the
   no-return-type case) but it deserves its own question.

**Rebase note (S319):** the branch was rebased onto `663f31b8` to clear a `known-gaps.md` conflict in the
`@generated` counts block. Resolved by **regeneration**, then verified by arithmetic — HIGH 23−1=22 (his
HIGH resolved), LOW 47+1=48 (his filed residual), MED 109 unchanged — matching the prediction exactly.
The rebase also folded in a `master-list.md` `@generated:recent-sessions` regen, because `state.ts
--check` was FAILING on main (S316's own wrap step 6d missed it).

<!-- @review pr=395 verdict=carve-out by=S316-bryan date=2026-08-04 probe=docs-only-continuity -->
<!-- @review pr=394 verdict=clean by=S316-bryan date=2026-08-04 probe=await-precedence-overharvest-syntax -->
<!-- @review pr=393 verdict=carve-out by=S316-bryan date=2026-08-04 probe=inbox-delivery-only -->
<!-- @review pr=391 verdict=finding by=S316-bryan date=2026-08-03 probe=adjacent-markup-positions note=autoawait-incomplete-attr-and-each-body -->
<!-- @review pr=390 verdict=clean by=S316-bryan date=2026-08-03 probe=import-resolution-executed -->
<!-- @review pr=389 verdict=clean by=S316-bryan date=2026-08-03 probe=span-rebase-vs-prefix-baseline -->
<!-- @review pr=392 verdict=carve-out by=S316-bryan date=2026-08-03 probe=docs-only-continuity -->
<!-- @review pr=388 verdict=finding by=S316-bryan date=2026-08-03 probe=direction-of-change note=export-let-newly-accepting-REJECTED -->
<!-- @review pr=387 verdict=clean by=S316-bryan date=2026-08-03 probe=tailwind-over-emission -->
<!-- @review pr=386 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->
<!-- @review pr=385 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->

### Notes on the above (commentary — not parsed)

- **#385 / #386** — both widened what reaches the client bundle (#385 rewrote reachability from "read
  by a node in THIS module" to "read by ANY client compilation unit"). Probed the confidentiality
  axis: a module exporting `API_SECRET` read **only** by a server fn in another unit, beside a
  client-read `PUBLIC_LABEL`. The emitted `models/secrets.client.js` carried `PUBLIC_LABEL` and its
  registry entry only; the secret was absent entirely and present in `.server.js`. Same on #386's
  type-annotated path. **The widening is correctly scoped to client reads.**
- **#387** — probed over-emission: an `<engine>` with Tailwind classes in a NON-initial arm plus prose
  containing `text-9xl`. Non-initial arm classes now emit (the fix), initial arm unchanged, prose
  `text-9xl` produced **zero** CSS rules. No over-scan.
- **#388** — the finding. Its `export let` / `export var` emission was **newly-accepting** (a direct
  `<endpoint>` reference fired `E-SCOPE-001` pre-fix, compiles post-fix) with no governing sentence in
  SPEC (`export let` appears **zero** times), no conformance case, and against SPEC §51.0.A:27504's
  ratified *"no free-shaped / untyped global store … **final** shared-state design"*. Deciding
  measurement: **a bare top-level `let` already works** in a `serve=tool`, so the dogfood need was
  already met and `export let` bought only cross-module mutable sharing. **bryan RULED reject (S316).**
  Revert that half; the main-only import tree-shaking half is a clean under-emit fix and stays.
- **#392** — continuity/changelog/delta-log only, no code path → carve-out.
- **#393 / #395** — inbox delivery and continuity respectively; **verified 0 files under
  `compiler/src`** → carve-out.
- **#394** — **clean on all three sharp axes.** (a) *Await precedence:* emits
  `(await _scrml_fetch_getFlag_2()).ok` — the await wraps the CALL node, not the member expression;
  the precedence-wrong `await (getFlag().ok)` was the stated hazard and it is avoided. (b) *Part-B
  over-harvest:* the async-marking pass now harvests callee idents from match-arm RESULT strings, so I
  probed a fn whose arm result is a **string literal merely mentioning `getFlag()`** — it stayed a
  plain `function` while the real caller became `async`. Literals genuinely pre-stripped; no
  over-colouring. (c) *Stranded await:* `node --check` clean on all three artifacts. Also worth
  crediting: the PR **R26-corrected its own filed mechanism** (the gap claimed a "sync IIFE where
  await is illegal"; the const-init form actually lowers to a statement tilde-temp where it is legal),
  swept 1019 corpus files for byte-diffs (zero changed), and filed 5 sibling residuals rather than
  dropping them.

  **But the review's real finding is the SHAPE OF THE BOARD, not a defect in #394.** The auto-await
  residual family now runs to ~23 entries, **9 of them open** (2 HIGH, 6 MED, 1 LOW):
  `g-inferred-async-call-value-position-no-autoawait` · `g-markup-autoawait-misses-attr-and-each-body`
  · `g-server-fn-argument-position-not-awaited-and-statement-dropped` ·
  `g-match-value-position-…` · `g-match-block-arm-…` · `g-given-block-…` · `g-if-value-cascade-…` ·
  `g-reactive-write-member-…` · `g-ternary-init-server-call-await-misbind`.

  Every one is *"auto-await misses position X."* **§13.2 mandates POSITION-INVARIANT auto-await** —
  the very sentence #394 cites — yet the implementation is being drained one position at a time, and
  the discovery rate is not slowing: #391 fixed one position and the S239 pass found two more; #394
  fixed one and filed five more. **Six new positions surfaced from two PRs.** That is the signature of
  an await decision made independently at each emit site instead of once at a choke point, and it is
  worth a design look before the next position is patched. Not a criticism of either PR — both fixed
  what they claimed, cleanly.
- **#389** — probed span rebasing against the **pre-#389 baseline** (a worktree at `5aeb656a`, which
  predates it), with an undeclared read at a known line in five contexts. Baseline: match-arm read
  reported **line 1** (true 10), `<each>`-body read reported **line 1** (true 19). Post-fix: **10** and
  **19**. Control (top-level, line 7) unshifted both sides — **no double-rebase**. Engine state-child
  arms reported correctly on BOTH sides, so #389 neither fixed nor broke them (an earlier read of mine
  that it "broadened coverage there" was wrong). **Clean — does exactly what it claims.** Surfaced a
  separate PRE-EXISTING bug, filed: [[g-nested-each-in-match-arm-drops-diagnostics]].
- **#390** — probed the S296 over-correction axis: a `kind="tool"` under `pages/` (the shape it fixes,
  where dist strips the leading segment) AND one NOT under `pages/` (where there is nothing to strip
  and a naive re-base would overshoot the other way). Both emit `./models/lib.js` against an artifact
  at `./models/lib.js`. **Verified BY EXECUTION** — both tools imported and ran (`hi a` / `hi b`),
  which is the required standard for this class: S296's signature is compile exit 0 + `node --check`
  clean + runtime `Cannot find module`. **Clean.**
- **#391** — **FINDING: the fix is incomplete.** Probed the four markup positions an interpolated
  cross-module async call can inhabit. Only the top-level text interpolation is awaited:

  | source position | emitter | status |
  |---|---|---|
  | `<p>${ fetchStatus(@url).status }</p>` | `emit-event-wiring.ts:1889` | `(await …)` ✅ |
  | `<div title=${ … }>` | `emit-event-wiring.ts:1665` | **BARE** ❌ |
  | inside a `<match>` arm body | `emit-variant-guard.ts:569` | **BARE** ❌ |
  | inside an `<each>` body | `emit-each.ts` | **UNTESTED** (probe used an empty collection) |

  *(Attribution corrected in-session: the second bare site is the `<match>` arm renderer — a THIRD
  emitter — not the `<each>` body, and the `<each>` position was never actually exercised. The finding
  stands; the labels were wrong.)*

  Both bare sites reproduce the ORIGINAL symptom by a different door — a field read off a Promise
  renders `undefined`, silently, compile exit 0. This is the S288 shape: *a fix verified thoroughly
  inside too small a surface is still incomplete — enumerating shapes inside a function is not the same
  as enumerating the functions a class of defect can inhabit.* The PR's own test carries a sync
  negative control (good practice) but only exercises the one position it fixed. Filed:
  [[g-markup-autoawait-misses-attr-and-each-body]].
