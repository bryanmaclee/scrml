/**
 * §41.13 — parseVariant runtime behavior (compile + execute).
 *
 * Phase 2 deliverable 2: integration tests exercising the monomorphized
 * parser emit in emit-parse-variant.ts. Each test compiles a small scrml
 * source with a parseVariant call, then EXECUTES the emitted IIFE shape
 * directly (we extract it from the emitted output and `Function`-eval it
 * with controlled inputs).
 *
 * Coverage:
 *   §1 happy path — multi-field payload variant (Failed(reason))
 *   §2 happy path — unit variant (Empty) → bare-string runtime shape
 *   §3 happy path — single-field payload variant (Success(rows))
 *   §4 failure   — missing discriminator (no `tag` field)
 *   §5 failure   — unknown variant (tag doesn't match any declared variant)
 *   §6 failure   — invalid payload (wrong type for declared field)
 *   §7 failure   — malformed JSON string (parse error)
 *   §8 invariant — NO auto-recursion: nested-enum payload is accepted
 *                  as-object without re-parsing (developer must call
 *                  parseVariant again at the inner site)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "parse-variant-rt-"));
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

/**
 * Compile a single scrml source and return the emitted JS plus a helper
 * that extracts the parseVariant IIFE source for direct execution.
 */
function compileAndExtractIIFE(filename, source) {
  const abs = fx(filename, source);
  const result = compileScrml({
    inputFiles: [abs],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
  const errs = realErrors(result);
  const pvErrs = errs.filter(e => String(e.code).startsWith("E-PARSEVARIANT-"));
  expect(pvErrs).toEqual([]);

  // Find the emitted JS that contains the IIFE.
  let allJs = "";
  for (const out of result.outputs.values()) {
    allJs += "\n" + (out.serverJs || "") + "\n" + (out.clientJs || "");
  }

  // Extract the IIFE: `((_raw) => { ... switch (_v.tag) ... })(...)`.
  // The IIFE may be embedded inside a guarded-expr's `let _scrml_resultN = ...;`
  // — we match the IIFE shape directly.
  const iifeMatch = allJs.match(/\(\(_raw\) => \{[\s\S]*?switch \(_v\.tag\)[\s\S]*?\}\)\([^)]*\)/);
  if (!iifeMatch) {
    throw new Error(
      `Could not locate parseVariant IIFE in emitted JS. ` +
      `errors=${errs.length} jsLen=${allJs.length}\n` +
      `--- emitted JS sample (first 600) ---\n${allJs.slice(0, 600)}\n`,
    );
  }
  // Replace the call argument with a placeholder that we can substitute
  // with a real input at eval time. The IIFE is `<arrow>(<arg>)` — strip
  // the trailing `(...)` and produce just the arrow function so we can
  // call it with our test inputs.
  const arrow = iifeMatch[0].replace(/\)\([^)]*\)$/, ")");
  // arrow is now `((_raw) => { ... })` — directly callable.
  const fn = new Function(`return ${arrow};`)();
  return { fn, jsSnippet: arrow, errs };
}

// ---------------------------------------------------------------------------
// §1 — happy path: multi-field payload
// ---------------------------------------------------------------------------

describe("§1 multi-field payload variant — happy path", () => {
  test("parseVariant returns the typed enum value for a payload variant", () => {
    const { fn } = compileAndExtractIIFE("rt-1/multi.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LoadResult:enum = {
    Success(rows: int)
    Empty
    Failed(reason: string)
  }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LoadResult)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn({ tag: "Failed", reason: "db down" });
    expect(out.__scrml_error).toBeUndefined();
    expect(out).toEqual({ variant: "Failed", data: { reason: "db down" } });
  });
});

// ---------------------------------------------------------------------------
// §2 — happy path: unit variant
// ---------------------------------------------------------------------------

describe("§2 unit variant — bare-string runtime shape", () => {
  test("parseVariant returns the bare variant-name string for a unit variant", () => {
    const { fn } = compileAndExtractIIFE("rt-2/unit.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LoadResult2:enum = {
    Success(rows: int)
    Empty
    Failed(reason: string)
  }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LoadResult2)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn({ tag: "Empty" });
    // Unit variant matches emitEnumVariantObjects: bare string.
    expect(out).toBe("Empty");
  });
});

// ---------------------------------------------------------------------------
// §3 — happy path: single-field payload
// ---------------------------------------------------------------------------

describe("§3 single-field payload — happy path", () => {
  test("parseVariant returns {variant, data:{rows}} for Success(rows)", () => {
    const { fn } = compileAndExtractIIFE("rt-3/single.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR3:enum = {
    Success(rows: int)
    Empty
  }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR3)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn({ tag: "Success", rows: 42 });
    expect(out).toEqual({ variant: "Success", data: { rows: 42 } });
  });

  test("parseVariant accepts JSON string input — JSON.parses then dispatches", () => {
    const { fn } = compileAndExtractIIFE("rt-3b/string.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR3b:enum = { Success(rows: int) }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR3b)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn(JSON.stringify({ tag: "Success", rows: 7 }));
    expect(out).toEqual({ variant: "Success", data: { rows: 7 } });
  });
});

// ---------------------------------------------------------------------------
// §4 — failure: missing discriminator
// ---------------------------------------------------------------------------

describe("§4 failure — missing discriminator", () => {
  test("input without `tag` returns ::ParseError::MissingDiscriminator", () => {
    const { fn } = compileAndExtractIIFE("rt-4/missing.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR4:enum = { Foo, Bar(x: string) }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR4)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn({ x: 1 });  // no `tag`
    expect(out.__scrml_error).toBe(true);
    expect(out.type).toBe("ParseError");
    expect(out.variant).toBe("MissingDiscriminator");
  });
});

// ---------------------------------------------------------------------------
// §5 — failure: unknown variant
// ---------------------------------------------------------------------------

describe("§5 failure — unknown variant", () => {
  test("input with unrecognized `tag` returns ::ParseError::UnknownVariant(tag)", () => {
    const { fn } = compileAndExtractIIFE("rt-5/unknown.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR5:enum = { Foo, Bar }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR5)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn({ tag: "Quux" });
    expect(out.__scrml_error).toBe(true);
    expect(out.type).toBe("ParseError");
    expect(out.variant).toBe("UnknownVariant");
    expect(out.data.tag).toBe("Quux");
  });
});

// ---------------------------------------------------------------------------
// §6 — failure: invalid payload
// ---------------------------------------------------------------------------

describe("§6 failure — invalid payload type", () => {
  test("payload field with wrong type returns ::ParseError::InvalidPayload", () => {
    const { fn } = compileAndExtractIIFE("rt-6/invalid.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR6:enum = {
    Failed(reason: string)
  }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR6)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn({ tag: "Failed", reason: 12345 });  // reason is not a string
    expect(out.__scrml_error).toBe(true);
    expect(out.type).toBe("ParseError");
    expect(out.variant).toBe("InvalidPayload");
    expect(out.data.field).toBe("reason");
  });
});

// ---------------------------------------------------------------------------
// §7 — failure: malformed JSON
// ---------------------------------------------------------------------------

describe("§7 failure — malformed JSON string", () => {
  test("malformed JSON input returns ::ParseError::Malformed(reason)", () => {
    const { fn } = compileAndExtractIIFE("rt-7/malformed.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR7:enum = { Foo }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR7)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn("{not json:");
    expect(out.__scrml_error).toBe(true);
    expect(out.type).toBe("ParseError");
    expect(out.variant).toBe("Malformed");
    expect(typeof out.data.reason).toBe("string");
  });

  test("non-object input returns ::ParseError::Malformed(reason)", () => {
    const { fn } = compileAndExtractIIFE("rt-7b/null.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type LR7b:enum = { Foo }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, LR7b)
    return v
  }
}
<program><p>x</p></program>
`);
    const out = fn(null);
    expect(out.__scrml_error).toBe(true);
    expect(out.type).toBe("ParseError");
    expect(out.variant).toBe("Malformed");
  });
});

// ---------------------------------------------------------------------------
// §8 — recursion invariant: NO auto-recursion
// ---------------------------------------------------------------------------

describe("§8 NO auto-recursion — nested-enum payload accepted as-object", () => {
  test("nested-enum payload field is NOT re-parsed; developer must call parseVariant again at the inner site", () => {
    const { fn } = compileAndExtractIIFE("rt-8/nested.scrml", `\${
  import { parseVariant, ParseError } from 'scrml:data'

  type Inner:enum = { A, B }
  type Outer:enum = { Wrap(inner: Inner) }

  function go(raw)! -> ParseError {
    const v = parseVariant(raw, Outer)
    return v
  }
}
<program><p>x</p></program>
`);
    // Pass an Outer with a STRING payload that LOOKS like an Inner tag — the
    // nested type is NOT auto-parsed; the parser only checks "non-null" for
    // complex types and stores whatever value was given.
    const innerJsonObj = { tag: "A" };
    const out = fn({ tag: "Wrap", inner: innerJsonObj });
    expect(out.__scrml_error).toBeUndefined();
    expect(out.variant).toBe("Wrap");
    // Critical: the inner field is the RAW input — not a parsed Inner enum
    // value. (If auto-recursion were happening, this would be the bare
    // string "A" instead of the input object.)
    expect(out.data.inner).toEqual(innerJsonObj);
    expect(out.data.inner).not.toBe("A");
  });
});
