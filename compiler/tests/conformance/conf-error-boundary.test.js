/**
 * errorBoundary (SPEC §19.6 + §19.6.8) — emission + diagnostic regression lock.
 *
 * The runtime-drive half lives in
 * compiler/tests/browser/browser-error-boundary.test.js. THIS file asserts the
 * COMPILE-TIME contract:
 *   - the boundary's `!`-call no longer fires E-ERROR-002 (§19.4.3 item 4 —
 *     the boundary contains it; the canonical §19.6 example now COMPILES);
 *   - the emitted client.js wires the typed `!`-error dispatch (variant renders
 *     + boundary fallback) AND the C-hybrid host-JS backstop (§19.6.8);
 *   - E-ERROR-005 (§19.6.6) fires for a variant with neither `renders` nor a
 *     boundary `fallback`, and does NOT fire when either is present;
 *   - the emitted JS is valid (the default-on parse gate, §2.2.1, would reject
 *     malformed output).
 *
 * Structural (named-helper + dispatch-shape presence), not char-by-char.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "conf-error-boundary-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function getOutput(result) {
  const entries = [...(result.outputs || new Map()).entries()];
  return entries.length > 0 ? entries[0][1] : null;
}
function codes(result) {
  return (result.errors || []).map((e) => e && e.code).filter(Boolean);
}

// Variant WITH renders + variant WITHOUT renders, boundary WITH fallback.
const RENDERS_AND_FALLBACK = `type LoadError:enum = {
    NotFound(id: string)
        renders <div class="eb-nf">Item \${id} not found</>
    Timeout
}

function loadItem(id: string)! LoadError {
    if (id == "") fail LoadError::NotFound(id)
    return id
}

<page>
    <errorBoundary fallback={<div class="eb-fb">went wrong</>}>
        \${loadItem("42")}
    </>
</page>
`;

describe("errorBoundary §19.6 — emission contract", () => {
  test("the canonical example COMPILES (boundary suppresses E-ERROR-002, §19.4.3 item 4)", () => {
    const result = compile("ok.scrml", RENDERS_AND_FALLBACK);
    expect(codes(result)).not.toContain("E-ERROR-002");
    expect(codes(result)).not.toContain("E-ERROR-005");
  });

  test("client.js wires the typed !-error dispatch + variant renders + fallback", () => {
    const out = getOutput(compile("dispatch.scrml", RENDERS_AND_FALLBACK));
    expect(out).not.toBeNull();
    const js = out.clientJs ?? "";
    // The catch+dispatch render function exists.
    expect(js).toContain("_eb_render_");
    // Typed envelope check (§19.6.3).
    expect(js).toContain("__scrml_error");
    // Variant with renders dispatches to its own markup.
    expect(js).toMatch(/case "NotFound":/);
    expect(js).toContain("eb-nf");
    // Variant without renders + the fallthrough both use the boundary fallback.
    expect(js).toContain("eb-fb");
    // Loud logging (§19.6.8 B5).
    expect(js).toContain("_scrml_error_boundary_log");
  });

  test("client.js wires the C-hybrid host-JS backstop (§19.6.8 try/catch)", () => {
    const out = getOutput(compile("backstop.scrml", RENDERS_AND_FALLBACK));
    const js = out.clientJs ?? "";
    // The render is wrapped in a host-JS try/catch; a caught throw renders the
    // fallback (NOT a scrml-source try/catch — this is emitted host-JS).
    expect(js).toMatch(/try\s*\{[\s\S]*catch\s*\(_eb_err\)/);
  });

  test("payload-field substitution is field-keyed (§51.3.2 — single-field -> .data.field)", () => {
    const out = getOutput(compile("single.scrml", RENDERS_AND_FALLBACK));
    const js = out.clientJs ?? "";
    // §51.3.2 — a payload variant stores its fields as a field-keyed object on
    // `.data`, single- AND multi-field alike (matching the enum constructor /
    // emitFailExpr / parseVariant / the `!{}` + `match` payload binders). So
    // NotFound(id) substitutes `${id}` -> `(_eb_result.data).id` (NOT bare `.data`).
    expect(js).toContain("(_eb_result.data).id");
    expect(js).not.toContain("(_eb_result.data) : \"\"");
  });
});

describe("errorBoundary §19.6.6 — E-ERROR-005 static exhaustiveness", () => {
  test("FIRES for a variant with no renders + boundary has no fallback", () => {
    const src = `type LoadError:enum = {
    NotFound(id: string)
    Timeout
}

function loadItem(id: string)! LoadError {
    if (id == "") fail LoadError::NotFound(id)
    return id
}

<page>
    <errorBoundary>
        \${loadItem("42")}
    </>
</page>
`;
    const result = compile("e005-fire.scrml", src);
    const cs = codes(result);
    expect(cs).toContain("E-ERROR-005");
    // Both unrenderable variants are reported.
    const e005 = (result.errors || []).filter((e) => e.code === "E-ERROR-005");
    expect(e005.length).toBe(2);
  });

  test("does NOT fire when the boundary has a fallback", () => {
    const src = `type LoadError:enum = {
    NotFound(id: string)
    Timeout
}

function loadItem(id: string)! LoadError {
    if (id == "") fail LoadError::NotFound(id)
    return id
}

<page>
    <errorBoundary fallback={<div>fb</>}>
        \${loadItem("42")}
    </>
</page>
`;
    expect(codes(compile("e005-fb.scrml", src))).not.toContain("E-ERROR-005");
  });

  test("does NOT fire when every variant has a renders clause (no fallback)", () => {
    const src = `type LoadError:enum = {
    NotFound(id: string)
        renders <div>nf \${id}</>
    Timeout
        renders <div>to</>
}

function loadItem(id: string)! LoadError {
    if (id == "") fail LoadError::NotFound(id)
    return id
}

<page>
    <errorBoundary>
        \${loadItem("42")}
    </>
</page>
`;
    expect(codes(compile("e005-renders.scrml", src))).not.toContain("E-ERROR-005");
  });
});
