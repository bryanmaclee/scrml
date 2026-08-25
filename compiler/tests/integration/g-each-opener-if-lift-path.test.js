/**
 * g-each-opener-if-lift-path.test.js
 *
 * MERGE BLOCKER for `g-each-opener-if-dropped-on-lift-path` (HIGH, fail-OPEN).
 *
 * ⚑ WHY THIS LIVES IN `integration/` AND NOT `browser/`. The pre-commit hook runs
 * `compiler/tests/{unit,integration,conformance}` — `browser/` is NOT in it, and
 * `browser/` currently carries 47 pre-existing failures, so a gate parked there
 * would not block anything. This file executes a real bundle in happy-dom (the
 * `unit`/`integration` trees already do that in ~20 places) so the assertion is a
 * RENDERED-DOM assertion inside the blocking gate.
 *
 * THE BUG (measured at `0e836a70`, the round-2 tip of this branch). `if=` on an
 * `<each>` opener was silently DROPPED for every lift-parsed carrier. With
 * `<show> = false` the list rendered IN FULL — 2 of 2 `<li>` — at exit 0 with zero
 * diagnostics. `eachBlockFromMarkupNode` read `in` / `of` / `key` / `as` and had
 * no `if` branch at all, and neither of its two callers emitted a gate. The
 * IDENTICAL source at top level gated correctly, because the BS-structural path
 * emits a real §17.1 ifmount controller — so the predicate was honoured or
 * dropped according to WHERE the each sat, not according to what the author
 * wrote. Same shape as the `as`-alias defect this branch opened with.
 *
 * ⚠ IT WAS MASKED BEFORE ROUND 2. Pre-sweep these bundles died at eval with
 * `ReferenceError: _scrml_reconcile_list is not defined` (the tree-shaken
 * reconciliation chunk), so nothing rendered and the absent gate LOOKED like a
 * working one. Only counting rendered `<li>` after a SUCCESSFUL bundle eval
 * separates the two. A test that asserted "0 rows with show=false" without also
 * asserting "no throw" and "2 rows with show=true" would have passed on the bug.
 *
 * SPEC:
 *   §17.1.2   — "`if=` SHALL be honored on exactly three structural elements …
 *                `<each>` (§17.7) | YES | the whole iterated list, including
 *                `<empty>`".
 *   §17.1.2.1 — "For `<each if=expr>`: the iterated collection is not read and no
 *                rows are reconciled while `expr` is false; the keyed reconciler
 *                state is rebuilt on re-entry."
 *   §5.2      — condition attributes are the cluster-A carve-out from the
 *                quoted-is-a-static-string rule: "An operator/compound condition
 *                SHALL be parenthesized — `if=(@n >= 3)` — or quoted —
 *                `if="@n >= 3"`". Both forms are covered below; the first cut of
 *                the fix mis-read the quoted form as a string constant and emitted
 *                `E-CODEGEN-INVALID-LOGIC` on source that compiles clean on main.
 *
 * ⚑ DECLARATION FORM IS VARIED DELIBERATELY. The four carriers differ in HOW the
 * markup is declared (`fn` body · `lift` inside a value-form `if` · ternary
 * markup-value · `const <cell> = <markup>`), and §H varies the `if=` VALUE form
 * across all four spellings the grammar admits. A measurement on one form did not
 * hold for another during this fix — twice.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

const D = "$";

// ---------------------------------------------------------------------------
// The four off-spine carriers, each with `if=@show` on the <each> OPENER.
// These are the same four the round-2 chunk sweep enumerated; the `if=` defect
// rides on every one of them because they all route through
// `eachBlockFromMarkupNode`.
// ---------------------------------------------------------------------------

// carrier: return-stmt.markupNode
const SRC_FN_BODY = `<program>
<rows> = ["a", "b"]
<show> = false
fn listing() {
    return <ul>
        <each in=@rows as it key=it if=@show>
            <li>${D}{it}</li>
        </each>
    </ul>
}
<div>${D}{listing()}</div>
</program>
`;

// carrier: lift-expr.expr.node
const SRC_LIFT_EXPR = `<program>
<rows> = ["a", "b"]
<show> = false
<flag> = true
<main>
    ${D}{ if @flag { lift <ul><each in=@rows as it key=it if=@show><li>${D}{it}</li></each></ul> } }
</main>
</program>
`;

// carrier: markup-value.node (ternary)
const SRC_TERNARY = `<program>
<rows> = ["a", "b"]
<show> = false
<flag> = true
<main>
    ${D}{ @flag ? <ul><each in=@rows as it key=it if=@show><li>${D}{it}</li></each></ul> : "" }
</main>
</program>
`;

// carrier: render-spec.element (§6.6.17 markup-typed derived cell)
const SRC_DERIVED = `<program>
<rows> = ["a", "b"]
<show> = false
const <listing> = <ul><each in=@rows as it key=it if=@show><li>${D}{it}</li></each></ul>
<div>${D}{@listing}</div>
</program>
`;

// Same fn-body carrier, NO alias at all (`@.` body) — the alias and the predicate
// are independent reads of the attr list and must not be coupled.
const SRC_FN_BODY_NO_ALIAS = `<program>
<rows> = ["a", "b"]
<show> = false
fn listing() {
    return <ul>
        <each in=@rows if=@show>
            <li>${D}{@.}</li>
        </each>
    </ul>
}
<div>${D}{listing()}</div>
</program>
`;

// CONTROL — the identical each with NO `if=`. Renders unconditionally; proves the
// gate is not a blanket suppression and that the no-`if=` emit path is untouched.
const SRC_NO_IF = `<program>
<rows> = ["a", "b"]
<show> = false
fn listing() {
    return <ul>
        <each in=@rows as it key=it>
            <li>${D}{it}</li>
        </each>
    </ul>
}
<div>${D}{listing()}</div>
</program>
`;

// CONTROL — the STRUCTURAL top-level each. Gated by the §17.1 ifmount controller,
// NOT by this fix. It gated correctly before and must still gate after: the fix
// must not double-gate or otherwise disturb the structural path.
const SRC_STRUCTURAL = `<program>
<rows> = ["a", "b"]
<show> = false
<ul>
    <each in=@rows as it key=it if=@show>
        <li>${D}{it}</li>
    </each>
</ul>
</program>
`;

// `<empty>` composition — §17.1.2 says the gate covers "the whole iterated list,
// INCLUDING `<empty>`". A false predicate must suppress the empty-state branch
// too, not fall through to it.
const SRC_WITH_EMPTY = `<program>
<rows> = []
<show> = false
fn listing() {
    return <ul>
        <each in=@rows as it key=it if=@show>
            <li>${D}{it}</li>
            <empty><li class="none">nothing</li></empty>
        </each>
    </ul>
}
<div>${D}{listing()}</div>
</program>
`;

// `if=` VALUE-form matrix (§5.2 cluster-A). `${IF}` is substituted per case.
function srcWithIfForm(ifAttr) {
  return `<program>
<rows> = ["a", "b"]
<show> = false
<n> = 1
fn listing() {
    return <ul>
        <each in=@rows as it key=it ${ifAttr}>
            <li>${D}{it}</li>
        </each>
    </ul>
}
<div>${D}{listing()}</div>
</program>
`;
}

const tmpRoot = resolve("/tmp", "scrml-each-opener-if-lift");

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
    // ⚑ The SHIPPED runtime chunk, read off `result.runtimeFilename` — never
    // `runtime-template.js`. The whole round-2 defect was a chunk that the
    // template HAS and the shipped artifact does not; mounting the template
    // would make this gate blind to exactly that class.
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-each-opener-if-lift-path — `if=` on a lift-parsed `<each>` gates the list (§17.1.2)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  /**
   * Compile + EXECUTE the shipped artifacts. `thrown` carries a bundle-eval error
   * rather than letting it escape, so a dead bundle surfaces as a NAMED assertion
   * instead of an anonymous crash — and, critically, so a dead bundle can never be
   * mistaken for a working gate (that is exactly how this defect hid).
   */
  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    let thrown = null;
    try {
      const exec = new Function(
        "window",
        "document",
        `${runtimeJs}\n${clientJs}\n` +
          `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
          `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
      );
      exec(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      thrown = e;
    }
    const cellKey = clientJs ? chunkCellKey(clientJs) : (n) => n;
    return {
      errors,
      clientJs,
      thrown,
      set: (name, val) => globalThis.__scrml_set__(cellKey(name), val),
      items: () => [...document.querySelectorAll("li")].map((n) => n.textContent.trim()),
      hardErrors: () => errors.filter((e) => String(e.severity ?? "error") === "error"),
    };
  }

  /** Every assertion this gate makes about a CLOSED gate, in one place. */
  function expectGateClosed(app) {
    expect(app.hardErrors()).toEqual([]);
    // A dead bundle also renders zero rows. Assert it is ALIVE first, or the
    // "0 rows" assertion below is satisfied by the very failure mode that masked
    // this bug through two rounds.
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual([]);
  }

  // -----------------------------------------------------------------------
  // §A — the bug, on all four off-spine carriers
  // -----------------------------------------------------------------------

  test("(A1) fn body: `<each … if=@show>` with @show FALSE renders zero rows", () => {
    // PRE-FIX: ["a","b"] — the whole list, exit 0, no diagnostics.
    expectGateClosed(mount(SRC_FN_BODY, "iffn"));
  });

  test("(A2) lift-expr: `${ if @flag { lift <ul><each … if=@show> } }` gates", () => {
    expectGateClosed(mount(SRC_LIFT_EXPR, "iflift"));
  });

  test("(A3) ternary markup-value: `${ @flag ? <ul><each … if=@show> : \"\" }` gates", () => {
    expectGateClosed(mount(SRC_TERNARY, "ifternary"));
  });

  test("(A4) markup-typed derived cell: `const <listing> = <ul><each … if=@show>` gates", () => {
    expectGateClosed(mount(SRC_DERIVED, "ifderived"));
  });

  test("(A5) fn body, NO `as` alias: the predicate is read independently of the alias", () => {
    expectGateClosed(mount(SRC_FN_BODY_NO_ALIAS, "ifnoalias"));
  });

  // -----------------------------------------------------------------------
  // §B — the gate is a GATE, not a blanket suppression
  // -----------------------------------------------------------------------

  test("(B1) @show TRUE renders every row — the fix does not suppress the list", () => {
    const src = SRC_FN_BODY.replace("<show> = false", "<show> = true");
    const app = mount(src, "iftrue");
    expect(app.hardErrors()).toEqual([]);
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual(["a", "b"]);
  });

  test("(B2) CONTROL — no `if=` at all: the list renders, emit path untouched", () => {
    const app = mount(SRC_NO_IF, "ifnone");
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual(["a", "b"]);
    // The gate is emitted ONLY when the opener carries `if=`.
    expect(app.clientJs).not.toContain("17.1.2 opener if=");
  });

  test("(B3) CONTROL — the STRUCTURAL top-level each still gates via the §17.1 ifmount", () => {
    const app = mount(SRC_STRUCTURAL, "ifstruct");
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual([]);
    // Its gate is the ifmount controller, NOT this fix's in-effect guard. If this
    // ever flips, the two paths have started double-gating the same each.
    expect(app.clientJs).toContain("_scrml_find_if_marker");
    expect(app.clientJs).not.toContain("17.1.2 opener if=");
  });

  // -----------------------------------------------------------------------
  // §C — REACTIVITY. §17.1.2.1 requires re-entry to rebuild.
  // -----------------------------------------------------------------------

  test("(C1) false → true → false: rows appear on the flip and are torn down again", () => {
    const app = mount(SRC_FN_BODY, "ifreactive");
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual([]);
    app.set("show", true);
    expect(app.items()).toEqual(["a", "b"]);   // re-entry rebuilt the list
    app.set("show", false);
    expect(app.items()).toEqual([]);           // and tore it down again
    app.set("show", true);
    expect(app.items()).toEqual(["a", "b"]);   // second re-entry: no stale state
  });

  test("(C2) a write to the COLLECTION while the gate is closed renders nothing", () => {
    // §17.1.2.1: "the iterated collection is not read … while `expr` is false".
    const app = mount(SRC_FN_BODY, "ifclosedwrite");
    expect(app.items()).toEqual([]);
    app.set("rows", ["x", "y", "z"]);
    expect(app.items()).toEqual([]);
    // …and the NEW collection is what appears on re-entry.
    app.set("show", true);
    expect(app.items()).toEqual(["x", "y", "z"]);
  });

  // -----------------------------------------------------------------------
  // §D — `<empty>` is inside the gate (§17.1.2 "including `<empty>`")
  // -----------------------------------------------------------------------

  test("(D1) an empty collection + a FALSE predicate renders neither rows nor `<empty>`", () => {
    const app = mount(SRC_WITH_EMPTY, "ifempty");
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual([]);
    expect(document.querySelectorAll("li.none").length).toBe(0);
  });

  test("(D2) an empty collection + a TRUE predicate renders the `<empty>` branch", () => {
    const src = SRC_WITH_EMPTY.replace("<show> = false", "<show> = true");
    const app = mount(src, "ifemptytrue");
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual(["nothing"]);
  });

  // -----------------------------------------------------------------------
  // §H — the `if=` VALUE-form matrix (§5.2 cluster-A). The quoted form is the one
  // the first cut of this fix got wrong, in the loudest possible way.
  // -----------------------------------------------------------------------

  const FORMS = [
    ["bare @cell",        "if=@show",        false, []],
    ["quoted @cell",      'if="@show"',      false, []],
    ["quoted operator",   'if="@n >= 3"',    false, []],
    ["parenthesised op",  "if=(@n >= 3)",    false, []],
    ["quoted prefix-not", 'if="not @show"',  true,  ["a", "b"]],
    ["quoted `is some`",  'if="@rows is some"', true, ["a", "b"]],
  ];

  for (const [label, ifAttr, opens, expected] of FORMS) {
    test(`(H) \`${ifAttr}\` compiles clean and ${opens ? "OPENS" : "CLOSES"} the gate`, () => {
      const app = mount(srcWithIfForm(ifAttr), "ifform");
      // ⚑ A codegen defect here is LOUD by design: the quoted form used to emit
      // `if (!("_scrml_reactive_get("show")"))` → E-CODEGEN-INVALID-LOGIC.
      expect(app.hardErrors().map((e) => e.code)).toEqual([]);
      expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
      expect(app.items()).toEqual(expected);
    });
  }

  // -----------------------------------------------------------------------
  // §E — emit-shape assertions. Cheap, and they name the mechanism when a DOM
  // assertion above goes red for an unrelated reason.
  // -----------------------------------------------------------------------

  test("(E1) the guard precedes the collection read, so a closed gate never reads it", () => {
    const { clientJs } = compileToOutputs(SRC_FN_BODY, "iforder");
    const gateAt = clientJs.indexOf("17.1.2 opener if=");
    const readAt = clientJs.indexOf('_scrml_each_items_');
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(readAt);
  });

  test("(E2) the guard is INSIDE the effect, so the predicate is a tracked read", () => {
    const { clientJs } = compileToOutputs(SRC_FN_BODY, "ifeffect");
    const effectAt = clientJs.indexOf("_scrml_mount_track(_scrml_effect(");
    const gateAt = clientJs.indexOf("17.1.2 opener if=");
    expect(effectAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(effectAt);
  });
});
