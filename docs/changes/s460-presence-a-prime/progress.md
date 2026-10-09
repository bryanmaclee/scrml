# progress — s460-presence-a-prime

- 2026-10-08 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a808e70f3ad971aa7 (branch s460-presence-a-prime @ origin/main 879b56893)
- 2026-10-08 startup verified (pwd/toplevel/remote bryanmaclee/scrml.git; merge-base == origin/main 879b56893; bun install; pretest). Bootstrap baseline: lint 65 files 0 violations; m1 99/0; m2 462/0; m3 60/0; m4 1229/0; codec 166/0; lowered-m1 99/0; lexer 337/0.
- maps consulted: primary.map.md (S458/S440 blocks): bootstrap typer lives in analyze.scrml THE TYPER (`checkCond`); `bootstrap-conformance.ts --write` regenerates the report CI gates on; severity.scrml is GENERATED from §34 (`gen-bootstrap-severity.ts`).

## Phase 0 — governing-sentence gate (2026-10-08)

Ruling: user-voice-scrml.md §S460 "RULED — a′, go" (read verbatim). Background dpa-070 §1/§2/§6/§11 read.

### SPEC sentences the ruling CHANGES
1. §66.20 E-COND-NOT-BOOLEAN row (SPEC.md:47182): *"Provable-or-silent: an error wherever the violation is provable, silence where the type is unknown; no §63 window (S440 #4 = (c), Truthiness Q2)."* — CHANGED: unknown type in a condition is now an error (S460 supersedes Q2 for conditions).
2. §42.4 (:31363): *"`not` is falsy. `<div if=@x>` where `@x: T | not` renders when `@x` has a value, unmounts when `@x is not`. The compiler narrows `@x` to `T` inside the `if=`-guarded scope."* — CHANGED: "falsy" (truthiness wording, D12) replaced by the typed presence test; section widened to every condition position (logic if / while / ternary; markup if= / else-if=) and states the known-type / bool / bool|not / unresolved rules.
3. §49.2.3 (:33378-33384): *"The expression is evaluated as a boolean: falsy values terminate the loop, truthy values continue it. The compiler applies the same boolean coercion rules as `if`. No special restriction applies to the type of the condition."* — CHANGED: a `while` condition is a condition (§42.4); there IS a type restriction.
4. §17.1 (:15617, :15629-15634): *"The `if=` attribute is a structural boolean conditional."* + worked example `<div class="error-banner" if=@errorMessage>` (no declaration — string truthiness under S440 #4(c), dpa-070 P3) — CHANGED: rewritten to a ruled form (a declared `string | not` cell → presence test) with the `string` counter-case.
5. §42.2.2a (:31153): *"`expr is some` does NOT narrow the type of `expr`. To narrow from `T | not` to `T`, use `given expr :> { ... }` (§42.2.3)."* — CONTRADICTS §42.3.5 item 2 (:31317, S237 user-ratified: "an `if (recv is not) return` / `is some` early-return") — D12. TOUCHED because the ruling makes `x is given` (§42.2.4's alias of `is some`) THE explicit positive for compounds, which only works if it narrows (`x is given && x > 0`). Resolved in the direction of the later ruling (S237) and impl#1's behaviour (E-TYPE-046 reader narrows `is some`, dpa-070 f02/f21): the sentence is struck for `is given` / `is some` alike (one meaning for an alias pair). `is some`'s retirement is NOT touched.
6. §42.2.4 (:31239): *"`(expr) is given` is a valid alias for `(expr) is some` in an inline boolean position."* — CHANGED framing: `x is given` is the explicit presence test (S460 "incl. `is given` as THE explicit positive"); `is some` stays a same-meaning spelling (its retirement un-ruled — left working).
7. §42.10 (:31469): *"`!(a == b)` and `!@x` are valid."* — narrowed: `!` takes a `bool` (S440 Gotcha Q2 kept); `!@x` on `T | not` is E-OPERATOR-OPERAND-TYPE.
8. §15 E-TYPE-073 (:15435): *"Enclosing `if=propName` attribute (since `not` is falsy per §42.4)"* — wording only: "since a bare `T | not` condition is a presence test (§42.4)".

### SPEC sentences / rulings the ruling KEEPS
- S440 #4(c) (user-voice :19269) *"All conditions require a boolean, or a `T | not` presence test, and the truthiness of numbers and strings goes."* — kept (known non-bool non-optional = E-COND-NOT-BOOLEAN).
- S440 Truthiness Q1 (:19309) *"a bare `@x` of type `T | not` IS a presence test … the compiler emits an absence check, never JS truthiness."* — kept.
- S442 (:19567-19568) *"a bare `bool | not` in a condition is an ERROR naming both fixes"* · *"the presence test COUNTS AS the narrowing (`if=@color` is legal; reads inside are narrowed)"* — kept (fix names now `x is given` / `x == true`).
- S440 Gotcha Q2 (:19312) *"`!`, `&&`, `||` (and `and`/`or`) take booleans only; defaults use `??`."* — kept: a bare optional is a presence test only as a WHOLE condition.
- S440 Truthiness Q2 for NON-condition rules (E-EACH-NOT-SEQUENCE §17.7.2 :16704 *"When the `in=` value's type is not resolved (§7.5.2), the compiler stays SILENT (the typer's provable-or-silent rule)"*; assignability §7.5.1; operator operand checks) — KEPT unchanged.
- §42.1.1 (:31098-31103): `""`, `0`, `false`, `[]`, `{}` are DEFINED values — kept; the presence test treats them as present.
- §42.3.5 (E-TYPE-046 narrowing list, show= not a narrowing guard S451) — kept; `is given` added beside `is some` in item 2.
- §5.2 (:1818) unquoted condition attributes atomic-only — kept: `if=(@x is given)` needs parens; bare `if=@x` is the atomic presence form.
- §7.5.2: `asIs` / `unknown` are "unresolved" — kept and USED: an `asIs`/`unknown` value bare in a condition is the unresolved case.
- §34.0 carry rule (S440 #12) — impl#1 CARRIES (Nominal) the new trigger; the bootstrap implements it.

### Not ruled (left alone)
`is some` retirement; `given`-as-presence retirement; §55 validator `is some`; caveats (i)-(iii) as preconditions. `show=` is not named in the ruling's position list: the bootstrap applies its ONE condition check (checkCond) to `show=` too (s451, §17.2 "visibility conditional"); kept as-is and FLAGGED for PA.

### D12 SPEC self-contradictions (dpa-070) — disposition
- §42.2.2a vs §42.3.5 — touched (via `is given`), resolved as item 5 above.
- §42.4 "`not` is falsy" — touched, rewritten (item 2).
- §4.11.4/§18.8.1/§53.15 vs §42.2.3 (`given` machine-only); E-SYNTAX-045 vs §66.7.5; §42.3.2 cites retired E-TYPE-042 — NOT touched by this ruling; left, listed as deferred.

### Code choice — REUSE `E-COND-NOT-BOOLEAN` (distinct message), no new code
The rule after S460 is ONE closed rule: "a condition's value SHALL be shown to be a `bool` or a `T | not` presence test". An unresolved type fails that rule for the same reason a known `int` does — the compiler cannot show the condition is one of the two admitted kinds — so the §34 meaning ("condition is not a boolean or a `T | not` presence test") fits without stretching; only the wording "provably" goes. A separate `E-COND-TYPE-UNKNOWN` would split one rule into two codes whose fixes overlap (`x is given` / `x == true`) and make tooling ask two questions for one; limit primitives (S174). The unknown case gets its own MESSAGE ("the compiler cannot resolve this value's type — annotate it, or say what you test: `x is given` / `x == true`"), so the author can still tell the two cases apart.

## Phase 1 — SPEC (2026-10-08, af9b46fed)
§42.4 rewritten as the one condition rule (9 statements + example); §42.1 / §42.2.2a / §42.2.4 / §42.3.5 item 2 / §42.6 / §42.7 / §42.10; §17.1 (declared + ruled example); §49.2.3 + §49.3 wording; §50.10.4 note; §15 E-TYPE-073 wording; §34 row E-COND-NOT-BOOLEAN (new; Nominal on impl#1, emitter = bootstrap); §66.20 row updated. SPEC-INDEX / FACTS / severity.scrml regenerated by script.

## Phase 3 — bootstrap (2026-10-08, 1943ae30e + 51c58f2b1)
checkCond `.Unknown` → condUnresolved (E-COND-NOT-BOOLEAN, distinct message) unless condBlamed (TEnv.blame: prior Error spans, refused param syms, refused-return fns; typer diags in span; unresolved names / operators / calls). Postfix `x is given` / `x is not` (UnOp.IsGiven / IsNot) parsed, typed bool, lowered IsSome/IsNot, narrowing like `!= not` / `== not`. Hints teach `x is given`. NARROWING comment fixed (nested writes DO un-narrow — probed). Tests: slice-m2/typer-s460.test.js (30), typer-s440.test.js 3 updated. Suites: lint 0 · m1 99 · m2 492 · m3 60 · m4 1229 · codec 166 · lowered 99 · lexer 337, 0 fail.
The 2nd commit came from the Phase-4 self-count: 7 conformance + 2 samples sites were cascades inside binder-refused regions (`@n > 0` with no op fact; calls to unbound callees) — now blamed.

## Phase 2 — conformance (2026-10-08)
17 cases `conformance/cases/condition/` (6 pos, 11 neg). 12 carry `xfail.impl1-ts` (gap g-impl1-condition-rule-s460, new, status=carried, signatures by `--xfail-signature`). impl#1: 1424 pass + 62 xfail / 1486, 0 FAIL. Bootstrap: 14 PASS (incl. runtime half for the markup presence case), 3 UNSUPPORTED (2 `while` — no while stmt; unannotated param refused).

## Phase 4 — measure
Self-count (bootstrap front end over every .scrml, single-file): compiler/self-host-v2 65 files → 0 new; conformance 1506 → 0; examples 71 → 0; samples 880 → 10; stdlib 53 → 7 (all in files the bootstrap already rejects with parse/unsupported errors; impl#1-dialect). Of the 17: unresolved because the bootstrap lacks a builtin method catalog (`seg.endsWith("?")`, `path.slice`) or the fn has no return type / param unannotated.
impl#1 byte-identity: compiler/src untouched; corpus-emit-differential capture base (origin/main 879b56893 via git archive) vs head (HEAD via git archive, same-length path) over examples+samples+conformance+stdlib: 2510 sources, 7294 artifacts, compile set identical, diagnostics identical (0 code / 0 text changes); 162 artifacts differ ONLY in `_scrml_project_root = "<capture root>"`; 0 residual after normalising that path.
- Gates (2026-10-08): pre-commit core green on every commit (33586 tests, 0 fail at af9b46fed; hook passed on 1943ae30e, 51c58f2b1, 5591c7d22); `bun conformance/run.ts` 1424 pass + 62 xfail / 1486, 0 FAIL; bootstrap CI suites all green; `bootstrap-conformance.ts --write` → PASS 135 / FAIL 56 / UNSUPPORTED 769 (only the 17 new cases moved); types:check OK (186 unchanged); host-global-scan --check 0 violations after pinning the 2 §66-dialect esm throws (same precedent as forms/ and control-flow/ §66 cases); severity / SPEC-INDEX / FACTS / s34 --check-new current.
