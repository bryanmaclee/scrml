# scrml — Session 383 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-28/29. Booted `/boot` Profile A onto a clean main. **A DOUBLE WRAP** — S384-peter
ran concurrently, landed #748/#749, and deliberately deferred his fat hand-off + delta-log here.

> ⚑ **HAND-OFF ROTATED THIS WRAP.** S350–S382 (31 sessions, 3,352 lines / 257KB) moved verbatim to
> [`handOffs/hand-off-s350-to-s382.md`](handOffs/hand-off-s350-to-s382.md), md5-verified identical
> before the source was replaced. The hand-off is the document `pa-base v2.16` §2's rotation rule was
> GENERALIZED FROM, and it had not itself been rotated in 31 sessions. Mechanical state lives in the
> delta-log `[1923]`–`[1932]` and the changelog; this file carries the irreducible.

**The framing: two ratified items landed, and the reviews found more than the building did.** Twelve
adversarial findings across two rounds on ruling 3 — and the single most valuable one was not about
ruling 3 at all. Four of the six new board entries came out of adversarial passes rather than out of
writing code.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. 🔴 AN ADOPTER'S FLAGSHIP GATE IS RED — arrived DURING this wrap, unstarted

**`g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm` (HIGH).**
flogence PA S36 dropped this into `handOffs/incoming/` mid-wrap. Their `src/` is **byte-identical**
to its last-green state (last `src/` commit `12fe035`, 2026-07-17) and their flagship gate went
**GREEN 68w/0e → RED 3 errors**. A scrml-side regression inside a wide window.

**PA-REPRODUCED on `ff4b37e5`** with their 21-line two-file repro, and **PA-BISECTED: it reproduces
identically on `a042f3fd`, the S383 boot base — so this session's `symbol-table.ts` extraction did NOT
cause it.** I checked because scope resolution is exactly where S383 touched.
**PA-VERIFIED their localization rather than relaying it:** the same `${@stamp}` read moved OUTSIDE
the match arm compiles CLEAN. Failing conjunction: **cross-file (imported channel) cell · `${…}`
interpolation · inside a `<match>` arm.** Mount is irrelevant; a same-file local is clean; an
`<each>` body is clean — so not nested scopes generally.

Two companion defects, both PA-verified: **the diagnostic carries no source location at all** (no
`-->`, no line/col, in a 21-line repro and in their real 3,700-line file — localising three errors
cost them manual bisection), and **`each in=` reads appear never to be checked**, so
`<each in=@undeclaredName>` is clean while `${@heartbeat}` on an adjacent declaration errors.
Unexplained and worth correlating: their warnings moved **68 → 221** on byte-identical source.

**This is their third over-fire report** (cf. S33's `E-ASYNC`, which we ruled an over-fire and fixed),
and they explicitly did not launder it — no source was restructured to go green.
Repro inlined in `handOffs/incoming/read/2026-08-29-from-flogence-*.md`.

**Two more flogence messages arrived in the same window** (all three now committed — an untracked
inbox file is invisible to every other clone, S290):
- **`g-multi-statement-foreign-block-in-statement-position-lowers-to-malformed-js` (MED, FILED).**
  A multi-statement `_={ … }=` in bare STATEMENT position lowers to `return (stmt stmt)`.
  PA-REPRODUCED. Filed because **the diagnostic's own text asks for it** — leaving it unfiled would
  be an instruction-following failure, not a triage call. The discriminator is the POSITION, not the
  foreign block; §64.2 admits bare-`_{}` in a tool body, which is exactly where an author reaches for
  it, with exactly `console.log` + a `for` loop.
- **bridge-regex mirror (`needs: awareness`, NOT filed).** They mirrored the regex fix into **three**
  flogence copies, not one — so the shape lives in **five** places across the two repos — and they
  captured-and-discarded the marker as warned rather than folding it into `kind`. ⚑ **They then report
  that adopting the unconditional `bracketed !== parsed` refusal immediately surfaced a FIFTH unparsed
  entry that the widen does NOT recover.** Unread in detail by me at wrap; the message is in `read/`
  and that last claim is the one to pick up — a refusal gate finding a case its own paired widen
  misses is worth understanding before either is extended.


### 2. ⚠️ THE ONLY THING WAITING ON BRYAN — the A1 fork

**`g-nested-block-match-in-dispatched-arm-silently-drops` (HIGH).** A nested block `<match>` inside a
dispatched `<match>` arm compiles clean at exit 0 and **renders nothing at any value**.
PA-REPRODUCED: `render_Show`/`render_Hide` emit 2 refs each, `render_On`/`render_Off` emit **ZERO**,
and exactly one `data-scrml-match-mount` div exists — the outer.

⚑ **The load-bearing half is a MEASURED incoherence, not the drop itself.** At the *identical*
position inside a dispatched arm body:

| construct | behaviour |
|---|---|
| `if=` | loudly refused (`E-IF-IN-DISPATCHED-ARM`) |
| `<each>` | works |
| `show=` | works |
| nested `<match>` | **silently drops** |

Three behaviours across four constructs whose only real difference is which one someone got to.
`emit-html.ts:1506` already notes the `if=` guard *"APPLIES HERE TOO"* for match arm bodies — the
note exists, the guard does not.

- **Fork A — REJECT.** Extend `refuseConditionalInDispatchedArm` (`emit-html.ts:802`, call sites
  1526/1755/2745) to nested `<match>`/`<engine>`; mint `E-MATCH-IN-DISPATCHED-ARM`. Newly-rejecting,
  owes a measured migration, cheap.
- **Fork B — SUPPORT.** Emit + wire the nested dispatcher inside the arm's wire fn (`emit-match.ts` +
  emit-html dispatch), mirroring `<each>`-in-arm which already works. Semantics-changed, larger,
  likely closes the whole `G-IF-MOUNT-INSIDE-DISPATCHED-ARM-BODY` family in one wire-fn redesign.

**PA recommendation: B, and the FORK RULE decides it before cost gets a vote.** Row 4 (root vs
position) discriminates: A refuses one more construct at one more position and leaves the family open
with a FOURTH behaviour; B fixes the shared wire-fn root all four hang off. Row 1 (limit-vs-widen)
*looks* like it favours A and does not apply — `<each>` and `show=` already work here, so this is not
a closed surface being widened, it is a half-built one being finished. Cost is B's only argument
against, which is what row 5 exists to break after rows 1–4 have spoken.

### 3. The §40.8 auto-lift HIGH — unstarted, and it is the session's best find

**`g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line` (HIGH).** One prose line at
a `<program>`/`<page>`/`<channel>` default-logic body-top silently disables the auto-lift for every
declaration below it in the same run. PA-REPRODUCED three shapes — the dangerous one is (b): the
declaration lands in **zero** client-JS files, ships into `<body>` as literal text, and emits **zero
diagnostics**. Contradicts §40.8's own S123 amendment, which puts `function`/`fn` and the structural
state-decl form in the auto-lift set with no positional qualifier.

⚑ **Why it is HIGH on the silence and not the shape:** writing a sentence above a helper is what a
person does — and per S368 the corpus is 100% LLM-authored, so prose-then-code at a body-top is
precisely the shape a HUMAN writes and the corpus therefore under-represents. Adjacent to the ruling-3
hole but a DIFFERENT defect: ruling 3 is a statement not being REFUSED here; this is a declaration not
being LIFTED here. Fixing either does not fix the other.

### 4. Ruling 3's arms are HELD and the successor's brief is already written

`docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md` (18KB) carries the 52-fixture cross-axis
corpus, the two-recognizer DO-NOT-MERGE note, and the four-guard safety property — landed as
SPECIFICATION, deliberately NOT as a dormant gate. Worktree `agent-a84d38ac3c1c30a4b` @ `79894418`
**RETAINED** (the built arms). Whoever picks this up builds a grammar-derived recognizer over the
parsed tree; a wider regex is not it.

### 5. OPEN / OWED

| | state |
|---|---|
| **A1 fork** | **the one blocking ruling** — see §2 |
| review floor | **12 OWED** (`#743`-`#747`, `#750`-`#752` + 4 older). Code-bearing carve-out rate **1% (2/147)** — the health signal is fine; the volume is wrap/docs PRs |
| `#727` session-store HIGH | OPEN, still reproduces — carried from S379 |
| each-alias | still parked at `s375-r7-reviewed`, **4 sessions untouched** |
| `#655` `#640` `#580`(DRAFT) | untouched, pre-existing |
| worktrees | **91** under `.claude/worktrees/` + 6 `scrml-spa-ss*` siblings. Base §7 bounds retention to the SAME session. Two must be retained (above). Wants a dry-run listing first |

---

## 🔭 DURABLE FINDINGS

### A. ⭐ The reviews found more than the work did
Twelve findings across two adversarial rounds on ruling 3. The most valuable — a **HIGH** — was not
about ruling 3: the reviewer was reading a *conformance fixture* and found the fixture was RATIFYING a
live §40.8 defect nobody had filed. **An instrument pointed at one thing found a bigger thing beside
it**, which is an argument for running the gate even when the diff looks clean, not just when it looks
risky.

### B. ⭐ A rule you just wrote down is not a rule you are following — 4 instances, one session
1. The false claim ruling 3 exists to strike **survived at `ast-builder.js:1861`**, the emission site
   the corrected §34 row points readers at.
2. The `maskCommentRegions` tripwire was **PROVEN vacuous** — a planted `/*`-bearing string literal
   plus a real call reported GREEN with a live reference in the file — using exactly the
   non-string-aware comment model the same PR documents at length.
3. The arc filed a CWE-377 `/tmp` gap against `dev.js` while shipping the identical shape in its own
   new test.
4. **Mine:** I blind-clobbered peter's merged #748/#749 with a directory-wide
   `git checkout <branch> -- compiler/src/`, ten minutes after avoiding that exact class twice for
   `docs/FACTS.md`.

The common shape: the rule was known, written, and cited — and applied to the object under review
rather than to the reviewer's own hands. **Detection is not recall; it is reading the artifact you
just produced.** All four were caught by looking at output (the staged set, a planted mutation, a
grep), none by remembering.

### C. A generated file is merged by REGENERATION, never by a text merge
`docs/FACTS.md` went three-way this session — main's #749 moved the source count, the agent's branch
moved it differently, my SPEC edit moved the SPEC line count. Every pairwise wholesale pull loses one
side, silently, and the loser is a CI gate. **Correct handling:** pull everything EXCEPT the generated
file, then regenerate on the merged tree **after the last source edit** — including a comment-only
one, which is how the dispatch hit the facts gate twice. Composes with base §7: a wholesale pull is
safe only where the file is unchanged on main since the agent's branch-base, and `comm -12` over the
two file-sets is the cheap check before pulling anything.

### D. The concurrent-session protocol worked, and it worked because a file existed
S384-peter read my boot registration, took a non-intersecting lane, and routed his shared-doc writes
through my inbox rather than racing my live `known-gaps`/`pr-reviews` edits. **That is the exact
inverse of S379's structural mistake** (registered nothing, read the board once). Cost of registering:
one file at boot. Value: a concurrent session partitioned itself correctly without a single exchange.

---

## ⚑ MISSES (mine)

1. **★★ The blind clobber** (finding B4). Directory-wide pull from a branch based before a sibling's
   merges. The agent's own report even said *"land my other 20 files by file-delta"* — I pulled
   directories. Caught by reading the staged set.
2. **★★ Two wrong-referent probe errors**, both the class my own notes name
   ([[feedback_the_probe_answered_a_different_question]]): reported `state.ts` "exits 0 with zero
   output" when the `0` came from `head` in a pipeline while `timeout` killed `bun` upstream (it is
   fine — 4m42s, because it runs the 22,926-test subset); and counted **5,129** inbound `§13.7`
   citations by grepping a tree containing ~90 worktree checkouts (true figure: 249).
3. **★ I briefed two premises that measurement falsified** — a conformance case that does not exist,
   and predicted `col` deltas that do not occur (the F5 fix is a corpus no-op). The agent was right
   both times; the standing invitation to contradict the brief is what surfaced them.
4. **★ I said "`dom` or `domAnchored`"** in a fix-round brief. `domAnchored` with `selector: "body"`
   reports *no match* — `runAnchored` receives the body element AS its root — so a leaked bare text
   node is invisible to it. Whole-tree `dom` is the only instrument that sees it.
5. **★ `--no-verify` on a briefs-only commit.** No authorization, no docs-only carve-out in the rule.
   Redone with the gate running, which has its own sanctioned docs-only fast path — so running it was
   both correct and free.

---

## 🧷 STATE

- **main** `ff4b37e5`. Coherence **0/0** both repos. Cloud `gate` GREEN. Tree clean.
- **6 PRs merged this session:** #746 (§13.7 cut) · #747 (review floor) · #750 (ruling 3 stable half)
  · #752 (S384 absorb) — mine; #748 · #749 — peter's.
- **Board:** HIGH **61** · MED **184** · LOW **83** · Nominal 7 — up 6, **four of them from
  adversarial passes**.
- **Review floor:** 12 OWED; code-bearing carve-out **1% (2/147)**.
  ⚑ `review-debt.ts` mixes a LIVE GitHub merge list with the LOCAL working-tree ledger, so its OWED
  count is **branch-dependent** and overstates debt from a feature branch. The boot contract requires
  stating that number — which means **run it from `main`**.
- **Worktrees:** `agent-a84d38ac3c1c30a4b` (ruling 3's arms, **RETAIN**) · `each-alias-r5` @
  `s375-r7-reviewed` (parked). ~90 others are cleanup debt, dry-run first.
- **Maps:** watermark `0dd659a1`. Compiler source DID land this session (`ast-builder.js`,
  `default-logic-exemption.ts`, `symbol-table.ts`) — see wrap step 6c below for disposition.
- **Mechanical stream:** delta-log `[1923]`–`[1932]`. Do not re-derive from this hand-off what the
  delta-log and changelog carry.

---

# scrml — Session 384 (peter · Windows) — WORK LANDED, wrap deferred here

**Date:** 2026-08-28. Successor to LIVE S383-bryan; ran concurrently on a non-intersecting lane and
deferred the fat hand-off + delta-log to the live wrapping sibling. Full context:
`../scrml-support/handOffs/active-sessions/S384-peter.md`.

## WHAT LANDED — 2 dog-food HIGH codegen fixes
- **#748** `dfbdd9d2` — server bare-dot payload-variant `.Found(x)` emitted `"Found"(x)` → runtime
  TypeError. `getVariantFieldSchema`'s registry is client-pass-only; the fix consults the rewriter
  registry (both-pass) as a fallback at the constructor call site → emits `{variant,data}` per
  §51.3.2, parity with the client.
- **#749** `88dc214e` — server value-native map/set, two layers: (L1) `_scrml_map_from_entries` runtime
  not inlined into `.server.js` → ReferenceError; (L2) map/set methods client-gated → `m.insert is not
  a function` even with the runtime present. Reachability-gated runtime inline (mirrors the
  structural-eq helper pattern) + `mapSetLoweringBoundaryOk` (server lowers for a bare non-reactive
  LOCAL receiver only).

## METHOD (his, and it worked)
Dog-food with 3 agents on disjoint surfaces, RUN in happy-dom to find silent-wrong. Then PA re-verify
EVERY finding on HEAD (S360) — **F-B1 was REFUTED that way** (the compiler catches it via
`E-CODEGEN-INVALID-LOGIC`; the claimed silent crash was not real). Build agents' roots treated as
hypotheses — the C2 agent correctly found a second layer his brief had missed.

## Routed to bryan and ABSORBED at S383 (#752)
All three PA-reproduced before filing: `g-nested-block-match-in-dispatched-arm-silently-drops` (HIGH,
the A1 fork above) · `g-server-map-set-method-unlowered-in-endpoint-and-value-only` (LOW, his own
disclosed residual) · `g-sqlite-bool-column-crosses-the-sql-boundary-as-numeric` (MED, lane question
routed to bryan-side and triaged: **scrml's defect, not SQLite's**). Review markers for #748/#749
recorded verbatim from his note.

---

## PRIOR SESSIONS

S350–S382 (31 sessions) rotated to
[`handOffs/hand-off-s350-to-s382.md`](handOffs/hand-off-s350-to-s382.md) at this wrap, verbatim and
md5-verified. Earlier archives: `handOffs/hand-off-*.md`.
