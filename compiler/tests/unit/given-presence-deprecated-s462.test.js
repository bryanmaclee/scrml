// given-presence-deprecated-s462.test.js — change-id s462-given-presence-deprecate.
//
// Ruling: user-voice-scrml.md S462 "a, go" — the in-place presence guard `given x :> { … }`
// (incl. `given x, y :>`, the markup-context form, and the `given x :>` match arm) is
// SOFT-DEPRECATED through the §63 lifecycle. NOT removed. The rebind head `given c = @h :>`
// (§66.7.5) is not affected.
//
//   §A — the lint: W-GIVEN-PRESENCE-DEPRECATED (warning) fires once at every in-place site, in
//        every position impl#1 parses one; never at a rebind head, an engine transition guard
//        `given (cond)`, or `given` used as an identifier. Partition: result.warnings (S93).
//   §B — inert: a file's emitted artifacts are what they were (the lint is a diagnostic only) —
//        pinned here as "the guard still lowers to the same absence check".
//   §C — the `scrml fix` rule `given-presence` (commands/fix-given-presence.js): the rewrite,
//        its verification, its refusals, idempotence, and its place in the default rule chain.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { fixGivenPresence, GIVEN_PRESENCE_RULE, normalizePresenceParens } from "../../src/commands/fix-given-presence.js";
import { fixS66, IMPL1_SAFE_RULES, S66_RULES } from "../../src/commands/fix-s66.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "given-presence-s462-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(rel, source) {
  const abs = join(TMP, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist-" + rel.replace(/\W/g, "_")), write: false, log: () => {} });
}
const allDiags = (r) => [...(r.errors || []), ...(r.warnings || []), ...(r.lintDiagnostics || [])];
const diagsOf = (r, code) => allDiags(r).filter((d) => d && d.code === code);
const clientJs = (r) => {
  for (const [, v] of r.outputs ?? new Map()) if (typeof v?.clientJs === "string") return v.clientJs;
  return "";
};

const LINT = "W-GIVEN-PRESENCE-DEPRECATED";

// ---------------------------------------------------------------------------
// §A — the lint
// ---------------------------------------------------------------------------

const LOGIC = (body) => `\${
    let x: string | not = "a"
    let y: number | not = 2
${body}
}
<program>
    <p>ok</>
</>
`;

describe("§A: W-GIVEN-PRESENCE-DEPRECATED fires at every in-place site", () => {
  test("a single-name guard fires once, severity warning, naming the `is given` rewrite", () => {
    const r = compile("a/single.scrml", LOGIC("    given x :> { let _a = x }"));
    const d = diagsOf(r, LINT);
    expect(d.length).toBe(1);
    expect(d[0].severity).toBe("warning");
    expect(d[0].message).toContain("if (x is given)");
    expect(d[0].message).toContain("scrml fix");
    expect(d[0].message).toContain("§42.2.3");
  });

  test("a multi-name guard fires once, naming the compound `x is given && y is given`", () => {
    const r = compile("a/multi.scrml", LOGIC("    given x, y :> { let _a = x }"));
    const d = diagsOf(r, LINT);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("if (x is given && y is given)");
  });

  test("the legacy `=>` separator fires the presence code alone (no W-GIVEN-ARROW-LEGACY)", () => {
    const r = compile("a/arrow.scrml", LOGIC("    given x => { let _a = x }"));
    expect(diagsOf(r, LINT).length).toBe(1);
    expect(diagsOf(r, "W-GIVEN-ARROW-LEGACY").length).toBe(0);
  });

  test("a guard in a function body, nested in an `if`, fires", () => {
    const r = compile("a/fn.scrml", LOGIC("    function f(v: string | not) {\n        if (v is given) {\n            given v :> { return 2 }\n        }\n        return 1\n    }\n    let _r = f(x)"));
    expect(diagsOf(r, LINT).length).toBe(1);
  });

  test("the `given x :>` match arm fires, naming `else :>`", () => {
    const r = compile("a/arm.scrml", LOGIC("    let out = match x {\n        not :> \"none\"\n        given x :> \"hi \" + x\n    }"));
    const d = diagsOf(r, LINT);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("else :>");
    expect(d[0].message).toContain("match arm");
  });

  test("the markup-context guard `${ given @c :> { <p>…</p> } }` fires, keeping the `@` in the message", () => {
    const src = `<label>: string | not = "x"
<main>
    \${ given @label :> { <p>\${@label}</p> } }
</main>
`;
    const r = compile("a/markup.scrml", src);
    const d = diagsOf(r, LINT);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("if (@label is given)");
  });

  test("the rebind head `given c = @h :>` (§66.7.5) does NOT fire it", () => {
    const src = `<user>: string | not = not
\${
    function g() { given c = @user :> { return c } }
}
<p>x</p>
`;
    const r = compile("a/rebind.scrml", src);
    expect(diagsOf(r, LINT).length).toBe(0);
    expect(diagsOf(r, "E-SYNTAX-045").length).toBe(1); // impl#1's standing reading of the rebind head
  });

  test("`given` as an identifier does NOT fire it", () => {
    const r = compile("a/ident.scrml", LOGIC("    let given = 1\n    let _g = given + 1"));
    expect(diagsOf(r, LINT).length).toBe(0);
  });

  test("an engine transition guard `given (cond)` (§4.11.4) does NOT fire it", () => {
    const src = readFileSync(join(import.meta.dir, "../../../conformance/cases/engine/type-level-transitions-guard-pos/case.scrml"), "utf8");
    expect(src).toContain("given (");
    const r = compile("a/engine-guard.scrml", src);
    expect(diagsOf(r, LINT).length).toBe(0);
  });

  test("a declaration ending in `is given` does NOT fire it (the cut-off `given` is not a guard)", () => {
    // impl#1 cuts `const ok: bool = a is given` at `given` and reads an EMPTY given-guard after it
    // (g-impl1-is-given-and-value-position-codegen-s460). That node is not a site.
    const src = `<program>
    function has(a: string | not) -> bool {
        const ok: bool = a is given
        return ok
    }
    <main><p>\${has("x")}</p></main>
</program>
`;
    const r = compile("a/value-is-given.scrml", src);
    expect(diagsOf(r, LINT).length).toBe(0);
    expect(fixGivenPresence(src, { filePath: join(TMP, "a/value-is-given-fix.scrml") }).blockers).toEqual([]);
  });

  test("partition: the code lands in result.warnings, never result.errors (S93)", () => {
    const r = compile("a/partition.scrml", LOGIC("    given x :> { let _a = x }"));
    expect((r.warnings || []).filter((d) => d.code === LINT).length).toBe(1);
    expect((r.errors || []).filter((d) => d.code === LINT).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B — inert: the guard still lowers to the same absence check
// ---------------------------------------------------------------------------

describe("§B: the deprecated form compiles as before", () => {
  test("`given x, y :> { … }` still lowers to one `if` over both absence checks", () => {
    const r = compile("b/lower.scrml", LOGIC("    given x, y :> { let _a = x }"));
    expect((r.errors || []).length).toBe(0);
    expect(clientJs(r)).toContain("if (x !== null && x !== undefined && y !== null && y !== undefined) {");
  });

  test("the deprecated guard and its `is given` rewrite emit the same JS once the parentheses are read alike", () => {
    const a = compile("b/old.scrml", LOGIC("    given x, y :> { let _a = x }"));
    const b = compile("b/old.scrml", LOGIC("    if (x is given && y is given) { let _a = x }"));
    expect(clientJs(a)).not.toBe("");
    expect(normalizePresenceParens(clientJs(a))).toBe(normalizePresenceParens(clientJs(b)));
  });
});

// ---------------------------------------------------------------------------
// §C — the `scrml fix` rule
// ---------------------------------------------------------------------------

describe("§C: scrml fix `given-presence`", () => {
  test("the rule is a default (impl#1-safe) rule of `scrml fix`", () => {
    expect(GIVEN_PRESENCE_RULE).toBe("given-presence");
    expect(IMPL1_SAFE_RULES).toContain("given-presence");
    expect(S66_RULES).toContain("given-presence");
  });

  test("rewrites a guard and a multi-name guard (verified by compile), keeping `@` and the body", () => {
    const src = LOGIC("    given x :> {\n        let _a = x\n    }\n    given x, y => { let _b = y }");
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/guards.scrml") });
    expect(r.blockers).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.output).toContain("    if (x is given) {\n        let _a = x\n    }");
    expect(r.output).toContain("    if (x is given && y is given) { let _b = y }");
    expect(r.output).not.toMatch(/\bgiven x\b/);
    expect(r.applied.length).toBe(2);
    expect(r.applied.every((a) => a.rule === "given-presence")).toBe(true);
  });

  test("the rewritten file compiles with the lint gone and no other code changed", () => {
    const src = LOGIC("    given x, y :> { let _a = x }");
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/clean.scrml") });
    const before = compile("c/clean-before.scrml", src);
    const after = compile("c/clean-after.scrml", r.output);
    expect(diagsOf(before, LINT).length).toBe(1);
    expect(diagsOf(after, LINT).length).toBe(0);
    const codes = (x) => allDiags(x).map((d) => d.code).filter((c) => c !== LINT).sort().join();
    expect(codes(after)).toBe(codes(before));
  });

  test("idempotent: a second run makes no edit", () => {
    const src = LOGIC("    given x :> { let _a = x }");
    const once = fixGivenPresence(src, { filePath: join(TMP, "c/idem.scrml") });
    const twice = fixGivenPresence(once.output, { filePath: join(TMP, "c/idem.scrml") });
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
    expect(twice.output).toBe(once.output);
  });

  test("never touches the rebind head, a comment, or `given` as an identifier", () => {
    const src = `<user>: string | not = not
\${
    // given x, y => { … } is how this used to read
    let given = 1
    function g() { given c = @user :> { return c } }
}
<p>x</p>
`;
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/untouched.scrml") });
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual([]);
  });

  test("the arm rewrite is `given x` → `else` (structure only, verify off)", () => {
    const src = LOGIC("    let out = match x {\n        not :> \"none\"\n        given x :> \"hi \" + x\n    }");
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/arm-structural.scrml"), verify: false });
    expect(r.changed).toBe(true);
    expect(r.output).toContain("        else :> \"hi \" + x\n");
  });

  test("an arm impl#1 miscompiles today is refused by the verify compile, naming the gap", () => {
    // impl#1 drops the body of a `given` match arm (g-impl1-given-match-arm-body-dropped-s462);
    // `else :>` runs it — the rewrite would change what runs, so it is left as written.
    const src = LOGIC("    let out = match x {\n        not :> \"none\"\n        given x :> \"hi \" + x\n    }");
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/arm-verify.scrml") });
    expect(r.changed).toBe(false);
    expect(r.blockers.length).toBe(1);
    expect(r.blockers[0].reason).toContain("g-impl1-given-match-arm-body-dropped-s462");
  });

  test("a `given @cell` guard impl#1 lowers to a bare name is refused; the file's other sites still rewrite", () => {
    const src = `<label>: string | not = "x"
\${
    let x: string | not = "a"
    given x :> { let _a = x }
    given @label :> { let _b = @label }
}
<p>ok</p>
`;
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/cell.scrml") });
    expect(r.changed).toBe(true);
    expect(r.output).toContain("if (x is given) { let _a = x }");
    expect(r.output).toContain("given @label :> { let _b = @label }");
    expect(r.blockers.length).toBe(1);
    expect(r.blockers[0].reason).toContain("g-top-level-given-emits-bare-name-s459");
  });

  test("refuses an arm that does not name the scrutinee, a match with no `not` arm, and a property path", () => {
    const binder = fixGivenPresence(LOGIC("    let out = match x {\n        not :> \"none\"\n        given n :> \"hi\"\n    }"), { filePath: join(TMP, "c/binder.scrml"), verify: false });
    expect(binder.changed).toBe(false);
    expect(binder.blockers[0].reason).toContain("does not name the match's scrutinee");

    const noNot = fixGivenPresence(LOGIC("    match x {\n        given x :> { let _a = 1 }\n    }"), { filePath: join(TMP, "c/nonot.scrml"), verify: false });
    expect(noNot.changed).toBe(false);
    expect(noNot.blockers[0].reason).toContain("no `not :>` arm");

    const path = fixGivenPresence(`\${
    type U:struct = { name: string | not }
    let u: U = { name: "a" }
    given u.name => { let _a = 1 }
}
<p>x</p>
`, { filePath: join(TMP, "c/path.scrml"), verify: false });
    expect(path.changed).toBe(false);
    expect(path.blockers[0].reason).toContain("E-SYNTAX-044");
  });

  test("refuses a head impl#1 mis-reads as a guard (`given id < 0 :> fail …`)", () => {
    const src = `\${
    type E:enum = { Bad }
    function f(id: int)! E {
        given id < 0 :> fail E.Bad
        return "ok"
    }
}
<p>x</p>
`;
    const r = fixGivenPresence(src, { filePath: join(TMP, "c/boolhead.scrml"), verify: false });
    expect(r.changed).toBe(false);
    expect(r.blockers.length).toBe(1);
    expect(r.blockers[0].reason).toContain("g-given-bool-expr-fail-runs-unconditionally-s460");
  });

  test("chained in fixS66 by default: `scrml fix` rewrites the guard", () => {
    const src = LOGIC("    given x :> { let _a = x }");
    const r = fixS66(src, { filePath: join(TMP, "c/chain.scrml"), rules: [...IMPL1_SAFE_RULES] });
    expect(r.output).toContain("if (x is given) { let _a = x }");
    expect(r.applied.some((a) => a.rule === "given-presence")).toBe(true);
  });
});
