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

describe("S469 — where a lifted gate is re-evaluated (rounds 5 placement A/B kept; C/D and the value bucket re-ruled by s469-lift-gate-staleness)", () => {
  test("A: the sole root of a reconciled row — the per-item effect main already had", () => {
    const r = compile(`<ok> = true\n<xs> = [{ id: 1 }]\n<div>\${ for (x of @xs) { lift <b if=@ok>x</b> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let (_scrml_cur_\w+) = \(_scrml_cs_reactive_get\("ok"\)\) \? _scrml_lift_el_\w+ : _scrml_ph_\w+;\n\s*_scrml_effect\(\(\) => \{\n\s*let x = _scrml_resolve_item\([^\n]*\n\s*if \(x === null\) return;\n\s*\1 = _scrml_ifrow_apply\(/);
  });

  test("B: a nested element whose condition reads the row — a per-item effect (main's tryEmitLiftIfReactive)", () => {
    const r = compile(`<xs> = [{ id: 1, ok: true }]\n<div>\${ for (x of @xs) { lift <span><b if=x.ok>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let (_scrml_cur_\w+) = _scrml_lift_el_\w+;\n\s*_scrml_effect\(\(\) => \{\n\s*let x = _scrml_resolve_item\([^\n]*\n\s*if \(x === null\) return;\n\s*\1 = _scrml_ifrow_apply\(\1, _scrml_lift_el_\w+, _scrml_ph_\w+, \(x\.ok\)\);/);
  });

  // s469-lift-gate-staleness (g-lift-gate-placement-inherits-main-staleness-s469): a CLOSED gate — it reads
  // only cells, file-level bindings and its row's binder — is its own tracked effect wherever it sits, so a
  // cell read inside a called function is a dependency. Main's text subscriptions (placement D) are gone.
  test("C/D: a closed gate outside a row is its own tracked effect (a render gate), owned where it is built", () => {
    const arm = compile(`<ok> = true\n<show> = true\n<div>\${ if (@show) { lift <p><b if=@ok>x</b></p> } }</div>\n`);
    expect(arm.errors).toEqual([]);
    expect(arm.js).toMatch(/function (_scrml_if_\w+)\(\) \{ _scrml_cur_\w+ = _scrml_ifrow_apply\([^\n]*\); \}\n\s*_scrml_mount_track\(_scrml_effect\(\1, true\)\);/);
    const bare = compile(`<ok> = true\n<div>\${ lift <span><b if=@ok>x</b></span> }</div>\n`);
    expect(bare.errors).toEqual([]);
    expect(bare.js).toMatch(/function (_scrml_if_\w+)\(\) \{ _scrml_cur_\w+ = _scrml_ifrow_apply\([^\n]*\); \}\n\s*_scrml_mount_track\(_scrml_effect\(\1, true\)\);/);
    expect(bare.js).not.toMatch(/_scrml_cs_reactive_subscribe\(/);
  });

  test("a cell read only inside a called function: the gate is still an effect (it tracks the call)", () => {
    const r = compile(`<role> = "admin"\n\${ function isAdmin() { return @role == "admin" } }\n<div>\${ lift <span><b if=isAdmin()>x</b></span> }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/function (_scrml_if_\w+)\(\) \{ _scrml_cur_\w+ = _scrml_ifrow_apply\(_scrml_cur_\w+, _scrml_lift_el_\w+, _scrml_ph_\w+, \(_scrml_isAdmin_\w+\(\)\)\); \}\n\s*_scrml_mount_track\(_scrml_effect\(\1, true\)\);/);
    const row = compile(`<role> = "admin"\n<xs> = [{ id: 1 }]\n\${ function isAdmin() { return @role == "admin" } }\n<div>\${ for (x of @xs) { lift <span><b if=isAdmin()>x</b></span> } }</div>\n`);
    expect(row.errors).toEqual([]);
    expect(row.js).toMatch(/_scrml_effect\(\(\) => \{\n\s*let x = _scrml_resolve_item\([^\n]*\n\s*if \(x === null\) return;\n\s*_scrml_cur_\w+ = _scrml_ifrow_apply\(_scrml_cur_\w+, _scrml_lift_el_\w+, _scrml_ph_\w+, \(_scrml_isAdmin_\w+\(\)\)\);/);
  });

  test("value-indexed in a row: the O(2) bucket, re-registered under the LIVE row's field by a tracked effect", () => {
    const r = compile(`<sel> = 0\n<xs> = [{ id: 1 }]\n<div>\${ for (r of @xs) { lift <span><b if=(@sel == r.id)>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/let (_scrml_live_\w+) = r;\n\s*function (_scrml_if_\w+)\(\) \{ const r = \1; _scrml_cur_\w+ = _scrml_ifrow_apply\(/);
    expect(r.js).toMatch(/let (_scrml_unsub_\w+) = null;\n\s*_scrml_mount_track\(\(\) => \{ if \(\1\) \1\(\); \}\);\n\s*_scrml_effect\(\(\) => \{\n\s*let r = _scrml_resolve_item\([^\n]*\n\s*if \(r === null\) return;\n\s*_scrml_live_\w+ = r;\n\s*if \(\1\) \1\(\);\n\s*\1 = _scrml_cs_reactive_subscribe_when\("sel", r\.id, _scrml_if_\w+\);\n\s*_scrml_untracked\(_scrml_if_\w+\);/);
  });

  test("an OPEN gate (a body local / a local closure) is read in the render, and the group re-renders", () => {
    const r = compile(`<n> = 1\n<div>\${ let ok = false\n const allowed = () => ok || @n > 5\n lift <span><b if=(allowed())>x</b></span>\n ok = true }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/function (_scrml_if_\w+)\(\) \{ _scrml_cur_\w+ = _scrml_ifrow_apply\(_scrml_cur_\w+, _scrml_lift_el_\w+, _scrml_ph_\w+, \(allowed\(\)\)\); \}\n\s*\1\(\);/);
    expect(r.js).toMatch(/_scrml_effect\(function\(\) \{\n\s*_scrml_lift_tgt_\w+\.innerHTML = "";/);
    expect(r.js).not.toMatch(/style\.display\s*=/);
    // …even when its text names no cell (the cell is read inside a function): the group is forced to its re-render effect.
    const ind = compile(`<role> = "admin"\n\${ function isAdmin() { return @role == "admin" } }\n<div>\${ let ok = false\n lift <span><b if=(ok || isAdmin())>x</b></span>\n ok = true }</div>\n`);
    expect(ind.errors).toEqual([]);
    expect(ind.js).toMatch(/_scrml_effect\(function\(\) \{\n\s*_scrml_lift_tgt_\w+\.innerHTML = "";/);
  });

  test("an open gate in a keyed row lowers the row as the plain loop", () => {
    const r = compile(`<n> = 1\n<rows> = [{ id: 1 }]\n<div>\${ for (row of @rows) { let ok = false\n lift <b if=(ok || @n > 5)>x</b>\n ok = true } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/_scrml_reconcile_list\(/);
    expect(r.js).toMatch(/for \(const row of _scrml_cs_reactive_get\("rows"\)\) \{/);
  });

  test("an open gate no render re-runs is refused E-IMPL1-LIFT-GATE-UNTRACKED (fail closed)", () => {
    const fn = compile(`<n> = 1\n\${ function pill(q: bool) { return <span><b if=(q && @n > 1)>x</b></span> } }\n<div>\${ pill(true) }</div>\n`);
    expect(fn.errors).toContain("E-IMPL1-LIFT-GATE-UNTRACKED");
    expect(fn.messages.join("\n")).toMatch(/reads `q`/);
    // A lift that escapes its row (a `while` in a row) and reads the loop counter.
    const esc = compile(`<n> = 1\n<rows> = [{ id: 1 }]\n<div>\${ for (row of @rows) { lift <i></i>\n let i = 0\n while (i < 2) { lift <b if=(i == @n)>x</b>\n i = i + 1 } } }</div>\n`);
    expect(esc.errors).toEqual([]); // the row is lowered plain (the gate reads `i`): nothing escapes
  });

  test("show= takes the same rule: a per-item effect in a row, its own effect elsewhere", () => {
    const row = compile(`<xs> = [{ id: 1, on: true }]\n<div>\${ for (x of @xs) { lift <span><b show=x.on>x</b></span> } }</div>\n`);
    expect(row.errors).toEqual([]);
    expect(row.js).not.toMatch(/setAttribute\("show"/);
    expect(row.js).toMatch(/_scrml_effect\(\(\) => \{\n\s*let x = _scrml_resolve_item\([^\n]*\n[^\n]*\n\s*_scrml_lift_el_\w+\.style\.display = \(x\.on\) \? "" : "none";/);
    const bare = compile(`<on> = true\n<div>\${ lift <span><b show=@on>x</b></span> }</div>\n`);
    expect(bare.errors).toEqual([]);
    expect(bare.js).toMatch(/function (_scrml_show_\w+)\(\) \{ _scrml_lift_el_\w+\.style\.display = \(_scrml_cs_reactive_get\("on"\)\) \? "" : "none"; \}\n\s*_scrml_mount_track\(_scrml_effect\(\1, true\)\);/);
  });

  test("the swap ships in its own `ifrow` chunk: no reconciler for a list-free page", () => {
    const r = compile(`<ok> = true\n<div>\${ lift <span><b if=@ok>x</b></span> }</div>\n`);
    expect(r.runtime).toMatch(/function _scrml_ifrow_apply\(/);
    expect(r.runtime).not.toMatch(/function _scrml_reconcile_list\(/);
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
  test("lifted `show=` is a display toggle, not a plain attribute", () => {
    const r = compile(`<on> = true\n<xs> = [1]\n<div>\${ for (x of @xs) { lift <span><b show=@on>x</b></span> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).not.toMatch(/setAttribute\("show"/);
    expect(r.js).toMatch(/style\.display = \(_scrml_cs_reactive_get\("on"\)\) \? "" : "none";/);
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

describe("S469 round 6 — the if-lift arm helper is owner-scoped only where it can own something", () => {
  test("an arm with no list / owner-tracked content: main's helper, byte for byte (no scope code)", () => {
    const r = compile(`<show> = true\n<n> = 1\n<div>\${ if (@show) { lift <p>\${@n}</p> } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/function _scrml_lift_arm_run\(/);
    expect(r.js).not.toMatch(/_scrml_arm_sid|_scrml_scope_open/);
  });
  test("an arm over a list: the scoped helper, its tree calls typeof-guarded", () => {
    const r = compile(`<show> = true\n<sel> = 0\n<items> = [{ id: 1 }]\n<div>\${ if (@show) { for (r of @items) { lift <div><b if=(@sel == r.id)>E</b></div> } } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/if \(typeof _scrml_scope_open === "function" && typeof _scrml_mount_owner === "function"\) \{ sid = _scrml_scope_open\("as", _scrml_mount_owner\(host\)\);/);
  });
  test("a lift that escapes its row (a while in a row) keeps main's plain subscriptions", () => {
    const r = compile(`<ok> = true\n<rows> = [{ id: 1 }]\n<div>\${ for (row of @rows) { let i = 0\n while (i < 1) { lift <b if=@ok>S</b>\n i = i + 1 } } }</div>\n`);
    expect(r.errors).toEqual([]);
    expect(r.js).toMatch(/\n\s*_scrml_cs_reactive_subscribe\("ok", _scrml_if_\w+\);/);
    expect(r.js).not.toMatch(/_scrml_mount_track\(_scrml_cs_reactive_subscribe\("ok"/);
  });
});
