/**
 * S469 — impl#1 ACCEPTS `,` between arms (dpa-073 F2 "Comma list", F5(1) "impl#1 ACCEPTS
 * arm commas"; SPEC §18.2 "The arm list is a comma list", §19.4.5, §51.0.S.2.3).
 * Gap: g-impl1-arm-commas-refused-owed-by-dpa-073-f5-s469.
 *
 * The contract pinned here:
 *   1. `,` separates arms in every arm list impl#1 reads — a `match` (statement, value,
 *      `return`, `const`, markup `${…}`, call argument, derived cell, engine `derived=`),
 *      a `!{}` handler, an engine message-arm list — for every arm form (variant, payload
 *      binder, literal, alternation, `else` / `_`, `not`, `given`, product, block, leaving
 *      arms). The trailing `,` is optional.
 *   2. The comma list compiles to EXACTLY the same output as the newline list (and the
 *      newline list stays accepted — impl#1's carried divergence; it never enforces
 *      commas). A list mixing the two is read the same.
 *   3. A `,` inside an arm body (call arguments, an object literal, a string, a template,
 *      a product pattern, a nested arm list) is the body's own and never ends the arm; a
 *      depth-0 `,` ends the arm body — it is never read as a JS comma operator.
 *   4. Fail closed: a leading `,`, a doubled `,,`, and a comma sequence left inside an arm
 *      body are E-PARSE-001.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { parseMessageArms } from "../../src/engine-statechild-parser.ts";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "arm-commas-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

/** Compile at a FIXED path (the emit carries a path-derived hash) → { codes, out }. */
function compileAt(src, slot) {
  const dir = join(TMP, slot);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, src);
  const r = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const outs = {};
  if (r.outputs instanceof Map) for (const [k, v] of r.outputs) outs[k] = v;
  return { codes: (r.errors || []).map((e) => e.code), out: JSON.stringify(outs) };
}

/** `@@` marks an arm separator: "" for the newline list, "," for the comma list. */
function bothSpellings(template, slot) {
  const lines = compileAt(template.replace(/@@/g, ""), slot);
  const commas = compileAt(template.replace(/@@/g, ","), slot);
  return { lines, commas };
}

function parse(src) {
  return buildAST(splitBlocks("/t/app.scrml", src));
}
function matchNodes(tab) {
  const seen = [];
  (function walk(list) {
    for (const n of list || []) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "match-stmt" || n.kind === "match-expr") seen.push(n);
      walk(n.children);
      walk(n.body);
      if (n.matchExpr) walk([n.matchExpr]);
    }
  })(tab.ast?.nodes ?? []);
  return seen;
}
const armKinds = new Set(["match-arm-inline", "match-arm-block", "given-guard"]);
const armsOf = (m) => m.body.filter((a) => a && armKinds.has(a.kind));

// ---------------------------------------------------------------------------
// §1 — every arm form, newline list vs comma list: identical output, no errors
// ---------------------------------------------------------------------------

const SAME_OUTPUT = {
  "value match, string-literal arms": `<k> = "a"
<n> = 0
\${
  function go() {
    @n = match @k {
      "a" :> 1@@
      "b" :> 2@@
      else :> 3@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "value match, variant + payload-binder arms": `type Phase:enum = { Idle, Busy, Done(code: number) }
<phase>:Phase = .Idle
\${
  function toggle() {
    @phase = match @phase {
      .Idle :> .Busy@@
      .Busy :> .Done(1)@@
      .Done(c) :> .Idle@@
    }
  }
}
<button onclick=toggle()>Toggle</>
<p>\${@phase}</>`,
  "statement match, block arms (payload binder, else)": `type Phase:enum = { Idle, Busy, Done(code: number) }
<phase>:Phase = .Idle
<n> = 0
\${
  function toggle() {
    match @phase {
      .Idle :> { @n = 1; @phase = .Busy }@@
      .Done(c) :> { @n = c }@@
      else :> { @n = 9 }@@
    }
  }
}
<button onclick=toggle()>Toggle</>
<p>\${@n}</>`,
  "statement match, block arms on ONE line": `type Phase:enum = { Idle, Busy, Done(code: number) }
<phase>:Phase = .Idle
<n> = 0
\${
  function toggle() {
    match @phase { .Idle :> { @n = 1 }@@ .Busy :> { @n = 2 }@@ .Done(c) :> { @n = c }@@ }
  }
}
<button onclick=toggle()>Toggle</>
<p>\${@n}</>`,
  "`not` arm": `<k>: string | not = not
<n> = 0
\${
  function go() {
    @n = match @k {
      not :> 0@@
      "x" :> 1@@
      else :> 2@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "variant alternation arm": `type A:enum = { X, Y, Z }
<a>:A = .X
<n> = 0
\${
  function go() {
    @n = match @a {
      .X | .Y :> 1@@
      .Z :> 2@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "named-field payload binder": `type S:enum = { Rect(w: number, h: number), Dot }
<s>:S = .Dot
<n> = 0
\${
  function go() {
    @n = match @s {
      .Rect(w: a, h: b) :> a * b@@
      .Dot :> 0@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "block arm with a two-name binder": `type S:enum = { Rect(w: number, h: number), Dot }
<s>:S = .Dot
<n> = 0
\${
  function go() {
    match @s {
      .Rect(a, b) :> { @n = a * b }@@
      .Dot :> { @n = 0 }@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "multi-scrutinee product arms": `type A:enum = { X, Y }
<a>:A = .X
<b>:A = .Y
<n> = 0
\${
  function go() {
    match (@a, @b) {
      (.X, .X) :> { @n = 1 }@@
      (.X, .Y) :> { @n = 2 }@@
      (_, _) :> { @n = 3 }@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "partial match": `type A:enum = { X, Y, Z }
<a>:A = .X
<n> = 0
\${
  function go() {
    partial match @a {
      .X :> { @n = 1 }@@
      .Y :> { @n = 2 }@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "leaving arms (`return`, `fail`)": `type E:enum = { Bad(m: string) }
type Phase:enum = { Idle, Busy, Done }
<phase>:Phase = .Idle
<n> = 0
\${
  function go() ! E {
    match @phase {
      .Idle :> return 1@@
      .Busy :> fail .Bad("x")@@
      .Done :> { @n = 2 }@@
    }
    return 0
  }
  function run() { go() !{ .Bad(m) :> { @n = 9 } } }
}
<button onclick=run()>go</>
<p>\${@n}</>`,
  "`return match`": `<k> = "a"
<n> = 0
\${
  function pick(k: string) {
    return match k {
      "a" :> 1@@
      else :> 2@@
    }
  }
  function go() { @n = pick(@k) }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "markup \`\${match}\`": `type Phase:enum = { Idle, Busy }
<phase>:Phase = .Idle
<p>\${match @phase { .Idle :> "idle"@@ .Busy :> "busy"@@ }}</>`,
  "match as a call argument": `<k> = "a"
<n> = 0
\${
  function f(x) { return x }
  function go() {
    @n = f(match @k { "a" :> 1@@ else :> 2 })
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "derived cell": `type A:enum = { X, Y }
<a>:A = .X
const <label> = match @a {
  .X :> "ex"@@
  .Y :> "why"@@
}
<p>\${@label}</>`,
  "engine derived=match": `\${ type Health:enum = { Healthy, AtRisk } }
\${ type Mood:enum = { Calm, Tense } }
<mood>:Mood = .Calm
<engine for=Health derived=match @mood {
  .Calm :> .Healthy@@
  .Tense :> .AtRisk@@
}>
  <Healthy/>
  <AtRisk/>
</>
<p>x</>`,
  "server function `return match`": `<n> = 0
\${
  server function pick(k: string) {
    return match k {
      "a" :> 1@@
      else :> 2@@
    }
  }
  function go() { @n = pick("a") }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "nested statement match inside a block arm": `type A:enum = { X, Y }
<a>:A = .X
<b>:A = .Y
<n> = 0
\${
  function go() {
    match @a {
      .X :> {
        match @b {
          .X :> { @n = 1 }@@
          .Y :> { @n = 2 }@@
        }
      }@@
      .Y :> { @n = 3 }@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "`!{}` handler, block arms": `type E:enum = { Bad(m: string), Worse }
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function go() {
    risky(2) !{
      .Bad(m) :> { @msg = m }@@
      .Worse :> { @msg = "worse" }@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@msg}</>`,
  "`!{}` handler, inline arms on one line": `type E:enum = { Bad(m: string), Worse }
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function setm(a, b) { @msg = a + b }
  function go() {
    risky(2) !{ .Bad(m) :> setm(m, "!")@@ .Worse :> setm("w", "?")@@ }
  }
}
<button onclick=go()>go</>
<p>\${@msg}</>`,
  "`!{}` handler, legacy \`|\`-led arms and `_`": `type E:enum = { Bad(m: string), Worse }
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function go() {
    risky(2) !{
      | .Bad(m) :> { @msg = m }@@
      | _ :> { @msg = "w" }@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@msg}</>`,
  "`!{}` handler as a value": `type E:enum = { Bad(m: string), Worse }
<n> = 0
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function go() {
    const v = risky(2) !{
      .Bad(m) :> 1@@
      .Worse :> 2@@
    }
    @n = v
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`,
  "engine message arms (bare targets, binder, else)": `\${
    type Drag:enum = { Idle, Dragging(id: number) }
    type DragMsg:enum = { Start(id: number), Drop }
}
<engine for=Drag initial=.Idle accepts=DragMsg>
    <Idle rule=.Dragging>
        .Start(id) :> .Dragging(id)@@
        .Drop :> .Idle@@
    </>
    <Dragging(id) rule=.Idle>
        .Drop :> .Idle@@
        else :> .Idle@@
    </>
</>
<program>
<button id="start" onclick=@drag.advance(.Start(7))>Start</>
<p id="state">Dragging</p>
</program>`,
  "engine message arms (block bodies)": `\${
    type Counter:enum = { Counting }
    type CountMsg:enum = { Inc, Dec }
    <total> = 0
}
<engine for=Counter initial=.Counting accepts=CountMsg>
    <Counting rule=.Counting>
        .Inc :> { @total = @total + 1; .Counting }@@
        .Dec :> { @total = @total - 1; .Counting }@@
    </>
</>
<program>
<button id="inc" onclick=@counter.advance(.Inc)>Inc</>
<p id="total">Total: \${@total}</>
</program>`,
  "engine message arms (legacy \`|\`), then a render body": `\${
    type Drag:enum = { Idle, Dragging(id: number) }
    type DragMsg:enum = { Start(id: number), Drop }
}
<engine for=Drag initial=.Idle accepts=DragMsg>
    <Idle rule=.Dragging>
        | .Start(id) :> .Dragging(id)@@
        | .Drop :> .Idle@@
        <p>idle, waiting</p>
    </>
    <Dragging(id) rule=.Idle>
        .Drop :> .Idle@@
        _ :> .Idle@@
        <p>dragging \${id}</p>
    </>
</>
<program>
<button id="start" onclick=@drag.advance(.Start(7))>Start</>
</program>`,
  "commas inside bodies and patterns are the body's own": `<k> = "a,b"
<n> = 0
<s> = ""
\${
  function add(a, b) { return a + b }
  function go() {
    @n = match @k {
      "a,b" :> add(1, 2)@@
      "c, d" :> add(3, add(4, 5))@@
      else :> 0@@
    }
    @s = match @k {
      "a,b" :> \`x, \${@k}, y\`@@
      else :> "p, q"@@
    }
  }
}
<button onclick=go()>go</>
<p>\${@n} \${@s}</>`,
};

describe("§1 the comma list compiles exactly like the newline list (every arm form)", () => {
  let slot = 0;
  for (const [name, template] of Object.entries(SAME_OUTPUT)) {
    test(name, () => {
      const { lines, commas } = bothSpellings(template, `same-${++slot}`);
      expect(lines.codes).toEqual([]);
      expect(commas.codes).toEqual([]);
      expect(commas.out.length).toBeGreaterThan(2);
      expect(commas.out).toBe(lines.out);
    });
  }
});

// ---------------------------------------------------------------------------
// §2 — parser shape: the `,` never reaches an arm body
// ---------------------------------------------------------------------------

describe("§2 parser: `,` ends the arm, never the body's text", () => {
  test("statement match — trailing comma on every arm, a call with arguments, a block arm", () => {
    const tab = parse(`\${
  function go(k) {
    match k {
      "a" :> f(1, 2),
      .B(x) :> { g(x) },
      else :> 3,
    }
  }
}
`);
    expect(tab.errors.map((e) => e.code)).toEqual([]);
    const [m] = matchNodes(tab);
    const arms = armsOf(m);
    expect(arms.map((a) => a.kind)).toEqual(["match-arm-inline", "match-arm-block", "match-arm-inline"]);
    expect(arms[0].result).toBe("f ( 1 , 2 )");
    expect(arms[2].result).toBe("3");
    // nothing but arms in the body (the `,` tokens were consumed as separators)
    expect(m.body.length).toBe(3);
  });

  test("one line: `\"a\" :> f(x), \"b\" :> 2` — the first body ends at the separator", () => {
    const tab = parse(`\${
  function go(k, x) {
    match k { "a" :> f(x), "b" :> 2, else :> 3 }
  }
}
`);
    expect(tab.errors.map((e) => e.code)).toEqual([]);
    const arms = armsOf(matchNodes(tab)[0]);
    expect(arms.map((a) => a.result)).toEqual(["f ( x )", "2", "3"]);
  });

  test("no trailing comma, and a mixed list (some arms newline-separated) read the same arms", () => {
    const mixed = parse(`\${
  function go(k) {
    match k {
      "a" :> 1,
      "b" :> 2
      else :> 3
    }
  }
}
`);
    const commas = parse(`\${
  function go(k) {
    match k { "a" :> 1, "b" :> 2, else :> 3 }
  }
}
`);
    expect(mixed.errors.map((e) => e.code)).toEqual([]);
    expect(commas.errors.map((e) => e.code)).toEqual([]);
    const shape = (tab) => armsOf(matchNodes(tab)[0]).map((a) => [a.kind, a.test, a.result]);
    expect(shape(mixed)).toEqual(shape(commas));
  });

  test("object-literal arm body keeps its own commas", () => {
    const tab = parse(`\${
  function go(k) {
    const o = match k {
      "a" :> { x: 1, y: 2 },
      else :> { x: 3, y: 4 },
    }
  }
}
`);
    expect(tab.errors.map((e) => e.code)).toEqual([]);
    const arms = armsOf(matchNodes(tab)[0]);
    expect(arms.length).toBe(2);
    expect(arms.map((a) => a.body[0].expr)).toEqual(["{ x : 1 , y : 2 }", "{ x : 3 , y : 4 }"]);
    expect(arms.every((a) => a.body[0].objectLiteralArm === true)).toBe(true);
  });

  test("`given` arms take the separator", () => {
    const tab = parse(`\${
  function go(k) {
    match k {
      given k :> { f(k) },
      not :> { g() },
    }
  }
}
`);
    expect(tab.errors.map((e) => e.code)).toEqual([]);
    const arms = armsOf(matchNodes(tab)[0]);
    expect(arms.map((a) => a.kind)).toEqual(["given-guard", "match-arm-block"]);
  });
});

// ---------------------------------------------------------------------------
// §3 — engine message arms (parseMessageArms)
// ---------------------------------------------------------------------------

describe("§3 engine message arms: parseMessageArms", () => {
  test("comma list with a trailing comma, then a render body", () => {
    const body = `
        .Start(id) :> .Dragging(id),
        .Drop :> { log("x, y"); .Idle },
        <p>idle, waiting</p>
`;
    const { arms, renderBodyStart } = parseMessageArms(body);
    expect(arms.map((a) => [a.variantName, a.bodyRaw])).toEqual([
      ["Start", ".Dragging(id)"],
      ["Drop", `{ log("x, y"); .Idle }`],
    ]);
    expect(body.slice(renderBodyStart).trim()).toBe("<p>idle, waiting</p>");
    expect(arms.some((a) => a.strayArmCommas)).toBe(false);
  });

  test("two arms on one line after a `,`", () => {
    const { arms } = parseMessageArms(`.Start(id) :> .Dragging(id), .Drop :> .Idle`);
    expect(arms.map((a) => [a.variantName, a.bodyRaw])).toEqual([["Start", ".Dragging(id)"], ["Drop", ".Idle"]]);
  });

  test("without a `,`, a second head on the same line is still NOT an arm (unchanged)", () => {
    const { arms } = parseMessageArms(`.Start(id) :> { .Dragging(id) } .Drop :> .Idle`);
    expect(arms.length).toBe(1);
  });

  test("newline list reads the same arms as the comma list", () => {
    const a = parseMessageArms(`\n  .Start(id) :> .Dragging(id)\n  .Drop :> .Idle\n`).arms;
    const b = parseMessageArms(`\n  .Start(id) :> .Dragging(id),\n  .Drop :> .Idle,\n`).arms;
    const shape = (xs) => xs.map((x) => [x.variantName, x.bodyRaw, x.payloadBindingsRaw, x.isBlockBody]);
    expect(shape(b)).toEqual(shape(a));
  });

  test("`,,` and a leading `,` are recorded as stray separators", () => {
    const dbl = parseMessageArms(`.Start(id) :> .Dragging(id),,\n.Drop :> .Idle`).arms;
    expect(dbl.length).toBe(2);
    expect(dbl[0].strayArmCommas).toEqual([28]); // the second `,` (the first, at 27, is the separator)
    const lead = parseMessageArms(`, .Start(id) :> .Dragging(id)\n.Drop :> .Idle`).arms;
    expect(lead.length).toBe(2);
    expect(lead[0].strayArmCommas).toEqual([0]);
  });

  test("a `,` on the next line that no arm follows stays render content (unchanged)", () => {
    const body = `.Drop :> .Idle\n, hello`;
    const { arms, renderBodyStart } = parseMessageArms(body);
    expect(arms.length).toBe(1);
    expect(body.slice(renderBodyStart)).toBe(", hello");
  });
});

// ---------------------------------------------------------------------------
// §4 — fail closed: `,,`, a leading `,`, a comma sequence in a body
// ---------------------------------------------------------------------------

const REFUSED = {
  "statement match `,,`": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function go() {
    match @a {
      .X :> { @n = 1 },,
      .Y :> { @n = 2 }
    }
  }
}
<button onclick=go()>go</>`,
  "statement match, leading `,`": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function go() {
    match @a {
      , .X :> { @n = 1 }
      .Y :> { @n = 2 }
    }
  }
}
<button onclick=go()>go</>`,
  "value match `,,`": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function go() {
    @n = match @a { .X :> 1,, .Y :> 2 }
  }
}
<button onclick=go()>go</>`,
  "const value match `,,`": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function go() {
    const v = match @a { .X :> 1,, .Y :> 2 }
    @n = v
  }
}
<button onclick=go()>go</>`,
  "value match, leading `,`": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function go() {
    @n = match @a { , .X :> 1, .Y :> 2 }
  }
}
<button onclick=go()>go</>`,
  "value match, a comma sequence in an arm body (no JS comma operator)": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function f(x) { return x }
  function go() {
    @n = match @a {
      .X :> f(1), 2
      .Y :> 3
    }
  }
}
<button onclick=go()>go</>`,
  "statement match, a comma sequence in an arm body": `type A:enum = { X, Y }
<a>:A = .X
<n> = 0
\${
  function f(x) { @n = x }
  function go() {
    match @a {
      .X :> f(1), f(2)
      .Y :> f(3)
    }
  }
}
<button onclick=go()>go</>`,
  "`!{}` `,,`": `type E:enum = { Bad(m: string), Worse }
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function go() {
    risky(2) !{
      .Bad(m) :> { @msg = m },,
      .Worse :> { @msg = "w" }
    }
  }
}
<button onclick=go()>go</>`,
  "`!{}` leading `,`": `type E:enum = { Bad(m: string), Worse }
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function go() {
    risky(2) !{
      , .Bad(m) :> { @msg = m }
      .Worse :> { @msg = "w" }
    }
  }
}
<button onclick=go()>go</>`,
  "engine message arms `,,`": `\${
    type Drag:enum = { Idle, Dragging(id: number) }
    type DragMsg:enum = { Start(id: number), Drop }
}
<engine for=Drag initial=.Idle accepts=DragMsg>
    <Idle rule=.Dragging>
        .Start(id) :> .Dragging(id),,
        .Drop :> .Idle
    </>
    <Dragging(id) rule=.Idle>
        .Drop :> .Idle
        else :> .Idle
    </>
</>
<program>
<button id="start" onclick=@drag.advance(.Start(7))>Start</>
</program>`,
  "engine message arms, leading `,`": `\${
    type Drag:enum = { Idle, Dragging(id: number) }
    type DragMsg:enum = { Start(id: number), Drop }
}
<engine for=Drag initial=.Idle accepts=DragMsg>
    <Idle rule=.Dragging>
        , .Start(id) :> .Dragging(id)
        .Drop :> .Idle
    </>
    <Dragging(id) rule=.Idle>
        .Drop :> .Idle
        else :> .Idle
    </>
</>
<program>
<button id="start" onclick=@drag.advance(.Start(7))>Start</>
</program>`,
};

describe("§4 fail closed — E-PARSE-001", () => {
  let slot = 0;
  for (const [name, src] of Object.entries(REFUSED)) {
    test(name, () => {
      const { codes } = compileAt(src, `refused-${++slot}`);
      expect(codes).toContain("E-PARSE-001");
      expect(codes).not.toContain("E-MATCH-ARM-SEPARATOR");
    });
  }
});

describe("§5 a mixed list is accepted (impl#1 never enforces commas)", () => {
  test("statement + value match mixing `,` and newline boundaries compile clean", () => {
    const { codes } = compileAt(`type A:enum = { X, Y, Z }
<a>:A = .X
<n> = 0
\${
  function go() {
    match @a {
      .X :> { @n = 1 },
      .Y :> { @n = 2 }
      .Z :> { @n = 3 },
    }
    @n = match @a {
      .X :> 1,
      .Y :> 2
      .Z :> 3,
    }
  }
}
<button onclick=go()>go</>
<p>\${@n}</>`, "mixed");
    expect(codes).toEqual([]);
  });
});
