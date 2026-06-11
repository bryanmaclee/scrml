# D3 BRIEF (archived verbatim per S136) — dispatched S180 2026-06-10, base bf4e51c4

agent: scrml-js-codegen-engineer · isolation: worktree · run_in_background: true · agentId a8d51757f256bde29

TASK: Build escalation-aware "Migration 4" (server function → function) in migrate.js as a --fix-tier
migration. KEY DESIGN: drive it off the W-DEPRECATED-SERVER-MODIFIER diagnostic — that lint fires iff
the keyword is REDUNDANT (function escalates via another trigger T1/T2/T3/T5/T7/T8), so stripping `server`
only at its fire-sites is provably safe + auto-preserves `server fn` (lint never fires there) + leaves the
keyword-only client-flip danger sites untouched. EXCLUDE `server function*` (SSE deferred). Never `fn`.
Builds+tests the TOOL only (NOT the corpus — that's D4). Idempotent. Count via totalServerFn. Fix BOTH
docstring blocks (existing Migration-3 label collision). Tests: SQL-body→stripped · server fn→untouched ·
function*→untouched · keyword-only-no-trigger→untouched (danger left) · channel(T7)→stripped · handle(T8)→
stripped · idempotency · M1/M2/M3 composition · stripped file still compiles + stays server-boundary.
Full F4 + S99/S126 + MAPS + commit-discipline + progress-d3.md. CRITICAL startup merge of origin/main
(bf4e51c4 = D1+D2) — Migration 4 depends on D2's lint firing on channel/handle.
