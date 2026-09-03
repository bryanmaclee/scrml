# scrml — Session 395 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-02/03. Booted `/boot` Profile A onto `0dc4d014`. Ran concurrently with S396-peter
(whose wrap is rotated to `handOffs/hand-off-282.md` and whose live items are carried below).

**The framing: five rulings given, four arcs landed, and the session's real output is that the
INSTRUMENTS failed more often than the code did.** Nine separate checks read green or authoritative
while being wrong — and every one was caught by *running something*, never by remembering. Two of
them were caught by gates I did not write. Three were my own claims.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 0. ⚑ peter S398 (concurrent, docs-only) — TWO dog-food finds ROUTED to bryan, both in the INBOX
Ran alongside S397-bryan (LIVE). Two new verified adopter finds, filed in `docs/known-gaps.md`
(counts regenerated HIGH 77→78 · MED 204→205) and routed as inbox items awaiting bryan (left
UNARCHIVED per the S393 precedent):
- **HIGH `g-prod-server-404s-non-index-spa-entry-at-root`** — the built prod `_server.js` 404s a
  single-file SPA at `/` when the entry isn't `index.scrml` (dev serves it, prod doesn't — silent
  dev/prod divergence; the FUNCTIONAL half the auth gap called "structurally safe"). Root
  `build.js:523`. Fork, no rec. → `handOffs/incoming/2026-09-03-from-peter-to-bryan-prod-server-404s-non-index-spa-at-root.md`
- **MED `g-engine-state-child-apostrophe-breaks-parse`** — a `'` in an `<engine>` state-child body
  breaks the parse (`E-ENGINE-STATE-CHILD-MISSING` naming a PRESENT child); it's the S196
  `g-match-arm-apostrophe-bs` fix never generalized to `engine-statechild-parser.ts`. Even-count
  compiles (string-lexing). → `handOffs/incoming/2026-09-03-from-peter-to-bryan-engine-state-child-apostrophe-breaks-parse.md`

No compiler `src` touched (docs-only); FACTS/SPEC-INDEX not owed, maps unchanged. bryan's owed queue
below is UNTOUCHED. Full stream: delta-log `[2051]`–[this wrap] + `docs/changelog.md`.

### 1. ⚑⚑ THE ONE THING IN FLIGHT — the `~` arc is BUILT, REVIEWED, and HELD on a bryan decision

**Worktree RETAINED: `.claude/worktrees/agent-ac264a1015c0da19d` @ `c2ad6f49`** (branch
`worktree-agent-ac264a1015c0da19d`). Four fix rounds, four adversarial passes. **Do not re-dispatch
this — resume the agent.**

**What it is:** bryan ruled limb (a) — §17.6.2 governs an if-as-expression arm body, so a bare
expression statement there is a SIDE EFFECT (does not initialize `~`, does not rebind the tilde
context, does not touch the arm's result). The build de-conflates `liftVar` (the arm's result,
written only by `lift`/the sugar) from `var` (the `~` read slot), plus an `armBody` flag. It also
reconciles **7 SPEC loci** — five beyond the two the ruling named.

**Why it is held:** the arc has TWO halves and only one is ruled.
- **The WRITE half is bryan's ruling, is clean, and is what closes the headline defect.**
- **The READ half** — what `~` *inside* an arm resolves to — is implemented via a
  `nodeContainsTildeRef` widening, and it is generating divergence. **PA-verified regression:** a `~`
  appearing ONLY inside a nested arm activates a body-level tilde context, which reroutes an
  unrelated statement-position loop and **DELETES A DOM LIFT** — base emits
  `_scrml_lift(...createTextNode...)`, the branch emits `_scrml_tilde_N.push(...)` into a dead array,
  exit 0, zero diagnostics. A second HIGH: a bare call in a `while` mints a tilde inside the loop
  block and a later read references it from outside → `ReferenceError`.

**⚑ THE DECISION OWED (asked, not answered):** **revert** the widening — ship the ruled write half,
mark §32.2.1's read clause Nominal/spec-ahead beside the `E-TILDE-001` clause already marked, and let
**dpa-040** take the boundary question the read half keeps colliding with — **or press on** with a
round scoping the descent to body-level `~` only. PA rec is REVERT, on the same reasoning bryan
accepted for the dev-auth split.

### 2. ⚑ RULINGS OWED — bryan's

- **THE THREE-IN-ONE, and it should be ruled ONCE:** does a construct get "arm-body treatment"?
  (a) **loop-in-arm** — should an arm with a loop-lift designate a LIST? One line if ratified;
  newly-working, the irreversible direction. (b) **comprehension bodies** — round 3 assumed yes,
  round 4 reverted it as unruled. (c) **match arm bodies** — round 4 reverted the same way. All three
  compose with **dpa-040**. Ruling any one alone leaves the others incoherent.
- **`g-bare-expr-in-if-arm-rebinds-tilde-context…`** (HIGH) — candidate governing sentence §17.6.2,
  PA-read not ruled. This is what the held arc implements.
- **peter's `E-ROUTE-004` fork** (`handOffs/incoming/2026-09-02-from-peter-to-bryan-…`) — E-ROUTE-004
  `continue`s on un-annotated params, so a server-boundary fn with an untyped-but-CALLED function
  param is routed as a silent dead-500 endpoint at exit 0. **PA rec: limb (a), usage-based** — the
  only limb that fails CLOSED without billing the adopter for an idiom flogenceP uses BY DESIGN
  (foreign signatures left untyped to dodge the library-mode type-strip gap). NOT 4(b)-eligible:
  corpus impact is provably non-zero, which is how it was found.
- **Carried, unchanged:** `dpa-037` (NaN — *"not ratifying NaN! TBC"*) · the `@`-sigil normative line
  · 4(b) condition 3.
- **`g-if-chain-all-arms-run-at-module-init`** (MED) — same scoping question as
  `g-same-named-branch-declarations-bind-to-the-last-definition`; **rule once**.
- **The sugar-tail shape — surfaced with NO recommendation, so "your recs" did NOT cover it.**
  `if (@n>0) { note("c") "pos" }` drops `"pos"` entirely and designates the side effect, exit 0.
  §17.6.10 says "exactly one expression". May be correctly-rejected-but-silently, or a third shape
  needing a rule.
- **Banked, UNRUN:** `dpa-038` (#509 offline/PWA) · `dpa-039` (#471 enterprise docs) · **`dpa-040`**
  (NEW — should an arm body be a `~` context boundary?).

⚑ **INBOX — TWO items DELIBERATELY LEFT UNARCHIVED, both bryan's** (the S393 precedent: an item
awaiting bryan's ruling stays in `handOffs/incoming/` so it is visible at his next boot rather than
buried in `read/`). Both have been READ and both are summarised above/below:
- `2026-09-02-from-peter-to-bryan-e-route-004-untyped-fn-param-hole.md` — the fork in §2 above.
- `S391-peter-routes-fsp-initialize-deliberation.md` — **the FSP `Initialize` handshake shape**, a
  dPA-run deliberation from S391 awaiting ratification and now ~11 days old. Recommendation is
  **coherent-(A)**: make `Initialize` a clean self-handshake (`{protocol, self:{name, role, state}}`),
  dropping the plural `projects` array and singleton `satellites`; `FleetStatus` stays the sole
  roster. The load-bearing fork was RESOLVED BY GREP — the sole runtime reader only *logs*
  `init.projects`, so `Initialize` has never been used for discovery. Compat measured: one SDK log
  line plus a generated-client regen. Alternative is (B)-fixed (mirror the roster query and add an
  additive `self`). **Not a scrml-compiler issue** — flogenceP protocol design, but it is bryan's lane
  because he owns the §61 typed FSP surface.

### 3. ⚑ THE if-CHAIN CLASS — what S395 closed and what remains
- **CLOSED #818** — `g-collect-functions-branch-decl-vs-server-boundary-routing`, in the mandated
  order (RI routing walk FIRST, then `collectFunctions`; the obvious one-walk fix WAS the leak).
- **Still open:** `g-timer-in-if-chain-branch-never-starts` (MED, relayed) · ~25 further
  `symbol-table.ts` walks + 4 further `collect.ts` walks · `reactive-deps.ts` 2 of 15 blind ·
  **the native-parser mirror has never been inspected for this class** ·
  `g-call-expression-interpolation-in-if-chain-branch-renders-empty` (MED — an ORDERING defect:
  `_scrml_boot` renders before `_scrml_nav_rewire` inserts the branch).
- ⚑ **`symbol-table.ts:10642` is a deliberately TOTAL walk — routing it through the shared enumerator
  NARROWS a correct site.** Two briefs have now nearly tripped on it.

### 4. Mechanical state — REFERENCED, not duplicated
Board counts, landings, and the full session stream are in **delta-log `[2037]`–[this wrap]** and
`docs/changelog.md`. Review floor **0 OWED** (6 recorded this wrap). `pa-ruled` count **1** (one real
marker; a naive grep reads 3 — the other two hits are the S391 explanatory comment and entry prose).
Maps refreshed at wrap 6c. Worktrees: the four landed ones swept; **one retained** (§1 above); ~75
older strays remain and are pre-existing debt — ⚑ **do NOT act on `worktree-sweep.ts` rows**, its
SWEEPABLE classifications were measured wrong at S393.

---

## 🔭 DURABLE FINDINGS

### A. ⭐⭐ Nine instruments read green or authoritative while being wrong
Not a run of bad luck — a concentration. **Two were caught by gates I did not write**, which is the
argument for the gates: the cloud `gate`'s delta-log sequence step (peter and I appended `[2033]`–
`[2035]` concurrently; a duplicate makes the flogence bridge skip the second entry as
already-absorbed and DROP it from the digest), and the pre-push generated-doc gate (twice).

**Three were my own claims:** the "inverted ruling" (§17.6.4 had said it all along; I relayed a
hand-off's framing without opening the section), a corpus count where I said "5 sites" while counting
FILES, and a §17.6.9 citation for a shape that was never broken.

**And three were agents' own instruments, found by the agents:** a corpus differential invalidated by
a deleted `.git` (a PROJECT_ROOT_MARKER, so every chunk token hashed an absolute path — 1021 phantom
diffs), a security sweep that could not bite on the leak it was aimed at, and a leak guard satisfied
by the function VANISHING entirely.

### B. ⭐⭐ Suppressing a signal suppresses whatever was riding on it
Three instances, one session. The `tracking` job's routine red (a REAL §52.13 assertion sat inside it,
silently failing on Linux for an extended period, because `compiler/tests/commands/` runs in **NO
blocking job on any platform**). A knowingly-red assertion placed FIRST in a test, which turned the
four assertions after it into dead code that still read as coverage. And `test.failing` — **which I
instructed** — where `.failing` passes when the body fails for ANY reason, so it would have MASKED A
LEAK. The agent split it into a HARD test for the platform-invariant half and a `.failing` one for the
unruled status. **Its formulation is the keeper:** *a mechanism that makes a red acceptable also makes
a red invisible — every time you suppress a signal, check what else was riding on it.*

### C. ⭐⭐ A fix that needs a second decider is the fork rule telling you no
The dev-auth arc: making §52.13's case variant filesystem-independent requires gating the REQUEST
PATH, which cannot know what the resolution loop would pick. Three rounds, three distinct
divergences, each fix converging the pre-gate toward BEING the loop. That reintroduced the exact shape
ruling 2b chose limb (b) to remove (row 4, root-vs-position). bryan ruled SPLIT — and the split then
**closed a dev/prod divergence rather than opening one**, since `build.js:541` also gates on the
resolved file. The tell was the repeat, not any single finding.

### D. ⭐ Base-drift nearly reverted landed work FOUR times
Every agent branch cut before a sibling landing shows the sibling's files as deletions. A wholesale
file-delta pull would have reverted the maps refresh, then #820/#822's continuity, twice more. The
`known-gaps` @generated counts also CONFLICTED with peter's #821 — hand-picking either side would have
silently dropped one of our filings; regenerating from the merged population gave the union.

### E. ⭐ Agents corrected me five times and were right every time
The brief that said "remove the `continue`" (a naive deletion would have red'd 62 `count: 0` absence
assertions). The `ast-if-chain.js` path, its attribution, and its consumer count. My predicted test
number (254, not 257 — revived assertions raise the EXPECT count, not the test count). And the
`test.failing` hazard. **Every deviation from my instruction this session was correct**, and each was
reported with its reason rather than silently taken.

---

## ⚑ MISSES (mine)

1. **★★ I relayed a hand-off's "a ratified limb was INVERTED" into the boot report without opening
   §17.6.4**, which had said the opposite all along. Third instance of the relay-vs-execute split.
2. **★★ I banked dpa-040 in a form the probe could not read** — the right FILE per the S319 drain-path
   rule, but `dpa-debt.ts` reads the status TABLE, not the per-item sections. It reported 39/2 UNRUN
   until I added the row. **"Bank in the queue file" is necessary and NOT sufficient.**
3. **★ I instructed `test.failing` on a test whose body also asserted no-leak** — would have masked a
   leak. Caught by the agent, not by me.
4. **★ I said "5 bound-position sites" while counting FILES**, and cited §17.6.9 ex 4 for a shape that
   binds its intermediate and was never broken. Both corrected in user-voice.
5. **★ `echo PUSHED` fired off a pipeline's exit code** while the push had been REJECTED.

**The pattern, and it is the session's real output:** my verification holds when I EXECUTE and fails
when I RELAY — including relaying my own earlier reading. Recall is not the control; construction is.
