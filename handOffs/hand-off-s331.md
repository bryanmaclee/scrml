<!-- ============================================================= -->
<!-- S331 WRAP (bryan/ASUS-Vivobook) — prepended 2026-08-09.        -->
<!-- CONCURRENT with S332/S333/S334-peter; main moved under me      -->
<!-- FIVE times. Disambiguate sessions by NAME, not number.         -->
<!-- Mechanical stream = delta-log [1286]-[1300].                   -->
<!-- ============================================================= -->

# scrml — Session 331 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-08/09. `/boot` Profile A FULL. **6 PRs merged** (#479 #480 #481 #482 #483 #486) + the scrml-support delta-log retirement. Review floor **0 OWED**. Gaps **HIGH 26 · MED 126 · LOW 56**. Mechanical state → delta-log `[1286]`–`[1300]`.

## 🔴 READ FIRST

**1. The freeze campaign is still PAUSED** (S322). Unchanged.

**2. ⚑ MERGE AUTHORITY IS NO LONGER A PER-SESSION GATE.** bryan, S331 verbatim: *"if it is clean, all green, adversarial passed. then merge, always. At this point my merge auth is an arbitrary gate. unless the thing is still in question."* Recorded as a third STANDING authorization in `pa-profile-bryan.md`. **The carve-out is the operative half** — unadjudicated findings, an unresolved fork, a pending ruling, or a DO-NOT-LAND awaiting re-review all still hold. **The remaining gate is the QUESTION, not the PERMISSION.** Do not re-ask on clean-green-passed work; that is the behaviour this replaced.

**3. ⚑ bryan OPENED THE COMPILER-ARCHITECTURE QUESTION and it is banked as dpa-024, live on main.** Not a rewrite decision — a characterization plus one charter question. **The distinction he drew is load-bearing and must not be blurred: the limit is NOT in the language** (*"not the language in my head, that was always basically like this"*) — it is in architecture built under an earlier, smaller understanding of it. Language design is explicitly OUT of dpa-024's scope.

**4. There is no inherited backlog and no rescue owed.** Everything landed or explicitly retained below.

## 🎯 THE ARCS

**1 — #479, the §18.5 block-arm.** Two unrelated single-point defects, both silent, both past a green suite and a clean differential. (a) `_splitBlockStatements` split only on `;`/newline at depth 0, so a tail FOLLOWING a block statement was swallowed → the IIFE fell off its end → `undefined`. **Separator dependence, not position dependence** — the tail lifts the moment a `;` precedes it, which is exactly why the corpus never tripped it. (b) `_emitForStmtWithTilde`'s fallbacks dropped the OPTIONS ARGUMENT; `declaredNames` was merely the visible loss, so a nested `a = 1` emitted a shadowing `const a = 1` (silent wrong value) and `a = a + 1` a TDZ that `node --check` ACCEPTS.

**2 — #480/#482, the review floor drained 9 → 0.** First time at zero with every code-bearing PR given a real pass rather than a bare `clean`. #473 was CLEAN *and closed the class* (repo-wide grep for the broken form → zero remaining sites). #474's pass was DISPATCHED not eyeballed, because `emit-server.ts` is a text pass over generated output — 3 gaps, 2 HIGH, zero regressions.

**3 — #481, the code-bearing carve-out rate.** S328 recommended it and left it unbuilt. Building it found something bigger: **the scan was silently truncated and had been for the probe's whole life** — `--limit` defaulted to 40, the in-scope population is **90**. Root-fixed by auto-widening until the scan provably clears the epoch.

**4 — #486, the derived-cell RHS server-only reach.** A derived cell reaching `scrml:auth` compiled clean, emitted no `.server.js`, and pulled the real argon2 implementation into the shipped runtime (bundle differential 0 vs 4). **Closes ONE of four non-function positions.**

## 🧭 FINDINGS THAT OUTLAST

1. **★★ MY ARCHITECTURAL HYPOTHESIS WAS REFUTED BY AN AGENT I DISPATCHED TO REFUTE IT — and the refutation is why dpa-024 is worth running.** Claim: raw-text seams are the recurring defect generator. Falsified three ways, all PA-verified: **seam density ANTI-correlates with defect density** (the most seam-dense module in the repo carries 2 ledger mentions; the noisiest is seam-light with 63) · **71% of the 195 open markers are neither limb** · **the detection confound is real and FIVE DAYS OLD** (the instruments that found all six observe only emitted text). **One of my six I had not even observed — I inherited its framing from a routed message and counted it as independent evidence.**
2. **★ Three separate agents corrected me on something load-bearing, every time because the brief carried a verify instruction.** The §18.5 axis was arm-FORM not value-POSITION (my reproducer was confounded — variant arms parse to `structuredBody` and are immune) · my escalation locus was narrower than the real cause (`collectFileFunctions` yields `function-decl` only, so **every** non-function position misses) · my migration measurement used a grep where execution was available and got 14 instead of 59. **The safeguard held, not my accuracy** — third consecutive session recording that sentence.
3. **★ A security diagnostic whose fastest workaround reopens the hole is worse on that axis than no diagnostic.** #486's error fires on `const <h> = …`; **delete one keyword** and the leak returns silently. An adopter makes the smallest edit that stops the red text. Fixed by refusing the workaround IN the message, interpolating the adopter's own cell name.
4. **★ An instrument I cited as evidence in three PRs documents a guarantee it does not provide.** `corpus-emit-differential.ts` claims no absolute-path leak so it compares byte-exact with no normalization — but the chunk-scope ID is path-DERIVED. ~1009 false diffs across two checkouts. **The claim is the defect.**
5. **A gap closed by enumerating one dimension reads as closed on all of them.** #469/#470 enumerated the five value POSITIONS correctly and left tail-SHAPE and nested-statement-FIDELITY open. The generator of both was separator dependence, which no positional enumeration surfaces.

## ⚠️ OWN MISSES — recorded, not smoothed

- **I filed a four-position table that was wrong**, and shipped it to Peter before verifying. Corrected by message.
- **I scoped #479 as "unify three routes." The agent argued against it with measurement and was right** — neither defect was caused by route multiplicity.
- **Two of my three named loci were wrong** in that brief.
- **Four tooling defects of my own**, all caught by reading output, none by a gate: a cry-wolf truncation guard · an unquoted `--include=*.ts` eaten by zsh that reported a false ZERO · a commit message whose embedded `"` closed the `-m` argument so git read the rest as pathspecs and **silently did not commit** while the wrapper reported success · a percentage threshold too permissive to fire.
- **I half-dismissed the detection-artifact explanation** when I first raised it. It was the strongest counter-argument and it was five days old.

## 🧷 STATE / OPEN

**⛔ OWED BY BRYAN — 14, and the two axiom-level ones deserve a warm session:**
1. **dpa-024's Q4 — Road-B's charter** (the one with a clock; every session Road-B advances on parity costs more)
2. **`g-cell-initialiser-and-markup-interp-server-only-reach-do-not-escalate`** — escalate or refuse? The derived rationale does NOT transfer (a derived cell is a synchronous pull and *cannot* escalate; a one-shot initialiser has no such constraint)
3. **SPEC §6.6.19's message-SHALL** — ratify or veto; ONE hunk, precedent is §12.4's `E-ROUTE-005`
4. **The derived-position body contract** (Q2) — the measurement reframed it from ergonomics to confidentiality
5. **Peter's §6.8 fork** — `g-implicit-cell-double-write-clobbers-reset-init`: two structurally identical sources want opposite reset targets; the discriminator is INTENT, not form
6. **`g-263`** cross-file-const seed convergence (Peter, held, prior art pushed)
7. `_scrml_reset` awaits its thunk (HIGH) · 8. `g-session-context-scan-bare-form-sound` · 9. `g-session-get-reserved-key-read-disclosure` · 10. `g-match-nofor-block-form-skips-exhaustiveness` · 11. `g-match-block-empty-arm-yields-object-not-void` (11 sites measured; a MIGRATION)
12. **dpa-023's `pending` rung** · 13. **dpa-022's routed fork** — both axiom-level, one-at-a-time by the no-batch floor
14. **The if-value B ruling's BUILD** — Peter pushed `worktree-agent-ad7fea65da10675c1` @ `5fc00afa`; it is bryan's to land as the §17.6 amendment with `provenance: ruling:user-voice-scrml.md S331`. **Rebase it over #479 first** — that branch is at base `b4fb2f1f` and #479 touched the same §18.5 tail-lift routes.

**Base-amendment candidate:** a brief committed on a FEATURE BRANCH is not in the worktree — the worktree is cut from the repo's HEAD, not the current branch. pa-base v2.11 §5's operative requirement is *commit it to the ref the worktree will be cut from*. Cost: the agent had to `git checkout <branch> -- <file>` to read its own brief.

**Concurrency note:** three Peter sessions ran inside mine and **S333 registered as "successor to presumed-stopped S331-bryan"** — I was blocked on a dispatch, not dead. Corrected on the board. Also: **#485 landed between my gate going green and my merge command** — "green gate" is not "still mergeable" under PR-cadence concurrency, and that gap bit twice today.
<!-- ============================================================= -->
<!-- hand-off.md ROTATED at S333 (peter/Windows) 2026-08-09.        -->
<!-- Prior accumulated hand-off (S277–S332, 389 KB, over the        -->
<!-- 256 KB single-read cap) archived → handOffs/hand-off-s332.md.  -->
<!-- This is a FRESH hand-off; older wraps live in handOffs/.       -->
<!-- ============================================================= -->

# scrml — Session 333 (peter · Windows) — WRAP

**Date:** 2026-08-09. `/boot` Profile A FULL. **2 MEDs landed** (#476 #477). main `79fdfd07` → **`41a6ea8b`**, coherence 0/0 both repos. Conformance **874/874**. Both cloud gates GREEN incl. Windows CI. Mechanical stream = delta-log **[1279]–[128x]**.

## 🔴 READ FIRST

1. **hand-off ROTATED this session** (the S331-flagged debt): the fat 389 KB file is now `handOffs/hand-off-s332.md`; this fresh file starts clean. Older wraps: `handOffs/hand-off-s276.md` etc.
2. **S331-bryan liveness — RESOLVED as presumed-DONE for working purposes.** His board still says `LIVE`, but he has landed NOTHING since S330 (#472) across THREE of my successor sessions (S332, S333) spanning 2026-08-08→09; 0 open PRs, 0 conflicts, gates clean. **I therefore cleared the deferred shared-surface bookkeeping this wrap** (below) — safely, because every such edit rides the gate-serialized continuity PR, so any live-bryan conflict surfaces at rebase, never a silent clobber. If bryan resurfaces with unpushed S331 work, the delta-log + this note explain what moved.
3. **⛔ Two things STILL HELD for bryan (unchanged, do NOT take as compute):**
   - **if-value block-tail LANGUAGE FORK** (S330) — SPEC §17.6.2 lift-vs-§18.5 tail ruling. Green build preserved on a worktree (see Worktrees below). Routed: `scrml-support/handOffs/incoming/2026-08-07-2256-...if-value-block-tail-language-fork.md`.
   - **g-263 cross-file-const substrate** (S332) — his §14.8 lane; verified core on branch `fix/g263-cross-file-const-attr-value-seed`@`b9d68190` (pushed, unmerged). Routed: `.../2026-08-08-...cross-file-const-seed-convergence.md`. The stdlib `import.meta` gap is the same substrate (folded in).

## 🎯 WHAT LANDED — 2 disjoint-compute MEDs, each through 3 adversarial S239 rounds

- **#476** (`d2e27ba7`) — `g-esql006-prepare-emits-runtime-throw-no-compile-diagnostic`. `.prepare()` on a `?{}` result in a server fn now fires **E-SQL-006 at COMPILE time** (SPEC §44.3/§34 SHALL), was runtime-only. A dedicated `preparedStmtErrors` collector drained at every server-fn emit site (single function-scoped collector in generateServerJs, deduped tail drain → create-without-drain structurally impossible). **S239 caught a silent PARTIAL fix twice** (8 sites → 1 → 0). 5 new conformance pins.
- **#477** (`41a6ea8b`) — `g-nested-each-in-match-arm-drops-diagnostics`. Read-side diagnostics (E-STATE-UNDECLARED) now fire on ANY read in a `<match>` arm containing an `<each>` (broader than the entry's "nested" framing; entry mis-filed locus SYM PASS 3 → actually **TS stage**). ast-builder stamps the blanked arm body (blanking + S153 double-emit-guard UNCHANGED); type-system re-parses read-only + walks via visitNode. **S239 caught 3 real leaks** (nodeTypes memo poisoning via id-collision, bogus span.file, depth-2 mislocation) — all closed. 6-test unit regression + 1 conformance pin.

## 🧭 METHOD NOTE THAT OUTLASTS

**The mandatory pre-landing S239 gate caught real correctness bugs SIX times across two fixes** — a silent partial fix (#476) and a silent type-memo corruption (#477) — every one of which would have shipped on the implementation agents' green self-reports. Independent-oracle + adversarial-before-land is not optional; the self-report is never the gate. Also (recurring): the MED shortlist is unreliable — this session 2 candidates repro'd to language/catalogue RULINGS and 2 to already-fixed STALE-OPENs; repro+SPEC-gate BEFORE dispatch caught all four. [[scrml-med-shortlist-gaps-stale-verify-first]] · [[verify-the-bug-class-not-just-reported-instance]] · [[s239-review-falsify-the-claim-dont-confirm-a-hypothesis]].

## 🧷 STATE / NEXT

- **Worktrees (6b):** NONE created by S333 (my agents ran in the main tree → nothing of mine to prune). Present: `agent-a0742fe4795045e91`, `agent-a4e6b5f2562ae9eaa`, `onmount-c` (bryan's feat/onmount-c-build), `scrml-pinned` (app-pinned, leave). **⚠ The S332-recorded if-value worktree `agent-ad7fea65…`@`5fc00afa` is NOT in the current list** — either externally pruned or the id changed; the if-value green build may need re-locating from branch history before bryan rules. Did NOT prune anything blind. Needs a coordinated worktree reconciliation.
- **Maps (6c):** all changes are in-file (type-system re-parse helpers, emit-server collector, codegen sinks) in already-mapped files; no new files/modules → file/task-shape maps need no dispatch. Symbol-level refresh optional.
- **Ledger cleared this wrap:** #476 + #477 gaps → resolved in known-gaps.md; the 2 STALE-OPENs (`g-region-bodies-emit-in-bucket-order`, esql006 defect-B) → resolved; the 2 RULING corrections (composite-unique §39.2 grammar, epa001 §34 taxonomy) noted as ROUTED-TO-BRYAN; review-floor entries for #476/#477 recorded (both got 3× pre-landing S239).
- **Next pickup (Peter, "grab the next one"):** more disjoint-compute MEDs remain, but each is running deep (repro→scope→3 S239 rounds). Pre-filter off bryan's substrate (§13.2 auto-await, g-263 export-const, session/soft-nav/hydration, §34 catalogue-truthfulness, SPEC-vs-SPEC rulings). Re-survey `docs/known-gaps.md` MED with repro+SPEC-gate FIRST.
- **Waiting on bryan:** if-value fork ruling (S330) · g-263 convergence approach (S332).
