# scrml — Session 220 (CLOSE)

**Date:** 2026-06-25. **Profile:** A — FULL. **The external-adopter battery session.** Booted clean; ingested **Ryan's (rjantz3) 10-finding Cheese-Craft auth-app battery + 4 flogence cockpit findings** → ran **4 sPA lanes** (each-codegen · `<endpoint>` · render · auth-wall) → dispatched **2 HIGH codegen fixes** → **EVERY adopter HIGH fixed, verified, and closed on GitHub.** Closed at **HIGH 0.**

> **Mechanical state → the delta-log + the digest.** This hand-off carries the IRREDUCIBLE (narrative · open threads · recovered anomalies). The fine-grained stream is `handOffs/delta-log.md` [75]–[88] (S220). The board/counts: see below + `bun scripts/state.ts`.

## 🚨 NEXT-START — the flogence digest-boot is FIXED (S219's broken experiment)
The S219 digest-boot was BROKEN on first use (`SQLITE_CANTOPEN` — CWD path bug). **I fixed it** (`flogence dbc34d9` — `dbPath = import.meta.dir + "/../flogence.db"`). It WORKS now (renders the ~1k-token recent stream). **S221 boot SHOULD run `bun ../flogence/scripts/digest.ts scrml --fresh` (step 0) + MEASURE ctx% vs the ~27% baseline + report the breakdown** — that's still flogence's open measurement ask (S220 couldn't measure it, since I fell back to the hand-off + delta-log tail after it errored at boot).

## ⏸️ OPEN — S221 (priority order)
1. **The server-emit BUILD cluster (sequence — they share route-inference/emit-server):** `nominal-8` (per-role server-render-time gating §40.9.5 — the hard half [static `isVisibleForRole`] is DONE; missing = the per-request render path that omits non-admitted subtrees from HTML; SCOPE in delta-log [80]) → `W5a/W5b` (library-mode `?{}` — `docs/changes/library-mode-db-w5ab-2026-06-25/SCOPE.md`; flogence = first consumer; `g-library-mode-sql-no-db-context`) → `dpa-013` (flogence transport JSON-RPC⇄`<endpoint>` mapping — **option A RATIFIED S220**: configurable discriminator field `parseVariant`/`<endpoint accepts=E by="method">`).
2. **The MED/LOW backlog (24 MED, 17 LOW)** — the S220 deferred findings cluster: render-residuals (`g-tablefor-column-slot-literal-interp` · `g-if-chain-branch-display-null-interp` · `g-errors-anchor-not-reactively-clearing`) · server-emit residuals (`g-peer-call-in-raw-template-unawaited` · `g-ecg001-protect-invariant-overfire` · `g-arrow-expr-body-sql-parser-truncate`) · `g-paren`-family follow-on `g-unary-left-of-exponent-no-paren` · `g-inline-struct-return-type-misparse` (pre-existing parser bug). Plus the existing lists (ss12 selfhost, ss6 lifecycle).
3. **#12 (GH, open)** — `?{}`-in-arrow: now fires clear `E-SQL-009`+hint; full lowering deferred behind structured-lambda-block-body (`g-arrow-expr-body-sql-parser-truncate`).
4. **Editorial:** `examples/33-endpoint.scrml` can now dog-food the **canonical** `<Variant : fn()>` arm form (the endpoint-arm fix made §61.2 work) — has within-node-allowlist baseline implications.
5. **flogence #3 ("squashed bubbles")** = the SELF-HOST class collector (`section-assembly.js`), B4-deferred — NOT a default-pipeline bug (the TS collector works). `g-selfhost-class-collector-each-match-no-walk` (LOW).

## 🎯 Design narrative (IRREDUCIBLE)
- **The orchestra worked.** 4 sPA lanes (user-fired) + 2 PA-dispatched HIGH codegen fixes, all landed by the PA via S67 file-delta, with hand-reconciliation where surfaces collided. The S219 primary-goal directive (finish-the-project / orchestrate-don't-grind / default-GO / recovery-is-the-4th-irreducible) drove the whole session — adopter bug → verify (S138/S215) → just-go.
- **Ryan's battery told one story:** *you cannot build a working login on v0.7.0.* #02→#03 was ONE precedence fix (protect= must not override explicit `<page auth=optional>`). All 10 verified by an independent agent (matched Ryan exactly), filed, fixed across ss19+ss20, closed on GitHub with SHAs.
- **`<endpoint>` (§61) is Implemented** (ss18 W2-W5) AND its **canonical arm form now works** (the endpoint-arm reachability fix — §61.2's `<Variant : fn()>` private-handler no longer tree-shakes). The deferred `raw` server-fn stays gated on a witnessed untypeable case.
- **option-A ratified** for the flogence transport (JSON-RPC `method`-string ⇄ `accepts=` variant-tag = a configurable discriminator field; the limit-primitives-correct generalization, NOT a JSON-RPC mode).

## 🛟 Recovered anomalies (reasoning, not state)
- **file-delta-clobber near-miss (ss19):** the wholesale file-delta of ss19's branch clobbered MY S220 `known-gaps`/`delta-log` (the sPA edited its own on-branch copies). Caught via the staged-stat DELETIONS → restored to HEAD, **zero loss** → new memory `feedback_pa_filedelta_exclude_pa_shared_docs` (EXCLUDE the PA-owned shared docs from sPA file-deltas; author bookkeeping from the ping). **This is the load-bearing process lesson of S220.**
- **emit-server 3-way merges:** ss19 + endpoint-arm both branched pre-ss18 / on a shared emit-server; I 3-way-merged (not blind file-delta) to preserve ss18's endpoint codegen + ss19's auth + the new helpers. Verified each layer present post-merge.
- **commit-contention:** the pre-commit/pre-push hook OOM-slows to 5-7min under concurrent sPA/agent load (15GB box + flogence session). Commits TIMED OUT the tool (exit 143) but LANDED — verified HEAD each time. Lesson: background heavy commits; serialize landings; keep agent concurrency ≤2.
- **stale-tracking flip (nominal-9):** the Nominal currency-verify caught nominal-9 (engine opener effect=) was already BUILT (flipped resolved) AND that my nominal-3 "looks built" hypothesis was WRONG (the fire is native-parser-only). Verify-before-claim earned both.

## Board @ close
**HIGH 0 · MED 24 · LOW 17 · Nom 7** · v0.7.0. Suite **25223/0/214**. **Coherence: pushed clean** (the wrap push is the last commit; mid-session push of the 13 was 0/0). GH: Ryan #5–#11/#14 CLOSED (SHAs), #13 closed (working-as-intended), #12 open (diagnosed). Worktrees: ONLY main (21 spent pruned). No deputy (retired S219).

## pa.md directives in force
R1–R5 · `---` · Profile A · **S219 PRIMARY-GOAL** · **S219 flogence digest-boot** (FIXED; measure next boot) · S88/S99/S126 path-discipline · S136 BRIEF · S138 R26 · S147 coherence (S205 merge-before-push RETIRED — deputy gone) · S215 adversarial-verify · S217 per-user (bryan) · wrap 8-step (full PA-maintenance). New memory: `feedback_pa_filedelta_exclude_pa_shared_docs` + `feedback_parallel_dispatch_shared_scratchpad_race`.

## Tags
#session-220 #close #ryan-cheese-craft-battery-closed #flogence-findings #4-spa-lanes #all-high-closed #endpoint-implemented #option-a-ratified #filedelta-clobber-lesson #digest-boot-fixed
