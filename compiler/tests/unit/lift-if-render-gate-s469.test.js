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
 * the security-failable-pack n23 family; this file pins the emitted shape and the refusals.
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
  test("inside a reconciled row: a live-keyed per-item RENDER-GATE effect that disposes itself when the row is gone", () => {
    const r = compile(`<xs> = [{ id: 1, ok: true }]\n<div>\${ for (x of @xs) { lift <span><b if=x.ok>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let (_scrml_gate_off_\w+) = null;\n\s*\1 = _scrml_effect\(\(\) => \{\n\s*let x = _scrml_resolve_item\([^)]*\);\n\s*if \(x === null\) \{ if \(\1 !== null\) _scrml_g\.queueMicrotask\(\1\); return; \}\n\s*_scrml_cur_\w+ = _scrml_ifrow_apply\([^\n]*\n\s*\}, true\);/);
  });

  test("a value-indexed `@cell == lit` predicate in a row keeps the O(2) subscribe_when dispatch", () => {
    const r = compile(`<sel> = 0\n<xs> = [{ id: 1 }]\n<div>\${ for (r of @xs) { lift <span><b if=(@sel == 3)>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/const _scrml_vi_v = \(3\);/);
    expect(r.js).toMatch(/_scrml_cs_reactive_subscribe_when\("sel", _scrml_vi_v, _scrml_if_\w+\);/);
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
    // The bucket registration is released with the row (F2, S469 round 2).
    expect(r.js).toMatch(/if \(r === null\) \{ if \((_scrml_vi_off_\w+) !== null\) \{ \1\(\); \1 = null; \} if \(_scrml_gate_off_\w+ !== null\)/);
    expect(r.js).not.toMatch(/style\.display\s*=/);
  });

  test("outside a row every gate is a TRACKING effect — no `@name`-token subscriptions (F1, S469 round 2)", () => {
    for (const wrap of [
      (b) => `\${ lift <span>${b}</span> }`,
      (b) => `\${ if (true) { lift <span>${b}</span> } }`,
      (b) => `\${ for (x of [1, 2]) { lift <span>${b}</span> } }`,
    ]) {
      const r = compile(`<role> = "admin"\n\${ function isAdmin() { return @role == "admin" } }\n<div>${wrap(`<b if=(isAdmin() && true)>x</b>`)}</div>\n`);
      expect(r.errors).toEqual([]);
      expect(r.js).toMatch(/let (_scrml_cur_\w+) = (_scrml_lift_el_\w+);\n\s*_scrml_effect\(function\(\) \{ \1 = _scrml_ifrow_apply\(\1, \2, _scrml_ph_\w+, \(_scrml_isAdmin_\w+\(\) && true\)\); \}, true\);/);
      expect(r.js).not.toMatch(/_scrml_cs_reactive_subscribe\(/);
    }
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
    expect(r.js).toMatch(/_scrml_ifrow_apply\(_scrml_cur_\w+, _scrml_lift_el_\w+, _scrml_ph_\w+, \(_scrml_cs_reactive_get\("n"\) >= 3\)\)/);
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

describe("S469 round 2 — show=, the top-level bare `if`, and a component's `@` refs in lifted markup", () => {
  test("lifted `show=` is a tracking display toggle, not a plain attribute", () => {
    const row = compile(`<on> = true\n<xs> = [1]\n<div>\${ for (x of @xs) { lift <span><b show=@on>x</b></span> } }</div>\n`);
    expect(row.errors).toEqual([]);
    expect(row.js).not.toMatch(/setAttribute\("show"/);
    expect(row.js).toMatch(/_scrml_effect\(\(\) => \{\n\s*let x = _scrml_resolve_item\([^\n]*\n[^\n]*\n\s*_scrml_lift_el_\w+\.style\.display = \(_scrml_cs_reactive_get\("on"\)\) \? "" : "none";/);
    const bare = compile(`<on> = true\n<div>\${ lift <span><b show=@on>x</b></span> }</div>\n`);
    expect(bare.errors).toEqual([]);
    expect(bare.js).toMatch(/_scrml_effect\(function\(\) \{ _scrml_lift_el_\w+\.style\.display = \(_scrml_cs_reactive_get\("on"\)\) \? "" : "none"; \}\);/);
  });

  test("a bare `show` in lifted markup is E-CG-003", () => {
    const r = compile(`<div>\${ lift <span><b show>x</b></span> }</div>\n`);
    expect(r.errors).toContain("E-CG-003");
  });

  test("a top-level bare `<b if>` is E-CG-003 (it rendered ungated with no diagnostic)", () => {
    const r = compile(`<div><b if>x</b></div>\n`);
    expect(r.errors).toContain("E-CG-003");
    expect(r.messages.join("\n")).toMatch(/has no condition/);
  });

  test("a component body's `@ok` (if= / class: / attribute) lowers to the cell inside lifted markup, not a bare `ok`", () => {
    const r = compile(`<ok> = true\n<xs> = [1]\n\${ const Pill = <span class:on=@ok title=@ok><b if=@ok>x</b></span> }\n<div>\${ for (x of @xs) { lift <div><Pill/></div> } }</div>\n<div>\${ lift <div><Pill/></div> }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/\(ok\)|, ok\)|!!\(ok\)/);
    expect(r.js).toMatch(/classList\.toggle\("on", !!\(_scrml_cs_reactive_get\("ok"\)\)\)/);
    expect(r.js).toMatch(/setAttribute\("title", _scrml_cs_reactive_get\("ok"\)\)/);
  });
});

describe("S469 round 4 — a gate is its own effect only when its condition is self-contained", () => {
  test("a body local: read inline in the render (main's lowering), no own effect", () => {
    const r = compile(`<n> = 1\n<div>\${ let i = 0\n while (i < 3) { lift <span><b if=(i == @n)>x</b></span>\n i = i + 1 } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let _scrml_cur_\w+ = \(_scrml_structural_eq\(i, _scrml_cs_reactive_get\("n"\)\)\) \? _scrml_lift_el_\w+ : _scrml_ph_\w+;/);
    expect(r.js).not.toMatch(/_scrml_ifrow_apply\(/);
  });

  test("a local closure: inline, never an effect", () => {
    const r = compile(`<n> = 1\n<div>\${ let ok = false\n const allowed = () => ok || @n > 5\n lift <span><b if=(allowed())>x</b></span>\n ok = true }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let _scrml_cur_\w+ = \(allowed\(\)\) \? /);
    expect(r.js).not.toMatch(/_scrml_ifrow_apply\(/);
  });

  test("a keyed loop whose gate reads a local is lowered plain (the group re-runs it)", () => {
    const r = compile(`<n> = 1\n<rows> = [{ id: 1 }]\n<div>\${ let ok = false\n const allowed = () => ok || @n > 5\n for (row of @rows) { lift <b if=(allowed())>x</b> }\n ok = true }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/_scrml_reconcile_list\(/);
  });

  test("a file-level function, a cell, the row item: self-contained — own effect, keyed row kept", () => {
    const r = compile(`<role> = "admin"\n<rows> = [{ id: 1, ok: true }]\n\${ function isAdmin() { return @role == "admin" } }\n<div>\${ for (row of @rows) { lift <b if=(isAdmin() && row.ok)>x</b> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/_scrml_reconcile_list\(/);
    expect(r.js).toMatch(/_scrml_ifrow_apply\(/);
  });

  test("an arrow parameter inside the condition is not a free name", () => {
    const r = compile(`<xs> = [1]\n<div>\${ lift <span><b if=(@xs.some(v => v > 0))>x</b></span> }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/_scrml_effect\(function\(\) \{ _scrml_cur_\w+ = _scrml_ifrow_apply\(/);
  });
});
