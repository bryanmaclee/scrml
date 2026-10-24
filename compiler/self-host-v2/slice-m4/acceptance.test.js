// acceptance.test.js — s469: the bootstrap's human-written ACCEPTANCE cases
// (compiler/self-host-v2/acceptance/**), graded by the bootstrap conformance
// probe itself (`scripts/bootstrap-conformance.ts --cases <dir>`), in the
// conformance-case layout (case.scrml + expected.json). Each expected.json is the
// TARGET behaviour; STATUS below pins today's verdict, so a lane that moves one
// (a blocker landing, or a regression) shows up here as a diff to update.
//
// These are not language-corpus cases (conformance/cases/**): dpa-073 F2 is not
// in the SPEC yet (§18.2 still forbids arm commas) and impl#1 does not read arm
// commas (dpa-073 F5 step 1 is owed), so a corpus case would have no carried gap
// to xfail impl#1 against. They move into the corpus when the SPEC lands F2.

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const CASES = join(REPO, "compiler", "self-host-v2", "acceptance");

// relDir → [bucket, the exact distinct codes emitted]
const STATUS = {
  "arms/comma-guard": ["PASS", []],
  "arms/comma-match": ["PASS", []],
  "arms/mixed-neg": ["PASS", ["E-MATCH-ARM-SEPARATOR"]],
  "arms/neg-newline-list": ["PASS", ["E-MATCH-ARM-SEPARATOR"]],
  // s469-boot-ruled-backlog — §18.5 block arms yield with `lift` (S469); the value-form `if` refused by name
  "arms/lift-guard-value": ["PASS", []],
  "arms/single-expr-block": ["PASS", []],
  "arms/neg-tail-guard": ["PASS", ["E-ARM-TAIL-VALUE"]],
  "arms/neg-tail-plain": ["PASS", ["E-ARM-TAIL-VALUE"]],
  // the ruled form, but a plain-value `match` arm with statements is beyond Core's one-expression arm
  "arms/lift-plain-multi-unsupported": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "arms/neg-lift-statement-arm": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "arms/neg-lift-nested": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "arms/neg-if-value": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "opener/union-maybe": ["PASS", []],
  // a general union needs a union type in the bootstrap's type system
  "opener/union-multi-unsupported": ["UNSUPPORTED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // program (a) (s469: blockers 4 and 5 landed — `toEnum` and the plain-value `match`):
  // compiles and runs. Its `not` arm shows a constant (see guess/a-guess-verbatim).
  "guess/a-guess": ["PASS", []],
  "guess/a-guess-no": ["PASS", []],
  "guess/a-guess-other": ["PASS", []],
  // the report's text verbatim: `"length " + @inputVal.length` is string + int, which the
  // S440 operator rule refuses — correctly; the explicit conversion it needs is the next wall
  "guess/a-guess-verbatim": ["PASS", ["E-OPERATOR-OPERAND-TYPE"]],
  // s469 — the §18 plain-value match unit, toEnum, §45 `==`, and the security lens
  "match/enum-value": ["PASS", []],
  "match/eq-maybe-struct": ["PASS", []],
  "match/literal": ["PASS", []],
  "match/literal-no-else": ["PASS", ["W-MATCH-002"]],
  "match/neg-duplicate-arm": ["PASS", ["E-TYPE-023"]],
  "match/neg-literal-over-enum": ["PASS", ["E-TYPE-028"]],
  "match/neg-maybe-no-not": ["PASS", ["E-MATCH-012"]],
  "match/neg-missing-variant": ["PASS", ["E-TYPE-020"]],
  "match/neg-shorthand-arm": ["PASS", ["E-MATCH-ARM-SHORTHAND-AMBIGUOUS"]],
  "match/neg-struct-subject": ["PASS", ["E-TYPE-024"]],
  "match/neg-tape-subject": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "match/not-arm": ["PASS", []],
  "match/payload-bind": ["PASS", []],
  "security/login-enum": ["PASS", []],
  "security/login-literal": ["PASS", []],
  "security/login-literal-no-else": ["PASS", ["W-MATCH-002"]],
  "security/login-maybe": ["PASS", []],
  // #1471 review HIGH-1: a `-> T | not` finder that falls off the end is refused; with `return not` the deny arm runs
  "security/falloff-value": ["PASS", ["E-TYPE-043"]],
  "security/falloff-stmt": ["PASS", ["E-TYPE-043"]],
  "security/falloff-string": ["PASS", ["E-TYPE-043"]],
  "security/falloff-enum": ["PASS", ["E-TYPE-043"]],
  "security/return-not-value": ["PASS", []],
  "security/return-not-stmt": ["PASS", []],
  "security/return-not-string": ["PASS", []],
  "security/return-not-enum": ["PASS", []],
  // #1471 delta review: the rest of the fall-off class, and `== not`
  "security/falloff-failable": ["PASS", ["E-RETURN-INCOMPLETE"]],
  "security/falloff-unannotated": ["PASS", ["E-RETURN-INCOMPLETE"]],
  // #1471 round 2 (bryan: "Always explicit"): bare returns, and no-value results read as values
  "security/bare-return-failable": ["PASS", ["E-RETURN-INCOMPLETE"]],
  "security/bare-return-maybe": ["PASS", ["E-TYPE-043"]],
  "security/novalue-guard": ["PASS", ["E-TYPE-001"]],
  "security/novalue-ok": ["PASS", ["E-TYPE-001"]],
  "security/novalue-plain": ["PASS", ["E-TYPE-001"]],
  // #1471 round 3: `void` is a type — a wrapper's `return <void call>`
  "security/wrap-failable": ["PASS", ["E-TYPE-001"]],
  "security/wrap-typed": ["PASS", ["E-TYPE-001"]],
  "security/wrap-unannotated": ["PASS", ["E-TYPE-001"]],
  "security/wrap-void": ["PASS", ["E-TYPE-001"]],
  "security/eq-not": ["PASS", ["E-EQ-002"]],
  "security/bare-return": ["PASS", ["E-TYPE-043"]],
  "security/failable-fails": ["PASS", []],
  "toenum/neg-arg-type": ["PASS", ["E-TYPE-031"]],
  "toenum/prototype-keys": ["PASS", []],
  // s469-boot-strings-1 — the typed string methods (positions are code points), bryan's guess made
  // case-insensitive (the `"typed " + …` half skipped: no int→string conversion is ruled)
  "strings/guess-ci-yes": ["PASS", []],
  "strings/guess-ci-upper": ["PASS", []],
  "strings/guess-ci-mixed-no": ["PASS", []],
  "strings/guess-ci-maybe": ["PASS", []],
  "strings/guess-ci-empty": ["PASS", []],
  "strings/methods": ["PASS", []],
  // s469-boot-ruled-backlog: an unknown string method is Appendix D.1's refusal (was E-BOOTSTRAP-UNSUPPORTED)
  "strings/neg-unknown-method": ["PASS", ["E-STRING-METHOD-UNKNOWN"]],
  "strings/neg-int-receiver": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "strings/neg-maybe-receiver": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "strings/neg-arg-type": ["PASS", ["E-TYPE-031"]],
  "strings/neg-arity": ["PASS", ["E-CALL-ARITY"]],
  // s469-boot-ruled-backlog — the admitted string methods (S469 "more string methods admitted"), `s[i]`
  "strings/admitted-methods": ["PASS", []],
  "strings/index-read": ["PASS", []],
  "strings/neg-indexof-plain-int": ["PASS", ["E-TYPE-031"]],
  "strings/neg-indexof-start": ["PASS", ["E-CALL-ARITY"]],
  "strings/neg-replace-nonstring": ["PASS", ["E-TYPE-031"]],
  "strings/neg-unknown-at": ["PASS", ["E-STRING-METHOD-UNKNOWN"]],
  // s469-boot-ruled-backlog — `T.parse(s)` (§14.13.4) and `integer` / `boolean` (§14.13.6)
  "parse/int-strict": ["PASS", []],
  "parse/number-finite": ["PASS", []],
  "parse/bool-exact": ["PASS", []],
  "parse/enum-parse": ["PASS", []],
  "parse/integer-type-name": ["PASS", []],
  "parse/neg-plain-cell": ["PASS", ["E-TYPE-031"]],
  "parse/neg-arg-type": ["PASS", ["E-TYPE-031"]],
  "parse/neg-namespace": ["PASS", ["E-SCOPE-001"]],
  "parse/neg-integer-parse": ["PASS", ["E-SCOPE-001"]],
  // s469-boot-ruled-backlog — no negative positions (S469 "no negative positions anywhere")
  "positions/neg-slice-literal": ["PASS", ["E-POSITION-NEGATIVE"]],
  "positions/neg-slice-end-literal": ["PASS", ["E-POSITION-NEGATIVE"]],
  "positions/neg-repeat-literal": ["PASS", ["E-POSITION-NEGATIVE"]],
  "positions/neg-pad-literal": ["PASS", ["E-POSITION-NEGATIVE"]],
  "positions/from-end-explicit": ["PASS", []],
  "positions/at-negative-not": ["PASS", []],
  "positions/neg-slice-computed-traps": ["PASS", []],
  // tape sort / reverse / join (new tapes), append / prepend, JavaScript's names refused
  "tapes/sort-reverse-join": ["PASS", []],
  "tapes/append-prepend": ["PASS", []],
  "tapes/neg-sort-bool": ["PASS", ["E-TYPE-031"]],
  "tapes/neg-join-int": ["PASS", ["E-TYPE-031"]],
  "tapes/neg-comparator-bool": ["PASS", ["E-TYPE-031"]],
  "tapes/neg-push": ["PASS", ["E-TAPE-JS-METHOD"]],
  "tapes/neg-unshift": ["PASS", ["E-TAPE-JS-METHOD"]],
  "tapes/neg-tosorted": ["PASS", ["E-TAPE-JS-METHOD"]],
  "tapes/neg-sort-discarded": ["PASS", ["E-TAPE-JS-METHOD"]],
  // s469-boot-tape-grants — every write to a tape-typed place is judged by the one grant reader
  // (§66.12.3, §66.12.6 rules 1 and 4); the forms it cannot judge statically are refused
  "grants/struct-spread-keeps-tape": ["PASS", []],
  "grants/struct-genuine-keep": ["PASS", []],
  "grants/struct-replace-granted": ["PASS", []],
  "grants/local-sort-write": ["PASS", []],
  "grants/local-replace-granted": ["PASS", []],
  "grants/callsite-superset": ["PASS", []],
  "grants/neg-struct-replace-tape": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-struct-opaque": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-nested-tape": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-spread-override-tape": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-field-ungranted-tape": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-let-field-tape": ["PASS", ["E-GRANT-LET-ON-SEQUENCE"]],
  "grants/neg-local-replace": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-local-sort": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-local-inferred": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "grants/neg-local-struct": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  // fail closed: a reset's effect on a tape field is known only at run time; the call-site code is unruled
  "grants/neg-reset-struct-tape": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "grants/neg-callsite-subset": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // review r2 H1: a `persist="local"` cross-tab value is a whole-struct write — refused over an append-only tape field
  "grants/neg-persist-local-struct-tape": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "grants/persist-session-struct-tape": ["PASS", []],
  // the W-STRING-INTERP-LITERAL lint (§34 row landed s469-spec-followup; name still provisional)
  "interp/logic-literal-warns": ["PASS", ["W-STRING-INTERP-LITERAL"]],
  "interp/attr-expression-warns": ["PASS", ["W-STRING-INTERP-LITERAL"]],
  "interp/markup-does-not-warn": ["PASS", []],
  "interp/quoted-attr-no-warn": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // s469 — the first loop slice (§49 "one `for`"): the four heads, labels, ranges, index reads, and the refusals
  "loop/cond-head": ["PASS", []],
  "loop/counted-continue": ["PASS", []],
  "loop/forever-break": ["PASS", []],
  "loop/index-at": ["PASS", []],
  "loop/labels": ["PASS", []],
  "loop/neg-break-label": ["PASS", ["E-LOOP-003"]],
  "loop/neg-break-outside": ["PASS", ["E-LOOP-001"]],
  "loop/neg-continue-label": ["PASS", ["E-LOOP-004"]],
  "loop/neg-continue-outside": ["PASS", ["E-LOOP-002"]],
  "loop/neg-do-while": ["PASS", ["E-LOOP-DO-WHILE-RETIRED"]],
  "loop/neg-dup-label": ["PASS", ["E-LOOP-006"]],
  "loop/neg-for-in-braceless": ["PASS", ["E-FOR-UNPARENTHESIZED-HEAD"]],
  "loop/neg-for-in-paren": ["PASS", ["E-CTRL-011"]],
  "loop/neg-grant-in-loop": ["PASS", ["E-WRITE-NOT-GRANTED"]],
  "loop/neg-range-bound": ["PASS", ["E-RANGE-BOUND-NOT-INT"]],
  "loop/neg-range-paren": ["PASS", ["E-RANGE-OUTSIDE-LOOP-HEAD"]],
  "loop/neg-range-value": ["PASS", ["E-RANGE-OUTSIDE-LOOP-HEAD"]],
  "loop/neg-while": ["PASS", ["E-LOOP-WHILE-RETIRED"]],
  "loop/range": ["PASS", []],
  "loop/sum-tape": ["PASS", []],
  // s469 — logic backtick templates (§14.13.3, blocker #5): each slot a text sink; the honest text (§20.7.2)
  "templates/int-text": ["PASS", []],
  "templates/number-text": ["PASS", []],
  "templates/bool-enum-text": ["PASS", []],
  "templates/nested": ["PASS", []],
  "templates/escapes": ["PASS", []],
  "templates/string-and-field": ["PASS", []],
  "templates/narrowed": ["PASS", []],
  "templates/neg-struct": ["PASS", ["E-TEXT-NON-PRIMITIVE"]],
  "templates/neg-tape": ["PASS", ["E-TEXT-NON-PRIMITIVE"]],
  "templates/neg-payload-enum": ["PASS", ["E-TEXT-NON-PRIMITIVE"]],
  "templates/neg-not": ["PASS", ["E-TEXT-NON-PRIMITIVE"]],
  "templates/neg-unresolved": ["PASS", ["E-TEXT-NON-PRIMITIVE"]],
  "templates/neg-not-narrowed": ["PASS", ["E-OPERAND-NOT-NARROWED"]],
  "templates/neg-plus-strict": ["PASS", ["E-OPERATOR-OPERAND-TYPE"]],
  "templates/neg-number-to-string-param": ["PASS", ["E-TYPE-031"]],
  "templates/neg-unreadable-slot": ["PASS", ["E-PARSE-TEMPLATE"]],
  "templates/neg-html-comment": ["PASS", ["E-PARSE-TEMPLATE"]],
  "templates/neg-bad-escape": ["PASS", ["E-PARSE-TEMPLATE"]],
  "templates/neg-empty-slot": ["PASS", ["E-PARSE-TEMPLATE"]],
  // a tagged template is not a text template, and not in the bootstrap — refused by name
  "templates/neg-tagged": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // s469-boot-css — `#{}` CSS (§9.1, §25.7, §65): placement, the root stamps, the bridge, and the refusals
  "css/global-rule": ["PASS", []],
  "css/component-scope": ["PASS", []],
  "css/flat-inline": ["PASS", []],
  "css/cell-bridge": ["PASS", []],
  "css/neg-missing-semicolon": ["PASS", ["E-CSS-SYNTAX"]],
  "css/neg-bad-selector": ["PASS", ["E-CSS-SYNTAX"]],
  "css/neg-style-breakout": ["PASS", ["E-CSS-SYNTAX"]],
  "css/neg-interp": ["PASS", ["E-CSS-SYNTAX"]],
  "css/neg-unknown-ref": ["PASS", ["E-THEME-TOKEN-UNKNOWN"]],
  // `@media` is ruled CSS (§65.2.2); the bootstrap's reader does not carry block at-rules yet
  "css/media-unsupported": ["UNSUPPORTED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // s469-boot-termination-rulings — §7.2.2 rules 4, 5, 9, 10 (S469 "statement termination follow-ups")
  "termination/guard-next-line": ["PASS", []],
  "termination/fail-next-line": ["PASS", []],
  "termination/defer-next-line": ["PASS", []],
  "termination/neg-no-effect-after-if": ["PASS", ["E-STMT-NO-EFFECT"]],
  "termination/neg-split-call": ["PASS", ["E-STMT-SPLIT-CONTINUATION"]],
  "termination/neg-bare-fail": ["PASS", ["E-PARSE-EXPECTED"]],
  "termination/neg-spaced-propagate": ["PASS", ["E-PARSE-EXPR"]],
};

let verdicts;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "s469-acceptance-"));
  try {
    const out = join(dir, "acceptance.json");
    const p = Bun.spawnSync(["bun", join(REPO, "scripts", "bootstrap-conformance.ts"), "--cases", CASES, "--json", out], { cwd: REPO });
    if (p.exitCode !== 0) throw new Error("bootstrap-conformance exited " + p.exitCode + "\n" + p.stderr.toString());
    const j = JSON.parse(readFileSync(out, "utf8"));
    verdicts = Object.fromEntries(j.verdicts.map((v) => [v.relDir, v]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 180000 });

describe("bootstrap acceptance cases — today's verdicts", () => {
  test("the case set is exactly the STATUS set", () => {
    expect(Object.keys(verdicts).sort()).toEqual(Object.keys(STATUS).sort());
  });
  for (const [rel, [bucket, emitted]] of Object.entries(STATUS)) {
    test(`${rel} — ${bucket}`, () => {
      const v = verdicts[rel];
      expect({ bucket: v.bucket, emitted: v.emitted }).toEqual({ bucket, emitted });
      if (bucket === "PASS" && v.reason.includes("runtime")) expect(v.runtimeExecuted).toBe(true);
    });
  }
  test("the runtime halves executed where the case has one", () => {
    for (const rel of ["arms/comma-guard", "arms/comma-match", "opener/union-maybe", "termination/guard-next-line", "termination/fail-next-line", "termination/defer-next-line"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
  test("program (a) compiles and RUNS on the bootstrap — the first human-written program to (s469)", () => {
    for (const rel of ["guess/a-guess", "guess/a-guess-no", "guess/a-guess-other"]) {
      expect([rel, verdicts[rel].bucket, verdicts[rel].emitted, verdicts[rel].runtimeExecuted]).toEqual([rel, "PASS", [], true]);
    }
  });
  test("s469 strings / tapes / interp: every positive case RAN on the bootstrap (output checked, not merely compiled)", () => {
    for (const rel of ["strings/guess-ci-yes", "strings/guess-ci-upper", "strings/guess-ci-mixed-no", "strings/guess-ci-maybe",
                       "strings/guess-ci-empty", "strings/methods", "tapes/sort-reverse-join", "tapes/append-prepend",
                       "interp/logic-literal-warns", "interp/attr-expression-warns", "interp/markup-does-not-warn"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
  test("s469-boot-tape-grants: every positive grant case RAN on the bootstrap (output checked)", () => {
    for (const rel of ["grants/struct-spread-keeps-tape", "grants/struct-genuine-keep", "grants/struct-replace-granted",
                       "grants/local-sort-write", "grants/local-replace-granted", "grants/callsite-superset",
                       "grants/persist-session-struct-tape"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
  test("s469-boot-css: every positive CSS case RAN on the bootstrap (the stamped root / inline style / bridged cell checked)", () => {
    for (const rel of ["css/global-rule", "css/component-scope", "css/flat-inline", "css/cell-bridge"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
  test("the security cases ran their runtime half (the deny arm was taken, not merely compiled)", () => {
    for (const rel of ["security/login-enum", "security/login-literal", "security/login-literal-no-else", "security/login-maybe", "toenum/prototype-keys",
                       "security/return-not-value", "security/return-not-stmt", "security/return-not-string", "security/return-not-enum",
                       "security/failable-fails",
                       "loop/sum-tape", "loop/range", "loop/cond-head", "loop/counted-continue", "loop/forever-break", "loop/labels", "loop/index-at"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
  test("s469-boot-ruled-backlog: every positive parse / string / position case RAN on the bootstrap (output checked)", () => {
    for (const rel of ["parse/int-strict", "parse/number-finite", "parse/bool-exact", "parse/enum-parse", "parse/integer-type-name",
                       "strings/admitted-methods", "strings/index-read", "arms/lift-guard-value", "arms/single-expr-block",
                       "positions/from-end-explicit", "positions/at-negative-not", "positions/neg-slice-computed-traps"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
});
