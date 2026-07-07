# scrml — Session 243 (CLOSE)

**Date:** 2026-07-06/07. **Profile:** A — FULL (`/boot`). A very large build session: 3 major compiler/stdlib features built + adversarially reviewed + landed, plus the realtime SPEC, the concurrent-session board v2, CI, and an external-adopter primer verify. Ran the last stretch CONCURRENTLY with **S244** on the SHARED local checkout (see the concurrency section). Mechanical stream → delta-log `[415]`–`[432]`.

## ⚠️ READ FIRST
- **PUSH-PENDING (standing "hold push" all session).** scrml **ahead 8** — all LOCAL, UNPUSHED. scrml-support **ahead 2** (board v2 `558e6a8`). flogence has ~5 uncommitted outbox notes I dropped (its operator commits). **Next boot / on authz: `git push` scrml + scrml-support → S147 coherence 0/0.** Per the board, **S243 pushes FIRST, then S244 rebases + pushes** its scanner-FP ref.
- **CONCURRENT S244 on the SHARED main** (same checkout, not a separate clone — the sharpest concurrency mode). S244 is a pre-wrap successor doing DISJOINT work (a boot-step fix + string-blind scanner FPs). Its boot-fix landed (`f817e44c`, on main below my realtime); its scanner-FP work is on worktree branch **`a43632668b0b276fe`** (held during my realtime land window; it re-stages + lands after I wrap). **DO NOT remove worktree `a43632…`** (it's S244's active work). S244 needs THIS hand-off to wrap (board serial-wrap ordering).

## ✅ LANDED THIS SESSION (S243) — all local, push-held
| Feature | commit | notes |
|---|---|---|
| Realtime **SPEC §38.13** `<channel watches=>` | `c6a3581e` | Nominal; the S242 draft applied + 4 cross-amendments + SPEC-INDEX regen. |
| **Oracle** block-analysis `members[]`/`bodySpan` (giti+flogence 1018) | `9e74cbe1` | S239: 2 correctness caught → fixed. |
| **Auth** flows + JWKS RS256 (BaaS #2) | `87555a5d` | S239: **12 findings over 2 rounds, 6 security** incl. a fix-INTRODUCED TOCTOU → fixed. 70 tests. |
| **Realtime `<channel watches=>` Phase 1** | `52c5afec` | front-end (recognition+typer+RowChange+`<onchange>`+6 codes). S239: 5 correctness → fixed. SPEC examples fixed pipe→angle-bracket. |
| Concurrent-session **board v2** | scrml-support `558e6a8` | H1 footprints + H2 lease/CAS + H3 claims.md (1817). |
| CI ask-1 · primer-verify (1749) · bookkeeping | `c6a3581e`,`40fa7303`,`b6fa4c03` | 4 gaps filed. |

## 📋 NEXT-START / OPEN THREADS
1. **PUSH** (scrml ahead 8 + scrml-support ahead 2) on authz — S243 first, then release S244 to rebase+push.
2. **Realtime Phase 2 — the RUNTIME** (the big remaining realtime piece): trigger-DDL emission (AFTER INSERT/UPDATE/DELETE + `pg_notify`) in `schema-differ.js`; the server-side Postgres **LISTEN bridge** (per-instance LISTEN + re-SELECT-by-PK + `__change` publish) in `emit-channel.ts`/`emit-server.ts` (reuse `collectDbScopes`); the client `__change` → `<onchange>` dispatch codegen. `_rowChangeSynth` is already stamped on the watches-channel node (Phase-1 handoff). Postgres-only; hard to test (needs PG mock/real). Adversarial /code-review on landing (S239).
3. **CI ask-2 (SURFACED — user decision):** port the docs-only pre-push scope-fix into source-controlled `scripts/git-hooks/pre-push` (CLAUDE.md-protected gate) + the fast-feedback topology call.
4. **4 gaps to triage:** [[g-block-analysis-emit-foreign-underscore]] MED · [[g-http-client-inline-private-helper-drop]] MED (general `scrml:http` client-inline `_request` drop) · [[g-native-parser-5th-export-hoist-drop]] LOW · (realtime `g-realtime-external-db-writes` now Nominal, Phase-1 landed).
5. **MAPS REFRESH OWED** (deferred this wrap — project-mapper stages into the shared index, unsafe with S244 concurrent). Refresh at the next CLEAN session; watermark trails (66a3afb1 / 2026-07-04, now ~40+ behind).
6. The **S241 tail** (still owed, `hand-off-s241.md` §NEXT-START): residual-D, F3, 6nz dev-reload, the R26-sweep 11 live gaps, 8 S241 gaps. BaaS #4 blob storage + the worth-building set; MED/LOW backlog + Nominal (S219).

## 🧭 METHODOLOGY / ANOMALIES (irreducible — the reasoning, not the state)
- **S239 adversarial /code-review earned its entire keep this session: ~19 real bugs (6 security) across 3 codegen/stdlib builds, ALL on full-suite-green + clean-self-review diffs, NONE shipped.** The re-review-after-EVERY-fix-round discipline is load-bearing — an auth fix round *introduced* a TOCTOU (peek→consume-last reopened single-use); only the re-review caught it. Doctrine confirmed at max value; keep re-reviewing every fix round, especially on auth.
- **SHARED-MAIN CONCURRENCY (S244) — new methodology finding.** Two Claude instances on ONE checkout (shared working tree + index + HEAD) is past what the board v2 (designed for cross-machine push-CAS) safely automates. What worked: **explicit-pathspec commits** (my `git commit -- <my files>` took only mine, no sweep) + **footprint-disjoint files** + a **coordinated land window** (user had S244 hold commits). What bit: a partial-pathspec commit RESETS the index+worktree for UNSPECIFIED paths — so S244's staged scanner work reverted to HEAD when I committed (recoverable — it's on branch a43632; S244 re-file-deltas). Lesson: on a shared checkout, the concurrent session must keep its in-flight work on its worktree BRANCH (not staged in the shared index) during the other's land window; explicit-pathspec is necessary but the partial-commit index-reset is a sharp edge. Consider routing this to flogence (the board's durable owner) as a shared-checkout addendum.
- **S90 CWD-slip fired once:** a `cd` inside a FAILED (`&&`-chained) command did NOT persist — CWD silently stayed in scrml-support; caught when a relative-path grep missed. Assert `pwd` before dispatch AND before relative-path ops after any sibling-repo bash.
- **SPEC self-consistency (Rule 4):** my §38.13 amendment shipped `<onchange>` examples in the PIPE form while the prose referenced §18.0.1/§61.2 (angle-bracket) — the impl agent caught it; examples corrected in the Phase-1 landing. Watch example/prose consistency in future amendments.
- **Background-commit for compiler-source** (dodges the config-B post-commit full-suite hang; verify HEAD/coherence on the completion notification, not immediately).

## 🚦 STATE @ CLOSE
- **git:** scrml HEAD `52c5afec` (ahead 8, UNPUSHED). scrml-support `558e6a8` (ahead 2, UNPUSHED). Branch = main both. Working tree at wrap: continuity docs + BRIEF-P1 + S244's untracked `string-blind-scanners/` dir (NOT mine — leave it).
- **Board (@generated):** HIGH 0 · MED 21 · LOW 16 · Nominal 8. Suite: pre-commit gate green at each landing (realtime P1 gate 19516/0).
- **Worktrees:** cleaned MINE (a3f7 oracle · a76a realtime · ab41 auth). **KEPT: a43632 (S244's active).** Stale branch `worktree-agent-a132de9f…` (no worktree) left as-is.

## pa.md directives in force (Profile A)
R1–R5 · S239 adversarial + re-review-every-fix-round · S138 R26 + PA-direct dual-verify · S215 · S67 file-delta + S226 (+ the shared-main explicit-pathspec lesson) · S147 coherence · S88/S90/S99/S126 · S136 BRIEF archival · S219 orchestrate + default-GO · S43 cross-machine · the concurrent-session board v2 · commit-to-main only after explicit authz (given S243; push held).

## Tags
#session-243 #close #3-baas-builds-landed #realtime-38-13-p1 #oracle #auth-baas2 #s239-19-bugs-6-security #toctou-caught #shared-main-concurrency-s244 #push-held #maps-deferred #realtime-p2-runtime-next
