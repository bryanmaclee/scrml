/**
 * gate-flip-and-residuals (S142) — Residual 2: a backtick template literal
 * containing an ESCAPED backtick (`\``) must tokenize as one balanced STRING
 * token; the escaped backtick must NOT close the template.
 *
 * ROOT CAUSE (stdlib/compiler/module-resolver.scrml byte 4328): the tokenizer's
 * readBacktickString() lacked backslash-escape handling (unlike readString()),
 * so `\`` inside a template was read as a *closing* backtick. For:
 *     const msg = `E-IMPORT-004: \`${name}\` is not exported by \`${source}\``
 * the template truncated at the first `\``, emitting:
 *     const msg = `E-IMPORT-004: \`;   ` is not exported by \`;
 * (invalid JS — the gate's E-CODEGEN-INVALID-LOGIC). The downstream `is not` →
 * `is !` rewrite then operated on the broken fragments. Both symptoms collapse
 * once the template tokenizes as a single STRING token.
 *
 * FIX: readBacktickString() copies `\\<char>` verbatim and advances past both,
 * mirroring readString(). The escaped backtick is preserved; the template stays
 * balanced; and because the template is now one STRING token, the `not` rewrite
 * (source-token-level, §42.1.1) never sees the string CONTENT as a bare token.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-escaped-backtick-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
}

function clientOf(result) {
  const invalid = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
  expect(invalid).toHaveLength(0);
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  expect(out?.clientJs).toBeTruthy();
  expect(() => acorn.parse(out.clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  return out.clientJs;
}

describe("escaped backtick inside a template literal stays balanced", () => {
  test("escaped backticks around interpolations + `not` prose (E-IMPORT-004 shape)", () => {
    const src = `function check(name, source) {
    const msg = \`E-IMPORT-004: \\\`\${name}\\\` is not exported by \\\`\${source}\\\`\`
    return msg
}`;
    const client = clientOf(compileSource(src));
    // The full template must survive intact: escaped backticks preserved,
    // interpolations preserved, `is not` NOT rewritten to `is !`.
    expect(client).toContain("\\`${name}\\`");
    expect(client).toContain("is not exported");
    expect(client).not.toContain("is !exported");
  });

  test("a single escaped backtick mid-template does not truncate the string", () => {
    const src = `function f() {
    const s = \`prefix \\\` suffix \${x} end\`
    return s
}`;
    const client = clientOf(compileSource(src));
    expect(client).toContain("prefix \\` suffix ${x} end");
  });

  test("`is not` in a plain double-quoted string is also preserved", () => {
    const src = `function g(name) {
    const s = "value is not exported"
    return s
}`;
    const client = clientOf(compileSource(src));
    expect(client).toContain("value is not exported");
    expect(client).not.toContain("is !exported");
  });
});
