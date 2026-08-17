/**
 * §40.3 / §39.3.2 — the Bun HTTP vocabulary in logic scope, and the
 * `globalThis.<name>` resolution rule.
 *
 * TWO defects, one walker:
 *
 *   1. `Response` / `Request` / `Headers` / `Blob` / `File` / `FormData` were not
 *      on LOGIC_SCOPE_GLOBAL_ALLOWLIST, so SPEC §39.3.5's OWN worked example —
 *
 *          return new Response("Forbidden", { status: 403 })
 *
 *      — fired a spurious E-SCOPE-001. §39.3.2 is normative that "the return type
 *      of `handle` is `Response`", so the language required a name the scope
 *      check refused.
 *
 *   2. `globalThis` WAS allowlisted and the walker checks only the leftmost base
 *      of a member chain, so `globalThis.<literally anything>` compiled clean.
 *      That is a hole in a check whose entire job is to refuse names that resolve
 *      to nothing — and it was load-bearing for a confidentiality leak, because
 *      `new globalThis.Response(...)` ALSO slipped the E-PROTECT-004 source-text
 *      regex while bare `new Response(...)` did not.
 *
 * The two are one fix: both spellings of a global now resolve through ONE ladder.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-logic-scope-http-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
}

function diagnostics(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? []), ...(result.lintDiagnostics ?? [])];
}

function scopeErrorsMentioning(result, needle) {
  return diagnostics(result).filter(
    (d) => d.code === "E-SCOPE-001" && String(d.message ?? "").includes(needle),
  );
}

const program = (body) => `<program>
  \${
${body}
  }
  <div><p>hi</p></div>
</program>`;

describe("§39.3.2 — the Bun HTTP vocabulary is in logic scope", () => {
  // The SPEC's own §39.3.5 example, verbatim modulo the guard call.
  test("SPEC §39.3.5's own `handle()` early-return example does not fire E-SCOPE-001", () => {
    const result = compileSource(`<program>
  \${ function handle(request, resolve) {
      if (request.method == "TRACE") {
        return new Response("Forbidden", { status: 403 })
      }
      return resolve(request)
  } }
  <div><p>hi</p></div>
</program>`);
    expect(scopeErrorsMentioning(result, "Response")).toEqual([]);
  });

  for (const name of ["Response", "Request", "Headers", "Blob", "File", "FormData"]) {
    test(`bare \`${name}\` resolves in logic scope`, () => {
      const result = compileSource(program(`    function f(x) {\n      return new ${name}()\n    }`));
      expect(scopeErrorsMentioning(result, `\`${name}\``)).toEqual([]);
    });

    test(`\`globalThis.${name}\` resolves identically to the bare form`, () => {
      const result = compileSource(program(`    function f(x) {\n      return new globalThis.${name}()\n    }`));
      expect(scopeErrorsMentioning(result, name)).toEqual([]);
    });
  }
});

describe("`globalThis.<name>` resolves through the same ladder as the bare form", () => {
  // THE BITE. Before the fix this compiled clean — `globalThis` is allowlisted
  // and the walker never looked past the base.
  test("a TYPO behind `globalThis.` is refused (was: silently accepted)", () => {
    const result = compileSource(program(`    function f(x) {\n      return new globalThis.Respones(x)\n    }`));
    const hits = scopeErrorsMentioning(result, "globalThis.Respones");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).toContain("addresses the global scope by name");
  });

  test("the bare spelling of the same typo is refused too — one rule, two spellings", () => {
    const bare = compileSource(program(`    function f(x) {\n      return new Respones(x)\n    }`));
    const qualified = compileSource(program(`    function f(x) {\n      return new globalThis.Respones(x)\n    }`));
    expect(scopeErrorsMentioning(bare, "Respones").length).toBeGreaterThan(0);
    expect(scopeErrorsMentioning(qualified, "Respones").length).toBeGreaterThan(0);
  });

  test("a `globalThis.<local>` read of a name bound in scope resolves (no false positive)", () => {
    const result = compileSource(program(
      `    function f(x) {\n      const helper = 1\n      return globalThis.helper + x\n    }`,
    ));
    expect(scopeErrorsMentioning(result, "globalThis.helper")).toEqual([]);
  });

  test("`_`-prefixed runtime helpers behind `globalThis.` keep their exemption", () => {
    const result = compileSource(program(`    function f(x) {\n      return globalThis._scrml_thing\n    }`));
    expect(scopeErrorsMentioning(result, "_scrml_thing")).toEqual([]);
  });

  // MEASURED, not assumed: `window.` is NOT resolved this way. The corpus uses
  // `window.addEventListener` / `window.dispatchEvent` / `window.__cmMod`, none
  // of which are logic-scope globals, so extending the rule to `window` would be
  // newly-rejecting on real source. Pinned so a later "make it symmetric" edit
  // has to argue with a test instead of with a comment.
  test("`window.<non-global>` is deliberately NOT resolved (DOM surface, no model)", () => {
    const result = compileSource(program(
      `    function f(x) {\n      window.addEventListener("x", x)\n      return 1\n    }`,
    ));
    expect(scopeErrorsMentioning(result, "addEventListener")).toEqual([]);
  });
});
