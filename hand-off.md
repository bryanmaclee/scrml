# scrml — Session 420 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' and is untouched.
>
> ⚑ **SIBLING STATE: `S418-bryan.md` still reads `status: LIVE` (2026-09-15) and no `board(s418): WRAPPED`
> commit exists** — his voice entry landed, the board flip did not. Treated as POSSIBLY-LIVE all session;
> I stayed entirely off his footprint. His four S418 rulings remain UNBUILT and are his: `E-ASSIGN-003`
> fires · §49.2.1 braceless loop bodies REFUSED · **UNIFY** (the token after a condition head's `)` SHALL
> be `{`) · `E-MU-001` specified as-is. His open PRs (#962, #951, #950, #939/#938/#937, #920/#919/#918,
> #907/#906/#905, #899, #887) are CLAIMED, not lost.

## ⏭ NEXT-SESSION PICKUP

1. **Drain the review floor first — nine sessions running it has returned something real, and this
   session it convicted a PR of mine TWICE in a row.** It will read **4 OWED: #977, #978, #979 + this
   wrap PR.** Classify with `review-debt.ts`'s `CODE_BEARING_RE` against `gh pr view <n> --json files` —
   **never** by this hand-off (the S419 hand-off's own CI claim was inverted; see item 6).
   ⚑ #978 and #979 each already had an independent S239 pass **and a fix round**; #977 is ledger-only.
   The floor pass is still owed on all of them — a pre-land pass is not a floor record.

2. **⚑ THE ONE PIECE OF REAL WORK TEED UP: limb 2 of the render HIGH, and it now has a live subject for
   the first time.** `g-e2e-render-map-populated-seed-is-inert-so-d6-has-no-live-subject` is
   `status=narrowed` — limb 1 (the seed bridge) LANDED in #978; the remainder is D6 alone.
   `render-detectors.js:389` gates D6 on `obs.seeded`, but `hasRenderedContent` inspects the whole
   `body`, so page chrome satisfies it before any datum arrives and **D6 has still never fired.**
   **The subject: `examples/25-triage-board.scrml#populated` renders all three task lists EMPTY under a
   live seed and scores `renders-clean`.** That is exactly the board-bug shape D6 exists for. Scope
   `hasRenderedContent` to the seeded region (the `<each>` container) and use that cell as the fixture.
   ⛔ Do NOT "fix" `25-triage`'s fixture first — correcting it makes the subject disappear.

3. **Bryan's, unchanged + ONE new routing:**
   - the four S418 ruling builds (above); the `>>>` tokenizer reorder; `examples/09-error-handling`;
     the two soft-nav RULING gaps; the whole S417 list.
   - ⚑ NEW — **`g-program-shape-inference-anchors-on-the-entry-file-dirname` (MED).** A shell in a
     subdirectory draws a FALSE `W-PROGRAM-SPA-INFERRED` ("no `pages/` directory exists at the project
     root" — it does) and **silently suppresses** the correct `W-OUTLET-ABSENT-SOFT-NAV-DISABLED`.
     PA-reproduced with a control. Root is `ast-builder.js:20054` `projectRoot = dirname(filePath)` — the
     same anchor #972 fixed in `codegen/`, one file away, misfiring on precisely the layout #972 shipped
     support for. **Fixing it changes which diagnostics fire**; both are info-level and no compile status
     moves, so it reads as conformance restoration toward §40.8.1 — but the call is his. Outbound drop
     written this session.

4. **Peter-lane, still open, cheapest first:**
   - `g-e2e-render-map-seed-fixtures-are-wrong-in-three-of-four-entries` (MED) — three DIFFERENT defects,
     each PA-verified against app source: `06-kanban` seeds the DERIVED cell `todo` (source is `cards`,
     and it uses `column:` where the field is `status:`); `16-remote-data` seeds `contacts`, **a cell that
     app does not have** (one cell, `<phase>`; the list iterates `rows`, the match binding of
     `.Loaded(rows)` — no plain cell-set can drive it); `25-triage` uses `column: "todo"` against
     `["Inbox","Doing","Done"]` under §45 strict `==`. See item 2 before touching `25-triage`.
   - `g-heading-drift-tail-reads-a-superseded-status-when-the-tail-narrates-a-transition` (LOW, 1 live
     instance) — ⛔ do NOT fix by pattern-matching `→`/`RE-TRIGGERED`; that is another hand-enumerated
     list of the kind this probe's history punishes.
   - the S419 item-4 list is UNTOUCHED and still valid (e2e-render-map CI job · baseline regen owed on
     POSIX · the three non-inert reserves · `g-w-lint-018` probe-then-close ·
     `g-s320-autoawait-stale-injectpromiseawait-comments`).

5. **STILL NEEDS A POSIX CLONE:** `g-todomvc-mount-throw-unclassified`; the e2e-render-map baseline
   regeneration; a Linux run of `composed-route-shell-chrome-wiring.browser.test.js`.

6. ⚑⚑ **CORRECTION TO THE S419 HAND-OFF — IT WAS INVERTED ON CI COVERAGE AND I PROPAGATED IT.** It said
   #972's browser test "ran ONLY locally on Windows — CI's browser lane did not run it; its integration
   sibling ran 8/8 in CI." **Both halves are wrong.** `scripts/browser-baseline.ts --check` is a step in
   the **BLOCKING `gate` job** (`ci.yml:148-149`, "a regression here now blocks"); `compiler/tests/integration`
   runs **only** in `tracking`, which is `continue-on-error: true`. I copied the false claim into a dispatch
   brief before a reviewer caught it. Filed as
   `g-instrument-suites-cite-themselves-as-gates-while-running-only-in-the-non-blocking-tracking-job` (MED) —
   the ask there is **promote-or-stop-citing**, not "make integration blocking"; `.github/` is shared infra
   → propose to bryan.

7. ⛔ **UNCHANGED, CARRIED:** no recovery scan in `collectIfCondition`; do not widen the four `[^>]` marker
   regexes (S416 measured live miss count ZERO — and the S420 drift-probe fix deliberately did **not**
   touch the one at `state.ts`); `bun scripts/types-gate.ts --write` still owed on a clone with an
   extensionless `tsc`.

8. **Standing from Peter, exercised again:** merge on green without re-asking, re-measuring `tracking`'s
   failure NAME-SET against main's own run every time (identical 5-test dev-watcher cluster on all three
   PRs, re-measured per PR, never inherited). `autoMode` did not fire this session.

## WHAT LANDED

Three PRs, all gate-green, all merged. **One touched `scripts/`; one touched the test tier; one ledger-only.**

- **#977** `review(s420)` — floor drained **8 → 0**; 27 findings across 5 code-bearing PRs, 2 HIGH, zero
  clean; 11 gaps filed; `g-e2e-render-map-with-data-coverage-is-four-of-438` corrected in place to 0-of-438.
- **#978** `fix(e2e-render-map)` — limb 1 of the HIGH: the seed reaches the cell the app actually reads.
  Its S239 pass returned **2 HIGH + 2 MED + 4 LOW** and it did **not** land as-is; two fix rounds.
- **#979** `fix(state)` — the drift probe measured a quarter of its subject and reported a bare count.
  Its S239 pass falsified the PR's own headline; one fix round. 2 LOWs drained.

## 🔭 DURABLE

**The floor convicted my own work twice in one session, at the same class, one level apart.** #979's whole
subject is "a bare count cannot be told from a truncated one" — and it shipped a SECOND undisclosed
truncation (an `i+8` marker window the loop's own `### ` break made redundant), discarding 68 comparable
pairs and 19 real drifts, while its new scope line blamed the CORPUS for them. **When you fix a truncation,
the next question is what else in the same function is bounded and why.**

**A balance assertion is the cheapest guard there is.** Splitting the denominator and asserting
`inspected + noTail + noMarker === headings` immediately caught a silent patch failure of my own — a
`python` hunk that never applied, leaving `noTail` at 0 and the parts summing 573 of 1010, with a
plausible-looking output. **Make the parts sum to the whole and a silent skip cannot hide.**

**"Verify before claim" is not a slogan; it stopped a false headline this session.** I counted 21 markers
carrying undocumented statuses, concluded 7 HIGH + 5 MED were missing from the board, and was wrong in
full — I had reasoned from `state.ts`'s stale header COMMENT instead of its classifier. Caught only by
reading `GAP_STATUS_OPEN` before writing it down. **The derived doc that lies to you is often in the same
file as the code that would correct you.**

**Two reviewers who never spoke converged on one defect from opposite ends** (the seed never reaches the
cells / the predicate is satisfied before data arrives). Neither alone explains it; either alone is
sufficient to break it. **Convergence from independent angles is worth more than agreement.**

## ⚑ MISSES (mine)

1. **★★★ #979 shipped the class it was fixing.** An adversarial pass caught it; I did not, despite having
   spent the session filing that exact class against other people's work.
2. **★★ I propagated a false claim from my own hand-off into a dispatch brief** (the CI inversion, item 6).
   Second consecutive session my hand-off has misled the next session's work.
3. **★★ My first brief handed the agent an unimplementable fix** ("prefer `_scrml_cs_reactive_set` when
   defined") — those wrappers are IIFE-local and unreachable from the harness. The agent corrected it
   because the brief told it to push back; a brief that demanded compliance would have got a worse fix.
4. **★ A `python` heredoc patch silently no-op'd one hunk** and produced a plausible wrong number. Caught
   by the balance assertion, not by me reading the output.
5. **★ A `cd` moved the harness's primary working directory twice** (S419's miss #2, repeated). Re-asserted
   the root both times; no damage.

## Gate at close

- **Cloud:** `gate` + `windows` GREEN on all three PRs; `tracking` red on each, **proven pre-existing by
  name-set identity against main's own run every time** (the 5-test dev-watcher wait-budget cluster).
- **CI-executed evidence:** #979's suites ride `compiler/tests/unit` in the **blocking** `gate` job.
  ⚑ **NOT CI-executed:** the whole `e2e-render-map` tier (#978) — no job runs it
  (`g-e2e-render-map-tier-runs-in-no-ci-job-at-all`, open). #978's evidence is local: 69 pass / 0 fail /
  1116 expect(), reproduced by the PA on the agent's final tip.
- `state --check`, `facts --check`, `delta-lint` PASS at each landing. Delta-log at `[3101]`.
- **Board: HIGH 108 · MED 254 · LOW 98** (boot: 107 · 247 · 96). Filed 1 HIGH · 7 MED · 4 LOW; drained
  2 LOW; narrowed 1 HIGH to its remaining limb. **The rise is the count getting honest** — this session was
  mostly discovery, and the discovery was in instruments that read as done.
- **Maps NOT regenerated** — watermark still `e74f5423` (stale since before S417;
  `g-nav-maps-have-no-scheduled-refresh` open, the nav-map stage is absent from `cloud-maps.yml`). #979
  changed one function's signature in `scripts/`; no new/moved/deleted compiler symbol.
- **Worktrees:** mine cleaned. **Four retained, none mine:** `agent-a0742fe4…`, `agent-a4e6b5f2…`,
  `onmount-c` (`feat/onmount-c-build`, held for bryan's language-surface review), sibling `scrml-pinned`.
- **Outbound:** one drop to bryan this session (the subdir-shell lint routing). **SEVEN peter→bryan drops
  now sit unread.**

---
# scrml — Session 419 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' and is untouched.
>
> ⚑ **SIBLING STATE: CONCURRENT with S418-bryan all session** — his board read LIVE (booted 2026-09-15), no
> wrap commit and no PR from it at S419 close. He RULED four language questions (user-voice-scrml.md S418):
> `E-ASSIGN-003` fires (a) · §49.2.1 braceless loop bodies REFUSED (b) · **UNIFY — the token after a condition
> head's `)` SHALL be `{`** (a, "I like braces") · `E-MU-001` specified as-is (a). **None of the four builds has
> landed. They are HIS.** I touched none of their footprint.
>
> ⚑ **THE S417 PICKUP IS PARTLY SUPERSEDED by those rulings:** its item 2 bullets 1–2 (§34 "do not widen" vs
> the 19-member set; the `>>>=` refusal) and item 4(a) are MOOT — UNIFY deletes the continuation enumeration
> wholesale. Still bryan's and still unruled: the `>>>` tokenizer reorder and `examples/09-error-handling`
> (`fail .SubmitFailed`).

## ⏭ NEXT-SESSION PICKUP

1. **Drain the review floor first — seven sessions running it has returned something real.** It will read
   **7 OWED: #969 (ledger-only carve-out) + #970, #971, #972, #973, #974 (all code-bearing) + this wrap PR.**
   (#968 is recorded.) Classify by running `review-debt.ts`'s `CODE_BEARING_RE` against `gh pr view <n> --json files` —
   never by this hand-off. **Every one of #970–#974 already had a pre-land S239 pass** (#970/#971/#972 by an
   independent adversarial agent + a fix round; #973/#974 PA-verified by execution only, NO independent agent
   — review those two hardest). The floor pass is still owed on all of them; a pre-land pass is not a floor
   record.
   ⚑ **Mutation-bearing reviewers get `isolation: "worktree"`** — and worktrees now WORK on this clone (see 2).

2. ⚑ **ENVIRONMENT, NEW: a tracked filename ≥ ~215 chars disables EVERY worktree dispatch on this Windows
   clone** ("Filename too long" at `git worktree add`). My S417 inbox drop (189 chars) did it; fixed by rename
   in #968. **Keep `handOffs/incoming/` drop slugs SHORT** (date + from/to + ≤5 words; long title goes in
   `subject:`). A failed attempt leaves empty `worktree-agent-*` branches at origin/main — delete them.

3. **Bryan's, and NOT to be built by us** (unchanged + two new routings):
   - the four S418 ruling builds (above);
   - ⚑ NEW — `g-soft-nav-to-an-error-route-hard-navigates-where-spec-20-8-5-5-says-swap-into-outlet` (MED,
     RULING): SPEC §20.8.5(5) says a 404/500 SHALL swap into `<outlet>`; the runtime deliberately hard-navigates
     ("Finding #3", `9b00511b`). Linked to `g-soft-nav-redirect-leaves-orphan-history-entry` (same branch).
     **Do not fix either until he rules.**
   - ⚑ NEW — `g-condition-head-coverage-pin-hand-enumerates-the-operators-it-claims-to-derive` (MED): to be
     REPLACED by a structural pin inside his UNIFY build (inbox drop `2026-09-16-from-S419-peter-to-bryan-unify-build-pin.md`).
     Do NOT patch it.
   - still: `>>>` reorder (`g-multi-ops-first-match-shadows-the-longer-operator`), examples/09 `fail` bare
     variant, the whole S417 list.

4. **Peter-lane MED/LOW candidates left from the S419 triage, already reproduced on HEAD 8c996934** (verify
   again — HEAD moved):
   - `g-e2e-render-map-tier-runs-in-no-ci-job-at-all` (MED, stays open): the false claim was corrected; wiring
     a NON-required job on Linux AND Windows is the remainder — `.github/` is shared infra, so propose it to
     bryan rather than landing it unilaterally.
   - `g-e2e-render-map-baseline-keys-have-drifted-…` (LOW, PARTIAL): detection + temp dir fixed; the baseline
     REGENERATION is owed on a POSIX host after todomvc + 09 are dispositioned.
   - `g-differential-capture-shells-out-to-posix-find-…` (LOW): ⚑ `find` is DELIBERATELY the independent
     second enumerator for HARD REQ 4 — do NOT swap it for the script's own walk.
   - reserves the triage excluded as possibly non-inert (need a direction-of-change call first):
     `g-display-position-call-is-emitted-at-file-scope-and-invoked-again-by-the-render-wiring` (3 calls at boot),
     `g-template-literal-escaped-delimiter-mislowered`, `g-sse-stream-errors-are-swallowed-…`.
   - probably STALE, probe once then close: `g-w-lint-018-false-fires-on-the-sanctioned-generator-surface`.
   - cheap inert cleanups confirmed still real: `g-s320-autoawait-stale-injectpromiseawait-comments`.

5. **STILL NEEDS A POSIX CLONE (unchanged):** `g-todomvc-mount-throw-unclassified`; plus a Linux run of
   `compiler/tests/browser/composed-route-shell-chrome-wiring.browser.test.js` (#972's browser test ran ONLY
   locally on Windows — CI's browser lane did not run it; its integration sibling ran 8/8 in CI).

6. ⛔ **UNCHANGED, CARRIED:** no recovery scan in `collectIfCondition`; do not widen the four `[^>]` marker
   regexes; `bun scripts/types-gate.ts --write` still owed on a clone with an extensionless `tsc`.

7. **Standing from Peter, exercised again:** merge on green without re-asking (re-measure `tracking`'s
   failure NAME-SET against main's run every time — it was the same 5 dev-watcher tests on all 7 PRs this
   session); surface `⛔ BLOCKED BY autoMode — <exact command>` (fired once, `gh pr merge 968`, cleared with
   *"merge 968"*).

## WHAT LANDED

Seven PRs, all gate-green, all merged. **One touched compiler source (#972); the rest are instruments/tests/ledger.**

- **#968** `chore(inbox)` — shortened the 189-char S417 drop that broke every worktree on Windows.
- **#969** `review(s419)` — floor 5 → 0; all three code-bearing PRs (#963–#965, mine) returned a finding; 6 gaps filed.
- **#970** `fix(differential)` — exit 1 means only "differences found"; every one of 12 finding terms has a
  test that dies without it; `gitRevision` refuses a non-toplevel root. 3 MED resolved. Suite 9 → 36.
- **#971** `fix(e2e-render-map)` — multi-file apps compiled the WRONG TREE on Windows and scored green;
  partial seed loss is loud; D6 "empty" means nothing content-bearing rendered. 1 HIGH + 2 MED + 1 LOW. Tier 12 → 47.
- **#972** `fix(composition)` — a subdirectory shell's route pages 404'd its css + bundle, so ALL shell chrome
  reactivity was dead on routes. One path fix in `codegen/index.ts`. 1 HIGH + 2 MED. §40.8.2 conformance restoration.
- **#973** `test(tokenizer)` — the MULTI_OPS ordering pin runs the tokenizer instead of reading array text. 1 MED.
- **#974** `fix(e2e-render-map)` — hidden/script text is not content; orphan baseline cells are named; temp
  dirs under `os.tmpdir()` with cleanup. 1 LOW resolved + 1 LOW partial.

## 🔭 DURABLE

**Every PR I wrote at S417 re-created the class it diagnosed, one level away.** #963 fixed "no test for
exit 1" with a test for ONE of twelve exit-1 causes. #964 normalised `relpath` at the mint site and left
`inputFiles` — the same site minted a second path family. #965 derived nothing it claimed to derive and pinned
array text while calling it behaviour. **When you fix a vacuity, ask what the NEAREST sibling of your own fix
is, and test that too** — it is where the class moves when you push on it.

**A fix can convert a loud failure into a silent green.** Pre-#964 the multi-file apps failed as
HARNESS-ERROR; post-#964 they compiled a different program and scored `renders-empty`, and the delta reported
it as an IMPROVEMENT. A "fix" that makes red go away is not evidence until you check WHAT turned green.

**Two defects filed separately were one bug (#972).** The dead nav href HIGH (filed "locus unknown") and the
404 asset MED shared a root: the shell's wiring lives only in the bundle that 404'd. Nothing was dropped.
**Before building a second fix, execute the page and ask whether the first bug explains the second.**

**A presence check is not a content check.** The first D6 redesign counted element PRESENCE, so a seeded
`<select></select>` — the exact "the seeded loop rendered nothing" bug D6 exists for — scored green. The
adversarial pass caught it; my own read of the design did not.

## ⚑ MISSES (mine)

1. **★★ My S417 drop filename silently disabled all isolation on this clone.** Three dispatches failed at
   worktree creation. Caught immediately, but only because the harness errored; nothing checked it at write time.
2. **★ A `cd` into an agent's worktree moved the harness's primary working directory.** Recovered by
   re-asserting the root; the agent's tree was verified untouched. Use absolute paths / `git -C`, never `cd`.
3. **★ Two shell-escaping failures:** a heredoc (S416/S417's lesson, repeated) and a perl replacement that
   turned `C:\tmp` into a TAB in a ledger note — caught by reading the output, fixed in a follow-up commit.
   Write text to a file first; verify bytes with `od -c`.
4. **★ #973 and #974 landed on PA execution-verification only, no independent adversarial agent** — a
   judgment call for test-only diffs, but S417 showed test-only PRs are exactly where the floor finds things.
   Named in pickup item 1.

## Gate at close

- **Cloud:** `gate` + `windows` GREEN on all 7 PRs; `tracking` red on each, **proven pre-existing by name-set
  identity with main's run every time** (the 5-test dev-watcher wait-budget cluster).
- **CI-executed evidence:** #970's suite ran 36/36 in `tracking` (Linux); #972's integration guard 8/8 in
  `tracking`; #973's pin in `windows`. **Not CI-executed:** the e2e-render-map tier (no job runs it — open
  gap) and #972's browser test.
- `state --check`, `facts --check` PASS at each landing.
- **Board: HIGH 107 · MED 247 · LOW 96** (boot: 108 · 250 · 94). Resolved 12 (2 HIGH · 8 MED · 2 LOW) · filed
  10 (1 HIGH · 5 MED · 4 LOW, counting the #969 six) — net −1 · −3 · +2, reconciled against `state.ts`.
- **Maps NOT regenerated** — watermark still `e74f5423` (stale since before S417; `g-nav-maps-have-no-scheduled-refresh`
  is open and the triage confirmed the nav-map stage is absent from `cloud-maps.yml`). #972 added two
  module-level helpers in `codegen/index.ts` (`toDistRelPath`, `distRelRef`); no file moved.
- **Worktrees:** all this session's cleaned EXCEPT `agent-aba5185b9d1048b0f` (#974's, landed) — LOCKED by the
  agent process at wrap; remove with `git worktree remove -f -f` + `git branch -D worktree-agent-aba5185b9d1048b0f`.
  Pre-existing, not mine: `agent-a0742fe4…`, `agent-a4e6b5f2…`, `onmount-c` (S322 build held for bryan's
  review), sibling `scrml-pinned`; two empty Aug-26 orphan dirs `agent-a04e9c51…` / `agent-ad349cc5…`.
- **Outbound:** one drop to bryan (the UNIFY coverage-pin note, in #969). SIX peter→bryan drops now sit unread.

---

# scrml — Session 417 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S416/S415/S414/
> S413/S412/S411/S410 mine, S405 bryan's) and is untouched.
>
> ⚑ **SIBLING STATE: SOLO all session.** `S407-bryan.md` read **WRAPPED** at boot (2026-09-15). His
> **#962 is OPEN and the merge is his** — it SUPERSEDES #887 and #899, both of which close once it
> lands. All his open PRs (#962, #951, #950, #939/#938/#937, #920/#919/#918, #907/#906/#905) are
> **CLAIMED, not lost.**
>
> ⚑⚑ **DELTA-LOG COLLISION IS ALREADY QUEUED — READ BEFORE MERGING ANYTHING.** This wrap took
> `[3068]`–`[3078]`. **bryan's open #962 also claims `[3068]`–`[3072]`.** Whichever merges second must
> re-run `bun scripts/delta-lint.ts --fix` and resolve `hand-off.md` / `docs/changelog.md` /
> `handOffs/delta-log.md` **by UNION** (all three are append-only). This is the sanctioned
> serialization, not a problem — but it is not automatic.

## ⏭ NEXT-SESSION PICKUP

1. **Drain the review floor first — it is now SIX sessions running that it returned something real, and
   this session it convicted EVERY code-bearing PR on it (4 of 4, zero clean).** The floor will read
   roughly 4 OWED: **#963, #964, #965 and this wrap PR**. Three are test-only; the wrap is a
   carve-out by path.
   ⚑⚑ **DO NOT TRUST A HAND-OFF'S CARVE-OUT CLASSIFICATION — INCLUDING THIS ONE. CHECK THE REGEX.**
   S416's pickup asserted "#956 is the only code-bearing PR; the other four are carve-outs by path."
   That was FALSE: by `review-debt.ts`'s own
   `CODE_BEARING_RE = /^(compiler|stdlib|scripts|lsp|editors|e2e|dashboard)\/|^conformance\//`, **four**
   were code-bearing, and following the hand-off would have hidden a HIGH. Run the regex against
   `gh pr view <n> --json files`; it takes one command.

2. ⚑⚑ **BRYAN'S, AND THE LANGUAGE QUESTIONS ARE NOW A LINKED SET OF FOUR. DO NOT BUILD ANY OF IT.**
   The outbound drop written this session lays all four out:
   `handOffs/incoming/2026-09-15-from-S417-peter-to-bryan-*.md`.
   - **§34 says DO NOT WIDEN, and the live set is already wider** (`g-spec-34-forbids-the-widening-…`).
     `SPEC.md:20218` enumerates 14 members and forbids growth; `ast-builder.js` has 19. Per R4 the SPEC
     wins, so this is a landed change doing what the normative source forbids, justified only in derived
     docs. **This is the blocker for (2b).**
   - **`>>>=` still drops a loop body at exit 0** (`g-condition-head-set-still-misses-the-sixth-merged-run`,
     MED). One token, population measured 0 of 2,553, thirty seconds of work — **and unfixable until the
     §34 sentence is reconciled, because adding it IS the forbidden act.**
   - **`>>>` is structurally unreachable in the tokenizer** (`g-multi-ops-first-match-shadows-the-longer-operator`,
     MED) — the root of `g-unsigned-right-shift-does-not-lower`. The reorder is **newly-accepting** and
     the governing-sentence gate came back EMPTY (**SPEC has no shift-operator grammar at all**), so it
     is a ruling, not a patch.
   - **NEW HIGH — a shipped example has not compiled since S236**
     (`g-examples-09-error-handling-does-not-compile`). `fail .SubmitFailed(...)` draws four
     `E-ERROR-009` whose own message lists `SubmitFailed` as valid. Either §14.10's bare-variant
     inference extends to `fail` position or the example must be qualified — **different languages,
     bryan's call.**
   Everything previously routed is UNCHANGED and still his: the `E-ASSIGN-003` zero-producer root and
   the whole `declaredNames` family · §49.2.1 braceless loop bodies ·
   `g-bare-block-statement-is-silently-dropped` (HIGH) ·
   `g-export-reparse-swallows-ast-builder-parse-path-diagnostics` (HIGH, a 22-file migration) · the
   must-use spec-citation mis-citation · his three #936 findings ·
   `g-library-shadowed-inner-binding-is-a-false-rejection` · the §59 library-mode lowering widening ·
   `E-CONDITION-HEAD-UNPARENTHESIZED` (#945) itself.

3. **THE CHEAPEST REAL ITEM, AND IT NEEDS A POSIX CLONE, NOT A DECISION:**
   `g-todomvc-mount-throw-unclassified` (LOW). #964 made the e2e-render-map tier live and it reported
   `benchmarks/todomvc/app.scrml#empty: renders-clean -> compiles-but-throws`. The file **compiles clean
   (exit 0)**, so the throw is at MOUNT and a happy-dom/Windows cause is not ruled out. **One run of
   `bun test compiler/tests/e2e-render-map/` on a POSIX clone discriminates it.** I deliberately did NOT
   classify it — this tier's first live readings on Windows are not yet trustworthy as regression
   evidence.

4. ⛔ **THREE FIXES WERE DECLINED ON MEASUREMENT. DO NOT "HELPFULLY" LAND THEM.**
   (a) `>>>=` — the §34 prohibition above. (b) the `>>>` reorder — newly-accepting, no governing
   sentence. (c) **the two angle depth-trackers** (`g-angle-depth-trackers-miscount-a-merged-run`, LOW) —
   `ast-builder.js:11742` counts `<`/`>` as brackets and `:3894` does `consumeBalanced("<", ">")`; a
   merged `>>` matches NEITHER branch. **Corpus population is 0** — all 9 textual matches are comments
   or string literals, verified individually. §8: a fix built before the problem is measured has
   unmeasured value.

5. ⛔ **THE VEIN IS CENSUSED — DO NOT RE-EXPLORE IT FROM SCRATCH.** 6 shift operators × 9 syntactic
   positions, 63 compiled cases: **shifts behave correctly in ordinary expression positions.** The
   lexer-merge class is NOT a general expression hazard; it bites ONLY where code does token-text
   SET-MEMBERSHIP or angle DEPTH-COUNTING. 58 token-level angle sites exist and **the raw 325-site
   figure is WORTHLESS** — most are markup tag-scanning where the angle is a delimiter and nothing
   merges. Two pins now make the class self-reporting
   (`condition-head-angle-operator-coverage.test.js`, `tokenizer-multi-ops-ordering.test.js`); both go
   red in BOTH directions, including when the ruling lands and the bug is fixed.

6. ⛔ **UNCHANGED, CARRIED VERBATIM:** do NOT re-add a recovery scan to `collectIfCondition` (three
   bounds built, all three ate or corrupted source; the ⛔ banner in `ast-builder.js` records all three
   by shape — the scan stopping at the `)` is the invariant). Do NOT widen the four surviving `[^>]`
   marker regexes (live miss count measured ZERO again this session).

7. **Other live work, untouched:** `g-emit-if-stmt-with-opts-is-never-reached` (MED) · the two
   pre-existing `.size`/bracket residuals under #952 · the partial-emptiness half of
   `g-e2e-render-map-classifies-renders-empty-as-green` · the newly-filed
   `g-differential-invalid-run-exits-1-…` (MED) and `g-e2e-render-map-d6-keys-on-textcontent-…` (MED).

8. **⛑ STILL OWED and not fixable here:** `bun scripts/types-gate.ts --write` on a clone where it runs.
   This Windows clone has no extensionless `node_modules/.bin/tsc`. Nothing is blocked — the step is
   `continue-on-error: true` inside the non-blocking `tracking` job.

9. **Standing from Peter, unchanged:** merge on green without re-asking; surface `autoMode` blocks as
   `⛔ BLOCKED BY autoMode — <exact command>` and do not engineer around them. Fired once this session
   (`gh pr merge 963`), cleared with *"merge both"*.
   ⚑ **NEW, environment:** the bun memory sentinel was **hidden, not discontinued** — Peter asked
   whether it was still needed, and the answer was yes but for a narrower reason than "just in case".
   Its task now launches via `wscript.exe //nologo run-hidden.vbs` (a windowless host) instead of
   `powershell.exe` under an INTERACTIVE principal. It had been giving him a logon popup whose closure
   sent Ctrl+C and killed the guard (`LastTaskResult 0xC000013A`) — cost with no protection. Changing
   the task PRINCIPAL to session 0 needs elevation; changing the ACTION does not. Verified running,
   windowless, PID logged.

## WHAT LANDED

**Three PRs, all gate-green, all merged, and ALL TEST-ONLY — no compiler source changed this session.**

- **#963 `fix(differential)`** — the gate's primary verdict had no test, and the header's boast about it
  was vacuously true.
- **#964 `fix(e2e-render-map)`** — the tier was a silent no-op on every Windows clone, and it reported 12/0.
- **#965 `test(lexer-merge)`** — pin the class rediscovered four times, and root-cause the fifth.

## 🔭 DURABLE

**A claim quantified over "every case that X" is satisfied for free when no case does X.** #957's header
asserted *"every case that carries a real recorded difference asserts a NON-zero exit"* — and there were
no such cases. One `toBe(0)`, six `toBe(2)`, zero `toBe(1)`. The sentence read as a guarantee and cost
nothing to satisfy. **Check the population before trusting the property.** This is the vacuity sibling
of S416's "a green test can be the bug", and it is cheaper to detect: count the subjects.

**A test whose subject population can silently empty is a test that will pass by asserting nothing.**
`e2e-render-map.test.js:113` executed ZERO `expect()` calls on every Windows clone and was green. The
fix is not better inputs — it is asserting the population is non-empty FIRST, because otherwise **the
only signal that a test stopped testing anything is that it kept passing.**

**Normalise at the MINT SITE, not at the consumer.** One `path.relative` producing win32 separators
made a whole tier inert: `tierOf`, `classifyApp`, the multi-file detector, `seedFor` and all 438
baseline keys each assumed POSIX, and each would have needed its own patch. The separator is a property
of how the path was MADE. A per-consumer fix leaves the next consumer to find.

**⚑ The best find of the session came from proving a pin bites, not from the pin.** Mutating the
tokenizer to check that the drift detector went red surfaced that `">>"` precedes `">>>"` in a
first-match-wins list whose comment claims "longest first" — so `>>>` is structurally unreachable, which
is the ROOT of a gap filed against a different file with the note "the precise lowering site was NOT
traced". **The bite proof is not ceremony; it executes the code from an angle the happy path never
does.**

**Derive the list, or the list drifts from its own source of truth.** `CONDITION_HEAD_CONTINUATION_PUNCT`
is hand-enumerated from reported symptoms while `tokenizer.ts` MULTI_OPS holds the truth and lists the
three shift-assigns adjacent on one line. #956 took two and left one. Four sessions found four instances
of this class by accident; a derivation would have found the fifth on the day it was introduced.

## ⚑ MISSES (mine)

1. **★★★ I violated the ingestion-disjoint invariant** (`pa-base` §7). Four adversarial reviewers into
   ONE non-isolated checkout: #957's mutated `scripts/corpus-emit-differential.ts` to prove gate bite
   while #959's read `git status` and saw a phantom syntax-broken file appear and vanish. Each restored
   by file-copy and the tree verified clean — **luck, not design.** Mutation-bearing reviews need
   `isolation: "worktree"` or serialization; read-only ones are correctly exempt.
2. **★★ My derived-cell probe row was contaminated and I nearly read it as a finding.** `E-DG-002` fired
   on the CONTROL too, so the whole row was a second, unrelated failure. Caught only because I had put a
   control in. **A probe that fails for the wrong reason reads exactly like a confirmed hypothesis** —
   third session running that this exact shape has bitten.
3. **★ Two shell failures cost round-trips**: a quoted heredoc that broke on an unmatched quote (checked
   the file was untouched before retrying — it was), and a Python one-liner handed an MSYS `/c/...` path
   it cannot resolve. The heredoc lesson is S416's, repeated; I should have gone to a file first.
4. **★ I rendered the first census matrix with `codes[0]`**, which showed a WARNING where an error
   followed, and briefly mis-read the `>>>` row. Corrected by re-rendering with the full code list.

## Gate at close

- **Cloud gate GREEN on all three PRs** (`gate` + `windows`). `tracking` red on each and **proven
  pre-existing every time by name-set comparison against main's own run** — the identical 5-name
  dev-watcher wait-budget cluster, homed at `g-dev-server-tests-expire-their-wait-budgets-in-cloud-ci-only`.
  Re-measured per PR, three times; never inherited.
- **Local:** `corpus-emit-differential-exit-codes` 9/0 · e2e-render-map tier 12/0 (**912 expect() calls**,
  from 0 comparisons) · both new pins + the two sibling condition-head suites 101/0.
- `facts --check`, `state --check`, `regen-spec-index --check` — all PASS. `delta-lint` PASS at `[3078]`.
- **Board: HIGH 108 · MED 250 · LOW 94** (+1/+5/+2 = the 8 filed). Review floor drained **7 → 0**.
- **Maps NOT regenerated** — watermark `e74f5423`, already stale before this session
  (`g-nav-maps-have-no-scheduled-refresh`). **This session added ZERO navigable structure**: no compiler
  source touched, three new test files, no new/moved/deleted symbol.
- **Worktrees — four retained, NONE this session's.** `agent-a0742fe4795045e91`,
  `agent-a4e6b5f2562ae9eaa`, `onmount-c` (`feat/onmount-c-build` — the S322 build held pending bryan's
  language-surface review, retained deliberately) and the sibling `scrml-pinned` (`app-pinned` @
  `8f3c5b74`). I created none.
- **Outbound:** one drop to bryan this session. **FIVE outbound drops now sit unread** (S412, S413,
  S415, S416, S417).

---

# scrml — Session 416 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S415/S414/S413/
> S412/S411/S410 mine, S405 bryan's) and is untouched.
>
> ⚑ **SIBLING STATE: bryan not live during this session, but his wrap PR is still open.** His newest
> activity is **2026-09-14T04:37Z** (#951), ~23h before this wrap; he landed nothing on scrml `main`
> and nothing measured here was affected. **#951 is a WRAP PR and will touch `hand-off.md`,
> `docs/changelog.md` and `handOffs/delta-log.md` — the same three files as this wrap.** Branch
> protection (`strict:true`) forces the second PR to rebase, which is the sanctioned serialization:
> **resolve by UNION** (all three are append-only) and re-run `bun scripts/delta-lint.ts --fix` if the
> sequence collides. His open PRs — #950/#951, #937/#938/#939, #899/#905/#906/#907/#918/#919/#920 —
> are CLAIMED, not lost.

## ⏭ NEXT-SESSION PICKUP

1. **Review floor reads 5 OWED, and all five are THIS session's own landings** — #955, #956, #957,
   #958, #959. Per the #890 marker a drain PR's review rides the NEXT landing, so this is the
   rolling floor working as designed, not debt I left. **Discharge it first**: it is the established
   opener and it has returned a real finding on every one of the last five sessions, including this
   one (#952's blanking claim, and the `E-ASSIGN-003` root under a whole gap family before that).
   ⚑ Note for the drain: **#956 is the only code-bearing PR in the set** — the other four are
   docs/instrument-only and are carve-outs by path, so the code-bearing carve-out rate stays the
   health signal.

2. ⚑⚑ **STILL BRYAN'S, UNCHANGED, DO NOT BUILD ANY OF IT.** The `E-ASSIGN-003` zero-producer root
   (SPEC §50.9 SHALL at `:27867`, §34 row `:20059`, §50.8.4 at `:28008`, plus `:28048` and `:28187`
   that the routing note never cited) and the whole `declaredNames` family hanging off it
   (`g-try-catch-finally-bodies-redeclare-every-assignment` HIGH ·
   `g-match-arm-bodies-share-one-declarednames-set` MED · `g-loop-head-binding-is-not-tracked` MED),
   with #947's tests pinning the non-conformant side. Also unchanged: §49.2.1 braceless loop bodies ·
   `g-bare-block-statement-is-silently-dropped` (HIGH) ·
   `g-export-reparse-swallows-ast-builder-parse-path-diagnostics` (HIGH, a 22-file migration) · the
   must-use spec-citation mis-citation · his three #936 findings ·
   `g-library-shadowed-inner-binding-is-a-false-rejection` (MED) · the §59 library-mode lowering
   widening.
   ⚑ **NEW THIS SESSION AND OWED TO HIM:** `E-CONDITION-HEAD-UNPARENTHESIZED` (#945) is still
   OUTSTANDING, and **#956 widened its enforcement set** — newly-rejecting, so it owes a
   language-surface review. **If he rules the diagnostic away, #956's widening goes with it.**
   Outbound drop written this session:
   `handOffs/incoming/2026-09-14-2340-from-S416-peter-to-bryan-*.md`.

3. **THE SESSION'S FINDING, AND IT IS THE REASON THE MED COUNT WENT UP:** four separate instruments
   turned out to *exist, read as done in the ledger, and never be consulted.* This is now a named
   class, and the next instrument arc should open by asking "is it invoked?" before "is it correct?":
   - **`g-emit-differential-hardening-never-reached-main` (MED, NEW)** — the landing gate cited as
     evidence in compiler PRs (including #956 this session) is missing **HARD REQ 8, 9, 9.1, 10, 11**
     and ~1,250 LOC; `reverify`/`FLAKE_DEMOTION_RULE` **0 on main / 63 on the branch**. Branch
     `origin/worktree-agent-ab7336c5da32f10ed` is 415 commits behind with 11 not in main — **a PORT,
     not a merge**, and its own arc.
   - **`g-e2e-render-map-tier-runs-in-no-ci-job-at-all` (MED, NEW)** — the only tier that mounts the
     corpus and reads the DOM is in **no** workflow, package script or hook. Everything else filed
     against that tier sits under this ceiling.
   - **`g-e2e-render-map-with-data-coverage-is-four-of-438` (MED, NEW)** — the detector class that
     finds the board bug can only run on **4 of 438** cells.
   - **`g-corpus-emit-differential-does-not-detect-a-rootless-compiler-root` (MED, NEW)** — split out
     when the "any two checkouts" framing was narrowed to "needs a rootless side".

4. **THE CHEAPEST REAL ITEM LEFT, and it is genuinely bounded:** make `scripts/boot.ts` importable —
   **0 `export`s, no `import.meta.main` guard, ~115 lines of top-level execution from `:325`** (sync,
   probes, printing, `process.exit`), so importing it runs the whole boot digest. That is the ONLY
   reason its `@ledger` parser (`:173`) is the unpinned fifth in
   `compiler/tests/unit/marker-parser-pins.test.js`. Wrap-the-tail restructure, mechanical, **verify
   by diffing `bun scripts/boot.ts` output before/after**. Deliberately not folded into #959 because a
   mistake there is paid at every future boot.

5. ⛔ **DO NOT WIDEN THE FOUR SURVIVING `[^>]` MARKER REGEXES** (`state.ts:248`, `boot.ts:173`,
   `corpus-zero-debt.ts:145`, flograph `NODE_RE`). Measured this session: **live miss count ZERO**
   (the only 2 misses in `known-gaps.md` are prose lines documenting the marker format), and widening
   `flograph` would admit documentation **templates** (`<!-- @node id=<kebab-id> kind=<kind> -->`) as
   real graph nodes — the same shape as one of S378's five reverted rounds. Both facts are now pinned
   as tests. The harness exists; the widening still needs a reason, and there isn't one yet.

6. ⛔ **DO NOT RE-ADD A RECOVERY SCAN TO `collectIfCondition`.** Carried verbatim from S414/S415:
   three separate bounds were built and all three ate or corrupted source; the ⛔ banner in
   `ast-builder.js` records all three by shape. The scan stopping at the `)` is the invariant.

7. **Other live work, untouched:** `g-emit-if-stmt-with-opts-is-never-reached` (MED) · the two
   pre-existing `.size`/bracket residuals under #952 (both need the receiver's TYPE) ·
   `g-unsigned-right-shift-does-not-lower` (LOW, NEW — `>>>` is unusable anywhere in a scrml
   expression; fails LOUDLY so nothing silent ships) · the partial-emptiness half of
   `g-e2e-render-map-classifies-renders-empty-as-green`, which needs per-cell expected-content.

8. **⛑ STILL OWED and not fixable here:** `bun scripts/types-gate.ts --write` on a clone where it
   runs. This Windows clone has no extensionless `node_modules/.bin/tsc`. Nothing is blocked — the
   step is `continue-on-error: true` inside the non-blocking `tracking` job.

9. **Standing from Peter, unchanged:** merge on green without re-asking; surface `autoMode` blocks as
   `⛔ BLOCKED BY autoMode — <exact command>` rather than engineering around them. One block fired
   this session (`gh pr merge 955`) and he cleared it with *"merge"*.

## WHAT LANDED

Five PRs, all gate-green, all merged and re-verified on the merged trunk.

- **#955 `review(s416)`** — the review floor drained 4 → 0.
- **#956 `fix(§50.2.3)`** — five merged angle runs escaped `E-CONDITION-HEAD-UNPARENTHESIZED`.
- **#957 `fix(differential)`** — the landing gate had no test surface on main, and the ledger said it did.
- **#958 `fix(e2e-render-map)`** — the gate detected the board-bug class and scored it as a pass.
- **#959 `fix(instruments)`** — the five marker parsers get their import-and-pin harness.

## 🔭 DURABLE

**The class this session found, stated once: an instrument that EXISTS and is never CONSULTED reads
identically to one that works.** Four independent instances, none of which looked broken:

- a test rig the ledger recorded as landed, which lived only on an unmerged agent branch;
- a detector (`S-EMPTY-WITH-DATA`) that fires correctly and has its answer classified GREEN;
- a `RENDER_STATES` vocabulary whose own comment says "for baseline schema validation", with exactly
  one occurrence in the repo — its definition;
- a whole tier that no CI job runs.

The diagnostic question is **"is it invoked?"**, and it is cheaper than checking correctness. Three of
the four were found by asking it almost by accident — #958's CI finding came from wondering whether my
own fix would be exercised.

**The corollary that cost the most to learn: a green test can be the bug.** `detector-validation`'s G4
(*"a DETERMINISM run never demotes"*) PASSED on main and was dropped anyway — it passed against a
script with no demotion machinery to exercise. Keeping it would have overstated coverage with a test
that cannot fail. **Check what a green test would have to do to go red.**

**And the method that made #959 worth landing: prove the harness bites.** The gap's stated blocker was
that a test for those scripts *"tests a reimplementation and passes with the fix reverted."* So the
harness was verified by mutation — revert both landed fixes, confirm 3 red / 8 green with the
survivors being exactly the controls. Without that step it would have been another instrument nobody
can trust.

## ⚑ MISSES (mine)

- **I reported "the fold didn't re-trigger the gate" one step too early on #958.** `gh pr checks`
  returned "no checks reported" while the run was still QUEUED; the fold had worked. Corrected in the
  next turn. **The lesson is the check, not the claim**: `gh pr checks` races a queued run — confirm
  against `gh run list --branch <b>` before concluding a trigger failed.
- **My first #952 escape probe used `export fn`, which hit a different known gap** (the export
  re-parse swallow) and made the in-set control look broken too. The repro was only decisive once I
  re-ran it non-exported. A probe that fails for a second, unrelated reason reads exactly like a
  confirmed hypothesis.
- **Two heredoc quoting failures and one Python escape bug** cost round-trips; the escape bug silently
  applied NO mutation and produced a green run I nearly believed. Caught because the mutation was
  *supposed* to go red — the expectation is what saved it.

## Gate at close

- **Cloud gate GREEN on all five PRs** (`gate` + `windows` pass on each). `tracking` red on every one
  and **proven pre-existing each time by name-set comparison against main's own run** — the identical
  5-name dev-watcher wait-budget cluster, homed at
  `g-dev-server-tests-expire-their-wait-budgets-in-cloud-ci-only`. Never assumed; re-measured per PR.
- **Local on merged main:** `marker-parser-pins` 11/0 · `condition-head-merged-shift-runs` 29/0 ·
  e2e-render-map tier 12/0 · `corpus-emit-differential-exit-codes` 7/0 · the seven condition-head
  sibling suites 137/0.
- **Full local `unit + conformance` (the blocking gate's own targets) on merged main: 20,341 pass ·
  47 skip · 6 todo · 2 fail**, 1,100 files, ~411 s. ⚠ **The fail count is NOT stable — two identical
  back-to-back runs returned 3 and then 2**, which is the flake signature, and the named cases are
  `CONF-W5B-IN-PROCESS-DB-LIBRARY` and the corpus-bridge `print/tool-println-clean-stdout` — both
  tool/stdout runtime cases. **W5B PASSES STANDALONE (1/0, 437 ms)**, so this is the co-run flake this
  clone is known for, not a regression: the cloud gate runs the IDENTICAL targets and was GREEN on all
  five PRs. ⛑ Stated as measured rather than filed under "known baseline" — I verified ONE of the two
  standalone, not both, and the second needs the corpus bridge to run in isolation.
- **Corpus emit-differential** (#956): 1,928 sources / 7,467 artifacts — 0 newly failing, 0 newly
  passing, **0 diagnostic-CODE changes, 0 artifact content diffs**, 0 syntax delta.
- `delta-lint` PASS at max `[3060]`; `facts --check` and `state --check` both PASS.
- **Board: HIGH 107 · MED 245 · LOW 92.** MED rose 4 across the session (4 filed, 1 resolved, 3
  partially). ⚑ That is the count getting HONEST: five previously-filed entries pointed at code that
  does not exist on `main`, and are now corrected in place.

**Maps — NOT regenerated, and the reason is measured, not a skip.** The watermark is `e74f5423`, which
was **already stale before this session** (`g-nav-maps-have-no-scheduled-refresh`, MED, open — the
`cloud-maps` Stage-2 mapper leg was removed at S310 as a cost decision, so nothing refreshes
`.claude/maps/` on a schedule; the daily cron runs only the deterministic `@generated` rollup, which is
why #954 landed as a single `recent-sessions` line under a commit titled *"scheduled nav-map +
@generated regen"*). **This session added no navigable structure**: the whole `compiler/src` delta is
+39 lines in `ast-builder.js` — a comment block plus five `Set` members — with no new, moved or deleted
symbol; the two new files are TESTS. A mapper run here would refresh 100+ commits of unrelated drift
under a wrap that did not cause it.

**Worktrees — four retained, none this session's.** `.claude/worktrees/agent-a0742fe4795045e91`,
`.claude/worktrees/agent-a4e6b5f2562ae9eaa`, `.claude/worktrees/onmount-c` (`feat/onmount-c-build`) and
the sibling `scrml-pinned` (`app-pinned` @ `8f3c5b74`). The one worktree I created — the corpus
differential's base side at `/c/wt-fp/s416base` — was removed and pruned when #956's differential
finished. ⚠ `onmount-c` is the S322 build that stopped before its PR pending bryan's language-surface
review; it is RETAINED deliberately.

**Outbound:** one drop written to bryan this session —
`handOffs/incoming/2026-09-14-2340-from-S416-peter-to-bryan-a-diagnostic-set-widened-under-an-unruled-code-and-a-gate-whose-hardening-never-landed.md`.
**Four outbound drops to bryan now sit unread** (S412, S413, S415, S416).

---

# scrml — Session 415 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S414/S413/S412/
> S411/S410 mine, S405 bryan's) and is untouched.
>
> ⚑⚑ **CORRECTED AT WRAP — BRYAN WAS A LIVE SIBLING AFTER ALL, and my boot-time read was stale.** At
> boot his newest activity read 2026-09-12 20:49Z (#939) and I recorded "no LIVE sibling". **He was
> active concurrently:** he pushed `board(s409): WRAPPED` to scrml-support at **22:38Z** (my own
> support push was REJECTED on it and rebased cleanly — disjoint files) and opened **two new PRs,
> #950 (dpa-045 round-2) and #951 (wrap(s409)), at 04:32Z / 04:37Z.** He landed NOTHING on scrml
> `main` during the session, so nothing I measured was affected.
>
> ⚑ **COLLISION SURFACE FOR WHOEVER MERGES SECOND:** his **#951 is a WRAP PR** and will touch
> `hand-off.md`, `docs/changelog.md` and `handOffs/delta-log.md` — the same continuity files as this
> wrap. Branch protection (`strict:true`) forces the second PR to rebase, which is the sanctioned
> serialization, so **resolve by UNION** (all three are append-only) and re-run
> `bun scripts/delta-lint.ts --fix` if the sequence collides — the S408 precedent, where `--fix`
> correctly renumbered MY side because his were already pushed.
>
> His surfaces (`ci.yml`, `dpa-debt.ts`, `regen-spec-index.ts`, `SPEC-INDEX.md`, `dpa-queue.md`, the
> review lane in `pr-reviews.md`) were **never touched** by me. His open PRs — now
> **#950/#951** plus #937/#938/#939 and #899/#905/#906/#907/#918/#919/#920 — are CLAIMED, not lost. Full mechanical detail: `docs/changelog.md` S415 block and delta-log `[3028]`–`[3036]`.

## ⏭ NEXT-SESSION PICKUP

1. **Review floor reads 2 OWED — #949 and #952, both this session's.** Per the #890 marker a drain
   PR's review **rides the NEXT landing**. Discharge first; this is the established opener and it has
   returned a real finding on every one of the last four sessions.

2. ⚑⚑ **THE ROOT UNDER THE WHOLE `declaredNames` FAMILY IS NOW NAMED, AND IT IS BRYAN'S. DO NOT BUILD
   ANY OF IT.** `g-e-assign-003-has-zero-producers-so-a-write-to-an-undeclared-name-runs-silently`
   (HIGH). SPEC §50.9 (`:27867`) says in a **SHALL** that an assignment-expression lvalue must be
   declared and that an undeclared one **is `E-ASSIGN-003`**; there is a §34 row (`:20059`) and a
   dedicated §50.8.4 subsection (`:28008`) with the message text. **`grep -rl 'E-ASSIGN-003'` over
   `compiler/src/` + `compiler/native-parser/` returns 0 files** — reach controls fire (`W-ASSIGN-001`
   = 1, `E-SCOPE-001` = 22). The emitter's declaration-by-bare-assignment behaviour is documented ONLY
   in a code comment (`emit-logic.ts` ~:2071–2079). **So the family below is one question — which of
   the two is the language — not four codegen patches.** Routed to bryan in
   `handOffs/incoming/2026-09-13-2330-from-S415-peter-to-bryan-…`.
   Hanging off it, all filed, none fixed by threading the Set in:
   `g-try-catch-finally-bodies-redeclare-every-assignment` (HIGH) ·
   `g-match-arm-bodies-share-one-declarednames-set…` (MED) ·
   `g-loop-head-binding-is-not-tracked…` (MED).
   ⚑ **And #947's tests PIN the non-conformant side** (`"abQ"` across four programs whose SPEC-correct
   outcome is a diagnostic). Do not "fix" the tests either — that is the same ruling.

3. ⚑⚑ **THE REST OF THE BRYAN-GATED LIST, unchanged plus two new.** Do not build any of it.
   - §49.2.1 **braceless loop bodies** (the S413 fork, routed, still unruled). Two gaps hang off it,
     and `g-do-while-head-continuation-is-accepted-while-the-while-form-is-now-rejected` (LOW, NEW) is
     plausibly the same ruling.
   - `g-bare-block-statement-is-silently-dropped` (HIGH) · `g-export-reparse-swallows-ast-builder-parse-path-diagnostics`
     (HIGH — closing it is a **MIGRATION**, 22 of 2,552 files newly error, ten of them shipped stdlib).
   - The **must-use spec-citation** ruling (§48.3.3 is a mis-citation; no governing sentence exists).
   - His **three #936 findings** (dpa-debt fails toward HIDING debt; the currency gate cannot see a
     duplicated table; six "closed on merge" PRs are all still open).
   - `E-CONDITION-HEAD-UNPARENTHESIZED` (#945) — **still OUTSTANDING**, carried from S414.
   - ⚑ **NEW:** `g-library-shadowed-inner-binding-is-a-false-rejection` (MED) — #952 knowingly
     refuses a program that previously ran. Landed with the stamp OUTSTANDING.
   - ⚑ **NEW:** the §59 **library-mode lowering widening** — #952 restored the fail-closed guard but
     did NOT make library mode lower the surface. `containsIndexExpr`'s own comment routes that to him
     verbatim as *"a language question about what boundary a library module is."* It stays routed.

4. **THE CHEAPEST DRAINABLE ITEM ON THE BOARD, and it closes a live silent infinite loop:**
   `g-condition-head-continuation-set-misses-every-merged-shift-run-token` (MED).
   `continuesConditionHead` tests **exact token-TEXT equality** against a 14-member set whose only
   angle members are `<` `<=` `>` `>=`, and **the lexer merges angle runs into ONE token**, so `>>`
   `>>>` `>>=` `<<` `<<=` escape. `while (n + 1) >> 2 { … }` compiles at exit 0, drops the body, and
   loops forever — the exact symptom #945 is named after, surviving its own fix. PA-reproduced with a
   firing `< 2` control. ⚑ **Third instance of the lexer-merge class here** (memory
   `scrml-lexer-merges-gt-runs-single-token` carries all three and both failure shapes). The five
   spellings are strictly BINARY — none can begin a statement — so unlike `<` (markup), `/` (regex) or
   `+`/`-` (unary prefix) they carry **no false-rejection risk**. Measure the population before
   landing anyway; it mints nothing but it widens what an existing diagnostic refuses, so it owes a
   surface review like #945 itself.

5. **Other live work, untouched this session:**
   `g-emit-if-stmt-with-opts-is-never-reached-and-its-half-of-the-947-fix-is-unpinned` (MED — 0 calls
   over 961 corpus sources with the control firing at 72; either find the reaching shape and pin it,
   or establish it is unreachable and delete it) · the two pre-existing `.size`/bracket residuals under
   #952 (both need the receiver's TYPE, not a walk or a scan).

6. ⚑ **DO NOT RE-ADD A RECOVERY SCAN TO `collectIfCondition`.** Carried verbatim from S414: three
   separate bounds were built and all three ate or corrupted source; the ⛔ banner in `ast-builder.js`
   records all three by shape. The scan stopping at the `)` is the invariant.

7. **⛑ STILL OWED and not fixable here:** `bun scripts/types-gate.ts --write` on a clone where it
   runs. This Windows clone has no extensionless `node_modules/.bin/tsc` (verified: `tsc.exe` +
   `tsc.bunx` only). Nothing is blocked — the step is `continue-on-error: true` inside the
   non-blocking `tracking` job, PA-verified this session.

8. **Standing from Peter, unchanged:** merge on green without re-asking; surface `autoMode` blocks as
   `⛔ BLOCKED BY autoMode — <exact command>` rather than engineering around them. One block fired
   this session (`gh pr merge 949`) and he cleared it with *"merge when green"*.

## WHAT LANDED

**Two PRs, both gate-green — #949 · #952.** Board **HIGH 107 → 107 · MED 237 → 242 · LOW 88 → 91**
(one HIGH resolved, one HIGH filed; nine gaps filed total). Counts are generated — read
`docs/known-gaps.md`, never this line. Review floor drained **5 → 0**, then re-incurred its own 2.

## 🔭 DURABLE

**When two rounds of a fix each produce a defect in the OPPOSITE direction, the shape is wrong, not
the bound.** `g-library` round 1 was receiver-BLIND → it refused valid programs. Round 2 was
receiver-SCOPED → it un-refused a class the base compiler caught, shipping `undefined` from a loud
refusal. The root was one policy over two different kinds of thing: **`[` is a syntactic FORM** (blind
is correct, and is what base did) while **`.size` and the method names are IDENTIFIERS** (scoping is
mandatory or they collide with ordinary struct fields). Splitting the axis made both right. The
S414 sibling rule — *when the same class recurs three times, delete the code rather than bound it
again* — has a companion: **when the error keeps flipping sides, split the axis.**

**A mutant cannot kill a behaviour the suite never expresses.** Round 2's suite survived SEVEN mutants
and still shipped a HIGH, because every residual test wrote `return n.size` where `return n["k"]`
would have failed, and the comment asserted the whole receiver class was "already silent-wrong at
base" — true of `.size`, **false of the bracket form**, which base refused. That is a COVERAGE gap, not
a strength gap, and mutation testing is structurally blind to it. **Collapsing a per-FORM distinction
in a comment is what hid it.**

**An adversarial pass on your own pipeline earns its keep twice over.** The first pass on #945/#947
found a MED and a HIGH in my own landings; the pass on the g-library fix found a regression the fix
introduced; the re-review found a second one the FIX ROUND introduced. Every round that skipped
straight to landing would have shipped something. **The review that found a defect is the argument for
running the next one, not evidence the process is working well enough to stop.**

**Reading a locus is not reading its mechanism.** I told Peter the "what boundary is a library module"
question was moot because the map literal already lowers there. The fact was right; the inference was
too fast. Reading `emit-library.ts:949` showed the literal lowers only for fns the guard lets through,
so the routing stood and the real finding was that the guard's detection axis was one node kind wide.
**I had the guard's own comment in hand and summarized from the fact instead of the mechanism.**

## ⚑ MISSES (mine)

1. **★★★ The gap entry warned me about match arms and I did not carry it into the brief.** The
   `g-library` entry says outright that arms are `rawArms: string[]` and *"an AST walk cannot see
   it"*, naming it the same class as the S392 `if-chain` finding. I read that entry, quoted other
   parts of it, and still dispatched an AST-walk fix. The reviewer rediscovered it from scratch —
   13 of 14 shapes escaping — and it falsified the fix's central claim.
2. **★★★ I told Peter the boundary question was moot on an inference I had not checked** (above).
   Corrected in the next message, but it had already shaped the dispatch.
3. **★★ I described the measured matrix as "8 silent-wrong shapes."** Only `.size` is silent-wrong;
   the methods throw `TypeError` at call time — **the gap entry had it right and I overstated it**.
   The build agent caught me. It weakens the fix's value from "closes silent-wrong" to mostly
   "loud-late → loud-early", and Peter got the corrected version.
4. **★★ My fix-round brief contained a requirement that was wrong on the facts.** I asked for peer-call
   and parameter bracket receivers to REFUSE, believing base refused them; base refused only the
   ALIAS. Meeting it literally would have refused every `xs[0]` in every map-free library fn. The agent
   declined with a measurement and was right to.
5. **★ A heredoc with six long marker lines failed to parse and wrote nothing** — caught by checking
   the line count before and after, exactly as the S413 entry says to. Re-done via a file write. Second
   session running for this failure mode; **build the string in a file, then append.**
6. **★ I read a truncated gate banner and nearly took it as a pass.** `facts --check` prints a banner
   line that survives `tail` while the verdict does not; re-running with an explicit exit-code check
   showed **exit 1**. Separate the exit status from the output — the contract says so and I had just
   briefed two agents on it.

## Gate at close

Cloud `gate` **GREEN** on #949 and #952; `windows` green. `tracking` **RED — proven pre-existing by
NAME-SET comparison**: the five dev-watcher/hot-reload names are identical in **both** directions
against #949's own run, which was docs-only and therefore free of compiler-source influence. That
comparison mattered because #952 touches compiler source.

Local on merged main (`8ef61bbf`): conformance **905/905**; the new unit file **78 tests / 0 fail /
150 expect()**; `delta-lint` PASS at max `[3036]`; `state --check`, `facts --check` and
`regen-spec-index --check` all **exit 0** (facts needed a regen — the source change moved the LOC
figures). R26 on merged main: `.size`, match-arm `.size` and the async bracket read all REFUSE;
`o.m.size`, the struct-field collision and construct-only all COMPILE and return correct values.

**Maps (wrap 6c) — NOT hand-run, deliberately.** Owned by the scheduled `cloud-maps` workflow; a wrap
cannot contain its own squash SHA. ⚑ **One map finding worth acting on:** both S239 reviewers reported
`primary.map.md` **not load-bearing** (it self-declares `router-lag`), but the g-library build agent
found `domain.map.md` **WAS** load-bearing twice — its §21.5/§44.7.1 and §59/§52 sections named
`rawFallbackReason`'s ruled trade and `mapSetLoweringBoundaryOk`'s Part A safety argument. Line
references had drifted; symbol names were exact. **The ROUTER is the broken part, not the maps.**

**Worktrees — three removed, four retained.** This session's dispatch worktree landed via #952 and was
removed (branch deleted, pruned), as were the two base worktrees cut for the review A/Bs
(`C:/s415base945`, `C:/s415base947`). Four remain and **none is this session's**:
`agent-a0742fe4795045e91`, `agent-a4e6b5f2562ae9eaa`, `onmount-c`, plus the `scrml-pinned` app clone.

**Inbox:** nothing inbound. **Three** outbound drops to bryan now sit unread — S412's (stdlib
source-mirror correction + the self-host coverage hole), S413's (the §49.2.1 fork + his three #936
findings), and **S415's new one** (the `E-ASSIGN-003` ruling + two owed language-surface reviews +
the unchanged §59 routing). All three deliberately left in place.

# scrml — Session 409 (bryan · ASUS-Vivobook) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the `---` is prior sessions' and is untouched,
> per the S408-peter precedent (the S401→S400 wholesale rewrite ate a collaborator's pickup section).

**Date:** 2026-09-08 → 09-13. Booted `/boot` Profile A onto `e1a12848`. **Ran across five calendar
days behind a merge gate**; S410/S411/S412/S413/S414/S415-peter all landed while this session's work
sat in open PRs. Mechanical state — landings, counts, the stream — is in `docs/changelog.md` and
`handOffs/delta-log.md`. This file carries only what those cannot.

**The framing: four rulings banked, a five-day-old conflict cleared off main, a test directory that
ran in NO job now gated — and FOURTEEN instruments that read clean while measuring the wrong thing,
five of them mine.**

---

## ⚑⚑ THE DURABLE FINDING — unratified, and the reason to read this file

> **Co-mention in a justification is not co-membership in its evidence.**

`compiler/tests/self-host` was excluded from every CI job for a year. The stated reason:

> *"the self-host tests (`compiler/tests/self-host` AND `integration/self-host-smoke.test.js`) need a
> locally-built, gitignored dist that CANNOT be rebuilt on a clean checkout"*

**It was never measured for the first of those two.** It was named in the same breath as a file for
which the claim was true, and inherited that file's exclusion by grammatical proximity. Measured at
S409: with the dist removed entirely, the tier runs **139 pass / 122 skip / 3 fail in under 0.6s**,
identical failure name set. It compiles its inputs at test time and never reads a built dist at all.

That is not a wrong measurement. It is a **never-taken** measurement, propagated as though taken,
because one sentence covered two subjects. The cost was the **82 GB host lockup** (#924): a defect
that mangled a regex on *every* platform lived only in that directory, so it reached a machine
instead of a gate.

⚑ **This is distinct from "verify your findings."** There was no finding to verify — there was a
conjunction. The check it implies: *when a justification names more than one subject, which of them
was actually measured?*

---

## ⚑ THE SESSION'S SPINE — fourteen instruments, every one reading clean

Not a list of mistakes; a measurement of the measurement surface. Five are mine, three are agents',
and the rest were already shipped and load-bearing.

| # | instrument | what it actually measured |
|---|---|---|
| 1 | CI's "SPEC-INDEX totals gate" | the two totals numbers — **passed on a file with 3 conflict markers and 117 duplicated rows** |
| 2 | my replacement row-check | **14 of 71 rows** — the marker ended the table scan, and it reported "all current" |
| 3 | `dpa-debt.ts` cell-split | the empty string between a `\|\|` inside a quoted source string — **a ruling was invisible** |
| 4 | my `origin/main...branch` (three-dot) | the merge base, not main's tip — **#902 and #888 read as live; both were no-ops** |
| 5 | my locus-resolution probe | paths with `(symbol` suffixes attached — **3 false MISSING** |
| 6 | my three severity greps | three different answers (`@gap` markers contain `>`) |
| 7 | agent's reference sweep | `head -30`, and `scripts/` sorts after `docs/` — **7 stale pointers past the cut** |
| 8 | my exit-code matrix | one giant token per row — **zsh does not word-split** — perfectly inverted |
| 9 | `--tier <name>` (space form) | **the browser tier, while printing PASS about self-host** |
| 10 | `delta-lint --fix` | first-in-file order — would have renumbered **peter's published** entries |
| 11 | `git checkout --theirs` in a cherry-pick | the incoming copy wholesale — **4 ruling rows + 10 gap entries lost, found in three separate passes** |
| 12 | the dPA's path grep | `2>/dev/null` swallowed "No such file" — a wrong path read as a clean absence |
| 13 | `browser-baseline.ts`'s SCOPE note | asserted lsp/commands/self-host "carry their own baselines" — **none existed** |
| 14 | `ci.yml`'s exclusion rationale | the co-mention above |

⚑ **The one worth generalizing beyond this project is #11's aftermath.** I found that clobber
THREE times. Each repair verified the wrong axis: I asked *"are the four **S409** rulings present?"* —
an enumeration that **structurally cannot see an S405 row**. The method was sound every time. **A
repair's verification inherits the scope of the thing it was looking for, not the scope of the
damage.**

---

## ⏭ NEXT-SESSION PICKUP

### 0. ⚑⚑ TWO UNREAD INBOX MESSAGES — READ THESE FIRST. One is a one-way door already on main.

**Neither was surfaced by the boot hook**, which only ever named the older S411 message. Both arrived
while S409 was mid-flight and both are `needs:` items.

**(a) `2026-09-12-2300-from-S413-peter` — `needs: reply`. A LANGUAGE-SURFACE FORK RESOLVED WITHOUT
ROUTING, AND IT IS ALREADY MERGED.** PR **#933** fixed a braceless `while`/`for` body being emitted
*after* the loop. The engineering is correct; the **fork-half is the problem**. Peter quotes
`compiler/SPEC.md` §49.2.1 verbatim — `loop-body ::= '{' loop-statement* '}'` — and reports grepping
all of §49 plus the whole SPEC for `braceless`/`un-braced`: **no sentence licenses a braceless body.**
So the compiler always accepted a form the grammar excludes, and miscompiled it. #933 closed that by
**making the form work** — adding braceless limbs. The other resolution, a new `E-LOOP-*` per
§49.2.1, *was never put on the table*.

⚑ That is base §8 verbatim — *a leak can be closed by making a form WORK or by REJECTING it, and
those produce different languages* — and it is **newly-ACCEPTING**, the one-way door. Direction is
`semantics-changed`, which owes a language-surface review it did not get. **He routed it himself and
says plainly it is his miss.** He also carries three findings on **#936** (my surface, routed not
edited), a correction to his own S412 wrap, and four items he will fix unless told otherwise.

**(b) `2026-09-10-2330-from-S412-peter`** — three silent defects in the SHIPPED stdlib (throttle,
debounce, jwt), all fixed; **and the self-host coverage hole has a SECOND LIMB that is bryan's.**
⚑ Read this against #939 before assuming the coverage work is finished — S409 gated
`compiler/tests/self-host/`, and this names a limb that gating may not cover.

**Both left in `handOffs/incoming/` deliberately**, unarchived, so the next boot cannot miss them.


### 1. ⚑ THE MERGE GATE IS THE BOTTLENECK, AND IT SHAPED THIS ENTIRE SESSION
`gh pr merge` and `git push --force*` are blocked by the **auto-mode classifier**, not by the
allowlist — `Bash(gh pr merge:*)` is already on file in `.claude/settings.local.json` and was not
honoured. **Nothing to add to settings.json.** The user merges with `! gh pr merge <n> --squash
--delete-branch`, or the mode changes.

Consequence worth carrying: `strict:true` + a required `gate` means **every merge puts every other
open PR into BEHIND**, so N PRs is N round-trips of the operator's attention. That is why six S409
PRs were consolidated into #936. **If PRs are accumulating again, consolidate early rather than
late** — and re-verify contended-file unions by marker-set diff, not by line count.

### 2. OPEN PRs — five, all mine, all gate-green or running
`#937` peter's language-surface review (+ the dpa-039/030 row restore) · `#938` the self-host parity
gap + brief archive · `#939` the self-host tier gate · `#950` the dPA's dpa-045 landing · plus this
wrap. **`#936` MERGED** and cleared the SPEC-INDEX conflict that had been on main five days.

### 3. Owed to bryan — the advisory queue, 2 items after #937/#950 land
**dpa-037** (NaN — he stopped it himself: *"ok hold on I am not ratifying NaN! TBC"*) and **dpa-045**
(AXIOM, ladder row 7 — the S109 reopen, *is text in a markup body a string*; both rounds now run and
the artifact is in scrml-support). dpa-039/040/041/042/043 all ruled this session.

### 4. Taken but NOT built — the three deferrals from the tier-gate arc
- **`bs.test.js` emits on a FAILED compile** — writes `bs.js`/`bs.css` even when it reports "compile
  failed", and `self-host-smoke.test.js:665` gates on bare `existsSync`. Safe in CI today only
  because the tiers sit in different jobs — **luck of layout, not a property.**
- **`lsp` and `commands` are still asserted by nothing.** The registry now makes adding them an
  entry + a `--write` + a step.
- **`.git/hooks/post-commit` is permanently red** — runs `bun test compiler/tests/`, greps
  `\d+ fail`, and browser's 48 baselined failures make it print `⚠ TEST REGRESSION DETECTED` on
  every compiler-touching commit. **Config B, per-machine, NOT source-controlled — bryan's to
  change, and the contract forbids auto-resetting B→A.** The lever now exists: point it at
  `bun scripts/tier-baseline.ts --tier=browser --check`. Filed since S326 as
  `g-post-commit-hook-is-permanently-red-and-cries-wolf-in-three-ways`.

### 5. Carried, unchanged
The worktree sweep — **~100 worktrees**, and S409 produced one measured instance of what is in them:
`docs/changes/s397-tilde-one-or-two/{progress,BRIEF}.md`, the **evidence matrix for a RATIFIED axiom
ruling**, existed ONLY on an unmerged agent branch and was cited from `master-list.md` §0. Recovered
and landed in #936. **That is one of ~100.** Still bryan's call.

---

## 🔭 DURABLE — what the session established

**A gate's name is a claim about its axis, and nobody checks it.** "SPEC-INDEX **totals** gate" did
exactly what it said and passed a file with three conflict markers in it. The fix was not a better
gate but a *second* one — and building it surfaced that a third was needed (scan coverage), because
a zero over a truncated enumeration is not a pass, it is a smaller measurement. **Three checks, three
different failures, and none subsumes the others.**

**An adversarial review can be accurate, and that is not the null hypothesis.** The ledger records
relayed findings failing ~1 in 3. This session's `/code-review high` returned 8 findings; I
reproduced the two load-bearing ones **by execution before acting**, and both held — including one
(`--tier <name>` asserting the wrong tier while printing PASS) that would have shipped a hollow gate
inside the arc built to close hollow gates. **Reproduce anyway; the point is that the check is cheap,
not that reviewers are usually wrong.**

**A baseline is a control, not a defect ledger.** Gating the self-host tier on a name set records
*that* three tests fail, never *what* they are. Filed `g-selfhost-tokenizelogic-and-css-parity-token-count-mismatch`
so the baseline has a referent — otherwise those three sit permanently green-by-baseline with nothing
describing them, which is how a name-set gate rots.

**Conformance restoration is not a design ruling, and the difference is a quoted sentence.** Peter
routed the regex-class-colon fix as *"narrows the §59 map-literal recognizer's reach — your design
surface."* §59.3 scopes the rule to a *"bracketed expression"*; a regex character class is not one, so
the pre-fix behaviour **violated** §59.3 rather than implementing it. No surface moved; no ruling was
owed. **He over-delivered — the right direction to err, and worth telling him so.**

---

## ⚑ MISSES (mine)

1. **★★★ A blind clobber, found three times, because each repair verified a narrower axis than the
   damage.** `git checkout --theirs` in a cherry-pick loop took the incoming copy wholesale on two
   append-only ledgers. Lost 10 gap entries (681 lines of a sibling's filings) and 4 ruling rows. I
   caught the gap entries, then dpa-040/042, then — only after the probe still read ADVISORY —
   dpa-039/030. **Calling a file "append-only" does not make a resolution additive.**
2. **★★ I reported a stale boot number twice.** Said 6 owed reviews; it was 4. My probe ran at 08:00,
   `wrap(s408)` merged at 08:06 carrying three of them. Re-measured only when the drain disagreed.
3. **★★ My own review of four PRs was shallower than peter's of the same four.** I verified file-set
   + `locus=`/`prov=` well-formedness and marked all four carve-out; he **reproduced the filed
   defects** and found two of three carried a falsified cause. Mine checked the entries were
   well-formed; his checked they were *true*.
4. **★ I relayed a citation as independent corroboration without checking its provenance.** Told the
   dPA that a `hand-off.md` line was a second arc converging on the loop-census finding; it derives
   from the same commit the dPA already cited. The dPA caught it and declined to bank it.
5. **★ Five of the fourteen instruments above are mine**, and #8 (the zsh word-split) is a trap
   named verbatim in my own memory file.

## ⚑ Wrap step 6c — MAPS DELIBERATELY NOT REFRESHED, and why

`.claude/maps/` is stamped `commit: e74f5423` — **five sessions behind** main (`4aa4560e`). Code DID
land from S409 (#936: `scripts/conflict-marker-gate.ts`, `scripts/regen-spec-index.ts`, `ci.yml`), so
this is **not** a docs-only session and the step is not vacuous.

**Not refreshed on purpose:** #939 renames `scripts/browser-baseline.ts` → `scripts/tier-baseline.ts`
and is still open. A map regenerated now is stale the moment that merges. The agent independently
measured two specific staleness points worth carrying:

- `primary.map.md` invariant 8 still spells `browser-baseline.ts` — **a file #939 deletes.**
- The map states `gate` is "14 total steps (12 `- name:` + 2 `- uses:`)"; measured at `origin/main`
  it was **already 15 before S409 touched anything**, and #939 takes it to 16.

**Refresh after #939 merges, not before.** Recorded rather than skipped.

## Gate at close
Cloud `gate` GREEN on every S409 PR. `tracking` RED — the known non-blocking job.
Advisory queue **0 UNRUN · 3 ADVISORY** (→ 2 once #937 lands). Review floor drained twice this
session, both times by a sibling first. `conflict-marker-gate` 8,186 files / 0 markers on main.

⚑ **Two working-tree items that are NOT this session's and were deliberately not committed:**
`docs/articles/teej_baiting_tweet.md` shows as deleted by someone else's uncommitted act — surfaced,
not resolved, because committing it would land another party's decision.

---

# scrml — Session 414 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S413/S412/S411/
> S410 mine, S405 bryan's) and is untouched. **No LIVE sibling this session** — bryan's last activity
> was 2026-09-12 20:49Z (#939); his surfaces (`ci.yml`, `dpa-debt.ts`, `regen-spec-index.ts`,
> `SPEC-INDEX.md`, `dpa-queue.md`, the review lane in `pr-reviews.md`) were **read but never edited**.
> His seven open PRs (#937/#938/#939 + #905/#906/#907/#918/#919/#920/#899) are CLAIMED, not lost.
> Full mechanical detail: `docs/changelog.md` S414 block and delta-log `[3014]`–`[3022]`.

## ⏭ NEXT-SESSION PICKUP

1. ⚑⚑ **THE OPENER IS DRAINABLE AND IT IS THE EMITTER TWIN OF WHAT #941 CLOSED.**
   `g-declared-names-set-shared-across-blocks-emits-a-bare-assignment` (**HIGH, LIVE**).
   `emit-logic.ts:2060` picks DECLARATION vs BARE ASSIGNMENT off `opts.declaredNames`, and **every
   block emitter passes the SAME `Set` object rather than a copy** (`emit-control-flow.ts:451`, `:627`,
   `:1015`, `:1037`; only `function-decl` copies, at `emit-logic.ts:4234`). So a `let` in ANY block
   marks that name declared for the whole enclosing scope, and a later out-of-scope write emits a bare
   assignment: **exit 0, zero diagnostics, `ReferenceError` when run.** Needs NO inner function.
   Rename CONTROL discriminates. ⚑ **Fix direction deliberately NOT prescribed** — copying the set per
   block is the naive move and its migration population is UNMEASURED. Measure before narrowing.

2. ⚑⚑ **STILL GATED ON BRYAN, AND THE LIST GREW. Do not build any of it.**
   - §49.2.1 **braceless loop bodies** (the S413 fork, routed, unruled). Two gaps hang off it.
   - **`g-bare-block-statement-is-silently-dropped`** (HIGH, NEW, live on main) — `i = i + 10;
     { i = i + 1 }; return i` returns **10**; both controls return 11. Whether a standalone block is
     legal at all is plausibly the same ruling as the braceless-body fork.
   - **`g-export-reparse-swallows-ast-builder-parse-path-diagnostics`** (HIGH, NEW) — closing it is a
     **MIGRATION**: 22 of 2,552 measurable files newly error (E-THROW ×17, E-TRY ×7, E-STMT ×1),
     **ten of them shipped stdlib modules** plus the native parser's own `parse-markup.scrml`.
   - The **must-use spec-citation** ruling (§48.3.3 is a mis-citation; no governing sentence exists).
   - His **three #936 findings** (dpa-debt fails toward HIDING debt; the currency gate cannot see a
     duplicated table; six "closed on merge" PRs are all still open).
   - ⚑ **NEW:** `E-CONDITION-HEAD-UNPARENTHESIZED` (#945) mints a diagnostic, which decides what the
     language refuses → owes a **language-surface review**. Landed with the stamp OUTSTANDING per the
     S313 review-floor mechanism, exactly like #924/issue #922. Do not close that loop unilaterally.

3. **Review floor reads 2 OWED — #944 and #945, both this session's.** Per the established pattern
   (#890 marker) a drain PR's review **rides the NEXT landing**. Discharge first.

4. **The other live HIGH, untouched this session and still the cheapest big one:**
   `g-library-map-surface-unlowered-beyond-the-bracket-read` — `mapSetLoweringBoundaryOk` is off for
   every non-client/server mode; #929's guard walks only `kind=index` and covers **1 of 8 shapes**.
   `m.size` emits `return m.size;` against a HAMT node → `undefined` at exit 0. Reproducers written.

5. ⚑ **DO NOT RE-ADD A RECOVERY SCAN TO `collectIfCondition`.** Three separate bounds were built and
   all three ate or corrupted source; the ⛔ banner in `ast-builder.js` records all three by shape so
   the next reader does not reinvent one. The scan stopping at the `)` is the invariant. If the
   emitted artifact for an offending head looks wrong, that is FINE — the build is red.

6. **Standing from Peter, unchanged:** merge on green without re-asking; surface `autoMode` blocks as
   `⛔ BLOCKED BY autoMode — <exact command>` rather than engineering around them. Neither merge was
   blocked this session.


## ⏭ POST-WRAP CONTINUATION — #947 landed after the S414 wrap

Peter said *"go on recommend"* after the wrap, so PICKUP item 1 was taken in the same session and
landed as **#947**. The pickup list below is superseded ONLY on item 1; items 2–6 stand.

**`g-declared-names-set-shared-across-blocks-emits-a-bare-assignment` is RESOLVED.** Each block body
now gets its own COPY of `declaredNames`. R26 on merged main: all four reproducer cases return
`"abQ"`; two of them threw `ReferenceError` before.

⛑ **The migration the entry demanded was measured, and it was free** — 0 artifact content diffs over
1,928 sources / 7,467 artifacts. **Measured twice**: the first run covered a 9-site naive substitution,
not the patch that landed, because the build found two further cases (the if/else limbs shared ONE
`bodyOpts` object so they leaked into EACH OTHER; and `_emitIfStmtWithOpts` is a SECOND independent
if/else emitter). ⚑ The first run also printed `0 artifact content diffs` UNDER a
`NOT A VALID COMPARISON` banner — the S411 trap — because the patch was uncommitted so both sides were
the same revision.

⛑ **The S239 pass falsified the build's own direction claim**: `semantics-changed` AND
**`newly-rejecting`**, not "no diagnostic delta". Two bare writes after a block go from exit 0 (then
`ReferenceError` at runtime) to `E-CODEGEN-INVALID-LOGIC`. It owes a language-surface review; landed
with the stamp outstanding.

### NEW on the board — two siblings, both PA-reproduced on BOTH trees (pre-existing)
- **HIGH `g-try-catch-finally-bodies-redeclare-every-assignment`** — `emitTryStmt` takes NO opts, so
  the entire try/catch/finally interior is untracked and every bare write becomes a fresh `const`:
  `let x = 1; try { x = 2 } catch (e) { x = 3 }; return x` **returns 1**, exit 0, silently wrong. The
  same untracked mode holds in `emit-each` / `emit-channel` / `emit-match` / `emit-engine` /
  `emit-lift` / `emitHoistedForStmt` (grep-verified; reachability unmeasured).
- **MED `g-loop-head-binding-is-not-tracked-so-writing-the-loop-variable-throws`** — the `for` head
  binding never enters `declaredNames`; the body emits `const i = i + 1` and throws
  `Cannot access 'i' before initialization`.

⛑ **Do NOT fix either by threading the Set in.** Declaration-by-bare-assignment is documented ONLY in
a code comment (`emit-logic.ts` ~:2071–2079); SPEC §50 models `x = value` as assignment to an EXISTING
binding, and `E-ASSIGN-001` says *"Declare `x` before …"*. The end-state is probably a scope
diagnostic — a language question for bryan, not a codegen patch.

### ⛑ OWED — `TYPES-BASELINE.json` is stale by one key, and I deliberately did not hand-fix it
#947 renames one anonymous-argument type inside a pre-existing TS2345, which renames a baseline key.
PA-confirmed by running the gate's own tsc on both trees: **241 = 241 diagnostics, 155 = 155 distinct
keys, exactly one non-path delta.** `bun scripts/types-gate.ts --write` **cannot run on this Windows
clone** (it resolves an extensionless `node_modules/.bin/tsc`; Windows ships `tsc.exe`). A hand-edit
was attempted, verified to touch exactly one line, and then **REVERTED**: the committed baseline
records `totalDiagnostics` **228** against this environment's **241**, each worktree ran its own
`bun install`, and tsc's type-printer truncation (`... 29 more ...`) is version-sensitive — so a
hand-written key could be **wrong in a new way**, which is harder to diagnose than a stale one.
**Nothing is blocked:** the step is `continue-on-error: true` inside the non-blocking `tracking` job
(`ci.yml:215`). **Run `bun scripts/types-gate.ts --write` on a clone where it runs.**

## WHAT LANDED

**Two PRs, both gate-green — #944 · #945.** Board **HIGH 104 → 107 · MED 236 → 236 · LOW 87 → 88**;
four gaps filed, one resolved. Counts are generated — read `docs/known-gaps.md`, never this line.

Peter's ruled opener is **closed** (`g-loop-branch-head-truncated-at-first-close-paren`), and the
review floor went **4 OWED → 0**.

## 🔭 DURABLE

**A fix can reproduce the exact defect it is named after, and only an A/B against a TRUE base shows
it.** Cut 3's recovery turned `while (i) < n >> 1 { … }` from base's `while (i) { }` (falsy,
terminates) into `while (i < n) { }` — an empty-bodied infinite loop. The headline symptom, caused by
the fix. It was invisible to the test suite, to conformance, and to three rounds of my own reading.

**When the same class recurs three times in the same code, delete the code rather than bound it
again.** Rounds 1–3 each patched the recovery scan's stopping rule and each patch had a hole one
token-kind wide. Round 4 removed the scan; the class is closed by construction because the collector
never advances past the `)`. ⚑ **The tell was that every fix was a new predicate over the same
ambiguity** — "is this token part of the condition or the start of the body?" is genuinely
undecidable at that position, and three attempts to decide it were three attempts at the wrong
question.

**A bounded local repair and an open-ended scan are not the same precedent.** S308's
`E-FOR-UNPARENTHESIZED-HEAD` recovers by consuming one known token and collecting one known operand.
I cited it as licence for an unbounded scan. Same words, different mechanism — check what a precedent
actually *does* before inheriting its shape.

**Five of my own instruments failed this session, every one caught before it produced a claim** — a
probe matching prose not markers; a control that fired nowhere; a `write:false`/`write:true` swap that
flipped my own proof-of-reach; a base-vs-tip comparison whose "base" was the fix branch itself; and a
commit message whose backticks the shell executed. **The prior holds: if an instrument here is wrong,
assume it is flattering you.**

**Three parties can each get an axis wrong in a different direction, and only a crossed matrix
resolves it.** Two reviewers and I each named a different axis for the export swallow (the `<program>`
shell, the function wrapper, the shell again) — every one of us had varied two things at once. The
real answer is the whole lexical interior of any exported declaration.

## ⚑ MISSES (mine)

1. **★★★ I read the round-2 hole and let it go**, because the comment above it asserted the
   fail-direction was *"stop early, never swallow source."* It was false. Fifth consecutive arc where
   a confident safety comment sat on the bug — and the first where I was the one who believed it
   rather than the one who caught it.
2. **★★★ I cited S308 as licence for a design it does not license** (bounded repair vs open-ended
   scan), which is what put three rounds of silent-data-loss defects into review in the first place.
3. **★★ A mis-citation of mine reached a user-facing error string.** The brief cited §50.2.2 for
   productions that live in §50.2.1. The agent propagated it faithfully into the §34 row and the
   diagnostic text while getting it RIGHT in prose it wrote itself. Caught at the file-delta review.
4. **★★ I cut the review branch off the FIX branch instead of off main**, so #944 carried the
   pre-banner brief onto main with both wrong citations uncorrected. Fixed by rebasing so the banner
   rides in with #945 — but it was on main in between.
5. **★ Two of my prescribed fixes to the agent were wrong** and it measured rather than assumed: an
   ASI/newline bound would not have caught the same-line case, and narrowing `is` to KEYWORD-only does
   not work because the tokenizer classifies `is` context-free. Both corrections were right.

## Gate at close

Cloud `gate` **GREEN** on #944 and #945; `windows` green. `tracking` **RED — proven pre-existing by
name-set comparison against main's own run at `1c42b0c7`**, the identical five dev-watcher/hot-reload
tests. That comparison mattered here because #945 touches compiler source; #944 was docs-only.

Local on merged main: conformance **1638 tests / 0 fail / 30 skip / 7309 expect()**; the three pinned
loop-head files **86 pass / 0 fail / 140 expect()**; `regen-spec-index --check` OK (71/71, 0 stale);
`facts --check` PASS; `state --check` PASS; `delta-lint` PASS at max `[3022]`. R26 on merged main:
five offending shapes rejected, five controls clean.

⚑ One pre-existing inconsistency surfaced by `state --check` and **not** fixed:
`g-three-emit-expr-comments-still-claim-a-failed-build-never-ships-including-two-leak-guards` has
`heading=open` but `marker=resolved`. Unrelated to this arc; noted rather than tidied.

**Maps (wrap 6c) — NOT hand-run, deliberately.** Owned by the scheduled `cloud-maps` workflow; a wrap
cannot contain its own squash SHA.

**Worktrees — two removed, three retained.** This session's dispatch worktree landed via #945 and was
removed (branch deleted, pruned), as was the temporary `C:/s414truebase` base worktree cut for the
A/B. Three remain and **none is this session's**: `agent-a0742fe4795045e91`, `agent-a4e6b5f2562ae9eaa`,
`onmount-c`, plus the `scrml-pinned` app clone.

**Inbox:** nothing inbound. The two outbound drops to bryan (S412's stdlib defects + self-host
coverage hole; S413's §49.2.1 fork + his three #936 findings) remain unread by him and are
deliberately left in place.


---

# scrml — Session 413 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S412/S411/S410
> mine, S405 bryan's) and is untouched **except** the S412 headline, which is struck in place because
> it is false — see PICKUP item 1. **bryan's S409 was LIVE throughout this session** (three PRs today:
> #937 14:54Z · #938 15:07Z · #939 20:49Z); his surfaces — `.github/workflows/ci.yml`,
> `scripts/dpa-debt.ts`, `scripts/regen-spec-index.ts`, `compiler/SPEC-INDEX.md`, `handOffs/dpa-queue.md`
> — were **read and reviewed but never edited**. Full mechanical detail: `docs/changelog.md` S413 block
> and delta-log `[3002]`–`[3012]`.

## ⏭ NEXT-SESSION PICKUP

1. ⚑⚑ **THE S412 HEADLINE WAS FALSE AND IS NOW STRUCK — do not re-assert it, and do not "restore" it.**
   *"Three silent defects were live in the SHIPPED STANDARD LIBRARY"* is wrong. `scrml:auth` /
   `scrml:time` resolve to `compiler/runtime/stdlib/{auth,time}.js`, which say **hand-written** in their
   own headers and carry correct plain JS scrml never compiled (`auth.js:106` is
   `while (s.length % 4) s += "=";`); `bundleStdlibForRun` (`api.js:383`) copies from that directory, so
   `stdlib/**/index.scrml` are **source mirrors nothing imports**. **No adopter was affected.** The
   compiler defects and their fixes are real — only the blast radius was wrong. Struck in both
   `known-gaps` entries, the changelog and the S412 section below. Memory written
   (`stdlib-scrml-sources-are-mirrors-shims-are-what-ships`).

2. ⚑⚑ **BRYAN OWES A RULING AND THE BUILD IS GATED ON IT — §49.2.1 braceless loop bodies.**
   Routed in `handOffs/incoming/2026-09-12-2300-from-S413-peter-to-bryan-…`. **Governing sentence:**
   `loop-body ::= '{' loop-statement* '}'` — **braces are mandatory** for `while`/`do…while`, and no
   sentence anywhere in SPEC.md licenses a braceless body. The compiler accepted one anyway and
   miscompiled it; **#933 (mine) resolved that by making the form WORK rather than by REJECTING it** —
   `pa-base` §8 verbatim, direction `semantics-changed`, owed a language-surface review it never got.
   ⚑ **DO NOT build either half until he rules.** Two gaps hang off it:
   `g-braceless-loop-body-is-accepted-against-the-normative-grammar` (the fork itself) and
   `g-do-while-braceless-body-becomes-the-condition` (adding a braceless `do` limb is the *accepting*
   half — building it would pre-empt the ruling).

3. ⚑⚑ **THIS IS THE OPENER — PETER RULED IT POST-WRAP, verbatim: *"take the loop-head truncation fix
   next session"*. It outranks items 4–7; start here, not with a fresh triage.**
   `g-loop-branch-head-truncated-at-first-close-paren` (MED, latent). `collectIfCondition` stops at the
   first balanced `)`, so `while (n + 1) < 4 { … }` loses the remainder **and the whole body** — a silent
   infinite loop. ⚑ **`if` has the identical bug and always has**, so fixing `collectIfCondition` closes
   `if` and all three `while` sites at once — **root, not position**. Population measured with a control:
   **0 of 2,553 tracked `.scrml`**, so it is latent and there is no migration to negotiate. This is a
   plain parse defect, not a language question — the §49.2.1 fork above is about the *body*, this is
   about the *head*.

4. **The other live HIGH from the drain, reproducers already written:**
   `g-library-map-surface-unlowered-beyond-the-bracket-read`. `mapSetLoweringBoundaryOk` is off for every
   non-client/server mode, so the whole §59 method surface is unlowered at the library boundary while
   #929's guard walks only `kind=index` — it covers **1 of 8 shapes**. `m.size` emits `return m.size;`
   against a HAMT node → **`undefined`** at exit 0; a bracket read **inside a `match` arm** escapes too,
   because arms are carried as **`rawArms: string[]`** and an AST walk cannot see a string. ⚑ CONTROL:
   the same read in an `if`/`else` chain **is** still refused. **Same class as the S392 `if-chain`
   finding** — the memory is updated with this logic-tree sibling.

5. **Routed to bryan, his surface, do not take under him.** #936's two new CI gates are **real** —
   bite-proven four ways each including against the genuine `e74f5423` artifact. Three findings:
   ⚑ `dpa-debt.ts`'s last-non-empty-cell selection **fails toward `ratified`**, i.e. it *hides* debt,
   and its own comment claims the safe direction (a `NOT RATIFIED` row vanishes from the owed count);
   the currency gate cannot see a **duplicated** table, which is #900's actual payload; and the six PRs
   the body says are *"closed on merge"* (#905/#906/#907/#918/#919/#920, plus #885) are **all still
   open**, carrying commits already on main.

6. **Review floor reads 2 OWED — #940 and #941, both this session's.** Per the established pattern a
   drain PR's review **rides the NEXT landing**; discharge them first, exactly as this session did with
   S412's six.

7. **A second ruling for bryan, small but real:** there is **no governing sentence anywhere in SPEC.md**
   for the must-use scoping rule (searched §34, §35.1–§35.7, §48.3, §50.3.1 and grepped all 37,947
   lines), and the in-code citations of **§48.3.3** at `type-system.ts:18799` and `:18990` are a
   **mis-citation** — that section is `E-FN-003 — Outer-Scope Variable Mutation` and carries no
   `tilde-decl` rule. #941 deliberately left both in place; correcting a spec citation is a ruling.

8. **Standing from Peter, unchanged:** merge on green without re-asking, and surface `autoMode` blocks
   as `⛔ BLOCKED BY autoMode — <exact command>` rather than engineering around them. Both merges this
   session were cleared that way in one word.

## WHAT LANDED

**Two PRs, both gate-green — #940 · #941.** Board **HIGH 103 → 104 · MED 231 → 236 · LOW 87**; one gap
resolved, seven filed. Counts are generated — read `docs/known-gaps.md`, never this line.

**The review floor went 9 OWED → 0.** Six of the nine were code-bearing and got a full S239 pass,
dispatched **un-seeded and in parallel** so no agent inherited a hypothesis. **Five of the six returned
`finding` — four of them mine.** #941 then fixed the sharpest one the same session.

## 🔭 DURABLE

**A confident safety comment is the best place to look for the bug — three consecutive arcs now.** S412
found three defects that way; this session's #941 found a fourth *in the fix for one of them*.
`_collectScopeBindings` justified flattening nested-block declarations with *"E-SCOPE-001 would already
have rejected truly-out-of-scope references."* It does not reject the cross-function case, and the
reproducer proves it. **The comment states the premise out loud, which is what makes it checkable; the
code never does.**

**"It lives under `stdlib/`" is not "it ships."** The hop that decides what an adopter receives is
`bundleStdlibForRun`, and nothing in the source tree announces it. Before writing *"live in the shipped
X"* about anything, trace the hop and name it. Reasoning a blast radius instead of measuring it is now
at three instances in this session family and it is the most expensive recurring error I make.

**Capture your own baseline before you accept an agent's number.** The #941 dispatch reported
conformance **906/906**; the true figure is **905/905** and its branch adds no conformance case. I only
caught it because I measured the baseline myself before dispatching. A number in a report is a claim.

**An adversarial finding is a claim too — including the ones that are right about the mechanism.** The
#932 review's *mechanism* held perfectly under direct execution with two controls; its *end-to-end
reproducer* did not reproduce at all, because the reproducer's map literal used a bare unresolved key so
the case and its control failed identically on both sides. Recorded as mechanism-confirmed /
corpus-impact-unproven rather than inherited whole. **Verify the load-bearing half, and record which
half you verified.**

**A carve-out still owes a controlled probe.** Three of the nine were docs-only, and each one's probe was
proven to have reach over its own diff (#928's status-flip check found 0 `status=resolved` +lines *and*
2 `@gap id=` +lines, so the zero measured something). A carve-out asserted from "no code paths" is the
absorbed-escape-hatch shape.

## ⚑ MISSES (mine)

1. **★★★ I shipped a false blast-radius claim into five artifacts.** Covered at PICKUP 1. The defects were
   real, which is exactly what made the framing feel safe to write.
2. **★★★ I resolved a language-surface fork without routing it** (#933, PICKUP 2) — and I resolved it in
   the *accepting* direction, which is the one-way door. The governing sentence was one grep away and I
   did not run it until I reviewed my own PR a session later.
3. **★★ Four of my own six S412 PRs came back with findings**, two of them live regressions (#931's
   `ReferenceError` at exit 0, #929's `undefined` at exit 0). The S239 pass caught them — a session late.
   The floor works; my pre-land discipline on those six did not.
4. **★ My tokenizer probe errored into nothing** while checking the `finally` half of the #932 finding,
   so that half is recorded as **unchecked** rather than cleared. A broken instrument is not evidence.
5. **★ A heredoc with nine long marker lines failed to parse and wrote nothing.** Caught by checking the
   line count before and after rather than trusting the absence of an error; re-done via a file write.

## Gate at close

Conformance **905/905** on merged main — measured on the pre-fix baseline *and* after, which is how the
dispatch's 906 was caught. Unit tier **18,584 tests / 1 fail**: `6nz-f4-textarea-rcdata-interp.test.js`
§3, which passes **15/0 in 3.78 s in isolation** against 5,034 ms for that one test in the 962-file
co-run — the documented `node --check` subprocess-spawn contention canary, root-caused rather than
called a flake. Integration contributes **5 fails**, the pre-existing dev-watcher/hot-reload class:
⚑ **the identical five test names fail on main's own last CI run**, which is how I established the
`tracking` RED was not mine on a PR that touches compiler source. `delta-lint` PASS at max `[3012]`;
`state --check` PASS; `facts --check` PASS. Cloud `gate` GREEN on both PRs; `windows` green.

**Maps (wrap 6c) — NOT hand-run, deliberately.** `.claude/maps/primary.map.md` is at watermark
`e74f5423`; the refresh is owned by the scheduled `cloud-maps` workflow. Same designed latency #903
recorded: a wrap cannot contain its own squash SHA. ⚑ **One map finding worth acting on:** the dispatch
reported that the map set contains **zero** references to `must-use` / `E-MU-001` / `tilde-decl`, and its
nearest row asserts *"`TildeTracker`/`MustUseTracker`/`checkLinear` run exclusively against synthetic
ASTs and have never seen a parsed program"* — **falsified for `tilde-decl` at this HEAD**, since the
rename control fires a real `E-MU-001` from a parsed program. The maps were not edited.

**Worktrees — one removed, three retained.** The #941 dispatch's worktree landed and was removed
(branch deleted, pruned). Three remain and **none is this session's**: `agent-a0742fe4795045e91`,
`agent-a4e6b5f2562ae9eaa`, `onmount-c`, plus the `scrml-pinned` app clone. Their work has not landed, so
per the wrap discipline they are retained and surfaced rather than removed.

**Inbox:** the S411 drop (regex-class-colon language-surface review) is **discharged** — bryan stamped it
at #937 and closed issue #922 — so it moved to `read/`. Two outbound drops remain unread by him and are
deliberately left in place: S412's (stdlib defects + the self-host coverage hole) and S413's (the
§49.2.1 fork + his three #936 findings).


---

# scrml — Session 412 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S411/S410 mine,
> S405 bryan's) and is untouched. **No LIVE sibling this session** — the three `status=LIVE` board
> headers at boot (S403/S407/S409) were 59h stale and treated as such; bryan's surfaces (`ci.yml`,
> `SPEC-INDEX.md`, the dPA queue) were never touched. Full mechanical detail: `docs/changelog.md`
> S412 block and delta-log `[2957]`–`[2978]`.

## ⏭ NEXT-SESSION PICKUP

1. **Review floor reads 6 OWED** — #928 #929 #930 #931 #932 #933, every one this session's. Per the
   established pattern (see the #890 marker) a drain PR's review **rides the NEXT landing**, otherwise
   the floor regresses forever one PR at a time. Discharge these first. ⚑ **Give #933 a real pass:** it
   corrected a MED I had mis-filed, and the correction rests on my own claim that a line-filter probe
   misled me — that reasoning deserves an adversary.

2. ⚑⚑ **DO NOT CLOSE ISSUE #922. Still open ON PURPOSE, still unstamped** (2 comments, no ruling). The
   regex-class-colon fix landed at `6951baa5` and is `semantics-changed`, which
   `pa-profile-pjoliver11.md` says owes bryan a **language-surface review**. Closing it erases the thing
   he still has to stamp. **If he stamps it, close it then.**

3. **The cheapest real work on the board is the HIGH I filed and did not take:**
   `g-user-fn-named-reset-emits-undefined-at-call-site`. A user fn named exactly `reset` has its call
   replaced by `/* C5: unexpected reset target shape; B22 should have rejected */ undefined` at exit 0.
   **Isolated against `setCol` / `tare` / `clear`, which all compile fine**, so the trigger is the name.
   The emitted comment shows the compiler KNOWS it is in an unexpected state and emits `undefined`
   anyway — a fail-OPEN on an internal invariant, which is exactly what §2.2.1 exists to prevent. Grep
   the literal string `B22 should have rejected` to find the site.

4. **Two more MEDs with reproducers already written:**
   - `g-tab-scrml-tokenizelogic-parity-token-count-mismatch` — 2 of the 3 remaining `tab.test.js`
     failures are real token-count disagreements between `tab.scrml` and the JS original
     (`punct chars`: expected 25, received 24). A **`tab.scrml` SOURCE** gap, not a compiler one.
   - `g-library-mode-map-bracket-read-does-not-lower` — §59.6's read lowering is gated on
     `ctx.mode === "client" || "server"`, so `m["k"]` at the library boundary emits a raw property
     access on a HAMT node. ⚑ **Deliberately NOT taken:** widening `emitIndex` needs the same
     boundary-safety argument the existing branch makes, and *"what boundary is a library module?"* is
     the language question `rawFallbackReason` already routed rather than decided. **Route, don't
     unilaterally fix.**

5. ⚑ **THE SELF-HOST COVERAGE HOLE IS NOW DOUBLY CONFIRMED AND IT IS BRYAN'S SURFACE.**
   `compiler/tests/self-host/` is run by NEITHER CI job — and this session found a second limb:
   `compiler/self-host/` contributes **0 sources** to `corpus-emit-differential` (its roots are
   `examples,samples,conformance,stdlib,benchmarks`). So the 12 braceless-loop sites in `bs.scrml` /
   `pa.scrml` / `bpp.scrml` fixed by #933 were invisible to BOTH instruments. The S410 sequence still
   stands: name-set baselines for `tracking` → an assertion-count floor → decide `self-host/`'s status
   EXPLICITLY. ⚑ **All of it edits `ci.yml`, bryan's ACTIVE surface at the open #907. Coordinate or
   route; do not take it under him.**

6. **Standing from Peter, unchanged and reconfirmed all session:** merge on green without re-asking,
   and surface `autoMode` blocks explicitly with the exact command rather than engineering around them.

## WHAT LANDED

**Six PRs, every one gate-green — #928 · #929 · #930 · #931 · #932 · #933.** Board **HIGH 101 → 102 ·
MED 230 → 230 · LOW 86**; seven gaps resolved, eight filed. Counts are generated — read
`docs/known-gaps.md`, never this line.

⚑ ~~**THE HEADLINE: three separate silent defects were live in the SHIPPED STANDARD LIBRARY**~~, ~~and~~ not one
was found by reading code.

> ⚑⚑ **CORRECTED S413-peter — "SHIPPED" IS FALSE.** The defects and fixes are real; the blast-radius
> claim is not. `scrml:auth` / `scrml:time` resolve to the **hand-written** shims at
> `compiler/runtime/stdlib/{auth,time}.js` (their own headers say so; `auth.js:106` carries the padding
> loop as correct plain JS), and `bundleStdlibForRun` (`api.js:383`) copies from that directory — so the
> `stdlib/**/index.scrml` files are source mirrors **nothing imports**. **No adopter was affected.**
> Struck in place in `docs/known-gaps.md` (both entries) and `docs/changelog.md`. Third instance of the
> reasoned-not-measured blast radius in this session family. `stdlib/time`'s **`throttle` did not throttle and `debounce` did not
debounce** — `inThrottle = true` inside the inner closure emitted as `const inThrottle = true`, so the
outer binding was never set and the guard always passed. `stdlib/auth/jwt`'s **`base64urlDecode` hung** —
its padding loop emitted empty with `s += "="` dropped, an infinite loop for any input not a multiple of
4 long. And `semdiff` **neutralised ordinary author data**, replacing every occurrence of a word like
`customer` across a whole artifact.

## 🔭 DURABLE

**A confident comment explaining why something is safe is the best place to look for the bug.** Three
of this session's six fixes were found that way. `semdiff`'s comment argued its patterns were safe
because they are "anchored on a compiler-emitted prefix" — true of the prefix, and the captured group
is the *value*. `type-system.ts` withheld `parentBindings` because *"E-FN-003 enforces that"* — true of
`fn`, false of `function`. `emit-logic.ts` reset a scope because *"a function body has its own scope"* —
true of its declarations, false of what it can see. **The comment states the premise out loud, which is
what makes it checkable; the code never does.**

**When the code and its own documentation disagree, the documentation is sometimes the correct half.**
`semdiff`'s doc comment already said chunk tokens match `0[0-9a-z]{7}`; the patterns matched
`[0-9a-z]{8}`. The fix was to make the code obey a contract already written beside it. Worth checking
before designing a new discriminator.

**A line filter cannot see nesting, and `toContain` cannot see placement.** Both blind spots were live
simultaneously and cost a correct finding: a probe that grepped emitted JS for matching lines dropped
the `}` lines, so a loop body emitted OUTSIDE the loop printed identically to one inside — and I
withdrew a correct reading of the parser as a false alarm on the strength of it. **"Verified by
execution" is worth nothing if the observable cannot distinguish the two cases.**

**When a run HANGS, stop executing and inspect the artifact.** The braceless-loop defect was named in
one look at the emit after a 600 s timeout. Execution is the strongest evidence right up until the
program does not terminate, at which point it produces none at all.

**Inertness is the load-bearing result for a lexer change.** The tokenizer fix (#932) returned **0
artifact content diffs over 7,467 artifacts** — which is precisely the proof that no existing program
had a regex after a control-flow `)` and that no division anywhere was reclassified. A change that
*should* move nothing is verified by measuring that it moved nothing.

## ⚑ MISSES (mine)

1. **★★★ I talked myself out of a correct finding with a probe that structurally could not see the
   answer.** I read the parser right — *"no braceless-body branch at all"* — then "verified" braceless ==
   braced with a line filter that dropped the `}` lines, withdrew the reading as a false alarm, and filed
   a much narrower regex MED **recording the withdrawal as though it were the careful move.** The real
   defect was a silent infinite loop live in `stdlib/auth/jwt`. Corrected in place at `[2975]`–`[2976]`;
   the struck paragraph is left in the entry because how it was reached is the lesson.
2. **★★★ I wrote a bold, false prediction into a gap entry as a prescribed method for a future session.**
   The padding entry said fixing it *"would UNMASK the #924 mislowering class"* and told the next PA to
   fix both or pin both. It does not — measured. Same class as the S411 inference-as-observation, and it
   had already propagated into a review marker. Corrected in place.
3. **★★ I reasoned a blast radius instead of measuring it, and was wrong twice over.** I scoped the
   const-decl defect to self-host from the entry's framing: wrong about the **mode** (browser and library
   emit identically) and wrong about the **population** (it was in `stdlib/time`). **The corpus
   differential corrected me, not the argument.**
4. **★★ A probe reported a clean "0 unexplained" by reading nothing** — it indexed `manifest.sources` as
   a path-keyed object when the tool's own code shows it is an array, so every lookup was `undefined` and
   both sides coerced to `""`. Caught only by adding a **lookup control** that asserts each path resolves
   before any comparison is trusted. Fifth consecutive session for the instrument-lies prior.
5. **★ I filed a locus I had not traced, twice**, and measurement replaced both — the library map gap
   (`searched:`, actually the runtime registry) and the padding gap (`ast-builder.js`, actually the two
   regex-vs-division heuristics).
6. **★ Two test expectations were wrong on first write** — I guessed `E-MU-001` was a general unused-
   variable check (it is tilde-decl/must-use specific), and named a test helper `reset`, which collides
   with a compiler construct. The second accidentally found a HIGH.

## Gate at close

Conformance **905/905** on merged main. Unit tier **18,552 pass / 2 fail** — both `node --check` co-run
canaries (`giti-016`, `match-block-form-payload-binding`), which pass **30/0 together in isolation**
(≈5,030 ms co-run vs ~1 s alone); root-caused as the documented Windows co-run spawn timeout, not called
a flake. Self-host suites **139 pass / 3 fail**, all three separately filed. `delta-lint` PASS at max
`[2978]`; `facts --check` PASS; `state --check` PASS. Cloud `gate` GREEN on all six PRs; `tracking` RED
throughout — the filed whole-job pre-existing failure, and this session proved it independent by showing
it fails on **#928, which is docs-only**.

**Four corpus differentials** ran over 1,928 sources / 7,467 artifacts. Two returned **0 content diffs**
(#929 inert; #932 the tokenizer, where inertness is the proof), one returned **4** (#930 — every one
exactly `const X = …` → `X = …`), one returned **2** (#933 — both `stdlib/auth/jwt`, the entire change
being `+ s += "=";`). Every changed artifact was diffed line by line, never inferred from byte counts.

**Maps (wrap 6c) — NOT hand-run, deliberately.** `.claude/maps/primary.map.md` is at watermark
`e74f5423`; the refresh is owned by the scheduled `cloud-maps` workflow, which ran green today at
09:28 UTC — i.e. BEFORE this session's landings — so the next scheduled run picks them up. Same designed
latency the `#903` review recorded: a wrap cannot contain its own squash SHA. Hand-running
`project-mapper` here would race it for no gain.

**Worktrees NOT swept — none are this session's.** Three remain (`agent-a0742fe4795045e91`,
`agent-a4e6b5f2562ae9eaa`, `onmount-c`) plus the `scrml-pinned` app clone; their work has not landed, so
per the wrap discipline they are retained and surfaced rather than removed. ⚑ The two temporary base
worktrees cut for differentials (`C:/s412base2`, `C:/s412base3`) **were** removed; `C:/s412base` was
removed earlier in the session.


---

# scrml — Session 411 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the first `---` is prior sessions' (S410/S408 mine,
> S405 bryan's) and is untouched. **S409-bryan was LIVE throughout** this session — his lane is
> `compiler/SPEC-INDEX.md` (#905), `.github/workflows/ci.yml` (#907) and the dPA advisory drain
> (#906/#918/#919/#920, three rulings opened during this session). Disjoint by construction; no
> collision. Full mechanical detail: `docs/changelog.md` S411 block and delta-log `[2947]`–`[2954]`.

## ⏭ NEXT-SESSION PICKUP

1. ⚑⚑ **DO NOT CLOSE ISSUE #922. It is open ON PURPOSE.** The regex-class-colon fix LANDED
   (`6951baa5`, #924) and the issue carries the landing SHA plus the full measured migration — but the
   change is `semantics-changed`, and `pa-profile-pjoliver11.md` says that owes bryan a
   **language-surface review**. Closing it erases the thing he still has to stamp. He now reviews a
   landed, measured fix rather than authorizing a build. **If he stamps it, close it then.**

2. **Review floor reads 3 OWED** — #921, #923, #924, all this session's. Per the established pattern
   (see the #890 marker) a drain PR's review **rides the NEXT landing**, otherwise the floor regresses
   forever one PR at a time. Discharge these next session.

3. **Two MEDs filed this session, both with reproducers ALREADY WRITTEN — the cheapest real work on
   the board:**
   - `g-selfhost-tokenizelogic-tdz-pos-before-initialization` — every `tokenizeLogic parity` case in
     `tab.test.js` throws `ReferenceError: Cannot access 'pos' before initialization`. The emitted
     inner closures reach `let pos` in its TDZ. **Pre-existing, PROVEN by the one-line emit
     differential** — it was simply invisible while the runaway killed the file first. Same shape as
     `tokenizeAttributes`, which works, so the two emissions differ in a way worth diffing.
   - `g-map-literal-in-fn-body-does-not-lower-in-library-mode` — a §59 map literal in a `fn` body
     compiles clean in `browser` and fails `E-CODEGEN-INVALID-LOGIC` under `mode:"library"`; `[:]`
     fails the same way. A/B-verified identical on `origin/main`, so it is not S411's doing.

4. **The CI-architecture items stay BANKED and are still bryan's surface.** `compiler/tests/self-host/`
   is run by NEITHER CI job — which is exactly why the runaway rotted for so long. The sequence peter
   ruled at S410 still stands: name-set baselines for `tracking` → an assertion-count floor → decide
   `self-host/`'s status EXPLICITLY (gated, or quarantined with a gate asserting it is still
   quarantined). ⚑ **All of it edits `ci.yml`, which is bryan's ACTIVE surface at the open #907.**
   Coordinate or route; do not take it under him.

5. **Standing directive from peter this session — surface autoMode blocks explicitly.** He does NOT
   want auto-mode or global settings changed. When the classifier denies an action, say
   *"blocked by autoMode"* with the exact command and let him clear it; he does so in one word. Do not
   engineer around a denial and do not silently drop the work. (Both merges this session were denied
   and cleared exactly that way.)

## WHAT LANDED

**Three PRs, every one gate-green — #921 · #923 · #924** (plus GitHub issue **#922** filed to bryan at
high priority). Board **HIGH 103 → 101 · MED 229 → 230 · LOW 86**. Review floor drained **9 → 0**, then
re-incurred its own 3. Counts are generated — read `docs/known-gaps.md`, never this line.

⚑ **THE HEADLINE: the S406 82 GB host lockup is ROOT-CAUSED AND FIXED**, and it was never bun and never
Windows. A `:` inside a regex **character class** was rewritten as a §59 map literal by
`preprocessMapLiterals`, a source-text pass that runs before acorn and therefore cannot know it is
inside a regex. `/[A-Za-z0-9_\-:@]/` emitted as `/__scrml_map_lit__(…)/` — valid JS, valid regex, and
**false for every ordinary input**. That made `tab.scrml`'s `isAttrIdentPart` always-false, so
`tokenizeAttributes`' attribute-name scan never advanced `pos`, and the enclosing loop re-entered
forever **pushing a token every pass**. Unbounded allocation at ~720 MB/s.

## 🔭 DURABLE

**A probe that fails its own CONTROL is reporting on itself, not on the code.** The semdiff reproducer
returned FALSE for all three cases *including the engine-bearing control the entry's model says should
already pass*. That disagreement — not the numbers — is what exposed that I had skipped
`canonicalizeSourceBasename` and was measuring `<title>alpha</title>` vs `<title>beta</title>`. **Build
the control in, and when it fails, suspect the instrument before the subject.**

**An inference drawn from an OBSERVATION is not the observation, and it propagates as though it were.**
The runaway entry recorded *"dies before the first test result, so it is in collection or the
`beforeAll`"* — true first half, false second half, and the false half reached the hand-off, the pickup
block and the boot digest as the prescribed starting method. A cut to setup-only runs 0.6 s at exit 0.
**A killed process never flushes; absent output is not evidence of where it died.**

**Bisect ACROSS the boundary, not just within it.** The prescribed method (halve inside the file) found
the failing describe blocks but could not have found the cause — both halves reproduced. What named it
was leaving the test runner entirely and calling the function directly, then splitting **JS-original vs
self-hosted**. The JS side returned in 1 ms; that single comparison converted "a bun/test problem" into
"our compiler's problem."

**Reuse the proven heuristic instead of writing a second one.** The fix needed a regex-vs-division
decision — genuinely hard. `regexAllowedAfter` + `scanRegexLiteralEnd` already existed, were already
IMPORTED BY THE SAME FILE, and were already used by a sibling scanner (the GITI-017 twin) for exactly
these three span kinds. Mirroring it cost nothing and cannot drift from the original; a fresh heuristic
would have become a second thing to keep in sync.

**A false alarm on your own fix is a finding, not an obstacle to route around.** Three of the new pins
went red and read exactly like "the fix broke map literals." A/B against `origin/main` showed
byte-identical failure on both sides — the fix exonerated **by execution** — and the real underlying
hole got filed instead of being quietly worked around by changing the test until it passed.

## ⚑ MISSES (mine)

1. **★★★ I laundered a figure into a review marker whose entire job is verification.** The #916 marker
   claimed the wrap's board counts *"MATCH the generated block read at this session's boot HIGH 102 MED
   227 LOW 86."* The committed block reads **MED 229**. I took 227 from the S410 hand-off **prose** and
   asserted it as a match against the **generated block** — a check I never ran. Corrected in place at
   `[2950]`; the wrap's own number was right for its moment. This is precisely the laundering trace
   `pa-base` §1 names, committed by the reviewer.
2. **★★ Three instruments of mine failed silently in the flattering direction before I caught them.**
   A `bun -e` probe whose `/tmp` path Git Bash resolves but bun cannot open — it produced NO output and
   would have read as "zero false positives." An `echo "pushed"` that printed after a **rejected**
   push, because `$?` read `tail` through a pipe. And a `gh pr diff --` invocation that errored into an
   empty result and would have read as "no status flips." **Same class as S410's six; the prior stands.**
3. **★★ I over-narrowed a predicate to the measured population.** The `WRAP_ERA` fix first keyed on the
   em dash alone because all 15 real era-form wraps use one. `state-session-close-suffix.test.js` caught
   it on `docs(s160): WRAP - the era form`. **A predicate built only from the population you measured is
   not the same as a correct predicate.**
4. **★★ I let a `cd` persist and change my working root** (`compiler/src/codegen`), the pa-base §6
   ambient-root trap. Caught before any dispatch, so nothing mis-routed — but the mechanism was live.
5. **★ Two pins were wrong on first write.** A `toBe` that over-pinned on a `(line N, col N)` locator the
   CLI strips, and three map negatives asserted in `library` mode where maps do not lower at all.
6. **★ I read a green number under a red verdict for one beat.** The first corpus differential printed
   `0 artifact content diffs` beneath `NOT A VALID COMPARISON`. I did not act on it — the fix was
   uncommitted so both sides reported the same revision — but the pull to quote the clean number was
   real, and that banner exists because someone did.

## Gate at close

Cloud `gate` **GREEN** on all three PRs and on main's last two pushes; `windows` green; `tracking` RED —
pre-existing, whole-job, and filed as `g-tracking-job-is-red-as-a-whole` (routed to bryan). Local on
merged main: conformance **905/905**, the four touched pin files **42/0**, `delta-lint` PASS max
`[2954]`, `facts --check` PASS, `state --check` PASS. Unit tier measured **18,475 pass / 1 fail**
mid-session — that one is `<api>` codegen, which passes **11/0 in 568 ms alone** against 5,030 ms
co-run: a co-run timeout flake on this clone, established by isolation.

⚑ **There is no "full local suite" target in this project, by deliberate design since S253** —
`bun test compiler/tests/` is a SUPERSET of what the gate covers. (S410 corrected itself on this; it
holds.)

**Maps (wrap 6c) — NOT hand-run, and that is deliberate.** `.claude/maps/primary.map.md` is at
watermark `e74f5423`; the refresh is owned by the **scheduled `cloud-maps` workflow**, which ran green
today at 09:28 UTC — i.e. BEFORE this session's landings at ~20:28 — so the next scheduled run picks
them up. That is the same designed latency the `#903` review recorded for the recent-sessions block:
a wrap cannot contain its own squash SHA, so the scheduled job closes it after the fact. Hand-running
`project-mapper` here would race it and produce a competing commit for no gain.

**Worktrees NOT swept — none are this session's.** Three remain (`agent-a0742fe4795045e91`,
`agent-a4e6b5f2562ae9eaa`, `onmount-c`) plus the `scrml-pinned` app clone; their work has not landed, so
per the wrap discipline they are retained and surfaced rather than removed. ⚑ The temporary `C:/s411base`
worktree cut for the corpus differential **was** removed at close.

---

# scrml — Session 410 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the `---` is prior sessions' (S408 mine, S405
> bryan's) and is untouched except two factual corrections inside S405 that are marked in place.
> **S409-bryan was LIVE throughout** this session (his lane: the `SPEC-INDEX.md` conflict class +
> CI-gate hardening, #905/#906/#907) — disjoint by construction, no collision.
> Full mechanical detail: `docs/changelog.md` S410 block and delta-log `[2929]`–`[2944]`.

## ⏭ NEXT-SESSION PICKUP

1. ⚑⚑⚑ **THE S406 82 GB LOCKUP HAS A NAMED CANDIDATE — AND PETER RULED THIS THE OPENER.**
   Verbatim: *"let's take care of it first thing next session."*
   `g-self-host-tab-test-is-an-unbounded-memory-runaway` (**HIGH**).
   **`bun test compiler/tests/self-host/tab.test.js` grows ~720 MB/s with no plateau** — the sentinel
   logged `commit 6.532 GB` then `KILL … holds 8.69 GB` **three seconds later**. At that rate it
   reaches 82 GB in ~2 minutes on a 32 GB box.
   ⚑ **RUN IT GUARDED** — unguarded it consumes the machine:
   `powershell -File C:\Users\pjoli\bun-guard\run-capped.ps1 -CapGB 6 bun test compiler/tests/self-host/tab.test.js`
   ⚑ **The 127-exit / 28-byte signature is `BunMemorySentinel` killing it**, not a bun crash.
   **Method is prescribed and it matters: bisect INSIDE the 526-line `tab.test.js`, halving under the
   cap until the allocating construct is named. Do NOT start from a hypothesis** — the three obvious
   candidates are already eliminated by measurement: the `tab.scrml` library compile (0.37 s, ~0 GB),
   importing the emitted `tab.js` (0.01 s, ~0 GB), and the sibling `ast`/`bpp`/`bs` files (all clean).
   It dies **before the first test result prints**, so it is in collection or `beforeAll`.
   Not bun and not Windows on the evidence; pre-existing, not introduced by S410.
   ⚑ **Read §CI ARCHITECTURE at the foot of this section before starting — it is the SAME problem.**
   `compiler/tests/self-host/` is run by **neither** CI job, by deliberate documented exclusion, so
   this runaway rotted *because nothing was looking*. Peter ruled the CI findings banked to ride with
   this: root-cause the runaway first, then close the two gating gaps recorded there.

2. **Review floor reads 7 OWED** (#909–#915) — the floor's own recursion, all this session's. Per the
   established pattern (see the #890 marker) a drain PR's review **rides the NEXT landing**, otherwise
   the floor regresses forever one PR at a time. Discharge these next session.

3. **The triage shortlist is banked — do NOT re-triage.** Top remaining pick:
   `g-semdiff-chunk-namespace-token-discovery-misses-every-non-engine-html-site` (MED, **fully inert**,
   instrument-only). `semdiff.ts:686-694` discovers the chunk-hash token from only 3 structural sites;
   four namespaced emission sites are missed — `emit-each.ts:581`, `emit-match.ts:1157`,
   `emit-html.ts:3957` (entry says 3906 — **stale**), `emit-logic.ts:4157`. Done-condition: an
   each-only / match-only / meta-only HTML artifact compiled at two paths canonicalizes byte-identical.
   ⚑ A **rejection table** for ~14 other candidates is in the S410 delta/PRs — each killed on a quoted
   entry-body blocker. That analysis is done; don't repeat it.

4. **Two HIGHs routed to bryan, both with reproducers, neither mine to fix:**
   `g-composed-route-drops-the-attr-tpl-effect` (a shell's reactive nav `href` ships dead into every
   composed route; the control is that the *same build* wires it correctly in the shell's own
   document) and `g-tenant-floor-inert-for-a-two-qualifier-create-table` (§14.8.10 silently inert for
   `db.schema.table`; a second table suppresses even `W-SCHEMA-NO-TABLES-DECLARED`). Also
   `g-7-5-2-no-row-for-annotated-plus-inference-defeated` (MED, spec-level).

5. **Deliberately left open, do not "tidy":** `g-recent-sessions-index-drops-named-session-wraps` —
   all four matching defects are FIXED, but the entry reserves the *mechanism* question for bryan (a
   session anchor could be a structured trailer instead of a regex over prose, S338 Rule 7). Closing it
   would erase a reserved ruling. Same for the `self-host-smoke` 12 vacuous guards: the recommendation
   is `skip` not `return`, but it is test policy on a known cross-OS baseline and should ride whoever
   unblocks `g-module-resolver-stdlib-root-uses-windows-fragile-url-pathname`.

## WHAT LANDED

**Seven PRs, every one gate-green** — #909 #910 #911 #912 #913 #914 #915 — plus **`flogence#6`
merged** (it had been recorded as landed in four places while sitting OPEN with no gate ever run).
Board moved **HIGH 99→102 · MED 226→227 · LOW 90→86**. Review floor drained **4→0**, then re-incurred
its own 7. Full detail in the changelog block; counts are generated, read them there.

## 🔭 DURABLE

**Every broken instrument this session failed toward GREEN. Six of them, and not one ever read as
worse than reality.** A gate printing `FAIL` while the shell said exit 0 (`tail`'s code, not the
gate's) · a PowerShell parse check passing **vacuously** over 21 real errors · a probe inflating a
defect **27%** because `[0-9]+` backtracks and eats its own digit · a "fix" improving the headline
3 fails → 1 **by breaking the module under test** · a test file printing **35 pass / 0 assertions** ·
12 parity checks silently no-oping on a null module. **If an instrument in this repo is wrong, the
prior should be that it is flattering you.**

**A precondition guard OWES a precondition assertion.** Now demonstrated three times in-tree. Without
it a harness disables itself and the only trace is the `expect()` count — a number nobody reads and no
gate checks. `browser-todomvc` had it right and was the model copied.

**The marker is an INDEX, not the record — read the entry BODY before writing code against it.** The
ledger caught the "obvious" fix **twice**: the session-index widening S404 had already warned would
still drop every PR-flow wrap, and the `module-resolver` `fileURLToPath` swap S341 had already tried
and reverted. Both times I had read the marker line and the `locus=`, measured the defect, and started
implementing. That is the governing-sentence failure in a different costume.

**Write the pin BEFORE the fix.** The `E-EQ-002` arc landed only because the test failed with a message
that was neither the old text nor the new one — exposing a **second emit site** whose advice was
semantically *inverted*. A fix written straight from the entry would have edited a site that never
fires for that input and "verified" it against a test that was never wrong.

**A green aggregate hides an isolated runaway.** S406 measured the whole tier at 2.433 GB and cleared
it; the runaway lives in one file that the tier-level number never surfaced.

## ⚑ MISSES (mine)

1. **★★★ I recorded `flogence#6` as "landed, all gate-green" in four places while it was OPEN with an
   empty `statusCheckRollup`.** A cross-repo PR's state was assumed from having *pushed* it rather than
   read back. Merged and corrected this session — and the correction was written **before** landing the
   PR that reported it, so my own fix would not ship a stale present-tense claim.
2. **★★ Twice I started implementing from a marker without reading the entry body** (above). Cost:
   one reverted `module-resolver` change and one nearly-wrong session-index fix.
3. **★★ I mis-sized my own guard within hours of writing it.** `bun-guard/README.md` and its memory
   both said `-CapGB 4`; the suite exceeds 4 GB here and was killed with `MemoryExhaustion`. Both
   corrected to 8 GB. The guard behaved exactly as designed; the number was mine and it was stale.
4. **★★ I misattributed a sentinel kill to a stale test baseline.** `exit=127` on the self-host tier
   was the sentinel killing a runaway — hours after I installed the very log that said so. I called it
   "pre-existing, not mine" (true) and stopped (wrong).
5. **★ I nearly filed two HIGHs that §7.5.1 explicitly sanctions** — `int` is *deliberately* outside
   the checked set. Killed on the governing SPEC text, but only because I read the whole section.

## Gate at close

Cloud `gate` **GREEN** on all seven PRs; `windows` green; `tracking` RED — pre-existing, verified red
on all four recent main runs. Local: `state.ts --check` 0 · `facts.ts --check` 0 · `delta-lint` PASS
max `[2944]`. `compiler/tests/lsp/workspace-l2.test.js` fails 5 (**pre-existing** — verified identical
against main's `emit-expr.ts`), `giti-016` is a **timeout flake** (runtime swings 1.02–7.67 s on
*identical* code, both sides), and the self-host tier is item 1 above.

⚑⚑ **CORRECTED POST-WRAP — this section originally read "No clean local full-suite pass was obtained,
and that is stated rather than papered over." That framing was WRONG, and it was mine.** There is no
"full-suite pass" target in this project — deliberately, since **S253**. `ci.yml:29` records that the
old CI ran `bun test compiler/tests/` (everything), went permanently red on known backlog, and was
split. `bun test compiler/tests/` is therefore a **SUPERSET of what the project gates**, and running
it locally is not a check the project makes. **I measured against a target that does not exist and
reported the mismatch as a shortfall.** See §CI ARCHITECTURE below — the real gaps are different and
sharper.

**Worktrees NOT swept — none are this session's.** Four remain (`agent-a0742fe4795045e91`,
`agent-a4e6b5f2562ae9eaa`, `onmount-c`, plus `scrml-pinned`); their work has not landed, so per the
wrap discipline they are retained and surfaced rather than removed.

## CI ARCHITECTURE — banked post-wrap, rides with the runaway next session

**Peter asked how to ensure a clean full-suite pass. The honest answer is that the project already
solved most of this, and the remaining gaps are not the ones I had been reporting.**

**The architecture that exists** (`ci.yml`), and it is a good one:

| job | contents | status |
|---|---|---|
| **`gate`** (BLOCKING) | unit + conformance · root-level parser/native · browser **name-set** gate · snippet · compile-floor · facts · SPEC-INDEX · delta-log · §34.0 | **green, and stays green** |
| **`tracking`** (non-blocking) | types gate · **integration + lsp + commands** — labelled *"promotion candidates"* | **known-red** |

`compiler/tests/self-host/` is in **NEITHER**, excluded on purpose (`ci.yml:23-27`): it needs a
locally-built, gitignored dist that **cannot be rebuilt on a clean checkout**, because the self-host
`.scrml` sources don't compile against the current compiler (`null` / `!==` / `try` — post-v1.0 work).

⚑⚑ **THAT IS WHY THE RUNAWAY ROTTED.** `tab.test.js` lives in the one tier nothing executes. It did
not survive *despite* the gate — it survived **because nothing was looking.** Pickup item 1 and this
section are one problem, not two.

**The mechanism is already proven here FOUR times** — `corpus-compile-floor.baseline.json` ·
`scripts/browser-baseline.ts --check` · `compiler/tests/TYPES-BASELINE.json` · plus the
facts / SPEC-INDEX / delta-log invariant gates. All **bidirectional**: fail on a NEW break *and* on a
stale entry. The browser gate's own comment states the principle, and it is the load-bearing one:

> *a permanently-red step is "useless in both directions at once" — a real regression is invisible
> (red either way), and a failed step HALTS the job, so every step after it was skipped… verified,
> not assumed.*

**GAP 1 — `tracking` still has the exact disease the browser tier was cured of.** It is red *as a
whole job*, so a genuine new regression in integration / lsp / commands is invisible — the same
argument one level up. `workspace-l2`'s 5 failures sit there indefinitely because nothing
distinguishes them from a new break. **Fix: a name-set baseline per tracking tier**, so it exits 0
while the failure set is unchanged and 1 the moment a name joins or leaves. That is what makes
promotion to `gate` possible at all.

**GAP 2 — no baseline asserts that tests actually ASSERTED.** All four check names, counts or exit
codes. `browser-reactive-arrays` would have passed every one of them while executing **zero**
assertions. An `expect() calls` floor per tier is the cheap addition, and it is the only number that
caught this session's vacuous passes (45→15 on self-host-smoke, 35→0 on reactive-arrays).

**Sequence (ruled by peter — bank now, execute next session with the runaway):**
1. Root-cause the `tab.test.js` runaway — a tier that kills the machine cannot be gated regardless.
2. Name-set baselines for `tracking`'s tiers → they begin carrying information; promote each to
   `gate` as it goes reproducibly green.
3. Assertion-count floor alongside each baseline.
4. Decide `self-host/`'s status EXPLICITLY — gated, or **quarantined with a gate asserting it is
   still quarantined**. Right now it is neither, which is precisely how this happened.

⚑ **Lane check owed before starting 2-4:** `ci.yml` is bryan's active surface (#907 is gate
hardening). Coordinate or route rather than editing it under him.

**Machine state:** the S406 bun guards are rebuilt on this clone at `C:\Users\pjoli\bun-guard`
(`run-capped.ps1` kernel Job-Object cap · `bun-sentinel.ps1` · `README.md`), both **bite-tested**, and
`BunMemorySentinel` is a live logon task. It earned its keep the same day — see pickup item 1.

---

# scrml — Session 408 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** The S405 content below is bryan's, and he was **LIVE at S407**
> throughout this session. The S401→S400 precedent is a wholesale `hand-off.md` rewrite eating a
> collaborator's pickup section, so this section is prepended and nothing below it is touched.
> Full S408 state: `../scrml-support/handOffs/active-sessions/S408-peter.md`.

**Date:** 2026-09-07/08. Booted `/boot` Profile A onto `6bd29d3d`. **Seven arcs landed, all
gate-green** — #890 · flogence#6 · #891 · #893 · #894 · #897 · #898. Mechanical detail lives in
`docs/changelog.md` and delta-log `[2925]`–`[2928]`; this carries only what those cannot.

## ⏭ NEXT-SESSION PICKUP

1. **The `!{}` guarded-expr lowering in library mode.** The sole residual of the class battery
   (13/14). It is now **loud** — #893 makes it fall back to raw rather than emit `let v = !{n};`,
   which is legal JS that is always `false` — but it is still unlowered. The obvious next in-lane target.
2. **The owed reproducer for `E-CG-SQL-FN-UNVERIFIABLE-SPAN`** (#898). The guard is provably inert
   (118/118 byte-identical) and therefore **UNEXERCISED** — its error path has never fired. A
   bad-span SQL fn cannot be built as a library file today, because a `<db src>` is markup and that
   makes the file non-`pure-module`. Two tests were attempted and dropped rather than shipped as guesswork.
3. **The eight native-parser mirror consts** can now be deleted — #897 names the collision precisely.
   That half is a source edit under `compiler/native-parser/`, a different owner's surface, so it is
   named rather than done.
4. **Dog-food an adopter app** — historically where fresh silent-wrong bugs come from, as opposed to
   mining the ledger.

## 🔭 DURABLE

**An instrument that reports zero is reporting on its own reach, not on the code.** Seven probes were
wrong before they were right this session, every one in that shape: a corpus differential blind to a
construct its population lacks (it scored three regressions clean); a `RESTORED = 0` that measured the
corpus's composition rather than the fix (the battery said 3/14 → 13/14); a text scan that could not
tell a module-level `const` from a fn-local one (it would have hard-errored 11 working builds); a
false-positive test that blamed an imported module's error on the input file, because `res.errors` is
unit-wide; a forced `mode:"library"` that returned 2937 library files out of 2574 scanned against a
true 118; and an API `compileScrml({write:false})` probe standing in for what actually ships, when the
CLI emit gate refuses the artifact loudly. **Ask what a zero measured before reading it as coverage.**

**A filed fix-direction is a hypothesis with a citation — including one you filed yourself an hour
ago.** Three needed re-deriving this session. The sharpest, `g-library-fn-decl-span-unverified-splice`,
said "lift the guard to all three splicers (cheap)"; doing that literally would have turned a
confidentiality boundary **fail-open**, because the SQL splicer prunes server-only `?{}` fns *out of*
the client-facing artifact.

**Contended-file collision is real, and the fixer is sanctioned.** bryan and I both appended
`[2915]`–`[2918]` to the delta-log and both appended to `docs/pr-reviews.md`; the pull conflicted.
Resolved by **union** (both files are append-only) plus `bun scripts/delta-lint.ts --fix`, which
renumbered **my** side — the correct side, since his were already pushed and checkpointed.

## ⚑ MISS (mine, this wrap)

**I truncated `hand-off.md` to 0 bytes.** A Python `open(path, "w")` truncates *before* the write, and
my write threw on a lone-surrogate escape (`🔭` for 🔭). Caught immediately by reading the
file back, restored with `git checkout --`, nothing lost — but only because the file was committed.
**A generate-then-overwrite script must build the full string before it opens the target for writing,
or write to a temp file and move it.** Three separate heredoc backslash-mangling failures earlier in
the same session pushed me toward Python for file edits; this is that choice's own failure mode.

---

# scrml — Session 405 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-07/08. Booted `/boot` Profile A onto `4d057a58`. **Successor to a LIVE S403-peter;
S406/S408-peter ran concurrently all session; bryan opened a THIRD session on the other machine.**
Mechanical state — landings, counts, the session stream — is in `docs/changelog.md` and
`handOffs/delta-log.md`. This file carries only what those cannot.

**The framing: a "free move" that took four rounds, two security arcs that took six and three, and
ONE failure mode wearing seven costumes.** Every substantive thing today was caught by an instrument
rather than by reading — and several caught *me*.

---

## ⚑⚑ THE DURABLE FINDING — unratified, and the reason to read this file

> **An enumeration's method being sound says nothing about its AXIS being complete.**

Seven instances today, each rigorous in method and wrong in axis:

| # | the enumeration | the missing axis |
|---|---|---|
| 1 | four delimiter tokens, probed exhaustively | the helper recognized a **fifth** (`/*`) |
| 2 | tokens × locations, all 20 cells run | the axis was **scan sites** (4 opener-blind loops) |
| 3 | **three independent proofs** of a sink population, all agreeing | all three enumerated the **mechanism**; the obligation is over the **data** |
| 4 | function-level analysis of in-class loops | the unit is the **loop** — 3 of 4 sit inside functions that also hold a *safe* loop |
| 5 | one normative grammar (`_` + `=`\* + `{`) | **five hand-spellings** at three levels of completeness |
| 6 | my own two-shape sibling probe | two probes are **members, not a population** |
| 7 | a test matrix built to stop uncrossed cells | **had an uncrossed cell of its own** |

⚑ **Arc A's version is the sharpest and belongs in `pa-base` if it goes anywhere:**

> *"All three enumerated over the MECHANISM; the obligation is over the DATA. A sink that never
> adopted the mechanism is outside all three frames at once, **so their agreement was one blind spot
> counted three times.**"*

**Three independent proofs agreeing is worth nothing if all three share an axis.** That is not the
same claim as "verify your findings", and no existing rule in the contract says it.

---

## ⏭ NEXT-SESSION PICKUP

### 1. Owed to bryan — the advisory queue, 6 items
**dpa-037** (NaN — he explicitly declined: *"ok hold on I am not ratifying NaN! TBC"*) ·
**dpa-040/041/042** (the `~` cluster — ONE root: `E-TILDE-001/002` have zero producers and have never
fired; rule as one item, and 042's Call 4 is the only genuine fork) · **dpa-043** (axiom, ladder row 7,
non-delegable; its Call 5 is a unanimous floor that costs nothing: *adjudicate `lift` vs `yield` in
writing in the SPEC whatever you rule*) · **dpa-045** (round 2 fired, verdict pending).

### 2. The deferred migrate/differ arc
`docs/changes/migrate-consumer-raw-ddl-2026-09-08/SCOPE.md` + gap
`g-migrate-consumer-not-raw-ddl-aware`. ⚑ **Its four findings are PRE-SPLIT measurements and do NOT
reproduce on main** — `diffSchema` is 902 code lines identical to `origin/main`, verified. Do not
open the arc by trying to reproduce them.

### 3. Two opener detectors nobody owns
`type-system.ts:473` (levels 0+1) and `lint-w-interp-in-raw-content.js:51` (level-0 **for every
sigil**) — the two survivors of `g-foreign-opener-grammar-hand-spelled-five-places` (~~HIGH~~ **MED**
— ⚑ corrected S410-peter: the same PR that wrote this line downgraded the gap to `sev=MED` in
`docs/known-gaps.md` on stated ground; the hand-off half was not updated). Both were
outside either arc's file boundary.

### 4. Carried, unchanged
The `${`-in-a-top-level-template ROOT (HIGH, ruling-gated — ⚑ **and dpa-045 round 1 measured it as
Class C, NOT closed by the camp ruling; do NOT defer it on dpa-045**) · the worktree sweep (**96
agent branches, 119 worktrees**) · `types-gate` RED on main with 12 pre-existing diagnostics ·
thread-board reports **1 ERROR**, uninvestigated.

---

## 🔭 DURABLE — what the session actually established

**A "free move" is a claim, not a category.** The apostrophe fix was scoped from a deliberation as
*"~35 LOC, the exact S196 delta, cannot break the corpus, already licensed."* It took **four rounds
and surfaced five HIGHs**, every one silent behaviour loss at exit 0. The deletion was right; the
*free* was wrong. ⚑ **The root nobody had: the string branches were doing DOUBLE DUTY** — also
shielding four opener-blind flat scanners from reading attribute interiors. That is why five prior
rounds by another session could not land it either: any fix addressing only the lexing half was
always going to break something else.

**A fix with no done-condition loses every scheduling contest it enters** (bryan-ratified, dpa-039
call 2) — and it recurred *twice more* the same day at a lower level. Arc A: *"the crossings are
GENERATED by the mismatch, so there is an unbounded supply."* Arc B: two of its own fixes cancelled,
closed by **deleting one side of the seam** rather than patching both. **Prefer removing a coupling
over patching a crossing** is the operational form.

**A green suite is not evidence.** Arc A's dedup test read `1` with *and* without the fix and was
caught only by disabling the fix to prove the bite. Arc B's narrow tenant suite passed after a
destructive edit had deleted `actualMap` — because it no longer imported the file. Arc B's own new
matrix asserted `cols[last]` and so stayed green on a bug that dropped `cols[0]`.

**Corpus-zero concealed three live defects today** — no corpus app pairs a predicated param with a
protect-free `<db>`; none pairs `protect=` with a mount-hydrate path; and odd-apostrophe prose *does
not compile*, **so the corpus is BY CONSTRUCTION free of the cases that prove the heuristic bites.**
That last one is dpa-045's own Call: **§4.18.2's frequency rationale is unmeasurable in principle on
a green corpus**, which cuts against the model it is the foundation of.

**Ratification is not verification.** dpa-028 was RATIFIED at S347 naming `chunks.json` as the
precache source; it advertises 3 chunk URLs and writes 1, so the ratified recipe makes `install`
fail and the cold boot fail completely. Caught only because the return leg was reproduced before
being posted.

---

## ⚑ MISSES (mine)

1. **★★★ A governing-sentence gate failure.** The free-move brief cited `SPEC.md:1090`'s second half
   as its licence. **The FIRST half of that same sentence says the opposite** — engine state-child
   bodies ARE code-default. The agent caught it and found a stronger §4.18.3 licence. **Quoting half
   a sentence whose other half contradicts you is exactly what the gate exists to make checkable.**
2. **★★★ An under-specified instruction opened a security hole.** I told arc A *"preserve non-plain
   values"* inside a fail-closed redactor without saying on which axis. It generalized *don't
   rebuild* into *don't look*, and a tagged row inside any class instance leaked. **A preservation
   instruction inside a security floor must state its axis.** The agent took more of the blame than
   I assigned and was right to: an ambiguous instruction at a security boundary is a signal to
   resolve it, not to pick a reading.
3. **★★ I partitioned the arcs by FILE and the defect spanned the partition.** The `_{}` opener bug
   sits in both `protect-egress` and `tenant-egress`, so **neither branch alone closed the class.**
   The ingestion-disjoint invariant protects against *interference*, not against a defect whose
   extent crosses the partition — and nothing in the contract catches that.
4. **★★ I repeated an inherited count.** The S404 hand-off said 15 advisory dPA items; it is **8**
   (dpa-030…036 were ratified between S347 and S365). I put 15 in the boot report before checking.
5. **★ Three delta-log sequence collisions**, one of them after I printed the tail and appended from
   a stale number anyway. The third came from a **rebase**, which is a new mechanism: the sequence is
   not rebase-safe and `--fix` is explicitly blind to which side was published.
6. **★ I mangled the dPA queue row twice** — wrote the status into the *id* cell (the item vanished
   from the probe), then displaced verdict text into col 3 whose *"NOT RATIFIED"* matches
   `classify()`'s `/\bRATIFIED\b/i`. Both caught by the probe's own count moving.

## Gate at close
Cloud `gate` **GREEN** on every PR this session. `tracking` RED — pre-existing dev-watcher class.
Gaps **HIGH 99 · MED 226 · LOW 90 · Nominal 7** *(at this PR's landing)*. Review floor **4 OWED**.
⚑ **Corrected S410-peter.** This line shipped `HIGH 101 · MED 224` while the *same PR's* second commit
set the `@generated:gap-counts` block in `docs/known-gaps.md` to `99 / 226`; `bun scripts/state.ts
--check` confirms 99/226/90/7 was the correct regen, so the hand-off was the wrong half. The
"(all peter's lane)" qualifier is also struck: of the four then-owed PRs, **#884 and #901 are
bryan-authored**. **Current at S410: HIGH 100 · MED 227 · LOW 90 · Nominal 7** (+1/+1 from the two
gaps this session filed and routed to bryan), and the review floor reads **0 OWED** — all four
drained. Read `docs/known-gaps.md`'s generated block, never this line, for live counts.
**Both adopter Direction issues CLOSED** — #509 after 23 days, #471 after 30.

⚑ **This wrap's PR is titled `wrap(s405):` deliberately, not left to `--fill`** — the branch form
produces a merge subject the recent-sessions matcher cannot see. Do the same next wrap.
