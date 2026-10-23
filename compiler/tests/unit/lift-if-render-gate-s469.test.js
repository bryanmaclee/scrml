/**
 * lift-if-render-gate-s469 — emit-shape pins for a markup `if=` inside LIFTED markup
 * (g-lift-row-if-is-display-toggle-not-a-render-gate-s462 + cluster).
 *
 * §17.1: while the condition is false the element is NOT in the DOM. Lifted markup lowered
 * every position but one (the sole root of a reconciled `for … lift` row, non-value-indexed)
 * to a `style.display` toggle, wrote a call-ref / quoted `if=` as an `if` ATTRIBUTE (no gate),
 * and built a lifted `<each>` root as a literal `<each>` element. Now every lifted `if=` is the
 * element⇄comment swap (`_scrml_ifrow_apply`, the helper `<each>` rows use). The executed
 * behaviour is pinned in compiler/tests/browser/lift-if-render-gate-s469.browser.test.js and
 * the security-failable-pack n22 family; this file pins the emitted shape and the refusals.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve(tmpdir(), "scrml-lift-if-render-gate-s469-unit");

function compile(source) {
  const dir = resolve(tmpRoot, `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, source);
  const out = resolve(dir, "out");
  const res = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  const errors = (res.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
  const clientPath = resolve(out, "app.client.js");
  const runtimePath = resolve(out, res.runtimeFilename ?? "scrml-runtime.js");
  return {
    errors: errors.map((e) => e.code),
    messages: errors.map((e) => String(e.message ?? "")),
    js: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtime: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

const POSITIONS = [
  ["for-lift sole root", (b) => `<xs> = [1]\n<ok> = true\n<div>\${ for (x of @xs) { lift ${b} } }</div>\n`],
  ["for-lift nested", (b) => `<xs> = [1]\n<ok> = true\n<div>\${ for (x of @xs) { lift <span>${b}</span> } }</div>\n`],
  ["for-lift multi-root", (b) => `<xs> = [1]\n<ok> = true\n<div>\${ for (x of @xs) { lift ${b}\n lift <i></i> } }</div>\n`],
  ["if-lift root", (b) => `<ok> = true\n<div>\${ if (true) { lift ${b} } }</div>\n`],
  ["if-lift nested", (b) => `<ok> = true\n<div>\${ if (true) { lift <span>${b}</span> } }</div>\n`],
  ["bare lift nested", (b) => `<ok> = true\n<div>\${ lift <span>${b}</span> }</div>\n`],
  ["function returning markup", (b) => `<ok> = true\n\${ function pill() { return <span>${b}</span> } }\n<div>\${ pill() }</div>\n`],
  ["ternary markup value", (b) => `<ok> = true\n<div>\${ true ? <span>${b}</span> : "" }</div>\n`],
];

describe("every lifted if= position lowers to the element⇄comment swap, never a display toggle", () => {
  for (const [name, page] of POSITIONS) {
    test(name, () => {
      const r = compile(page(`<b if=@ok>x</b>`));
      expect(r.errors).toEqual([]);
      expect(r.js).toMatch(/_scrml_ifrow_apply\(/);
      expect(r.js).toMatch(/createComment\("scrml-if-row"\)/);
      expect(r.js).not.toMatch(/style\.display\s*=/);
      expect(r.js).not.toMatch(/setAttribute\("if"/);
      // The helper ships even where no list reconciles (the `reconciliation` chunk defines it).
      expect(r.runtime).toMatch(/function _scrml_ifrow_apply\(/);
    });
  }
});

describe("the trigger per context", () => {
  test("inside a reconciled row: a live-keyed per-item RENDER-GATE effect (`}, true)`)", () => {
    const r = compile(`<xs> = [{ id: 1, ok: true }]\n<div>\${ for (x of @xs) { lift <span><b if=x.ok>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/_scrml_resolve_item\([^)]*\);\s*if \(x === null\) return;\s*_scrml_cur_\w+ = _scrml_ifrow_apply\([^\n]*\n\s*\}, true\);/);
  });

  test("the value-indexed `@cell == lit` predicate keeps the O(2) subscribe_when dispatch", () => {
    const r = compile(`<sel> = 0\n<xs> = [{ id: 1 }]\n<div>\${ for (r of @xs) { lift <span><b if=(@sel == 3)>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/function (_scrml_if_\w+)\(\) \{ _scrml_cur_\w+ = _scrml_ifrow_apply\(/);
    expect(r.js).toMatch(/_scrml_cs_reactive_subscribe_when\("sel", 3, _scrml_if_\w+\);/);
    expect(r.js).not.toMatch(/style\.display\s*=/);
  });

  test("a value-indexed predicate that reads the ROW (`@sel == r.id`): the bucket follows the live row", () => {
    const r = compile(`<sel> = 0\n<xs> = [{ id: 1 }]\n<div>\${ for (r of @xs) { lift <span><b if=(@sel == r.id)>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    // The updater re-resolves the row (the bucket calls it outside any effect) ...
    expect(r.js).toMatch(/function _scrml_if_\w+\(\) \{\n\s*let r = _scrml_resolve_item\([^)]*\);\n\s*if \(r === null\) return;\n\s*_scrml_cur_\w+ = _scrml_ifrow_apply\(/);
    // ... and a render-gate effect re-reads the row's value, moves the registration, and swaps
    // with the cell read untracked (the bucket, not the effect, reacts to the cell).
    expect(r.js).toMatch(/const _scrml_vi_v = \(r\.id\);/);
    expect(r.js).toMatch(/_scrml_vi_off_\w+ = _scrml_cs_reactive_subscribe_when\("sel", _scrml_vi_v, _scrml_if_\w+\);/);
    expect(r.js).toMatch(/_scrml_untracked\(_scrml_if_\w+\);\n\s*\}, true\);/);
    expect(r.js).not.toMatch(/style\.display\s*=/);
  });

  test("an `if … lift` arm (LIVE): the swap is its own render-gate effect, the element the initial node", () => {
    const r = compile(`<ok> = true\n<show> = true\n<div>\${ if (@show) { lift <p><b if=@ok>x</b></p> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let (_scrml_cur_\w+) = (_scrml_lift_el_\w+);\n\s*_scrml_effect\(function\(\) \{ \1 = _scrml_ifrow_apply\(\1, \2, /);
    expect(r.js).toMatch(/_scrml_ifrow_apply\([^\n]*\); \}, true\);/);
  });
});

describe("every if= value kind is read; one that cannot be is refused (fail closed)", () => {
  test("a call-ref guard is gated (it was written as an `if` attribute — no gate)", () => {
    const r = compile(`\${ function allowed(p) { return p == "secret" } }\n<pw> = ""\n<div>\${ lift <span><b if=allowed(@pw)>x</b></span> }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/setAttribute\("if"/);
    expect(r.js).toMatch(/_scrml_ifrow_apply\(_scrml_cur_\w+, _scrml_lift_el_\w+, _scrml_ph_\w+, \(_scrml_allowed_\w+\(_scrml_cs_reactive_get\("pw"\)\)\)\)/);
  });

  test("a QUOTED guard is the expression, not a (truthy) string", () => {
    const r = compile(`<n> = 0\n<div>\${ lift <span><b if="@n >= 3">x</b></span> }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/\("@n >= 3"\)/);
    expect(r.js).toMatch(/\(_scrml_cs_reactive_get\("n"\) >= 3\) \? _scrml_lift_el_\w+ : _scrml_ph_\w+/);
  });

  test("a bare `if` (no condition) is E-CG-003, not an ungated render", () => {
    const r = compile(`<xs> = [1]\n<div>\${ for (x of @xs) { lift <span><b if>x</b></span> } }</div>\n`);
    expect(r.errors).toContain("E-CG-003");
    expect(r.messages.join("\n")).toMatch(/lifted markup/);
  });
});

describe("an <each> that IS the lifted root goes through the shared <each> lowering", () => {
  test("it is not built as a literal <each> element, and its if= is the row-scoped gate", () => {
    const r = compile(`<ok> = false\n<xs> = ["p"]\n<div>\${ if (true) { lift <each in=@xs as y if=@ok><span>\${y}</span></each> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/createElement\("each"\)/);
    expect(r.js).toMatch(/data-scrml-each-mount/);
    expect(r.js).not.toMatch(/style\.display\s*=/);
  });
});
