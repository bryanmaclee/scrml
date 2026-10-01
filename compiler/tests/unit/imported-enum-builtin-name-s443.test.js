/**
 * imported-enum-builtin-name-s443.test.js — a user enum (local OR imported)
 * whose name is also a built-in error type (§14.1.2: NetworkError,
 * ValidationError, SQLError, AuthError, TimeoutError, ParseError,
 * NotFoundError, ConflictError) is the type the file uses; the built-in
 * steps aside.
 *
 * Governing: §19.3.3 "An error enum imported from another scrml file
 * resolves exactly as a local one." · §21.3 "Type imports are first-class".
 * SPEC is silent on a user type shadowing a built-in type name; the local
 * path already let the declaration win in the type registry, and this pins
 * the imported path to the same rule.
 *
 * Before (regression from 3332713c5, S441 N2 narrowing):
 *   - the imported-types seeder only replaced absent/`unknown` registry
 *     entries, so the built-in `tError("AuthError")` SHADOWED the imported
 *     user enum → bare `fail .Missing` false-fired E-ERROR-009;
 *   - pre-existing sibling: qualified `fail AuthError.Nope` was never
 *     variant-checked (registry held the built-in) → silently accepted;
 *   - an imported `ParseError` (a built-in ENUM) was checked against the
 *     built-in's variants → E-ERROR-009 + E-TYPE-080;
 *   - a re-export through a file that declares a type of its own resolved
 *     to the BUILT-IN (the dep registry carried the seeded built-ins);
 *   - an annotation `e: AuthError` resolved to the built-in even for a
 *     LOCAL declaration, so `match e` was never exhaustiveness-checked.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/imported-enum-builtin-name-s443");
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

const CALLER = `        check("") !{
            | .Missing :> { return }
            | .Bad(reason) :> { return }
        }`;

function program(body, callerBody = CALLER) {
  return `<program>
\${
${body}
    function run() {
${callerBody}
    }
}
<button onclick=run()>go</button>
</program>
`;
}

function enumModule(name) {
  return `\${
    export type ${name}:enum = { Missing, Bad(reason: string) }
}
`;
}

const BUILTIN_ERROR_NAMES = [
  "AuthError", "ValidationError", "NetworkError", "TimeoutError",
  "NotFoundError", "ConflictError", "SQLError",
];

// ---------------------------------------------------------------------------
// §1 — every built-in name × {bare, qualified} × {valid, invalid}, imported
// ---------------------------------------------------------------------------

describe("§1 imported user enum named like a built-in error type", () => {
  for (const N of [...BUILTIN_ERROR_NAMES, "ParseError"]) {
    describe(N, () => {
      function importer(tag, stmt) {
        fix(`errs-${N}.scrml`, enumModule(N));
        return fix(`imp-${N}-${tag}.scrml`, program(`    import { ${N} } from "./errs-${N}.scrml"
    function check(n: string) ! ${N} {
        if (n == "") ${stmt}
    }`));
      }

      test("bare valid `fail .Missing` compiles and emits the user enum's variant", () => {
        const p = importer("bare-ok", "fail .Missing");
        const r = compile(p);
        expect(codes(r)).toEqual([]);
        expect(r.outputs.get(p)?.clientJs ?? "").toContain(`type: "${N}", variant: "Missing"`);
      });

      test("bare invalid `fail .Nope` is E-ERROR-009 listing the USER enum's variants", () => {
        const r = compile(importer("bare-bad", "fail .Nope"));
        expect(codes(r)).toEqual(["E-ERROR-009"]);
        expect(e9Messages(r)[0]).toContain("Valid variants: Missing, Bad.");
      });

      test("qualified valid `fail N.Missing` compiles", () => {
        expect(codes(compile(importer("qual-ok", `fail ${N}.Missing`)))).toEqual([]);
      });

      test("qualified invalid `fail N.Nope` is E-ERROR-009 (was silently accepted)", () => {
        const r = compile(importer("qual-bad", `fail ${N}.Nope`));
        expect(codes(r)).toEqual(["E-ERROR-009"]);
        expect(e9Messages(r)[0]).toContain("Valid variants: Missing, Bad.");
      });
    });
  }
});

// ---------------------------------------------------------------------------
// §2 — the local twin: a local declaration already won in the registry
// ---------------------------------------------------------------------------

describe("§2 locally declared enum named like a built-in", () => {
  test("bare valid compiles; qualified invalid is E-ERROR-009", () => {
    const ok = fix("local-ok.scrml", program(`    type AuthError:enum = { Missing, Bad(reason: string) }
    function check(n: string) ! AuthError {
        if (n == "") fail .Missing
    }`));
    expect(codes(compile(ok))).toEqual([]);

    const bad = fix("local-bad.scrml", program(`    type AuthError:enum = { Missing, Bad(reason: string) }
    function check(n: string) ! AuthError {
        if (n == "") fail AuthError.Nope
    }`));
    const r = compile(bad);
    expect(codes(r)).toEqual(["E-ERROR-009"]);
    expect(e9Messages(r)[0]).toContain("Valid variants: Missing, Bad.");
  });

  test("bare and qualified forms emit identical client JS", () => {
    const p = "local-identity.scrml";
    const bare = compile(fix(p, program(`    type AuthError:enum = { Missing, Bad(reason: string) }
    function check(n: string) ! AuthError {
        if (n == "") fail .Missing
    }`)));
    expect(codes(bare)).toEqual([]);
    const bareJs = bare.outputs.get(join(FIXTURE_DIR, p))?.clientJs ?? "";
    const qual = compile(fix(p, program(`    type AuthError:enum = { Missing, Bad(reason: string) }
    function check(n: string) ! AuthError {
        if (n == "") fail AuthError.Missing
    }`)));
    expect(bareJs).not.toBe("");
    expect(qual.outputs.get(join(FIXTURE_DIR, p))?.clientJs ?? "").toBe(bareJs);
  });
});

// ---------------------------------------------------------------------------
// §3 — aliased import and re-export
// ---------------------------------------------------------------------------

describe("§3 aliased import and re-export", () => {
  test("`import { AuthError as Mine }` resolves the user enum under the local name", () => {
    fix("errs-alias.scrml", enumModule("AuthError"));
    const ok = fix("alias-ok.scrml", program(`    import { AuthError as Mine } from "./errs-alias.scrml"
    function check(n: string) ! Mine {
        if (n == "") fail .Missing
    }`));
    expect(codes(compile(ok))).toEqual([]);
    const bad = fix("alias-bad.scrml", program(`    import { AuthError as Mine } from "./errs-alias.scrml"
    function check(n: string) ! Mine {
        if (n == "") fail Mine.Nope
    }`));
    expect(codes(compile(bad))).toEqual(["E-ERROR-009"]);
  });

  test("re-export through a pure forwarding file", () => {
    fix("errs-rx.scrml", enumModule("AuthError"));
    fix("idx-rx.scrml", `\${
    export { AuthError } from "./errs-rx.scrml"
}
`);
    const ok = fix("rx-ok.scrml", program(`    import { AuthError } from "./idx-rx.scrml"
    function check(n: string) ! AuthError {
        if (n == "") fail .Missing
    }`));
    expect(codes(compile(ok))).toEqual([]);
    const bad = fix("rx-bad.scrml", program(`    import { AuthError } from "./idx-rx.scrml"
    function check(n: string) ! AuthError {
        if (n == "") fail AuthError.Nope
    }`));
    expect(codes(compile(bad))).toEqual(["E-ERROR-009"]);
  });

  test("re-export through a file that ALSO declares its own type (dep registry carries no built-ins)", () => {
    fix("errs-rx2.scrml", enumModule("AuthError"));
    fix("idx-rx2.scrml", `\${
    export type Other:enum = { A }
    export { AuthError } from "./errs-rx2.scrml"
}
`);
    const ok = fix("rx2-ok.scrml", program(`    import { AuthError } from "./idx-rx2.scrml"
    function check(n: string) ! AuthError {
        if (n == "") fail .Missing
    }`));
    expect(codes(compile(ok))).toEqual([]);
    const bad = fix("rx2-bad.scrml", program(`    import { AuthError } from "./idx-rx2.scrml"
    function check(n: string) ! AuthError {
        if (n == "") fail AuthError.Nope
    }`));
    const r = compile(bad);
    expect(codes(r)).toEqual(["E-ERROR-009"]);
    expect(e9Messages(r)[0]).toContain("Valid variants: Missing, Bad.");
  });
});

// ---------------------------------------------------------------------------
// §4 — annotations resolve to the user's enum (match exhaustiveness)
// ---------------------------------------------------------------------------

describe("§4 a `: AuthError` annotation resolves to the user's enum", () => {
  function matchProgram(header, arms) {
    return `<program>
\${
${header}
    function describe(e: AuthError) -> string {
        return match e {
${arms}
        }
    }
}
<p>\${describe(AuthError.Missing)}</p>
</program>
`;
  }
  const FULL = `            .Missing :> "missing"
            .Bad(r) :> r`;
  const PARTIAL = `            .Missing :> "missing"`;

  test("imported: exhaustive match compiles; missing arm is E-TYPE-020", () => {
    fix("errs-m.scrml", enumModule("AuthError"));
    const imp = `    import { AuthError } from "./errs-m.scrml"`;
    expect(codes(compile(fix("m-imp-ok.scrml", matchProgram(imp, FULL))))).toEqual([]);
    expect(codes(compile(fix("m-imp-bad.scrml", matchProgram(imp, PARTIAL))))).toEqual(["E-TYPE-020"]);
  });

  test("local: exhaustive match compiles; missing arm is E-TYPE-020", () => {
    const local = `    type AuthError:enum = { Missing, Bad(reason: string) }`;
    expect(codes(compile(fix("m-loc-ok.scrml", matchProgram(local, FULL))))).toEqual([]);
    expect(codes(compile(fix("m-loc-bad.scrml", matchProgram(local, PARTIAL))))).toEqual(["E-TYPE-020"]);
  });
});

// ---------------------------------------------------------------------------
// §5 — no user declaration: the built-in still governs
// ---------------------------------------------------------------------------

describe("§5 without a user declaration the built-in is unchanged", () => {
  test("`! AuthError` (built-in, no variants) still rejects a bare variant", () => {
    const p = fix("builtin-only.scrml", program(`    function check(n: string) ! AuthError {
        if (n == "") fail .Missing
    }`, `        check("") !{
            | _ :> { return }
        }`));
    expect(codes(compile(p))).toContain("E-ERROR-009");
  });
});
