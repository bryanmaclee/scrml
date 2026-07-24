/**
 * Lifecycle Landing 1 — pipeline integration test for E-TYPE-001 access-before-transition fire
 *
 * Landing 1 wired `runLifecycleAccessCheck` into `processFile` (type-system.ts).
 * This test compiles real scrml source files end-to-end and asserts that the
 * E-TYPE-001 diagnostic fires per SPEC §14.3 line 7106 when a lifecycle-
 * annotated field is read before its transition.
 *
 * Unit-level coverage (test surface for the checker function itself) lives at
 * `compiler/tests/unit/type-system-lifecycle.test.js`. This file is the
 * complementary end-to-end verification.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lifecycle-access-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/**
 * Compile a single scrml source file and return its diagnostic stream.
 */
function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: false,
    log: () => {},
  });
  // Per S93 diagnostic-stream partition: error-severity → result.errors,
  // warning/info → result.warnings. Lifecycle E-TYPE-001 is error-severity
  // (an actual type violation, not a warning).
  return {
    errors: result.errors || [],
    warnings: result.warnings || [],
  };
}

describe("Lifecycle Landing 1 — E-TYPE-001 access-before-transition pipeline fire", () => {
  test("SPEC §14.3 worked example — accessing (not -> string) field pre-transition fires E-TYPE-001", () => {
    // The canonical SPEC §14.3 worked example pattern.
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not -> string)
  }

  function boot() {
    let u = < User name="alice">
    log(u.passwordHash)
  }
}

<program></program>`;
    const { errors } = compileSource("lifecycle-pre-transition", src);
    const lifecycleFires = errors.filter(e => e.code === "E-TYPE-001");
    expect(lifecycleFires.length).toBeGreaterThanOrEqual(1);
    // The diagnostic message names the field, the type, and the SPEC anchor.
    const fire = lifecycleFires[0];
    expect(fire.message).toMatch(/passwordHash/);
    expect(fire.message).toMatch(/User/);
    expect(fire.message).toMatch(/SPEC §14\.3/);
  });

  test("post-transition access does NOT fire E-TYPE-001", () => {
    // Same struct, but assign BEFORE read — the transition happens before
    // the access, so no E-TYPE-001 should fire.
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not -> string)
  }

  function boot() {
    let u = < User name="alice">
    u.passwordHash = "deadbeef"
    log(u.passwordHash)
  }
}

<program></program>`;
    const { errors } = compileSource("lifecycle-post-transition", src);
    // No E-TYPE-001 lifecycle fires expected. (Other E-TYPE-001 fires from
    // the §14.11 positional-arity checker in codegen are not in this fixture,
    // so any E-TYPE-001 we see HERE would be the lifecycle one.)
    const lifecycleFires = errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBe(0);
  });

  test("non-lifecycle field access — never fires E-TYPE-001 even pre-construction", () => {
    // Field `name` is plain `string` (no lifecycle annotation).
    // Reading it doesn't fire lifecycle E-TYPE-001 regardless of construction
    // state.
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not -> string)
  }

  function boot() {
    let u = < User name="alice">
    log(u.name)
  }
}

<program></program>`;
    const { errors } = compileSource("lifecycle-non-lifecycle-field", src);
    const lifecycleFires = errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBe(0);
  });

  test("struct with no lifecycle fields — never fires", () => {
    const src = `\${
  type Plain:struct = {
    id: number,
    name: string
  }

  function boot() {
    let p = < Plain id=1 name="alice">
    log(p.id)
    log(p.name)
  }
}

<program></program>`;
    const { errors } = compileSource("lifecycle-no-lifecycle-struct", src);
    const lifecycleFires = errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBe(0);
  });

  test("attribute-style construction with B-shape value — field starts POST, no fire", () => {
    // Pass the lifecycle field at construction time. Per the Landing 1
    // wiring: `< User passwordHash="...">` initializes the field with a
    // B-shape value at construction, so the field starts POST.
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not -> string)
  }

  function boot() {
    let u = < User name="alice" passwordHash="hash">
    log(u.passwordHash)
  }
}

<program></program>`;
    const { errors } = compileSource("lifecycle-construct-with-b", src);
    const lifecycleFires = errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBe(0);
  });

  test("E-TYPE-001 diagnostic contains binding + field + pre-type + post-type for adopter-readable message", () => {
    const src = `\${
  type User:struct = {
    passwordHash: (not -> string)
  }

  function check() {
    let userBinding = < User>
    log(userBinding.passwordHash)
  }
}

<program></program>`;
    const { errors } = compileSource("lifecycle-diagnostic-shape", src);
    const fire = errors.find(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(fire).toBeDefined();
    // The diagnostic SHALL name the binding, the field, the type, the pre-state,
    // and the post-state, plus the SPEC anchor.
    expect(fire.message).toMatch(/userBinding/);
    expect(fire.message).toMatch(/passwordHash/);
    expect(fire.message).toMatch(/User/);
    expect(fire.message).toMatch(/not/);
    expect(fire.message).toMatch(/string/);
    expect(fire.message).toMatch(/SPEC §14\.3/);
    // And it points at a resolution path so the adopter knows what to do.
    expect(fire.message).toMatch(/Resolution/);
  });
});
