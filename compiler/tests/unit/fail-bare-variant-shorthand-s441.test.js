/**
 * fail-bare-variant-shorthand-s441.test.js — `fail .Variant` (the bare-variant
 * shorthand) resolves against the error type declared in the function's `!`
 * signature (SPEC §19.3.3 bare form; §14.10 bare-variant inference applied to
 * the `fail` target). Ruled S441 (bryan): "site yes; `fail .Variant` shorthand
 * yes". Closes g-fail-variant-shorthand-rejected-by-ts-context.
 *
 * Before: the E-ERROR-009 check (type-system.ts) read the parser's
 * `enumType === ""` for a bare `fail .V` as "not a variant" and fired — but
 * ONLY when the declared error enum resolved; an unresolved declared type
 * skipped the check, so an INVALID bare variant there was silently accepted.
 *
 * After:
 *   - a bare `.V` is resolved to the declared error type FIRST, then the
 *     §19.3.3 checks run on the resolved variant exactly as for `fail T.V`
 *     (invalid name → E-ERROR-009 with the Valid-variants list; valid name,
 *     wrong payload arity → E-TYPE-082; never both);
 *   - a bare-`!` function resolves against the built-in `Error` (`.Generic`);
 *   - the resolved enum name is written onto the node, so codegen is
 *     BYTE-IDENTICAL to the qualified form (asserted below);
 *   - a bare `fail .V` whose declared type is NOT a resolvable enum
 *     (undeclared / non-enum / non-canonical `enum E {…}`) fires E-ERROR-009
 *     instead of passing vacuously; an imported error enum still resolves.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/fail-bare-variant-s441");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

function codes(result) {
  return (result.errors ?? []).map((e) => e.code);
}

function e9Messages(result) {
  return (result.errors ?? []).filter((e) => e.code === "E-ERROR-009").map((e) => e.message);
}

/** Wrap a logic body in a minimal program with a caller so nothing is dead. */
function program(body, callerBody) {
  return `<program>
\${
${body}
    function run() {
${callerBody}
    }
}
<button onclick=run()>go</>
</program>
`;
}

const ENUM_E = "    type E:enum = { EmptyName, Bad(reason: string), Pair(a: number, b: number) }";

const CALL_CHECK = `        check("") !{
            | .EmptyName :> { return }
            | .Bad(reason) :> { return }
            | .Pair(a, b) :> { return }
        }`;

// ---------------------------------------------------------------------------
// §1 — valid bare variants compile clean
// ---------------------------------------------------------------------------

describe("§1 valid bare `fail .V` against a declared `type E:enum`", () => {
  test("nullary, single-payload and multi-payload bare variants compile with no errors", () => {
    const p = fix("valid.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") fail .EmptyName
        if (n == "x") fail .Bad("no x")
        if (n == "y") fail .Pair(1, 2)
    }`, CALL_CHECK));
    const r = compile(p);
    expect(codes(r)).toEqual([]);
    const js = r.outputs.get(p)?.clientJs ?? "";
    expect(js).toContain(`return { __scrml_error: true, type: "E", variant: "EmptyName", data: null };`);
    expect(js).toContain(`return { __scrml_error: true, type: "E", variant: "Bad", data: { reason: "no x" } };`);
    expect(js).toContain(`return { __scrml_error: true, type: "E", variant: "Pair", data: { a: 1, b: 2 } };`);
  });

  test("the `::` separator bare form (`fail ::EmptyName`) resolves the same way", () => {
    const p = fix("valid-colons.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") fail ::EmptyName
    }`, CALL_CHECK));
    const r = compile(p);
    expect(codes(r)).toEqual([]);
    expect(r.outputs.get(p)?.clientJs ?? "").toContain(`type: "E", variant: "EmptyName"`);
  });

  test("arrow-form `! -> E` declared type resolves the bare variant too", () => {
    const p = fix("valid-arrow.scrml", program(`${ENUM_E}
    function check(n: string) ! -> E {
        if (n == "") fail .EmptyName
    }`, CALL_CHECK));
    expect(codes(compile(p))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — codegen identity: bare form emits EXACTLY what the qualified form emits
// ---------------------------------------------------------------------------

describe("§2 codegen of `fail .V` is byte-identical to `fail E.V`", () => {
  function outputsFor(src) {
    // Same path for both compiles — the scope hash is path-derived.
    const p = fix("identity.scrml", src);
    const r = compile(p);
    expect(codes(r)).toEqual([]);
    const o = r.outputs.get(p) ?? {};
    return { clientJs: o.clientJs ?? "", serverJs: o.serverJs ?? "", html: o.html ?? "" };
  }

  const bareBody = `${ENUM_E}
    type Outer:enum = { Wrapped(reason: string), Other }
    function check(n: string) ! E {
        if (n == "") fail .EmptyName
        if (n == "x") fail .Bad("no x")
        if (n == "y") fail .Pair(1, 2)
        return n
    }
    server function persist(n: string) ! E {
        if (n == "") fail .Bad("server says no")
        return n
    }
    function outer(n: string) ! Outer {
        let v = check(n) !{
            | .EmptyName :> { fail .Other }
            | .Bad(reason) :> { fail .Wrapped(reason) }
            | .Pair(a, b) :> { fail .Other }
        }
        return v
    }`;
  const qualifiedBody = bareBody
    .replace(/fail \.(EmptyName|Bad|Pair)/g, "fail E.$1")
    .replace(/fail \.(Other|Wrapped)/g, "fail Outer.$1");

  const caller = `        outer("") !{
            | .Wrapped(reason) :> { return }
            | .Other :> { return }
        }
        persist("") !{
            | err :> { return }
        }`;

  test("client.js / server.js / html are identical across the two spellings", () => {
    expect(qualifiedBody).not.toBe(bareBody);
    expect(qualifiedBody).not.toMatch(/fail \./);
    const bare = outputsFor(program(bareBody, caller));
    const qualified = outputsFor(program(qualifiedBody, caller));
    expect(bare.clientJs.length).toBeGreaterThan(0);
    expect(bare.serverJs.length).toBeGreaterThan(0);
    expect(bare.clientJs).toBe(qualified.clientJs);
    expect(bare.serverJs).toBe(qualified.serverJs);
    expect(bare.html).toBe(qualified.html);
    // The `!{}` arm re-fail resolves against the ENCLOSING function's type.
    expect(bare.clientJs).toContain(`type: "Outer", variant: "Wrapped"`);
    expect(bare.serverJs).toContain(`type: "E", variant: "Bad"`);
  });
});

// ---------------------------------------------------------------------------
// §3 — §19.3.3 validity applies to the RESOLVED variant
// ---------------------------------------------------------------------------

describe("§3 invalid / wrong-arity bare variants", () => {
  test("an undeclared bare variant fires E-ERROR-009 with the Valid-variants list", () => {
    const p = fix("invalid.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") fail .Nonexistent
    }`, CALL_CHECK));
    const r = compile(p);
    expect(codes(r)).toEqual(["E-ERROR-009"]);
    const [msg] = e9Messages(r);
    expect(msg).toContain("'Nonexistent'");
    expect(msg).toContain("declared error type 'E'");
    expect(msg).toContain("Valid variants: EmptyName, Bad, Pair.");
  });

  test("the bare and qualified invalid forms fire the SAME diagnostic", () => {
    const bare = compile(fix("invalid-b.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") fail .Nonexistent("x")
    }`, CALL_CHECK)));
    const qual = compile(fix("invalid-q.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") fail E.Nonexistent("x")
    }`, CALL_CHECK)));
    expect(e9Messages(bare)).toEqual(e9Messages(qual));
    expect(e9Messages(bare).length).toBe(1);
  });

  test("a valid bare variant with the wrong payload arity fires E-TYPE-082, not E-ERROR-009", () => {
    const cases = [
      "fail .EmptyName(\"oops\")", // payload on a nullary variant
      "fail .Bad",                 // too few
      "fail .Pair(1)",             // too few (multi-field)
      "fail .Bad(\"a\", \"b\")",   // too many
    ];
    for (const stmt of cases) {
      const p = fix("arity.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") ${stmt}
    }`, CALL_CHECK));
      const c = codes(compile(p));
      expect({ stmt, c }).toEqual({ stmt, c: ["E-TYPE-082"] });
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — bare `!` resolves against the built-in `Error` (sole variant Generic)
// ---------------------------------------------------------------------------

describe("§4 bare-`!` function — built-in Error", () => {
  const caller = `        check("") !{
            | err :> { return }
        }`;

  test("`fail .Generic(\"m\")` resolves to Error.Generic and emits identically", () => {
    const p = fix("generic.scrml", program(`    function check(n: string) ! {
        if (n == "") fail .Generic("empty")
    }`, caller));
    const r = compile(p);
    expect(codes(r)).toEqual([]);
    const bareJs = r.outputs.get(p)?.clientJs ?? "";
    expect(bareJs).toContain(`return { __scrml_error: true, type: "Error", variant: "Generic", data: "empty" };`);
    const q = fix("generic.scrml", program(`    function check(n: string) ! {
        if (n == "") fail Error.Generic("empty")
    }`, caller));
    expect(compile(q).outputs.get(q)?.clientJs ?? "").toBe(bareJs);
  });

  test("a non-Generic bare variant fires E-ERROR-009 naming Error's valid variants", () => {
    const p = fix("generic-bad.scrml", program(`    function check(n: string) ! {
        if (n == "") fail .Oops("empty")
    }`, caller));
    const r = compile(p);
    expect(codes(r)).toEqual(["E-ERROR-009"]);
    expect(e9Messages(r)[0]).toContain("declared error type 'Error'");
    expect(e9Messages(r)[0]).toContain("Valid variants: Generic.");
  });
});

// ---------------------------------------------------------------------------
// §5 — the gate is no longer conditioned on the declared enum resolving
// ---------------------------------------------------------------------------

describe("§5 declared error type that is not a resolvable enum", () => {
  const caller = `        check("") !{
            | err :> { return }
        }`;

  test("non-canonical `enum E {…}` (never registers): an invalid bare variant is NOT silently accepted", () => {
    const p = fix("noncanonical.scrml", program(`    enum E { EmptyName, Bad }
    function check(n: string) ! E {
        if (n == "") fail .Nope
    }`, caller));
    const r = compile(p);
    expect(codes(r)).toContain("E-ERROR-009");
    expect(e9Messages(r)[0]).toContain("'fail .Nope'");
    expect(e9Messages(r)[0]).toContain("'E' is not a declared enum type");
  });

  test("an undeclared error type: bare `fail .X` fires E-ERROR-009", () => {
    const p = fix("undeclared.scrml", program(`    function check(n: string) ! Undeclared {
        if (n == "") fail .X
    }`, caller));
    expect(codes(compile(p))).toEqual(["E-ERROR-009"]);
  });

  test("a non-enum (struct) error type: bare `fail .X` fires E-ERROR-009", () => {
    const p = fix("struct.scrml", program(`    type S:struct = { a: string }
    function check(n: string) ! S {
        if (n == "") fail .X
    }`, caller));
    expect(codes(compile(p))).toEqual(["E-ERROR-009"]);
  });
});

// ---------------------------------------------------------------------------
// §6 — an IMPORTED error enum resolves (multi-file)
// ---------------------------------------------------------------------------

describe("§6 imported error enum", () => {
  test("valid bare variant of an imported enum compiles; invalid one fires E-ERROR-009", () => {
    fix("errs.scrml", `\${
    export type AppErr:enum = { Missing, Bad(reason: string) }
}
`);
    const caller = `        check("") !{
            | .Missing :> { return }
            | .Bad(reason) :> { return }
        }`;
    const ok = fix("imp-ok.scrml", program(`    import { AppErr } from "./errs.scrml"
    function check(n: string) ! AppErr {
        if (n == "") fail .Missing
        if (n == "x") fail .Bad("no")
    }`, caller));
    const rOk = compile(ok);
    expect(codes(rOk)).toEqual([]);
    expect(rOk.outputs.get(ok)?.clientJs ?? "").toContain(`type: "AppErr", variant: "Missing"`);

    const bad = fix("imp-bad.scrml", program(`    import { AppErr } from "./errs.scrml"
    function check(n: string) ! AppErr {
        if (n == "") fail .Nope
    }`, caller));
    const rBad = compile(bad);
    expect(codes(rBad)).toEqual(["E-ERROR-009"]);
    expect(e9Messages(rBad)[0]).toContain("Valid variants: Missing, Bad.");
  });
});

// ---------------------------------------------------------------------------
// §7 — `!{}` handler arm matching over a bare-failed variant
// ---------------------------------------------------------------------------

describe("§7 call-site `!{}` handler still matches bare-failed variants", () => {
  test("handler arms dispatch on the resolved variant name", () => {
    const p = fix("handler.scrml", program(`${ENUM_E}
    function check(n: string) ! E {
        if (n == "") fail .EmptyName
        if (n == "x") fail .Bad("no x")
    }`, CALL_CHECK));
    const r = compile(p);
    expect(codes(r)).toEqual([]);
    const js = r.outputs.get(p)?.clientJs ?? "";
    // The failing return and the handler's variant test agree on the name.
    expect(js).toContain(`variant: "EmptyName"`);
    expect(js).toMatch(/\.variant === "EmptyName"/);
    expect(js).toMatch(/\.variant === "Bad"/);
  });
});
