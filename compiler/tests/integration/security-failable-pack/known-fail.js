// Shapes that LOG IN ON A WRONG PASSWORD on this branch today. Each entry names the open gap it is owed to.
//
// The pack is green with these failing and goes RED when:
//   - a shape NOT listed here logs in on a wrong password (a new hole), or
//   - a listed shape stops doing so (it was fixed: delete its entry; if the gap has no listed
//     shapes left, the gap's own status is the PA's to change).
//
// Refresh with `bun compiler/tests/integration/security-failable-pack/classify.js` — never by
// hand-editing to make the suite pass.
//
// Measured S468 fix round 1 (branch s468-failable-alias-and-match): 24 shapes. For comparison, the
// same 188 shapes on base 5c43c3b8e: 63 FAIL; on the frozen review head 7ecae57eb: 47 FAIL.

// A failable function reaches a call through a value flow the "may be a failable function" judgement
// does not model (passed as an argument, a callback, a curried / identity-wrapped return, a parameter
// default, a destructuring default, a closure write, a write after use in a loop). The root refusal
// (a failable function SHALL NOT be read as a value outside callee position) is OWED A RULING: no SPEC
// sentence makes the read illegal (§14.3 explicitly lets a function flow PASSED), see the gap entry.
const VALUE = "g-failable-function-used-as-value-unchecked-s468";
// `match check(p)` (direct) in an event-handler ATTRIBUTE: the stamp that makes the lowering
// discriminate the error is not consumed there; the error object is compared as a plain value.
const HANDLER = "g-match-failable-subject-in-handler-attribute-not-discriminated-s468";
// Statement-position `match check(p)` (direct) in a SERVER function: the subject is not awaited, so a
// Promise is classified `.Ok`.
const SERVER_STMT = "g-server-statement-match-failable-subject-unawaited-s468";

export const KNOWN_FAIL = {
  "n1/alias in loop (pre)": VALUE,
  "n1/alias via closure write": VALUE,
  "n1/alias param default": VALUE,
  "n1/alias apply (pre)": VALUE,
  "n1/alias apply lambda": VALUE,
  "n1/alias map callback": VALUE,
  "n1/alias filter callback": VALUE,
  "n1/alias some callback": VALUE,
  "n1/ret lambda curried": VALUE,
  "n1/ret fn curried": VALUE,
  "n1/ret via param identity": VALUE,
  "n1/ret via param identity alias": VALUE,
  "n1/ret iife block": VALUE,
  "n1/ret through apply": VALUE,
  "n2/expr curried": VALUE,
  "n2/expr id(check)": VALUE,
  "n2/expr apply": VALUE,
  "n7/ret iife fn-expr": VALUE,
  "n7/closure reassign": VALUE,
  "n7/alias destructure default": VALUE,
  "n7/alias param default lambda": VALUE,
  "n3/handler direct": HANDLER,
  "s2/stmt direct": SERVER_STMT,
  "s2/stmt direct paren": SERVER_STMT,
};

// Shapes this instrument CANNOT judge: client pages with no #wrong button (a client function calling
// a SERVER `check`; the decision needs the server half run). Listed so the hole is named.
export const UNJUDGED = {
  "n6/cli->srv expr direct": "no #wrong button: client -> server call, needs the server half",
  "n6/cli->srv stmt direct": "no #wrong button: client -> server call, needs the server half",
};

// Shapes whose OWN logic logs in on the wrong password (the reviewer wrote them to probe acceptance,
// not the floor): `p != "" || check(p)` is truthy before `check` runs; `!(match …)` inverts; an
// `.Ok(v)` arm on `p == "wrong" || …` binds `true`. Today each is refused (E-ERROR-002); a compiler that
// correctly ACCEPTS one would show it LOGGED IN, which is right, so the floor is not asserted for them.
export const BY_DESIGN_LOGS_IN = {
  "n2/expr || truthy left": "`p != \"\" || check(p)` is true for any non-empty password",
  "n2/expr ! not": "`!(match …)` inverts the verdict",
  "n2/expr Ok binds left value": "`.Ok(v)` on `p == \"wrong\" || check(p)` binds `true` for \"wrong\"",
};
