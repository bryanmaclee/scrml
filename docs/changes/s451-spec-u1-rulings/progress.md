# s451-spec-u1-rulings — progress

Branch `spec/s451-u1-rulings`, base `b490f3b75` (== origin/main at start).

- 2026-10-03 start — worktree verified, branch cut, `bun install`. Read user-voice §S451, the U1 design §0/§3/§10,
  SPEC §6.6.9, §6.7.7 (+.1), §6.15, §8.6–§8.9, §13.1–§13.4, §19.4, §19.8, §19.9 (incl. §19.9.5, §19.9.9), §19.10,
  §44, Appendix A, §34.0, the E-ERROR-002 / E-VALUE-* §34 rows.

- 2026-10-03 R1/R4/R7/R11 SPEC text drafted. Decisions:
  - **R1 home = new §13.7** (async model), cross-ref from §6.15 (a paragraph + its cross-reference list). Reason: the rule is
    about the async boundary (a value position has no statement boundary to suspend at), not about writes; §6.15 declares
    itself the no-write rule's one home ('none restates it'), so a second rule there would blur that. §13.7 uses §6.15's
    value-position list by reference. Code = `E-VALUE-SERVER-CALL` (no §34 collision; sits beside the E-VALUE-* codes).
  - R1 OPEN items written into §13.7, not decided: O-R1-1 a client fn that reaches a server call (rec yes); O-R1-2 a bare
    `?{}` / a Promise-returning stdlib call in a value position.
  - R4 'provably read-only' = §6.7.7.1 rule 1's body-form READ applied to the call; also fail-closed on O-059-3 (non-SQL
    side effects are unclassified there) — flagged in the provenance note as a reading open to veto.
  - R7 = new §19.9.9.7 + a reconciling paragraph in §6.6.9 (the marshal set = cells the batch reads before/without writing).
  - R11: §8.7, §8.9.4, §19.4.3 (pointer paragraph), §19.8.2 (UNCHANGED note), §19.8.3 (rewritten: three handling forms,
    one example each, no-row-is-not-failure), §19.8.4 bullets, §44.3 note, Appendix A row, both E-ERROR-002 rows (§19's
    table and §34). 'Outside a `!` function' = no enclosing function DECLARED `!` (§19.4.1); a CPS-implicit `!` does not
    count. §52.6.5 Pattern C's inline `?{}` load is left OPEN in §19.8.3.

- 2026-10-03 impl#1 probes (compiled on b490f3b75 with `bun compiler/bin/scrml.js compile <f> --output-dir <d>`; probe files in TMPDIR, not committed):
  - R11: `function loadName(id) { let row = ?{SELECT…}.get(); return row }` → exit 0, no E-ERROR-002. Server emit
    `(await _scrml_sql`…`)[0] ?? null` with no catch — a failed query throws; impl#1 never had the silent mode at run time.
  - R1: `<n> = countUsers()` and `<p>${countUsers()}</p>` (a server fn) → exit 0; emits an async IIFE cell set and an async textContent write.
  - R7: `@total = ?{SELECT count…}.get().n` then `?{INSERT … ${@total}}.run()` in one function → one batch; the INSERT binds
    `_scrml_body["total"]` (marshalled at batch start). Also seen: the SELECT result goes into `_scrml_cps_return` and is never returned.
  - R4: already filed S441 as `g-const-batch-parallelizes-side-effecting-server-calls` (not re-run).

- 2026-10-03 MEASUREMENT. Method: impl#1's front end (`splitBlocks` + `buildAST` from compiler/src) walked by
  `docs/changes/s451-spec-u1-rulings/measure.mjs` — an AST walk, NOT the full pipeline, so route inference is approximated.
  Corpus: examples/ samples/ conformance/cases/ stdlib/ docs/readme-snippets/ docs/tutorial-snippets/ — 2332 .scrml files, 0 parse throws.
  - **R11**: 633 `?{}` nodes: 19 inside a function declared `!`; 0 handled by `!{}`/`match` (as the AST shows them); 2
    transaction control (`?{BEGIN}` …); 14 on a §52 `<x server>` RHS (Pattern C — OPEN, not counted); **598 newly
    rejected sites in 272 files** (conformance 162 · samples 77 · examples 28 · docs 4 · stdlib 1).
    AST-blind: 94 files where a text count of `?{` (non-`//` lines) exceeds the AST count, 133 sites — mostly legacy
    `< db>`-state samples the AST builder does not descend (samples/api-dashboard, recipe-book, gauntlet-r11-go-url-shortener —
    which DO put `!{}` on their queries) and `?{` inside block comments / strings. Upper bound ≈ 598 + 133.
  - **R1**: server-placed callee approximated as a same-file function declared `server` or containing `?{}` (imports not
    followed — an under-count); value positions = a non-server state-decl initializer / derived formula outside function and
    lifecycle bodies, a markup interpolation, a non-`on*` / non-`bind:` attribute value. **16 sites in 15 files**
    (initializer 7, interpolation 9). Notable: examples/03-contact-book.scrml:36 `<contacts>: Contact[] = loadContacts()`,
    docs/tutorial-snippets/02b-counter-persisted.scrml:15 `<count> = loadCount()`, and
    conformance/cases/server-fn/error-boundary-fallback (`<errorBoundary>${loadName("1")}</>` — see the §19.6 contradiction).
  - **SPEC's own examples** (85 ```scrml blocks containing `?{`, same walker over `specblocks.py` output): R11 69 unhandled
    sites in 57 blocks — owed SPEC-example migration, not done here (only the amended sentences' examples were written
    to conform). Block start lines (numbering after this change's R1/R4/R7/R11 edits): 477 949 1825 4001 4027 4041 7211 8662 8676 8709 8726 8739 8792 8805 8839 8853 8910 8921 8936 9069 9105 9780 9934 9988 10057 10559 10860 10897 12441 12503 17737 17769 17857 17884 17988 19091 19229 19535 21981 24162 24992 25439 26146 26767 29981 30551 36424 36467 36605 36622 36669 36732 37052 37749 39446 41714 41724
    R1: 3 blocks — the new §13.7 example (intended), §19.9.5's `<errorBoundary>${notifyOrder(…)}</>`, §52.6.5 Pattern A.

  R1 file list (sites, file):
    2	samples/compilation-tests/gauntlet-r10-bun-admin.scrml
    1	examples/03-contact-book.scrml
    1	examples/08-chat.scrml
    1	examples/17-schema-migrations.scrml
    1	samples/compilation-tests/gauntlet-r10-go-contacts.scrml
    1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml
    1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-server-prefix-013.scrml
    1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-with-sql-002.scrml
    1	samples/gauntlet-r11-task-dashboard.scrml
    1	conformance/cases/fn/sql-access-in-function-clean/case.scrml
    1	conformance/cases/fn/sql-access-reject/case.scrml
    1	conformance/cases/server-fn/error-boundary-fallback/case.scrml
    1	conformance/cases/server-fn/sse-generator-binding-seed-survives/case.scrml
    1	conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml
    1	docs/tutorial-snippets/02b-counter-persisted.scrml
  R11 file list (sites, file):
    28	examples/23-trucking-dispatch/pages/driver/load-detail.scrml
    20	samples/compilation-tests/gauntlet-r10-rails-blog.scrml
    18	samples/compilation-tests/gauntlet-r10-bun-admin.scrml
    16	examples/23-trucking-dispatch/pages/dispatch/load-detail.scrml
    16	samples/gauntlet-r14/elixir-pipeline.scrml
    12	examples/23-trucking-dispatch/pages/customer/load-detail.scrml
    11	examples/23-trucking-dispatch/seeds.scrml
    11	samples/admin-panel.scrml
    10	samples/compilation-tests/gauntlet-r10-elixir-chat.scrml
    10	samples/gauntlet-r14/bun-sql-operations.scrml
    8	examples/23-trucking-dispatch/pages/customer/invoices.scrml
    8	examples/23-trucking-dispatch/pages/dispatch/billing.scrml
    8	examples/23-trucking-dispatch/pages/driver/home.scrml
    8	examples/23-trucking-dispatch/pages/driver/hos.scrml
    8	samples/gauntlet-r13/bun-sql-operations.scrml
    7	examples/18-state-authority.scrml
    7	samples/gauntlet-r11-task-dashboard.scrml
    7	samples/gauntlet-r13/rails-crud-admin.scrml
    7	samples/gauntlet-r14/go-api-service.scrml
    7	samples/gauntlet-r14/rails-crud-admin.scrml
    7	samples/gauntlet-r15/stress-db-markup-onclick.scrml
    7	samples/htmx-debate-dashboard.scrml
    6	examples/23-trucking-dispatch/pages/customer/quote.scrml
    6	examples/23-trucking-dispatch/pages/dispatch/load-new.scrml
    6	examples/23-trucking-dispatch/pages/driver/messages.scrml
    5	examples/23-trucking-dispatch/pages/driver/profile.scrml
    5	samples/compilation-tests/gauntlet-r10-go-contacts.scrml
    5	samples/debate-async-dashboard-react-perspective.scrml
    5	samples/gauntlet-r13/elixir-pipeline.scrml
    5	samples/gauntlet-r13/go-api-service.scrml
    5	samples/rust-dev-debate-dashboard.scrml
    4	examples/17-schema-migrations.scrml
    4	examples/23-trucking-dispatch/pages/auth/register.scrml
    4	examples/23-trucking-dispatch/pages/customer/home.scrml
    4	examples/23-trucking-dispatch/pages/driver/load-log.scrml
    4	samples/compilation-tests/combined-007-crud.scrml
    3	examples/03-contact-book.scrml
    3	examples/07-admin-dashboard.scrml
    3	examples/23-trucking-dispatch/pages/customer/loads.scrml
    3	samples/compilation-tests/gauntlet-r10-vue-datatable.scrml
    3	samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-method-call-sql-088.scrml
    3	samples/compilation-tests/sql-009-multiple.scrml
    3	samples/file-manager-r11.scrml
    3	samples/user-profile.scrml
    2	examples/08-chat.scrml
    2	examples/19-lin-token.scrml
    2	examples/23-trucking-dispatch/pages/auth/login.scrml
    2	examples/23-trucking-dispatch/pages/customer/profile.scrml
    2	examples/23-trucking-dispatch/pages/dispatch/board.scrml
    2	examples/23-trucking-dispatch/pages/dispatch/customers.scrml
    2	examples/23-trucking-dispatch/pages/dispatch/drivers.scrml
    2	samples/compilation-tests/edge-009-nested-sql-in-logic.scrml
    2	samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml
    2	samples/compilation-tests/gauntlet-s20-sql/sql-update-delete-001.scrml
    2	samples/compilation-tests/postgres-program-driver.scrml
    2	conformance/cases/defer/cps-after-last-continuation/case.scrml
    2	conformance/cases/defer/cps-batch0-failure/case.scrml
    2	conformance/cases/defer/cps-batch1-failure/case.scrml
    2	conformance/cases/defer/server-block-nested-neg/case.scrml
    2	conformance/cases/defer/server-in-split-neg/case.scrml
    2	conformance/cases/protect/assign-refresh-runtime/case.scrml
    2	conformance/cases/protect/global-store-e006/case.scrml
    2	conformance/cases/protect/merge-rows-strip-runtime/case.scrml
    2	conformance/cases/protect/mounthydrate-redacts/case.scrml
    2	conformance/cases/reactive/dg-001-cyclic-neg/case.scrml
    2	conformance/cases/reactive/dg-001-cyclic-pos/case.scrml
    2	conformance/cases/server-db/server-fn-in-sync-callback-neg/case.scrml
    2	conformance/cases/server-db/server-fn-in-sync-callback-pos/case.scrml
    2	conformance/cases/server-db/sql-delete-reflects-rt/case.scrml
    2	conformance/cases/server-db/sql-insert-returning-rt/case.scrml
    2	conformance/cases/server-db/sql-multi-table-sequence-rt/case.scrml
    2	conformance/cases/server-db/sql-unique-constraint-rt/case.scrml
    2	conformance/cases/server-fn/sequence-two-fns/case.scrml
    2	conformance/cases/sql/batch-warn-info/case.scrml
    2	conformance/cases/sql/prepare-cps-return-e-sql-006-neg/case.scrml
    2	conformance/cases/sql/prepare-sse-generator-e-sql-006-neg/case.scrml
    2	conformance/cases/sql/prepare-ws-onserver-e-sql-006-neg/case.scrml
    2	conformance/cases/ssr/ssr-auth-scoped-callable-not-seeded/case.scrml
    2	conformance/cases/ssr/ssr-callable-public-seeded-gated-omitted/case.scrml
    2	stdlib/auth/templates/login.scrml
    2	docs/tutorial-snippets/02b-counter-persisted.scrml
    1	examples/05-multi-step-form.scrml
    1	samples/compilation-tests/combined-004-data-table.scrml
    1	samples/compilation-tests/combined-013-blog.scrml
    1	samples/compilation-tests/combined-015-user-list.scrml
    1	samples/compilation-tests/gauntlet-r10-htmx-feedback.scrml
    1	samples/compilation-tests/gauntlet-r10-react-wizard.scrml
    1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml
    1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-server-005.scrml
    1	samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-function-with-sql-002.scrml
    1	samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-stmt-sql-in-body-097.scrml
    1	samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-arith-in-sql-interp-048.scrml
    1	samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-in-sql-bound-024.scrml
    1	samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-not-in-sql-098.scrml
    1	samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-not-on-sql-get-114.scrml
    1	samples/compilation-tests/gauntlet-s20-meta/meta-sql-runtime-007.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/protect-basic-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/protect-select-star-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/server-func-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-all-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-bound-params-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-conditional-where-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-duplicate-param-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-get-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-in-handler-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-multiline-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-nobatch-001.scrml
    1	samples/compilation-tests/gauntlet-s20-sql/sql-run-001.scrml
    1	samples/compilation-tests/protect-001-basic-auth.scrml
    1	samples/compilation-tests/server-004-server-func.scrml
    1	samples/compilation-tests/server-005-mixed.scrml
    1	samples/compilation-tests/server-008-form-handler.scrml
    1	samples/compilation-tests/sql-001-basic-select.scrml
    1	samples/compilation-tests/sql-002-where.scrml
    1	samples/compilation-tests/sql-003-join.scrml
    1	samples/compilation-tests/sql-004-count.scrml
    1	samples/compilation-tests/sql-005-insert.scrml
    1	samples/compilation-tests/sql-006-update.scrml
    1	samples/compilation-tests/sql-007-delete.scrml
    1	samples/compilation-tests/sql-008-order-limit.scrml
    1	samples/compilation-tests/sql-010-create-table.scrml
    1	samples/compilation-tests/test-006-test-sql.scrml
    1	samples/debate-lin-lift-edge-cases.scrml
    1	samples/debate-lin-lift-pipeline.scrml
    1	samples/gauntlet-r13/htmx-forms.scrml
    1	samples/gauntlet-r13/react-auth-dashboard.scrml
    1	samples/gauntlet-r14/htmx-forms.scrml
    1	samples/login.scrml
    1	samples/multi-step-form.scrml
    1	samples/react-dev-lin-lift-edge-cases.scrml
    1	samples/react-dev-lin-lift-pipeline.scrml
    1	conformance/cases/auth/auth-001-neg/case.scrml
    1	conformance/cases/auth/auth-001-pos/case.scrml
    1	conformance/cases/auth/auth-005-db-context-neg/case.scrml
    1	conformance/cases/auth/auth-async-stdlib-sync-callback-neg/case.scrml
    1	conformance/cases/auth/program-nested-auth-neg/case.scrml
    1	conformance/cases/auth/program-nested-auth-pos/case.scrml
    1	conformance/cases/auth/session-ambient-server-neg/case.scrml
    1	conformance/cases/auth/session-ambient-server-pos/case.scrml
    1	conformance/cases/auth/w-serverload-ungated-neg/case.scrml
    1	conformance/cases/auth/w-serverload-ungated-pos/case.scrml
    1	conformance/cases/body-top/sql-statement-not-shipped/case.scrml
    1	conformance/cases/codegen/cg-001-server-block-warn-pos/case.scrml
    1	conformance/cases/fn/sql-access-in-function-clean/case.scrml
    1	conformance/cases/fn/sql-access-reject/case.scrml
    1	conformance/cases/lifecycle/request-body-client-wrapper-rt/case.scrml
    1	conformance/cases/lifecycle/request-data-is-some-if-attr-rt/case.scrml
    1	conformance/cases/lifecycle/request-data-is-some-value-bool-class-attr-rt/case.scrml
    1	conformance/cases/lifecycle/request-deps-empty-mount-only-rt/case.scrml
    1	conformance/cases/lifecycle/request-deps-explicit-listed-refire-rt/case.scrml
    1	conformance/cases/lifecycle/request-deps-explicit-unlisted-no-refire-rt/case.scrml
    1	conformance/cases/lifecycle/request-refetch-fn-body-stmt-rt/case.scrml
    1	conformance/cases/lifecycle/request-refetch-inline-multi-stmt-rt/case.scrml
    1	conformance/cases/lifecycle/request-settle-error-rt/case.scrml
    1	conformance/cases/lifecycle/request-settle-success-rt/case.scrml
    1	conformance/cases/meta/meta-sql-in-runtime-block-neg/case.scrml
    1	conformance/cases/protect/alias-write-e006/case.scrml
    1	conformance/cases/protect/arguments-e006/case.scrml
    1	conformance/cases/protect/arithmetic-e006/case.scrml
    1	conformance/cases/protect/bare-digest-e006/case.scrml
    1	conformance/cases/protect/callback-param-e006/case.scrml
    1	conformance/cases/protect/channel-broadcast-strip/case.scrml
    1	conformance/cases/protect/comment-prefixed-strip-info/case.scrml
    1	conformance/cases/protect/computed-key-e006/case.scrml
    1	conformance/cases/protect/cte-strip-client-visible-runtime/case.scrml
    1	conformance/cases/protect/cte-strip-info/case.scrml
    1	conformance/cases/protect/descriptor-symbol-e006/case.scrml
    1	conformance/cases/protect/e-pa-005-neg/case.scrml
    1	conformance/cases/protect/e-pa-005-pos/case.scrml
    1	conformance/cases/protect/e-pa-006-neg/case.scrml
    1	conformance/cases/protect/e-pa-006-pos/case.scrml
    1	conformance/cases/protect/e-protect-003-neg/case.scrml
    1	conformance/cases/protect/e-protect-003-pos/case.scrml
    1	conformance/cases/protect/e-protect-005-neg/case.scrml
    1	conformance/cases/protect/e-protect-005-pos/case.scrml
    1	conformance/cases/protect/element-alias-write-e006/case.scrml
    1	conformance/cases/protect/endpoint-multikey-arm-response/case.scrml
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
    1	conformance/cases/protect/mediated-response-passthrough/case.scrml
    1	conformance/cases/protect/nested-container-write-e006/case.scrml
    1	conformance/cases/protect/nonprotected-field-runtime/case.scrml
    1	conformance/cases/protect/null-body-response-clean/case.scrml
    1	conformance/cases/protect/raw-egress-e004/case.scrml
    1	conformance/cases/protect/reduce-index-by-e006/case.scrml
    1	conformance/cases/protect/response-header-e006/case.scrml
    1	conformance/cases/protect/returning-strip-runtime/case.scrml
    1	conformance/cases/protect/reveal-client-visible-runtime/case.scrml
    1	conformance/cases/protect/reveal-suppresses-e004/case.scrml
    1	conformance/cases/protect/reveal-then-arithmetic-clean/case.scrml
    1	conformance/cases/protect/reveal-wrong-column-e004/case.scrml
    1	conformance/cases/protect/run-terminator-strip-runtime/case.scrml
    1	conformance/cases/protect/safe-projection-no-strip/case.scrml
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
    1	conformance/cases/protect/sse-yield-strip/case.scrml
    1	conformance/cases/protect/strip-client-visible-runtime/case.scrml
    1	conformance/cases/protect/strip-info-select-star/case.scrml
    1	conformance/cases/protect/symbol-description-e006/case.scrml
    1	conformance/cases/protect/upper-table-row-strip/case.scrml
    1	conformance/cases/protect/w-protect-005-null-body-static/case.scrml
    1	conformance/cases/reactive/server-fn-ambient-identity-clean/case.scrml
    1	conformance/cases/reactive/server-fn-authority-wholly-server-error/case.scrml
    1	conformance/cases/reactive/server-fn-cps-authority-marshal/case.scrml
    1	conformance/cases/reactive/server-fn-cps-marshal-derived-warn/case.scrml
    1	conformance/cases/reactive/server-fn-cps-marshal-raw-silent/case.scrml
    1	conformance/cases/reactive/server-fn-derived-read-error/case.scrml
    1	conformance/cases/reactive/server-fn-param-passthrough-clean/case.scrml
    1	conformance/cases/reactive/server-fn-rawvar-read-error/case.scrml
    1	conformance/cases/server-db/cps-idempotency-store-driver-mismatch-neg/case.scrml
    1	conformance/cases/server-db/cps-idempotency-store-driver-mismatch-pos/case.scrml
    1	conformance/cases/server-db/cps-idempotency-store-missing-import-neg/case.scrml
    1	conformance/cases/server-db/cps-idempotency-store-missing-import-pos/case.scrml
    1	conformance/cases/server-db/cps-nonidem-no-storage-neg/case.scrml
    1	conformance/cases/server-db/cps-nonidem-no-storage-pos/case.scrml
    1	conformance/cases/server-db/first-class-fn-ref-server-helper-rt/case.scrml
    1	conformance/cases/server-db/server-fn-writes-reactive-cell-neg/case.scrml
    1	conformance/cases/server-db/server-fn-writes-reactive-cell-pos/case.scrml
    1	conformance/cases/server-db/sql-aggregate-group-rt/case.scrml
    1	conformance/cases/server-db/sql-all-array-shape-rt/case.scrml
    1	conformance/cases/server-db/sql-configured-db-no-e-sql-004/case.scrml
    1	conformance/cases/server-db/sql-get-single-row-rt/case.scrml
    1	conformance/cases/server-db/sql-join-two-tables-rt/case.scrml
    1	conformance/cases/server-db/sql-missing-db-e-sql-004-neg/case.scrml
    1	conformance/cases/server-db/sql-order-limit-rt/case.scrml
    1	conformance/cases/server-db/sql-row-contract-mismatch-neg/case.scrml
    1	conformance/cases/server-db/sql-row-contract-mismatch-pos/case.scrml
    1	conformance/cases/server-db/sql-select-hydrate-rt/case.scrml
    1	conformance/cases/server-db/sql-update-returning-rt/case.scrml
    1	conformance/cases/server-db/sql-where-filter-rt/case.scrml
    1	conformance/cases/server-fn/basic-load-hydrate/case.scrml
    1	conformance/cases/server-fn/cps-call-in-if-arm/case.scrml
    1	conformance/cases/server-fn/e-route-002-neg/case.scrml
    1	conformance/cases/server-fn/e-route-002-pos/case.scrml
    1	conformance/cases/server-fn/e-route-005-neg/case.scrml
    1	conformance/cases/server-fn/e-route-005-pos/case.scrml
    1	conformance/cases/server-fn/optional-absent/case.scrml
    1	conformance/cases/server-fn/optional-present/case.scrml
    1	conformance/cases/sql/bad-conn-prefix-neg/case.scrml
    1	conformance/cases/sql/bare-identifier-body-e-sql-003-neg/case.scrml
    1	conformance/cases/sql/clean-pos/case.scrml
    1	conformance/cases/sql/comment-cloaked-body-e-sql-003-neg/case.scrml
    1	conformance/cases/sql/commented-query-no-e-sql-003/case.scrml
    1	conformance/cases/sql/param-query-no-e-sql-003/case.scrml
    1	conformance/cases/sql/prepare-pattern-c-cell-e-sql-006-neg/case.scrml
    1	conformance/cases/sql/prepare-server-fn-e-sql-006-neg/case.scrml
    1	conformance/cases/sql/runtime-expr-body-e-sql-003-neg/case.scrml
    1	conformance/cases/sql/transactions-concurrent-postgres-pos/case.scrml
    1	conformance/cases/sql/transactions-concurrent-sqlite-e-sql-010-neg/case.scrml
    1	conformance/cases/ssr/i-ssr-auth-scoped-prerender-omitted-pos/case.scrml
    1	conformance/cases/ssr/i-ssr-auth-scoped-prerender-rowscoped-neg/case.scrml
    1	docs/readme-snippets/tasks-app.scrml
    1	docs/tutorial-snippets/05-signup-form.scrml
    1	docs/tutorial-snippets/10-all-together.scrml

- R11 conformance cases OWED (162; the versioned contract — expected files NOT edited). None asserts the struck RUN-TIME
  silent mode (impl#1 never had it; server-db/sql-unique-constraint-rt works around the missing SqlError with INSERT OR
  IGNORE). They depend on the silent mode's COMPILE half: each compiles an unhandled `?{}` outside a `!` function and
  asserts no E- code, or an exact code set without E-ERROR-002. Case ids:
    defer/cps-after-last-continuation
    defer/cps-batch0-failure
    defer/cps-batch1-failure
    defer/server-block-nested-neg
    defer/server-in-split-neg
    protect/assign-refresh-runtime
    protect/global-store-e006
    protect/merge-rows-strip-runtime
    protect/mounthydrate-redacts
    reactive/dg-001-cyclic-neg
    reactive/dg-001-cyclic-pos
    server-db/server-fn-in-sync-callback-neg
    server-db/server-fn-in-sync-callback-pos
    server-db/sql-delete-reflects-rt
    server-db/sql-insert-returning-rt
    server-db/sql-multi-table-sequence-rt
    server-db/sql-unique-constraint-rt
    server-fn/sequence-two-fns
    sql/batch-warn-info
    sql/prepare-cps-return-e-sql-006-neg
    sql/prepare-sse-generator-e-sql-006-neg
    sql/prepare-ws-onserver-e-sql-006-neg
    ssr/ssr-auth-scoped-callable-not-seeded
    ssr/ssr-callable-public-seeded-gated-omitted
    auth/auth-001-neg
    auth/auth-001-pos
    auth/auth-005-db-context-neg
    auth/auth-async-stdlib-sync-callback-neg
    auth/program-nested-auth-neg
    auth/program-nested-auth-pos
    auth/session-ambient-server-neg
    auth/session-ambient-server-pos
    auth/w-serverload-ungated-neg
    auth/w-serverload-ungated-pos
    body-top/sql-statement-not-shipped
    codegen/cg-001-server-block-warn-pos
    fn/sql-access-in-function-clean
    fn/sql-access-reject
    lifecycle/request-body-client-wrapper-rt
    lifecycle/request-data-is-some-if-attr-rt
    lifecycle/request-data-is-some-value-bool-class-attr-rt
    lifecycle/request-deps-empty-mount-only-rt
    lifecycle/request-deps-explicit-listed-refire-rt
    lifecycle/request-deps-explicit-unlisted-no-refire-rt
    lifecycle/request-refetch-fn-body-stmt-rt
    lifecycle/request-refetch-inline-multi-stmt-rt
    lifecycle/request-settle-error-rt
    lifecycle/request-settle-success-rt
    meta/meta-sql-in-runtime-block-neg
    protect/alias-write-e006
    protect/arguments-e006
    protect/arithmetic-e006
    protect/bare-digest-e006
    protect/callback-param-e006
    protect/channel-broadcast-strip
    protect/comment-prefixed-strip-info
    protect/computed-key-e006
    protect/cte-strip-client-visible-runtime
    protect/cte-strip-info
    protect/descriptor-symbol-e006
    protect/e-pa-005-neg
    protect/e-pa-005-pos
    protect/e-pa-006-neg
    protect/e-pa-006-pos
    protect/e-protect-003-neg
    protect/e-protect-003-pos
    protect/e-protect-005-neg
    protect/e-protect-005-pos
    protect/element-alias-write-e006
    protect/endpoint-multikey-arm-response
    protect/expr-column-row-strip-runtime
    protect/from-upper-table-e006
    protect/helper-mutates-param-e006
    protect/hmac-constant-key-e006
    protect/keyed-hash-clean
    protect/length-object-e006
    protect/login-verify-clean
    protect/lookup-field-e006
    protect/lookup-keys-e006
    protect/lookup-method-e006
    protect/map-get-field-e006
    protect/marker-removal-alias-e006
    protect/mediated-response-passthrough
    protect/nested-container-write-e006
    protect/nonprotected-field-runtime
    protect/null-body-response-clean
    protect/raw-egress-e004
    protect/reduce-index-by-e006
    protect/response-header-e006
    protect/returning-strip-runtime
    protect/reveal-client-visible-runtime
    protect/reveal-suppresses-e004
    protect/reveal-then-arithmetic-clean
    protect/reveal-wrong-column-e004
    protect/run-terminator-strip-runtime
    protect/safe-projection-no-strip
    protect/scalar-concat-e006
    protect/scalar-encoding-e006
    protect/scalar-helper-cross-file-e006
    protect/scalar-helper-e006
    protect/scalar-in-new-object-e006
    protect/scalar-map-e006
    protect/scalar-return-e006
    protect/select-upper-column-e006
    protect/select-upper-column-row-strip-runtime
    protect/spaced-star-strip-runtime
    protect/sse-yield-strip
    protect/strip-client-visible-runtime
    protect/strip-info-select-star
    protect/symbol-description-e006
    protect/upper-table-row-strip
    protect/w-protect-005-null-body-static
    reactive/server-fn-ambient-identity-clean
    reactive/server-fn-authority-wholly-server-error
    reactive/server-fn-cps-authority-marshal
    reactive/server-fn-cps-marshal-derived-warn
    reactive/server-fn-cps-marshal-raw-silent
    reactive/server-fn-derived-read-error
    reactive/server-fn-param-passthrough-clean
    reactive/server-fn-rawvar-read-error
    server-db/cps-idempotency-store-driver-mismatch-neg
    server-db/cps-idempotency-store-driver-mismatch-pos
    server-db/cps-idempotency-store-missing-import-neg
    server-db/cps-idempotency-store-missing-import-pos
    server-db/cps-nonidem-no-storage-neg
    server-db/cps-nonidem-no-storage-pos
    server-db/first-class-fn-ref-server-helper-rt
    server-db/server-fn-writes-reactive-cell-neg
    server-db/server-fn-writes-reactive-cell-pos
    server-db/sql-aggregate-group-rt
    server-db/sql-all-array-shape-rt
    server-db/sql-configured-db-no-e-sql-004
    server-db/sql-get-single-row-rt
    server-db/sql-join-two-tables-rt
    server-db/sql-missing-db-e-sql-004-neg
    server-db/sql-order-limit-rt
    server-db/sql-row-contract-mismatch-neg
    server-db/sql-row-contract-mismatch-pos
    server-db/sql-select-hydrate-rt
    server-db/sql-update-returning-rt
    server-db/sql-where-filter-rt
    server-fn/basic-load-hydrate
    server-fn/cps-call-in-if-arm
    server-fn/e-route-002-neg
    server-fn/e-route-002-pos
    server-fn/e-route-005-neg
    server-fn/e-route-005-pos
    server-fn/optional-absent
    server-fn/optional-present
    sql/bad-conn-prefix-neg
    sql/bare-identifier-body-e-sql-003-neg
    sql/clean-pos
    sql/comment-cloaked-body-e-sql-003-neg
    sql/commented-query-no-e-sql-003
    sql/param-query-no-e-sql-003
    sql/prepare-pattern-c-cell-e-sql-006-neg
    sql/prepare-server-fn-e-sql-006-neg
    sql/runtime-expr-body-e-sql-003-neg
    sql/transactions-concurrent-postgres-pos
    sql/transactions-concurrent-sqlite-e-sql-010-neg
    ssr/i-ssr-auth-scoped-prerender-omitted-pos
    ssr/i-ssr-auth-scoped-prerender-rowscoped-neg

- 2026-10-03 SET A committed (`445bbf453`, pre-commit full suite green: 29944 pass / 0 fail).

- 2026-10-03 SCOPE EXTENSION from the PA: bryan ruled R2/R3/R5/R6/R8/R9/R10 "yes on all seven" (user-voice §S451,
  last entry). SPEC text, each with a Provenance line + direction note:
  - **R2** §12.4 new bullet (reactive cells are client-only; transitive reach from a server body = E-ROUTE-002 with the
    chain; direct access keeps E-REACTIVE-003 / E-RI-002; `@currentUser`/`@session`, channel cells, CPS marshalled reads
    excluded) + §34 E-ROUTE-002 row (R2 limb, Nominal). Newly-rejecting. impl#1 probe: server fn calling a helper that
    reads `@x` → exit 0, W-DEAD-FUNCTION on the helper, helper absent from the server module (run-time ReferenceError).
    Filed `g-impl1-route-002-reactive-cell-chain-s451`.
  - **R3** §34 E-ROUTE-001 row → Error (+ a note on §12.4's sentence). Catalog correction; §12.4 unchanged. impl#1 still
    warns — the existing `g-e-route-001-severity-contradicts-12-4-and-one-limb-never-fires` updated, not duplicated.
  - **R5** §19.10.6 new bullet: the gate covers every statement on the connection (autocommit, manual BEGIN/COMMIT,
    outside-request code); a transaction does not begin while another owner's statement executes. impl#1 conforms
    (`sql-tx-guard.ts` `run()` acquires the mutex for a statement outside any transaction on SQLite) — no gap.
  - **R6** §19.10.6 new bullet + §19.10.4 and §8.9.2 cross-refs: a manual `?{BEGIN}` is held by the issuing function's
    invocation; open at return → rolled back, connection released, reported. READING (flagged): "reported" = a server
    log line naming the function + the call does not report success (mirrors the request-level backstop). impl#1 rolls
    back only at request end (code reading) — filed `g-impl1-manual-begin-open-at-function-return-s451`.
  - **R8** new §57.8 + §12.5.1 bullet + §19.9.1 note: unit variant = name string (unchanged); payload variant =
    `{"variant","data":{declared fields}}`; the `fail` envelope carries the same `variant`/`data` (+ `__scrml_error`,
    `type`), `data` = `{}` for a fieldless error variant. I did NOT add a strict malformed-`data` rule (that is the codec's
    open Q3, not ruled). impl#1 matches except the no-schema `fail` branch — filed `g-impl1-payload-enum-wire-shape-s451`.
  - **R9** §8.9 intro + §8.9.2 + §19.10.5: the implicit envelope fires for ≥2 `?{}` without `.nobatch()` in a `!` server
    body, independent or not; the §8.9.1 candidate set now governs only prepare/lock sharing. READING: "none `.nobatch()`"
    read as "count the queries that do not carry `.nobatch()`". impl#1 probe (`server function f()! -> SqlError` with a
    dependent SELECT→UPDATE) already emits `BEGIN DEFERRED`; its envelope holes are the two existing S449 gaps — none new.
  - **R10** §57.4 Scope paragraph + bullet scoping + §57.5 note + §12.5.1 decoder contract: strict (canonical-only) on
    compiler-internal routes now; dual decoder only for `<api>` (§60) responses and `<endpoint>` (§61) requests.
    Newly-rejecting on internal routes (nothing this compiler emits sends raw null). Filed
    `g-impl1-dual-decoder-on-internal-routes-s451` (code reading of `_scrml_wire_decode`).
    UNRECONCILED (left OPEN in §57.5): whether §57.5's v1.0 canonical-only rule still retires raw-null admission on
    foreign endpoints, given R10 keeps the dual decoder there.
  - SPEC-INDEX summary notes added for §6, §8, §12, §13, §19, §34, §44, §57 (covering set A and set B); index regenerated
    + `--check` OK; FACTS regenerated + `--check` PASS; `state.ts --write` / `--check` PASS.
