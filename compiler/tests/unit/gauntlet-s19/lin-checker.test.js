/**
 * S19 gauntlet Phase 1 — lin-checker regression tests.
 *
 * Covers the 4 lin-checker bugs triaged at
 * docs/changes/gauntlet-s19/bugs.md:
 *   - A14  outer lin consumed in loop not rejected (was silent, expected E-LIN-002)
 *   - B1   closure double-consume misclassified (was E-LIN-001, expected E-LIN-002)
 *   - B2   asymmetric match arms misclassified (was E-LIN-001, expected E-LIN-003)
 *   - B3   spurious E-LIN-001 alongside correct E-LIN-003 on asymmetric if/else
 *   - C5   symmetric match arms incorrectly flagged (was E-LIN-001, expected clean)
 *
 * Each test compiles a minimal scrml fixture and asserts the exact set of
 * E-LIN-xxx diagnostics.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-lin-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      linErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-LIN")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codesOf(errors) {
  return errors.map(e => e.code).sort();
}

describe("S19 gauntlet Phase 1 — lin checker", () => {

  // -----------------------------------------------------------------
  // A14: outer lin consumed inside loop body → E-LIN-002 (§35.4.4)
  // -----------------------------------------------------------------
  test("A14: outer-scope lin consumed inside for-stmt → E-LIN-002", () => {
    const src = `\${
    function fetchToken() { return "tok" }
    function submit(t) { return t }

    function run(items) {
        lin token = fetchToken()
        for (const item of items) {
            submit(token)
        }
        return "done"
    }
}
<p>\${run([1,2])}</>
`;
    const { linErrors } = compileWholeScrml(src, "a14-outer-lin-in-loop");
    expect(codesOf(linErrors)).toEqual(["E-LIN-002"]);
  });

  // -----------------------------------------------------------------
  // B1: two closures capturing the same lin var → E-LIN-002 (§35.6)
  // -----------------------------------------------------------------
  test("B1: two lambdas capturing the same lin var → E-LIN-002", () => {
    const src = `\${
    function fetchToken() { return "tok" }
    function useToken(t) { return t }

    function run() {
        lin token = fetchToken()
        let a = () => { useToken(token) }
        let b = () => { useToken(token) }
        return a
    }
}
<p>x</>
`;
    const { linErrors } = compileWholeScrml(src, "b1-closure-double");
    expect(codesOf(linErrors)).toEqual(["E-LIN-002"]);
  });

  // -----------------------------------------------------------------
  // B2: match arms where one arm does NOT consume lin → E-LIN-003 (§35.4.3)
  // -----------------------------------------------------------------
  test("B2: asymmetric match arms → E-LIN-003", () => {
    const src = `\${
    type Role:enum = { Admin, User, Guest }
    function fetchToken() { return "tok" }
    function adminAuth(t) { return t }
    function userAuth(t) { return t }

    function run(role) {
        lin token = fetchToken()
        return match role {
            .Admin => adminAuth(token)
            .User  => userAuth(token)
            .Guest => "no-op"
        }
    }
}
<p>\${run(.Guest)}</>
`;
    const { linErrors } = compileWholeScrml(src, "b2-match-asymmetric");
    const codes = codesOf(linErrors);
    expect(codes).toContain("E-LIN-003");
    // Must NOT also emit E-LIN-001 — the asymmetry is the only diagnostic.
    expect(codes).not.toContain("E-LIN-001");
  });

  // -----------------------------------------------------------------
  // B3: asymmetric if-without-else → exactly E-LIN-003, not also E-LIN-001
  // -----------------------------------------------------------------
  test("B3: if with implicit-else that does not consume → only E-LIN-003", () => {
    const src = `\${
    function fetchToken() { return "tok" }
    function authenticate(t) { return t }

    function run(needsAuth) {
        lin token = fetchToken()
        if (needsAuth) {
            return authenticate(token)
        }
        return "skipped"
    }
}
<p>\${run(true)}</>
`;
    const { linErrors } = compileWholeScrml(src, "b3-branch-asymmetric");
    const codes = codesOf(linErrors);
    expect(codes).toContain("E-LIN-003");
    expect(codes).not.toContain("E-LIN-001");
  });

  // -----------------------------------------------------------------
  // C5: symmetric match arms (every arm consumes) → clean
  // -----------------------------------------------------------------
  test("C5: every match arm consumes lin — compile clean", () => {
    const src = `\${
    type Role:enum = { Admin, User, Guest }
    function fetchToken() { return "tok" }
    function adminAuth(t) { return t }
    function userAuth(t) { return t }
    function guestAuth(t) { return t }

    function run(role) {
        lin token = fetchToken()
        return match role {
            .Admin => adminAuth(token)
            .User  => userAuth(token)
            .Guest => guestAuth(token)
        }
    }
}
<p>\${run(.Admin)}</>
`;
    const { linErrors } = compileWholeScrml(src, "c5-match-symmetric");
    expect(linErrors).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // Sanity: loop-local lin (decl + consume in same iteration) still clean
  // -----------------------------------------------------------------
  test("sanity: loop-local lin decl+consume in same iteration → clean", () => {
    const src = `\${
    function mintToken() { return "fresh-tok" }
    function submitOne(t) { return t }

    function run(items) {
        for (const item of items) {
            lin token = mintToken()
            submitOne(token)
        }
        return "done"
    }
}
<p>\${run([1,2,3])}</>
`;
    const { linErrors } = compileWholeScrml(src, "sanity-loop-local");
    expect(linErrors).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // Sanity: symmetric if/else both consume → clean
  // -----------------------------------------------------------------
  test("sanity: if/else both consume lin → clean", () => {
    const src = `\${
    function fetchToken() { return "tok" }
    function adminAuth(t) { return t }
    function userAuth(t) { return t }

    function run(isAdmin) {
        lin token = fetchToken()
        if (isAdmin) {
            return adminAuth(token)
        } else {
            return userAuth(token)
        }
    }
}
<p>\${run(false)}</>
`;
    const { linErrors } = compileWholeScrml(src, "sanity-branch-symmetric");
    expect(linErrors).toHaveLength(0);
  });
});
