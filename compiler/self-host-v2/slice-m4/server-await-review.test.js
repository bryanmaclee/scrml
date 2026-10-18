// server-await-review.test.js — s468 bootstrap unit U1c, fix round 1: the S239
// reviewer's ~60 await probes (server-await-probes-review.js), run the way
// server-artifact.test.js runs the U1c set: compile with the bootstrap; a shape
// that compiles must pass checkCore and its server artifact is RUN against a
// SQLite holding bob's row, with the wrong and the right password.
//
// THE FLOOR (S467 §13 amendment item 4): no shape answers a wrong password
// WELCOME. Each shape's class is also PINNED (REVIEW_EXPECT) so a change in what
// the bootstrap refuses or accepts is a visible diff, not a silent drift:
//   PASS     wrong → REJECTED, right → WELCOME
//   DENY     wrong → REJECTED, right → not WELCOME (fail closed; a correctness gap)
//   REFUSED  the front end reports an Error (fail closed at compile time); the
//            codes are pinned too

import { describe, test, expect, beforeAll } from "bun:test";
import { mods, check, artifacts, realDb, serve, post, pathOf } from "./server-artifact-harness.js";
import { frontEnd } from "./harness.js";
import { program, RIGHT, WRONG } from "./server-await-probes.js";
import { REVIEW_SHAPES } from "./server-await-probes-review.js";

beforeAll(() => { mods(); }, { timeout: 120000 });

// [class, Error codes for REFUSED] — measured on this branch (s468 fix round 1).
const REVIEW_EXPECT = {
  "s1/pureFnWrap": ["REFUSED", ["E-FN-003"]],
  "s1/chain3": ["PASS"],
  "s1/mutual": ["PASS"],
  "s1/whileCond": ["REFUSED", ["E-PARSE-EXPECTED", "E-SCOPE-001", "E-TYPE-STRUCT-CONTEXT"]],
  "s1/forBody": ["REFUSED", ["E-PARSE-EXPECTED", "E-PARSE-EXPR", "E-PARSE-ITEM", "E-SCOPE-001", "E-TYPE-STRUCT-CONTEXT"]],
  "s1/elseIf": ["PASS"],
  // a scrml string literal is not interpolated in the bootstrap: `"${check(…)}"` is the text itself, so nothing waits
  "s1/template": ["DENY"],
  "s1/concat": ["REFUSED", ["E-OPERATOR-OPERAND-TYPE"]],
  // s469: literal arms (`true :>`, `"bob" :>`) parse now (§18.16) — E-PARSE-ARM gone; over a failable (a server call) a literal arm is E-TYPE-VARIANT, never a wildcard
  "s1/matchScrut": ["REFUSED", ["E-ERROR-013", "E-TYPE-VARIANT"]],
  "s1/matchArm": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/structField": ["PASS"],
  "s1/arrayLit": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/indexWrite": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/queryParam": ["PASS"],
  "s1/queryParamDup": ["PASS"],
  "s1/hostMethod": ["REFUSED", ["E-SCOPE-001"]],
  "s1/methodOnResult": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/defaultParam": ["REFUSED", ["E-BOOTSTRAP-REDECLARE", "E-BOOTSTRAP-UNSUPPORTED", "E-COND-NOT-BOOLEAN", "E-PARSE-EXPECTED", "E-PARSE-EXPR", "E-SCOPE-001", "E-TYPE-STRUCT-CONTEXT"]],
  "s1/fnArg": ["REFUSED", ["E-BOOTSTRAP-REDECLARE", "E-BOOTSTRAP-UNSUPPORTED", "E-PARSE-EXPECTED", "E-PARSE-EXPR", "E-PARSE-TYPE", "E-ROUTE-001", "E-SCOPE-001", "E-TYPE-STRUCT-CONTEXT"]],
  "s1/mapLambda": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/hostArgCall": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/orRight": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/deferBody": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s1/deferInWaiting": ["PASS"],
  "s1/failableBare": ["REFUSED", ["E-ERROR-002"]],
  "s1/failableUnhandledProp": ["REFUSED", ["E-ERROR-002"]],
  "s1/bareQueryNoHandler": ["REFUSED", ["E-ERROR-010"]],
  "s1/bareQueryNonFailable": ["REFUSED", ["E-ERROR-002"]],
  "s1/isGivenPos": ["PASS"],
  "s1/nestedFnDecl": ["REFUSED", ["E-PARSE-EXPECTED", "E-PARSE-EXPR", "E-SCOPE-001", "E-TYPE-STRUCT-CONTEXT"]],
  "s1/arithmetic": ["PASS"],
  "s1/unusedResult": ["PASS"],
  "s1/returnCheckDirect": ["PASS"],
  // s469: the §18 plain-value match — compiles, and RUNS on the server: wrong → REJECTED, right → WELCOME
  "s2/matchEnumScrut": ["PASS"],
  "s2/matchEnumArm": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/matchStmtArmCall": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/givenSubj": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/givenBodyWait": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/failPayload": ["PASS"],
  "s2/argOfHandled": ["PASS"],
  "s2/ternaryInArg": ["PASS"],
  "s2/negUnary": ["PASS"],
  "s2/serverWritesCell": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/twoRepServerFn": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED", "E-ERROR-002", "E-ERROR-013"]],
  "s2/routeCalledInPlace": ["REFUSED", ["E-ERROR-002", "E-ERROR-013"]],
  "s2/lambdaFilterHelper": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/lambdaQuery": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/ambientShared": ["PASS"],
  "s2/ambientWaitingRb": ["REFUSED", ["E-ERROR-002", "E-ERROR-013"]],
  "s2/andLeftWait": ["PASS"],
  "s2/orBothSides": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s2/nestedTernaryTest": ["PASS"],
  "s3/twoRepServerFn": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED", "E-ERROR-002", "E-ERROR-013"]],
  "s3/routeCalledInPlace": ["PASS"],
  "s3/routeCalledInPlaceNoQ": ["REFUSED", ["E-ERROR-002"]],
  "s3/ambientWaitingRb": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED", "E-ERROR-002"]],
  // fix round 1 F1: implicit §19.8.2 propagation of a `?{}` — was checkCore RED (C-S7), now clean
  "s4/implicitProp": ["PASS"],
  "s4/implicitPropChain": ["PASS"],
  "s4/implicitRunStmt": ["PASS"],
  "s4/matchFailable": ["REFUSED", ["E-COND-NOT-BOOLEAN"]],
  "s4/queryMatch": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // s469 #1471 review HIGH-1: a `-> T | not` function that falls off the end is refused;
  // with `return not` the `not` arm is taken (`== null`) — wrong → REJECTED
  "s5/fallOffValue": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s5/fallOffStmt": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s5/fallOffString": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s5/fallOffEnum": ["REFUSED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "s5/retValue": ["PASS"],
  "s5/retStmt": ["PASS"],
  "s5/retString": ["PASS"],
  "s5/retEnum": ["PASS"],
};

async function classify(s) {
  const src = s.src ?? program(s.body, s.top ?? "", s.markup ?? "");
  const fe = frontEnd(mods(), [{ path: "app.scrml", src }]);
  const errs = fe.diags.filter((d) => d.severity === "Error");
  if (errs.length > 0 || !fe.core) return { cls: "REFUSED", codes: [...new Set(errs.map((d) => d.code))].sort() };
  const findings = check(fe.core);
  if (findings.length > 0) return { cls: "CHECK-RED", findings };
  const { server } = artifacts(fe.core);
  if (server.refused.length > 0) return { cls: "PRINT-REFUSED", findings: server.refused };
  const sql = await realDb(["CREATE TABLE users (name TEXT, pw TEXT)"], { users: [{ name: "bob", pw: RIGHT }] });
  const { srv, routes } = await serve(fe.core, sql);
  const fn = s.route ?? "f";
  const wrong = await post(srv, pathOf(routes, fn), s.wargs ?? ["bob", WRONG]);
  const right = await post(srv, pathOf(routes, fn), s.rargs ?? ["bob", RIGHT]);
  if (/WELCOME/.test(wrong.text)) return { cls: "FAIL", wrong, right };
  if (wrong.json === "REJECTED" && right.json === "WELCOME") return { cls: "PASS" };
  return { cls: "DENY", wrong: [wrong.status, wrong.text], right: [right.status, right.text] };
}

describe("the reviewer's await probes (S239, s468 fix round 1) — no wrong password is WELCOMEd; every class pinned", () => {
  test("the pinned set is exactly the shape set", () => {
    expect(Object.keys(REVIEW_SHAPES).sort()).toEqual(Object.keys(REVIEW_EXPECT).sort());
  });
  for (const [name, s] of Object.entries(REVIEW_SHAPES)) {
    test(name, async () => {
      const got = await classify(s);
      expect(got.cls).not.toBe("FAIL");
      const [cls, codes] = REVIEW_EXPECT[name];
      if (cls === "REFUSED") {
        expect({ cls: got.cls, codes: got.codes }).toEqual({ cls, codes });
      } else {
        expect(got).toEqual(expect.objectContaining({ cls }));
      }
    }, 60000);
  }
});
