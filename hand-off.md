# scrml — Session 391 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-31. Booted `/boot` Profile A onto clean main `2ec2ce3a`. **S391-peter ran
concurrently and the board could not see him** — see MISSES 1. Boot cost 31.9%.

**The framing: almost every finding this session was about an INSTRUMENT, not about code.** Six
mechanisms that were green, silent, or absent — and read as fine. The landings matter less than
what they proved about the things we measure with.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚑ SIX RULINGS OWED, four of them new this session

| item | why it's bryan's |
|---|---|
| **dpa-037** (carried from S390) | ADVISORY, unratified. *"ok hold on I am not ratifying NaN! TBC"* still stands. |
| **`g-dev-root-path-fallback-serves-a-protected-document-unauthenticated`** (HIGH, NEW) | Fix fork: (a) gate the root fallback, or (b) delete it and route `/` through the gated loop as prod already does. (b) removes a code path instead of teaching it the same rule twice, but changes which file dev serves at `/` in multi-input mode → owes a measurement. |
| **`g-conformance-runanchored-silently-drops-…`** (HIGH, NEW) | Every limb changes corpus pass/fail, and the 18 must be adjudicated ONE AT A TIME. |
| **`g-recent-sessions-index-drops-named-session-wraps`** (MED, NEW) | Filed with NO limb deliberately — a tightened regex is still a regex over a commit subject (Rule 7). A session anchor is a fact the wrap KNOWS and could record as a trailer/tag. |
| **4(b) condition 3** (carried) | Measured-zero necessary-not-sufficient. Changing the class is bryan's by the class's own terms. |
| **The `@`-sigil normative line** (carried) | No code can be written until it is drawn. |

Plus **the four S389-peter route forks**, now CORRECTED — see 3.

### 2. Gate asymmetry: now has a concrete instance AND a sequenced answer

`tracking` was red on `main` across four consecutive merges. PA-audited all 7 failures, **5/1 split**:
five dev-watcher cases **pass locally in 3.96s total** (flakes — they share one deadline-sensitive
mechanism, so a slow runner takes all five or none); one (§52.13) is REAL; one was a stale guard,
now fixed (#800).

**Answer to "promote `tracking` to required" is a SEQUENCE, not yes/no:** fix §52.13, stabilise or
quarantine the watcher family, THEN promote. Promoting today pins main red on five environmental
cases. ⚑ Both failing families live in `compiler/tests/commands/` — the directory that runs in NO
blocking job on any platform, so `tracking` is its only coverage anywhere and it is advisory.

**§52.13 itself is a test defect, not a code one:** the 404 on `/SECURE.html` is the file lookup's,
not the gate's, and the gate lowercases on both sides — the security property holds on every
filesystem. Correct fix: assert the invariant (never 200, never leaks) rather than a fixed status.
NOT done; it is a one-line test change and wants its own dispatch.

### 3. ⚑ The four routed S389-peter findings were verified — FOUR OF FOUR needed correction

All eight routed entries now carry a labelled verification block (PA-EXECUTED vs agent-executed;
nothing agent-reported was laundered into PA-confirmed). **Read those blocks before ruling any fork.**

- **`g-tool-context-match-loses-enum-field-order` is MIS-SCOPED as tool-only.** PA-executed: a plain
  web-app `server function` positional payload bind compiles exit 0 and emits `return pa` with `pa`
  never bound. `setVariantFieldsForFile` has ONE caller (`emit-client.ts:2012`), so every non-client
  pass runs null. Filed MED; the evidence supports HIGH.
- **`g-tool-context-match-emits-await-in-non-async-fn` has its SEVERITY INVERTED** — exit 1,
  fail-closed, zero artifacts. Not the filed silent-wrong.
- **The routed "2+3 are ONE emitter, converge" is WRONG.** There is no tool-context match emitter;
  flipping `emit-tool.ts`'s boundary kills one and leaves the other byte-identical. Do not fold.
- **The bindvalue fix as scoped is PARTIAL** — `<match>` arms fail via `emit-variant-guard.ts:1252/1296`,
  so `if=` is not a necessary condition, and its repro fixture is itself a hollow gate (binds the FIRST
  each option → drops the placeholder and it reports green from browser auto-select).
- **The late-join VERDICT holds** (re-established on a pre-#782 tree) but its stated MECHANISM does not
  reproduce, and *"§38.4's late-join contract"* names a section that does not exist. ⚑ The shipped
  `onclient:open` workaround works ONLY because the reactive core has no value-dedup — so closing the
  "same-root" value-dedup item **would break the only workaround**. They are coupled.

### 4. Two new HIGHs that were in no route at all

- **`g-each-in-if-else-chain-emits-zero-renderers`** — one appended `<div else>` takes an `<each>` from
  1 render fn / 1 reconcile / 1 subscription / 0 warnings to **0/0/0 plus TWO FALSE `E-DG-002`**.
  Worse than silence: the remedy it suggests deletes working source.
- **`g-tool-target-drops-fn-implicit-tail-return`** — tool emits `n * 2;`, page emits `return n * 2;`.
  Every `fn` body shape; survives fixing both sibling tool defects.

Plus the root under the channel collision: **scrml has NO duplicate structural-state-declaration
diagnostic at all** (`<count> = 0` twice at program scope → exit 0, both init_sets emitted).

### 5. In flight / held

- **#802 (value-form amendment)** — gate was passing; rebased twice for merge-order. If it did not land,
  it is clean and needs only a merge. Content: SPEC §17.6.10, five loci reconciled, 2 conformance cases.
- **Arc (b)** (`worktree-agent-add7025319a51cbb9`) + **the r8 Windows patch** — pre-existing holds, untouched.
- **Two worktrees RETAINED dirty**: `agent-a96528615f5c41280` (value-form, 6 uncommitted) and
  `agent-adf40fe5528687920` (sweep, 2 uncommitted). Their content landed via #802/#801; the trees are
  not clean and DIRTY is never swept regardless of content.

---

## 🔭 DURABLE FINDINGS

### A. ⭐⭐ Six instruments were wrong, and every one read as fine
The 4(b) mandate's count that **could never fire** (its first exercise ruled a route observation with
no `@gap` marker) · a `prov=` guard the contract **promised and nobody built** (`state.ts` mentions
`prov` once, in a comment) · a session index that **drops real wraps AND admits fake ones** · a
wrap-6b sweep probe that has reported "nothing prunable" **since S268** because ancestry is the wrong
predicate under squash-merge · a conformance harness **silently skipping 18 assertions** in the corpus
that IS the language contract · a `tracking` job **red for four merges** that nobody reads.

### B. ⭐⭐ The sweep backlog was a BROKEN TEST, not neglect
77 of 81 read "UNLANDED", 0 read "landed and clean". We land by copying CONTENT and squash-merging, so
a branch tip is never an ancestor. Both obvious readings are wrong: `--merged` says prune nothing
forever, and "UNLANDED means it holds work" says keep all 100. **Already filed at S326 (#655) and
unbuilt.** Now built (#801), bite-proved on two controls, dry-run only.

### C. ⭐ A gate fixed on the path the test names can stay open on the path the adopter visits
The S380 auth fix is real and has a regression test. That test probes `/secure.html` and a case
variant and **never probes `/`** — where the document is served unauthenticated.

### D. ⭐ The ruling named one contradicting sentence; there were five
S371 named §17.6.2. I found §10:7034 pre-dispatch; the agent found two more, including a **SHALL**
directly forbidding the ruled form. Amending only §17.6 would have shipped the over-claiming-row
defect inside the fix for it.

---

## ⚑ MISSES (mine)

1. **★★ I ran a whole session blind to a concurrent sibling.** S391-peter was live, wrapped, and
   landed #798/#799 while I worked. No `S391-peter.md` was registered, so boot step 0.5 read a stale
   board. I found out only because an agent's branch diff showed his route files as **phantom
   deletions** — my checkout was behind and I had not noticed. Nothing collided; that is luck, not
   design. Return leg sent.
2. **★★ EIGHT wrong-referent probes, all mine, all self-caught by re-checking.** Prose counted as
   markers · string hits counted as emitted functions · a `gh --json` flag that does not exist making a
   waiter exit instantly reporting success · fixed line numbers read after an insert shifted them ·
   `grep -v '^??'` filtering out exactly the rows I sought · **unquoted `$F` in zsh** making a
   bite-proof flip nothing at all while printing three tidy result lines · a grep that put DIRTY rows
   under a SWEEPABLE header. ⚑ The zsh one is named **verbatim** in my own memory, loaded the whole
   time. Recall is not the control; construction is.
3. **★ Two premises in my own dispatch brief were wrong, both relayed rather than executed** — a
   "FOUR-container check" that is three AST kinds, and `symbol-table.ts` attributed to a PR touching
   exactly one file. Caught only because the brief carried its own verify-against-source instruction.

---

## 🧷 STATE

- **main** `c2b8bf28` at wrap-branch cut (+#802 if it landed). **12 PRs merged** this session:
  #792 #793 #794 #795 #796 #797 #800 #801 #803 (+#798/#799 peter's) — see the changelog.
- **Review floor:** drained twice — S390's three, then my own five. Re-check after this wrap.
- **Gaps:** HIGH 76 · MED 195 · LOW 84. **`pa-ruled` count: 1** (was 0 — the mandate's first exercise
  finally has an artifact). ⚑ Count `@gap .*prov=pa-ruled`, never the bare string: prose mentions
  make a naive grep read 3.
- **Maps:** refreshed `0dd659a1` → `2ec2ce3a` (#795). Four claims were wrong from birth, one of them a
  false claim of **verification**.
- **Worktrees:** 102 (was 104). 2 removed via the new probe; 4 retained with reasons stated above.
  **The sweep of the remaining SWEEPABLE rows is its own arc and was NOT taken** — a probe's first run
  is not the moment to delete 100 workspaces.
- **Mechanical stream:** delta-log `[1979]`–`[1994]` + this wrap's. Do not re-derive from here.
