/**
 * S144 Cluster D — match-codegen diagnostics
 *
 * Bug Y  — S144 refused a `,` between match arms (E-MATCH-ARM-SEPARATOR, its
 *          old meaning). S469 (dpa-073 F2 / F5(1)) made the arm list a comma
 *          list and impl#1 ACCEPTS the `,` (it keeps reading newline-separated
 *          arms too). §1–§3 now pin that the comma list compiles clean and to
 *          the SAME client JS as the newline list, on BOTH the markup `${match}`
 *          path and the `let/const = match` decl path. (Exhaustive arm-comma
 *          coverage: match-arm-commas-s469.test.js.)
 *
 * Bug AA — W-MATCH-VALUE-UNUSED: a plain `function` (no `fn`, no return type)
 *          whose LAST statement is a value-producing `match` written WITHOUT a
 *          `return` discards the value and falls through to `undefined` (§48.11
 *          — plain `function` has no implicit return). Surface the silent
 *          discard. Does NOT change return semantics.
 *
 * Coverage:
 *   §1  Bug Y decl  — `let r = match {...,}` compiles clean (S469)
 *   §2  Bug Y markup — `${match {...,}}`     compiles clean (S469)
 *   §3  Bug Y — the comma list emits the same JS as the newline list (S469)
 *   §4  Bug Y regression — newline arms (decl) compile clean
 *   §5  Bug Y regression — newline arms (markup) compile clean
 *   §6  Bug Y — inner result comma (fmt(1, 2)) does NOT false-positive
 *   §7  Bug AA — plain `function` bare-tail match → W-MATCH-VALUE-UNUSED
 *   §8  Bug AA regression — `return match` does NOT warn
 *   §9  Bug AA regression — `fn name() -> T { match }` does NOT warn
 *  §10  Bug AA regression — side-effect (block-arm) match does NOT warn
 *  §11  Bug AA regression — match that is not the last statement does NOT warn
 *  §12  Bug AA — `withReturn` still emits `return (IIFE)()` (semantics preserved)
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve(tmpdir(), "scrml-s144-match-sep-value-unused");
let tmpCounter = 0;

/**
 * Compile a source string and return all diagnostics (errors + warnings) plus
 * the emitted client JS (when present). `validate-emit` is OFF here (the API
 * default); Bug Y is caught by the typer regardless of that gate.
 */
function compile(source, dirName = null) {
  // `dirName` pins the source path (the emit carries a path-derived hash), so two
  // compiles can be compared byte for byte.
  const tmpDir = resolve(tmpRoot, dirName ?? `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: outDir });
    const diagnostics = [...(result.errors ?? []), ...(result.warnings ?? [])];
    // `outputs` is keyed by SOURCE file path; each value carries `clientJs`.
    let clientJs = "";
    for (const [, out] of result.outputs ?? new Map()) {
      if (out && typeof out === "object" && typeof out.clientJs === "string") {
        clientJs += out.clientJs + "\n";
      } else if (typeof out === "string") {
        clientJs += out + "\n";
      }
    }
    return { diagnostics, codes: diagnostics.map(d => d.code), clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function countCode(codes, code) {
  return codes.filter(c => c === code).length;
}

// ---------------------------------------------------------------------------
// Bug Y — comma match arms (S469 meaning)
// ---------------------------------------------------------------------------

describe("Bug Y — comma match arms (S469: accepted, dpa-073 F2 / F5(1))", () => {
  test("§1 decl form: `let r = match {...,}` compiles clean (no E-MATCH-ARM-SEPARATOR, no E-CODEGEN-INVALID-LOGIC)", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @state: S = S.Loading
  let r = match @state { .Loading => "a", .Ready => "b", else => "c" }
}
<p>\${r}</p>
</program>`);
    expect(codes).not.toContain("E-MATCH-ARM-SEPARATOR");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(codes).not.toContain("E-PARSE-001");
  });

  test("§2 markup form: `${match {...,}}` compiles clean (no E-MATCH-ARM-SEPARATOR, no E-CODEGEN-INVALID-LOGIC)", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @state: S = S.Loading
}
<p>\${match @state { .Loading => "a", .Ready => "b", else => "c" }}</p>
</program>`);
    expect(codes).not.toContain("E-MATCH-ARM-SEPARATOR");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(codes).not.toContain("E-PARSE-001");
  });

  test("§3 the comma list (trailing `,` included) emits the same client JS as the newline list", () => {
    const head = `<program>
\${
  type S:enum = { Loading, Ready, Done }
  @state: S = S.Loading
  let r = match @state {`;
    const tail = `}
}
<p>\${r}</p>
</program>`;
    const commas = compile(head + ` .Loading => "a", .Ready => "b", else => "c", ` + tail, "same-path");
    const lines = compile(head + `
    .Loading => "a"
    .Ready => "b"
    else => "c"
  ` + tail, "same-path");
    expect(commas.codes).toEqual(lines.codes);
    expect(commas.clientJs.length).toBeGreaterThan(0);
    expect(commas.clientJs).toBe(lines.clientJs);
  });

  test("§4 regression: newline arms (decl) compile clean", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @state: S = S.Loading
  let r = match @state {
    .Loading => "a"
    .Ready => "b"
    else => "c"
  }
}
<p>\${r}</p>
</program>`);
    expect(codes).not.toContain("E-MATCH-ARM-SEPARATOR");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("§5 regression: newline arms (markup) compile clean", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @state: S = S.Loading
}
<p>\${match @state {
  .Loading => "a"
  .Ready => "b"
  else => "c"
}}</p>
</program>`);
    expect(codes).not.toContain("E-MATCH-ARM-SEPARATOR");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("§6 inner result comma (fmt(1, 2)) does not false-positive", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @state: S = S.Loading
  fn fmt(a: number, b: number) -> string { "x" }
  let r = match @state {
    .Loading => fmt(1, 2)
    .Ready => fmt(3, 4)
    else => "c"
  }
}
<p>\${r}</p>
</program>`);
    expect(codes).not.toContain("E-MATCH-ARM-SEPARATOR");
  });
});

// ---------------------------------------------------------------------------
// Bug AA — W-MATCH-VALUE-UNUSED
// ---------------------------------------------------------------------------

describe("Bug AA — W-MATCH-VALUE-UNUSED (discarded bare-tail match)", () => {
  test("§7 plain `function` bare-tail value match fires W-MATCH-VALUE-UNUSED", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @cell: S = S.Loading
  function bare() {
    match @cell {
      .Loading => "a"
      .Ready => "b"
      else => "c"
    }
  }
}
<p>\${bare()}</p>
</program>`);
    expect(codes).toContain("W-MATCH-VALUE-UNUSED");
  });

  test("§8 regression: `return match` does NOT warn", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @cell: S = S.Loading
  function withReturnStmt() {
    return match @cell {
      .Loading => "a"
      .Ready => "b"
      else => "c"
    }
  }
}
<p>\${withReturnStmt()}</p>
</program>`);
    expect(codes).not.toContain("W-MATCH-VALUE-UNUSED");
  });

  test("§9 regression: `fn name() -> T { match }` does NOT warn", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @cell: S = S.Loading
  fn withReturn() -> string {
    match @cell {
      .Loading => "a"
      .Ready => "b"
      else => "c"
    }
  }
}
<p>\${withReturn()}</p>
</program>`);
    expect(codes).not.toContain("W-MATCH-VALUE-UNUSED");
  });

  test("§10 regression: side-effect (block-arm) match does NOT warn", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @cell: S = S.Loading
  @x = 0
  function sideEffect() {
    match @cell {
      .Loading => { @x = 1 }
      .Ready => { @x = 2 }
      else => { @x = 3 }
    }
  }
}
<p>\${sideEffect()}\${@x}</p>
</program>`);
    expect(codes).not.toContain("W-MATCH-VALUE-UNUSED");
  });

  test("§11 regression: match that is NOT the last statement does NOT warn", () => {
    const { codes } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @cell: S = S.Loading
  @x = 0
  function notLast() {
    match @cell {
      .Loading => "a"
      else => "c"
    }
    @x = 5
  }
}
<p>\${notLast()}\${@x}</p>
</program>`);
    expect(codes).not.toContain("W-MATCH-VALUE-UNUSED");
  });

  test("§12 `fn` return path still emits `return (IIFE)()` (semantics preserved)", () => {
    const { clientJs } = compile(`<program>
\${
  type S:enum = { Loading, Ready, Done }
  @cell: S = S.Loading
  fn withReturn() -> string {
    match @cell {
      .Loading => "a"
      .Ready => "b"
      else => "c"
    }
  }
}
<p>\${withReturn()}</p>
</program>`);
    expect(clientJs).toMatch(/return \(function\(\)/);
  });
});
