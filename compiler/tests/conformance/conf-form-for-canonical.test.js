/**
 * §41.14 (S102) — formFor canonical-example conformance lock.
 *
 * Locks the canonical example from SPEC §41.14 emits the expected Shape 2 +
 * <form> + <errors> shape. This is the FLAGSHIP demo for scrml.dev — the
 * emitted HTML + JS must remain stable as v0.3.x releases land.
 *
 * The lock is structural (presence of named data-attrs + tag shapes), not
 * char-by-char, so cosmetic JS rename + helper-name changes don't break it.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "conf-form-for-"));
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

function realErrors(result) {
  return (result.errors || []).filter(e => e && e.severity !== "warning");
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

// ---------------------------------------------------------------------------
// Canonical example from SPEC §41.14
// ---------------------------------------------------------------------------

const CANONICAL_SRC = `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string req length(>=2)
    email: string req pattern(/^[^@]+@[^@]+$/)
    agree: boolean req
  }

  server function persistSignup(values: Signup) ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`;

describe("§41.14 canonical example — flagship demo conformance", () => {
  let result;
  let html;
  let clientJs;

  beforeAll(() => {
    result = compile("canonical.scrml", CANONICAL_SRC);
    const out = getOutput(result);
    html = out?.html ?? "";
    clientJs = out?.clientJs ?? "";
  });

  test("compiles cleanly — no E-FORMFOR-* errors", () => {
    const errs = realErrors(result);
    const ffErrs = errs.filter(e => e.code && e.code.startsWith("E-FORMFOR-"));
    expect(ffErrs).toEqual([]);
  });

  test("outer <form> carries data-scrml-formfor='Signup'", () => {
    expect(html).toContain(`data-scrml-formfor="Signup"`);
  });

  test("PE-default action=/method=POST emitted for server-fn handler", () => {
    expect(html).toContain(`method="POST"`);
    expect(html).toMatch(/action="\/api\/[^"]*persistSignup[^"]*"/);
  });

  test("per-field <div data-scrml-formfor-field=> wraps each field", () => {
    expect(html).toContain(`data-scrml-formfor-field="name"`);
    expect(html).toContain(`data-scrml-formfor-field="email"`);
    expect(html).toContain(`data-scrml-formfor-field="agree"`);
  });

  test("label placeholders emitted; runtime resolves via _scrml_label_for (S108 B5)", () => {
    // S108 B5 — labels emit a `${_scrml_label_for("Signup", "field")}` interpolation
    // placeholder per SPEC §41.14.7. The runtime helper walks Level 2 (registerLabels)
    // → Level 4 (mechanical title-case) at DOMContentLoaded. Pre-B5 emitted the
    // mechanical default as a static text node; B5 routes it through the runtime
    // chain so `data.registerLabels({Signup: {name: "Full Name"}})` actually shapes
    // the rendered label.
    const labelMatches = html.match(/<label><span data-scrml-logic="_scrml_logic_\d+"><\/span><\/label>/g) ?? [];
    expect(labelMatches.length).toBe(3); // one per field (name + email + agree)
  });

  test("string fields emit <input type='text'> with bind:value wiring", () => {
    // Verify the agree field is NOT type=text (it's boolean → checkbox).
    // Use a regex anchored on the field selector to verify per-field type.
    const nameMatch = html.match(/data-scrml-formfor-field="name">.*?<input ([^/]+)\/>/);
    expect(nameMatch).not.toBeNull();
    expect(nameMatch[1]).toContain(`type="text"`);
    expect(nameMatch[1]).toContain(`data-scrml-bind-value`);
  });

  test("boolean field emits <input type='checkbox'> with bind:checked wiring", () => {
    const agreeMatch = html.match(/data-scrml-formfor-field="agree">.*?<input ([^/]+)\/>/);
    expect(agreeMatch).not.toBeNull();
    expect(agreeMatch[1]).toContain(`type="checkbox"`);
    expect(agreeMatch[1]).toContain(`data-scrml-bind-checked`);
  });

  test("each field has an <errors> anchor for per-field validation rendering", () => {
    // The <errors> first-class element emits a `data-scrml-errors-anchor` span.
    // Each of the 3 fields should get one.
    const anchors = html.match(/data-scrml-errors-anchor=/g) || [];
    expect(anchors.length).toBeGreaterThanOrEqual(3);
  });

  test("submit <button type='submit' data-scrml-formfor-submit=signup> emitted", () => {
    expect(html).toContain(`data-scrml-formfor-submit="signup"`);
    expect(html).toContain(`<button type="submit"`);
  });

  test("clientJs subscribes to signup.<field>.errors for reactive error rendering", () => {
    expect(clientJs).toContain(`signup.name.errors`);
    expect(clientJs).toContain(`signup.email.errors`);
    expect(clientJs).toContain(`signup.agree.errors`);
  });

  test("clientJs wires bind:value reactive subscription for each field", () => {
    // The emit-bindings.ts produces _scrml_reactive_get("signup").<field> +
    // _scrml_reactive_set("signup", ...) per field.
    expect(clientJs).toContain(`signup`);
    expect(clientJs).toContain(`_scrml_reactive_set`);
  });

  test("clientJs wires server-fn submit handler", () => {
    // _scrml_fetch_persistSignup_N(...) — the server-fn proxy.
    expect(clientJs).toMatch(/_scrml_fetch_persistSignup/);
  });
});
