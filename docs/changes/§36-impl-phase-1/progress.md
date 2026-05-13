# §36 impl Phase 1 — Progress

## 2026-05-13 — START
- Worktree verified, bun install ok, pretest ok.
- Maps consulted: primary, domain (via SCOPING), error (W-PROGRAM-SPA-INFERRED catalog precedent line 14703).
- SCOPING read in full from /home/bryan-maclee/scrmlMaster/scrmlTS/docs/changes/§36-input-devices-impl/SCOPING.md.
- SPEC §36 anchors: section header L15390; §36.5 L15629; §36.6 L15648; §36.7 L15687; §36 catalog rows 14774–14777, 14901.
- Three sub-phases — 1.A nested-scope cleanup (§36.5); 1.B W-INPUT-001 + §34 row (§36.7); 1.C SSR no-emit + _clearFrameState SHOULD (§36.5.1 or §36.6).

## 2026-05-13 — base-cleanup
- File-delta hazard observed: agent base 9b98118 predates 8 S89 commits on main; one of them (6498dd2 W-TRY-CATCH-IN-SCRML-SOURCE) touched compiler/SPEC.md. Cherry-picked 6498dd2 into worktree to bring SPEC.md to S89-current state (HEAD now 90ce95f); per user-voice feedback file-delta-vs-cherry-pick.

## 2026-05-13 — 1.A LANDED (commit a57b6e5)
- §36.5.1 added: nested-scope cleanup fires at immediately enclosing scope's unmount.
- Cites <timer>/<poll> parity (§6.7.5/§6.7.6) + engine mount-position (§51.0.D).
- Pre-commit suite green.

## 2026-05-13 — 1.B LANDED (commit d823ea1)
- §36.7.1 added: silent fallback + W-INPUT-001 info lint.
- §34 catalog row inserted after E-INPUT-005 (line ~14902).
- W-INPUT-001 explicitly notes E-INPUT-006 is NOT created — lint replaces the proposed error.

## 2026-05-13 — 1.C STAGED
- §36.5.2 added: SSR / server-side emission client-only normative.
- §36.6 amended: _clearFrameState() SHOULD-level discipline for frame-loop consumers.
- SPEC-INDEX §36 row refreshed with 4 sub-section pointers; §34 row +2 S89 markers (W-TRY-CATCH + W-INPUT-001); Quick Lookup line range fixed (15391-15897).
