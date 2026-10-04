# s451-spec-client-failable — progress

Branch `spec/s451-client-calls-failable`, cut from origin/main `dbb671c2d`. SPEC text for the S451 ruling
"your recs on all of them" (user-voice-scrml.md, last section).

## Log

- [x] BRIEF archived, branch cut, `bun install`.
- [x] Ruling 1 — a client call to a server function is failable. New §19.9.10 (rule, scope, error-type coverage,
  `!`-declared composition, OPEN for U1b, measurement, normative); §19.4.3 paragraph + the CPS-implicit exemption
  struck in "Event-handler values" and "Handler references"; §19.4.4 bullet; §19.9.4 bullet; §19.9.5
  W-CPS-NEEDS-FAILABLE paragraph struck (closed early into E-ERROR-002; condition 1 read as needing `?` — flagged);
  §13.7 example (the unhandled `onclick={ @users = userCount() }` line); §13.3 example; §12.3 pointer; §6.7.7 bullet;
  §19.13 + §34 E-ERROR-002 and W-CPS-NEEDS-FAILABLE rows; Appendix A row. Gap
  `g-impl1-client-server-call-not-failable-s451` (status=open — a carried case needs the U1b error shape).
- [x] Ruling 2 — three forms are compile errors (all Nominal on impl#1, verified by compiling on dbb671c2d):
  (a) **E-MATCH-BARE-BINDER** (new; §18.2 bullet + provenance, §18.15 row, §19.4.3 struck "further unruled form",
  §19.4.4 bullet, §34 row) — 4 `| err :>` arms in examples/09 (2, binding USED), 16, 29; 0 in a `match`; impl#1 accepts
  the `!{}` form and fails the `match` form closed with E-CODEGEN-INVALID-LOGIC. Gap `g-impl1-bare-binder-arm-accepted-s451`.
  (b) **E-ERROR-014** (new; §19.4.3 paragraph + example, §19.4.4 bullet, §19.13 + §34 rows) — 5 samples/compilation-tests
  files (the 6th, error-004-in-logic, is in logic and is E-ERROR-013); impl#1 drops the block silently. Gap
  `g-impl1-detached-handler-in-markup-s451`. Also: samples/login.scrml's E-ERROR-013 "depends on §19.9.5 reach" note
  resolved by ruling 1.
  (c) **E-ERROR-015** (new; §19.10.4 bullet + provenance, §19.10.5 + §8.9.2 W-BATCH-001 bullets narrowed to `!`,
  §8.6 rows, §19.13 + §34 rows, §34 W-BATCH-001 row narrowed). W-BATCH-001 stays for a `!` function (the suppression
  is real there); outside `!` there is no envelope to suppress, so E-ERROR-015 is the one diagnostic. Corpus: 4
  statements in 2 conformance cases — implicit-tx-explicit-begin (in `!`, unchanged) and sql/batch-warn-info (non-`!`,
  newly E-ERROR-015; its W-BATCH-001 pin migrates). Gap `g-impl1-manual-tx-outside-failable-s451`.
  Readings flagged in the SPEC: every transaction-control statement (not only BEGIN); "non-`!` function" includes a
  body top.

## Measurement (impl#1 on dbb671c2d)

Method: `docs/changes/s451-spec-client-failable/measure.mjs` — every `.scrml` under `examples/`, `samples/`,
`conformance/cases/` compiled alone (`compileScrml`, `write:false`); impl#1's own Route Inference result captured
through the `stageOverrides.RI` seam; the component-expanded AST of the input file walked. A callee is server-placed
when its RouteMap boundary is `server` / `middleware` (any file of the compile). 2267 files; 1 not compiled
(`samples/gauntlet-s19-phase4/nested-comments.scrml`, stack overflow).

Ruling 1 (call sites whose callee is server-placed): 404 total · 26 server→server (caller server-placed) · 17 callee
declared `!` (already E-ERROR-002 when unhandled) · 11 `<request>` body · 7 under `!{}` / `match` / `?` · 6 `<x server>`
hydration · **337 unhandled in 231 files**: 170 event-handler values, 139 client function bodies, 17 body top,
9 initializers + 2 attribute values (already E-VALUE-SERVER-CALL). By dir: conformance/cases 174 sites / 158 files ·
samples 109 / 47 · examples 54 / 26. Floor: aliases / cells / calls inside a body-split function's own body uncounted.

### Unhandled client server-call sites per file (count, file)

```
17	samples/compilation-tests/gauntlet-r10-rails-blog.scrml
9	samples/compilation-tests/gauntlet-r10-bun-admin.scrml
9	samples/compilation-tests/gauntlet-r10-go-contacts.scrml
8	samples/compilation-tests/gauntlet-r10-elixir-chat.scrml
7	examples/23-trucking-dispatch/pages/driver/load-detail.scrml
6	examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml
4	examples/18-state-authority.scrml
4	samples/gauntlet-r11-task-dashboard.scrml
4	samples/htmx-debate-dashboard.scrml
4	samples/rust-dev-debate-dashboard.scrml
3	examples/03-contact-book.scrml
3	examples/23-trucking-dispatch/pages/dispatch/billing.scrml
3	samples/admin-panel.scrml
3	samples/compilation-tests/gauntlet-r10-vue-datatable.scrml
3	samples/debate-async-dashboard-react-perspective.scrml
2	examples/08-chat.scrml
2	examples/17-schema-migrations.scrml
2	examples/23-trucking-dispatch/pages/customer/invoices.scrml
2	examples/23-trucking-dispatch/pages/customer/load-detail.scrml
2	examples/23-trucking-dispatch/pages/customer/quote.scrml
2	examples/23-trucking-dispatch/pages/dispatch/load-new.scrml
2	examples/23-trucking-dispatch/pages/driver/home.scrml
2	examples/23-trucking-dispatch/pages/driver/hos.scrml
2	examples/23-trucking-dispatch/pages/driver/messages.scrml
2	examples/23-trucking-dispatch/pages/driver/profile.scrml
2	samples/compilation-tests/gauntlet-s20-sql/sql-conditional-where-001.scrml
2	samples/compilation-tests/gauntlet-s20-sql/sql-update-delete-001.scrml
2	samples/file-manager-r11.scrml
2	samples/gauntlet-r13/bun-sql-operations.scrml
2	samples/gauntlet-r13/rails-crud-admin.scrml
2	samples/gauntlet-r14/bun-sql-operations.scrml
2	samples/gauntlet-r14/rails-crud-admin.scrml
2	samples/user-profile.scrml
2	conformance/cases/defer/server-block-nested-neg/case.scrml
2	conformance/cases/protect/global-store-e006/case.scrml
2	conformance/cases/server-db/event-after-await-e20-comma-neg/case.scrml
2	conformance/cases/server-db/event-after-await-e22-returnValue-neg/case.scrml
2	conformance/cases/server-db/event-after-await-e23-cancelBubble-neg/case.scrml
2	conformance/cases/server-db/event-after-await-h03-helper-after-await-neg/case.scrml
2	conformance/cases/server-db/event-control-after-await-bracket-neg/case.scrml
2	conformance/cases/server-db/event-control-after-await-neg/case.scrml
2	conformance/cases/server-db/nested-helper-server-fn-sort-neg/case.scrml
2	conformance/cases/server-db/sql-delete-reflects-rt/case.scrml
2	conformance/cases/server-db/sql-insert-returning-rt/case.scrml
2	conformance/cases/server-db/sql-multi-table-sequence-rt/case.scrml
2	conformance/cases/server-db/sql-unique-constraint-rt/case.scrml
2	conformance/cases/server-fn/cell-assign-independent-writes-batched/case.scrml
2	conformance/cases/server-fn/cell-assign-successive-writes-ordered/case.scrml
2	conformance/cases/server-fn/sequence-two-fns/case.scrml
1	examples/05-multi-step-form.scrml
1	examples/19-lin-token.scrml
1	examples/23-trucking-dispatch/pages/auth/login.scrml
1	examples/23-trucking-dispatch/pages/auth/register.scrml
1	examples/23-trucking-dispatch/pages/customer/home.scrml
1	examples/23-trucking-dispatch/pages/customer/loads.scrml
1	examples/23-trucking-dispatch/pages/customer/profile.scrml
1	examples/23-trucking-dispatch/pages/dispatch/board.scrml
1	examples/23-trucking-dispatch/pages/dispatch/customers.scrml
1	examples/23-trucking-dispatch/pages/dispatch/drivers.scrml
1	examples/23-trucking-dispatch/pages/driver/load-log.scrml
1	samples/compilation-tests/combined-007-crud.scrml
1	samples/compilation-tests/gauntlet-r10-htmx-feedback.scrml
1	samples/compilation-tests/gauntlet-r10-react-wizard.scrml
1	samples/compilation-tests/gauntlet-r10-zig-buildconfig.scrml
1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml
1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-server-prefix-013.scrml
1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-server-005.scrml
1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-with-sql-002.scrml
1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-server-003.scrml
1	samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-stmt-sql-in-body-097.scrml
1	samples/compilation-tests/gauntlet-s20-sql/protect-basic-001.scrml
1	samples/compilation-tests/gauntlet-s20-sql/protect-select-star-001.scrml
1	samples/compilation-tests/gauntlet-s20-sql/server-func-001.scrml
1	samples/compilation-tests/gauntlet-s20-sql/sql-in-handler-001.scrml
1	samples/compilation-tests/gauntlet-s20-sql/sql-run-001.scrml
1	samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001.scrml
1	samples/compilation-tests/postgres-program-driver.scrml
1	samples/compilation-tests/protect-001-basic-auth.scrml
1	samples/compilation-tests/server-008-form-handler.scrml
1	samples/gauntlet-r13/elixir-pipeline.scrml
1	samples/gauntlet-r13/go-api-service.scrml
1	samples/gauntlet-r13/htmx-forms.scrml
1	samples/gauntlet-r13/react-auth-dashboard.scrml
1	samples/gauntlet-r14/elixir-pipeline.scrml
1	samples/gauntlet-r14/go-api-service.scrml
1	samples/gauntlet-r14/htmx-forms.scrml
1	samples/gauntlet-r14/react-auth-dashboard.scrml
1	samples/gauntlet-r15/stress-db-markup-onclick.scrml
1	samples/multi-step-form.scrml
1	conformance/cases/auth/async-fn-escapes-as-value-dispatch-object-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-as-value-user-hof-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-destructured-scheduler-arr-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-destructured-scheduler-obj-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-forof-scheduler-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-local-scheduler-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-scheduler-x02-strip-server-neg/case.scrml
1	conformance/cases/auth/async-fn-escapes-scheduler-x04-blk-server-neg/case.scrml
1	conformance/cases/auth/auth-001-neg/case.scrml
1	conformance/cases/auth/auth-005-db-context-neg/case.scrml
1	conformance/cases/auth/nested-helper-block-shadowed-import-sort-neg/case.scrml
1	conformance/cases/auth/nested-helper-server-block-body-callback-neg/case.scrml
1	conformance/cases/auth/nested-helper-verify-password-sort-neg/case.scrml
1	conformance/cases/auth/program-nested-auth-neg/case.scrml
1	conformance/cases/auth/program-nested-auth-pos/case.scrml
1	conformance/cases/auth/session-ambient-server-neg/case.scrml
1	conformance/cases/auth/session-ambient-server-pos/case.scrml
1	conformance/cases/channel/server-cell-read/case.scrml
1	conformance/cases/channel/server-fn-uses-arg/case.scrml
1	conformance/cases/defer/cps-after-last-continuation/case.scrml
1	conformance/cases/defer/cps-batch0-failure/case.scrml
1	conformance/cases/defer/cps-batch1-failure/case.scrml
1	conformance/cases/defer/deferred-server-call-completes/case.scrml
1	conformance/cases/defer/server-in-split-neg/case.scrml
1	conformance/cases/derived/e-derived-server-only-reach-fn-path/case.scrml
1	conformance/cases/fn/sql-access-in-function-clean/case.scrml
1	conformance/cases/fn/sql-access-reject/case.scrml
1	conformance/cases/lifecycle/request-body-client-wrapper-rt/case.scrml
1	conformance/cases/protect/alias-write-e006/case.scrml
1	conformance/cases/protect/arguments-e006/case.scrml
1	conformance/cases/protect/arithmetic-e006/case.scrml
1	conformance/cases/protect/assign-refresh-runtime/case.scrml
1	conformance/cases/protect/bare-digest-e006/case.scrml
1	conformance/cases/protect/callback-param-e006/case.scrml
1	conformance/cases/protect/computed-key-e006/case.scrml
1	conformance/cases/protect/cte-strip-client-visible-runtime/case.scrml
1	conformance/cases/protect/descriptor-symbol-e006/case.scrml
1	conformance/cases/protect/element-alias-write-e006/case.scrml
1	conformance/cases/protect/expr-column-row-strip-runtime/case.scrml
1	conformance/cases/protect/from-upper-table-e006/case.scrml
1	conformance/cases/protect/helper-mutates-param-e006/case.scrml
1	conformance/cases/protect/hmac-constant-key-e006/case.scrml
1	conformance/cases/protect/keyed-hash-clean/case.scrml
1	conformance/cases/protect/length-object-e006/case.scrml
1	conformance/cases/protect/login-verify-clean/case.scrml
1	conformance/cases/protect/lookup-field-e006/case.scrml
1	conformance/cases/protect/lookup-keys-e006/case.scrml
1	conformance/cases/protect/lookup-method-e006/case.scrml
1	conformance/cases/protect/map-get-field-e006/case.scrml
1	conformance/cases/protect/marker-removal-alias-e006/case.scrml
1	conformance/cases/protect/merge-rows-strip-runtime/case.scrml
1	conformance/cases/protect/nested-container-write-e006/case.scrml
1	conformance/cases/protect/nonprotected-field-runtime/case.scrml
1	conformance/cases/protect/reduce-index-by-e006/case.scrml
1	conformance/cases/protect/response-header-e006/case.scrml
1	conformance/cases/protect/returning-strip-runtime/case.scrml
1	conformance/cases/protect/reveal-client-visible-runtime/case.scrml
1	conformance/cases/protect/reveal-then-arithmetic-clean/case.scrml
1	conformance/cases/protect/run-terminator-strip-runtime/case.scrml
1	conformance/cases/protect/scalar-concat-e006/case.scrml
1	conformance/cases/protect/scalar-encoding-e006/case.scrml
1	conformance/cases/protect/scalar-helper-cross-file-e006/case.scrml
1	conformance/cases/protect/scalar-helper-e006/case.scrml
1	conformance/cases/protect/scalar-in-new-object-e006/case.scrml
1	conformance/cases/protect/scalar-map-e006/case.scrml
1	conformance/cases/protect/scalar-return-e006/case.scrml
1	conformance/cases/protect/select-upper-column-e006/case.scrml
1	conformance/cases/protect/select-upper-column-row-strip-runtime/case.scrml
1	conformance/cases/protect/spaced-star-strip-runtime/case.scrml
1	conformance/cases/protect/strip-client-visible-runtime/case.scrml
1	conformance/cases/protect/symbol-description-e006/case.scrml
1	conformance/cases/protect/upper-table-row-strip/case.scrml
1	conformance/cases/reactive/dg-001-cyclic-neg/case.scrml
1	conformance/cases/reactive/dg-001-cyclic-pos/case.scrml
1	conformance/cases/reactive/server-fn-ambient-identity-clean/case.scrml
1	conformance/cases/reactive/server-fn-authority-wholly-server-error/case.scrml
1	conformance/cases/reactive/server-fn-cps-authority-marshal/case.scrml
1	conformance/cases/reactive/server-fn-cps-marshal-derived-warn/case.scrml
1	conformance/cases/reactive/server-fn-cps-marshal-raw-silent/case.scrml
1	conformance/cases/reactive/server-fn-derived-read-error/case.scrml
1	conformance/cases/reactive/server-fn-param-passthrough-clean/case.scrml
1	conformance/cases/reactive/server-fn-rawvar-read-error/case.scrml
1	conformance/cases/server-db/async-call-then-in-handler-neg/case.scrml
1	conformance/cases/server-db/cps-idempotency-store-driver-mismatch-neg/case.scrml
1	conformance/cases/server-db/cps-idempotency-store-driver-mismatch-pos/case.scrml
1	conformance/cases/server-db/cps-idempotency-store-missing-import-neg/case.scrml
1	conformance/cases/server-db/cps-idempotency-store-missing-import-pos/case.scrml
1	conformance/cases/server-db/cps-nonidem-no-storage-neg/case.scrml
1	conformance/cases/server-db/cps-nonidem-no-storage-pos/case.scrml
1	conformance/cases/server-db/event-after-await-e01-destructure-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e02-dynkey-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e04-dotcall-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e09-objwrap-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e10-methodref-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e13-fndecl-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e16-closure-param-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e21-arrayalias-neg/case.scrml
1	conformance/cases/server-db/event-after-await-e25-before-ok-pos/case.scrml
1	conformance/cases/server-db/event-after-await-h08-n3-inner-pos/case.scrml
1	conformance/cases/server-db/event-control-after-await-alias-neg/case.scrml
1	conformance/cases/server-db/event-control-after-await-closure-neg/case.scrml
1	conformance/cases/server-db/first-class-fn-ref-server-helper-rt/case.scrml
1	conformance/cases/server-db/inline-handler-server-call-sort-neg/case.scrml
1	conformance/cases/server-db/nested-helper-server-fn-some-runtime/case.scrml
1	conformance/cases/server-db/nested-helper-sibling-block-let-some-runtime/case.scrml
1	conformance/cases/server-db/server-fn-writes-reactive-cell-neg/case.scrml
1	conformance/cases/server-db/server-fn-writes-reactive-cell-pos/case.scrml
1	conformance/cases/server-db/sql-aggregate-group-rt/case.scrml
1	conformance/cases/server-db/sql-all-array-shape-rt/case.scrml
1	conformance/cases/server-db/sql-configured-db-no-e-sql-004/case.scrml
1	conformance/cases/server-db/sql-get-single-row-rt/case.scrml
1	conformance/cases/server-db/sql-join-two-tables-rt/case.scrml
1	conformance/cases/server-db/sql-missing-db-e-sql-004-neg/case.scrml
1	conformance/cases/server-db/sql-order-limit-rt/case.scrml
1	conformance/cases/server-db/sql-select-hydrate-rt/case.scrml
1	conformance/cases/server-db/sql-update-returning-rt/case.scrml
1	conformance/cases/server-db/sql-where-filter-rt/case.scrml
1	conformance/cases/server-fn/basic-load-hydrate/case.scrml
1	conformance/cases/server-fn/branch-declared-server-fn-routes-to-server/case.scrml
1	conformance/cases/server-fn/cell-assign-read-after-write/case.scrml
1	conformance/cases/server-fn/cps-call-in-if-arm/case.scrml
1	conformance/cases/server-fn/e-route-002-neg/case.scrml
1	conformance/cases/server-fn/e-route-002-pos/case.scrml
1	conformance/cases/server-fn/e-route-005-neg/case.scrml
1	conformance/cases/server-fn/e-route-005-pos/case.scrml
1	conformance/cases/server-fn/optional-absent/case.scrml
1	conformance/cases/server-fn/optional-present/case.scrml
1	conformance/cases/server-fn/sse-generator-binding-seed-survives/case.scrml
1	conformance/cases/sql/bad-conn-prefix-neg/case.scrml
1	conformance/cases/sql/bare-identifier-body-e-sql-003-neg/case.scrml
1	conformance/cases/sql/batch-warn-info/case.scrml
1	conformance/cases/sql/clean-pos/case.scrml
1	conformance/cases/sql/comment-cloaked-body-e-sql-003-neg/case.scrml
1	conformance/cases/sql/commented-query-no-e-sql-003/case.scrml
1	conformance/cases/sql/param-query-no-e-sql-003/case.scrml
1	conformance/cases/sql/prepare-cps-return-e-sql-006-neg/case.scrml
1	conformance/cases/sql/prepare-server-fn-e-sql-006-neg/case.scrml
1	conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml
1	conformance/cases/sql/prepare-ws-onserver-e-sql-006-neg/case.scrml
1	conformance/cases/sql/runtime-expr-body-e-sql-003-neg/case.scrml
1	conformance/cases/sql/transactions-concurrent-postgres-pos/case.scrml
1	conformance/cases/sql/transactions-concurrent-sqlite-e-sql-010-neg/case.scrml
```
