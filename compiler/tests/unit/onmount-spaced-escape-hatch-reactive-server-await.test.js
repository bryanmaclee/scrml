// ---------------------------------------------------------------------------
// on-mount SPACED escape-hatch direct reactive-server write is awaited
// (g-onmount-direct-reactive-server-write-unawaited-on-escape-hatch-string-path,
//  MED, S310 — the remaining half of the S306-filed gap; the fallback-hardening
//  half was closed by S308/#326)
// ---------------------------------------------------------------------------
//
// A DIRECT `@cell = serverFn()` reactive write in an `on mount` body is lifted
// by emit-client's own auto-await IIFE pass (`injectServerCallAwaitsViaAst`
// deliberately SKIPS the direct value of `_scrml_reactive_set(cell, stub())`,
// expecting emit-client to own that lift). But emit-client's matcher required
// the TIGHT `stub(` form. When the mount body fails to tokenize cleanly — e.g. a
// paren-bearing regex (`/a(b/`) — it lowers through the escape-hatch string
// pipeline, which emits the call SPACED: `_scrml_reactive_set("n", stub ( ))`.
// The tight matcher missed the spaced form, so NEITHER pass awaited it → a bare
// Promise bound into the cell (fail-OPEN, §13.2).
//
// The FIX: emit-client's matcher tolerates whitespace between the mangled callee
// and its `(` (matches the name, skips whitespace, requires `(`). Strictly
// more-tolerant — it awaits more call shapes, never fewer, so the tight path is
// byte-identical.
//
// Reproduced: a mount body with an unbalanced-paren regex + a direct
// `@n = serverFn()` emitted `_scrml_reactive_set("n", _scrml_fetch_tag_N ( ))`
// with no await pre-fix.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "omesc-"));
function compile(src) {
  const d = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  const p = join(d, "app.scrml");
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: true, outputDir: join(d, "out") });
  const g = (f) => (existsSync(join(d, "out", f)) ? readFileSync(join(d, "out", f), "utf8") : "");
  return { errors: (r.errors ?? []).map((e) => e.code), client: g("app.client.js") };
}
const APP = (mountBody) => `<program>
<db src="notes.db" tables="notes">
\${
  <n>: string = ""
  function tag() ! { return ?{\`SELECT body FROM notes\`}.get() }
  on mount {
${mountBody}
  }
}
<page>{@n}</page>
</db>
</program>
`;

// A `_scrml_reactive_set("n", _scrml_fetch_tag_N ...)` whose fetch value is NOT
// preceded by `await` is the fail-open bug (a Promise bound into the cell).
const hasBareDirectSet = (client) =>
  /_scrml_reactive_set\("n",\s*_scrml_fetch_tag\w*\s*\(/.test(client);
const hasAwaitedDirectSet = (client) =>
  /_scrml_reactive_set\("n",\s*await\s+_scrml_fetch_tag\w*\s*\(/.test(client);

describe("on-mount spaced escape-hatch direct reactive-server write is awaited", () => {
  test("paren-bearing regex in the mount body → the SPACED direct set is awaited (fail-open closed)", () => {
    const r = compile(APP("    const re = /a(b/\n    @n = tag()"));
    expect(hasBareDirectSet(r.client)).toBe(false);   // no un-awaited spaced Promise
    expect(hasAwaitedDirectSet(r.client)).toBe(true); // lifted into the await-IIFE
  });

  test("regex-paren + spaced source call `@n = tag ()` → awaited", () => {
    const r = compile(APP("    const re = /x(y/\n    @n = tag ()"));
    expect(hasBareDirectSet(r.client)).toBe(false);
    expect(hasAwaitedDirectSet(r.client)).toBe(true);
  });
});

describe("the tight (non-escape-hatch) form is unchanged", () => {
  test("plain `@n = tag()` still awaited (regression guard)", () => {
    const r = compile(APP("    @n = tag()"));
    expect(hasBareDirectSet(r.client)).toBe(false);
    // The clean path uses the client-scope wrapper; assert the direct value is awaited.
    expect(/_scrml_(cs_)?reactive_set\("n",\s*await\s+_scrml_fetch_tag/.test(r.client)).toBe(true);
  });

  test("multi-statement clean mount body still awaited", () => {
    const r = compile(APP("    @n = tag()\n    @n = @n"));
    expect(hasBareDirectSet(r.client)).toBe(false);
  });
});
