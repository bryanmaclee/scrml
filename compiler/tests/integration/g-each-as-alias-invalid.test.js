/**
 * g-each-as-alias-invalid.test.js
 *
 * MERGE BLOCKER for `g-each-as-alias-invalid-on-lift-path` (round-3 finding 2)
 * and the PROVABLE subset of `g-each-as-alias-shadows-runtime-binding` (finding 3).
 *
 * THE REGRESSION THIS CLOSES. Before this branch the lift path never resolved the
 * `as` alias at all — it fell back to the synthetic `_scrml_each_item` — so
 * `<each … as data-id>` COMPILED CLEAN. Round 1 made the alias bind, which is
 * correct, and that turned the same source into a bare `E-CODEGEN-INVALID-LOGIC`
 * whose message names neither `as` nor the alias and tells the author "This is a
 * compiler defect … please report". It is not a compiler defect. It is
 * `as data-id`, and the compiler knew that and did not say it.
 *
 * SPEC §17.7.2: "The `as name` clause is OPTIONAL. When present, it binds the
 * current iteration value to the named IDENTIFIER in the body scope."
 * SPEC §17.7.3: "The bound `name` is a local identifier per §6.1."
 *
 * ⚑ CARRIER COVERAGE IS A LIST OF WHAT IS TESTED, NEVER OF WHAT EXISTS. Round 3
 * covered the four CHILD-position carriers and the in-file comments read as an
 * enumeration; round 4 found a FIFTH — the `<each>` as the ROOT of the lift
 * markup, where none of this validation ran at all and `as data-id` was silent.
 * §R below covers root position. Five carriers of one class have now been found
 * one at a time, each after a fix that shipped claiming closure.
 *
 * ⚑ WHAT THIS FILE DELIBERATELY DOES **NOT** ASSERT, so nobody reads it as a
 * closed class:
 *
 *   1. THE STRUCTURAL/BS PATH IS UNCHANGED AND STILL SILENTLY WRONG. The
 *      identical `as data-id` at TOP LEVEL compiles at exit 0 and emits
 *      `(data, _scrml_each_idx) => (data?.id …)` — the `-id` half vanishes and
 *      the row reads a binding the author never wrote. That read is in
 *      `ast-builder.js`, outside this dispatch's write-set. §S asserts the
 *      CURRENT (wrong) behaviour on purpose, so the day someone fixes it this
 *      test goes red and points at the fix rather than at a mystery.
 *   2. THE GENERAL GLOBAL-SHADOW RULE IS NOT IMPLEMENTED. Measured by executing
 *      the canonical row shape with fifteen alias names, only `as document` and
 *      `as String` break; `window` / `console` / `Math` / `Number` / `Array` /
 *      `Object` / `JSON` / `Boolean` / `Date` / `localStorage` / `fetch` /
 *      `undefined` all render correctly. The blast set is SHAPE-DEPENDENT, so a
 *      list-based reject would refuse working source. Only the UNCONDITIONAL
 *      subset is rejected here — `document` (every row factory opens with
 *      `document.createDocumentFragment()`) and the `_scrml_` namespace. §W
 *      asserts `as window` still COMPILES AND RENDERS, which is what stops a
 *      later author from "tidying" this into a globals list.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const D = "$";
const tmpRoot = resolve("/tmp", "scrml-each-as-alias-invalid");

/** A lift-parsed carrier (fn body) with the given alias. */
function liftSrc(alias) {
  return `<program>
<rows> = [{ id: 1 }, { id: 2 }]
fn listing() {
    return <ul>
        <each in=@rows as ${alias}>
            <li class="row">x</li>
        </each>
    </ul>
}
<div>${D}{listing()}</div>
</program>
`;
}

/**
 * ROOT-position carrier — the `<each>` IS the root of the lift markup, with no
 * parent element. Added round 4: until then NONE of the alias machinery ran here
 * (`tryEmitNestedLiftEach` is reached only from the child branch of
 * `emitCreateElementFromMarkup`), so `as data-id` at root compiled SILENTLY and
 * shipped a literal `<each>` DOM element with a free `it` in the body.
 */
function rootSrc(alias) {
  return `<program>
<rows> = [{ id: 1 }, { id: 2 }]
fn listing() {
    return <each in=@rows as ${alias}><li class="row">x</li></each>
}
<div>${D}{listing()}</div>
</program>
`;
}

/** A DANGLING `as` — the author typed `as` and then an attribute, not a name. */
const SRC_DANGLING_CHILD = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul><each in=@rows as key=it><li class="row">${D}{it}</li></each></ul>
}
<div>${D}{listing()}</div>
</program>
`;

const SRC_DANGLING_ROOT = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <each in=@rows as key=it><li class="row">${D}{it}</li></each>
}
<div>${D}{listing()}</div>
</program>
`;

/** A dangling `as` at the very END of the opener — no following token at all. */
const SRC_DANGLING_TRAILING = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul><each in=@rows as><li class="row">x</li></each></ul>
}
<div>${D}{listing()}</div>
</program>
`;

/** CONTROL — no `as` clause at all. Must stay clean; `@.` carries the item. */
const SRC_NO_AS = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul><each in=@rows key=@.><li class="row">${D}{@.}</li></each></ul>
}
<div>${D}{listing()}</div>
</program>
`;

/** The BS-structural carrier — same source, top level. */
function structuralSrc(alias) {
  return `<program>
<rows> = [{ id: 1 }, { id: 2 }]
<ul>
    <each in=@rows as ${alias}>
        <li class="row">x</li>
    </each>
</ul>
</program>
`;
}

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: (result.errors ?? []).filter((e) => String(e.severity ?? "error") === "error"),
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-each-as-alias-invalid — a lift-parsed `as` alias must be a usable identifier", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    let thrown = null;
    try {
      const exec = new Function("window", "document", `${runtimeJs}\n${clientJs}\n`);
      exec(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      thrown = e;
    }
    return {
      errors,
      clientJs,
      thrown,
      rows: () => document.querySelectorAll("li.row").length,
    };
  }

  // -----------------------------------------------------------------------
  // §A — the named diagnostic fires, and it NAMES `as` and the alias
  // -----------------------------------------------------------------------

  test("(A1) `as data-id` on the lift path: E-EACH-AS-ALIAS-INVALID, naming `as` and `data-id`", () => {
    const { errors } = compileToOutputs(liftSrc("data-id"), "aliasdash");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    const msg = String(errors[0].message);
    // THE POINT OF THE FIX. The old E-CODEGEN-INVALID-LOGIC said neither of these.
    expect(msg).toContain("as data-id");
    expect(msg).toContain("data-id");
    expect(msg).toContain("not a valid identifier");
    // …and it must NOT keep telling the author this is a compiler bug.
    expect(msg).not.toContain("compiler defect");
  });

  test("(A2) `as class` (a reserved word) is named as such, not as a codegen failure", () => {
    const { errors } = compileToOutputs(liftSrc("class"), "aliasreserved");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    expect(String(errors[0].message)).toContain("reserved word");
  });

  test("(A3) `as document` shadows an ALWAYS-emitted binding and is refused", () => {
    // Pre-fix: exit 0, then `TypeError: document.createDocumentFragment is not a
    // function` at bundle eval — the WHOLE page dead, with zero diagnostics.
    const { errors } = compileToOutputs(liftSrc("document"), "aliasdoc");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    expect(String(errors[0].message)).toContain("shadows a binding");
  });

  test("(A4) a `_scrml_`-prefixed alias is refused — that namespace is compiler-owned", () => {
    const { errors } = compileToOutputs(liftSrc("_scrml_each_idx"), "aliasns");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
  });

  test("(A5) the diagnostic fires ONCE even though the node is normalised twice", () => {
    // The ternary markup-value carrier routes the same node through
    // `eachBlockFromMarkupNode` twice; without the per-node dedupe the author
    // would read the same error twice.
    const src = `<program>
<rows> = [{ id: 1 }]
<flag> = true
<main>${D}{ @flag ? <ul><each in=@rows as data-id><li class="row">x</li></each></ul> : "" }</main>
</program>
`;
    const { errors } = compileToOutputs(src, "aliasdedupe");
    expect(errors.filter((e) => e.code === "E-EACH-AS-ALIAS-INVALID").length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // §B — a VALID alias is untouched (the fix is a reject, not a narrowing)
  // -----------------------------------------------------------------------

  for (const alias of ["row", "it", "conflict", "day", "$item", "_row", "item2"]) {
    test(`(B) \`as ${alias}\` still compiles clean and binds`, () => {
      const app = mount(liftSrc(alias), "aliasok");
      expect(app.errors).toEqual([]);
      expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
      expect(app.rows()).toBe(2);
    });
  }

  // -----------------------------------------------------------------------
  // §R — ROOT position. Round-4 blocker: none of this ran here.
  // -----------------------------------------------------------------------

  test("(R1) ROOT-position `as data-id` is refused — pre-fix it was SILENT", () => {
    const { errors } = compileToOutputs(rootSrc("data-id"), "rootdash");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    expect(String(errors[0].message)).toContain("data-id");
  });

  test("(R2) ROOT-position `as document` is refused", () => {
    const { errors } = compileToOutputs(rootSrc("document"), "rootdoc");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
  });

  test("(R3) ROOT-position VALID alias binds, renders, and emits no literal <each>", () => {
    const app = mount(rootSrc("row"), "rootok");
    expect(app.errors).toEqual([]);
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.rows()).toBe(2);
    expect(document.querySelectorAll("each").length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // §D — a DANGLING `as` (round-4 finding 2). It was the ONLY malformed-alias
  // shape with no diagnostic at all, and it produced the exact silent dead
  // bundle the other three arms exist to eliminate.
  // -----------------------------------------------------------------------

  test("(D1) `<each in=@rows as key=it>` (child): named, and the message says which token it found", () => {
    // Pre-fix: exit 0, zero diagnostics, emits `(_scrml_each_item, _scrml_each_idx) => it`
    // + `String(it)` -> `ReferenceError: it is not defined`, whole bundle dead.
    const { errors } = compileToOutputs(SRC_DANGLING_CHILD, "dangchild");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    const msg = String(errors[0].message);
    expect(msg).toContain("has no alias name");
    expect(msg).toContain("`key=`");     // names the token found in the alias slot
  });

  test("(D2) the same dangling `as` at ROOT position is named too", () => {
    const { errors } = compileToOutputs(SRC_DANGLING_ROOT, "dangroot");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    expect(String(errors[0].message)).toContain("has no alias name");
  });

  test("(D3) a TRAILING dangling `as` (nothing after it) is named, without inventing a token", () => {
    const { errors } = compileToOutputs(SRC_DANGLING_TRAILING, "dangtrail");
    expect(errors.map((e) => e.code)).toEqual(["E-EACH-AS-ALIAS-INVALID"]);
    const msg = String(errors[0].message);
    expect(msg).toContain("has no alias name");
    expect(msg).not.toContain("the next token is the attribute");
  });

  test("(D4) CONTROL — no `as` clause at all stays clean and `@.` carries the item", () => {
    // The arm must key on a PRESENT-but-nameless `as`, not on "no alias". A
    // blanket null-check here would reject every each that uses `@.`.
    const app = mount(SRC_NO_AS, "noas");
    expect(app.errors).toEqual([]);
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.rows()).toBe(2);
  });

  // -----------------------------------------------------------------------
  // §W — the SHAPE-DEPENDENT global-shadow case is deliberately NOT rejected
  // -----------------------------------------------------------------------

  test("(W) `as window` compiles AND renders — a globals LIST would break working source", () => {
    // This test exists to stop a later author from "tidying" the two-entry
    // always-emitted set into a JS-globals list. Measured: `window` is not
    // referenced by the emitted row factory in this shape, so the source works.
    const app = mount(liftSrc("window"), "aliaswindow");
    expect(app.errors).toEqual([]);
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.rows()).toBe(2);
  });

  // -----------------------------------------------------------------------
  // §S — the BS-structural path: ASSERTING THE DEFECT, not the fix
  // -----------------------------------------------------------------------

  test("(S) FILED, NOT FIXED — `as data-id` at top level still compiles SILENTLY WRONG", () => {
    // ast-builder.js is outside this dispatch's write-set. This asserts the
    // CURRENT behaviour so the eventual fix lands red-then-green here instead of
    // arriving as a surprise: the emitted factory binds `data`, silently dropping
    // the `-id` half of the alias the author wrote.
    const { errors, clientJs } = compileToOutputs(structuralSrc("data-id"), "aliasbs");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("(data, _scrml_each_idx)");
  });

  test("(S2) FILED, NOT FIXED — `as document` at top level still ships a dead bundle", () => {
    const app = mount(structuralSrc("document"), "aliasbsdoc");
    expect(app.errors).toEqual([]);
    // The bundle throws at eval. Asserting the THROW (not just "0 rows") is what
    // keeps this honest — 0 rows alone would also be satisfied by a clean gate.
    expect(String(app.thrown)).toContain("document.createDocumentFragment is not a function");
    expect(app.rows()).toBe(0);
  });
});
