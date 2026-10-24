/**
 * S469 r3 — g-impl1-expr-match-literal-alternation-first-alternate-dropped-s469 (HIGH, silent
 * miscompile; fixed in s469-impl1-arm-commas under the S435 security limb).
 *
 * An expression-position `match` arm whose pattern is a LITERAL alternation (`1 | 2 :> r`,
 * `"a" | "b" :> r`, `1 | "x" :> r`) reaches the codegen as raw arm text; `splitMultiArmString`
 * took the LAST alternate (`2 :>`) as the arm start and sliced the other alternates off, so the
 * subject `1` fell through to the next arm — exit 0, no diagnostic. The literal heads now read
 * through their `| literal` chain and an alternate is never an arm start (the guard the variant
 * branch already had).
 *
 * Matrix: number / string / mixed alternations of 2 and 3 alternates × every expression position
 * (`@cell = match`, `return match`, `const v = match`, derived cell, call argument, markup `${}`)
 * × newline / comma / mixed arm lists. All three spellings compile byte-identically, with no
 * error, and every alternate is lowered.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitMultiArmString } from "../../src/codegen/emit-control-flow.ts";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "match-lit-alt-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileAt(src, slot) {
  const dir = join(TMP, slot);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, src);
  // S469 r6 — the arm-split COVERAGE invariant, observed: a clean compile may lose no text in
  // any arm split (emit-control-flow.ts splitMultiArmString's opt-in audit).
  const audit = [];
  globalThis.__scrmlArmSplitAudit = audit;
  let r;
  try { r = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} }); }
  finally { globalThis.__scrmlArmSplitAudit = undefined; }
  if (!(r.errors || []).some((e) => /^E-/.test(e.code))) {
    expect(audit.filter((x) => !x.covered).map((x) => x.text)).toEqual([]);
  }
  const outs = {};
  let js = "";
  if (r.outputs instanceof Map) for (const [k, v] of r.outputs) { outs[k] = v; js += (v && v.clientJs) || ""; }
  return { codes: (r.errors || []).map((e) => e.code), out: JSON.stringify(outs), js };
}

// [name, subject type, initial value, alternates, the next literal arm's pattern]
// The subject is typed `number | string` in every row: a cell typed `number` / `string` / `int`
// alone is refused as a match subject in the const / derived / markup positions (E-TYPE-025
// "asIs-typed subject", a separate typer gap, measured S469 r3), which would mask this one.
const ALTS = [
  ["number ×2", "number | string", "1", ["1", "2"], "3"],
  ["number ×3", "number | string", "1", ["1", "2", "3"], "4"],
  ["string ×2", "number | string", `"a"`, [`"a"`, `"b"`], `"c"`],
  ["string ×3", "number | string", `"a"`, [`"a"`, `"b"`, `"c"`], `"d"`],
  ["mixed ×2", "number | string", "1", ["1", `"x"`], "3"],
  ["mixed ×3", "number | string", "1", [`"x"`, "1", `"y"`], "3"],
  // S469 r4 (final review F1) — a NEGATIVE later alternate lost its sign and every alternate
  // before it (`1 | -3 :>` emitted `=== 3`); spaced as the tokenizer joins it, too.
  ["negative later alternate", "number | string", "1", ["1", "-3"], "3"],
  ["negative later alternate, spaced", "number | string", "1", ["1", "- 3"], "3"],
  ["string then negative decimal", "number | string", "1", [`"a"`, "-1.5"], "2"],
  ["deny-list 0 | -1", "number | string", "1", ["0", "-1"], "1"],
];

const SEPS = { newline: ["", "", ""], comma: [",", ",", ","], mixed: [",", "", ","] };

/** The arm list, one arm per line, `sep[i]` after arm i, with arm arrow `ar`. */
const arms = (alts, next, sep, indent, ar = ":>") =>
  [`${alts.join(" | ")} ${ar} "low"${sep[0]}`, `${next} ${ar} "mid"${sep[1]}`, `_ ${ar} "hi"${sep[2]}`]
    .map((l) => indent + l).join("\n");

/** A literal as the dispatch compares it: `- 3` → `-3`, `"a"` → `"a"`. */
const norm = (lit) => (/^["']/.test(lit) ? JSON.stringify(lit.slice(1, -1)) : String(Number(lit.replace(/\s+/g, ""))));
/** The literal tests of each match dispatch in `js`, in order (`_scrml_match_N === lit`). */
function dispatchTests(js) {
  const g = {};
  const re = /(_scrml_(?:match|tag)_\d+) === ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\s*[\d.]+)/g;
  let m;
  while ((m = re.exec(js))) {
    if (m[2] === '"object"') continue;
    (g[m[1]] ??= []).push(norm(m[2]));
  }
  return Object.values(g).map((a) => a.join(" "));
}

const POSITIONS = {
  "@cell = match": (ty, init, a) => `<k>: ${ty} = ${init}
<n> = ""
\${
  function go() {
    @n = match @k {
${a("      ")}
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "return match": (ty, init, a) => `<k>: ${ty} = ${init}
<n> = ""
\${
  function pick(k: ${ty}) {
    return match k {
${a("      ")}
    }
  }
  function go() { @n = pick(@k) }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "const v = match": (ty, init, a) => `<k>: ${ty} = ${init}
<n> = ""
\${
  function go() {
    const v = match @k {
${a("      ")}
    }
    @n = v
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "derived cell": (ty, init, a) => `<k>: ${ty} = ${init}
<n> = match @k {
${a("  ")}
}
<p>\${@n}</>`,
  "derived const cell": (ty, init, a) => `<k>: ${ty} = ${init}
const <n> = match @k {
${a("  ")}
}
<p>\${@n}</>`,
  "call argument": (ty, init, a) => `<k>: ${ty} = ${init}
<n> = ""
\${
  function f(x) { return x }
  function go() {
    @n = f(match @k {
${a("      ")}
    })
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "markup \${}": (ty, init, a) => `<k>: ${ty} = ${init}
<p>\${match @k {
${a("  ")}
}}</p>`,
};

describe("literal alternation arms: every alternate is lowered, in every spelling, position and arrow", () => {
  let slot = 0;
  for (const ar of [":>", "->"]) {
    for (const [pos, page] of Object.entries(POSITIONS)) {
      for (const [an, ty, init, alts, next] of ALTS) {
        test(`${pos} — ${an} (${ar})`, () => {
          const id = `p-${++slot}`;
          const r = {};
          for (const [sn, sep] of Object.entries(SEPS)) {
            r[sn] = compileAt(page(ty, init, (ind) => arms(alts, next, sep, ind, ar)), id);
          }
          expect(r.newline.codes.filter((c) => !/^[WI]-/.test(c))).toEqual([]);
          expect(r.comma.codes).toEqual(r.newline.codes);
          expect(r.mixed.codes).toEqual(r.newline.codes);
          expect(r.comma.out).toBe(r.newline.out);
          expect(r.mixed.out).toBe(r.newline.out);
          // every dispatch compares exactly the written alternates, in order, then the next arm
          const want = [...alts, next].map(norm).join(" ");
          const seqs = dispatchTests(r.newline.js);
          expect(seqs.length).toBeGreaterThan(0);
          for (const seq of seqs) expect(seq).toBe(want);
        });
      }
    }
  }
});

describe("splitMultiArmString — a literal alternate is never an arm start", () => {
  const cases = [
    [`1 | 2 :> "low" 3 :> "mid"`, [`1 | 2 :> "low"`, `3 :> "mid"`]],
    [`1 | 2 | 3 :> "low" 4 :> "mid"`, [`1 | 2 | 3 :> "low"`, `4 :> "mid"`]],
    [`"a" | "b" :> "low" "c" :> "mid"`, [`"a" | "b" :> "low"`, `"c" :> "mid"`]],
    [`- 1 | 2 :> "n" 3 :> "p"`, [`- 1 | 2 :> "n"`, `3 :> "p"`]],
    [`1 | "x" :> "low" 3 :> "mid"`, [`1 | "x" :> "low"`, `3 :> "mid"`]],
    // `||` is logical or inside a body, not an alternation
    [`"a" :> p || q "b" :> 2`, [`"a" :> p || q`, `"b" :> 2`]],
    // S469 r4 — a negative later alternate is part of its head
    [`1 | -3 :> "neg" 3 :> "p"`, [`1 | -3 :> "neg"`, `3 :> "p"`]],
    [`1 | - 3 :> "neg" 3 :> "p"`, [`1 | - 3 :> "neg"`, `3 :> "p"`]],
    [`"a" | -1.5 :> "neg" 2 :> "p"`, [`"a" | -1.5 :> "neg"`, `2 :> "p"`]],
    // S469 r4 — a literal right after an arm arrow is that arm's BODY, never a head: the text
    // below is not split into a bogus `"one" | 2` alternation (it stays one arm, which the
    // lowering refuses — see the next describe)
    [`1 :> "one" | 2 :> "two"`, [`1 :> "one" | 2 :> "two"`]],
  ];
  for (const [s, want] of cases) test(s, () => expect(splitMultiArmString(s)).toEqual(want));
});

describe("fail closed: a body followed by `| literal :>` on the same line", () => {
  test("`@n = match @k { 1 :> \"one\" | 2 :> \"two\" }` is refused, never lowered as `\"one\" | 2`", () => {
    const r = compileAt(`<k>: number | string = 1
<n> = ""
\${
  function go() {
    @n = match @k { 1 :> "one" | 2 :> "two" }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`, "fc-1");
    expect(r.codes.some((c) => /^E-/.test(c))).toBe(true);
  });
});
