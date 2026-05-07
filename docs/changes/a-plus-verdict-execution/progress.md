# A+ verdict #1+#2 — STATUS

[2026-05-06 start] - Survey complete. Findings:
  - E-SWITCH-FORBIDDEN does not exist today; switch is silently parsed in ast-builder.js (sites: 4379, 6753).
  - W-LIFECYCLE-CANDIDATE lint not yet implemented (only documented). lint-ghost-patterns.js is the right home.
  - No quickfix infrastructure exists; enriched-message-text approach.
  - Predicate chosen: single-word + initial-uppercase + alphanumeric (^[A-Z][A-Za-z0-9]*$).
[2026-05-06] - Starting implementation.
