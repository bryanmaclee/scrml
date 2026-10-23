/**
 * S469 — E-IMPL1-RULED-FORM-UNSUPPORTED: impl#1 refuses ruled forms it does not implement.
 *
 * Provenance: ruling:user-voice-scrml.md S469 "⭐ RULED — impl#1 refuses ruled forms it doesn't
 * implement" — "Refuse them in impl#1 (Recommended)". Gap g-impl1-ruled-forms-emitted-verbatim-fail-open-s469.
 *
 * Before this, each REFUSED source below compiled with no error and failed at run time
 * (`int is not defined`, `Color.parse is not a function`, `ys.append is not a function`, a TDZ
 * ReferenceError from the mis-parsed `for { }`, `number is not iterable` from `for (more(t))`), or
 * ran wrong (a match arm's `lift` after an expression statement yielded `null`). Each ACCEPTED source
 * is a near-neighbour that impl#1 compiles correctly (or a same-named method on another kind of
 * receiver) and must stay clean.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { ruledFormMessage, isRangeIterable, RULED_FORM_CODE } from "../../src/impl1-ruled-form-refusal.ts";

const CODE = "E-IMPL1-RULED-FORM-UNSUPPORTED";

function compile(src) {
  const dir = resolve(tmpdir(), `scrml-s469-ruled-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, "app.scrml");
  writeFileSync(file, src);
  try {
    const result = compileScrml({ inputFiles: [file], write: false, outputDir: resolve(dir, "out"), log: () => {} });
    const all = [...(result.errors ?? []), ...(result.warnings ?? [])];
    const ruled = all.filter((e) => e.code === CODE);
    return { codes: all.map((e) => e.code), ruled, messages: ruled.map((e) => e.message) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const prog = (body) => `<program>\ntype Color:enum = { Red, Green }\n<c> = Color.Red\n<n> = 0\nfunction f() { return 1 }\n${body}\n<p>\${@n} \${@c} \${f()}</p>\n</program>\n`;

const REFUSED = {
  "int.parse": [prog(`<k> = int.parse("42")\n<p>\${@k}</p>`), "§14.13.4", "`int.parse(s)`"],
  "number.parse": [prog(`<k> = number.parse("4.5")\n<p>\${@k}</p>`), "§14.13.4", "`number.parse(s)`"],
  "bool.parse": [prog(`<k> = bool.parse("true")\n<p>\${@k}</p>`), "§14.13.4", "`bool.parse(s)`"],
  "integer.parse (not a namespace; names int.parse)": [prog(`<k> = integer.parse("4")\n<p>\${@k}</p>`), "§14.13.4", "`int.parse(s)`"],
  "Enum.parse": [prog(`<k> = Color.parse("Red")\n<p>\${@k}</p>`), "§14.13.4", "`Color.parse(s)`"],
  "int.parse in a function body": [prog(`function go() { const v = int.parse("7"); @n = v }\n<button onclick=go()>g</button>`), "§14.13.4", "`int.parse(s)`"],
  "int.parse in markup interpolation": [prog(`<p>\${int.parse("3")}</p>`), "§14.13.4", "`int.parse(s)`"],
  "int.parse inside a lambda": [prog(`\${ const xs = ["1"].map(s => int.parse(s)) }`), "§14.13.4", "`int.parse(s)`"],
  "append on a literal-tape cell": [prog(`<xs> = [1, 2]\nfunction add() { @xs.append(3) }\n<button onclick=add()>go</button>\n<p>\${@xs.length}</p>`), "§66.12.6", "`.append(…)`"],
  "prepend on a literal-tape local": [prog(`\${\n  const ys = [1, 2]\n  ys.prepend(3)\n  @n = ys.length\n}`), "§66.12.6", "`.prepend(…)`"],
  "insert on a literal-tape local": [prog(`\${\n  const ys = [1, 2]\n  ys.insert(0, 3)\n  @n = ys.length\n}`), "§66.12.6", "`.insert(…)`"],
  "remove on a literal-tape local": [prog(`\${\n  const ys = [1, 2]\n  ys.remove(0)\n  @n = ys.length\n}`), "§66.12.6", "`.remove(…)`"],
  "append on an annotated tape parameter": [prog(`function add(xs: int[]) { xs.append(1); return xs.length }\n<button onclick=\${@n = add([1])}>g</button>`), "§66.12.6", "`.append(…)`"],
  "for { } (infinite head)": [prog(`\${\n  let t = 0\n  for { t = t + 1; if (t > 4) { break } }\n  @n = t\n}`), "§49.3.6", "`for { … }`"],
  "for (cond) with a comparison": [prog(`\${\n  let i = 0\n  for (i < 3) { i = i + 1 }\n  @n = i\n}`), "§49.3.1", "`for (cond) { … }`"],
  "for (cond) with a call": [prog(`function more(k: int) { return k < 3 }\n\${\n  let t = 0\n  for (more(t)) { t = t + 1 }\n  @n = t\n}`), "§49.3.1", "`for (cond) { … }`"],
  "for (cond) with a negation": [prog(`\${\n  let done = false\n  let t = 0\n  for (!done) { t = t + 1; done = t > 2 }\n  @n = t\n}`), "§49.3.1", "`for (cond) { … }`"],
  "range head a..b": [prog(`\${\n  let t = 0\n  for (i of 0..3) { t = t + i }\n  @n = t\n}`), "§49.2.5", "`a..b`"],
  "range head a..=b": [prog(`\${\n  let t = 0\n  for (i of 0..=3) { t = t + i }\n  @n = t\n}`), "§49.2.5", "`a..b`"],
  "match block arm: expression statement then lift": [prog(`\${\n  const v = match @c {\n    .Red :> { f(); lift 2 }\n    .Green :> 3\n  }\n  @n = v\n}`), "§18.5", "`lift`"],
  "returned match: expression statement then lift": [prog(`function g() { return match @c {\n    .Red :> { f(); lift 2 }\n    .Green :> 3\n  } }\n\${ @n = g() }`), "§18.5", "`lift`"],
  "value-form for: expression statement then lift": [prog(`\${\n  const xs = for (x of [1, 2, 3]) { f(); lift x * 2; }\n  @n = xs.length\n}`), "§49.6", "`lift`"],
};

const ACCEPTED = {
  "Enum.toEnum (impl#1's spelling)": prog(`<k> = Color.toEnum("Red")\n<p>\${@k}</p>`),
  "JSON.parse": prog(`<k> = JSON.parse("42")\n<p>\${@k}</p>`),
  "map insert / remove (§59)": prog(`<m> = [:]\nfunction go() { @m = @m.insert("a", 1); @m = @m.remove("a") }\n<button onclick=go()>g</button>`),
  "remove on an unproven receiver (a DOM element)": prog(`function drop(el) { el.remove() }\n<button onclick=drop(f())>g</button>`),
  "append on a tape local that is also bound to a non-literal": prog(`\${\n  let ys = [1]\n  ys = f()\n  ys.append(2)\n}`),
  "for (;;)": prog(`\${\n  let t = 0\n  for (;;) { t = t + 1; if (t > 4) { break } }\n  @n = t\n}`),
  "C-style for": prog(`\${\n  let t = 0\n  for (let i = 0; i < 4; i = i + 1) { t = t + i }\n  @n = t\n}`),
  "for (x of xs) with a spread": prog(`\${\n  let t = 0\n  for (x of [...[1, 2], 3]) { t = t + x }\n  @n = t\n}`),
  "for (x of …) with '..' inside a string": prog(`\${\n  let t = 0\n  for (x of "a..b".split(".")) { t = t + 1 }\n  @n = t\n}`),
  "legacy for x in xs": prog(`\${\n  let t = 0\n  for x in [1, 2] { t = t + x }\n  @n = t\n}`),
  "match block arm: declaration then lift": prog(`\${\n  const v = match @c {\n    .Red :> { const k = 2; lift k }\n    .Green :> 3\n  }\n  @n = v\n}`),
  "match block arm: cell write then lift": prog(`<m> = 0\n\${\n  const v = match @c {\n    .Red :> { @m = 4; lift 2 }\n    .Green :> 3\n  }\n  @n = v + @m\n}`),
  "if-as-expression: expression statement then lift (impl#1 handles it)": prog(`\${\n  const v = if (@n == 0) { f(); lift 7 } else { 6 }\n  @n = v\n}`),
  "value-form for: lift only": prog(`\${\n  const xs = for (x of [1, 2, 3]) { lift x * 2; }\n  @n = xs.length\n}`),
};

describe("E-IMPL1-RULED-FORM-UNSUPPORTED — refused forms", () => {
  for (const [name, [src, section, formText]] of Object.entries(REFUSED)) {
    test(name, () => {
      const r = compile(src);
      expect(r.ruled.length).toBe(1);
      expect(r.messages[0]).toContain(section);
      expect(r.messages[0]).toContain(formText);
      expect(r.ruled[0].severity ?? "error").toBe("error");
    });
  }
});

describe("E-IMPL1-RULED-FORM-UNSUPPORTED — near-neighbours stay clean", () => {
  for (const [name, src] of Object.entries(ACCEPTED)) {
    test(name, () => {
      const r = compile(src);
      expect(r.codes).not.toContain(CODE);
    });
  }
});

describe("E-IMPL1-RULED-FORM-UNSUPPORTED — the message", () => {
  test("names the bootstrap command and says it is an impl#1 limit", () => {
    const r = compile(REFUSED["int.parse"][0]);
    expect(r.messages[0]).toContain("bun run boot:compile");
    expect(r.messages[0]).toContain("bootstrap");
    expect(r.messages[0]).toContain("impl#1 limit, not a language rule");
    expect(r.messages[0].startsWith(`${CODE}:`)).toBe(true);
  });
  test("the builder is the one message source", () => {
    expect(RULED_FORM_CODE).toBe(CODE);
    const m = ruledFormMessage("`x`", "§1");
    expect(m).toContain("`x` is ruled scrml (§1) but impl#1 does not implement it");
    expect(m).toContain("`bun run boot:compile`");
  });
});

describe("isRangeIterable", () => {
  test("ranges", () => {
    for (const s of ["0 .. 3", "0..3", "0 .. = 3", "a .. b", "1 .. ( n + 1 )"]) expect(isRangeIterable(s)).toBe(true);
  });
  test("not ranges", () => {
    for (const s of ["xs", "[ ... xs , 1 ]", "...xs", "\"a..b\" . split ( \".\" )", "a . b", "1.5", ""]) expect(isRangeIterable(s)).toBe(false);
  });
});
