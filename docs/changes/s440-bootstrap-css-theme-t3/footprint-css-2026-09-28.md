# Footprint grade — CSS=compiler/self-host-v2/slice-m3/css-substitute.js

Cases graded or classified: **1048 of 1048** case directories found by an independent enumeration.

**Headline: 299 RUNTIME passes of 299 graded runtime-half cases** (0 fail).

| bucket | cases |
|---|---|
| GRADED, runtime half — pass | 299 |
| GRADED, runtime half — fail | 0 |
| GRADED, codes-only — pass (front-end codes — NOT bootstrap evidence) | 266 |
| GRADED, codes-only — fail | 0 |
| — of which xfail (impl1-ts mark, failing as recorded) | 6 |
| — of which xpass (reported, not red) | 0 |
| CRASHED in footprint() (counted in the fails above) | 0 |
| NOT-YET (footprint outside the implemented set, or expects a CG-emitted code — never red) | 36 |
| FRONT-END (impl#1's front end rejects the program — bootstrap analyze's queue, not graded) | 447 |
| graded cases run by the conformance runner | 565 of 565 |

## Constructs exercised by passing RUNTIME cases (candidates — certified only by the bite matrix)

`Css.LayerOrder` · `Css.Reset` · `Reset.Body` · `Reset.BoxSizing` · `Reset.FlowMargin` · `Reset.FormFont` · `Reset.Media`

## Fail list (first diverging reason per case)

(none)

## Passing RUNTIME cases

- `block-grammar/block-028-leading-equals-text-pos`
- `components/ambient-engine-cell`
- `components/each-in-prop-scope`
- `components/multi-instance`
- `components/props-render`
- `control-flow/ctrl-012-default-logic-multiline-prose-neg`
- `control-flow/ctrl-012-default-logic-non-leading-residual-neg`
- `control-flow/ctrl-012-default-logic-prose-neg`
- `control-flow/ctrl-017-show-ssr-hide-variant-render-no-hide-pos`
- `control-flow/ctrl-018-show-ssr-hide-module-init-write-fail-open-pos`
- `control-flow/ctrl-019-show-ssr-hide-spelling-parity-pos`
- `control-flow/ctrl-020-show-ssr-hide-no-duplicate-style-pos`
- `control-flow/ctrl-021-value-form-sugar-lift-less-branch-pos`
- `control-flow/ctrl-022-value-form-no-else-renders-nothing-pos`
- `control-flow/ctrl-023-value-form-sugar-bound-position-pos`
- `control-flow/ctrl-024-value-form-sugar-bound-no-else-pos`
- `control-flow/ctrl-025-arm-body-statement-is-side-effect-pos`
- `control-flow/ctrl-026-arm-body-nested-value-form-decl-pos`
- `control-flow/ctrl-027-arm-body-tilde-read-and-recovery-pos`
- `control-flow/ctrl-029-value-form-sugar-markup-branch-pos`
- `control-flow/if-chain-branch-declared-function-pos`
- `control-flow/if-chain-inactive-branches-absent`
- `control-flow/if-on-each-render-gate-absent-rt`
- `control-flow/if-on-each-render-gate-unmounts-rt`
- `control-flow/if-on-engine-render-gate-absent-rt`
- `control-flow/if-on-engine-render-gate-mounts-rt`
- `control-flow/if-on-match-render-gate-absent-rt`
- `control-flow/if-on-match-render-gate-mounts-rt`
- `control-flow/s437-braceless-else-in-failable-arm`
- `control-flow/s437-r5-braced-else-block-comment-fn`
- `control-flow/s437-r5-braced-else-if-chain-comments-fn`
- `control-flow/s437-r5-braced-else-line-comment-fn`
- `control-flow/s437-r5-braced-else-line-comment-top-logic`
- `control-flow/s437-r5-braced-else-ownline-comment-fn`
- `control-flow/s437-r5-value-form-if-else-line-comment`
- `defer/array-literal-lead`
- `defer/control-flow-inner-loop-ok`
- `defer/cps-after-last-continuation`
- `defer/cps-batch0-failure`
- `defer/cps-batch1-failure`
- `defer/deferred-host-error-runs-rest`
- `defer/duplicate-function-no-defer-ok`
- `defer/fail-path`
- `defer/fn-pure-local`
- `defer/function-hoist-across-defer`
- `defer/handled-failable-ok`
- `defer/hoist-structural`
- `defer/hoist-structural-twin`
- `defer/identifier-untouched`
- `defer/later-shadow-ok`
- `defer/lifo-fallthrough`
- `defer/loop-per-iteration`
- `defer/not-reached-and-nested-blocks`
- `defer/propagate-path`
- `defer/return-value-before-deferred`
- `defer/server-callee-error-total-handler`
- `defer/server-callee-error-total-handler-twin`
- `defer/stack-arrow-helper-before-defer`
- `defer/stack-arrow-helper-before-defer-twin`
- `defer/stack-fn-calls-fn-before-defer`
- `defer/stack-fn-calls-fn-before-defer-twin`
- `defer/tilde-across-defer`
- `derived/chain`
- `derived/diamond`
- `each/as-alias`
- `each/count-reactive`
- `each/empty-fallback`
- `each/empty-teardown`
- `each/for-lift-list`
- `each/for-lift-per-item-if-reactive/create-time-absence`
- `each/for-lift-per-item-if-reactive/flip-false-true`
- `each/for-lift-per-item-if-reactive/flip-true-false`
- `each/for-lift-per-item-if-reactive/reorder-toggled`
- `each/keyed-reconcile`
- `each/multi-root`
- `each/nested`
- `each/per-item-if-reactive/create-time-absence`
- `each/per-item-if-reactive/flip-false-true`
- `each/per-item-if-reactive/flip-true-false`
- `each/per-item-if-reactive/reorder-toggled`
- `each/per-item-reactivity`
- `each/render-static`
- `each/shorthand-longhand-parity-rcdata`
- `each/shorthand-option-label-preserved`
- `each/shorthand-restricted-textarea`
- `each/ternary-markup-giti033`
- `each/when-changes-in-row-body`
- `engine/derived-engine-match-qualified-lhs`
- `engine/engine-derived`
- `engine/external-transition-resets-rt`
- `engine/history-fresh-reset-rt`
- `engine/history-restore-rt`
- `engine/initial-cell`
- `engine/internal-transition-preserves-rt`
- `engine/match-in-state-child-warns`
- `engine/message-dispatch`
- `engine/message-effect`
- `engine/nested-engine-inner-transition-rt`
- `engine/on-timeout`
- `engine/on-timeout-no-advance`
- `engine/phase-advance`
- `engine/s437-braceless-else-in-effect-bodies`
- `engine/statechild-component-generic-closer-in-element-rt`
- `error-boundary/fallback`
- `error-boundary/nested-inner-catches`
- `error-boundary/no-renders-falls-to-fallback`
- `error-boundary/renders-multifield-payload`
- `error-boundary/success-transparent`
- `error-boundary/terse-fallback-closer`
- `error-boundary/variant-renders`
- `error/failable-handler-lift`
- `error/failable-handler-lift-success`
- `error/failable-handler-lift-timeout`
- `error/handler-recovery-into-cell`
- `error/match-failable-ok-arm-rt`
- `error/propagate-reaches-handler`
- `error/propagate-success-unwrap`
- `fn/scope-redeclare-nested-ok`
- `form-for/formfor-submit-collects-values`
- `form-for/formfor-typing-errors`
- `form-for/formfor-valid-enables-submit`
- `form-for/formfor-validity-bug58-clean`
- `forms/bind-value-input`
- `forms/bind-value-two-field`
- `forms/checkbox-check`
- `forms/checkbox-uncheck`
- `forms/crossfield-match`
- `forms/crossfield-mismatch`
- `forms/crossfield-source-revalidates`
- `forms/errors-empty-no-dom`
- `forms/errors-first-all-rollup`
- `forms/isvalid-rollup`
- `forms/msgchain-l1-inline-override-render`
- `forms/msgchain-l2-registered-render`
- `forms/msgchain-l4-match-escape-render`
- `forms/multierror-compose-order`
- `forms/shortcircuit-req-empty`
- `forms/submitted-on-submit`
- `forms/touched-on-check`
- `forms/touched-on-input`
- `forms/touched-submitted-initial`
- `forms/validator-invalid`
- `forms/validator-valid`
- `forms/vocab-equality-invalid`
- `forms/vocab-equality-valid`
- `forms/vocab-numeric-invalid`
- `forms/vocab-numeric-valid`
- `forms/vocab-set-invalid`
- `forms/vocab-set-valid`
- `forms/vocab-string-invalid`
- `forms/vocab-string-valid`
- `hostmethod/substring-match-typed`
- `lifecycle/boot-effect`
- `lifecycle/effect-on-leave`
- `lifecycle/on-transition-from`
- `lifecycle/on-transition-to`
- `lifecycle/request-data-is-some-if-attr-rt`
- `lifecycle/request-data-is-some-value-bool-class-attr-rt`
- `lifecycle/request-settle-error-rt`
- `lifecycle/request-settle-success-rt`
- `loop/loop-reactive-plain-fn`
- `maps/bracket-read-miss-rt`
- `maps/core-ops-rt`
- `maps/enum-key-rt`
- `maps/order-independent-eq-rt`
- `maps/remove-update-rt`
- `maps/struct-key-value-canonical-rt`
- `markup-handler/expr-handler-call-first-multi-stmt`
- `markup-handler/expr-handler-in-each-row-call-led`
- `markup-handler/inline-block-handler-assign-led-order`
- `markup-handler/inline-block-handler-call-first`
- `markup-handler/inline-block-handler-in-each-row`
- `markup-handler/inline-block-handler-in-each-row-call-led-row-item`
- `markup-handler/inline-block-handler-in-engine-state-child`
- `markup-handler/inline-block-handler-in-engine-state-child-call-led`
- `markup-handler/inline-block-handler-in-match-arm`
- `markup-handler/inline-block-handler-multi-line`
- `markup-handler/inline-block-handler-runs-every-statement`
- `markup-handler/s437-handler-shape-block-comment-with-semicolon`
- `markup-handler/s437-handler-shape-comment-lines-between-statements`
- `markup-handler/s437-handler-shape-comment-only-line`
- `markup-handler/s437-handler-shape-const-then-use`
- `markup-handler/s437-handler-shape-expr-form-leading-comment`
- `markup-handler/s437-handler-shape-expr-form-trailing-comment`
- `markup-handler/s437-handler-shape-if-else-braced`
- `markup-handler/s437-handler-shape-if-else-braceless`
- `markup-handler/s437-handler-shape-loop-in-block`
- `markup-handler/s437-handler-shape-member-continuation-line`
- `markup-handler/s437-handler-shape-regex-with-semicolon-expr-form`
- `markup-handler/s437-handler-shape-regex-with-semicolon-in-block`
- `markup-handler/s437-handler-shape-template-literal-semicolon-newline`
- `markup-handler/s437-handler-shape-ternary-continuation-lines`
- `markup-handler/s437-handler-shape-trailing-line-comments`
- `markup-handler/s437-handler-shape-trailing-operator-continuation`
- `markup-handler/s437-r4-continuation-expr-form-leading-plus`
- `markup-handler/s437-r4-continuation-leading-plus`
- `markup-handler/s437-r4-continuation-leading-question-colon`
- `markup-handler/s437-r4-continuation-trailing-multiply`
- `markup-handler/s437-r4-continuation-trailing-question-colon`
- `markup-handler/s437-r4-single-arrow-expr-form-ok`
- `markup-handler/s437-r5-braced-else-line-comment-handler`
- `markup-handler/s437-r5-handler-map-literal-notice`
- `markup-handler/s437-r5-template-cell-read-first-multiline`
- `markup-handler/s437-r5-template-cell-read-second`
- `match-block/block-arm-nested-assignment-fidelity`
- `match-block/block-arm-tail-after-block-statement`
- `match-block/empty-wildcard-clear`
- `match-block/inline-markup-match`
- `match-block/member-assign-tail-voids-all-paths`
- `match-block/payload-bind`
- `match-block/phase-arm-swap`
- `match-block/round-trip`
- `match-block/value-decl-block-arm-keyword-prefixed-tail`
- `match-block/value-decl-block-arm-raw`
- `match-block/value-decl-block-arm-variant`
- `match-block/value-form-block-arm-all-paths`
- `match-block/value-form-block-arm-derived-reactive`
- `match-block/value-form-derived`
- `match-block/wildcard`
- `match-identifier/giti-016`
- `meta/meta-emit-normalize-escape`
- `meta/meta-emit-raw-escape`
- `meta/meta-emit-splice-render-rt`
- `navigate/explicit-variants`
- `navigate/soft-scope-clean`
- `outlet/class-id`
- `outlet/if-guard-false`
- `outlet/logic-child`
- `outlet/recognized-clean`
- `parse-variant/error-invalid-payload`
- `parse-variant/error-malformed-json`
- `parse-variant/error-missing-discriminator`
- `parse-variant/error-unknown-variant`
- `parse-variant/happy-payload-variant`
- `parse-variant/happy-unit-variant`
- `parse-variant/single-field-payload-bind`
- `print/tool-println-clean-stdout`
- `reactive/array-reassign-reactive`
- `reactive/compound-variant-c`
- `reactive/counter-increment`
- `reactive/debounce-trailing-commit`
- `reactive/decl-array-no-rhs-plain-neg`
- `reactive/decl-needs-initializer-neg`
- `reactive/decl-rhs-interp-wrapped-neg`
- `reactive/derived-doubled`
- `reactive/if-top-level-absent`
- `reactive/if-wiring-bearing-subtree-absent`
- `reactive/if-wiring-bearing-subtree-mounts`
- `reactive/multi-cell-interp`
- `reactive/name-collides-state-neg`
- `reactive/nested-path-method-call-not-first-stmt`
- `reactive/optional-member-access-absent`
- `reactive/optional-member-access-render`
- `reactive/reset-compound-all`
- `reactive/reset-compound-field`
- `reactive/reset-handler`
- `reactive/reset-handler-nonzero-initial`
- `reactive/reset-init-after-assignment-in-if-rt`
- `reactive/reset-init-after-assignment-rt`
- `reactive/reset-to-default`
- `reactive/s437-r5-template-cell-read-function-body`
- `reactive/s437-r5-template-cell-read-value-attr`
- `reactive/shape4-canonical-empty`
- `reactive/textarea-rcdata-value-bind`
- `reactive/throttle-leading`
- `reactive/throttle-trailing-commit`
- `reactive/toggle-show`
- `refinement/boundary-reject-rt`
- `refinement/inhabit-rt`
- `refinement/string-shape-inhabit-rt`
- `server-db/first-class-fn-ref-server-helper-rt`
- `server-db/sql-aggregate-group-rt`
- `server-db/sql-all-array-shape-rt`
- `server-db/sql-delete-reflects-rt`
- `server-db/sql-get-single-row-rt`
- `server-db/sql-insert-returning-rt`
- `server-db/sql-join-two-tables-rt`
- `server-db/sql-multi-table-sequence-rt`
- `server-db/sql-order-limit-rt`
- `server-db/sql-select-hydrate-rt`
- `server-db/sql-unique-constraint-rt`
- `server-db/sql-update-returning-rt`
- `server-db/sql-where-filter-rt`
- `server-fn/basic-load-hydrate`
- `server-fn/branch-declared-server-fn-routes-to-server`
- `server-fn/cps-call-in-if-arm`
- `server-fn/error-boundary-fallback`
- `server-fn/optional-absent`
- `server-fn/optional-present`
- `server-fn/sequence-two-fns`
- `server-fn/sse-generator-binding-seed-survives`
- `ssr/ssr-auth-scoped-callable-not-seeded`
- `ssr/ssr-auth-scoped-cell-not-seeded`
- `ssr/ssr-auth-scoped-commented-currentuser-not-seeded`
- `ssr/ssr-auth-scoped-literal-currentuser-not-seeded`
- `ssr/ssr-callable-public-seeded-gated-omitted`
- `ssr/ssr-first-paint-redacted-runtime`
- `ssr/ssr-first-paint-render`
- `table-for/tablefor-render-rt`

## Passing codes-only cases (front-end codes — NOT bootstrap evidence; never count toward certification)

- `api/api-clean-pos`
- `api/api-response-not-variant-info`
- `auth/auth-001-neg`
- `auth/auth-002-neg`
- `auth/auth-003-neg`
- `auth/auth-005-db-context-neg`
- `auth/auth-005-neg`
- `auth/auth-graph-002-neg`
- `auth/auth-graph-003-neg`
- `auth/auth-graph-004-neg`
- `auth/i-auth-redirect-unresolved-neg`
- `auth/i-auth-redirect-unresolved-pos`
- `auth/w-auth-content-not-gated-neg`
- `auth/w-auth-login-missing-neg`
- `auth/w-auth-login-missing-pos`
- `auth/w-serverload-ungated-neg`
- `auth/w-serverload-ungated-pos`
- `block-grammar/block-047-closed-brace-neg`
- `block-grammar/block-ctx-001-closed-raw-content-neg`
- `capability/all-tokens-valid`
- `capability/arg-union-repeated-token`
- `capability/argless-caps-empty-allowlist`
- `capability/explicit-empty`
- `capability/inline-block-covered`
- `capability/inline-block-undeclared`
- `capability/valid-clean`
- `channel/export-string-literal-name`
- `channel/inside-program`
- `channel/module-file-top-level`
- `channel/name-present`
- `channel/name-static-literal`
- `channel/onchange-wildcard-exhaustive`
- `channel/same-source-two-aliases`
- `channel/server-fn-uses-arg`
- `channel/shared-modifier-absent`
- `channel/sibling-of-page`
- `channel/watches-52-authority-shape`
- `channel/watches-broadcast-member-call-ok`
- `channel/watches-clean`
- `channel/watches-derived-const-ok`
- `channel/watches-key-override`
- `channel/watches-no-consumer`
- `channel/watches-no-pk`
- `codegen/cg-export-enum-library-rep`
- `components/bind-non-bindable-prop-clean`
- `components/bind-non-primitive-type-clean`
- `components/duplicate-prop-decl-clean`
- `components/extra-undeclared-prop-clean`
- `components/invalid-prop-decl-syntax-clean`
- `components/malformed-component-body-clean`
- `components/missing-required-prop-clean`
- `components/missing-required-slot-clean`
- `components/multiple-spreads-clean`
- `components/post-ce-residual-component-clean`
- `components/slot-on-parametric-snippet-clean`
- `components/slot-targets-non-snippet-clean`
- `components/unresolved-component-ref-clean`
- `components/unslotted-children-no-spread-clean`
- `control-flow/ctrl-010-else-on-for-without-lift-neg`
- `control-flow/ctrl-010-for-lift-in-match-arm-neg`
- `control-flow/ctrl-011-for-in-neg`
- `control-flow/ctrl-012-bare-control-flow-default-logic-root-neg`
- `control-flow/ctrl-012-bare-control-flow-in-markup-neg`
- `control-flow/ctrl-013-braceless-for-of-head-neg`
- `control-flow/ctrl-switch-forbidden-match-neg`
- `control-flow/loop-007-separate-while-after-decl-neg`
- `control-flow/loop-007-while-as-expr-neg`
- `derived/e-derived-server-only-reach-fn-path`
- `derived/e-derived-server-only-reach-neg`
- `endpoint/arm-body-valid-scope-clean`
- `endpoint/endpoint-clean`
- `endpoint/method-bareword-get-clean`
- `endpoint/self-closing-arm-exhaustive`
- `endpoint/wildcard-exhaustive`
- `engine/composite-inner-colon-shorthand`
- `engine/derived-engine-circular-neg`
- `engine/derived-engine-no-initial-neg`
- `engine/derived-engine-no-rules-neg`
- `engine/derived-machine-no-projection-rules-neg`
- `engine/derived-machine-unprojected-variant-neg`
- `engine/derived-machine-write-neg`
- `engine/engine-var-duplicate-neg`
- `engine/initial-cell-type-neg`
- `engine/initial-cell-undeclared-neg`
- `engine/initial-invalid-variant-neg`
- `engine/machine-alternation-binding-parity-neg`
- `engine/machine-guard-undefined-self-field-neg`
- `engine/machine-rule-binding-unit-variant-neg`
- `engine/mount-not-engine-neg`
- `engine/onidle-legal-neg`
- `engine/ontimeout-legal-neg`
- `engine/ontransition-no-target-neg`
- `engine/payload-binding-neg`
- `engine/replay-cross-machine-neg`
- `engine/replay-log-not-reactive-neg`
- `engine/replay-target-not-machine-bound-neg`
- `engine/rule-invalid-variant-neg`
- `engine/rule-violation-neg`
- `engine/self-write-neg`
- `engine/self-write-pos`
- `engine/state-child-invalid-variant-neg`
- `engine/state-child-missing-neg`
- `engine/transitions-unknown-variant-neg`
- `engine/type-level-transitions-guard-neg`
- `equality/equality-operator-clean`
- `equality/is-not-clean`
- `equality/map-key-comparable-clean`
- `equality/payload-variant-compare-warn`
- `equality/same-type-primitive-clean`
- `equality/unit-variant-compare-clean`
- `error/construct-variant-payload-arity-ok`
- `error/construct-variant-payload-arity-trailing-comma-ok`
- `error/error-008-neg`
- `error/fail-in-failable-neg`
- `error/handler-exhaustive-neg`
- `error/handler-wildcard-escape`
- `error/implicit-tx-explicit-begin`
- `error/propagate-in-non-failable-fn-neg`
- `error/propagate-non-failable-callee-neg`
- `error/render-no-clause-neg`
- `error/render-no-of-neg`
- `error/render-not-enum-neg`
- `error/renders-payload-field-ok`
- `files/multifile-import`
- `fn/deterministic-call-clean`
- `fn/dom-mutation-pure-value-clean`
- `fn/lift-local-accumulator-clean`
- `fn/plain-arrow-clean`
- `fn/reactive-read-clean`
- `fn/sql-access-in-function-clean`
- `fn/sync-decl-clean`
- `foreign/foreign-crossing-clean-pos`
- `foreign/foreign-inline-lang-declared-pos`
- `foreign/foreign-lang-single-pos`
- `form-for/formfor-nested-struct-with-slot-clean`
- `form-for/formfor-omit-valid-clean`
- `form-for/formfor-pick-valid-clean`
- `forms/derived-refinement-type-accepted`
- `forms/errors-element-bad-subject-neg`
- `forms/errors-element-no-of-neg`
- `forms/msgchain-inline-static-accepted`
- `forms/validator-applies-typed-clean`
- `forms/validator-vocab-custom-accepted`
- `input/input-001-neg`
- `lifecycle/cleanup-happy-arrow-and-reference`
- `lifecycle/effect-ontransition-coexist`
- `lifecycle/ontransition-once-if-attrs`
- `linear/lin-001-never-consumed-neg`
- `linear/lin-002-consumed-in-loop-neg`
- `linear/lin-003-branch-asymmetry-neg`
- `linear/lin-004-recurring-ctx-timer-neg`
- `linear/lin-005-shadow-lin-neg`
- `linear/lin-006-deferred-ctx-neg`
- `linear/must-use-unread-neg`
- `loop/loop-005-neg`
- `loop/w-assign-001-severity-pos`
- `maps/duplicate-literal-key-pos`
- `maps/struct-key-literal-pos`
- `markup-handler/multi-stmt-handler-attr-neg`
- `markup-handler/multi-stmt-handler-colon-shorthand-neg`
- `match-block/member-access-complete-clean`
- `match-codes/e-match-012-tnot-else-exhaustive-neg`
- `match-codes/e-match-012-tnot-not-arm-exhaustive-neg`
- `match-codes/e-match-arm-markup-in-value-neg`
- `match-codes/e-match-block-in-lift-neg`
- `match-codes/e-match-effect-forbidden-neg`
- `match-codes/e-match-on-required-neg`
- `match-codes/e-match-ontransition-forbidden-neg`
- `match-codes/e-syntax-010-else-last-neg`
- `match-codes/e-syntax-011-plain-pattern-neg`
- `match-codes/e-type-006-multi-scrutinee-exhaustive-neg`
- `match-codes/e-type-024-enum-subject-neg`
- `match-codes/e-type-025-enum-subject-neg`
- `match-codes/e-type-026-match-in-logic-neg`
- `meta/meta-emit-clean-pos`
- `meta/meta-eval-clean-pos`
- `meta/meta-reflect-clean-pos`
- `middleware/duplicate-handle-neg`
- `middleware/ratelimit-invalid-unit-neg`
- `module/e-export-001-export-const-clean`
- `module/e-export-002-component-single-root-clean`
- `module/e-export-003-attr-distinct-clean`
- `module/e-import-001-export-inside-logic-clean`
- `module/e-import-002-acyclic-import-clean`
- `module/e-import-003-import-top-of-logic-clean`
- `module/e-import-004-name-exported-clean`
- `module/e-import-005-relative-specifier-clean`
- `module/e-import-006-present-file-clean`
- `module/e-import-008-plain-import-clean`
- `module/e-import-pinned-const-clean`
- `module/e-scope-010-filescope-distinct-clean`
- `module/e-use-001-use-toplevel-clean`
- `module/e-use-002-use-before-markup-clean`
- `module/e-use-005-use-good-prefix-clean`
- `page/keep-alive-accepted`
- `parse-syntax/e-syntax-042-not-value-position-neg`
- `parse-syntax/e-syntax-064-at-dot-inside-each-neg`
- `protect/mediated-response-passthrough`
- `reactive/cell-ambiguous-member-render-neg`
- `reactive/cell-no-render-spec-neg`
- `reactive/debounce-valid-neg`
- `reactive/derived-value-mutate-neg`
- `reactive/dg-001-cyclic-neg`
- `reactive/dg-002-no-readers-neg`
- `reactive/dg-002-no-readers-pos`
- `reactive/fn-mutual-recursion-hoist`
- `reactive/hoist-forward-ref-neg`
- `reactive/reactive-map-insert-bare-variant`
- `reactive/server-fn-ambient-identity-clean`
- `reactive/server-fn-param-passthrough-clean`
- `reactive/shape4-refinement-satisfied-neg`
- `reactive/write-not-in-logic-context-neg`
- `refinement/subset-narrowed-exhaustive-neg`
- `route-region/cn10-keepalive-reentry`
- `schema-for/happy-canonical-expansion`
- `schema-for/happy-enum-lowering`
- `schema-for/happy-multi-table-composition`
- `schema-for/happy-nullable-field`
- `schema/clean-pos`
- `schema/w-schema-001-warn`
- `server-db/cps-idempotency-store-driver-mismatch-neg`
- `server-db/cps-idempotency-store-missing-import-neg`
- `server-db/cps-nonidem-no-storage-neg`
- `server-db/server-fn-writes-reactive-cell-neg`
- `server-db/sql-configured-db-no-e-sql-004`
- `server-db/sql-row-contract-mismatch-neg`
- `server-fn/e-route-002-neg`
- `server-fn/e-route-003-neg`
- `server-fn/e-route-004-neg`
- `server-fn/e-route-005-neg`
- `sql/batch-warn-info`
- `sql/clean-pos`
- `sql/commented-query-no-e-sql-003`
- `sql/param-query-no-e-sql-003`
- `ssr/i-ssr-auth-scoped-prerender-omitted-pos`
- `ssr/i-ssr-auth-scoped-prerender-rowscoped-neg`
- `ssr/i-ssr-each-client-rendered-if-gate-bypass-neg`
- `ssr/i-ssr-each-client-rendered-show-enclosed-neg`
- `style/clean-single-rule`
- `style/conditional-hover-layer`
- `style/descendant-combinator-contraction-text`
- `style/descendant-combinator-preserved`
- `style/disjoint-attr-values`
- `style/disjoint-different-tag`
- `style/flat-inline-token-lowering-clean`
- `style/program-import-hoist-clean`
- `style/program-scope-overlap-soft`
- `style/r1-universal-star-layer`
- `style/r2-bem-modifier-soft`
- `style/reactive-cell-lowering-clean`
- `style/reset-opt-out-clean`
- `style/style-001-scoped-css-neg`
- `style/theme-emission-clean`
- `style/theme-for-variant-inference`
- `style/theme-tokens-recognized`
- `type-state-codes/e-state-undeclared-neg`
- `type-state-codes/e-struct-function-field-neg`
- `type-state-codes/e-type-004-struct-field-access-neg`
- `type-state-codes/e-type-022-engine-named-binding-neg`
- `type-state-codes/e-type-041-not-assign-mismatch-neg`
- `type-state-codes/e-type-045-prefix-not-negation-neg`
- `type-state-codes/e-type-062-is-non-enum-lhs-neg`
- `type-state-codes/e-type-081-partial-match-render-neg`
- `type-state-codes/e-type-any-forbidden-neg`
- `type-state-codes/e-type-lifecycle-on-engine-cell-neg`
- `type-state-codes/e-type-lifecycle-variant-not-transitioned-neg`

## Top not-yet reasons by case count (the M3/M4 work queue) — 24 distinct

| cases | reason |
|---|---|
| 7 | `@apply` (§26.8 — the utility table is not in the bootstrap) |
| 5 | expects code E-SQL-006, not emitted by impl#1's front end (CG/post-CG) |
| 4 | expects code I-PROTECT-STRIP-001, not emitted by impl#1's front end (CG/post-CG) |
| 3 | expects code I-SSR-EACH-CLIENT-RENDERED, not emitted by impl#1's front end (CG/post-CG) |
| 2 | expects code E-THEME-TOKEN-UNKNOWN, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-APPLY-NON-INLINABLE-UTILITY, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-APPLY-UNKNOWN-UTILITY, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-APPLY-VARIANT-UNSUPPORTED, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-CELL-AMBIGUOUS-MEMBER-RENDER, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-CG-TILDE-UNRESOLVED, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-CHANNEL-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-EACH-BODY-DECL-UNSUPPORTED, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-ENDPOINT-MULTI-STATEMENT-ARM, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-ERRORS-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-ERRORS-002, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-FOREIGN-006, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-IF-IN-DISPATCHED-ARM, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-INPUT-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-LIFECYCLE-007, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-SQL-004, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-SQL-005, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code W-CG-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code W-DERIVED-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | the `.Dark` variant re-binds `ghost`, which has no base value (E-THEME-TOKEN-UNKNOWN is analyze's) |

## Cases ONE reason away from graded (by that reason)

| cases | the one reason |
|---|---|
| 5 | expects code E-SQL-006, not emitted by impl#1's front end (CG/post-CG) |
| 4 | `@apply` (§26.8 — the utility table is not in the bootstrap) |
| 4 | expects code I-PROTECT-STRIP-001, not emitted by impl#1's front end (CG/post-CG) |
| 3 | expects code I-SSR-EACH-CLIENT-RENDERED, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-CHANNEL-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code W-CG-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-CG-TILDE-UNRESOLVED, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-IF-IN-DISPATCHED-ARM, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-EACH-BODY-DECL-UNSUPPORTED, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-ENDPOINT-MULTI-STATEMENT-ARM, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-FOREIGN-006, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-ERRORS-002, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-ERRORS-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-INPUT-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-LIFECYCLE-007, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-CELL-AMBIGUOUS-MEMBER-RENDER, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code W-DERIVED-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-SQL-004, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-SQL-005, not emitted by impl#1's front end (CG/post-CG) |
| 1 | expects code E-THEME-TOKEN-UNKNOWN, not emitted by impl#1's front end (CG/post-CG) |

## CSS half — computed style in Chromium against SPEC-derived oracles (s440)

**Headline: 38 CSS passes of 38 graded css-oracle cases** (0 fail).

| population | graded with an oracle | pass | fail | graded, no oracle (css unobserved — not evidence) | not graded |
|---|---|---|---|---|---|
| conformance | 17 | 17 | 0 | 548 | 0 |
| source | 15 | 15 | 0 | 0 | 7 |
| core | 6 | 6 | 0 | 0 | 0 |

### Constructs exercised by CSS passes (candidates — certified only by the bite matrix)

`Comb.Child` · `Comb.Descendant` · `Comb.LaterSibling` · `Comb.NextSibling` · `Css.Charset` · `Css.Global` · `Css.Import` · `Css.LayerOrder` · `Css.Reset` · `Css.Scope` · `Decl.Order` · `Reset.Body` · `Reset.BoxSizing` · `Reset.FlowMargin` · `Reset.FormFont` · `Reset.Media` · `Scope.Conditional` · `Scope.Flat` · `Scope.Floor` · `Sel.Attr` · `Sel.Class` · `Sel.Id` · `Sel.PseudoClass` · `Sel.PseudoElement` · `Sel.Tag` · `Sel.Universal` · `Token.Constant` · `Token.OnVariant` · `Token.OnVariant.Otherwise` · `Value.CellVar` · `Value.Text` · `Value.TokenVar`

### CSS passes

- `control-flow/ctrl-020-show-ssr-hide-no-duplicate-style-pos` (conformance)
- `style/clean-single-rule` (conformance)
- `style/conditional-hover-layer` (conformance)
- `style/descendant-combinator-preserved` (conformance)
- `style/disjoint-attr-values` (conformance)
- `style/disjoint-different-tag` (conformance)
- `style/flat-inline-token-lowering-clean` (conformance)
- `style/program-import-hoist-clean` (conformance)
- `style/program-scope-overlap-soft` (conformance)
- `style/r1-universal-star-layer` (conformance)
- `style/r2-bem-modifier-soft` (conformance)
- `style/reactive-cell-lowering-clean` (conformance)
- `style/reset-opt-out-clean` (conformance)
- `style/style-001-scoped-css-neg` (conformance)
- `style/theme-emission-clean` (conformance)
- `style/theme-for-variant-inference` (conformance)
- `style/theme-tokens-recognized` (conformance)
- `css-oracle/charset-layer-import` (source)
- `css-oracle/decl-order` (source)
- `css-oracle/element-level-global` (source)
- `css-oracle/empty-blocks` (source)
- `css-oracle/example-03-contact-book` (source)
- `css-oracle/example-08-chat` (source)
- `css-oracle/import-hoist` (source)
- `css-oracle/layer-order` (source)
- `css-oracle/r1-floor-order` (source)
- `css-oracle/reset-bullets` (source)
- `css-oracle/scope-donut-nested` (source)
- `css-oracle/selectors` (source)
- `css-oracle/two-themes` (source)
- `css-oracle/variant-three` (source)
- `css-oracle/where-flat` (source)
- `css-core/cell-var` (core)
- `css-core/charset` (core)
- `css-core/t3-script-writes` (core)
- `css-core/t3-two-cells` (core)
- `css-core/t3-wildcard` (core)
- `css-core/t3-worked` (core)

### CSS fails

(none)

### css-only sources NOT graded (the reason)

- `css-oracle/adv-important` — not-yet: `!important` (§65.7: internal-vs-interop is not classified yet)
- `css-oracle/adv-token-cell-same-name` — not-yet: the theme token `ink` and a cell share the name (§66.17 item 4: one namespace — E-THEME-TOKEN-CELL-COLLISION, analyze's to fire)
- `css-oracle/open-o17a-hyphenated-token` — not-yet: a `<theme>` body impl#1 did not parse (T3 `<name:type=…/>` declarations need the bootstrap front end)
- `css-oracle/open-o17b-t3-for` — front-end: a `<theme>` body impl#1 did not parse (T3 `<name:type=…/>` declarations need the bootstrap front end)
- `css-oracle/open-o17c-media-autobind` — not-yet: a `<theme>` `@media (…)` auto-bind (O17(c) — OPEN)
- `css-oracle/open-o47-token-reads-cell` — not-yet: a theme token whose value reads the cell `@userColor` (O47 — OPEN)
- `css-oracle/open-t3-worked-example` — front-end: a `<theme>` body impl#1 did not parse (T3 `<name:type=…/>` declarations need the bootstrap front end); `@ink` names no theme token and no cell the shim sees (E-THEME-TOKEN-UNKNOWN is analyze's); `@brand` names no theme token and no cell the shim sees (E-THEME-TOKEN-UNKNOWN is analyze's)
