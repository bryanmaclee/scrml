---
from: spa-ss27
to: scrml (PA)
date: 2026-06-25
subject: ss27 (low-ingestion cleanup) — 4 landed on spa/ss27; #3 parked; #5 Enhanced-A design-flag
needs: action
status: unread
---

sPA ss27 (low-ingestion cleanup sweep) ran autonomously. **4 of 5 items LANDED** on
`spa/ss27`; #3 PARKED (footprint wrong). Did NOT advance main / did NOT push.

## Branch
- **Branch:** `spa/ss27` · **tip:** `d4783d6b` · **base:** origin/main `cf9f1109` (+ the PA's own `9ac06830` S221 list-rebuild commit in history).
- Dev-agents based on `cf9f1109`; all file-deltas base-verified clean (touched files identical at agent base + spa/ss27 base).

## Items
| # | item | disposition | commit | agent |
|---|------|-------------|--------|-------|
| 1 | bug-19-cite (cosmetic) | **RESOLVED — verify-then-close** (no work) | f6fade9e | sPA-direct |
| 2 | g-s52-retraction-doc-staleness | **LANDED** (1 currency note; no published-prose edit) | f6fade9e | sPA-direct |
| 3 | g-trucking-smoke-chunks-flake | **PARKED → PA** (footprint wrong) | — | — |
| 4 | g-stdlib-runtime-chunk-dead-weight | **LANDED** | d1824d1f | aacb9023 |
| 5 | g-channel-server-keyword-auto-migrate | **LANDED ⚠ Enhanced-A flag** | d4783d6b | a21a226a |

### #1 bug-19-cite — verify-then-close
The in-repo §11-folded-citation cleanup was ALREADY complete (every devto §11 is annotated-folded or a kickstarter ref; zero bare SPEC §11 in-repo). Flipped known-gaps.md bug-19-cite → resolved. Live dev.to update optional + user-owned (Rule 1).

### #2 s52-retraction doc-currency — mostly already current
components-are-states (PUBLISHED) body already teaches read-authority-only + has the 2026-06 retraction note → **no published-prose edit, Rule-1 gate NOT triggered.** spec-consolidation L297/L332 already annotated; added one matching `[Currency — 2026-06-14]` note to the L370 Q5.B.2 carry-forward DD option (premised on the retracted optimistic-write path).

### #3 trucking flake — PARKED (footprint EMPIRICALLY WRONG)
The footprint's "shared-output-dir / parallel-write race" hypothesis is wrong: the test ALREADY uses `mkdtempSync` (unique per-file output dir). The flaky assertion is `chunksManifest.version`/`entryPoints` undefined under full-suite concurrency → most likely **compile starvation under the resource-pressure environment** (the 15GB-box OOM/variance we hit all session; the #5 agent independently saw the same 2-flaky-fails-don't-reproduce + 25448↔25449 test-count variance), NOT a code race. Real shared-state smell found: `route-splitter.ts:322 let cachedCompilerIdentity` (module-level cache) — but it feeds `manifest.compiler`, not version/entryPoints, so it doesn't match the failing assertion. Recommend: (a) if resource-pressure → mark trucking-smoke serial / its own lane (env, not code); (b) separately harden `cachedCompilerIdentity` to per-ctx. Root-causing a concurrency-timing flake reliably exceeds a LOW item.

### #4 stdlib dead-chunk — LANDED + corrections
- New `prune-server-only-stdlib-chunks` stage (emit-client.ts ~L1830). sPA R26: server-only `scrml:format` → no stdlib-format chunk/read in any emitted .js; adversarial (client-used/mixed preserved, server-only unchanged) green.
- **Brief correction:** ss19 #5 IS already on cf9f1109 (you re-integrated it) — item 4 builds cleanly on top (a 3rd emit-client region); no reconciliation needed.
- **SYNERGY + follow-up:** item 4's chunk-prune also un-blocks ss19 #5's read-line strip for client-safe modules (#5 was latently ineffective — `pruneUnusedClientImports` scans the runtime-spliced body, so the embedded chunk's own fn falsely satisfied the body-ref check). FOLLOW-UP for PA: make #5's read-prune correct independent of chunk presence (scan pre-assembly body).

### #5 channel migrate auto-strip — LANDED ⚠ ENHANCED-A DESIGN FLAG (please confirm)
Migration 5 in migrate.js: `bun scrml migrate --fix` strips the `server` keyword from a deprecated channel-cell-write publisher → canonical client-side `function` (onclient §38.10 form). R4-verified RULING A against live SPEC §12.2 Trigger 7 + §38.4. Precise discriminator (E-CHANNEL fires AND W-DEPRECATED does NOT → keyword is sole server reason; generators excluded). sPA R26 26/0; red→green + adversarial + idempotent.
- **⚠ This IMPLEMENTS Enhanced-A.** SPEC-INDEX (S189) says "Minimal-A: deprecated `server function` channel publishers are NOT auto-migrated (Enhanced-A deferred)." The S221 ss27 list scoped item 5 as buildable ("Fix: add the migrate --fix rule") → you decided to build it. It's a TOOLING-ergonomics upgrade (auto vs manual migration) producing the canonical form — NOT a language-semantics reversal. **CONFIRM intended;** if yes, the SPEC-INDEX / §38.6.1 "Enhanced-A deferred" note is now stale (currency-flip). If unwanted, drop this spa/ss27 landing (migrate-tool-only, isolated to the 3 item-5 files).
- DEFERRED per RULING A: broadcast/disconnect + SQL-escalated publishers that read a cell stay MANUAL payload-rewrite (§38.6.1).

## GH / verify-close note
#1 + #2 are doc-currency (no GH issues). #4/#5 are PA-found/migrate-ergonomics (no the adopter GH issue). #3 stays open (parked).

## Environment (recurring, cross-session)
The full-suite pre-commit hook runs slow (~130-205s) and intermittently OOM/varies under concurrent load (sibling flogence session + agents, 15GB box). Commits land on retry / after a memory window; the trucking flake (#3) + test-count variance are symptoms. Kept agent concurrency ≤2. NOT test failures; never `--no-verify`.

## Close
End-state: #1/#2/#4/#5 landed · #3 parked. Branch + `spa-lists/ss27.progress.md` + this message are the handoff. The user closes the instance.
