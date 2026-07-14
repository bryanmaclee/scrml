/**
 * GITI-016 — `match` is a CONTEXTUAL keyword (bryan S241, Option A).
 *
 * A variable named `match` — the conventional regex-result name
 * (`const match = raw.match(/x/)`) — collided with the value-return `match expr
 * {}` keyword: `match is some ? …` mis-parsed and fired the MISLEADING
 * `E-SCOPE-001: Undeclared identifier 'is'` (the token pointed at was `is`, not
 * the real culprit `match`). Option A (user-ruled) makes `match` reserved ONLY in
 * the value-return / statement match-expression position
 *
 *     match <subject> { <arm> :> <body> … }
 *
 * where the brace block carries at least one top-level arm separator
 * (`:>` canonical, `=>` / `->` deprecated aliases — §18.2). Everywhere else it is
 * an ordinary identifier (mirrors the `to` §14.12 / `from` §21.3 contextual
 * keywords).
 *
 * Fix: a post-tokenization pass (`reclassifyContextualMatch`, tokenizer.ts)
 * demotes a `match` KEYWORD token to IDENT wherever it does not open a real
 * match-expression — every downstream match dispatch gates on `kind ===
 * "KEYWORD"`, so a demoted `match` flows through the ordinary expression path.
 * A parallel guard hardens the string-path `preprocessMatchExprs`
 * (expression-parser.ts) so a `match is some ? {…} : {…}` ternary no longer
 * mis-lowers on the wrong `{`.
 *
 * What this test locks in:
 *   - the R26 repro compiles clean (no E-SCOPE-001) and `match is some` lowers to
 *     the §42 absence check `(match !== null && match !== undefined)`;
 *   - the `m`-renamed control is unchanged;
 *   - all 6 brief edges;
 *   - a real value-return match still lowers (all three arm separators);
 *   - the token-level disambiguator directly;
 *   - the emitted `.client.js` is syntactically valid (`node --check`).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { tokenizeLogic, reclassifyContextualMatch } from "../../src/tokenizer.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/** Compile a scrml source string; return { errors, clientJs }. */
function compileSource(scrmlSource) {
  const tag = `giti-016-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      outDir: tmpDir,
      emitClient: true,
      emitServer: false,
    });
    let clientJs = "";
    for (const candidate of [
      resolve(tmpDir, "dist", `${tag}.client.js`),
      resolve(tmpDir, `${tag}.client.js`),
    ]) {
      try { clientJs = readFileSync(candidate, "utf8"); if (clientJs) break; } catch { /* next */ }
    }
    return { ...result, clientJs };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Hard errors only (drop warnings + the inferred-SPA program warning). */
function fatals(result) {
  return (result.errors ?? []).filter(
    (e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error",
  );
}

/** `node --check` the emitted client JS (strip the `// Requires` banner + any
 *  bare `import` lines so the runtime-global script body checks standalone). */
function nodeCheck(clientJs) {
  const body = clientJs
    .replace(/^\/\/ Requires:.*$/m, "")
    .replace(/^\s*import\s.*$/gm, "");
  const p = resolve(testDir, `_chk_${++tmpCounter}.client.js`);
  writeFileSync(p, body);
  try {
    execSync(`node --check ${p}`, { stdio: "pipe" });
    return { ok: true, err: "" };
  } catch (e) {
    return { ok: false, err: (e.stderr || e.stdout || "").toString() };
  } finally {
    try { rmSync(p, { force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Edge 1 — the R26 repro: `match` as the regex-result identifier
// ---------------------------------------------------------------------------

describe("Edge 1 — `match` identifier + `match is some ?` (the repro)", () => {
  const REPRO = `<program>
\${
    export function v(raw) {
        const match = raw.match(/x/)
        const name = match is some ? match[1] : "fb"
        return name
    }
}
</program>`;

  test("compiles clean — no E-SCOPE-001", () => {
    const r = compileSource(REPRO);
    const errs = fatals(r);
    expect(errs.map((e) => e.code)).not.toContain("E-SCOPE-001");
    expect(errs).toEqual([]);
  });

  test("`match is some` lowers to `(match !== null && match !== undefined) ? …`", () => {
    const r = compileSource(REPRO);
    expect(r.clientJs).toContain("match !== null && match !== undefined");
    // the identifier `match` is preserved (regex-result decl intact)
    expect(r.clientJs).toMatch(/const match = raw\.match\(/);
  });

  test("emitted .client.js is syntactically valid (node --check)", () => {
    const r = compileSource(REPRO);
    const chk = nodeCheck(r.clientJs);
    expect(chk.ok).toBe(true);
  });

  test("control — the `m`-renamed variant compiles clean (unchanged)", () => {
    const CONTROL = `<program>
\${
    export function v(raw) {
        const m = raw.match(/x/)
        const name = m is some ? m[1] : "fb"
        return name
    }
}
</program>`;
    expect(fatals(compileSource(CONTROL))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge 2 — a real value-return match still works (all 3 arm separators)
// ---------------------------------------------------------------------------

describe("Edge 2 — a real value-return match still lowers", () => {
  for (const sep of [":>", "=>", "->"]) {
    test(`value-return match with \`${sep}\` arms lowers to the if/else IIFE`, () => {
      const src = `<program>
\${ type Phase:enum = { Idle, Done } }
<phase>: Phase = .Idle
const <label> = match @phase {
  .Idle ${sep} "i"
  .Done ${sep} "d"
}
<p id="l">\${@label}</p>
</program>`;
      const r = compileSource(src);
      expect(fatals(r)).toEqual([]);
      // real match → the match-lowering IIFE (NOT a bare `= match;` identifier)
      expect(r.clientJs).toMatch(/_scrml_match_\d+ === "Idle"/);
      expect(r.clientJs).not.toMatch(/=\s*match\s*;/);
      expect(nodeCheck(r.clientJs).ok).toBe(true);
    });
  }

  test("value-return match inside a function body (`:>` arms)", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Done }
  export function pick(p: Phase) {
    return match p { .Idle :> "i"  .Done :> "d" }
  }
}
</program>`;
    const r = compileSource(src);
    expect(fatals(r)).toEqual([]);
    expect(r.clientJs).toMatch(/"i"|"d"/);
  });
});

// ---------------------------------------------------------------------------
// Edge 3 — `match` as param / member / call / index / assignment
// ---------------------------------------------------------------------------

describe("Edge 3 — `match` used as an ordinary identifier", () => {
  const cases = {
    "fn param":      `export function f(match) { return match.x }`,
    "member obj.match": `export function g(obj) { return obj.match }`,
    "call raw.match(re)": `export function h(raw, re) { return raw.match(re) }`,
    "array index match[1]": `export function i(match) { return match[1] }`,
    "assignment target": `export function j() { let match = 1\n match = match + 1\n return match }`,
  };
  for (const [name, body] of Object.entries(cases)) {
    test(name, () => {
      const src = `<program>\n\${\n  ${body}\n}\n</program>`;
      expect(fatals(compileSource(src))).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge 4 — nested/inner `match` identifier inside a real match subject
// ---------------------------------------------------------------------------

describe("Edge 4 — inner `match` identifier co-located with a real match-expr", () => {
  test("a `match` identifier and a real value-return match coexist in one program", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Done }
  <phase>: Phase = .Idle
  const <label> = match @phase { .Idle :> "idle"  .Done :> "done" }
  export function v(raw) {
    const match = raw.match(/x/)
    const name = match is some ? match[1] : "fb"
    return name
  }
}
<p id="l">\${@label}</p>
</program>`;
    const r = compileSource(src);
    expect(fatals(r)).toEqual([]);
    // real match lowered
    expect(r.clientJs).toMatch(/idle|done/);
    // identifier `match` + its absence check both present
    expect(r.clientJs).toContain("match !== null && match !== undefined");
    expect(nodeCheck(r.clientJs).ok).toBe(true);
  });

  test("token-level: `match user.match { .A :> b }` keeps outer KEYWORD, demotes inner (member) to IDENT", () => {
    const toks = tokenizeLogic("match user.match { .Idle :> \"i\" }", 0, 1, 1, []);
    const matchToks = toks.filter((t) => t.text === "match");
    expect(matchToks).toHaveLength(2);
    expect(matchToks[0].kind).toBe("KEYWORD"); // the match-expression keyword
    expect(matchToks[1].kind).toBe("IDENT");   // `user.match` — member access
  });
});

// ---------------------------------------------------------------------------
// Edge 5 — `match {` with no `:>` (no subject) must not misfire
// ---------------------------------------------------------------------------

describe("Edge 5 — subject-less `match { … }` with no arm separator is an identifier", () => {
  test("`match` bound then returned in a block with braces — no misfire", () => {
    const src = `<program>
\${
  export function l() {
    let match = 1
    return match
  }
}
</program>`;
    expect(fatals(compileSource(src))).toEqual([]);
  });

  test("token-level: `match { a: 1 }` (object, no arm separator) → IDENT", () => {
    const toks = tokenizeLogic("const x = match { a: 1 }", 0, 1, 1, []);
    const mt = toks.find((t) => t.text === "match");
    expect(mt.kind).toBe("IDENT");
  });

  test("token-level: `match { }` (empty) → IDENT", () => {
    const toks = tokenizeLogic("return match { }", 0, 1, 1, []);
    const mt = toks.find((t) => t.text === "match");
    expect(mt.kind).toBe("IDENT");
  });
});

// ---------------------------------------------------------------------------
// Token-level disambiguator — reclassifyContextualMatch
// ---------------------------------------------------------------------------

describe("reclassifyContextualMatch — Option A token classification", () => {
  function matchKind(content) {
    const toks = tokenizeLogic(content, 0, 1, 1, []);
    return toks.find((t) => t.text === "match")?.kind;
  }

  test("real match-expr subjects stay KEYWORD", () => {
    expect(matchKind("match @phase { .Idle :> 1 }")).toBe("KEYWORD");
    expect(matchKind("const x = match p { .A :> 1  .B :> 2 }")).toBe("KEYWORD");
    expect(matchKind("match user.status { .A :> 1 }")).toBe("KEYWORD"); // member subject
  });

  test("identifier uses are demoted to IDENT", () => {
    expect(matchKind("const match = raw.match(/x/)")).toBe("IDENT");
    expect(matchKind("match is some ? match[1] : 0")).toBe("IDENT");
    expect(matchKind("obj.match")).toBe("IDENT");
    expect(matchKind("raw.match(re)")).toBe("IDENT");
    expect(matchKind("match[1]")).toBe("IDENT");
    expect(matchKind("function match(a, b) { return a }")).toBe("IDENT");
  });

  test("idempotent — running the pass twice is a no-op", () => {
    const toks = tokenizeLogic("match is some ? match[1] : 0", 0, 1, 1, []);
    const before = toks.map((t) => t.kind).join(",");
    reclassifyContextualMatch(toks);
    expect(toks.map((t) => t.kind).join(",")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// String-path hardening — preprocessMatchExprs (via parseExprToNode)
// ---------------------------------------------------------------------------

describe("preprocessMatchExprs hardening — raw-string path", () => {
  test("`match is some ? {a:1} : {b:2}` parses as a ternary, not a match-expr", () => {
    const node = parseExprToNode('match is some ? {a:1} : {b:2}', "/t.scrml", 0);
    expect(node.kind).toBe("ternary");
  });

  test("a real match string still lowers to a match-expr (all separators)", () => {
    for (const sep of [":>", "=>", "->"]) {
      const node = parseExprToNode(`match @level { .Low ${sep} "green"  .High ${sep} "red" }`, "/t.scrml", 0);
      expect(node.kind).toBe("match-expr");
    }
  });

  test("`obj.match` / `raw.match(re)` are member / call, not match-exprs", () => {
    expect(parseExprToNode("obj.match", "/t.scrml", 0).kind).toBe("member");
    expect(parseExprToNode("raw.match(re)", "/t.scrml", 0).kind).toBe("call");
  });
});
