# `<match>` block-form implementation arc — progress

## 2026-05-19 (S107) — SCOPING.md authored

Surfaced during S107 README clarification on `rule=` semantics. User asked PA to make "rule= accepted + compiler-checked but inert at runtime" explicit. PA investigation discovered W-MATCH-RULE-INERT is spec'd but unimplemented; attempted PASS-20 walker landed on a deeper finding: the WHOLE `<match>` block-form (§18.0.1 + §18.0.2 + §18.0.3) is spec'd but the parser captures the entire block as a single `kind: "html-fragment"` AST node — no structural arm-children, no exhaustiveness check, no rule= validation, no payload binding, no codegen dispatch, no runtime render.

PASS-20 walker reverted at S107 (would never fire against html-fragment AST). User direction: "fix this the right way, right now" → SCOPING this session, impl across N sessions.

SCOPING content:
- §1 reproducer + §2 observed output (html-fragment + zero diagnostics + zero render)
- §3 spec verification per Rule 4 (§17.0 / §18.0 / §18.0.1 / §18.0.2 / §18.0.3 / §34 rows read in full from SPEC.md directly)
- §4 root cause analysis (4 sites: parser / SYM / codegen / type-system)
- §5 five-phase plan (~12-19h aggregate; parser → SYM → codegen → bare-variant + edges → tests+samples+docs)
- §6 PA recommendation: PA-direct sequenced phases (tight integration, agent-dispatch loses)
- §7 ten OQs (Q-MB-1 AST node kind / Q-MB-2 arm-child kind / Q-MB-3 payload binding mirror / Q-MB-4 bare-variant inference reuse / Q-MB-5 missing-on= error code / Q-MB-6 parser locus / Q-MB-7 backward compat / Q-MB-8 auto-implied on= scope / Q-MB-9 test infra / Q-MB-10 article+PRIMER audit)
- §8 files affected (preliminary 18-file inventory)
- §9 cross-references
- §10 tags

README posture confirmed: existing rule= clarification stays — nominal language consistent with designer's note disclaimer. This arc closes the gap between nominal + implemented.

**Next step:** surface OQs to user for ratification, then commit SCOPING. Phase 1 dispatch (parser) is the natural next-PA-action; could fit this session if budget allows OR cleanly defer.

## 2026-05-19 (S107, mid-session) — OQ ratifications via AskUserQuestion

User ratified all 4 PA recommendations:
- **Q-MB-1: New `match-block` AST kind** (not flag-on-markup) — Phase 1 introduces the kind
- **Q-MB-3: Reuse §51.0.B.1 parenthesized-form parser** — zero parallel surfaces; spec restricts match-locus to parenthesized only
- **Q-MB-5: New §34 row `E-MATCH-ON-REQUIRED`** — Phase 2 adds the row + normative bullet in §18.0.1
- **Q-MB-7: Ship the impl, let new errors surface** — no feature flag; PA greps adopter surface pre-Phase-1 + fixes/removes broken instances as part of Phase 5

Remaining OQs (Q-MB-2 / 4 / 6 / 8 / 9 / 10) are PA-internal-decidable during dispatch — surface decisions in per-phase commits.

**Next step:** commit SCOPING standalone; Phase 1 (parser) follows as the next PA action (this session if budget, otherwise next).
