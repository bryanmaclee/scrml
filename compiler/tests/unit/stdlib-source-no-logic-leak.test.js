/**
 * stdlib-source-no-logic-leak — every stdlib `.scrml` module's logic survives
 * parsing as LOGIC (S441, change-id s441-stdlib-http-comment-leak).
 *
 * THE DEFECT CLASS. A `*\/` written inside a `/* … *\/` or `/** … *\/` block
 * comment closes that comment early (JS semantics: block comments do not nest).
 * Everything after the early close — the rest of the doc comment, and then real
 * code — is no longer comment. Inside a `${ … }` logic block the stray braces in
 * the leftover prose unbalance the block, the block splitter closes `${` early,
 * and the remainder of the module becomes MARKUP TEXT. Two stdlib modules shipped
 * this way:
 *
 *   - stdlib/http/index.scrml — `{ headers: { /* don't set Content-Type *\/ } }`
 *     in the `multipart` doc comment. `export function multipart` and
 *     `export async function uploadFile` were emitted as page text by a direct
 *     compile, and were ABSENT from the export table the compiler builds when a
 *     program imports `scrml:http` (api.js STDLIB-EXPORT-SEED). The observable
 *     consequence: `const r = uploadFile(url, f)` in client code was NOT
 *     auto-awaited (`r` was a Promise, `r.ok` undefined) while its sibling
 *     `retry` was.
 *   - stdlib/cron/index.scrml — the cron step pattern `"*\/15 * * * *"` in the
 *     `schedule` doc comment. All three exports (`schedule`, `nextOccurrence`,
 *     `stop`) were lost.
 *
 * The seed pass swallows parse errors by design (it is best-effort), so this
 * shape is SILENT on the import path. Hence this structural gate:
 *
 *   §1 EXPORT PARITY — every `export function|fn|const|let|type NAME` declared at
 *      the start of a source line is present in the parsed `ast.exports`.
 *   §2 NO PAGE TEXT — a module that declares exports contains no non-whitespace
 *      markup text node (its body is logic; any text is leaked code).
 *   §3 INSTRUMENT INTEGRITY — the pre-fix http and cron shapes are REPORTED by
 *      the same checker, so a checker that silently passes everything cannot
 *      stay green.
 *
 * Reference-only parse (splitBlocks + buildAST) — the same TAB-only path the
 * STDLIB-EXPORT-SEED stage uses. A full compile is not usable as the gate: some
 * stdlib sources reference host globals (`Bun`, `AbortController`) and legacy
 * try/throw that the full pipeline rejects independently of this defect.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { join, resolve, relative } from "path";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const STDLIB_ROOT = join(REPO_ROOT, "stdlib");

function* walkScrml(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkScrml(p);
    else if (e.name.endsWith(".scrml")) yield p;
  }
}

// `export [async] [pure] [server] (function|fn|const|let|type) NAME` at the
// start of a line. Doc-comment lines start with `*`, `//` lines with `/`, so
// neither matches — only a line the author wrote as code does.
const DECLARED_EXPORT_RE =
  /^[ \t]*export[ \t]+(?:async[ \t]+)?(?:pure[ \t]+)?(?:server[ \t]+)?(?:function|fn|const|let|type)[ \t]+([A-Za-z_$][\w$]*)/gm;

/** Structural check of one module's source. Returns the list of problems. */
function checkModule(filePath, src) {
  const tab = buildAST(splitBlocks(filePath, src));
  const exported = new Set((tab.ast.exports || []).map((e) => e.exportedName));
  const declared = [...src.matchAll(DECLARED_EXPORT_RE)].map((m) => m[1]);
  const problems = [];

  for (const name of declared) {
    if (!exported.has(name)) problems.push(`export \`${name}\` is declared in source but not parsed as an export`);
  }

  if (declared.length > 0) {
    const seen = new Set();
    const texts = [];
    (function walk(n) {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.kind === "text" && String(n.value ?? "").trim()) texts.push(String(n.value).trim());
      for (const k of Object.keys(n)) if (k !== "parent") walk(n[k]);
    })(tab.ast.nodes);
    for (const t of texts) problems.push(`page text in a logic module: ${JSON.stringify(t.slice(0, 80))}`);
  }
  // S441 (declared-prose-body): a `<program>` body carries no loose prose, so a
  // leaked tail is no longer silent page text — it is parsed as body-top code
  // and fails loudly (E-PARSE-001 / E-UNQUOTED-DISPLAY-TEXT). A parse error in a
  // stdlib module is the same defect class, so it is a problem too. Only the
  // two codes that mean "this is not code at all" count: the legacy
  // try/throw codes (E-*-NOT-IN-SCRML) some stdlib sources still carry are a
  // separate, pre-existing migration and are out of this gate's scope.
  for (const e of tab.errors || []) {
    if ((e.severity ?? "error") === "error" && (e.code === "E-PARSE-001" || e.code === "E-UNQUOTED-DISPLAY-TEXT")) {
      problems.push(`parse error in a logic module: ${e.code}`);
    }
  }
  return { declared, problems };
}

const MODULES = [...walkScrml(STDLIB_ROOT)].sort();

describe("stdlib sources — logic is parsed as logic (no early-closed block comment)", () => {
  test("the walk found the stdlib modules", () => {
    expect(MODULES.length).toBeGreaterThan(30);
  });

  for (const file of MODULES) {
    const rel = relative(REPO_ROOT, file);
    test(`§1/§2 ${rel}`, () => {
      const { problems } = checkModule(file, readFileSync(file, "utf8"));
      expect(problems).toEqual([]);
    });
  }

  test("the two S441 modules export what they declare", () => {
    const http = checkModule(join(STDLIB_ROOT, "http/index.scrml"), readFileSync(join(STDLIB_ROOT, "http/index.scrml"), "utf8"));
    expect(http.declared).toContain("multipart");
    expect(http.declared).toContain("uploadFile");
    expect(http.problems).toEqual([]);
    const cron = checkModule(join(STDLIB_ROOT, "cron/index.scrml"), readFileSync(join(STDLIB_ROOT, "cron/index.scrml"), "utf8"));
    expect(cron.declared).toEqual(["schedule", "nextOccurrence", "stop"]);
    expect(cron.problems).toEqual([]);
  });
});

describe("observable consequence — an importer of scrml:http", () => {
  test("`uploadFile` (declared after the pre-fix early close) is auto-awaited like `retry`", () => {
    const tmpDir = join("/tmp", `scrml-s441-http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
    const input = join(tmpDir, "app.scrml");
    writeFileSync(input, [
      "<program>",
      "    import { uploadFile, retry, multipart } from 'scrml:http'",
      "    <ok> = false",
      "    function send(f) {",
      "        const r = uploadFile(\"/up\", f)",
      "        @ok = r.ok",
      "    }",
      "    function send2() {",
      "        const r = retry(() => 1)",
      "        @ok = r.ok",
      "    }",
      "    function form() {",
      "        const fd = multipart({ name: \"alice\" })",
      "        @ok = fd.has(\"name\")",
      "    }",
      "<button onclick=send(1)>go</button>",
      "<p>${@ok}</p>",
      "</program>",
    ].join("\n"));
    try {
      const outDir = join(tmpDir, "out");
      const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
      const errs = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
      expect(errs.map((e) => e.code)).toEqual([]);
      const client = readFileSync(join(outDir, "app.client.js"), "utf8");
      expect(client).toMatch(/const r = await uploadFile\(/);
      expect(client).toMatch(/const r = await retry\(/);
      // multipart is sync — it must NOT be awaited, and must be destructured from the registry.
      expect(client).toMatch(/const fd = multipart\(/);
      expect(client).toMatch(/const \{[^}]*\bmultipart\b[^}]*\} = _scrml_stdlib\.http;/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("§3 instrument integrity — the checker reports the pre-fix shapes", () => {
  test("a nested `/* … */` inside a `/** … */` doc comment (pre-fix http) is reported", () => {
    const src = [
      "<program>",
      "${",
      "    export function first() { return 1 }",
      "    /**",
      "     * Example:",
      "     *   await post(\"/upload\", body, { headers: { /* don't set Content-Type */ } })",
      "     */",
      "    export function multipart(fields) {",
      "        return fields",
      "    }",
      "}",
      "</program>",
    ].join("\n");
    const { problems } = checkModule("/virtual/http-prefix.scrml", src);
    // Pre-S441 the leaked tail was silent page text and `multipart` was lost.
    // Since S441 (declared-prose-body) the tail is parsed as body-top code: the
    // leftover doc-comment prose is a loud parse error and `multipart` is
    // recovered. Either way the checker must REPORT the shape.
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith("parse error") || p.startsWith("page text") || p.includes("`multipart`"))).toBe(true);
  });

  test("a `*/` inside a string in a doc comment (pre-fix cron) is reported", () => {
    const src = [
      "<program>",
      "${",
      "    /**",
      "     * @param pattern — cron expression (e.g. \"0 * * * *\", \"*/15 * * * *\")",
      "     * @param handler — function called on each fire",
      "     */",
      "    export function schedule(pattern, handler) {",
      "        return handler",
      "    }",
      "    export function stop(job) {",
      "        return job",
      "    }",
      "}",
      "</program>",
    ].join("\n");
    const { problems } = checkModule("/virtual/cron-prefix.scrml", src);
    expect(problems.length).toBeGreaterThan(0);
  });

  test("the same modules with `//` doc lines pass (control)", () => {
    const src = [
      "<program>",
      "${",
      "    // Example: post(\"/upload\", body)  — pattern \"*/15 * * * *\"",
      "    export function multipart(fields) {",
      "        return fields",
      "    }",
      "}",
      "</program>",
    ].join("\n");
    expect(checkModule("/virtual/ok.scrml", src).problems).toEqual([]);
  });
});
