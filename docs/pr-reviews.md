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
