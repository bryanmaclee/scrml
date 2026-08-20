/**
 * Regression — g-lifecycle-field-access-tracker-scans-unmasked-text-string-launder (S356-peter)
 *
 * `checkLifecycleFieldAccess` (the struct-field / dotted `@u.field` lifecycle
 * tracker) scanned RAW statement + init text with FIELD_WRITE_RE / FIELD_REF_RE /
 * recordInitialFromAttrText's ATTR_RE. #582 masked the SIBLING tracker
 * (`checkLifecycleBindingAccess`) via `maskStringLiteralSpans` but left this
 * parallel tracker raw, so string-literal CONTENTS were read as code:
 *
 *   - a `u.field =` write-spelling INSIDE a string literal seeded the field
 *     "post" (via the seeding pass) → laundering a real pre-transition read
 *     (E-TYPE-001 suppressed — a confidentiality leak), and
 *   - a `u.field` read-spelling INSIDE a string false-fired E-TYPE-001.
 *
 * Fix: route both the access-scan text and the seeding init text through the
 * existing `maskStringLiteralSpans()` (equal-length masking preserves offsets).
 * These cases pin both sides of the class + the must-not-break legitimate cases.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lifecycle-launder-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function firesPasswordHash(name, body) {
  const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not -> string)
  }
  function boot() {
    ${body}
  }
}

<program></program>`;
  const fp = join(TMP, `${name}.scrml`);
  writeFileSync(fp, src);
  const r = compileScrml({ inputFiles: [fp], outputDir: join(TMP, `${name}.dist`), write: false, log: () => {} });
  return (r.errors || []).filter(e => e.code === "E-TYPE-001" && /passwordHash/.test(e.message || "")).length;
}

describe("g-lifecycle-field-access-tracker string-literal launder (S356)", () => {
  test("LAUNDER — a `u.field =` write-spelling inside a string does NOT suppress a real pre-transition read", () => {
    // Buggy behaviour was 0 (leak); fixed behaviour fires on the real read.
    expect(firesPasswordHash("launder-dquote", `let u = < User name="alice">
    log("u.passwordHash = zzz")
    log(u.passwordHash)`)).toBeGreaterThanOrEqual(1);
  });

  test("LAUNDER — template-literal + single-quote spellings are also masked", () => {
    expect(firesPasswordHash("launder-template", `let u = < User name="alice">
    log(\`u.passwordHash = zzz\`)
    log(u.passwordHash)`)).toBeGreaterThanOrEqual(1);
    expect(firesPasswordHash("launder-squote", `let u = < User name="alice">
    log('u.passwordHash = zzz')
    log(u.passwordHash)`)).toBeGreaterThanOrEqual(1);
  });

  test("LAUNDER — a `reset(@u.field)` spelling inside a string does NOT register a bogus revert", () => {
    expect(firesPasswordHash("launder-reset", `let u = < User name="alice">
    log("reset(@u.passwordHash)")
    log(u.passwordHash)`)).toBeGreaterThanOrEqual(1);
  });

  test("FALSE-FIRE — a `u.field` read-spelling inside a string with NO real access does NOT fire", () => {
    // Buggy behaviour was 1 (false positive); fixed behaviour is silent.
    expect(firesPasswordHash("falsefire", `let u = < User name="alice">
    log("see u.passwordHash here")`)).toBe(0);
  });

  test("MUST NOT BREAK — a real (code, not string) write transitions the field; the read is clean", () => {
    expect(firesPasswordHash("legit-write", `let u = < User name="alice">
    u.passwordHash = "hashed"
    log(u.passwordHash)`)).toBe(0);
  });

  test("MUST NOT BREAK — a genuine pre-transition read still fires E-TYPE-001", () => {
    expect(firesPasswordHash("legit-pre", `let u = < User name="alice">
    log(u.passwordHash)`)).toBeGreaterThanOrEqual(1);
  });

  test("MUST NOT BREAK — a benign string containing the binding name but not the field access reads clean", () => {
    expect(firesPasswordHash("legit-benign-string", `let u = < User name="alice">
    log("hello alice world")
    log(u.passwordHash)`)).toBeGreaterThanOrEqual(1);
  });
});
