/**
 * Bug 58 (S140) — formFor validity-surface emission regression lock.
 *
 * §41.14.2 / §41.14.3 / §41.14.10 + §55.5-§55.7. The flagship `<formFor>` form
 * rendered its inputs (markup half) but the ENTIRE §55 validity surface was
 * silently dead: the synthesized compound state-decl was spliced into the
 * MARKUP-children array, so it never reached collectTopLevelLogicStatements →
 * emit-logic → the validity-surface emission pass. Result: validators never
 * wired, `signup.isValid` / per-field `.errors` / `.touched` / `.submitted`
 * never declared (only READ by the disabled-button gate + error anchors), and
 * onsubmit invoked with NO `values` + `submitted` never set.
 *
 * This test is the EMIT-REGRESSION half of the Bug-58 acceptance gate (the
 * happy-dom runtime-drive half lives in
 * compiler/tests/browser/browser-form-for-validity-bug-58.test.js). It asserts
 * the compiled client.js DECLARES the compound cell + validator runners + the
 * full validity surface, and that the onsubmit emit passes `values` + sets
 * `submitted`. It is structural (named-helper presence), not char-by-char.
 *
 * FAILS pre-fix (validity surface dead); PASSES post-fix.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "conf-form-for-bug58-"));
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

// Canonical §41.14 flagship example (the `import { formFor }` is load-bearing —
// without it the element isn't recognized and a DIFFERENT, wrong path fires).
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

describe("Bug 58 — formFor validity surface IS emitted into client.js", () => {
  let result;
  let html;
  let clientJs;

  beforeAll(() => {
    result = compile("bug58-formfor.scrml", CANONICAL_SRC);
    const out = getOutput(result);
    html = out?.html ?? "";
    clientJs = foldChunkNamespacing(out?.clientJs ?? "");
  });

  // ---- routing fix: the compound cell + per-field cells are DECLARED ----

  test("compiles cleanly — no E-FORMFOR-* errors", () => {
    const errs = (result.errors || []).filter(e => e && e.severity !== "warning");
    const ffErrs = errs.filter(e => e.code && e.code.startsWith("E-FORMFOR-"));
    expect(ffErrs).toEqual([]);
  });

  test("the synth compound decl no longer orphans per-field cells (no E-DG-002/W-DG-002 for name/email/agree)", () => {
    // Pre-fix, the per-field cells sat among markup children, never consumed in
    // a logic context → the data-graph pass fired E-DG-002 / W-DG-002 ×3. Post-
    // fix they are declared in the logic pass + consumed by the validity surface.
    const allDiags = [...(result.errors || []), ...(result.warnings || [])];
    const dgOrphans = allDiags.filter(
      d => d && (d.code === "E-DG-002" || d.code === "W-DG-002")
        && /`@?(name|email|agree)`/.test(d.message || ""),
    );
    expect(dgOrphans).toEqual([]);
  });

  test("client.js DECLARES per-field cells (signup.name/email/agree) — not just READS them", () => {
    // The bug signature: the markup half READS signup.name etc. via
    // _scrml_reactive_get, but NOTHING declared/seeded them. Post-fix the
    // logic pass seeds each per-field cell.
    expect(clientJs).toMatch(/_scrml_reactive_set\("signup\.name"/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("signup\.email"/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("signup\.agree"/);
  });

  // ---- §55 validity surface: validators + per-field errors + isValid ----

  test("struct validators (req/length/pattern) are wired via validator runners", () => {
    // Pre-fix _scrml_validator_fire count was 0 (validators never ran).
    expect(clientJs).toContain("_scrml_validator_fire");
    expect(clientJs).toMatch(/_scrml_validator_fire\("req"/);
    expect(clientJs).toMatch(/_scrml_validator_fire\("length"/);
    expect(clientJs).toMatch(/_scrml_validator_fire\("pattern"/);
  });

  test("per-field .errors derived cells are DECLARED (not just read by error anchors)", () => {
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.name\.errors"/);
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.email\.errors"/);
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.agree\.errors"/);
  });

  test("per-field + compound .isValid derived cells are DECLARED", () => {
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.name\.isValid"/);
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.isValid"/);
  });

  test("compound rollup cells (.errors / .touched) are DECLARED", () => {
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.errors"/);
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup\.touched"/);
  });

  test("the compound proxy cell `signup` is DECLARED (the disabled gate reads it)", () => {
    // The disabled-button gate reads `_scrml_reactive_get("signup").isValid`.
    // Pre-fix nothing declared `signup`; post-fix the compound proxy is declared.
    expect(clientJs).toMatch(/_scrml_derived_declare\("signup"/);
  });

  // ---- §41.14.3 submit wiring: set submitted=true + pass values ----

  test("submitted flag is seeded false (validity surface present)", () => {
    expect(clientJs).toMatch(/_scrml_reactive_set\("signup\.submitted", false\)/);
  });

  test("onsubmit handler sets @signup.submitted = true BEFORE invoking the handler (§41.14.3)", () => {
    // The emitted submit-handler body must set submitted true ahead of the call.
    expect(clientJs).toMatch(
      /function\(event\) \{ event\.preventDefault\(\); _scrml_reactive_set\("signup\.submitted", true\);/,
    );
  });

  test("onsubmit handler invokes the handler with the collected values (§41.14.3)", () => {
    // The handler (server-fn → _scrml_fetch_* wrapper) must receive the compound
    // cell value as `values`. Pre-fix it was invoked with no args.
    expect(clientJs).toMatch(/_scrml_fetch_persistSignup_\d+\(_scrml_reactive_get\("signup"\)\)/);
  });

  // ---- markup half STILL renders (routing change is non-destructive) ----

  test("markup half still renders: <form>, per-field inputs, errors anchors, submit button", () => {
    expect(html).toContain(`data-scrml-formfor="Signup"`);
    expect(html).toContain(`data-scrml-formfor-field="name"`);
    expect(html).toContain(`data-scrml-formfor-field="email"`);
    expect(html).toContain(`data-scrml-formfor-field="agree"`);
    expect(html).toContain(`data-scrml-bind-value`);
    expect(html).toContain(`data-scrml-bind-checked`);
    expect((html.match(/data-scrml-errors-anchor=/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(`data-scrml-formfor-submit="signup"`);
    expect(html).toMatch(/<button type="submit"/);
  });
});
