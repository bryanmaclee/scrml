/**
 * S469 (re-review of #1451) — an object SHORTHAND `{ session }` reads the §20.5
 * `session` builtin exactly as the longhand `{ session: session }` does.
 *
 * Before: three readers skipped the shorthand property node —
 *   - placement (free-name.ts `exprReadsFreeSession` / `markLocallyBoundSession`):
 *     a function whose only `session` use was `{ session }` was not server-placed,
 *     so it compiled to E-SCOPE-012 ("`session` … not reachable from a client-side
 *     function") instead of the longhand's E-SESSION-VALUE;
 *   - codegen (emit-expr.ts `emitProp`): a shorthand emitted the bare name without
 *     going through `emitIdent`, so in a function server-placed for another reason
 *     (`?{}`) `return { session }` compiled CLEAN and the route threw
 *     `ReferenceError: session is not defined` at request time (executed S469).
 * Neither exposed nor forged identity (a compile error / a 500), but both diverged
 * from the longhand. Now: server-placed, and E-SESSION-VALUE (§20.5: `session` is
 * not a first-class value) — no artifacts written.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { runRI } from "../../src/route-inference.ts";

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s469-session-sh-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const out = join(dir, "dist");
  let ri = null;
  const r = compileScrml({
    inputFiles: [file],
    write: true,
    outputDir: out,
    log: () => {},
    stageOverrides: { RI: (input) => { ri = runRI(input); return ri; } },
  });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
  const boundary = (name) => {
    const hits = [...ri.routeMap.functions.values()].filter((x) => x.functionName === name);
    expect(hits.length).toBe(1);
    return hits[0].boundary;
  };
  const artifacts = existsSync(out) ? readdirSync(out) : [];
  return { errors, codes: [...new Set(errors.map((e) => e.code))], boundary, artifacts };
}

const prog = (fnBody) => `<program db="./app.db" auth="required">
  <last> = ""
  function me() {
${fnBody}
  }
  function go() { @last = JSON.stringify(me()) }
  <button onclick=go()>a</button>
  <p>\${@last}</p>
</program>
`;

const shapes = {
  "a local `const ctx = { session }` + `ctx.session.userId`": [`    const ctx = { session }\n    return ctx.session.userId`, `    const ctx = { session: session }\n    return ctx.session.userId`],
  "inline `{ session }.session.userId`": [`    return { session }.session.userId`, `    return { session: session }.session.userId`],
  "`return { session }` in a function server-placed by `?{}`": [`    ?{\`SELECT 1\`}.run()\n    return { session }`, `    ?{\`SELECT 1\`}.run()\n    return { session: session }`],
  "mixed with other fields `{ a: 1, session }`": [`    return { a: 1, session }.a`, `    return { a: 1, session: session }.a`],
};

describe("S469 — `{ session }` is `{ session: session }` (placement + E-SESSION-VALUE)", () => {
  for (const [label, [shorthand, longhand]] of Object.entries(shapes)) {
    test(`${label}: server-placed and refused exactly as the longhand`, () => {
      const s = compile(prog(shorthand));
      const l = compile(prog(longhand));
      expect(l.boundary("me")).toBe("server");
      expect(s.boundary("me")).toBe("server");
      expect(l.codes).toEqual(["E-SESSION-VALUE"]);
      expect(s.codes).toEqual(["E-SESSION-VALUE"]);
      expect(s.codes).not.toContain("E-SCOPE-012");
      // a refused compile writes nothing — no client copy, no server route
      expect(s.artifacts).toEqual([]);
    });
  }

  test("a parameter named `session` is the author's value — `{ session }` of it stays client and compiles", () => {
    const r = compile(`<program>
  <last> = ""
  function wrap(session) { return { session } }
  function go() { @last = JSON.stringify(wrap("x")) }
  <button onclick=go()>a</button>
  <p>\${@last}</p>
</program>
`);
    expect(r.boundary("wrap")).toBe("client");
    expect(r.codes).toEqual([]);
  });

  test("an ordinary shorthand still emits as a shorthand (`{ a, b }`)", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-s469-session-sh-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, `<program>
  <last> = ""
  function pair(a, b) { return { a, b } }
  function go() { @last = JSON.stringify(pair("x", "y")) }
  <button onclick=go()>a</button>
  <p>\${@last}</p>
</program>
`);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    const clientJs = [...(r.outputs?.values?.() ?? [])].map((o) => o.clientJs ?? "").join("\n");
    expect(clientJs).toMatch(/\{\s*a,\s*b\s*\}/);
  });
});
