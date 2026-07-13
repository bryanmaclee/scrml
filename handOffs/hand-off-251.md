# scrml — Session 251 (WRAP) — landed 4 arcs + a full pre-V1 strategic plan (5 DDs ratified)

**Date:** 2026-07-12. **Profile:** A (`/boot`). **Successor to S250** (booted concurrent, took over main
after S250 wrapped). Two-phase session: **(1) execution** — landed + PUSHED four arcs; **(2) strategy** —
reframed the whole pre-V1 push around a flogence-tandem release + ratified five design DDs. Next session =
EXECUTION against the ruled backlog.

## ⚠️ READ FIRST
- **EVERYTHING IS PUSHED. origin/main == HEAD == `af6da1ee` (0/0 coherent).** No push-hold. The NUL-fix commit
  `af6da1ee` sat 1-ahead → **this wrap pushes it** (verify 0/0 at boot).
- **THE PLAN-OF-RECORD is `../scrml-support/docs/pre-v1-execution-board-2026-07-12.md`** — read it first next
  session. It carries the reframe, the tandem-critical tracks, the freeze-blockers, the SPA tail, and the
  execution classification. The five DD design docs are in `../scrml-support/docs/deep-dives/*-2026-07-12.md`.
- **commit-lock: RELEASED at this wrap** (S251). Next boot: `commit-lock.sh status <your-S-num>` → FREE → acquire.
- **ONE open input gates Track A:** **Fork 3** — is flogence's MCP stdio leg (`fsp-mcp`) a v1 tandem gate or
  fast-follow? Answer unblocks the server-shape dispatch.

## ✅ LANDED + PUSHED THIS SESSION (all on origin @ af6da1ee)
1. **Fork A — the server-fn/client-cell "SPLIT"** (`47ea59ac`): a huge design arc (C→A→split). E-REACTIVE-003
   fires on a WHOLLY-server fn reading a free client cell (error, pass-as-arg); a CPS fn (form-submit idiom)
   MARSHALS the reads. **Fixed a systemic bug: the canonical form/login idiom silently POSTed `undefined`**
   (verified react-auth login hashed undefined). §52 `<x server>` is CLIENT-HELD (§52.4.2). @session/@currentUser
   never client-marshalled (spoofing guard). +9 conformance. Adversarially reviewed (anti-drift verified).
2. **#26 P0 Windows auth-bypass** (`66483cdf`): `isStdlibFilePath` hardcoded `/` vs native `\` → the async-stdlib
   classifier failed on Windows → verifyPassword shipped un-awaited → accept-all. Fix = separator-normalize +
   a Windows-simulating regression test. **Root-caused, fixed, and replied to Peter on the issue** (posted as
   bryanmaclee, comment 4951048439). Issue still OPEN pending Peter's clean-build confirm.
3. **Conformance +19** (`f8336f07`): capability/error-boundary/lifecycle/loop/table-for. Surfaced (board-logged)
   §49 loop divergences: E-LOOP-003/004 disabled (braceless-if FP), **E-LOOP-007 inverted** (fires on the
   SPEC-valid lift form, silent on the error form) — parser-entangled, backlog.
4. **Navigate Wave-1b** (`0a41a327` merge): same-chunk soft-nav complete. #5 shell-reset showstopper + #7
   input-handler leak + #4/#6/#9, and a **NEW security-adjacent mode-inversion** (a `match`-arm `navigate(.Hard)`
   was still soft-navving a forced auth redirect) — S251-adversarially-verified robust. #8/#3 deferred (gzip-gate/invasive).
5. **NUL-fix** (`af6da1ee`): `rewrite.ts:143` carried a raw 0x00 (a real cache-key separator stored as a byte,
   not an escape) → the file classified as binary → grep silently dropped matches (bit two reviews). Escaped it,
   behavior-identical. rewrite.ts is now grep-able text.

## 🧭 THE PRE-V1 REFRAME (bryan, S251) — read the board doc for the full plan
More runway before freeze (flogence must **release in tandem** with scrml V1). Spirit: **"do it right, go all
the way"** — pull v1.next into V1 *where flogence exercises it*. flogence sweep corrected two assumptions:
**local-first** (§58 cloud-deploy NOT tandem-blocking) + **single-page** (navigate 2-3 NOT tandem-driven).
**Tandem-critical = Track A (server-shape) · §65-W2→#7 (floStyle) · the lang-gap fixes + coupled-CI.**

## 🔬 FIVE DDs RATIFIED (bryan: cruxes + defaults) — designs banked, BUILDABLE
Anchors + cruxes ruled; DD-recommended defaults taken on the rest. Full ruling sets in the docs.
- **#5 server-program-shape** = **1A** (`kind="tool" serve=`); ~80% exists; load-bearing = 2A decouple
  emit-server. **OPEN Fork 3** (stdio v1-gate?). ⚠️ concentrates in `emit-server.ts`/`route-inference.ts` —
  navigate's files → do NOT run navigate concurrently with Track A.
- **#7 style-provenance** = **data-scrml-sid**; GATED on §65 Wave-2 `<theme>` parse (unbuilt).
- **Cask-0** = freezes STRUCTURE-not-content → **CUT-NOW** (un-gated by coverage). Crux D2 (schema-vs-content
  split). Net-new = surface→daughter ownership map. Freeze = cross-repo tag pair. flobase mechanics → flogence inbox.
- **protect-denylist** = overloaded-null → total-classify-UNKNOWN-strips; crux R-4 (scoped-strip + named warning).
  ⚠️ conformance `protect/` has ZERO guard for the 6 leak shapes → ship red-then-green.
- **typer-soundness** = HALVED (anon-struct-poison is a MISDIAGNOSIS); real bug = hostmethod-return-asis;
  fix = Option-D curated host-method table (+ a GCP3 mirror for the equality silent-accept).

## 📋 NEXT SESSION = EXECUTION (from the board doc)
Buildable now: **Cask-0 cut** (un-gated, PA-direct — author the ownership map + D2 split + cross-repo tag) ·
**protect-denylist** (lock-PA, red-then-green) · **typer Option-D** (concurrent/SPA) · **Track A** (pending
Fork 3, off-navigate) · **§65 Wave-2 → #7** (concurrent). **SPA queue**: coverage-tail · ~66 negative-space +
~40 engine cases · standing-gaps (19 MED/16 LOW) · string-blind fixes · fail-variant-arity E-TYPE-082 · flush ·
#25 Windows pathFor · doc-debt (drop E-ATTR-012 · E-ERROR-010 rows). **Owed infra:** coupled-CI (flogence vs
scrml HEAD). Also open: navigate Wave-1c/2/3 (lower urgency, scrml-completeness).

## 🔬 METHODOLOGY (the irreducible)
- **Commit-lock: trust the tool, never `ps`.** Booted, `status` said HELD-by-S250-leased; I over-rode it with a
  dead-pid `ps` check and inferred a crash — S250 was live. The exact anti-pattern the lock exists to kill. The
  acquire-time pid ROTATES; the lease is authoritative. [[feedback_commit_lock_main_authority]] hardened.
- **Read the FULL adopter thread before posting.** Posted the #26 Peter reply off the tail; it held only because
  I'd root-caused from code independently. Read the whole issue next time.
- **Adversarial review keeps earning it.** Fork A's agent had carve-out holes TWICE (§52 exclusion, CPS marshal
  premise) that green masked — caught by compiling + inspecting emitted artifacts. Wave-1b's mode-inversion +
  the same. Green ≠ complete. [[feedback_adversarial_verify_not_confirmatory]]
- **DD-ahead-of-execution paid off:** verify-before-claim SHRANK two freeze-blockers (typer halved via
  misdiagnosis; Cask-0 cut-now). Deliberate hard arcs before building.

## 🚦 STATE @ CLOSE
- git: scrml main `af6da1ee`, pushed (0/0). scrml-support: this wrap commits the 6 DD docs + board doc +
  user-voice S251 + design-insights + board files, then pushes. Conformance **386/386** · gate green at close.
- lock: RELEASED (S251). worktrees: cleanup attempted this wrap (dry-run first; ~20 present).
- No live sibling PA.

## pa.md directives in force
R1-R5 · S239 adversarial (incl PA-side) · S138 R26 empirical · commit-lock (trust-tool-not-ps) · commit-to-main
after authz · orchestrate-don't-grind + default-GO · DD-ahead-of-execution for hard arcs.

## Tags
#session-251 #four-arcs-landed-pushed #fork-a-split #issue-26-p0-fixed #navigate-wave1b #pre-v1-strategy
#five-dds-ratified #flogence-tandem #cask0-cut-now #typer-halved #do-it-right
