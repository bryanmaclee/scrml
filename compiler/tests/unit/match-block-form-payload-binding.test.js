/**
 * match-block-form-payload-binding.test.js
 *
 * Gap 2 (payload-binding-gaps-2026-06-11 / S184 dog-food) — a `<match for=T
 * on=@x>` BLOCK-form arm binds its variant payload fields into the arm-body
 * scope (single OR multi), MIRRORING the JS-style `.V(a,b) => {}` arm and the
 * engine state-child `<V a b>` siblings (PRIMER §6.2 teaches this as working).
 *
 * Two coupled stages were broken:
 *   TYPER   — the match-block fell through the default recursion; the per-arm
 *             body markup (armBodyChildren) walked WITHOUT payload bindings ->
 *             false E-SCOPE-001 on a `${count}` arm-body interpolation.
 *   CODEGEN — the SPACE form `<Done count>` put bindings in entry.attrs, which
 *             emit-match ignored (it read only the PAREN payloadBindingsRaw) ->
 *             arm render/wire fns took no payload param + the body referenced a
 *             FREE `count` var (runtime ReferenceError).
 *
 * Coverage:
 *   §1  single-field SPACE `<Done count>` -> count binds (no E-SCOPE-001)  [repro]
 *   §2  multi-field SPACE `<Conflict field detail>` -> both bind
 *   §3  PAREN form `<Done(count)>` -> binds (sibling shape)
 *   §4  CODEGEN — space-form render/wire fns take the payload param; dispatch
 *       passes `_data["count"]`; body has NO free var; client.js node-checks
 *   §5  CODEGEN multi — both field + detail params + `_data[...]` passed
 *   §6  the existing match-002-block-form-arm-swap sample still compiles clean
 *   §7  cross-stream (S92) — E-SCOPE-001 absent from BOTH errors AND warnings
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTmpDir(label) {
  const tmp = join(tmpdir(), `scrml-gap2-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  return tmp;
}

// S92 cross-stream helper — a diagnostic may land in result.errors OR
// result.warnings depending on the severity partition; checking one stream
// silently passes if it slipped into the other.
function diagnosticsWithCode(result, code) {
  const errs = (result.errors ?? []).filter((d) => d && d.code === code);
  const warns = (result.warnings ?? []).filter((d) => d && d.code === code);
  return [...errs, ...warns];
}

function compile(label, src) {
  const tmp = makeTmpDir(label);
  const srcFile = join(tmp, "repro.scrml");
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
  return { result, tmp, outDir };
}

// ---------------------------------------------------------------------------
// §1: single-field SPACE form `<Done count>` (the reproducer)
// ---------------------------------------------------------------------------

describe("Gap 2 §1: single-field SPACE `<Done count>` binds count", () => {
  test("no E-SCOPE-001 on count; arm-body `${count}` resolves", () => {
    const { result, tmp } = compile("space-single", [
      "type R:enum = { Loading, Done(count: int) }",
      "<r>: R = .Loading",
      "<match for=R on=@r>",
      "    <Loading>",
      "        \"loading\"",
      "    </>",
      "    <Done count>",
      "        \"got ${count}\"",
      "    </>",
      "</>",
    ].join("\n"));
    expect(diagnosticsWithCode(result, "E-SCOPE-001")).toEqual([]);
    expect(result.errors).toHaveLength(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §2: multi-field SPACE form `<Conflict field detail>`
// ---------------------------------------------------------------------------

describe("Gap 2 §2: multi-field SPACE `<Conflict field detail>` binds both", () => {
  test("no E-SCOPE-001 on field or detail; both resolve in the arm body", () => {
    const { result, tmp } = compile("space-multi", [
      "type R:enum = { Idle, Conflict(field: string, detail: string) }",
      "<r>: R = .Idle",
      "<match for=R on=@r>",
      "    <Idle>",
      "        \"idle\"",
      "    </>",
      "    <Conflict field detail>",
      "        \"conflict ${field} / ${detail}\"",
      "    </>",
      "</>",
    ].join("\n"));
    expect(diagnosticsWithCode(result, "E-SCOPE-001")).toEqual([]);
    expect(result.errors).toHaveLength(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §3: PAREN form `<Done(count)>` — sibling shape, also binds
// ---------------------------------------------------------------------------

describe("Gap 2 §3: PAREN `<Done(count)>` binds count", () => {
  test("paren payloadBindingsRaw path also resolves the arm body", () => {
    const { result, tmp } = compile("paren-single", [
      "type R:enum = { Loading, Done(count: int) }",
      "<r>: R = .Loading",
      "<match for=R on=@r>",
      "    <Loading>",
      "        \"loading\"",
      "    </>",
      "    <Done(count)>",
      "        \"got ${count}\"",
      "    </>",
      "</>",
    ].join("\n"));
    expect(diagnosticsWithCode(result, "E-SCOPE-001")).toEqual([]);
    expect(result.errors).toHaveLength(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §4: CODEGEN — space-form arm fns take the payload param + dispatch passes it
// ---------------------------------------------------------------------------

describe("Gap 2 §4: CODEGEN — space-form `<Done count>` emits a bound param", () => {
  test("render/wire fns take `count`; dispatch passes _data[\"count\"]; node-checks", () => {
    const { result, tmp, outDir } = compile("codegen-single", [
      "type R:enum = { Loading, Done(count: int) }",
      "<r>: R = .Loading",
      "<match for=R on=@r>",
      "    <Loading>",
      "        \"loading\"",
      "    </>",
      "    <Done count>",
      "        \"got ${count}\"",
      "    </>",
      "</>",
    ].join("\n"));
    expect(result.errors).toHaveLength(0);

    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    // The arm wire fn takes `count` as a payload param (not a free var).
    expect(clientJs).toMatch(/_scrml_match_\w+_wire_Done\(_scrml_arm_root,\s*count\)/);
    // Dispatch threads the payload field from the matched value's data.
    expect(clientJs).toMatch(/_scrml_match_\w+_wire_Done\(_scrml_arm_mount,\s*_scrml_arm_data && _scrml_arm_data\["count"\]\)/);

    // node --check — a free `count` var (the pre-fix bug) is syntactically valid
    // but would throw at runtime; the param shape above is the real guarantee.
    const checkPath = join(outDir, "repro.client.js");
    expect(() => execFileSync("node", ["--check", checkPath])).not.toThrow();

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §5: CODEGEN multi — both field params bound + threaded
// ---------------------------------------------------------------------------

describe("Gap 2 §5: CODEGEN multi `<Conflict field detail>` — both params", () => {
  test("wire fn takes both params; dispatch threads both _data fields", () => {
    const { result, tmp, outDir } = compile("codegen-multi", [
      "type R:enum = { Idle, Conflict(field: string, detail: string) }",
      "<r>: R = .Idle",
      "<match for=R on=@r>",
      "    <Idle>",
      "        \"idle\"",
      "    </>",
      "    <Conflict field detail>",
      "        \"conflict ${field} / ${detail}\"",
      "    </>",
      "</>",
    ].join("\n"));
    expect(result.errors).toHaveLength(0);

    const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
    expect(clientJs).toMatch(/_scrml_match_\w+_wire_Conflict\(_scrml_arm_root,\s*field,\s*detail\)/);
    expect(clientJs).toMatch(/_scrml_arm_data && _scrml_arm_data\["field"\]/);
    expect(clientJs).toMatch(/_scrml_arm_data && _scrml_arm_data\["detail"\]/);

    const checkPath = join(outDir, "repro.client.js");
    expect(() => execFileSync("node", ["--check", checkPath])).not.toThrow();

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §6: existing match-block sample still compiles clean (regression anchor)
// ---------------------------------------------------------------------------

describe("Gap 2 §6: existing match-002-block-form-arm-swap sample regression", () => {
  test("the canonical block-form match sample still compiles with 0 errors", () => {
    const samplePath = join(
      __dirname, "..", "..", "..",
      "samples", "compilation-tests", "match-002-block-form-arm-swap.scrml",
    );
    expect(existsSync(samplePath)).toBe(true);
    const tmp = makeTmpDir("sample002");
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });
    const result = compileScrml({ inputFiles: [samplePath], outputDir: outDir });
    expect(diagnosticsWithCode(result, "E-SCOPE-001")).toEqual([]);
    expect(result.errors).toHaveLength(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});
