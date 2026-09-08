/**
 * §14.8.9 / E-PROTECT-005 — `findAuthoredResponseConstruction`, the acorn scan
 * behind the authored-`Response` gate.
 *
 * TWO PROPERTIES, and they fail in opposite directions:
 *
 *   1. RECOGNITION — the closed WHATWG `Response` construction surface fires,
 *      and inert text (string literal / comment / a same-named property) does
 *      not. A false fire here is a build-breaking error on valid code.
 *
 *   2. GRAMMAR COVERAGE OF THE PROBE WRAPPER — the scan parses a SLICE of
 *      already-lowered JS by wrapping it in a probe function. A slice the
 *      wrapper cannot parse is SILENTLY NOT SCANNED, because the fail direction
 *      on a parse error is "no fire". That is the quiet failure mode, and it
 *      already bit once: with a plain `async function` wrapper, every §37
 *      `server function*` body failed to parse on its `yield` and
 *      `yield new Response(...)` under `protect=` compiled clean. The wrapper is
 *      now `async function*`. These tests pin each construct the wrapper must
 *      admit, INDEPENDENTLY, so widening the emitted grammar without widening
 *      the wrapper fails here rather than going quiet in production.
 */
import { describe, test, expect } from "bun:test";
import { findAuthoredResponseConstruction, detectProtectedRawEgress } from "../../src/codegen/protect-egress.ts";

const spelling = (js, k = "statements") => findAuthoredResponseConstruction(js, k)?.spelling ?? null;
const kind = (js, k = "statements") => findAuthoredResponseConstruction(js, k)?.kind ?? null;

describe("§14.8.9 findAuthoredResponseConstruction — recognition", () => {
  test("the constructor, with a body", () => {
    expect(spelling("return new Response(JSON.stringify(u));")).toBe("new Response(...)");
    expect(kind("return new Response(JSON.stringify(u));")).toBe("body");
  });
});

// ---------------------------------------------------------------------------
// ⚑ THE BODY / NULL-BODY SPLIT — the S405 fix-round HIGH.
//
// The first landing gated the FULL WHATWG producer set, including
// `Response.redirect` and `Response.error`. Per the standard both have a NULL
// BODY, so `E-PROTECT-005`'s own rationale ("an opaque stream the floor cannot
// read") does not apply to them and its stated resolution ("return the VALUE —
// the compiler serializes and redacts it") cannot produce a 302 at all. Because
// the gate deliberately has no escape hatch, a `protect=` app could not issue a
// redirect from a server fn or an `<endpoint>` arm AT ALL — including one whose
// SELECT projected every protected column out.
//
// Three outcomes now, and each is asserted independently:
//   "body"             -> E-PROTECT-005 (error)
//   "null-body-static" -> W-PROTECT-005 (warning): compiles, but the RUNTIME
//                         guard still refuses it, because Bun gives redirect /
//                         error a 0-byte ReadableStream rather than a null body
//   null               -> silent: provably null-body AND runtime-recognizable
// ---------------------------------------------------------------------------
describe("§14.8.9 findAuthoredResponseConstruction — the body / null-body split", () => {
  test.each([
    ["Response.redirect", 'return Response.redirect("/x", 302);'],
    ["Response.error", "return Response.error();"],
  ])("%s is null-body-static — warned, never an error", (_label, js) => {
    expect(kind(js)).toBe("null-body-static");
  });

  test.each([
    ["new Response() with no arguments", "return new Response();"],
    ["new Response(null, {status})", "return new Response(null, { status: 204 });"],
    ["new Response(null, {status, headers}) — the redirect resolution", 'return new Response(null, { status: 302, headers: { Location: "/home" } });'],
  ])("%s is SILENT at both levels (runtime `.body === null` handles it exactly)", (_label, js) => {
    expect(findAuthoredResponseConstruction(js, "statements")).toBeNull();
  });

  test("a body-carrying construction OUTRANKS a null-body one in the same slice", () => {
    // Order-independent: the error verdict must win either way round.
    const a = 'if (x) { return Response.redirect("/x", 302); }\nreturn new Response(JSON.stringify(u));';
    const b = 'if (x) { return new Response(JSON.stringify(u)); }\nreturn Response.redirect("/x", 302);';
    expect(kind(a)).toBe("body");
    expect(kind(b)).toBe("body");
  });

  test("a non-literal first argument is NOT assumed null (that would be value analysis)", () => {
    expect(kind("return new Response(maybeNull, { status: 204 });")).toBe("body");
    expect(kind("return new Response(u ?? null);")).toBe("body");
  });
});

describe("§14.8.9 findAuthoredResponseConstruction — recognition (cont.)", () => {

  test("`Response.json` — the one BODY-CARRYING static producer", () => {
    expect(spelling("return Response.json({ a: 1 });")).toBe("Response.json(...)");
    expect(kind("return Response.json({ a: 1 });")).toBe("body");
  });

  test("the computed spelling of a body-carrying static producer", () => {
    expect(spelling('return Response["json"]({ a: 1 });')).toBe("Response.json(...)");
    expect(kind('return Response["json"]({ a: 1 });')).toBe("body");
  });

  test("nested inside an expression, not just at a return", () => {
    expect(spelling("const m = { r: new Response('x') }; return m;")).toBe("new Response(...)");
    expect(spelling("if (a) { for (const x of y) { throw new Response('x'); } }")).toBe("new Response(...)");
  });
});

describe("§14.8.9 findAuthoredResponseConstruction — no false fire", () => {
  test.each([
    ["a string literal", 'const s = "new Response(x)"; return s;'],
    ["a template literal", "const s = `Response.json(1)`; return s;"],
    ["a line comment", "// new Response(x)\nreturn 1;"],
    ["a block comment", "/* Response.json(1) */ return 1;"],
    ["a non-producer static", "return Response.toString();"],
    ["a same-named property on another object", "return lib.Response.json(1);"],
    ["a method named json on something else", "return Res.json(1);"],
    ["no mention at all", "return { a: 1 };"],
  ])("does not fire on %s", (_label, js) => {
    expect(spelling(js)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PROBE-WRAPPER GRAMMAR COVERAGE — split by SLICE KIND, because the wrapper is.
//
// ⚑ THE SAME ROOT CAUSE PRODUCED TWO SILENT HOLES ONE REVIEW ROUND APART, AND
// THAT IS WHY THIS SECTION IS SHAPED THE WAY IT IS.
//   round 1  wrapper was `async function` -> a §37 generator body's `yield` did
//            not parse -> null -> `yield new Response(...)` compiled clean.
//   round 2  the SAME wrapper framed an `<endpoint>` arm's EXPRESSION as a
//            STATEMENT, so a multi-key object literal — the canonical arm shape —
//            parsed as a labeled block and threw -> null. A single-key literal
//            happened to parse as a label and WAS scanned, so the hole looked
//            like coverage.
// Both were "widen the wrapper when a shape breaks", which has no done-condition.
// The scanner now takes the slice KIND from the caller and frames each category
// with the MAXIMAL context for it, so completeness is by construction rather than
// by enumeration. These tests pin BOTH frames independently.
// ---------------------------------------------------------------------------
describe("§14.8.9 probe-wrapper grammar coverage — \"statements\" slices", () => {
  // Each is a construct a real lowered server BODY contains at top level. If the
  // wrapper cannot parse it the scan returns null and the gate goes SILENT.
  test.each([
    ["a top-level `return`", "return new Response('x');"],
    ["a top-level `await`", "const u = await q(); return new Response(JSON.stringify(u));"],
    ["a top-level `yield` (§37 server function* body)", "const u = await q();\nyield new Response(JSON.stringify(u));"],
    ["`yield*` delegation", "yield* other();\nreturn new Response('x');"],
    ["a `for await` loop", "for await (const r of rows) { log(r); }\nreturn new Response('x');"],
    ["several statements with a nested function", "function h() { return 1; }\nreturn new Response(String(h()));"],
    ["a labelled statement (really a label, not an object)", "outer: for (;;) { break outer; }\nreturn new Response('x');"],
  ])("admits %s", (_label, js) => {
    expect(spelling(js, "statements")).not.toBeNull();
  });
});

describe("§14.8.9 probe-wrapper grammar coverage — \"expression\" slices (§61 arms)", () => {
  // ⚑ THE MULTI-KEY OBJECT LITERAL IS THE REGRESSION CASE. As a statement it is a
  // labeled block whose body is `true, r: …` — a SyntaxError. Parenthesized, it
  // is an object literal. Every entry here is a shape a real `<endpoint>` arm
  // lowers to.
  test.each([
    ["a multi-key object literal (THE canonical arm shape)", "{ ok: true, r: Response.json({a:1}) }", "body"],
    ["a multi-key literal with a constructor", '{ ok: true, r: new Response("s3cret") }', "body"],
    ["a SINGLE-key literal (used to pass by accident, as a label)", '{ r: new Response("s3cret") }', "body"],
    ["a DEEPLY nested literal", '{ a: 1, b: [new Response("x")], c: { d: 2 } }', "body"],
    ["a null-body static inside a multi-key literal", '{ ok: true, r: Response.redirect("/x", 302) }', "null-body-static"],
    ["a bare constructor expression", "new Response('x')", "body"],
    ["an awaited call wrapping one", "await wrap(new Response('x'))", "body"],
    ["a ternary", "cond ? new Response('x') : null", "body"],
  ])("admits %s", (_label, js, want) => {
    expect(kind(js, "expression")).toBe(want);
  });

  test("a clean multi-key arm is still silent (no false fire from the new frame)", () => {
    // The SPEC §61 worked-example shape. If parenthesizing had made everything
    // parse as *something*, this would start firing — so it is asserted too.
    expect(kind('{ jsonrpc: "2.0", result: { active: 3, idle: 1 } }', "expression")).toBeNull();
    expect(kind("await loadUser(id)", "expression")).toBeNull();
  });

  test("the two frames are NOT interchangeable — this is what the kind parameter buys", () => {
    // Documents the actual failure: the same slice, framed wrongly, is unscanned.
    const arm = '{ ok: true, r: new Response("s3cret") }';
    expect(kind(arm, "expression")).toBe("body");
    expect(kind(arm, "statements")).toBeNull(); // <- the round-2 defect, pinned
  });
});

describe("§14.8.9 probe-wrapper grammar coverage — shared", () => {

  test("an UNPARSEABLE slice returns null — fail-open FOR THE WARNING ONLY", () => {
    // Documented and deliberate: the compiler's own emitted slice is valid JS by
    // construction, so an unparseable one is a compiler defect, and breaking the
    // build with a CONFIDENTIALITY error on it would trade a real false-positive
    // class for no security. The security property does not rest here — the
    // runtime refusal in `_scrml_protect_redact` still holds. If that runtime
    // limb is ever removed, THIS decision must be revisited.
    expect(spelling("return new Response( ;;;")).toBeNull();
  });

  test("an empty / Response-free slice short-circuits before acorn", () => {
    expect(spelling("")).toBeNull();
    expect(spelling("return 1;")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §14.8.9 / E-PROTECT-004 — `detectProtectedRawEgress` after the S405 narrowing.
//
// Unit-level twin of the compile-level cases in
// `compiler/tests/integration/g-sql-row-protect-leak.test.js`. Two axes:
//   (a) the reveal suppression is COLUMN-keyed, not existence-keyed;
//   (b) the `_{}` predicate covers SPEC §23.2's FULL opener family (`_` + zero
//       or more `=` + `{`), not just the level-0 spelling §23.2 discourages.
// ---------------------------------------------------------------------------
describe("§14.8.9 detectProtectedRawEgress — reveal is column-keyed", () => {
  const ctx = {
    protectedByTable: new Map([["users", new Set(["passwordHash"])]]),
    schemaByTable: new Map([["users", ["id", "name", "email", "passwordHash"]]]),
  };
  const body = (tail) =>
    "let u = ?{`SELECT * FROM users WHERE id = ${id}`}.get()\n" + tail;

  test("no reveal at all -> fires", () => {
    expect(detectProtectedRawEgress(body("let p = _={ f(u) }="), ctx)).not.toBeNull();
  });

  test("reveal naming EVERY protected column -> discharged", () => {
    expect(detectProtectedRawEgress(body('let p = _={ f(u.reveal("passwordHash")) }='), ctx)).toBeNull();
  });

  test("reveal naming a DIFFERENT column -> still fires (the A4 defect)", () => {
    expect(detectProtectedRawEgress(body('let p = _={ f(u.reveal("email")) }='), ctx)).not.toBeNull();
  });

  test("a non-literal reveal names no column -> still fires (fail-closed)", () => {
    expect(detectProtectedRawEgress(body("let p = _={ f(u.reveal(col)) }="), ctx)).not.toBeNull();
  });

  test("a strip-all (unresolvable) query can never be discharged by named reveals", () => {
    // A CTE degrades to `{ all: true }` — the protected column set is unknown,
    // so no finite list of names covers it.
    const src =
      "let u = ?{`WITH t AS (SELECT * FROM users) SELECT * FROM t`}.all()\n" +
      'let p = _={ f(u.reveal("passwordHash")) }=';
    expect(detectProtectedRawEgress(src, ctx)).not.toBeNull();
  });
});

describe("§14.8.9 detectProtectedRawEgress — the §23.2 foreign-opener family", () => {
  const ctx = {
    protectedByTable: new Map([["users", new Set(["passwordHash"])]]),
    schemaByTable: new Map([["users", ["id", "name", "passwordHash"]]]),
  };
  const q = "let u = ?{`SELECT * FROM users WHERE id = ${id}`}.get()\n";

  // SPEC §23.2: "`_` followed by ZERO OR MORE `=` followed by `{`". The
  // predicate matched level 0 ONLY until S405 — which is the level
  // W-FOREIGN-001 tells authors NOT to use — so it recognized exactly the
  // spelling the compiler discourages and missed every recommended one.
  test.each([
    ["level 0 `_{`", "let p = _{ f(u) }"],
    ["level 1 `_={`  (the §23.2 RECOMMENDED default)", "let p = _={ f(u) }="],
    ["level 2 `_=={`", "let p = _=={ f(u) }=="],
    ["level 3 `_==={`", "let p = _==={ f(u) }==="],
  ])("fires on %s", (_label, tail) => {
    const hit = detectProtectedRawEgress(q + tail, ctx);
    expect(hit).not.toBeNull();
    expect(hit.egressKind).toContain("foreign-code block");
  });

  test("does NOT fire on an identifier that merely ends in `_` before a brace", () => {
    // The leading `[^A-Za-z0-9_$]` boundary is what keeps `foo_{` out.
    expect(detectProtectedRawEgress(q + "let p = foo_{ a: 1 }", ctx)).toBeNull();
  });

  test("an `asIs` value is still its own kind", () => {
    const hit = detectProtectedRawEgress(q + "let p = u asIs", ctx);
    expect(hit).not.toBeNull();
    expect(hit.egressKind).toContain("asIs");
  });

  test("NO raw egress at all -> null (the floor strips at the sink instead)", () => {
    expect(detectProtectedRawEgress(q + "return u", ctx)).toBeNull();
  });

  test("a manual `Response` is NO LONGER this gate's business (moved to E-PROTECT-005)", () => {
    expect(detectProtectedRawEgress(q + "return new Response(JSON.stringify(u))", ctx)).toBeNull();
  });
});
