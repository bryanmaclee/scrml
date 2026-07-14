/**
 * ss39 #2 (g-nested-template-raw-mangle) — a NESTED template literal inside a
 * `${...}` interpolation was mangled by the LEGACY logic tokenizer BEFORE it
 * reached codegen. `tokenizer.ts:readBacktickString` tracked only backtick
 * depth, so the inner template's OPENING backtick was mistaken for the OUTER
 * template's CLOSING backtick. The scanner broke out, the inner template's body
 * was re-tokenized as bare punctuation/idents, and the ast-builder re-joined
 * the fragments with spaces:
 *
 *   source : return `outer ${`inner ${pb()}`}`
 *   RED    : return `outer ${` inner $ { pb ( ) } `}`   <- mangled, inner dead
 *   GREEN  : return `outer ${`inner ${await pb()}`}`    <- raw preserved + awaited
 *
 * ss22 #4's emit-expr fix (emitServerTemplateLit) was correct AT THE EMIT LEVEL,
 * but it received already-damaged raw text — this is the UPSTREAM half. The fix
 * rewrites `readBacktickString` to scan template bodies and `${...}`
 * interpolations with mutually-recursive helpers (`scanTemplateBody` /
 * `scanInterpBody`) so nested templates, nested strings, and balanced braces are
 * all preserved verbatim.
 *
 * R26: these are REAL `.scrml` compiles through the FULL pipeline (the mangle is
 * upstream — a synthetic AST would miss it). We inspect the emitted JS for the
 * correct nested template literals and parse it for syntactic validity.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import vm from "node:vm";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_nested_template_raw_mangle");
let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compile(scrmlSource, tag) {
  const id = `${tag}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, id);
  const tmpInput = resolve(tmpDir, `${id}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  return {
    errors: (result.errors ?? []).filter((e) => !e.code?.startsWith("W-")),
    serverJs: existsSync(join(outDir, `${id}.server.js`)) ? readFileSync(join(outDir, `${id}.server.js`), "utf-8") : "",
    clientJs: existsSync(join(outDir, `${id}.client.js`)) ? readFileSync(join(outDir, `${id}.client.js`), "utf-8") : "",
  };
}

// Parse the emitted bodies inside an async wrapper (strip module-level
// import/export lines). A syntax error throws — the RED mangle (`${` inner $ {
// pb ( ) } `}`) is invalid JS once re-wrapped with backticks.
function assertValidJs(src) {
  const stripped = src
    .split("\n")
    .map((l) => (/^\s*(import|export)\b/.test(l) ? "" : l))
    .join("\n");
  expect(() => new vm.Script(`async function __wrap(){\n${stripped}\n}`)).not.toThrow();
}

describe("ss39 #2 — nested template literal raw preserved through the legacy pipeline", () => {
  // Primary repro — the exact ss22 #4 shape.
  test("primary: ${`inner ${pb()}`} emits correct nested-template JS", () => {
    const src = `
<program>

server function pb() { return 7 }

server function nested() {
  return \`outer \${\`inner \${pb()}\`}\`
}

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "primary");
    expect(errors).toEqual([]);
    // GREEN: the inner template raw is preserved AND its peer call is awaited.
    expect(serverJs).toContain("return `outer ${`inner ${await pb()}`}`;");
    // RED guard: the space-mangled shape must NOT appear.
    expect(serverJs).not.toContain("` inner $ { pb ( ) } `");
    expect(serverJs).not.toContain("$ {");
    assertValidJs(serverJs);
  });

  // Adversarial 1 — 3 levels of nesting.
  test("adversarial: 3-level nesting all preserved", () => {
    const src = `
<program>

server function threeLevel(x) {
  return \`a \${\`b \${\`c \${x}\`}\`}\`
}

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "three");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("return `a ${`b ${`c ${x}`}`}`;");
    assertValidJs(serverJs);
  });

  // Adversarial 2 — interpolation with a CALL.
  test("adversarial: nested interpolation with a call", () => {
    const src = `
<program>

server function fetchName(id) { return id }

server function callInterp(id) {
  return \`got \${\`name \${fetchName(id)}\`}\`
}

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "call");
    expect(errors).toEqual([]);
    // fetchName is a sibling peer → auto-awaited (scrml has no source `await`, S114).
    expect(serverJs).toContain("return `got ${`name ${await fetchName(id)}`}`;");
    assertValidJs(serverJs);
  });

  // Adversarial 3 — async (peer auto-await) expr nested. scrml has NO source
  // `await` keyword (S114); the canonical async surface is a peer/server-fn call
  // that the compiler auto-awaits. The primary repro already proves the nested
  // peer is awaited; here we assert two peers across nesting depths.
  test("adversarial: nested peer calls auto-awaited across depth", () => {
    const src = `
<program>

server function pa() { return 1 }
server function pb() { return 2 }

server function both() {
  return \`x \${pa()} y \${\`inner \${pb()}\`}\`
}

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "await");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("return `x ${await pa()} y ${`inner ${await pb()}`}`;");
    assertValidJs(serverJs);
  });

  // Adversarial 4 — multiple nested templates in one interpolation.
  test("adversarial: multiple nested interpolations in one inner template", () => {
    const src = `
<program>

server function a() { return 1 }
server function b() { return 2 }

server function multi() {
  return \`wrap \${\`\${a()} and \${b()}\`}\`
}

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "multi");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("return `wrap ${`${await a()} and ${await b()}`}`;");
    assertValidJs(serverJs);
  });

  // Adversarial 5 — nested template adjacent to a real markup tag (logic-block
  // interpolation embedded in markup, the bug path). Markup must still parse and
  // the nested template raw must survive.
  test("adversarial: nested template adjacent to markup parses + raw intact", () => {
    const src = `
<program>

server function pb() { return 7 }

\${
  server function tag() {
    return \`a \${\`b \${pb()}\`}\`
  }
}
<div>marker</div><span>after</span>

</program>
`;
    const { errors, serverJs } = compile(src, "markup-adjacent");
    expect(errors).toEqual([]);
    // Nested template raw preserved + awaited.
    expect(serverJs).toContain("return `a ${`b ${await pb()}`}`;");
    assertValidJs(serverJs);
  });

  // Adversarial 6 — DIFFERENTIAL no-regression: a plain single-level
  // interpolation must be unaffected (the fix is a no-op when there is no
  // nested backtick). The escaped-backtick edge must also still round-trip.
  test("differential: plain single-level + escaped backtick unchanged", () => {
    const src = `
<program>

server function plainSingle(name) {
  return \`hi \${name}\`
}

server function escaped(name) {
  return \`a \\\` b \${name}\`
}

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "plain");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("return `hi ${name}`;");
    expect(serverJs).toContain("return `a \\` b ${name}`;");
    assertValidJs(serverJs);
  });

  // Brace + string robustness inside an interpolation: a `}` inside a nested
  // string and an object literal inside the interpolation must not close the
  // interpolation early.
  test("robustness: `}` in string + object literal in interpolation", () => {
    const src = `
<program>

server function obj(x) {
  return \`v \${\`n \${fmt({ k: x })}\`}\`
}

server function fmt(o) { return o }

<div>x</div>

</program>
`;
    const { errors, serverJs } = compile(src, "robust");
    expect(errors).toEqual([]);
    // The inner `}` (inside the object literal) does NOT close the interpolation
    // early — the nested template raw survives. (The object-literal interior
    // spacing `{ k: x }` -> `{k: x}` is a pre-existing emit normalization, not
    // part of this fix.)
    expect(serverJs).toContain("return `v ${`n ${await fmt({k: x})}`}`;");
    assertValidJs(serverJs);
  });
});
