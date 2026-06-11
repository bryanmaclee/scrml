/**
 * engine-effect-not-interpolated.test.js — S182 engine `effect=` diagnostics.
 *
 * Fix 1 — E-ENGINE-EFFECT-NOT-INTERPOLATED (Error, §51.0.B / §51.0.H):
 *   `effect=` (engine opener §51.0.H Form 3 AND state-child Form 1) is a §7
 *   logic-context block, so the `${...}` form is REQUIRED. A bare value
 *   (`effect=load()`) — the single-expression handler sugar that `onclick=`
 *   permits (§5.2.3) — was previously captured as null and SILENTLY tree-
 *   shaken (the effect never ran). Option B (S182 user ruling): reject with a
 *   hard error. The canonical `effect=${...}` form must still emit.
 *
 * Fix 2 — E-ENGINE-VAR-DUPLICATE / E-ENGINE-003 mutual exclusivity (§51.0.C):
 *   a duplicate engine var previously fired BOTH codes. They are now mutually
 *   exclusive: the canonical `<engine>` form yields E-ENGINE-VAR-DUPLICATE
 *   only; the legacy `<machine>` form yields E-ENGINE-003 only. Exactly one
 *   duplicate code per declaration, per form.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import fs from "fs";
import path from "path";
import os from "os";

function compileSrcToTmp(src, basename = "engine-effect-test") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eng-eff-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    const result = compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
    });
    return {
      result,
      client: fs.existsSync(path.join(tmpDir, `${basename}.client.js`))
        ? fs.readFileSync(path.join(tmpDir, `${basename}.client.js`), "utf-8")
        : null,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// E-ENGINE-EFFECT-NOT-INTERPOLATED is severity:error → result.errors stream.
function errorCodes(result) {
  return (result.errors ?? []).map((e) => e.code);
}

describe("S182 Fix 1 — E-ENGINE-EFFECT-NOT-INTERPOLATED (opener / Form 3)", () => {
  test("bare opener effect=load() → E-ENGINE-EFFECT-NOT-INTERPOLATED (Error)", () => {
    const src = `type Phase:enum = { Loading, Done }

function load() {
  log("loading")
}

<program>
    <engine for=Phase initial=.Loading effect=load()>
        <Loading rule=.Done : "loading">
        <Done : "done">
    </>
</program>`;
    const { result } = compileSrcToTmp(src);
    const errs = errorCodes(result);
    expect(errs).toContain("E-ENGINE-EFFECT-NOT-INTERPOLATED");
    // It lands in the Error stream (CLI exit 1), not warnings.
    const fired = (result.errors ?? []).find(
      (e) => e.code === "E-ENGINE-EFFECT-NOT-INTERPOLATED",
    );
    expect(fired).toBeDefined();
    expect(fired.severity).toBe("error");
    // The message names the offending bare slice + points at the ${} fix.
    expect(fired.message).toContain("load()");
    expect(fired.message).toContain("${");
  });

  test("bare opener with empty ${ } braces → E-ENGINE-EFFECT-NOT-INTERPOLATED", () => {
    const src = `type Phase:enum = { Loading, Done }

<program>
    <engine for=Phase initial=.Loading effect=\${ }>
        <Loading rule=.Done : "loading">
        <Done : "done">
    </>
</program>`;
    const { result } = compileSrcToTmp(src);
    expect(errorCodes(result)).toContain("E-ENGINE-EFFECT-NOT-INTERPOLATED");
  });
});

describe("S182 Fix 1 — E-ENGINE-EFFECT-NOT-INTERPOLATED (state-child / Form 1)", () => {
  test("bare state-child effect=foo() → E-ENGINE-EFFECT-NOT-INTERPOLATED (Error)", () => {
    const src = `type Phase:enum = { Small, Big }

function foo() {
  log("grow")
}

<program>
    <engine for=Phase initial=.Small>
        <Small rule=.Big effect=foo() : "small">
        <Big : "big">
    </>
</program>`;
    const { result } = compileSrcToTmp(src);
    const fired = (result.errors ?? []).find(
      (e) => e.code === "E-ENGINE-EFFECT-NOT-INTERPOLATED",
    );
    expect(fired).toBeDefined();
    expect(fired.severity).toBe("error");
    // The state-child variant cross-refs Form 1 and names the tag.
    expect(fired.message).toContain("Small");
    expect(fired.message).toContain("Form 1");
  });
});

describe("S182 Fix 1 — canonical ${...} form does NOT fire (regression)", () => {
  test("canonical opener effect=${load()} compiles + emits the boot call", () => {
    const src = `type Phase:enum = { Loading, Done }

function load() {
  log("loading")
}

<program>
    <engine for=Phase initial=.Loading effect=\${ load() }>
        <Loading rule=.Done : "loading">
        <Done : "done">
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(errorCodes(result)).not.toContain("E-ENGINE-EFFECT-NOT-INTERPOLATED");
    expect(client).not.toBeNull();
    // The §51.0.H Form 3 opener boot effect must still emit a module-init call.
    expect(client).toContain("opener effect=");
    expect(client).toContain("_scrml_load");
    expect(() => new Function(client)).not.toThrow();
  });

  test("canonical state-child effect=${foo()} compiles + emits the hook call", () => {
    const src = `type Phase:enum = { Small, Big }

function foo() {
  log("grow")
}

<program>
    <engine for=Phase initial=.Small>
        <Small rule=.Big effect=\${ foo() } : "small">
        <Big : "big">
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(errorCodes(result)).not.toContain("E-ENGINE-EFFECT-NOT-INTERPOLATED");
    expect(client).not.toBeNull();
    // The state-child effect= lowers into the engine hook-firing function.
    expect(client).toContain("_scrml_foo");
    expect(() => new Function(client)).not.toThrow();
  });
});

describe("S182 Fix 2 — duplicate-engine-var mutual exclusivity", () => {
  test("duplicate <engine> var → E-ENGINE-VAR-DUPLICATE only (NOT E-ENGINE-003)", () => {
    const src = `type Light:enum = { Red, Green }

<program>
    <engine for=Light initial=.Red>
        <Red rule=.Green : "red">
        <Green rule=.Red : "green">
    </>
    <engine for=Light initial=.Green var=light>
        <Red rule=.Green : "red2">
        <Green rule=.Red : "green2">
    </>
</program>`;
    const { result } = compileSrcToTmp(src);
    const errs = errorCodes(result);
    expect(errs).toContain("E-ENGINE-VAR-DUPLICATE");
    expect(errs).not.toContain("E-ENGINE-003");
    // Exactly one duplicate code fired.
    const dupCount = errs.filter(
      (c) => c === "E-ENGINE-VAR-DUPLICATE" || c === "E-ENGINE-003",
    ).length;
    expect(dupCount).toBe(1);
  });

  test("duplicate legacy <machine> name → E-ENGINE-003 only (NOT E-ENGINE-VAR-DUPLICATE)", () => {
    const src = `type Light:enum = { Red, Green }

<program>
    <machine name=light for=Light initial=.Red>
        <Red rule=.Green : "red">
        <Green rule=.Red : "green">
    </>
    <machine name=light for=Light initial=.Green>
        <Red rule=.Green : "red2">
        <Green rule=.Red : "green2">
    </>
</program>`;
    const { result } = compileSrcToTmp(src);
    const errs = errorCodes(result);
    expect(errs).toContain("E-ENGINE-003");
    expect(errs).not.toContain("E-ENGINE-VAR-DUPLICATE");
    const dupCount = errs.filter(
      (c) => c === "E-ENGINE-VAR-DUPLICATE" || c === "E-ENGINE-003",
    ).length;
    expect(dupCount).toBe(1);
  });
});
