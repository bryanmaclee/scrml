/**
 * browser-mutation-arg-string-fuzz.test.js — no string literal's CONTENT may be
 * rewritten on the emit paths the S429 parser fix touched.
 *
 * Round 2 of fix/s429-mutation-arg-string-quotes. Round 1 restored the quotes
 * on §6.5.1 mutation arguments and C-style `for` headers; two of those paths
 * still emitted from RAW TEXT through the `rewriteExpr` text passes, which do
 * not skip string literals — so strings that used to fail LOUD (unquoted) now
 * compiled clean with their contents rewritten:
 *
 *   @xs.push("use fn here", 1)            → "use function here"
 *   @xs.push("Point { x: 1 }", 1)         → "{ x: 1 }"
 *   @xs.push(`navigate(${1})`, 1)         → `_scrml_navigate_soft(${1})`
 *   for (let t = "fn"; …)                 → let t = "function"
 *   for (let q = "x + +y"; …)             → "x++y"   (the `+ +` text normaliser)
 *
 * FUZZ: every client `rewriteExpr` pass (rewrite.ts clientPasses) plus the
 * for-header `+ +`/`- -` normaliser and the `;` header split, each as the TEXT
 * of a string literal, through every touched path:
 *   - multi-argument mutation, single argument, single spread, splice;
 *   - C-style for INIT (a `let` declaration), COND and UPDATE;
 *   - a computed bracket-index write `@m[<string> + ""] = …`;
 *   - `@set(@o, "k", <string>)`;
 * in double-quoted, single-quoted and backtick-template form. The ORACLE is the value the same literal
 * has in a plain `const` in the same program (`<ref>`); for all but four
 * triggers that is the string itself, which is asserted too.
 *
 * PRE-EXISTING, NOT THESE PATHS (recorded, S429): four triggers are rewritten
 * inside a string literal EVERYWHERE — a plain `const c = ["…"]` included — on
 * origin/main: `<#w>` (worker ref), `<#field>` (input state), `?{…}` (SQL
 * block), `Color::Red` (`::`); and `match x { .A => 1 }` does not compile at
 * all. They sit upstream of the argument collectors, so here they are held to
 * the plain-const oracle only (and `match` is excluded).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-mutation-arg-string-fuzz");

// One trigger per client rewrite pass (rewrite.ts clientPasses), plus the
// C-style header normaliser / splitter and a few JS-syntax look-alikes.
const TRIGGERS = [
  ["presence-guard", "(x) => { y }"],
  ["not-keyword", "is not"],
  ["not-bare", "not"],
  ["is-some", "x is some"],
  ["or/and", "a or b and c"],
  ["render", "render(card)"],
  ["worker", "<#w>.send(1)"],
  ["request", "request.body"],
  ["input-state", "<#field>.value"],
  ["sql", "?{select 1}"],
  ["toEnum", "Color.toEnum(x)"],
  ["struct", "Point { x: 1 }"],
  ["transition", "transition(x)"],
  ["replay", "replay(@a, @b)"],
  ["reset", "reset(@a)"],
  ["reactive-ref", "@count"],
  ["reactive-assign", "@count = 1"],
  ["navigate", "navigate(1)"],
  ["is-operator", "a is .Red"],
  ["transitions-block", "transitions { }"],
  ["enum-access", "Color::Red"],
  ["fn", "use fn here"],
  ["fn-call", "fn(x) { x }"],
  ["inline-fn", "function() { @x = 1 }"],
  ["equality", "a == b != c"],
  ["plus-plus", "x + +y"],
  ["minus-minus", "x - -y"],
  ["semicolon", "a;b"],
  ["comment-open", "/* c */"],
];

// Rewritten inside ANY string literal on origin/main (see header) — oracle-only.
const REWRITTEN_EVERYWHERE = new Set(["worker", "input-state", "sql", "enum-access"]);

const quoteDouble = (s) => JSON.stringify(s);
const quoteSingle = (s) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
// No trigger contains `${` or a backtick, so a template needs no escaping.
const quoteTemplate = (s) => "`" + s + "`";

function program(L) {
  return `<program>
  <out> = []
  <m> = { }
  <o> = { k: "" }
  <ref> = []
  \${
    const c = [${L}]
    @ref = c
    @out.push(${L}, 1)
    @out.push(${L})
    @out.push(...[${L}])
    @out.splice(@out.length, 0, ${L}, 2)
    for (let v = ${L}; v == ${L}; v = ${L} + "!") { @out.push(v) }
    @set(@o, "k", ${L})
    @m[${L} + ""] = 3
  }
  <p>\${@out.length}</p>
</program>
`;
}

function compileAndRun(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    if (errors.length) return { errors: errors.map((e) => `${e.code} ${e.message}`) };
    const html = readFileSync(resolve(outDir, "app.html"), "utf8");
    const clientJs = readFileSync(resolve(outDir, "app.client.js"), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    document.body.innerHTML = (body ? body[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    let threw = null;
    try {
      new Function(
        "window",
        "document",
        `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__fz_get__ = _scrml_reactive_get;\n`),
      )(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      threw = String(e);
    }
    const get = (n) => JSON.parse(JSON.stringify(globalThis.__fz_get__(n)));
    return { errors: [], threw, out: get("out"), m: get("m"), o: get("o"), ref: get("ref") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("string-literal CONTENT survives every touched emit path (fuzz)", () => {
  beforeAll(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterAll(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  for (const [name, S] of TRIGGERS) {
    for (const [qname, quote] of [["double", quoteDouble], ["single", quoteSingle], ["template", quoteTemplate]]) {
      test(`${name} (${qname}-quoted): ${JSON.stringify(S)}`, () => {
        const r = compileAndRun(program(quote(S)));
        expect(r.errors).toEqual([]);
        expect(r.threw).toBeNull();
        // push(S, 1) · push(S) · push(...[S]) · splice(.., S, 2) · for-init/cond/update body v
        const [C] = r.ref; // the plain-const value of the same literal
        if (!REWRITTEN_EVERYWHERE.has(name)) expect(C).toBe(S);
        expect(r.out).toEqual([C, 1, C, C, C, 2, C]);
        expect(r.m).toEqual({ [C]: 3 });
        expect(r.o).toEqual({ k: C });
      });
    }
  }
});
