/**
 * E-CELL-RENDER-SPEC-NOT-BINDABLE is DECL-scoped (SPEC §6.2 Shape 2).
 *
 * SPEC §6.2 Shape 2 states the rule as a property of the DECLARATION:
 *
 *   "E-CELL-RENDER-SPEC-NOT-BINDABLE (compile error): The RHS markup is a
 *    non-input element (e.g., `<div>`, `<span>`). Shape 2 requires bindable
 *    markup. Use Shape 3 (`const <derived>`) for display-only markup cells."
 *
 * Nothing there depends on a use site. The check nevertheless fired only at
 * `<x/>` render-by-tag USE sites, so a decl read with `${@x}` — or never read
 * at all — was silently accepted and lowered to `_scrml_reactive_set(x, null)`,
 * discarding the authored markup with no diagnostic.
 *
 * `compiler/tests/unit/render-by-tag.test.js` §B6.19 pins the diagnostic at the
 * SYM level. This file pins the END-TO-END consequences through the real
 * compile pipeline, because the two regression guards below are claims about
 * EMITTED CODE that a SYM-level test structurally cannot make.
 *
 * THE TRAP THESE GUARDS EXIST FOR
 * -------------------------------
 * A LEGAL Shape 2 bindable cell (`<userName req> = <input type="text"/>`) ALSO
 * has a markup RHS, and ALSO emits `_scrml_reactive_set("userName", null)` —
 * correctly, because the cell holds the input's value and that starts empty.
 * The emitted symptom is byte-identical between the legal form and the broken
 * one. Any check keying on "the RHS is markup", or on the emitted null-set,
 * turns every form input in the corpus into a compile error. Only B5's
 * `_cellKind` discriminates, and these tests assert the BINDING SURVIVES rather
 * than merely that no error fired — absence-of-error would still pass if the
 * binding had been silently dropped.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "cell-render-decl-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

/** Compile a single-file program; return errors + the emitted client JS/HTML. */
function build(caseId, source) {
  const ROOT = join(TMP, caseId);
  mkdirSync(ROOT, { recursive: true });
  const abs = join(ROOT, "app.scrml");
  writeFileSync(abs, source);
  const outDir = join(ROOT, "dist");
  const result = compileScrml({ inputFiles: [abs], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const files = existsSync(outDir) ? readdirSync(outDir) : [];
  const readOut = (rel) => {
    const p = join(outDir, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  // The app's own client chunk — deliberately NOT the shared runtime, which is
  // 60kB+ of library text that would make any `toContain` assertion below
  // meaningless.
  const clientJs = readOut("app.client.js") ?? "";
  const html = readOut("app.html") ?? "";
  return { errors, files, clientJs, html };
}

const NOT_BINDABLE = "E-CELL-RENDER-SPEC-NOT-BINDABLE";
const codes = (errors, code) => errors.filter((e) => e.code === code);

describe("E-CELL-RENDER-SPEC-NOT-BINDABLE fires at the declaration", () => {
  test("`${@plain}` interpolation use — fires (was silent, markup discarded)", () => {
    const { errors } = build(
      "interp-use",
      `<program>\n  <plain> = <span class="p">yo</span>\n  <div>\${@plain}</div>\n</program>\n`,
    );
    const fires = codes(errors, NOT_BINDABLE);
    expect(fires.length).toBe(1);
    // Reported at the decl (line 2), not at the `${@plain}` read (line 3).
    expect(fires[0].span.line).toBe(2);
  });

  test("no use anywhere — fires (there was no use-site to hang the old check on)", () => {
    const { errors } = build(
      "no-use",
      `<program>\n  <plain> = <span class="p">yo</span>\n  <div>hi</div>\n</program>\n`,
    );
    const fires = codes(errors, NOT_BINDABLE);
    expect(fires.length).toBe(1);
    expect(fires[0].span.line).toBe(2);
  });

  test("`<plain/>` render-by-tag use — fires EXACTLY ONCE, at the decl not the use", () => {
    const { errors } = build(
      "tag-use",
      `<program>\n  <plain> = <span class="p">yo</span>\n  <plain/>\n</program>\n`,
    );
    const fires = codes(errors, NOT_BINDABLE);
    // No double-fire: the decl-scoped fire replaced the use-site fire, it did
    // not join it.
    expect(fires.length).toBe(1);
    expect(fires[0].span.line).toBe(2);
  });
});

describe("REGRESSION — legal shapes with a markup RHS still compile and still emit", () => {
  test("Shape 2 bindable `<input>`: clean AND the bind:value dispatch survives", () => {
    const { errors, clientJs, html } = build(
      "bindable-input",
      `<program>\n  <userName req> = <input type="text"/>\n  <userName/>\n</program>\n`,
    );
    expect(codes(errors, NOT_BINDABLE).length).toBe(0);
    expect(errors).toEqual([]);

    // Assert the BINDING, not merely the absence of a diagnostic. A check that
    // wrongly keyed on "markup RHS" would reject this outright — but a subtler
    // break could keep it compiling while dropping the two-way wiring, and
    // `expect(errors).toEqual([])` alone would score that green.
    //
    // Cell -> element (initial paint + reactive re-render):
    expect(clientJs).toContain('_scrml_reactive_get("userName")');
    // Element -> cell (the bind:value dispatch):
    expect(clientJs).toContain('addEventListener("input"');
    expect(clientJs).toContain('_scrml_reactive_set("userName", event.target.value)');
    // And the render-by-tag element is actually in the document to bind to.
    expect(html).toContain("data-scrml-render-by-tag");
    expect(html).toContain("<input");

    // The null-set that makes the broken and the legal case look identical in
    // the emitted text. Pinned deliberately: it is CORRECT here (the cell holds
    // the input's value, which starts empty), and its presence is exactly why
    // the check must key on `_cellKind` rather than on emitted output.
    expect(clientJs).toContain('_scrml_reactive_set("userName", null)');
  });

  test("Shape 3 `const` markup cell: clean AND the markup factory survives", () => {
    const { errors, clientJs, html } = build(
      "const-markup",
      `<program>\n  const <badge> = <span class="b">B</span>\n  <div>\${@badge}</div>\n</program>\n`,
    );
    expect(codes(errors, NOT_BINDABLE).length).toBe(0);
    expect(errors).toEqual([]);

    // `const` is the SPEC-named remediation this diagnostic points authors at.
    // If the decl check ever fired here it would be rejecting its own advice —
    // so assert the Shape 3 lowering is intact, not just that nothing errored.
    expect(clientJs).toMatch(/function _scrml_markup_factory_badge/);
    expect(clientJs).toContain('_scrml_derived_declare("badge"');
    expect(clientJs).toContain('document.createElement("span")');
    // The authored markup SURVIVES — the thing the broken non-const path
    // discarded.
    expect(clientJs).toContain('_scrml_lift_el_3.setAttribute("class", "b")');
    expect(html).toContain("data-scrml-logic");
  });

  test("Shape 1 `<count> = 0` (no markup RHS at all) is unaffected", () => {
    const { errors, clientJs } = build(
      "plain-number",
      `<program>\n  <count> = 0\n  <div>\${@count}</div>\n</program>\n`,
    );
    expect(codes(errors, NOT_BINDABLE).length).toBe(0);
    expect(errors).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_set("count", 0)');
  });

  test("a bindable cell with NO use at all stays clean", () => {
    // The decl check runs independently of use sites now, so the no-use path is
    // the one where a mis-keyed check would fire hardest.
    const { errors } = build(
      "bindable-no-use",
      `<program>\n  <userName req> = <input type="text"/>\n  <div>hi</div>\n</program>\n`,
    );
    expect(codes(errors, NOT_BINDABLE).length).toBe(0);
  });
});
