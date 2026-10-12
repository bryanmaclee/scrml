/**
 * markup-statement-not-rendered-s464 — E-MARKUP-STATEMENT-NOT-RENDERED (SPEC §17.6.10.1).
 *
 * Ruling S462 Q24 "a" (user-voice-scrml.md): markup written as a statement in a logic
 * body that would not be rendered is a compile ERROR "whose message says it is not
 * rendered and names the fix (`lift <…>`, or make it the arm's single element)";
 * "nothing vanishes silently". Code + message ruled S464: "this markup is in statement
 * position and is not rendered — write `lift <p>…</p>`".
 *
 * Before: every REFUSED shape below compiled at exit 0 and rendered nothing (measured
 * in happy-dom on the base commit; the `let k = 1⏎<b>… trackz(@n) …</b>` shape also RAN
 * `trackz` as code — g-statement-markup-after-statement-text-runs-s462).
 * Every ACCEPTED shape is a control: it rendered before and must still compile clean.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

const CODE = "E-MARKUP-STATEMENT-NOT-RENDERED";

const PRE = `<program>
@u = { name: "bob" }
@n = 3
@hits = 0
@xs = ["x", "y"]
type Phase:enum = { Idle, Loading }
<phase>: Phase = .Idle
function trackz(x) {
  @hits = @hits + 1
  return x
}
<main>
<div id="host">`;
const POST = `</div>
<span id="hits">\${@hits}</span>
</main>
</program>
`;

function compile(body) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-q24-"));
  try {
    const f = join(dir, "app.scrml");
    writeFileSync(f, PRE + body + POST);
    const r = compileScrml({ inputFiles: [f], write: false, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    return { codes: errors.map((e) => e.code), errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const D = "$" + "{";

const REFUSED = {
  "plain `${ <p>hello</p> }`": `${D} <p>hello</p> }`,
  "plain element holding an interpolation": `${D} <p>hi ${D}@n} there</p> }`,
  "plain self-closing element": `${D} <br/> }`,
  "two elements in one `if` arm": `${D} if (@n > 1) { <p>one</p> <p>two</p> } }`,
  "two elements in one `given` arm": `${D} given @u :> { <p>one</p> <p>two</p> } }`,
  "an element after a statement (`;`)": `${D} if (@n > 1) { let k = 1; <p>after</p> } }`,
  "an element after a statement, holding an interpolation": `${D} if (@n > 1) { let k = 1; <p>after ${D}@n} x</p> } }`,
  "an element on the line after a statement (read into it as code)": `${D} let k = 1\n<p>after stmt</p> }`,
  "an element after an assignment on the same line": `${D} if (@n > 1) { @hits = 0 <p>x</p> } }`,
  "the HIGH gap: text after a statement that would RUN as code": `${D} if (@n > 1) { const b = 2\n let k = 1\n <b>b ${D}@n} trackz(@n) ${D}@n}</b> } }`,
  "a `for` body without `lift`": `${D} for (const x of @xs) { <li>row</li> } }`,
  "a `while` body without `lift`": `${D} let i = 0\n while (i < 1) { i = i + 1\n <p>w</p> } }`,
  "a logic `match` arm `{ <p>…</p> }`": `${D} match @phase { .Idle :> { <p>idle</p> } .Loading :> { <p>loading</p> } } }`,
  "an arm whose text holds `a < b`": `${D} if (@n > 1) { <p>a < b</p> } }`,
  "an arm whose text holds a quoted closer": `${D} if (@n > 1) { <p>x "</p>" y</p> } }`,
  "markup in statement position in a `function` body": `${D} function f() { <p>fnbody</p> } }`,
  "a second element after a `lift` on the same line": `${D} lift <p>a</p> <p>b</p> }`,
  "an element on the line after a `lift`": `${D} lift <p>a</p>\n<p>b</p> }`,
  // S464 fix round 1 (review of a0d464f1f)
  "r1 #2: an element after a postfix `++` in an arm": `${D} if (@n > 0) { @n++\n<p>q</p> } }`,
  "r1 #2: an element after a postfix `--` in an arm": `${D} if (@n > 0) { @n--\n<p>q</p> } }`,
  "r1 #2: an element after a postfix `++` at the top of `${}`": `${D} @n++\n<p>top</p> }`,
  "r1 #2: an element after `a++` in a function (the `a++` was deleted)": `${D} function f() { let a = 1\na++\n<p>q</p>\nreturn a } }`,
  "r1 #7: an element after a regex literal": `${D} if (@n > -1) { const r = /ab/\n<p>after-regex</p> } }`,
  "r1 #7: an element in an arrow function's block body": `${D} const g = () => { <p>arrow</p> } }`,
  "r1 #7: an element after a statement in an arrow block body": `${D} const g = () => { let z = 1; <p>arrow</p> } }`,
  "r1 #5: a bare nested block `${ { <p>…</p> } }`": `${D} { <p>blk</p> } }`,
  "r1 #5: a bare nested block inside an `if` arm": `${D} if (@n > 0) { { <p>blk</p> } } }`,
};

const ACCEPTED = {
  "the single-element `if` arm (§17.6.10 implied lift)": `${D} if (@n > 1) { <p>single</p> } }`,
  "the single-element `given` arm": `${D} given @u :> { <p>${D}@u.name}</p> } }`,
  "an `if` / `else` cascade of single elements": `${D} if (@n > 5) { <p>a</p> } else { <p>b</p> } }`,
  "an `else if` cascade of single elements": `${D} if (@n > 5) { <p>a</p> } else if (@n > 1) { <p>b</p> } }`,
  "a nested `${ if }` inside a single-element arm's element": `${D} if (@n > 1) { <div>outer ${D} if (@n > 0) { <b>inner</b> } } tail</div> } }`,
  "`lift` in a `for` body": `${D} for (const x of @xs) { lift <li>${D}x}</li> } }`,
  "two `lift`s in a `for` body": `${D} for (const x of @xs) { lift <li>${D}x}</li>\n lift <li>again</li> } }`,
  "a statement, then `lift`": `${D} if (@n > 1) { let k = 1; lift <p>ok ${D}k}</p> } }`,
  "`lift` of nested markup": `${D} lift <div><span>${D}@n}</span> tail</div> }`,
  "`lift` in a logic `match` arm": `${D} match @phase { .Idle :> { lift <p>idle</p> } .Loading :> { lift <p>loading</p> } } }`,
  "a markup value in an initializer": `${D} const m = <p>val</p>\n lift m }`,
  "a markup value on the next line inside parens": `${D} const m = (\n<p>val</p>\n)\n lift m }`,
  "markup values in a ternary": `${D} lift @n > 1 ? <p>big</p> : <p>small</p> }`,
  "a `return`ed markup value in a function": `${D} function mk() {\n return <p>fn</p>\n }\n lift mk() }`,
  "a compound state declaration in a logic body": `${D}\n <form>\n <name default="a"> = "b"\n <email default="c"> = "d"\n </>\n }`,
  "a compound with typed children": `${D} <formRes><name>: string = ""<email>: string = ""</> }`,
  "a comparison continued on the next line": `${D} let a = 1\n let b = a\n < 2\n lift b }`,
  "r1: an arrow returning a markup value from a block body": `${D} const sn = (x) => { return <p>${D}x}</p> } } <div>${D}sn(1)}</div>`,
  "r1: an arrow with an expression body of markup": `${D} const sn = (x) => <p>${D}x}</p> } <div>${D}sn(1)}</div>`,
  "r1: a postfix `++` statement with no markup after it": `${D} function f() { let a = 1\na++\nreturn a } } <div>${D}f()}</div>`,
};

describe("E-MARKUP-STATEMENT-NOT-RENDERED (S464 Q24) — refused shapes", () => {
  for (const [label, body] of Object.entries(REFUSED)) {
    test(label, () => {
      const { codes } = compile(body);
      expect(codes).toContain(CODE);
    });
  }

  test("the message is the ruled one and names the element's tag", () => {
    const { errors } = compile(`${D} <section>hello</section> }`);
    const e = errors.find((x) => x.code === CODE);
    expect(e).toBeDefined();
    expect(e.message).toContain("this markup is in statement position and is not rendered — write `lift <section>…</section>`");
    expect(e.message).toContain("single element");
  });

  test("one refusal per element (an element holding interpolations is reported once)", () => {
    const { codes } = compile(`${D} for (const x of @xs) { <li>${D}x} - ${D}@n} more</li> } }`);
    expect(codes.filter((c) => c === CODE).length).toBe(1);
  });

  test("a `^{ }` meta body is out of scope (it renders through emit(), with its own §22 diagnostics)", () => {
    const { codes } = compile(`^{ <p>meta</p> }`);
    expect(codes).not.toContain(CODE);
  });

  test("a refused `<script>` keeps its own code and is not double-reported", () => {
    const { codes } = compile(`${D} <script>x</script> }`);
    expect(codes).not.toContain(CODE);
  });
});

describe("E-MARKUP-STATEMENT-NOT-RENDERED (S464 Q24) — controls compile clean", () => {
  for (const [label, body] of Object.entries(ACCEPTED)) {
    test(label, () => {
      const { codes } = compile(body);
      expect(codes).toEqual([]);
    });
  }
});
