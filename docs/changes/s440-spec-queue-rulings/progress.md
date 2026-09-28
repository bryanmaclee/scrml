# progress — s440-spec-queue-rulings

- start: base 7e4bc8155 (== origin/main). Brief archived.
- all items written: #1 §7.5.1 (+§66.20 E-TYPE-031 row) · #3 §17.7.2 + §34 E-EACH-NOT-SEQUENCE · #6 §7.6 + §7.3.3 + §19.16.6 + §34 E-SCOPE-010 · #7 §66.7.4 · #8 §40.8 · #9 §47.1.1 · #10 §51.0.E · #11 §66.13.4 + §66.20 row · #12 §34.0 · #13 §20.5.1 (B4b + step 2) · #19 §41.14.3 + §34 E-ERROR-005 · dup keys §14.3 + §66.11.3 (verbatim para) + §34 + §66.20 E-STRUCT-DUPLICATE-KEY.
- impl#1 measured (exit 0, no diag) for: cell write mismatch, each over number, dup top-level function, dup struct key, formFor no-boundary.
- regen SPEC-INDEX + FACTS; facts --check PASS; s34-census --check-new PASS; state --check PASS.

## Round 2 (merged origin/main at 5105cb730)
- New rulings written: #1 field writes (§7.5.1 row 6 + paragraph + Normative bullet; §66.20 + §34 E-TYPE-031 rows) · #3 unresolved in= silent (§17.7.2 + §34 row) · #7 handle-not-cell (§66.7.4) · #2 E-CALL-ARITY (§7.3 + §34) · #5 E-HANDLE-REDECLARE (§66.7.2 + §66.20, no §34 row per §66 convention) · `${not}` renders nothing (§7.4.2) · <select> enum fallback + E-SELECT-OPTION-NOT-VARIANT (§5.4 + §34).
- Drift fixes F1-F8, F10 applied. impl#1 measured S440: field write `@p.x = "nope"` exit 0; `add(1,2,3)` / `add(1)` exit 0.
- FOR THE PA (F4): §19.6.6 (owned by another agent) must be reconciled at landing — the sentence: "The compiler SHALL verify, at compile time, that every error variant reachable inside an `<errorBoundary>` either has a `renders` clause or is covered by the boundary's `fallback` attribute. Failure to satisfy this SHALL be E-ERROR-005." — it defines E-ERROR-005 only for errors INSIDE a boundary; §41.14.3 (S440 #19) now also fires E-ERROR-005 for a formFor submit error with NO enclosing boundary.
- FOR THE PA (F9, file as a gap, not fixed): §20.5.1 "Resolution order per unit" step 2 still reads the unit's raw `<page>` attribute for `sessionExpiry=` (only the `session-secure=` limb was struck by S440 #13), but `sessionExpiry=` is not in <page>'s five-attribute per-route set either (§40.8), so that limb is dead/contradictory.
- FOR THE PA (#5 iii): "logged as a candidate widening" — same `as=` name on mutually exclusive `if=` instances; not added to §66.22 (it is ruled, not OPEN); log it wherever candidate widenings are tracked.
