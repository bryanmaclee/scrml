/**
 * Bug 61 (S140) — `@compound.<synthProp>` rollup read emits member-access on the
 * compound VALUE, not a dotted-key read of the synthesized cell.
 *
 * §55.5 / §55.6 / §55.7 — the auto-synthesized validity surface (isValid /
 * errors / touched / submitted) is reactive + read-only. A compound-level synth
 * read (`@form.isValid`, 2-segment) lowered to
 *   `_scrml_reactive_get("form").isValid`
 * i.e. member access on the compound VALUE object (which holds field values
 * `{name, email}` and has NO `isValid` property → `undefined`). The dotted
 * synth cell `form.isValid` IS declared (`_scrml_derived_declare("form.isValid")`)
 * but the read never reached it.
 *
 * Net adopter impact: `disabled=!@form.isValid` → `!undefined` → `true` → the
 * submit button stays disabled even when the form is valid. `node --check`
 * clean; silent-wrong. This is the READ-PATH sibling of Bug 58 (RESOLVED
 * 29c33a6c, which emits + wires the surface).
 *
 * FIX: emit-expr.ts `emitMember` recognizes a member chain rooted at
 * `@<compound>` whose LEAF property is a synthesized validity-surface property
 * (isValid / errors / touched / submitted — SYNTH_PROPERTY_NAMES from
 * symbol-table.ts) AND whose dotted runtime key IS a REGISTERED synth cell
 * (`ctx.synthCellKeys`, from collectSynthCellKeys(fileAST)) and collapses it to
 * a single dotted-key read
 *   `_scrml_reactive_get("form.isValid")`
 * `_scrml_reactive_get` is the universal accessor: it auto-delegates to
 * `_scrml_derived_get` for derived cells (isValid/errors/touched at compound
 * scope; isValid/errors per-field) AND reads `_scrml_state` directly for the
 * reactive cells (submitted at compound scope; touched per-field). A blanket
 * route to `_scrml_derived_get` would return `undefined` for `submitted` and
 * per-field `touched` (reactive cells, NOT in the derived cache) — so the
 * REACTIVE synth read `@form.submitted` MUST also route via the key set.
 *
 * OVER-FIRE GUARD (the whole point of the membership test): a naive leaf-name
 * guard over-fires on a PLAIN cell whose value carries a field named like a
 * synth prop. `<config> = { errors: ["x"] }` then `@config.errors` MUST stay
 * member access (`_scrml_reactive_get("config").errors`) because `config.errors`
 * is NOT a registered synth cell. Routing it to `_scrml_reactive_get("config.errors")`
 * would read an unregistered key → `undefined` at runtime → REGRESSION.
 *
 * NON-REGRESSION: a REAL field read (`@form.name` — leaf is NOT a synth prop)
 * MUST stay member-access on the compound proxy (`_scrml_reactive_get("form").name`),
 * because the compound value object legitimately carries the field values.
 *
 * FAILS pre-fix (member access on the value); PASSES post-fix (dotted-key read).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "conf-bug61-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function compile(filename, source) {
  const abs = fx(filename, source);
  return compileScrml({
    inputFiles: [abs],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
}

function getOutput(result) {
  const entries = [...(result.outputs || new Map()).entries()];
  return entries.length > 0 ? entries[0][1] : null;
}

// Hand-authored §55 compound (the general case — NOT formFor-specific).
// `disabled=!@form.isValid` is the compound-rollup read; the `${@form.name/}`
// slots are REAL field reads (non-regression anchors). `${@form.submitted/}`
// is a REACTIVE synth read (must route via the key set too).
const COMPOUND_SRC = `<program>
<form>
    <name req length(>=2)> = <input type="text"/>
    <email req> = <input type="email"/>
</>
<button disabled=!@form.isValid>Submit</button>
<p>\${@form.submitted}</p>
<p>\${@form.name}</p>
<p>\${@form.email}</p>
</program>
`;

describe("Bug 61 — @compound.<synthProp> rollup read collapses to a dotted-key read", () => {
  let result;
  let clientJs;

  beforeAll(() => {
    result = compile("bug61-compound.scrml", COMPOUND_SRC);
    const out = getOutput(result);
    clientJs = out?.clientJs ?? "";
  });

  test("compiles cleanly (no fatal errors)", () => {
    const errs = (result.errors || []).filter(e => e && e.severity !== "warning");
    expect(errs).toEqual([]);
  });

  // ---- the synth surface IS still declared (Bug 58 emission intact) ----

  test("the dotted compound-rollup cell form.isValid IS declared (read target exists)", () => {
    expect(clientJs).toMatch(/_scrml_derived_declare\("form\.isValid"/);
  });

  test("the reactive compound cell form.submitted IS declared (read target exists)", () => {
    expect(clientJs).toMatch(/_scrml_reactive_set\("form\.submitted", false\)/);
  });

  // ---- THE BUG: the compound-rollup READ collapses to a dotted-key read ----

  test("@form.isValid reads the dotted synth cell, NOT member-access on the value", () => {
    // Post-fix: a single dotted-key read.
    expect(clientJs).toMatch(/_scrml_reactive_get\("form\.isValid"\)/);
    // Pre-fix bug signature MUST be gone: member access on the compound value.
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("form"\)\.isValid/);
  });

  test("@form.submitted (REACTIVE synth) also collapses to a dotted-key read", () => {
    // submitted is a REACTIVE cell, not derived — the universal accessor
    // _scrml_reactive_get reads it directly. It must route via the synth-key
    // set just like the derived rollups.
    expect(clientJs).toMatch(/_scrml_reactive_get\("form\.submitted"\)/);
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("form"\)\.submitted/);
  });

  // ---- NON-REGRESSION: real field reads stay member-access on the proxy ----

  test("REAL field read @form.name is NOT over-routed to a dotted-key read", () => {
    // The compound proxy value carries the field values; member access on the
    // compound value object is the correct read shape for a real field. The
    // ${@form.name/} display slot must keep emitting member access — leaf `name`
    // is NOT a synth property, so the synth-collapse must NOT fire on it.
    // (NB: the validator runner legitimately reads the per-field VALUE cell via
    // `_scrml_reactive_get("form.name")`; that is a separate, correct read — so
    // we assert on the display-slot shape specifically, not a global absence.)
    // markup-value-in-expression-2026-06-17: the display slot routes through the
    // node-aware `_scrml_render_value(el, expr)` helper (was `el.textContent =`).
    // The load-bearing part of this test is the READ SHAPE — member access
    // `_scrml_reactive_get("form").name`, NOT a collapsed dotted-key read.
    expect(clientJs).toMatch(/_scrml_render_value\(el, _scrml_reactive_get\("form"\)\.name/);
    // The display slot must NOT have been collapsed to a dotted-key read.
    expect(clientJs).not.toMatch(/_scrml_render_value\(el, _scrml_reactive_get\("form\.name"\)/);
  });
});

// -------------------------------------------------------------------------
// OVER-FIRE GUARD — a PLAIN cell whose value carries a synth-named field must
// NOT be collapsed to a dotted-key read. This is the regression a naive
// leaf-name-only guard introduces.
// -------------------------------------------------------------------------
const PLAIN_CELL_SRC = `<program>
<config> = { errors: ["x"], submitted: false, isValid: true }
<p>\${@config.errors}</p>
<p>\${@config.submitted}</p>
<p>\${@config.isValid}</p>
</program>
`;

describe("Bug 61 OVER-FIRE — plain cell w/ synth-named fields stays member access", () => {
  let result;
  let clientJs;

  beforeAll(() => {
    result = compile("bug61-plain.scrml", PLAIN_CELL_SRC);
    const out = getOutput(result);
    clientJs = out?.clientJs ?? "";
  });

  test("compiles cleanly (no fatal errors)", () => {
    const errs = (result.errors || []).filter(e => e && e.severity !== "warning");
    expect(errs).toEqual([]);
  });

  test("config is NOT a compound — no dotted synth cells are declared for it", () => {
    // Sanity: a plain cell has no validity surface. config.errors / .isValid /
    // .submitted are NOT registered synth cells.
    expect(clientJs).not.toMatch(/_scrml_derived_declare\("config\.errors"/);
    expect(clientJs).not.toMatch(/_scrml_derived_declare\("config\.isValid"/);
    expect(clientJs).not.toMatch(/_scrml_reactive_set\("config\.submitted"/);
  });

  test("@config.errors stays member access on the value (NOT a dotted-key read)", () => {
    // The plain cell value `{ errors, submitted, isValid }` legitimately carries
    // an `errors` field. Reading it is member access on the value object.
    expect(clientJs).toMatch(/_scrml_reactive_get\("config"\)\.errors/);
    // The over-fire signature MUST be absent: an unregistered dotted key.
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("config\.errors"\)/);
  });

  test("@config.submitted / @config.isValid also stay member access", () => {
    expect(clientJs).toMatch(/_scrml_reactive_get\("config"\)\.submitted/);
    expect(clientJs).toMatch(/_scrml_reactive_get\("config"\)\.isValid/);
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("config\.submitted"\)/);
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("config\.isValid"\)/);
  });
});

// Per-field 3-segment synth read (`@form.field.isValid`) — also a synth surface
// read; must collapse to the dotted cell, while a per-field REAL value read
// stays member-access.
const PER_FIELD_SRC = `<program>
<form>
    <name req length(>=2)> = <input type="text"/>
</>
<button disabled=!@form.name.isValid>Submit</button>
<p>\${@form.name}</p>
</program>
`;

describe("Bug 61 — per-field 3-segment @compound.field.<synthProp> also collapses", () => {
  let result;
  let clientJs;

  beforeAll(() => {
    result = compile("bug61-perfield.scrml", PER_FIELD_SRC);
    const out = getOutput(result);
    clientJs = out?.clientJs ?? "";
  });

  test("compiles cleanly (no fatal errors)", () => {
    const errs = (result.errors || []).filter(e => e && e.severity !== "warning");
    expect(errs).toEqual([]);
  });

  test("@form.name.isValid reads the dotted per-field synth cell, NOT member-access", () => {
    expect(clientJs).toMatch(/_scrml_reactive_get\("form\.name\.isValid"\)/);
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("form"\)\.name\.isValid/);
  });

  test("the per-field synth cell form.name.isValid IS declared", () => {
    expect(clientJs).toMatch(/_scrml_derived_declare\("form\.name\.isValid"/);
  });
});
