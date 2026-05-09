# A8 / A6-1 — `test-bind` SPEC amendment — Phase-0 Survey

**Authority chain (verbatim sources, Rule 4 priority):**
- Insight 22 (`scrml-support/design-insights.md` lines 1409-1442) — normative verdict
- S67 user-direction (`scrml-support/user-voice-scrmlTS.md` lines 5610-5625) — flip-conditions methodology rule
- Existing SPEC.md prose: §19.12 (lines 11301-11357), §47 (lines 17786-18305), §34 (lines 14139+, E-TEST-001..005 at 14351-14355)

**Baseline tests at start (verified):** 10,308 pass / 60 skip / 1 todo / 0 fail.
(BRIEF stated 10,349; the actual current main is 10,308 — 41 tests below the brief estimate. Recorded in progress.md; running source unchanged so the final count must equal 10,308.)

---

## Decision 1 — Home for the spec text

**Decision:** PRIMARY home is **§19.12** (extend with new subsections §19.12.6 + §19.12.7 + §19.12.8 covering test-bind declaration, dispatch contract, and worked examples). SECONDARY cross-reference paragraph in §47.5 (Scope of Application) flagging the test-mode dispatch hook + dead-code-elimination claim. NO new top-level section.

**Reasoning:**
- §19.12 is *Interaction with `~{}` Tests* — already the home for `~{}`-block test surface (`assert.fails`, `assert.fails.with`). `test-bind` is a NEW declaration form inside the SAME `~{}` block grammar. Topically and structurally adjacent.
- §47 is the *Output Name Encoding* section — server-fn keys are §47-encoded names per Insight 22. The dispatch-mechanism cross-ref belongs there (one paragraph at the §47.5 "Scope of Application" boundary), not the surface declaration text.
- §54 was considered (per BRIEF lean) but §54 is *Nested Substates and State-Local Transitions* (not test-block grammar) — confirmed via SPEC-INDEX line 81. NOT a test-block home.
- A new §54.X would split the `~{}` test surface across two unrelated section trees — anti-pattern relative to §19.12's existing test-block content.

**Anchors picked:**
- New `### 19.12.6 test-bind Declaration` (after §19.12.5 Normative Statements at line 11357; the existing §19.13 starts at 11360, so §19.12.6 + §19.12.7 + §19.12.8 are inserted between 11357 and 11360).
- §19.13 Error Codes table extended with new row (placement decision below).
- One paragraph appended to §47.5 with cross-ref pointer back to §19.12.6.

## Decision 2 — Handler shape: literal vs function discriminated by syntax or by typer?

**Decision:** Discriminated by **syntax at the parse stage**. The right-hand side of `test-bind <name> = <rhs>` is parsed as a normal logic-context expression (per §7); the typer THEN validates that:
- If RHS resolves to a function value (any `function`/`fn`/anonymous `(args) => body`/`server fn`/`pure fn` typed as `Fn(...) -> T`), the function's signature MUST be assignable to the bound server-fn's signature (param types + return type).
- If RHS resolves to a non-function value `v`, it is treated as a "return-stub" — the dispatch site behaves as `() => v` and the typer requires `typeof v` to be assignable to the bound server-fn's return type. (The bound server-fn's parameter list is ignored at the test-binding site for stub form; the runtime dispatch ignores call args and returns `v`.)

**Reasoning:** Insight 22 verbatim says "`<literal-or-handler>` — both legal." It does not name a syntactic discriminator (no `value=`/`handler=` keyword). Discrimination by typer is the scrml-way alignment with §7 logic-expression semantics — same expression slot, type-system decides downstream behavior. This mirrors how `default=expr` (§6.8) accepts any expression evaluating to the cell's value type without a syntactic literal/computed split. Surface remains terse; one rule covers both shapes.

**Spec-text consequence:** §19.12.6 declaration grammar treats RHS as a single expression. §19.12.7 dispatch contract states that the typer chooses literal-stub vs handler-call dispatch based on the resolved type of the RHS expression at compile time. No new error code is needed for this decision (it falls under the existing handler-signature mismatch surface; A6-3 type-system step assigns a precise code if needed and surfaces it then).

## Decision 3 — Error code: new E-TEST-006 vs reuse E-TEST-002?

**Decision:** **Add NEW error code `E-TEST-006`** for "fail-fast on unbound server-fn call inside an active test-bind context." Add to §19.13 (the §19-local error-code table) AND mirror the row in §34 (the global catalog) per the existing §19.13 → §34 cross-reference convention (lines 11362-11375 and 14351-14355).

**Reasoning:**
- E-TEST-002 ("unexpected error during execution") is the catch-all for runtime test errors — semantically distinct from a *compile-time-aware fail-fast contract* about test-bind specifically. Reusing it would erase the diagnostic specificity Insight 22 warrants ("error, not silent passthrough" implies a NAMED contract).
- E-TEST-001..005 are §19.12-domain (the existing test-block surface). E-TEST-006 is the next free integer in the same family and belongs to the same section's error table.
- Severity = **Test** (matches E-TEST-001..005 severity classification at lines 14351-14355). It is a runtime-throw inside test-mode execution, not a compiler-stage error.
- Trigger text: "`~{}` test block: server-function call inside active `test-bind` context references a server function with no `test-bind` declaration in scope and no `passthrough` enabled." (passthrough is OQ-test-bind-passthrough, deferred — but the trigger text MAY mention it as forward-compat phrasing; safer to omit and add when OQ resolves.)
- Per Insight 22 verbatim: "Unbound server functions in test mode with active `test-bind` context: fail-fast (error, not silent passthrough)." This is the verbatim trigger; E-TEST-006 codifies it.

**Catalog insertion:** Insert E-TEST-006 row in §34 Error Codes table immediately after E-TEST-005 at line 14355 (alphabetical-by-family ordering preserved).

## Decision 4 — OQ deferral notes shape

**Decision:** Use the **§51.0.K Machine Cohesion footnote convention** (lines 20590-20620) — a single blockquote-prefixed footnote at the END of §19.12.7 (Dispatch Contract) titled `> **OQ deferral footnote (S67-style, A6-1).**` listing all four open questions inline with one-sentence each + a stable identifier so A6-2/A6-3/A6-4/A6-5/A6-6 can backlink:

- **OQ-8b** (`<onTransition>` body effects beyond server-fn calls) — out of A6 scope per Insight 22 partial-closure framing; reserved for future debate.
- **OQ-test-bind-concurrency** — parallel test-runner block-local table isolation; implementation question carried into A6-3 (typer scope-table) and A6-4 (codegen dispatch-table); spec is silent on the isolation primitive.
- **OQ-test-bind-passthrough** — verdict ratifies fail-fast (E-TEST-006 above). The OQ remains as "validate against test-runner ergonomics" — the spec MAY relax fail-fast in a future amendment if real ergonomics require it; not adopted at this time.
- **OQ-audit-log-compose** — interaction with `audit @log` (§51.11) is left open; spec is silent on whether test-bound values appear in the audit log.

**Reasoning:** This is the same shape used for the §51.0.K Machine Cohesion S67 footnote that ratified Insight 23. Stable footnote convention; PA + future spec authors can locate every OQ by grepping `OQ deferral footnote (S67-style)`. The footnote does NOT make normative claims that contradict Insight 22 — it ONLY records deferrals.

## Decision 5 — Position B / forward-compat / S67 flip-condition rule

Insight 22 explicitly addresses Position B (effect-record schemas + `expects` sequences) as **not adopted at this time**, structurally extensible. Per S67 user-direction methodology rule, NO flip-condition gating language. Spec text MUST say "not adopted at this time; structurally extensible if a real use case emerges later" (the S67 verbatim phrasing) — never "gated on flip condition X."

Position B's deferral note lives in §19.12.7 alongside the dispatch contract (where the forward-compat extension point is), NOT in the OQ footnote (Position B is a ratified-deferral, not an open question).

## Decision 6 — Insight 21 / E-TEST-004 / E-FN-004 explicit-unchanged claims

Per Insight 22 verbatim:
- E-TEST-004 unchanged (no outer-scope ref relaxation needed; `test-bind` is scope-local declaration, not outer-scope reference).
- E-FN-004 unchanged (denial-via-`fn` for coeffects stands).
- Insight 21 unchanged (no effect rows on `fn` types).

These three explicit-unchanged claims belong in §19.12.6's normative statements section as a numbered list. They serve as the audit-trail anchor — anyone reading the new test-bind text can trace back to each unchanged invariant.

## Decision 7 — Worked example shape

The BRIEF supplies a worked example in canonical scrml shape (NOT Jest/Sinon). Use it verbatim or near-verbatim in §19.12.8 (Worked Examples). The example MUST cover:
- Multiple `test-bind` declarations per block.
- Both handler shapes: function-form (`fetchUser = (id) => {...}`) and literal/return-stub (`fetchPosts = []`).
- Scope-local nature (the binds disappear at `~{}` block close).
- Integration with engine-bearing test (the OQ-8 use case Insight 22 references).

## Verdict shape (anticipated)

SHIP — pure spec text, no source changes, all decisions above are derivable from Insight 22 verbatim + existing SPEC §19.12/§47/§34 prose. No invention.

## Touched-files inventory

- `compiler/SPEC.md` (3 sites — §19.12 extended with §19.12.6/.7/.8, §19.13 error table +1 row, §47.5 cross-ref paragraph)
- `compiler/SPEC.md` (1 site — §34 catalog +1 row for E-TEST-006)
- `compiler/SPEC-INDEX.md` (3 row notes — §19, §34, §47)
- `docs/changes/phase-a8-step-a6-1-test-bind-spec/SURVEY.md` (this file)
- `docs/changes/phase-a8-step-a6-1-test-bind-spec/progress.md` (crash-recovery)

**Negative inventory verified clean:**
- 0 files under `compiler/src/` will be touched (C13's territory).
- 0 files under `compiler/tests/` will be touched.
- 0 files under `scrml-support/` will be touched (read-only sources).
- 0 of `pa.md`, `master-list.md`, `hand-off.md` will be touched.

## A6-2 (parser) handoff preview

Once spec text lands, A6-2 parser must recognize:
- New keyword `test-bind` legal ONLY inside `~{}` block bodies (NOT inside nested `${}` logic, NOT inside `${test "..." {}}` test-case bodies — the declaration is at block-body scope, sibling to `test "..." {...}` and `assert.*` statements).
- Production: `test-bind-decl ::= 'test-bind' identifier '=' expression`.
- Identifier names a server-fn that exists in the file's import scope (resolved by typer A6-3, not parser).
- RHS is a normal expression (parser hands a logic-context-expression AST node to the typer).
- Multiple `test-bind` decls per `~{}` block are legal; later decls for the same identifier SHALL be a parse error (E-TEST-006-DUP candidate; A6-2 to confirm or punt to typer).
