/**
 * g-if-attr-per-field-synth-cell-crashes-boot (S372) — an `if=`/`show=` toggle
 * bound to a §55 synth-surface cell must resolve the FLAT synth cell, not
 * root-get-then-navigate.
 *
 * THE DEFECT, in two limbs, both at exit 0 with zero diagnostics:
 *
 *   LIMB A — PER-FIELD, three-level (`if=@signup.name.touched`). The compound
 *   parent is a §6.3 Variant C NAMESPACE: its runtime value object is
 *   `{ name: null }` (the field's value lives in the flat cell `signup.name`).
 *   So `_scrml_reactive_get("signup").name.touched` DEREFERENCES NULL. The
 *   TypeError lands inside `_scrml_nav_rewire` under `_scrml_boot`, so it does
 *   not merely break this element — EVERY `${…}` interpolation on the page
 *   never wires. A dead page.
 *
 *   LIMB B — COMPOUND-LEVEL, two-level (`if=@signup.isValid`, `.touched`,
 *   `.errors`, `.submitted`). The same value object carries only field keys, so
 *   the member read is permanently `undefined`. Falsy, NO THROW, boot survives
 *   — and the gated subtree NEVER MOUNTS however the cell moves. SILENT-wrong.
 *
 * ⚑ WHY THIS FILE EXECUTES THE SHIPPED CHUNK. It loads `result.runtimeFilename`
 * — the PRUNED per-app `scrml-runtime.<hash>.js` the browser actually gets — and
 * NOT `SCRML_RUNTIME` from runtime-template.js. The full template defines
 * everything the pruned chunk omits and therefore masks this whole defect class
 * (primary.map.md invariant 67).
 *
 * ⚑ WHY "NO THROW" IS NOT THE DETECTOR. happy-dom SWALLOWS an exception thrown
 * inside a listener, and boot runs inside a `DOMContentLoaded` listener, so a
 * harness that wraps `dispatchEvent` in try/catch reports "no throw" for the
 * broken case. Limb A's detector is the sibling CONTROL INTERPOLATION: boot
 * completed ⇒ `#ctl` reads "true"; boot died ⇒ `#ctl` stays empty. Limb B's
 * detector is different again — boot survives it, so the only observable is
 * whether driving the cell TRUE actually MOUNTS the gated subtree.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const TMP_ROOT = resolve("/tmp", "scrml-if-attr-synth-toggle");

/**
 * A fresh document per test. Every mount registers its own `DOMContentLoaded`
 * boot listener; without this, a prior test's listener re-fires against the new
 * DOM and the reading is not the one this test set up.
 */
beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

/**
 * The fixture. One compound with one validated field, the gated element under
 * test, and the CONTROL interpolation that reports whether boot survived.
 *
 * Built by join(), not a template literal — the source contains a scrml `${…}`
 * interpolation, which a JS template literal would try to evaluate.
 */
// ⚑ THE FIELD DECLARATION FORM IS A TEST AXIS, NOT A DETAIL. Two review rounds
// concluded "base is a dead page here" from the markup-typed form alone and were
// wrong: the two forms give the compound DIFFERENT runtime values, so a 3-level
// read crashes under one and is merely `undefined` under the other.
//
//   markup-typed  <name req length(>=2)> = <input type="text"/>   -> {name: null}
//   literal-init  <name req length(>=2)> = ""                     -> {name: ""}
//
// WHEN A FIXTURE HAS A DECLARATION FORM, VARY THE DECLARATION FORM.
const FIELD_DECLS = {
  "markup-typed": '    <name req length(>=2)> = <input type="text"/>',
  "literal-init": '    <name req length(>=2)> = ""',
};

function fixture(gatedAttr, declForm = "markup-typed") {
  return [
    "<program>",
    "",
    "<flag> = true",
    "",
    "<signup>",
    FIELD_DECLS[declForm],
    "</>",
    "",
    "<span " + gatedAttr + ">GATED</span>",
    '<p id="ctl">${@flag}</p>',
    "",
    "</program>",
    "",
  ].join("\n");
}

function compileFixture(gatedAttr, declForm) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(TMP_ROOT, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const input = resolve(tmpDir, "iftoggle.scrml");
  writeFileSync(input, fixture(gatedAttr, declForm));
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
  const clientPath = resolve(outDir, "iftoggle.client.js");
  // THE SHIPPED CHUNK — see the header. Never runtime-template.js.
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  const htmlPath = resolve(outDir, "iftoggle.html");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

const bodyOf = (html) => (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1];

/**
 * Compile, mount the shipped pair, boot, and return the observables.
 *
 * `consoleErrors` + a `window.error` listener are how a SWALLOWED listener
 * exception is still seen; `ctl()` is the boot-survival detector; `gated()` is
 * the correctness detector; `set()` drives a flat cell.
 */
function mount(gatedAttr, declForm) {
  const compiled = compileFixture(gatedAttr, declForm);
  expect(compiled.errors).toEqual([]);
  document.body.innerHTML = bodyOf(compiled.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");

  const reported = [];
  const origError = console.error;
  console.error = (...a) => reported.push(a.map(String).join(" "));
  window.addEventListener("error", (e) => reported.push(`window.error: ${e.message ?? e}`));

  let loadThrew = null;
  try {
    new Function(
      "window",
      "document",
      `${compiled.runtimeJs}\n` +
        captureInsideChunkScope(
          compiled.clientJs,
          "globalThis.__ifget = _scrml_reactive_get;\nglobalThis.__ifset = _scrml_reactive_set;\n",
        ),
    )(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    loadThrew = e;
  } finally {
    console.error = origError;
  }

  return {
    clientJs: compiled.clientJs,
    loadThrew,
    reported,
    ctl: () => document.getElementById("ctl")?.textContent ?? "(#ctl missing)",
    gated: () => document.body.textContent.includes("GATED"),
    hidden: () => document.querySelector("[data-scrml-bind-show]")?.style.display === "none",
    get: (k) => globalThis.__ifget(k),
    set: (k, v) => globalThis.__ifset(k, v),
  };
}

// The five rows of the S372 discriminator, plus the parenthesised spellings that
// route to the OTHER branch and were already correct — they are the positive
// controls that prove the two spellings must agree.
const BOOT_ROWS = [
  ["@flag", "plain Shape-1 cell"],
  ["@signup.name", "2-level compound FIELD (not a synth cell)"],
  ["@signup.isValid", "2-level COMPOUND-LEVEL synth"],
  ["@signup.name.touched", "3-level PER-FIELD synth"],
  ["@signup.name.isValid", "3-level PER-FIELD synth"],
];

describe("g-if-attr-per-field-synth-cell — boot survives every `if=` synth shape (LIMB A)", () => {
  for (const [cond, label] of BOOT_ROWS) {
    test(`if=${cond} — ${label}: the sibling control interpolation WIRES`, () => {
      const app = mount(`if=${cond}`);
      // The real detector. Pre-fix the 3-level rows left this "".
      expect(app.ctl()).toBe("true");
      expect(app.loadThrew).toBeNull();
      // And nothing was merely swallowed.
      expect(app.reported.filter((m) => /TypeError|ReferenceError/.test(m))).toEqual([]);
    });
  }

  test("if=@signup.name.touched emits NO root-get-then-navigate chain into the mount controller", () => {
    const app = mount("if=@signup.name.touched");
    // The crashing string, byte-for-byte. `_scrml_cs_` is the per-chunk accessor
    // wrapper; match either spelling so a chunk-namespacing change cannot mask it.
    expect(app.clientJs).not.toMatch(/_scrml_(?:cs_)?reactive_get\("signup"\)\.name\.touched/);
    // What it must emit instead: the flat key the artifact already declares.
    expect(app.clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("signup\.name\.touched"\)/);
  });

  test("the flat synth key the toggle now reads is one the artifact actually DECLARES", () => {
    // Guards against 'fixing' the crash by inventing a key nothing registers —
    // which would be silently-false rather than crashing, i.e. limb B again.
    const app = mount("if=@signup.name.touched");
    expect(app.clientJs).toMatch(/_scrml_(?:cs_)?reactive_set\("signup\.name\.touched"/);
    expect(app.get("signup.name.touched")).toBe(false);
  });
});

describe("g-if-attr-per-field-synth-cell — the gated subtree actually MOUNTS (LIMB B)", () => {
  // Driving the flat cell is the only detector that separates "correct" from
  // "permanently undefined": at boot BOTH read falsy, so a boot-time assertion
  // cannot tell them apart.
  const DRIVE_ROWS = [
    ["@signup.name.touched", "signup.name.touched", "3-level PER-FIELD synth (limb A shape)"],
    ["@signup.submitted", "signup.submitted", "2-level COMPOUND-LEVEL synth (limb B shape)"],
  ];

  for (const [cond, key, label] of DRIVE_ROWS) {
    test(`if=${cond} — ${label}: false at boot, MOUNTS when the cell flips true`, () => {
      const app = mount(`if=${cond}`);
      expect(app.ctl()).toBe("true");
      expect(app.gated()).toBe(false);
      app.set(key, true);
      // Pre-fix this stayed false: undefined is falsy forever.
      expect(app.gated()).toBe(true);
      app.set(key, false);
      expect(app.gated()).toBe(false);
    });

    test(`if=(${cond}) — the PARENTHESISED spelling agrees with the bare one`, () => {
      // The two spellings route to different branches of
      // computeDisplayToggleCondition. They are the same predicate and must
      // produce the same page; this pins that they do.
      const app = mount(`if=(${cond})`);
      expect(app.ctl()).toBe("true");
      expect(app.gated()).toBe(false);
      app.set(key, true);
      expect(app.gated()).toBe(true);
    });
  }
});

describe("g-if-attr-per-field-synth-cell — the OBJECT-MAP rows must NOT collapse (S372 review finding 1)", () => {
  // ⚑ THIS IS THE ROW THE FIRST ROUND OF THIS FILE COULD NOT SEE, AND IT COST A
  // REVIEW ROUND. The suite drove only `submitted` and `name.touched` — the two
  // rows that genuinely ARE booleans — so nothing observed what the compound
  // ROLLUPS evaluate to once collapsed.
  //
  // §55's compound-level `errors` and `touched` are OBJECT MAPS keyed by field
  // name:
  //
  //   _scrml_derived_declare("signup.errors",  () => ({ name: get("signup.name.errors") }));
  //   _scrml_derived_declare("signup.touched", () => ({ name: get("signup.name.touched") }));
  //
  // An object literal is ALWAYS TRUTHY, so collapsing these turns a gate that
  // read `undefined` (never mounts) into one that is unconditionally true — a
  // PRISTINE, UNTOUCHED FORM RENDERS ITS ERROR BLOCK AT BOOT. Measured:
  // base `mount@boot=false`, naive-collapse `mount@boot=true`.
  //
  // The cell shape is NOT the bug (PRIMER §13.7 B11 records the object map as
  // intentional per §55; §6.11's `boolean`/`string[]` table is a known prose
  // drift for a separate amendment). Truthiness over a rollup map is simply
  // MEANINGLESS, and which of {always-true, never-true, diagnose} is right is an
  // OPEN OPERATOR RULING. So these two rows stay byte-identical to main, and
  // THIS is the test that makes that observable.
  const ALWAYS_TRUTHY = [
    ["@signup.touched", "touched", "signup.name.touched", true, "compound rollup MAP"],
    ["@signup.errors", "errors", "signup.name", "Alice", "compound rollup MAP"],
  ];

  for (const [cond, leaf, driveKey, driveVal, kind] of ALWAYS_TRUTHY) {
    test(`if=${cond} — ${kind}: does not mount at boot, and driving the underlying field does not change that`, () => {
      const app = mount(`if=${cond}`);
      expect(app.ctl()).toBe("true");
      // The BASE lowering, asserted on purpose. Collapsing here is a regression.
      expect(app.clientJs).toMatch(new RegExp(`_scrml_(?:cs_)?reactive_get\\("signup"\\)\\.${leaf}`));
      expect(app.clientJs).not.toMatch(new RegExp(`_scrml_(?:cs_)?reactive_get\\("signup\\.${leaf}"\\)`));

      // A pristine form must not render the gated block.
      expect(app.gated()).toBe(false);
      // And it stays that way when the underlying per-field cell moves — the
      // member read on the compound VALUE is `undefined` either way. This is the
      // pre-existing behaviour, preserved verbatim.
      app.set(driveKey, driveVal);
      expect(app.gated()).toBe(false);
    });
  }

  // ⚑ PER-FIELD `errors` IS AN ARRAY — `[]` IS AS TRUTHY AS `{}`. It is in this
  // table because of a METHOD ERROR, and the LITERAL-INIT form is the fixture
  // that exposes it. Under markup-typed the base lowering crashes, which two
  // rounds read as "no working behaviour to preserve"; under literal-init the
  // base is ALIVE and CORRECT, and collapsing would ship a permanently-visible
  // error block. Fatal->wrong on one declaration form does not license
  // correct->wrong on another.
  test("if=@signup.name.errors on a LITERAL-INIT field — base is ALIVE and CORRECT, and stays that way", () => {
    const app = mount("if=@signup.name.errors", "literal-init");
    // Boot survives on this declaration form — no 3-level null deref.
    expect(app.ctl()).toBe("true");
    expect(app.reported.filter((m) => /TypeError/.test(m))).toEqual([]);
    // Base lowering preserved.
    expect(app.clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("signup"\)\.name\.errors/);
    expect(app.clientJs).not.toMatch(/_scrml_(?:cs_)?reactive_get\("signup\.name\.errors"\)/);
    // THE POINT: a pristine form must not show its error block. Collapsing made
    // this `true` and unfalsifiable.
    expect(app.gated()).toBe(false);
    app.set("signup.name", "Alice");
    expect(app.gated()).toBe(false);
  });

  // ⚑ NAMED RESIDUAL, NOT A SILENT OMISSION. The same read on a MARKUP-TYPED
  // field is still a dead page, exactly as on main — an open limb of the filed
  // HIGH, carried under the same operator ruling. Pinned so that whoever rules
  // on it can see the cost, and so it cannot be mistaken for fixed.
  test("RESIDUAL (open): if=@signup.name.errors on a MARKUP-TYPED field is still a dead page, as on main", () => {
    const app = mount("if=@signup.name.errors", "markup-typed");
    expect(app.clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("signup"\)\.name\.errors/);
    // Boot DIES here. This assertion documents an OPEN defect; when the ruling
    // lands and this limb is closed, this test flips to expect "true".
    expect(app.ctl()).toBe("");
  });
});

describe("g-if-attr-per-field-synth-cell — a tail must land on a SCALAR (S372 round-4 finding 1)", () => {
  // ⚑ THE FIXTURE HERE IS A PRISTINE, FULLY-VALID FORM — no validators at all,
  // so every synth cell is in its "nothing wrong" state and a CORRECT gate is
  // false. That is what makes an always-true gate visible.
  const VALID_FORM = [
    "<program>",
    "",
    "<flag> = true",
    "",
    "<signup>",
    '    <name> = ""',
    "</>",
    "",
    "<span if=@signup.errors.name>GATED</span>",
    '<p id="ctl">${@flag}</p>',
    "",
    "</program>",
    "",
  ].join("\n");

  test("if=@signup.errors.name does NOT mount on a pristine valid form", () => {
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const outDir = resolve(TMP_ROOT, `tailscalar-${uniq}`);
    mkdirSync(outDir, { recursive: true });
    const input = resolve(outDir, "tail.scrml");
    writeFileSync(input, VALID_FORM);
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(outDir, "out"), log: () => {} });
    expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    const clientJs = readFileSync(resolve(outDir, "out", "tail.client.js"), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, "out", result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const html = readFileSync(resolve(outDir, "out", "tail.html"), "utf8");

    // The `errors` rollup maps each field to an ARRAY, so this read is `[]` —
    // truthy. Collapsing it ships a gate that can never be false.
    expect(clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("signup"\)\.errors\.name/);
    expect(clientJs).not.toMatch(/_scrml_(?:cs_)?reactive_get\("signup\.errors"\)\.name/);

    document.body.innerHTML = bodyOf(html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    try {
      new Function("window", "document", `${runtimeJs}\n${clientJs}`)(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } catch { /* base lowering is a dead page here — see the residual note */ }

    // THE POINT: the gated element must NOT be showing on a valid form.
    expect(document.body.textContent.includes("GATED")).toBe(false);
  });
});

describe("g-if-attr-per-field-synth-cell — a NESTED COMPOUND tail is not a field (S372 round-5 finding 1)", () => {
  // The compound-level `errors` rollup keys only `fieldChildren`, which EXCLUDES
  // compound-typed children — so `get("signup.errors").addr` is `undefined`, a
  // correct false gate. But `collectSynthCellKeys` DOES register
  // `signup.addr.errors` (a nested compound gets its own surface), so the
  // one-term "is this a field key" test mistook `addr` for a field, declined,
  // and fell back to `get("signup").errors.addr` -> `undefined.addr` ->
  // TypeError in `_scrml_boot` -> every interpolation on the page unwired.
  //
  // Inert vs base (base emits the identical chain — verified), but a fixable
  // dead page. `submitted` is compound-only (§55.7) and is the discriminator.
  const NESTED = [
    "<program>",
    "",
    "<flag> = true",
    "",
    "<signup>",
    "    <addr>",
    '        <city req length(>=2)> = ""',
    "    </>",
    '    <name req length(>=2)> = ""',
    "</>",
    "",
    "<span if=@signup.errors.addr>GATED</span>",
    '<p id="ctl">${@flag}</p>',
    "",
    "</program>",
    "",
  ].join("\n");

  test("if=@signup.errors.addr collapses, BOOT SURVIVES, and the gate is correctly false", () => {
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const outDir = resolve(TMP_ROOT, `nested-${uniq}`);
    mkdirSync(outDir, { recursive: true });
    const input = resolve(outDir, "nested.scrml");
    writeFileSync(input, NESTED);
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(outDir, "out"), log: () => {} });
    expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    const clientJs = readFileSync(resolve(outDir, "out", "nested.client.js"), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, "out", result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const html = readFileSync(resolve(outDir, "out", "nested.html"), "utf8");

    expect(clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("signup\.errors"\)\.addr/);
    expect(clientJs).not.toMatch(/_scrml_(?:cs_)?reactive_get\("signup"\)\.errors\.addr/);

    document.body.innerHTML = bodyOf(html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    const reported = [];
    const origError = console.error;
    console.error = (...a) => reported.push(a.map(String).join(" "));
    try {
      new Function("window", "document", `${runtimeJs}\n${clientJs}`)(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } finally {
      console.error = origError;
    }

    // THE detector: base died here, so every interpolation stayed unwired.
    expect(document.getElementById("ctl")?.textContent).toBe("true");
    expect(reported.filter((m) => /TypeError/.test(m))).toEqual([]);
    // And the gate is correctly false — `addr` is not a key of the rollup.
    expect(document.body.textContent.includes("GATED")).toBe(false);
  });
});

describe("g-if-attr-per-field-synth-cell — a TAIL-BEARING rollup read must collapse (S372 round-3 finding 2)", () => {
  // The truthiness objection applies to the BARE read only. With a tail,
  // `get("signup.errors").length` is a correct, non-truthy-forever gate — and
  // the base lowering it would otherwise fall back to is
  // `get("signup").errors.length`, i.e. `undefined.length`, which THROWS inside
  // `_scrml_boot` and unwires every interpolation on the page.
  //
  // The first cut of the shape gate inspected only the leaf name and ignored the
  // tail, so it declined these and shipped the dead page. Measured on base AND
  // on that cut: `ctl=""`, TypeError, on BOTH declaration forms.
  const TAIL_BEARING = [
    ["@signup.errors.length", "signup.errors", ".length"],
    ["@signup.touched.name", "signup.touched", ".name"],
    ["@signup.name.errors.length", "signup.name.errors", ".length"],
  ];

  for (const [cond, key, tail] of TAIL_BEARING) {
    for (const declForm of ["markup-typed", "literal-init"]) {
      test(`if=${cond} (${declForm}) collapses and BOOT SURVIVES`, () => {
        const app = mount(`if=${cond}`, declForm);
        expect(app.clientJs).toContain(`reactive_get("${key}")${tail}`);
        // The detector that matters: base killed the page here.
        expect(app.ctl()).toBe("true");
        expect(app.reported.filter((m) => /TypeError/.test(m))).toEqual([]);
      });
    }
  }
});

describe("g-if-attr-per-field-synth-cell — `show=` shares the lowering", () => {
  // show= records the SAME varName+dotPath binding at emit-html.ts:3160 and
  // reaches the SAME decision site, so it carried both limbs too.
  test("show=@signup.name.touched: boot survives and the element un-hides when the cell flips", () => {
    const app = mount("show=@signup.name.touched");
    expect(app.ctl()).toBe("true");
    expect(app.reported.filter((m) => /TypeError/.test(m))).toEqual([]);
    expect(app.hidden()).toBe(true);
    app.set("signup.name.touched", true);
    expect(app.hidden()).toBe(false);
  });
});

describe("g-if-attr-per-field-synth-cell — the SHIPPED flagship example was carrying limb B live", () => {
  // The corpus emit differential (scripts/corpus-emit-differential.ts) changed
  // exactly ONE artifact of 7388 across 1906 sources, and it was this file:
  //
  //   -  if ((_scrml_cs_reactive_get("signup").submitted))
  //   +  if ((_scrml_cs_reactive_get("signup.submitted")))
  //
  // That is line 136 of the canonical validated-form example —
  // `<p ... if=@signup.submitted>Account created.</p>` — whose own comment says
  // it "Reads the auto-synthesized @signup.submitted flag — true after the
  // [submit]". It did not. The success confirmation on the flagship form example
  // never rendered, in every build, at exit 0 with zero diagnostics.
  //
  // Measured on the corpus file itself, not a fixture: base b0abcbc6 -> false
  // after submit; fixed -> true.
  const FLAGSHIP = new URL("../../../examples/30-validated-form.scrml", import.meta.url).pathname;

  test('examples/30-validated-form.scrml renders "Account created." once @signup.submitted flips', () => {
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const outDir = resolve(TMP_ROOT, `flagship-${uniq}`);
    mkdirSync(outDir, { recursive: true });
    const result = compileScrml({ inputFiles: [FLAGSHIP], write: true, outputDir: outDir, log: () => {} });
    expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);

    const clientJs = readFileSync(resolve(outDir, "30-validated-form.client.js"), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const html = readFileSync(resolve(outDir, "30-validated-form.html"), "utf8");

    // The lowering, pinned on the corpus file.
    expect(clientJs).not.toMatch(/_scrml_(?:cs_)?reactive_get\("signup"\)\.submitted/);
    expect(clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("signup\.submitted"\)/);

    document.body.innerHTML = bodyOf(html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, "globalThis.__ifset = _scrml_reactive_set;\n"),
    )(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

    const shown = () => document.body.textContent.includes("Account created.");
    expect(shown()).toBe(false);
    globalThis.__ifset("signup.submitted", true);
    expect(shown()).toBe(true);
  });
});

describe("g-if-attr-per-field-synth-cell — the over-fire guard still holds", () => {
  // S140: the `synthCellKeys` membership test is what stops a PLAIN cell whose
  // value carries a field named like a synth property from being mis-routed to
  // an unregistered dotted key. Narrowing that guard would break this.
  const PLAIN_SRC = [
    "<program>",
    "",
    "<flag> = true",
    '<config> = { errors: ["boom"] }',
    "",
    "<span if=@config.errors>GATED</span>",
    '<p id="ctl">${@flag}</p>',
    "",
    "</program>",
    "",
  ].join("\n");

  test("a PLAIN cell with a field literally named `errors` stays MEMBER ACCESS on the value", () => {
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const tmpDir = resolve(TMP_ROOT, `plain-${uniq}`);
    const outDir = resolve(tmpDir, "out");
    mkdirSync(tmpDir, { recursive: true });
    const input = resolve(tmpDir, "plain.scrml");
    writeFileSync(input, PLAIN_SRC);
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const clientJs = readFileSync(resolve(outDir, "plain.client.js"), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const html = readFileSync(resolve(outDir, "plain.html"), "utf8");

    // `config.errors` is NOT a registered synth cell, so the collapse must
    // DECLINE and the member read must survive verbatim.
    expect(clientJs).toMatch(/_scrml_(?:cs_)?reactive_get\("config"\)\.errors/);
    expect(clientJs).not.toMatch(/_scrml_(?:cs_)?reactive_get\("config\.errors"\)/);

    // And it must still work: the array is non-empty ⇒ truthy ⇒ mounted.
    document.body.innerHTML = bodyOf(html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    new Function("window", "document", `${runtimeJs}\n${clientJs}`)(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    expect(document.getElementById("ctl")?.textContent).toBe("true");
    expect(document.body.textContent.includes("GATED")).toBe(true);
  });
});
