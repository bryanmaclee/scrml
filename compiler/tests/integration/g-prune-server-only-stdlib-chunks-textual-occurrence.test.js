/**
 * g-prune-server-only-stdlib-chunks-keeps-chunk-on-textual-occurrence (S361-peter)
 *
 * The server-only-stdlib chunk-prune (emit-client.ts `prune-server-only-stdlib-
 * chunks`) and the sibling read-line prune decided keep/drop by scanning the
 * assembled client body with a word-boundary regex for each bound name — over
 * RAW text. A stdlib name appearing only inside a display STRING LITERAL — an
 * ordinary UI label like `"call hashPassword on the server"` — read as a genuine
 * client use, so the server-only `stdlib-auth` chunk (argon2id / `Bun.password.*`)
 * was KEPT and shipped to the browser on a pure textual coincidence: a §12
 * hard-split violation, silent (exit 0), triggered by editing a label string.
 *
 * Fix: mask string-literal bodies (maskStringLiteralSpans, offset-preserving,
 * template-aware) before the usage scan at BOTH prune sites. A name inside a
 * string body counts as nothing; a real member/interpolation use still counts.
 *
 * These pins are two-sided: the leak closes (§1/§2) AND a genuine client use is
 * NOT over-stripped (§3), including the sharp template body-vs-interpolation case
 * (§4). §5 unit-tests the masker directly.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { maskStringLiteralSpans } from "../../src/codegen/utils.ts";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "g-stdlib-prune-textual-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function findRuntimeFile(outDir) {
  return readdirSync(outDir).find(
    (f) => f.startsWith("scrml-runtime") && f.endsWith(".js"),
  );
}

function compile(relDir, source) {
  const src = fx(`${relDir}/app.scrml`, source);
  const outDir = join(TMP, `${relDir}/dist`);
  const result = compileScrml({ inputFiles: [src], outputDir: outDir, write: true, log: () => {} });
  const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
  const runtimeJs = readFileSync(join(outDir, findRuntimeFile(outDir)), "utf8");
  return { result, clientJs, runtimeJs };
}

// `hashPassword` (scrml:auth) is used ONLY inside a server-escalated fn, so the
// client lowers its call to a fetch stub and never references the binding — the
// `stdlib-auth` chunk (Bun.password.*) is genuinely server-only. The ONLY client
// text mentioning the name is the display label string.
const LEAK = `<program>
\${ import { hashPassword } from 'scrml:auth' }
<pw> = "secret"
<hashed> = ""
<label> = "call hashPassword on the server"
\${ function computeHash(pw) { return hashPassword(pw) } }
<button id="go" onclick={ @hashed = computeHash(@pw) }>Hash</button>
<div id="lbl">\${@label}</div>
<div id="out">\${@hashed}</div>
</program>
`;

describe("g-prune-server-only-stdlib-chunks — a stdlib name in a display string does not keep the chunk", () => {
  test("§1  server-only stdlib-auth is NOT shipped to the client on a string-literal mention", () => {
    const { result, runtimeJs } = compile("s1", LEAK);
    expect(result.errors).toEqual([]);
    // The whole point: argon2id / Bun.password.* must not reach the browser.
    expect(runtimeJs).not.toContain("Bun.password");
    expect(runtimeJs).not.toContain("--- chunk: stdlib-auth ---");
  });

  test("§2  the sibling read-line prune also drops the dangling `_scrml_stdlib.auth` decl (label text survives)", () => {
    const { clientJs } = compile("s2", LEAK);
    // read-decl removed (would be `undefined` on the client — a TypeError at load)
    expect(clientJs).not.toContain("_scrml_stdlib.auth");
    // but the legitimate display label is untouched
    expect(clientJs).toContain("call hashPassword on the server");
  });

  test("§3  a GENUINE client use of a stdlib chunk is NOT over-stripped", () => {
    const GENUINE = `<program>
\${ import { randomUUID } from 'scrml:random' }
<id> = ""
<button id="go" onclick={ @id = randomUUID() }>Gen</button>
<div id="out">\${@id}</div>
</program>
`;
    const { clientJs } = compile("s3", GENUINE);
    // the read-decl and the real call both survive → chunk kept
    expect(clientJs).toContain("_scrml_stdlib.random");
    expect(clientJs).toMatch(/randomUUID\s*\(/);
  });

  test("§4  selective prune in one file: string-only auth drops, genuinely-used random keeps", () => {
    const MIX = `<program>
\${ import { hashPassword } from 'scrml:auth' }
\${ import { randomUUID } from 'scrml:random' }
<pw> = "x"
<hashed> = ""
<uid> = ""
<note> = "a note about the hashPassword feature"
\${ function computeHash(pw) { return hashPassword(pw) } }
<button id="b1" onclick={ @hashed = computeHash(@pw) }>hash</button>
<button id="b2" onclick={ @uid = randomUUID() }>uid</button>
<div id="n">\${@note}</div>
<div>\${@hashed}</div><div>\${@uid}</div>
</program>
`;
    const { result, clientJs, runtimeJs } = compile("s4", MIX);
    expect(result.errors).toEqual([]);
    // auth appears only in a server-fn body + a display STRING → pruned
    expect(runtimeJs).not.toContain("Bun.password");
    expect(clientJs).not.toContain("_scrml_stdlib.auth");
    // random is genuinely called client-side → kept (selective, same file)
    expect(clientJs).toContain("_scrml_stdlib.random");
    // the label text itself is preserved
    expect(clientJs).toContain("a note about the hashPassword feature");
  });
});

describe("maskStringLiteralSpans — masks string bodies, preserves offsets and `${...}` interpolations", () => {
  test("blanks a double-quoted body to equal-length spaces, code outside intact", () => {
    const input = `const a = hashPassword; const s = "call hashPassword here";`;
    const out = maskStringLiteralSpans(input);
    expect(out.length).toBe(input.length); // offset-preserving
    // the identifier use outside the string survives
    expect(out).toContain("const a = hashPassword;");
    // the occurrence inside the string body is gone
    expect(out).not.toContain("call hashPassword here");
    // a word-boundary scan now finds the real use once, not the string mention
    const hits = (out.match(/\bhashPassword\b/g) || []).length;
    expect(hits).toBe(1);
  });

  test("preserves a template `${...}` interpolation as real code", () => {
    const input = "const t = `label ${randomUUID()} tail`;";
    const out = maskStringLiteralSpans(input);
    expect(out.length).toBe(input.length);
    expect(out).toContain("randomUUID()"); // interpolation code kept
    expect(out).not.toContain("label"); // surrounding string body masked
    expect(out).not.toContain("tail");
  });

  test("handles escapes and adjacent strings without desync", () => {
    const input = `f("a\\"b", real); g('x', other);`;
    const out = maskStringLiteralSpans(input);
    expect(out.length).toBe(input.length);
    expect(out).toContain("real");
    expect(out).toContain("other");
    expect(out).not.toContain("a\\\"b");
  });
});
