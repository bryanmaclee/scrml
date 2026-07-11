/**
 * async-await-reject.test.js — §19.9.8 language-wide standing rule, default
 * parse path.
 *
 * scrml has NO `async`/`await` (S114, user-voice: "I hate leaky abstractions
 * and colored functions"). The default parser fires three hard-error codes on
 * user source, matching the native parser:
 *
 *   - E-ASYNC-NOT-IN-SCRML     — `async function`, `async fn`, `async () =>`
 *   - E-AWAIT-NOT-IN-SCRML     — an `await` expression
 *   - E-FOR-AWAIT-NOT-IN-SCRML — a `for await ... of` head
 *
 * Two carve-outs are LOAD-BEARING and asserted here:
 *   1. §13.1 stdlib — a `scrml:*` `async function` still compiles + is still
 *      auto-awaited (covered end-to-end in auto-await-promise-stdlib.test.js;
 *      the isStdlibFile() unit is checked here).
 *   2. §19.9.8 JS-host boundary — `await` inside a `^{}` meta block or a `_{}`
 *      foreign block is NOT rejected (host JS may legitimately use `await`).
 *
 * Migration note: this reverses the S89 Q5 `I-ASYNC-USER-SOURCE` info nudge.
 *
 * SPEC anchors: §19.9.8, §13.1, §13.2.1, §34 (the three E-*-NOT-IN-SCRML rows).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { isStdlibFile } from "../../src/validators/lint-async-user-source.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Compile a one-file program and return the async/await NOT-IN-SCRML codes. */
function rejectCodes(src, parser) {
  const dir = mkdtempSync(join(tmpdir(), "aareject-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  const r = compileScrml({
    inputFiles: [f],
    outputDir: join(dir, "dist"),
    write: false,
    log: () => {},
    ...(parser ? { parser } : {}),
  });
  const diags = [...(r.errors || []), ...(r.warnings || [])];
  return diags.map((d) => d.code).filter((c) => /-(ASYNC|AWAIT|FOR-AWAIT)-NOT-IN-SCRML$/.test(c));
}

// ---------------------------------------------------------------------------
// The three hard codes on user source
// ---------------------------------------------------------------------------

describe("§19.9.8 default-path rejection — the three hard codes", () => {
  test("`async function` → E-ASYNC-NOT-IN-SCRML", () => {
    const codes = rejectCodes(`<program>
\${ async function f() { return 1 } }
<p>x</p>
</program>`);
    expect(codes).toContain("E-ASYNC-NOT-IN-SCRML");
  });

  test("`async () =>` arrow → E-ASYNC-NOT-IN-SCRML", () => {
    const codes = rejectCodes(`<program>
\${ function f() { const g = async () => 1; return g } }
<p>x</p>
</program>`);
    expect(codes).toContain("E-ASYNC-NOT-IN-SCRML");
  });

  test("`async fn` → E-ASYNC-NOT-IN-SCRML", () => {
    const codes = rejectCodes(`<program>
\${ async fn add(a, b) { return a + b } }
<p>x</p>
</program>`);
    expect(codes).toContain("E-ASYNC-NOT-IN-SCRML");
  });

  test("`await` expression → E-AWAIT-NOT-IN-SCRML", () => {
    const codes = rejectCodes(`<program>
\${
  function foo() { return 1 }
  function f() { let x = await foo(); return x }
}
<button onclick=f()>go</button>
</program>`);
    expect(codes).toContain("E-AWAIT-NOT-IN-SCRML");
  });

  test("`for await ... of` → E-FOR-AWAIT-NOT-IN-SCRML", () => {
    const codes = rejectCodes(`<program>
\${
  function f(items) { for await (const x of items) { lift x } }
}
<p>x</p>
</program>`);
    expect(codes).toContain("E-FOR-AWAIT-NOT-IN-SCRML");
  });
});

// ---------------------------------------------------------------------------
// §19.9.8 JS-host interop boundary — `^{}` meta + `_{}` foreign are exempt
// ---------------------------------------------------------------------------

describe("§19.9.8 host-JS boundary carve-out", () => {
  test("`await import(...)` inside a `^{}` meta block is NOT rejected", () => {
    const codes = rejectCodes(`<program>
^{ const m = await import("./x.js") }
<p>x</p>
</program>`);
    expect(codes).toEqual([]);
  });

  test("`await` inside a `_{}` foreign block is NOT rejected", () => {
    // A `_{}` foreign block is opaque (§23.2.3), so `await` there never becomes
    // a parsed node — the async/await reject validator never sees it.
    const codes = rejectCodes(`<program>
\${ function f() { const m = _={ await fetch("x") }= return m } }
<p>x</p>
</program>`);
    expect(codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stdlib carve-out (§13.1) — isStdlibFile predicate
// ---------------------------------------------------------------------------

describe("§13.1 stdlib carve-out — isStdlibFile predicate", () => {
  test("a file under `<repo>/stdlib/` is exempt; a user file is not", () => {
    const stdlibPath = resolve(import.meta.dir, "../../../stdlib/host/index.scrml");
    const userPath = resolve(import.meta.dir, "../../../examples/some-app.scrml");
    expect(isStdlibFile(stdlibPath)).toBe(true);
    expect(isStdlibFile(userPath)).toBe(false);
    expect(isStdlibFile(null)).toBe(false);
    expect(isStdlibFile("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Native-parser parity — the default path now matches `--parser scrml-native`
// ---------------------------------------------------------------------------

describe("§19.9.8 default ↔ native parser parity", () => {
  const cases = [
    ["async function", `<program>\n\${ async function f() { return 1 } }\n<p>x</p>\n</program>`, "E-ASYNC-NOT-IN-SCRML"],
    ["await expr", `<program>\n\${ function foo(){return 1} function f() { let x = await foo(); return x } }\n<button onclick=f()>go</button>\n</program>`, "E-AWAIT-NOT-IN-SCRML"],
    ["for await", `<program>\n\${ function f(xs) { for await (const x of xs) { lift x } } }\n<p>x</p>\n</program>`, "E-FOR-AWAIT-NOT-IN-SCRML"],
  ];
  for (const [label, src, expected] of cases) {
    test(`${label}: both parsers fire ${expected}`, () => {
      expect(rejectCodes(src, undefined)).toContain(expected);
      expect(rejectCodes(src, "scrml-native")).toContain(expected);
    });
  }
});
