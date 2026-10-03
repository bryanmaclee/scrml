/**
 * S184 — lifecycle-field comment-leak parse bug (regression).
 *
 * A trailing `//` line comment (or `/* ... *​/` block comment) on a `:struct`
 * field line carrying a `to`-keyword lifecycle annotation `(A to B)` used to
 * leak the comment WORDS into the field's TYPE-annotation string. Root cause:
 * the tokenizer emits a COMMENT token whose `.text` is the comment content with
 * the `//` / `/*` glyph already stripped (readLineComment / readBlockComment);
 * `collectBracedBody` (ast-builder.js) pushed EVERY token's `.text`, including
 * COMMENT tokens, so a field annotated
 *
 *     passwordHash: (not to string)   // ...transitions to string...
 *
 * reached the type system as `(not to string) ...transitions to string...`.
 * That trailing residue defeated the `endsWith(")")` lifecycle-wrap gate in
 * `isFunctionTypeAnnotation`, and `findTopLevelArrow` then matched the bare word
 * "to" inside the leaked comment ("transitions **to** string") → the field was
 * mis-classified as a thin-arrow FUNCTION type → `E-STRUCT-FUNCTION-FIELD` fired
 * WRONGLY, blocking compilation of valid scrml.
 *
 * Fix: `collectBracedBody` now skips COMMENT tokens (consumes but does not
 * contribute their text), mirroring the tokenizer's own COMMENT skip. The
 * trailing comment is gone before the field type-expr is classified, so a
 * lifecycle field with a trailing comment behaves identically to one without.
 *
 * SCOPE GUARD (user ruling "A — just the parse bug"): these tests assert ONLY
 * that the comment no longer mis-fires E-STRUCT-FUNCTION-FIELD and that the
 * lifecycle E-TYPE-001 tracking still works on a pre-transition read. They do
 * NOT assert on the E-TYPE-001 double-fire (a known out-of-scope incidental) —
 * the lifecycle assertions use `>= 1` so that incidental does not couple here.
 *
 * Cross-stream helper (S92 partition rule): E- codes partition to result.errors,
 * but we read BOTH streams so a stream-partition regression is caught rather
 * than silently passing.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lifecycle-comment-leak-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream code count (errors + warnings).
function countCode(res, code) {
  return [...(res.errors || []), ...(res.warnings || [])]
    .filter((d) => d.code === code).length;
}

// ---------------------------------------------------------------------------
// The bug: lifecycle field + trailing comment must NOT mis-fire
// E-STRUCT-FUNCTION-FIELD (and SHALL still fire E-TYPE-001 on a pre-transition
// read, exactly as the comment-free form does).
// ---------------------------------------------------------------------------

describe("S184 lifecycle-field comment-leak — trailing comment no longer mis-fires", () => {
  // A `to`-keyword lifecycle field whose trailing line comment contains the
  // word "to" — the exact shape that defeated the lifecycle-wrap gate.
  const T1_LINE = `\${ type User:struct = {
  email: string
  passwordHash: (not to string)   // starts absent; transitions to string after hashing
} }
<u>: User = { email: "a@b.com", passwordHash: not }
\${ const h = @u.passwordHash }
<div>{h}</div>`;

  // Same, but a block comment that also carries "to" AND a trailing `*​/`.
  const T4_BLOCK = `\${ type User:struct = {
  email: string
  passwordHash: (not to string)   /* transitions to string after hashing */
} }
<u>: User = { email: "a@b.com", passwordHash: not }
\${ const h = @u.passwordHash }
<div>{h}</div>`;

  // Control: no trailing comment.
  const T2_NOCOMMENT = `\${ type User:struct = {
  email: string
  passwordHash: (not to string)
} }
<u>: User = { email: "a@b.com", passwordHash: not }
\${ const h = @u.passwordHash }
<div>{h}</div>`;

  // Control: comment on its OWN line above the field.
  const T3_ABOVE = `\${ type User:struct = {
  email: string
  // starts absent; transitions to string after hashing
  passwordHash: (not to string)
} }
<u>: User = { email: "a@b.com", passwordHash: not }
\${ const h = @u.passwordHash }
<div>{h}</div>`;

  test("trailing // line comment does NOT fire E-STRUCT-FUNCTION-FIELD", () => {
    const res = compile(T1_LINE);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(0);
    // Hard reject must never land in the warnings stream either.
    expect((res.warnings || []).some((d) => d.code === "E-STRUCT-FUNCTION-FIELD")).toBe(false);
  });

  test("trailing // line comment STILL fires E-TYPE-001 on a pre-transition read", () => {
    const res = compile(T1_LINE);
    // Lifecycle tracking survives the comment strip (>= 1 so the out-of-scope
    // E-TYPE-001 double-fire incidental does not couple this assertion).
    expect(countCode(res, "E-TYPE-001")).toBeGreaterThanOrEqual(1);
    expect((res.errors || []).some((d) => d.code === "E-TYPE-001")).toBe(true);
  });

  test("trailing /* */ block comment does NOT fire E-STRUCT-FUNCTION-FIELD", () => {
    const res = compile(T4_BLOCK);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(0);
  });

  test("trailing /* */ block comment STILL fires E-TYPE-001 on a pre-transition read", () => {
    const res = compile(T4_BLOCK);
    expect(countCode(res, "E-TYPE-001")).toBeGreaterThanOrEqual(1);
  });

  test("trailing-comment form behaves identically to the comment-free form", () => {
    const withComment = compile(T1_LINE);
    const withoutComment = compile(T2_NOCOMMENT);
    expect(countCode(withComment, "E-STRUCT-FUNCTION-FIELD"))
      .toBe(countCode(withoutComment, "E-STRUCT-FUNCTION-FIELD"));
    expect(countCode(withComment, "E-STRUCT-FUNCTION-FIELD")).toBe(0);
    // Both fire the lifecycle pre-transition error.
    expect(countCode(withComment, "E-TYPE-001")).toBeGreaterThanOrEqual(1);
    expect(countCode(withoutComment, "E-TYPE-001")).toBeGreaterThanOrEqual(1);
  });

  test("above-field comment form also fires E-TYPE-001 and never E-STRUCT-FUNCTION-FIELD", () => {
    const res = compile(T3_ABOVE);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(0);
    expect(countCode(res, "E-TYPE-001")).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// No over-strip: a genuine function-typed struct field STILL rejects, including
// when it carries a trailing comment (the comment strip must not swallow the
// function-ness of the type-expr).
// ---------------------------------------------------------------------------

describe("S184 — genuine function-typed struct field still rejects (no over-strip)", () => {
  test("() -> void thin-arrow field still rejects (no comment)", () => {
    const res = compile(`\${ type Widget:struct = { onTick: () -> void, label: string } }
<div>x</div>`);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(1);
  });

  test("() -> void thin-arrow field still rejects WITH a trailing comment", () => {
    const res = compile(`\${ type Widget:struct = {
  onTick: () -> void   // called every tick
  label: string
} }
<div>x</div>`);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(1);
    expect(res.errors.some((d) => d.code === "E-STRUCT-FUNCTION-FIELD" && d.message.includes("onTick"))).toBe(true);
  });

  test("(x) => string fat-arrow field still rejects WITH a trailing comment", () => {
    const res = compile(`\${ type Widget:struct = {
  cb: (x) => string   /* maps x to a label */
  label: string
} }
<div>x</div>`);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(1);
  });

  test("fn() field still rejects WITH a trailing comment", () => {
    const res = compile(`\${ type Widget:struct = {
  handler: fn()   // do the thing
  label: string
} }
<div>x</div>`);
    expect(countCode(res, "E-STRUCT-FUNCTION-FIELD")).toBe(1);
  });
});

// S449: a "native-parser parity" block stood here — the same two programs
// compiled under the retired full-pipeline `--parser=scrml-native` flag. The
// fix lives in the LIVE collectBracedBody, so the block only measured parity.
