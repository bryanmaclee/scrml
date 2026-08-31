# Decisions waiting on bryan — VERIFIED enumeration
_Swept 2026-08-30 against `origin/main` @ `d02adb68` (working checkout one commit ahead on `chore/s390-floor-drain` @ `9fc4088f`). Read-only; no git state touched._

## COUNTS

| | n |
|---|---|
| **candidates examined** (de-duplicated union of 7 channels) | **~152** |
| **LIVE — genuinely waiting on bryan** | **66** |
| — of which fully written up below | 24 |
| — of which enumerated in the MED/LOW/D tail (relayed verification) | 42 |
| **ALREADY RULED — rejected as false positives** | **59** |
| **COULD NOT DETERMINE** | **7 classes** (see that section) |

**Of the 59 rejections, 22 were ruled at S385 itself** and 37 in earlier sessions while the gap
entry, the dpa status cell or the deep-dive frontmatter kept reading "RULING OWED" / "awaiting bryan".
That ratio is the finding: **the ledger's own status vocabulary accumulates and never clears**, which is
exactly what S385's own D10 row asks about.

## ⚑ TWO THINGS THE PARENT SHOULD ACT ON BEFORE ANYTHING ELSE

1. **The complete 84-item S385 decision queue SURVIVES** at
   `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/decision-queue.md`
   (532 lines, every fork's limbs stated turnkey). **No landed file contains it.** It is in another
   session's scratchpad and will be reaped.
2. **A10's hold condition IS MET and nobody noticed.** The host-fallback census S385 fired *ran and
   completed* — `.../341444f8-.../scratchpad/host-fallbacks.md`, 621 lines, all four adopters
   classified and cross-referenced against `known-gaps.md`. Headline: **5 host-fallbacks across 4
   adopters; 4 of 5 have no gap that counts them.** A10 has been held ~119 sessions on a number that
   now exists. Also from the census: **A10's own defect was fixed at `72ba19d6` (PR #111) and giti
   migrated the module 2026-07-20** — the entry is a stale-open HIGH.

## RANKED — highest (blocks-real-work x age) first

| # | handle | why it ranks here |
|---|---|---|
| 1 | `a10-giti-returned-closure` | ~119 sessions; **gate now met**; the language-identity question the architecture complaint was reaching for |
| 2 | `fail-variant-shorthand-rejected-by-ts-context` (C12) | **two flagship samples have failed to compile since S236** and no gate caught it; ~3-line fix once ruled |
| 3 | `at-sigil-on-non-reactive-local` (C9) | a fix was BUILT and REVERTED at S239 (~146 sessions); no code can be written until the normative line is drawn |
| 4 | `b6-flogence-async-thunk-boundary` | HIGH, ~109 sessions, **and it was never surfaced** — it fell out of the S385 batch |
| 5 | `if-attr-per-field-synth-cell` (C14) | a dead page on `main` today; a test PINS the broken value so it flips loudly the day it is ruled |
| 6 | `c10-engine-initial-state-hydration` | flagship 05 stuck on step 1, compiles clean, no gate can see it |
| 7 | `derived-engine-projection-ignored` (C11) | flagship 14's risk banner never renders |
| 8 | `checked-expr-attr-always-checked-for-falsy` (C13) | flagship 18; two binding surfaces on one element disagree about truthiness |
| 9 | `if-attr-subscript-silently-dropped` (C1) | HIGH, ~40 sessions, silent-wrong at exit 0, generic to ALL unquoted attribute values |
| 10 | `c15-server-call-nested-in-expression` | HIGH; routed as **the STAGE retrofit-vs-by-construction test**; same axis as dpa-023 and `reactive-write-member` — rule the three together or get three answers |
| 11 | `c2-expr-positions-field-gate` | HIGH; live cross-file `ReferenceError`s at exit 0; it is the gate the security lane stands on |
| 12 | `bindvalue-each-select-under-if` | brand new (S389, PR #774) but an adopter's Edit form is blank **today** |
| 13 | `b1-issue-509-pwa-direction` | half-answered — bryan asked for option (b) to be expounded and the session wrapped; 13+ days of adopter silence on a promise he made |
| 14 | `c16-e-route-001-local-bind` | HIGH; a gate whose escape hatch is its own recommended fix. **Couple it with `e-route-001-severity`** — same code |
| 15 | `reactive-write-member-server-call-no-autoawait` | MED severity, architectural fork; see #10 |
| 16-24 | `e-route-001-severity` · `match-block-empty-arm` · `match-else-arm-object-literal` · `session-get-own-key-read-policy` · `session-context-scan-bare-form` · `s34-dead-section-xrefs` · `nav-maps-staleness-gate` · `emitobjectkey-proto` · `b10-delta-log-shape-as-a-published-contract` | MED/LOW; several are 60-91 sessions old but block nothing shipping |

Then the **C17-C34 (20 MED) · C35-C48 (~18 LOW) · D1-D10 (10 housekeeping)** tail, reproduced verbatim
below because the only copy is in a scratchpad.

---
## NOTE ON THE 84-ITEM S385 ENUMERATION — RECOVERED

**No landed artifact contains the A1-A10 / B1-B10 / C1-C48 / D1-D10 letter map.** I grepped
`docs/known-gaps.md`, `docs/changelog.md`, `hand-off.md`, `handOffs/*`, `docs/changes/*/` and all of
`scrml-support/` for `C17`, `C48`, `C35`, `84 enumerated`, `decision queue`. The only surviving
in-repo reference is `hand-off.md:45` (*"C17-C34 (MED) and C35-C48 (LOW) are untouched"*), plus the
S385 user-voice block, which names only the items actually ruled.

**It was recoverable from the session transcript.** `~/.claude/projects/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6.jsonl`
is the S385 session; a Bash call in it names the file the sweep agent wrote, and that file still exists:

    /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/decision-queue.md   (532 lines)
    /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/host-fallbacks.md   (621 lines)

So the enumeration below is the real S385 queue, not a reconstruction. **Two things it makes visible
that the hand-off does not:**

- **B6 was never surfaced.** bryan's ask was *"on the six prior Qs. all your recs except B1"*; the
  ledger's RATIFIED block covers B2/B3/B4/B5/B7 (five) plus B1 excepted (six). **B6 appears in
  neither**, and it is a HIGH deferred since S279.
- **`hand-off.md:45` overstates the C group.** It says *"The C-group HIGHs are surfaced and ruled."*
  Only **C3-C8** were. **C1, C2, C9, C10, C11, C12, C13, C14, C15, C16 — ten HIGH design forks — were
  enumerated and never put in front of him**, and four of them break a shipped flagship sample.

I still rebuilt the LIVE list from the underlying sources independently, and mapped the letters back
where they agree. My independent sweep and theirs converge; where they differ (three gaps I found that
their sweep missed) it is noted per item.

# LIVE — waiting on bryan

## bindvalue-each-select-under-if — should the `if=`-mount wire order be swapped globally, or should just `<select>` re-apply its bound value after its options render?
- **severity/scale:** HIGH · narrow fix with language-wide blast radius (every `if=`-mounted subtree)
- **where it lives:** `handOffs/incoming/S389-peter-routes-bindvalue-each-select-under-if.md` (on branch `route/s389-bindvalue-each-select-under-if`, **PR #774, unmerged**); gap `g-bindvalue-each-select-under-if-drops-initial-value` added at `docs/known-gaps.md:53`
- **the fork:** (a) **Fork A** — in `_scrml_mount_wire` (`compiler/src/runtime-template.js:1667-1668`) run `_scrml_remount_each(n)` (and `_scrml_remount_dispatch(n)`) BEFORE `rewire(...)`, mirroring the correct top-level init order. Smallest diff, restores the invariant "a select's bound value is applied after its options render"; blast radius = every `if=`-mounted subtree, owes an S239 adversarial pass. (b) **Fork B** — make the emitted `<select>` value-effect re-trigger off its option-populating each render (`emit-bindings.ts:~656/~666` + runtime). No global mount-order change, but only fixes `<select>` and leaves every other "value applied before children exist" case open. PA lean: A (FORK-RULE row 4, root vs position).
- **what it blocks:** the `assetManagement` adopter's Fleet Add/Edit form — every Type/Status/Make-Model/Fuel/Tracker select renders blank on Edit today, silent at exit 0. Fixing it also lets aM drop its imperative `paintFleetSelects()` workaround (`app.scrml:1873`).
- **age:** filed 2026-08-30 (S389-peter) — brand new, ~0 sessions
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `bindvalue|bind:value|select` — newest session in that ledger is S385 (2026-08-29/30) and this was filed 2026-08-30 by peter, after it; no `docs/changes/*/RULING.md` mentions it; PR #774 is still OPEN and unmerged into `origin/main`.

## at-sigil-on-non-reactive-local — which bindings is `@name` permitted to resolve against?
- **severity/scale:** HIGH · **language-wide / normative §6.1.2 ruling** (a fix is impossible without it)
- **where it lives:** `docs/known-gaps.md:72` (heading) / `:73` (marker, `status=ruling-gated`); full brief + 2 forks at `../scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md` (S381 addendum)
- **the fork:** `@name` on a function PARAMETER or a local `const`/`let` reads `undefined` silently (`${@nm}` → `"hi undefined"`), and `@alias.field` inside an `<each>` CRASHES with an opaque TypeError. §6.1.2 says a bare name is a LOCAL identifier and `@name` is canonical STATE access, so `@` on a non-reactive binding is a category error the compiler accepts today. **A narrowed fix was BUILT and REVERTED at S239** — it false-fired on the §6.7 canvas-ref pattern and violated §6.1.2's own loop-locals rule. The crux: a function param, a local `const`/`let`, and an `<each>` loop alias are ALL `kind:"variable"` in the symbol table — **there is no discriminator**. So the decision is normative first: (a) `@` resolves only against declared state cells → params/locals/loop-aliases all become errors (newly-rejecting, owes a corpus migration, and must carve out §6.7 refs and the §6.1.2 loop-local rule); (b) `@` is permitted on loop aliases (and refs) but not on params/locals → needs a new symbol-table discriminator built before any check can fire; (c) leave it accepting and diagnose nothing.
- **what it blocks:** the fix itself — no code can be written until the normative line is drawn. Adopter-visible silent-undefined + an opaque crash today.
- **age:** found S381-peter, filed S385 (2026-08-30). The S239 revert means the underlying question has been open since **S239** (~146 sessions).
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` (16,511 lines, all sessions) for `at-sigil`, `@name on a`, `non-reactive local`, `@ on a non-reactive` — **zero hits**. Not in any `docs/changes/*/RULING.md`. Marker still `status=ruling-gated`.

## derived-engine-projection-ignored — parse the projection form and retire the identity substrate, or keep identity and refuse the projection body loudly?
- **severity/scale:** HIGH · narrow-to-medium (one feature's substrate reconciliation, §51.0.J vs §51.9)
- **where it lives:** `docs/known-gaps.md:75` / `:76` (marker `status=ruling-gated`), locus `compiler/src/codegen/emit-engine.ts:3310-3324`
- **the fork:** `<engine for=T derived=@src>` with body projection arms emits TWO substrates and consults the wrong one — §51.0.J (an IDENTITY projection, the live read path via `_scrml_cs_reactive_get`) and §51.9 (the correct mapping, `_scrml_derived_fns`, **never consulted**). So `@derived` mirrors the raw source instead of the projection the author wrote. The §51.0.J identity is DELIBERATE — the rich `derived=match @x { … }` form is **not yet parsed** — so this is a half-implemented feature, not a regression. (a) parse the projection form and retire the identity substrate; (b) keep identity and **refuse the projection body loudly** with a diagnostic.
- **what it blocks:** flagship 14's risk banner never renders (adopter-visible dead UI).
- **age:** found S381-peter, filed S385 (2026-08-30). ~5 sessions as a filed item.
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `derived-engine-projection`, `51.0.J`, `derived engine projection`. The only rulings found are S190 (`"Full feature build now"` for the §51.0.J derived-engine **EXPRESSION** form, ledger line 10086) and S172 line 5726 — **neither touches the `derived=match … { }` projection-body form or the two-substrate reconciliation**. No `RULING.md` hit. Marker still `ruling-gated`.

## checked-expr-attr-always-checked-for-falsy — is one-way boolean-attribute binding a supported form at all?
- **severity/scale:** HIGH · language-wide (it decides whether this is a codegen bug or a missing diagnostic)
- **where it lives:** `docs/known-gaps.md:78` / `:79` (marker `status=ruling-gated`), locus `compiler/src/codegen/emit-html.ts` + `emit-each.ts` lifted-`for` setAttribute path
- **the fork:** a one-way `checked=<expr>` renders CHECKED for any falsy value — the compiler emits the raw source text as a literal string attribute (`checked="f0"`) with no reactive wiring, and the lifted-`for` path calls `setAttribute("checked", …)` unconditionally, never `removeAttribute`, so the box can never un-check. The tell: `class:done` on the SAME element correctly treats `0` as falsy — two binding surfaces on one element disagree about truthiness. (a) one-way boolean-attr binding IS supported → this is a codegen bug, wire it reactively and add `removeAttribute`; (b) `bind:checked` is the ONLY sanctioned form → this is a **missing diagnostic**, and the fix is to refuse `checked=<expr>`.
- **what it blocks:** flagship 18 (adopter-visible wrong render).
- **age:** found S381-peter, filed S385 (2026-08-30).
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `checked=`, `one-way boolean`, `bind:checked` — the only hit is line 4972 (an L17 dispatch-table statement about `bind:checked` render-spec dispatch), which does **not** rule on the one-way `checked=<expr>` form. No `RULING.md` hit. Marker still `ruling-gated`.

## fail-variant-shorthand-rejected-by-ts-context — reconcile §14.10 bare-variant inference with §19's `fail` grammar
- **severity/scale:** HIGH · **SPEC-internal grammar reconciliation** (language-wide)
- **where it lives:** `docs/known-gaps.md:81` / `:82` (marker `status=ruling-gated`), fire-site `compiler/src/type-system.ts` (`E-ERROR-009`), SPEC §19 + §14.10
- **the fork:** `fail .Variant` (the bare-variant shorthand) is rejected by `E-ERROR-009` at the TS stage while the qualified `fail E.Variant` compiles. ⚠ **The reject fires ONLY when the declared error enum RESOLVES** — a canonical `type ContactError:enum = { … }` produces `E-ERROR-009`; a non-canonical `enum ContactError { … }` does not, so the diagnostic is gated on a condition orthogonal to the shape it names. Bare-variant inference IS §14.10-sanctioned elsewhere (`<x>: Phase = .Idle`), which is why the shorthand reads as legal to an author. (a) admit `fail .Variant` — §14.10 inference extends to the `fail` position, delete/narrow `E-ERROR-009`; (b) keep the refusal but make it unconditional and honest (fire regardless of enum resolvability) and state in §19 that `fail` requires a qualified variant.
- **what it blocks:** flagship `09-error-handling` **fails to compile** — 4× `E-ERROR-009` (`validate` ×3, `submit` ×1) — and `login.scrml` likewise. Two flagship samples are red.
- **age:** found S381-peter, VERIFIED S382-peter, filed S385 (2026-08-30).
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `fail .Variant`, `E-ERROR-009`, `bare-variant shorthand`. Line 11235 is the ruling that **MINTED** `E-ERROR-009` (S26x: *"FIX + mint a dedicated code"*) — it created the code, it did not rule on whether the bare-variant `fail` shorthand is legal. Line 5094 is a SPEC/example quote using `fail .Variant(args)`, which is itself evidence the corpus expects the shorthand. No `RULING.md` hit. Marker still `ruling-gated`.

## if-attr-per-field-synth-cell — what does truthiness over a §55 rollup MAP mean?
- **severity/scale:** HIGH · language-wide (it decides a §6.11-vs-§55 normative conflict, and one shape is a dead page until it lands)
- **where it lives:** `docs/known-gaps.md:2638` heading / `:2639` marker (`status=ruling-gated`), locus `emit-event-wiring.ts::computeDisplayToggleCondition` dotPath branch
- **the fork:** §6.11's normative table says `@x.touched` is `boolean` and `@x.errors` is `string[]`; the implementation gives a compound parent ROLLUP MAPS (`derived_declare("signup.errors", () => ({name: get("signup.name.errors")}))`), and **PRIMER §13.7 B11 records the object-map shape as INTENTIONAL** per §55, calling §6.11 *"a non-blocking spec-prose drift."* So the cell is not wrong — **truthiness over a rollup map is simply MEANINGLESS**. Four options, recorded verbatim in the entry and deliberately not implemented: **{always-true, never-true, diagnose, `?.`-on-the-declined-path-only}**. The `?.` option was added late and is materially different from the banned collapse-path `?.`: on the DECLINED path the status quo is already a crash, so the trade is dead-page vs contained-false-gate.
- **what it blocks:** `if=@field.errors` on a **markup-typed** field is **still a dead page on main** (a TypeError inside `_scrml_boot` kills EVERY `${…}` interpolation on the page, exit 0, zero diagnostics). A test currently PINS `ctl === ""` so it flips loudly the day the ruling lands. Also pinned: `if=(@signup.touched)` and `if=@signup.touched` — the same predicate — now take opposite lowerings, and the "one predicate, one lowering" invariant is FALSE for the rollup rows until this is decided.
- **age:** open since **S372** (~13 sessions); survived three adversarial rounds, each of which caught a regression in the prior cut
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `rollup`, `truthiness`, `always-true`, `synth-cell`, `6.11` — hits are S114 (a *version* rollup, unrelated), S142 (v0.6.11 version string), L13 (an `<errors of=>` markup statement) — **none rule on rollup-map truthiness**. Marker still `ruling-gated`. Not in any `RULING.md`.

## e-route-001-severity — reconcile §12.4's SHALL-be-an-error against the §34 catalog row and the impl, both of which say warning
- **severity/scale:** MED · narrow but freeze-gate-integrity (a §34 catalog contradicting its own normative section)
- **where it lives:** `docs/known-gaps.md:8275` (`G-E-ROUTE-001-SEVERITY-CONTRADICTS-12-4-AND-ONE-LIMB-NEVER-FIRES`, no `@gap` marker — heading-only, so invisible to `state.ts` and every board count); explicit `**RULING OWED (bryan):**` at `:8303`
- **the fork:** §12.4 (`SPEC.md:7179`): *"A function that the compiler cannot fully analyze for route placement **SHALL be a compile error** (E-ROUTE-001)."* The §34 catalog row (`SPEC.md:18885`) classifies it **Warning** and `route-inference.ts:1584` emits `severity: "warning"`. One of the two is wrong. (a) promote the code to **Error** — migration is **MEASURED: 5 of 1,020 corpus files, 10 fires**, all in `gauntlet-teams/` + `self-host-gauntlet/`, **zero in `examples/` (0 of 71)**; (b) amend §12.4 down to Warning to match the catalog and the impl.
- **what it blocks:** nothing is shipping-broken; it blocks §34 freeze-gate integrity. The entry also records a second defect in the same code — one limb has no fire site at all.
- **age:** filed **S302** (~86 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `E-ROUTE` (5 hits: S1xx struct-field ruling, an E-ROUTE-003/004 build note, and two dpa-017 lines) and for `12.4` (2 hits, both §12.2/§4.12.4, neither this) — **no ruling on E-ROUTE-001's severity anywhere**. Not in any `RULING.md`.

## match-block-empty-arm — should `{ }` as a match arm produce void (per §18.5) or keep producing a truthy `{}`?
- **severity/scale:** MED · narrow, but it is a **measured migration** (11 live corpus sites), not a fix
- **where it lives:** `docs/known-gaps.md:9264` / `:9265` marker (`sev=MED status=open`), locus `emit-logic.ts:4518` (the guard) + `:4561` (the unreachable void handler)
- **the fork:** §18.5: *"If the block has no final expression … the arm produces `void`."* `{ }` parses as `kind:"object"`, so the emitter writes `_scrml_tilde_N = { };` and `match k { 1 :> { } _ :> "gray" }` at `k=1` yields `r === {}` — a **defined, truthy** value, so an adopter's absence check never fires (`{}` is not `not`, §42.1.1). The author already wrote the correct handler and fenced it off: `emit-logic.ts:4561` is unreachable behind the `:4518` guard. (a) make `{ }` yield void per §18.5 — newly-changing semantics across **11 measured corpus sites** (the count is real; the file list needs re-deriving, the measuring agent crashed before reporting it); (b) amend §18.5 to bless the object-literal reading and keep the current behaviour.
- **what it blocks:** nothing is red today; it is a silent-wrong-value class waiting to bite an absence check.
- **age:** filed **S328** (~60 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `empty arm`, `empty-arm`, `empty block arm`, `empty object literal`, `{ } parses` — **zero relevant hits**. Marker still `status=open` with `ROUTED-TO-BRYAN` in the heading. Not in any `RULING.md`.

## match-else-arm-object-literal-decl — accept two newly-accepting fixes (a one-way door), or refuse the shape?
- **severity/scale:** MED · narrow, but **newly-accepting = a one-way door**, which is why it is bryan's
- **where it lives:** `docs/known-gaps.md:10145` / `:10146` marker (`sev=MED status=open`), loci `emit-logic.ts:4897` (`emitMatchExprDecl` structuredBody path) + `type-system.ts:12230` (match-arm-block walks object keys as ident refs)
- **the fork:** the `ast-builder.js:9939` root asymmetry (`else :> {obj}` parses as a `match-arm-block` structuredBody while `1 :> {obj}` stays inline) has THREE consumers. #697 fixed the return-position codegen (the silent HIGH). The other two are LOUD and both **newly-accepting (reject → compile)**: (a) decl-position `const y = match n { … else :> {x:0} }` emits malformed `_scrml_tilde = x : 0` → `E-CODEGEN-INVALID-LOGIC`; (b) the type-checker flags an out-of-scope object KEY as `E-SCOPE-001`. The fork is fix-both (widen) vs leave-refused (and say so in SPEC).
- **what it blocks:** an author writing the same object-literal in the `else` arm that already works in a `1 :>` arm gets a compiler-defect error.
- **age:** filed **S373-peter** (~12 sessions), routed to bryan at filing
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `else arm`, `object literal arm`, `newly-accepting` — the newly-accepting hits are S331 (if-value block-tail), S345 (an `<endpoint>` arm E-SCOPE-001), S372 and S385 (the 4(b) mandate text), **none of them this item**. Marker still `status=open` with `ROUTED to bryan`. Not in any `RULING.md`.

## s34-dead-section-xrefs / E-BPP-001 — reclassify `E-BPP-001` as an implementation diagnostic instead of a §34 language code?
- **severity/scale:** MED · narrow, but it touches the §62 conformance boundary (what impl#2 must reproduce)
- **where it lives:** `docs/known-gaps.md:7849` / `:7850` marker (`sev=MED status=open`); the owed item is the paragraph at `:7857` — *"REVISED PROPOSAL (bryan's call, still owed): RECLASSIFY, do not retire."*
- **the fork:** `E-BPP-001` cites §3.5, which does not exist, and the body pre-parser has **no normative section anywhere in SPEC** — a subsystem emitting a §34-catalogued diagnostic with no normative text behind it. At **S297 bryan ruled RETIRE** (*"retire it, then wrap"*), and the PA then **WITHDREW the execution** when its own liveness check falsified the premise it had recommended on: the code **fires** at `body-pre-parser.ts:231`, so retiring it would silence a real condition. So the S297 ruling is spent and the replacement is un-ruled: (a) **RECLASSIFY** — keep the code firing, mark it an implementation diagnostic rather than a conformance-visible language code, and drop the `§3.5` cite rather than authoring a section to justify a row; (b) author a normative BPP section in SPEC; (c) retire anyway and accept the silence.
- **what it blocks:** the §34 catalog-integrity sweep cannot close. Small and reversible either way.
- **age:** the underlying finding is **S297** (~91 sessions); the revised proposal has been "still owed" since then
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `E-BPP-001` — **two hits, both S297**, and both are the retire-then-withdraw episode (ledger lines 12487 and 12495). Nothing after. Not in any `RULING.md`.

## session-get-own-key-read-policy — may `.get(k)` with a request-controlled `k` return arbitrary adopter-written session keys?
- **severity/scale:** MED · narrow (one runtime method's read policy), confidentiality-adjacent
- **where it lives:** `docs/known-gaps.md:1029` heading / `:1030` marker (`sev=MED status=open`); the narrowing is stated at `:1056`
- **the fork:** the entry as filed had three limbs; two are gone. The **prototype-chain limb is CLOSED** (`emit-server.ts:2593` now guards with `Object.hasOwn`), and the csrfToken limb was already refuted. **What remains, verbatim: *"the ruling you owe is NARROWER than the entry states. It is now the own-key read policy only — should `.get(k)` with a request-controlled `k` be allowed to return arbitrary adopter-written session keys."*** (a) allow it (status quo — the adopter owns their own session namespace); (b) restrict reads to a declared key set / refuse request-controlled keys.
- **what it blocks:** nothing is shipping-broken; severity was deliberately re-scored and **stays MED** on the unchanged attacker model (S326-bryan discharged the reachability banner).
- **age:** the narrowed question dates from the S326 re-score (~59 sessions); the original filing is older
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `session` cross `get|key|read|disclos` — hits are GH #282 (session write/read across compilation units, a different defect) and S385's B5 note about `#727` (session store keyed per compilation unit) — **neither is the own-key read policy**. Not in any `RULING.md`.

## if-attr-subscript-silently-dropped — support a computed subscript in an unquoted attribute value, or reject it?
- **severity/scale:** HIGH · **language-wide (a §5.2 grammar amendment)**
- **where it lives:** `docs/known-gaps.md:234` heading / `:235` marker (`sev=HIGH status=open`, `route=bryan`), locus `compiler/src/tokenizer.ts:922-928` (+ `:1155`); turnkey both-directions writeup in the bryan-lane queue S360 addenda
- **the fork:** `if=@arr[0]` emits `if (_scrml_cs_reactive_get("MARKC"))` — the `[0]` is silently dropped and the guard tests the wrong value at exit 0. Generic to ALL unquoted attribute values (`show=@MARKC[0]` drops too); `if=(@MARKC[0])` with parens works, and `if=@MARKC.length` works, so codegen fully supports subscripts — the loss is in the tokenizer's unquoted-value ident scanner (`valueIdentRe = /[A-Za-z0-9_\-\.@]/` admits `.` but not `[`/`]`). **SPEC §5.2 (`SPEC.md:1372`) enumerates the admitted unquoted forms as EXACTLY identifier-ref / call / prefix-`!`** — a computed subscript is not enumerated, and `E-ATTR-UNQUOTED-OPERATOR` is operator-specific, so nothing rejects it. (a) **ACCEPT** — extend the scan at `tokenizer.ts:925` mirroring the `ATTR_EXPR` bracket-depth track at `:1000-1003`, and amend §5.2 to admit a subscript; (b) **REJECT** — new diagnostic mirroring `E-ATTR-UNQUOTED-OPERATOR` at `:1125-1153`, §5.2 stands as written.
- **what it blocks:** wrong runtime show/hide whenever a cell and its first element disagree on truthiness — no compile-time or load-time signal. A variable index `[@IDX]` additionally injects a phantom boolean attribute and drops a reactive dep.
- **age:** filed **S345-bryan**, verified/broadened **S360-peter** (~40 sessions since filing)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `subscript`, `@arr[0]`, `5.2 fork`, `unquoted attr`. The one near-hit (ledger line 9656, S180ish) is the **value-cycles** ruling about `@arr[0] = @arr` — a different question entirely (COW + seen-guard). No `RULING.md` hit. Marker still `status=open`, `route=bryan`.

## reactive-write-member-server-call-no-autoawait — enumerate the emit-client string matchers, or route reactive-sink member-tail awaits through the AST machinery?
- **severity/scale:** MED severity, but the fork is **architectural** — it is the contested auto-await axis
- **where it lives:** `docs/known-gaps.md:3386` / `:3387` marker (`sev=MED status=open`, `prov=route:bryan-auto-await-axis-S363`)
- **the fork:** `@cell = serverFn().field` at top-level `${…}` emits a BARE unawaited `_scrml_cs_reactive_set("cell", _scrml_fetch_serverFn_N().field)` → `.field` on a Promise is `undefined` → the cell silently gets `undefined` and reviews as correct. **Context-specific**: the same write inside a `function` body IS correctly awaited (`(await _scrml_fetch_getUser_N()).name`), because the fn-body entry `injectFnBodyServerCallAwaits` runs; **INVARIANT 2 deliberately SKIPS a server call inside a reactive/derived/engine runtime**. (a) **enumerate** — extend the per-context `emit-client` string matchers to the `_cs_` form + tail-capture; each context gets its own regression-laden seam, and this deepens the retrofit that STAGE already flags as the under-design symptom; (b) **PA-RECOMMENDED** — route the reactive-SINK member-tail awaits through the AST `collectAwaitSites`/`applyAwaitSites` machinery uniformly (it already paren-wraps a member tail as `(await x).y` and models scopes exactly).
- **what it blocks:** a silent-`undefined` class at top-level and in inline handlers. It is also the concrete instance of the axis dpa-023's `pending` rung is the by-construction answer to — so ruling (b) here and dpa-023's build are the same architectural direction.
- **age:** filed S362, re-verified/re-traced **S363-peter** (~22 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `auto-await axis`, `reactive write`, `_cs_ form`, `member-access of a server call` — the only hits are ledger line 246 (an S1x priority note) and 13287 (dpa-024's "the auto-await axis is the proof" line, which is *about* the axis being under-designed, not a ruling on this fork). No `RULING.md` hit.

## emitobjectkey-proto — should a scrml `__proto__` object key set the prototype (JS default) or be an own data property?
- **severity/scale:** LOW · **language-semantics** (small, but it is a semantics call, not a fix)
- **where it lives:** `docs/known-gaps.md:9920` / `:9921` marker (`sev=LOW status=open`, `route=bryan`), locus `compiler/src/codegen/emit-expr.ts:1271-1273` (`emitObjectKey`)
- **the fork:** `let obj = { __proto__: 42, name: "x" }` compiles CLEAN and emits `{__proto__: 42, …}` — the JS **prototype-setter**, which creates NO own property named `__proto__` and silently changes the object's shape. ⚑ The satellite's proposed fix ("quote it") is a **NO-OP, PA-verified**: `{"__proto__":v}` also makes no own property. An own property requires a **computed** `{["__proto__"]: v}` emit — so the fix forces the semantics decision: (a) a scrml `__proto__` key **sets the prototype** (JS default, status quo — then it should at minimum be diagnosed, since nothing tells the author); (b) it is an **own data property** — emit computed; (c) refuse the key.
- **what it blocks:** nothing shipping. Real-world impact explicitly judged negligible; the security angle is negligible too (the vector is a literal author-typed key, not an attacker-computed one).
- **age:** filed **S356-peter**, reconfirmed on HEAD **S359-peter** (~29 sessions); survived the #590/#592 rewrite of the same function
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `__proto__`, `emitObjectKey`, `prototype setter` — **zero hits**. Marker still `status=open`, `route=bryan`, with an explicit `@reconfirm S359-peter` note saying "routing + LOW + bryan-lane all stand; no peter action."

## session-context-scan-bare-form — ratify widening `E-SESSION-CONTEXT` to non-route positions (newly-rejecting)?
- **severity/scale:** MED · narrow, but **newly-rejecting language surface**
- **where it lives:** `docs/known-gaps.md:1079` / `:1080` marker (`sev=MED status=open`, `route=bryan`, `prov=dpa-021:§6.1`), locus `compiler/src/codegen/emit-server.ts:5799`
- **the fork:** dpa-021 §6.1 asks the `E-SESSION-CONTEXT` scan to also build-block a bare `session` used in a `?{}` interpolation OUTSIDE a web-app route handler (SSE `server function*` / `<endpoint>` / headless), so Direction B "kills the class by construction" everywhere. The gh357 attempt widened the scan by string-matching `session.`/`session[` in the assembled lines and **deterministically matched the compiler's OWN emitted comments and generated auth guards**, build-blocking a clean §20.5 app — reverted after a real regression. So: (a) ratify the widening and build it soundly — key on the **lowering-site record**, not a text scan (this is Rule 7: ask the tree, not the emitted text); (b) leave the non-route residual open and accept that Direction B holds only inside route handlers.
- **what it blocks:** a confidentiality-adjacent residual of a ruled direction. Direction B itself was ruled S316 and ratified S319 — this is the residual scope, not the direction.
- **age:** filed **S323-peter** (~62 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `E-SESSION-CONTEXT`, `session-context` — **zero hits**. Marker still `status=open`, `route=bryan`.

## a10-giti-returned-closure — ⚑ THE HOLD CONDITION IS NOW MET. Is "a factory that returns a request dispatcher" a scrml shape, or a JS habit?
- **severity/scale:** HIGH · **axiom-level** (it asks what the language should be able to SAY, not how to close a hole)
- **where it lives:** `docs/known-gaps.md` gap `g-async-returned-function-expression-drops-return`; S385 queue item **A10**; the reframing is in `user-voice-scrml.md:16330-16360`
- **the fork (as REFRAMED at S385 — the filed fork was the wrong fork):** not *"support vs refuse."* The question underneath: **is "a factory that returns a request dispatcher" a scrml shape at all, or a JS habit the language should not grow?** giti calls it *the idiomatic source*. If they are right, refusing removes expressiveness and exports a real shape to the host, and fork-rule rows 1/3/4 do not save it. If scrml's native answer is the §40 `handle()` onion or a Rule-6/Pillar-5b state shape, then refuse — **but the diagnostic must NAME the native form.** *A refusal that leaves the author with no scrml answer is how you manufacture a `.js` file.*
- **⚑ THE GATE IS MET AND NOBODY KNOWS IT.** S385 held A10 *"until that number exists"* — a host-fallback census across giti · flogence · assetManagement · RediLedger. **The census RAN and COMPLETED (621 lines, all 4 adopters, every host file classified FALLBACK/BOUNDARY/UNKNOWN/GENERATED and cross-referenced against `known-gaps.md`).** It exists at `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/host-fallbacks.md` — **a session scratchpad, never landed, at risk of deletion.** Headline: **5 host-fallbacks across 4 adopters; 4 of 5 have NO gap that counts them.** Two of the five are *declines, not defects* (the language agreeing to permanently export a shape, which no board can represent). The heavier cost is on two axes the count does not measure: flogence's **249 `_{}` blocks = 16.3% of its scrml lines** (its "100%-scrml" `src/ports/` are 23-67% JS by line), and **in-source contortion** (~19 shape workarounds in assetManagement's `app.scrml` alone) — *"contortions-per-KLOC is the bigger signal and nobody counts it either."*
- **⚑ AND A10's OWN DEFECT IS ALREADY FIXED.** The census records that `g-async-returned-function-expression-drops-return` reads `HIGH; open — needs bryan disposition` but the fix landed in scrml's history at `72ba19d6` (PR #111) and **giti migrated the module 2026-07-20** — 41 days before it was surfaced. So the ledger entry is a stale-open HIGH; what survives is only the reframed design question.
- **what it blocks:** nothing engineering-side any more. It blocks a language-identity answer, and it blocks landing the census (which is the only artifact that measures shapes exported to the host).
- **age:** filed **S269** from the adopter inbox (~119 sessions)
- **verified-not-already-ruled by:** the S385 ledger records A10 as **HELD, not ruled** (`user-voice-scrml.md:16336` *"A10 — HELD, and RE-FRAMED"*). Grepped `user-voice-scrml.md` for `host-fallback`, `fallback census` — hits only in the S385 hold text. No later session exists in that ledger (S385 is the newest header). Not in any `RULING.md`.
- **recommendation:** land `host-fallbacks.md` into `scrml-support/docs/deep-dives/` before the scratchpad is reaped, then re-surface A10 with the number in hand.

## b1-issue-509-pwa-direction — bryan asked for option (b) to be expounded and the session wrapped before it was
- **severity/scale:** MED · adopter-facing direction on GH #509
- **where it lives:** GH issue **#509** (OPEN since 2026-08-11, *"Direction: offline / PWA (service-worker + cold boot + sync) — native someday vs host-escape now?"*); S385 queue item **B1**
- **the fork:** the offline/PWA deliberation (dpa-028) is done and ratified S347; the technical findings are posted; **what is owed is the design direction told to the adopter.** (a) ship the static-asset floor + a documented recipe, defer the scaffold (the S347 rec); (b) commit to a `scrml generate pwa` one-shot scaffold; (c) declare offline permanently out of scope.
- **⚑ what actually happened:** bryan's S385 instruction was *"all your recs except B1, expound on option b"* — he **explicitly declined the PA's rec on B1 and asked for option (b) to be worked up before ruling.** The session wrapped at 87% context with four agents in flight and **the expounding was never delivered.** So this is not an unasked question — it is a *half-answered* one, and the PA owes the next move.
- **what it blocks:** bryan's own 2026-08-17 comment on #509 promises *"the design direction will follow separately."* It has not been posted. **13+ days** of adopter silence.
- **age:** issue open since 2026-08-11; the expound-request is from S385 (2026-08-30)
- **verified-not-already-ruled by:** read the S385 ask verbatim in `user-voice-scrml.md:16360` (*"all your recs except B1, expound on option b"*) and the RATIFIED block that follows it — **B1 is the one item explicitly excluded**, and the S385 hand-off's "Rulings taken" list (`hand-off.md:120`) omits B1. GH #509 has no comment after 2026-08-17.

## b6-flogence-async-thunk-boundary — ⚑ NEVER SURFACED. Give adopters a way to declare an async thunk the compiler can colour?
- **severity/scale:** HIGH · **language-wide** (a new typed parameter kind vs a documented workaround)
- **where it lives:** gap `G-ASYNC-STDLIB-IN-SYNC-CALLBACK-OVER-FIRES`, **case 2**; S385 queue item **B6**
- **the fork:** when an adopter passes an async thunk to their OWN higher-order function that awaits it, the compiler refuses because it cannot prove the callee awaits — flogence's `runGatedAgentic(() => runAider())` idiom. (a) add a typed **async-thunk / snippet parameter** the compiler can colour; (b) document the workaround (inline it, do not thunk) and keep the refusal.
- **⚑ B6 IS THE ITEM THAT FELL THROUGH THE S385 BATCH.** bryan's ask was *"on the six prior Qs. all your recs except B1"*; the ledger's RATIFIED block covers **B2, B3, B4, B5, B7** (five) plus B1 excepted (six). **B6 appears in neither the ask's disposition nor the hand-off's "Rulings taken" list.** It was enumerated and then never put in front of him.
- **what it blocks:** flogence's idiom. Case 1 was fixed; case 2 was explicitly deferred *"to an R2 design Q, NOT rushed under freeze"* at **S279**.
- **age:** deferred at **S279** (~109 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `async thunk`, `runGatedAgentic`, `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` — no ruling. S385 ledger lists B2/B3/B4/B5/B7 ratified and B8 PA-disposed; **B6 is absent from both.** Not in any `RULING.md`.

## b10-delta-log-shape-as-a-published-contract — flogence said "Yes, please"; who owns the contract?
- **severity/scale:** LOW · process, not language
- **where it lives:** S385 queue item **B10**; source `handOffs/incoming/read/2026-08-29-from-flogence-RE-bridge-regex-mirrored-and-a-FIFTH-entry-your-widen-does-not-recover.md`
- **the fork:** flogence accepted the offer to publish the delta-log entry shape as a contract instead of three copies drifting apart. (a) scrml publishes the regex + field vocabulary as a **versioned contract**; (b) leave the three copies; (c) hand ownership to flogence.
- **what it blocks:** the shape has now drifted out from under a consumer **twice**. S385 corrected the format doc in place (`kind` is one token, OPEN vocabulary, consumers SHALL NOT validate against a fixed list) — which fixes the *content* but not the *ownership/publication* question B10 asks.
- **age:** raised 2026-08-29 (~1 session), but on a drift that has bitten twice
- **verified-not-already-ruled by:** the S385 ledger's PA-DISPOSED block covers **B9** (normalizing entry `[22]`'s two-word kind) and the format-doc correction — it does **not** rule on publishing the shape as a versioned contract. B10 is absent from the "Rulings taken" list.

## c2-expr-positions-field-gate — derive the expression-position field set from the AST types, or keep hand-maintained lists?
- **severity/scale:** HIGH · language-wide (it is the gate the confidentiality/security lane depends on)
- **where it lives:** `docs/known-gaps.md:255` / `:256` marker (`sev=HIGH status=open`, `route=bryan`); live-on-main carrier `compiler/src/codegen/emit-client.ts:425-428` (`EXPR_NODE_FIELDS`) + `:466-472`; S385 queue item **C2**
- **the fork:** the §8 gate that is supposed to keep the shared expression-position table complete regex-scans `types/ast.ts` for `X: ExprNode`, so it is blind to (a) fields the untyped `.js` AST builder creates that `ast.ts` never declares (`argsExpr`, 6 sites) and (b) fields typed with a CONCRETE node type (`ifExpr`, `forExpr`) — while the docblock claims *"the FIELD half is closed and gated."* A cross-file const read ONLY through one of those positions is never cross-marked → free-variable `ReferenceError` in the shipped bundle at exit 0 (3 vectors proven; if-expr/for-expr executed to a real throw). (a) **derive the field set from the AST types** (structural); (b) keep the list and add the three; (c) accept the blindness and document it.
- **what it blocks:** live `ReferenceError`s at exit 0 — and, per the routing note, it is the *confidentiality seed*: the same blindness is what the §12 escalation walkers stand on.
- **age:** filed **S345-bryan**, locus-corrected **S360-peter** (~40 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `argsExpr`, `ifExpr`, `forExpr`, `cross-mark`, `field gate` — **zero hits**. Marker still `status=open`, `route=bryan`. Independently marked `VERIFIED-OPEN` by the S385 sweep against the same ledger + the six `RULING.md` files. Not ruled at S385 (the ledger names only C3/C4/C5/C6/C7/C8 in the C group).

## c10-engine-initial-state-hydration — which copy owns the bindings when an engine initial state is SSR-rendered then client re-rendered?
- **severity/scale:** HIGH · narrow-to-medium (engine/SSR hydration ownership)
- **where it lives:** gap `g-engine-decl-coupled-bind-dead-on-state-remount`; S385 queue item **C10**; root-caused and turnkey at **S382**
- **the fork:** (a) populate the initial state's per-state wire with the client ids; (b) have the engine adopt the hydrated SSR view and skip the first re-render — **alone this leaves Back→Info dead**; (c) both.
- **what it blocks:** **flagship example 05 (multi-step form) is stuck on step 1 and compiles clean.** No DOM/e2e gate exists that would catch a mis-wire, so nothing else will surface it.
- **age:** root-caused **S382** (~3 sessions), but the flagship has been broken longer
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `engine-decl-coupled-bind`, `state remount`, `hydrat` — hits are S19x engine-hydration arcs and the S23x DOM-adoption D2 ruling, **neither of which is this binding-ownership fork**. Marked `VERIFIED-OPEN` by the S385 sweep; not among the C items ruled at S385.

## c15-server-call-nested-in-expression — converge the five await injectors to one by-construction site, or add a sixth?
- **severity/scale:** HIGH · **architectural** (it is the §13.2 position-invariance mandate's delivery model)
- **where it lives:** `docs/known-gaps.md:10474` / `:10475` marker (`sev=HIGH status=open`), loci `emit-event-wiring.ts:1952,2023` (markup interp) + `:849,870` (inline handler); S385 queue item **C15**
- **the fork:** a server-fn call NESTED in a larger expression (`call().length`, `f(call())`, `call() > 0`) is not awaited at the inner call site in markup interp (`${loadRows().length}` emits `await (loadRows_3().length)` = `await (Promise.length)` = `await undefined` → renders `""`) or in an inline event handler (`onclick=@n = load().length` → `undefined`). **The position-invariant await guarantee is delivered by FIVE post-hoc injectors rather than by construction.** (a) **converge to one by-construction site**; (b) add a sixth injector for this position; (c) **narrow the §13.2 SHALL to the positions that actually hold** (i.e. admit the mandate over-claims).
- **what it blocks:** silent-`undefined` / blank render at exit 0. Routed S370 as **the profile STAGE re-examination test** — i.e. it is the concrete case the retrofit-vs-by-construction question was supposed to be decided on. Same axis as dpa-023's `pending` rung and the `reactive-write-member` fork above; ruling them separately risks three answers to one question.
- **age:** filed and routed **S370** (~15 sessions)
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `auto-await axis`, `nested in expression`, `position-invarian`, `13.2` — the S337 dpa-023 ruling is on the *lifecycle* axis and explicitly deferred the build; nothing rules the injector-convergence fork. Marked `VERIFIED-OPEN` by the S385 sweep; not among the C items ruled at S385.

## c16-e-route-001-local-bind — a gate whose escape hatch is its own recommended fix
- **severity/scale:** HIGH · narrow (one diagnostic's scope + message)
- **where it lives:** gap `G-E-ROUTE-001-LOCAL-BIND-WORKAROUND-DEFEATS-CHECK-WITHOUT-REDUCING-RISK`; S385 queue item **C16**
- **the fork:** the `E-ROUTE-001` message tells adopters to do the one thing that hides the problem — bind the call to a local first, which the check cannot see through. (a) run the check on `const`/`let` initializers too — **raises the fire rate and owes a measured migration; current rate is 10 fires across 1,020 files**; (b) accept that the check cannot see through a local bind and rewrite the message so it stops recommending the hole.
- **what it blocks:** nothing shipping; it blocks the credibility of the diagnostic. **Note it is coupled to the `E-ROUTE-001-severity` MED row below** — both change the same code, so ruling them separately means touching `route-inference.ts:1584` twice.
- **age:** enumerated at S385; the underlying finding is S302-era
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `LOCAL-BIND`, `local bind`, `local-bind` — **zero hits**; the five `E-ROUTE` hits are unrelated. Marked `VERIFIED-OPEN` by the S385 sweep.

## nav-maps-staleness-gate — promote the existing map-staleness WARN to a gate, and at what threshold?
- **severity/scale:** MED · tooling/process, not language
- **where it lives:** `docs/known-gaps.md:7866` (`g-nav-maps-have-no-scheduled-refresh`, `sev=MED status=open`, `prov=ruling:user-voice-S310-billed-ci-legs`)
- **the fork:** S310 killed both Anthropic-billed CI legs as a cost decision (#351) — **that decision stands and is not what is being asked.** The open question is what replaces the signal: `bun scripts/state.ts --check` **already computes it** (`scripts/state.ts:619-633` prints e.g. *"maps: 67 commits behind HEAD … [WARN-only — not gated]"*). (a) promote that WARN to a **hard gate** at some threshold N; (b) surface it as a hard step in the wrap checklist; (c) leave it WARN-only. The entry states the operator constraint plainly: *"a gate that fails for reasons no change caused is the §8 cry-wolf shape, so the threshold matters."*
- **what it blocks:** the measured cost is real, not hypothetical — at **S314 a stale map set routed a dispatch to the wrong file** (`structure.map.md` named `codegen/index.ts` as the chunk-namespace owner; the actual emitter is `emit-client.ts generateClientJs()`). S305-S313 let the watermark drift **67 commits**.
- **age:** filed **S314-bryan** (~74 sessions)
- **⚠ premise partly stale:** a scheduled refresh DOES appear to run again — commit `a8448ac9` (2026-08-30) is authored by `scrml-maps-ci` and `.github/workflows/cloud-maps.yml` is present. So the entry's headline (*"NO automated refresh of any kind"*) no longer holds; **the threshold/gate half is what is still un-ruled.** Worth re-measuring before surfacing.
- **verified-not-already-ruled by:** grepped `user-voice-scrml.md` for `nav-map`, `maps behind`, `watermark`, `state.ts --check` — the only ruling found is **S310 killing the billed legs**, which the entry explicitly says it is not re-litigating. Not in the S385 queue at all (a gap my sweep found that theirs did not).

---

# LIVE — the MED and LOW tail (enumerated, not individually re-verified)

> These are the **C17-C34 (MED)**, **C35-C48 (LOW)** and **D1-D10 (housekeeping)** rows of the S385
> queue. Per `hand-off.md:45` they were **enumerated and never surfaced** — bryan has not seen them.
> Each was marked `VERIFIED-OPEN` by the S385 sweep against `user-voice-scrml.md` + the six
> `docs/changes/*/RULING.md` files. **I re-verified 6 of them independently** (`E-ROUTE-001-severity`,
> `session-reserved-key-read`, `session-context-scan-bare-form`, `foreign-value-block-no-return`,
> `match-empty-arm-void`, `match-else-arm-object-literal`, `proto-object-key`) and found **zero
> disagreements**; the rest I am relaying, labelled as such. Reproduced verbatim because the only
> copy lives in a session scratchpad.

## C17-C34 — MED design forks (20 rows; each is accept-vs-reject or a semantics choice)

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


## C35-C48 — LOW design forks (~18; mostly direction-of-change on a diagnostic)

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


## D1-D10 — HOUSEKEEPING (10; SPEC-ISSUE closures + two instrument decisions)


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

# ALREADY RULED — do not surface

> Each row: the candidate, the ruling I found, and where I found it. This is the half that protects
> the operator's attention — every one of these still *reads* as open somewhere in the tree.

## Ruled at S385 itself (the ledger is current; the gap markers are not)

| candidate | ruling | citation |
|---|---|---|
| A1 `g-native-sqlite-connection-lacks-wal-and-busy-timeout-config` | **(c) BOTH** — WAL + 5s busy-timeout default **plus** a `<program journal-mode= busy-timeout=>` override | `user-voice-scrml.md:16276`. ⚠ `known-gaps.md:45` still says *"ROUTED to bryan"* |
| A2 `g-ssr-each-under-if-template-silently-blank-first-paint` | **(a) NOW, (b) AS ITS OWN ARC** | `user-voice-scrml.md:16268` |
| A3 `g-transaction-block-not-recognized-inside-a-function-body` | **(a) FIX THE ROUTING** — §19.10.2 carries an in-function example the compiler does not support | `user-voice-scrml.md:16264` |
| A4 given-guard-crash-and-shadowing | **(b) FIRE `E-NAME-COLLIDES-STATE`** — and rule the shadowing FIRST, then rebuild the guard lowering on the resolver (the sequencing is part of the ruling) | `user-voice-scrml.md:16270` |
| A5 `g-reset-writes-pending-promise-when-init-thunk-calls-a-server-fn` | **STAMP AND LAND** (`origin/fix/s360-reset-init-await-parity @ 3540a2d7`) | `user-voice-scrml.md:16256` |
| A6 `g-todomvc-harness-dangling-runtime-ref-passes-silently` | **STAMP AND LAND** (`origin/fix/s359-todomvc-hollow-gate @ 681fdad6`) | `user-voice-scrml.md:16259` |
| A7 dpa-029 egress envelope | **(a) MINT THE TYPED `Egress<Bytes>`** — build HOLDS until PR #579 lands | `user-voice-scrml.md:16307` |
| A8 `asis` warning→error at v1 (dpa-036 Call 5) | **(c) DECIDE AT THE FREEZE** — the HOLD continues | `user-voice-scrml.md:16314` |
| A9 `g-cell-initialiser-and-markup-interp-server-only-reach-do-not-escalate` | **REFUSE** — as part of the one §12 expression-position policy; recorded as a **narrowing PENDING dpa-023**, not permanent | `user-voice-scrml.md:16477` |
| B2 GH #471 | **(a) POST THE FULL DIRECTION NOW**, including the deferred `Egress<Bytes>` | `user-voice-scrml.md:16370` |
| B3 `component-props-leak-onto-root` | **(a) DROP ALL declared props** from the root's emitted attributes | `user-voice-scrml.md:16373` |
| B4 `render-a-list-of-markup-values` | **(a) REJECT** — §1.4's five doors are exhaustive | `user-voice-scrml.md:16377` |
| B5 `g-program-sessionexpiry-inert-on-separate-login-unit` | **(a) PROPAGATE** the program setting to the minting unit; confirm the shared root with `#727` first. Severity corrected HIGH→MED | `user-voice-scrml.md:16381` |
| B7 `g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line` | **(a) PLAIN DEFECT, FIX THE LIFT** — peter's "YOUR HELD ruling-3 arc" re-route is a misattribution | `user-voice-scrml.md:16387` |
| B8 `g-bare-ref-attr-value-emits-literal-not-binding` | **PA-DISPOSED** — its stated blocker (the #81 writer-ownership ruling) is stale; that was given **S268** and `E-ATTR-WRITER-CONFLICT` is live at 6 sites in `emit-html.ts`. Routed to the build lane | `user-voice-scrml.md:16391` |
| B9 delta-log entry `[22]` two-word `kind` | **PA-DISPOSED** — normalized in place; the format doc corrected to "one token, OPEN vocabulary" | `user-voice-scrml.md:16400-16412` |
| C3 `g-5c-caller-context-promotes-a-derived-read-helper-to-the-server` | **(b) DUAL-PLACE IT** — the one place fail-closed is deliberately NOT taken | `user-voice-scrml.md:16506` |
| C4 `g-lambda-param-renamed-to-fetch-stub-when-a-server-fn-shares-its-name` | **(a) RETIRE THE MANGLER** — and it IS dpa-024 §9 item (2), so it is scheduled, not merely ruled | `user-voice-scrml.md:16502` |
| C5 `g-server-cell-init-leaks-const-to-client-reactive-wiring` | ruled as an implementation of the **one §12 expression-position policy** | `user-voice-scrml.md:16455-16490` |
| C6 `g-prune-server-only-stdlib-chunks-keeps-chunk-on-textual-occurrence` | same policy — *"consult route inference instead of matching text"* | same |
| C7 `g-trigger-3-parameter-default-not-scanned` | same policy — **PLACE IT** (over-fire is the safe direction); owes a measured corpus differential BEFORE it lands | same |
| C8 `g-ws-message-door-has-no-body-ceiling-d4-census-missed-it` | **(a) COMPILER-OWNED CONSTANT NOW**; mint `<program maxBodySize>` only if an adopter asks | `user-voice-scrml.md:16497` |
| `g-nested-block-match-in-dispatched-arm-silently-drops` | **RULING 2 — (b) SUPPORT**, wire the nested dispatcher | `user-voice-scrml.md:16234` |
| channel-mount-in-match-arm | **RULING 1 — (a) REJECT**; arc (b) later PROMOTED on flogence evidence | `user-voice-scrml.md:16224`, `:16418` |
| `<each in=@undeclared>` unchecked | **RULING 3 — (a) FIRE IT, measure first**; landed under the new 4(b) mandate at 0/1005 | `user-voice-scrml.md:16240`, `:16404` |
| stranded outbox (4 notes, 3 adopters) | bryan: **deliver flogence's, hold the two stale** | `hand-off.md:71` |

## Ruled in an earlier session — the ledger entry never caught up

| candidate | ruling | citation |
|---|---|---|
| `g-default-logic-bare-call-is-unspecified-and-ships-as-page-text` — heading literally reads `OPERATOR RULING OWED` | **RULED S368, option (c)** — diagnose the CALL SHAPE specifically at a default-logic body-top | `user-voice-scrml.md:15574-15586` |
| `g-block-body-value-position-mislowers` (if-value half) — entry says "LANGUAGE FORK, routed to bryan" + names an inbox note | **RULED S331** (*"B. expound Q2"*) — if-as-expression adopts §18.5 plain-tail-lift, to land as a §17.6 amendment | `user-voice-scrml.md:13648` |
| `g-handle-onion-applied-per-route-not-top-level-custom-paths-404` — entry says *"a §40.3 semantics ruling is owed FIRST"* | **RULED S354** — `handle()` PRE wraps ALL top-level dispatch; custom-path interception is within contract; *"the routed fork dissolved"* | `user-voice-scrml.md:15395-15412` |
| `g-match-nofor-block-form-skips-exhaustiveness` — entry says *"Two coupled decisions for bryan"* | **RULED S290** — *"bless `<match on=@cell>` inference + wire the exhaustiveness check"* (both limbs) | `user-voice-scrml.md:12218` |
| `G-DBAUTH-MIGRATE-NO-GRANTS-FOR-UNMARKED-IDENTITY-TABLE` — entry says *"Ruling owed before a fix … at least four directions"* | **RULED (b)** — grant the tables `?{}` actually touches; built and R26-verified against RediLedger's real 20-table schema | `user-voice-scrml.md:12311-12322` |
| `g-failable-error-type-non-enum-spec-vs-corpus-conflict` — heading says *"needs a RULING, not a fix"* | **RULED S313, (c)** — scalar `! string` sanctioned, array/compound rejected under new `E-ERROR-011`; SPEC amended §19.4.4.1 | `docs/known-gaps.md:1266` (quotes bryan's *"1: c"*) |
| `G-BATCH-REORDER-ACROSS-NONDECL-SIDEEFFECT` — filed as *"open (spec question)"* | defect **RESOLVED S285** (§19.9.9.2 step 2 already rules it); the §13.2.4 prose clarification **RULED S290** in the same "your leans on 1-5" batch | `docs/known-gaps.md:7318`; `user-voice-scrml.md:12218` |
| `g-lift-per-item-if-directive-not-reactive-on-reconcile` — entry says *"TIER-1 STILL OPEN — ROUTED to bryan"* | **RULED (a) S297/S298**, BUILT and LANDED (#251 `a745d35e`) — the fork was resolved by the §17.1 governing-sentence gate | `docs/known-gaps.md:6392` |
| `G-274-WALL1` / `G-274-WALL2` — *"routed to bryan"* residuals | both **RESOLVED S305** (PRs #312 / #309) | `docs/known-gaps.md:8133`, `:8161` |
| `g-value-form-control-flow-unspecified` — entry says *"bryan-lane, NOT YET BUILT"* | **RULED S371, limb (b)** | S385 sweep's exclusion list; `user-voice-scrml.md` S371 header |
| `G-SPA-RUNTIME-GZIP-BUDGET-KNIFE-EDGE` — reads as a live hold-vs-raise fork | **RULED S353** — the hold-vs-raise fork is dissolved; the ratchet is lowerable-only | S385 exclusion list; `docs/known-gaps.md:1539` |
| `G-FORMFOR-PE-FALLBACK-…` — entry says *"DESIGN FORK, surfaced to bryan S347"* | **RULED S349** — retire the mandate, not the capability | S385 exclusion list |
| `g-chunk-reachability-is-approximated-not-computed` | **RULED S372** (land wide); build-owed | S385 exclusion list |
| `g-onmount-request-no-refire-on-soft-nav` · `g-route-timer-poll-not-stopped-on-soft-nav` · `g-e-import-007-triple-allocated-no-impl` · `g-channel-in-nested-program-inside-page-ordering` | all carry a `ruling-gated`-looking label but were **RULED S313 / S297 / S353**; build-owed only | S385 exclusion list; `user-voice-scrml.md:15053-15057` |
| dpa-022 · dpa-025 · dpa-026 · dpa-027 · dpa-028 · dpa-030 · dpa-031 · dpa-032 · dpa-033 · dpa-034 · dpa-035 · dpa-036 | **all RATIFIED S338-S365** despite `dpa-queue.md`'s CURRENT-STATUS cells still reading *"awaiting bryan"* | `user-voice-scrml.md:13854, 14326, 14452, 14499, 14535, 14574, 14757, 14898, 14954, 14994, 15080, 15470` |
| dpa-024 | **RATIFIED S385** (§§1-3 + Q5 as written; Ruling A on `emit-match.ts:900` accepted as ranked-4th debt) | `user-voice-scrml.md:16144-16158`; PR #769 |
| **dpa-023 — the `pending` rung** | ⚑ **NOT waiting on bryan.** Direction **RATIFIED S337 as (b)**: ratify the direction, fix the two-line `classifyWriteAgainstSpec` defect now, and give the type-state addition **its own arc**. `pending` is newly-rejecting and **owes a measured migration that has not been taken** — so the block is ENGINEERING, not operator. A9's refusal is explicitly pending it and expires when it lands | `user-voice-scrml.md:13826-13850` |
| `g-module-scope-server-call-no-autoawait` (`status=ruling-gated`) | ⚑ **NOT waiting on bryan.** Deliberately NOT brought at S385: the PA judged it plausibly the same class as dpa-023's `pending` rung, recorded that it had NOT verified a shared mechanism, and **took the check as its own work** rather than spending an operator turn | `user-voice-scrml.md:15062-15070` |
| GH **#471** and GH **#509** (the two open "Direction:" issues) | both **directions are ruled** (dpa-029/030 and dpa-028). What is outstanding is the **PA's return-leg comment**, not a decision — except #509's, which bryan asked to have expounded first (= LIVE item `b1-issue-509-pwa-direction`) | `user-voice-scrml.md:14326, 14574, 16307, 16370` |
| deep-dive `deprecation-lifecycle-2026-06-30.md` — frontmatter says *"unratified — RECOMMENDATION + OPEN FORKS for user ruling"* | **D1+D4 RATIFIED**, including the load-bearing Fork-1 = **permanent-soft-freeze**; landed as SPEC §62 | `user-voice-scrml.md:11140-11144` |
| deep-dive `tenant-floor-design-2026-07-19.md` | **RULED by bryan S271**, all forks ratified (says so in its own frontmatter) | the file's `authority:` line |
| deep-dive `population-first-missing-primitive-2026-08-10.md` (= dpa-025) | **RATIFIED S338** (*"a, and grep the compiler for source-text regexes"*) | `dpa-queue.md` dpa-025 row |
| `i81-writer-ownership-R2-fork-2026-07-17.md` | **RULED S268** (Axiom 1, option B/C hybrid; built as `E-ATTR-WRITER-CONFLICT`) | `user-voice-scrml.md` via the B8 disposition |
| `handOffs/incoming/S386-peter-routes.md` — frontmatter `status: unread`, `needs: action` | **all 5 items were ruled at S385** (channel-mount, each-in, auto-lift, props, markup-values, given-guard). The `status:` field is stale — the same laundered-provenance shape S385 filed a HIGH about | the S385 RATIFIED blocks above |

## Not decisions at all (routed to bryan's WORK lane, not his ruling)

- `g-expr-positions-field-gate-blind-plus-hand-rolled-lists` is marked `route=bryan (confidentiality seed = security lane)` — that is **lane assignment**. It nonetheless carries a real three-way fork (kept in LIVE as C2), so it is listed there; flagged here because "routed to bryan" in this ledger means two different things and conflating them inflates the queue.
- `g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm` (HIGH, adopter flogence) and `g-nested-program-emits-artifacts-it-never-produces` (HIGH) read as bryan-adjacent but state **no fork** — plain engineering defects.
- `g-multi-statement-foreign-block-in-statement-position-lowers-to-malformed-js` (MED) — a filed codegen defect, no fork.

---

# COULD NOT DETERMINE

1. **The ~44 MED/LOW/D rows I relayed rather than executed.** The S385 sweep marked every C17-C48 and D1-D10 row `VERIFIED-OPEN` against `user-voice-scrml.md` + the six `RULING.md` files. I independently re-verified **7 of them** and found zero disagreements, and I independently re-derived its exclusion list (bare-call S368, if-value S331, handle-onion S354, gzip S353) — strong corroboration, **but not proof for the other ~37**. Per the S347 durable (*relayed premises fail ~1 in 3*), treat those as **RELAYED-UNVERIFIED** until each is checked at surfacing time. The good news: they are one-line checks, and the surfacing turn is the natural place to do them.

2. **`g-commit-gate-absent-on-bryan-xps-8950` (D1).** It is a genuine three-way decision, but its premise — *"installing the standard gate would leave the machine unable to commit because main is red against it"* — was **not re-measured**. If main is now green against `scripts/git-hooks/install.sh`, the fork collapses to "just install it." Measure before surfacing.

3. **47 pre-S300 deep-dives carrying "PA action requested" were never individually verified** — not by the S385 sweep (it says so explicitly) and not by me. `scrml-support/docs/deep-dives/` holds **289 files, ~119 `status: current`**, and `status: current` means *the doc is current*, not *unratified*, so the field is not a queue signal. I used `handOffs/dpa-queue.md` as the drain-path of record per its own **S319 DRAIN-PATH RULE** (*"a deliberation banked anywhere else does not exist to it"*) and spot-checked four non-dpa docs. **This is the largest un-swept surface.**

4. **The 129 marker-without-heading gap ids.** I swept BOTH markers and headings, and the four S381 findings that hid there are now filed with both. But an item whose decision language lives only in a *narrative prose block* with neither a heading nor a marker is findable only by reading the prose — which is exactly how those four hid for 41 days. I cannot certify that class is empty.

5. **`SPEC-ISSUE-*` (D4-D9).** I did not independently re-sweep `compiler/SPEC.md`. The 7-of-13-open finding is relayed from the S385 sweep. Two of the ids (`SPEC-ISSUE-011`, `SPEC-ISSUE-012`) are recorded as **double-allocated**, which means the "open" reading may itself be an artifact of the collision.

6. **`scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md` (871 lines, 51 headings).** The S385 queue says the whole C group lives there and that it holds *"29 items across 7 groups"*. I did not open it item-by-item; the C-group entries I did verify all trace back to it consistently.

7. **Whether the two recovered artifacts survive.** Both the S385 decision queue and the host-fallback census live in `/tmp/claude-1000/…/341444f8-…/scratchpad/` — another session's scratchpad. They are the **only** copies. If that directory is reaped, the 84-item enumeration and the A10 gate-clearing measurement are gone.

---

# COVERAGE — what I swept and what I did not

| channel | swept | how |
|---|---|---|
| `docs/known-gaps.md` (10,767 lines) | ✅ full | all 6 `status=ruling-gated` markers · all `route=bryan` markers · a decision-language grep over the whole file mapped back to its nearest heading (49 headings) · marker status extracted per candidate |
| `user-voice-scrml.md` (16,511 lines) | ✅ full, newest-first | read S383 + S385 in full; ~30 targeted keyword greps across all sessions for each candidate |
| `handOffs/dpa-queue.md` | ✅ full | the CURRENT-STATUS table (dpa-001..036) + the dpa-023 section in full; every `awaiting bryan` cell cross-checked against `user-voice` |
| `docs/changes/*/RULING.md` | ✅ | six files; none matched a live candidate |
| `gh issue list` | ✅ 2 of 2 | #471, #509 |
| `gh pr list` | ✅ 9 of 9 (now 11) | incl. the two opened today (#774 route-to-bryan, #775 floor drain) |
| `hand-off.md` OPEN/OWED table | ✅ full | all 5 rows resolved against the ledger |
| `handOffs/incoming/` + `scrml-support/handOffs/incoming/` | ✅ | 1 unread (`S386-peter-routes.md` — fully dispositioned at S385) + the S387/S388/S389 routes |
| **unmerged branches** | ✅ | found `route/s389-…` (PR #774) carrying a brand-new operator fork not on `main` |
| `scrml-support/docs/deep-dives/` | ⚠ **PARTIAL** | frontmatter scanned across all 289; 21 flagged by an "unratified/ruling owed" grep; 4 non-dpa ones opened. **47 pre-S300 "PA action requested" files not individually verified** |
| `compiler/SPEC.md` `SPEC-ISSUE-*` | ⚠ **RELAYED** | not independently swept |
| `scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md` | ⚠ **PARTIAL** | not read item-by-item |

**Two artifacts recovered that no landed file contains.** The S385 session transcript
(`~/.claude/projects/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6.jsonl`)
led to its scratchpad, which still holds:
- **`decision-queue.md`** (532 lines) — the complete 84-item A/B/C/D enumeration with every fork's limbs stated turnkey. **This is the only copy.**
- **`host-fallbacks.md`** (621 lines) — the completed A10 host-fallback census across all four adopters. **This is the only copy, and A10 is held on exactly this artifact existing.**

**Recommendation:** land both into `scrml-support/docs/` before anything else. A 532-line queue and a
621-line measurement sitting in `/tmp` is the same "the last hop is where it fails" shape flogence named.
