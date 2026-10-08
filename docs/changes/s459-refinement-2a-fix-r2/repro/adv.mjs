// S459 r2 — adversarial rows for the delta judge (MED-1) + multi-owner (LOW-4).
const pg = (decls, body, show) => `\${\n    type L:struct = { u: string, n: number(>0) }\n    type P:struct = { a: number(>0)[], b: number(>5)[] }\n    type W:struct = { name: string, l: L }\n    <m>: number = -5\n    <t>: number = 3\n    ${decls}\n    function g() {\n        ${body}\n    }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${${show}}</p>\n</program>\n`;
const row = (name, cell, expect, decls, body, show) => ({ name, cell, expect, src: pg(decls, body, show ?? "@" + cell + ".length"), steps: [{ click: "#b" }] });
export const SCENARIOS = [
  // stale owner: x no longer holds y's array, so x's tighter type no longer applies
  row("stale-owner-legit", "y", [1, 2, 3], "<y>: number(>0)[] = [1, 2]\n    <x>: number(>5)[] = [9]", "@x = [6]\n        const keep = @x\n        @y.push(@t)"),
  row("alias-then-release-legit", "y", [6, 7, 3], "<y>: number(>0)[] = [6, 7]\n    <x>: number(>5)[] = [9]", "@x = @y\n        @x = [8]\n        @y.push(@t)"),
  row("alias-x-push-bad", "x", [6, 7], "<y>: number(>5)[] = [6, 7]\n    <x>: number(>0)[] = [1]", "@x = @y\n        @x.push(@t)"),
  // the same array at two positions of one value
  row("two-positions-bad", "p", { a: [6, 7], b: [6, 7] }, "<p>: P = { a: [6, 7], b: [8] }", "@p.b = @p.a\n        @p.a.push(@t)", "@p.a.length"),
  row("two-positions-in-literal-bad", "p", { a: [6, 7], b: [6, 7] }, "<p>: P = { a: [6], b: [8] }", "const arr = [6, 7]\n        @p = { a: arr, b: arr }\n        @p.a.push(@t)", "@p.a.length"),
  row("two-positions-legit", "p", { a: [6, 7, 9], b: [6, 7, 9] }, "<p>: P = { a: [6, 7], b: [8] }", "@p.b = @p.a\n        @p.a.push(9)", "@p.a.length"),
  // nested element field writes
  row("elem-field-bad", "ls", [{ u: "a", n: 1 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0].n = @m"),
  row("elem-field-legit", "ls", [{ u: "a", n: 4 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0].n = 4"),
  row("elem-unrefined-field-legit", "ls", [{ u: "zz", n: 1 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0].u = \"zz\""),
  row("pushed-then-field-bad", "ls", [{ u: "a", n: 1 }, { u: "b", n: 2 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "const r = { u: \"b\", n: 2 }\n        @ls.push(r)\n        @ls[1].n = @m"),
  row("struct-in-struct-bad", "w", { name: "x", l: { u: "a", n: 1 } }, "<w>: W = { name: \"x\", l: { u: \"a\", n: 1 } }", "@w.l.n = @m", "@w.name"),
  row("struct-in-struct-replace-bad", "w", { name: "x", l: { u: "a", n: 1 } }, "<w>: W = { name: \"x\", l: { u: \"a\", n: 1 } }", "@w.l = { u: \"q\", n: @m }", "@w.name"),
  row("delete-refined-field-bad", "w", { name: "x", l: { u: "a", n: 1 } }, "<w>: W = { name: \"x\", l: { u: \"a\", n: 1 } }", "delete @w.l.n", "@w.name"),
  // array element writes / length
  row("index-write-bad", "ls", [1, 2], "<ls>: number(>0)[] = [1, 2]", "@ls[1] = @m"),
  row("index-write-legit", "ls", [1, 9], "<ls>: number(>0)[] = [1, 2]", "@ls[1] = 9"),
  row("length-truncate-legit", "ls", [1], "<ls>: number(>0)[] = [1, 2]", "@ls.length = 1"),
  row("pop-legit", "ls", [1], "<ls>: number(>0)[] = [1, 2]", "@ls.pop()"),
  row("fill-bad", "ls", [1, 2], "<ls>: number(>0)[] = [1, 2]", "@ls.fill(@m)"),
  row("unshift-bad", "ls", [1, 2], "<ls>: number(>0)[] = [1, 2]", "@ls.unshift(@m)"),
  // undescribed positions fall back to the whole cell
  row("union-array-push-bad", "u", [1, 2], "<u>: number(>0)[] | string = [1, 2]", "@u.push(@m)"),
  row("union-array-push-legit", "u", [1, 2, 3], "<u>: number(>0)[] | string = [1, 2]", "@u.push(@t)"),
  row("nested-array-push-bad", "mm", [[1], [2]], "<mm>: number(>0)[][] = [[1], [2]]", "@mm[1].push(@m)"),
  row("nested-array-push-legit", "mm", [[1], [2, 3]], "<mm>: number(>0)[][] = [[1], [2]]", "@mm[1].push(@t)"),
  row("push-array-into-nested-bad", "mm", [[1], [2], [5]], "<mm>: number(>0)[][] = [[1], [2]]", "const inner = [5]\n        @mm.push(inner)\n        @mm[2].push(@m)"),
  // copy-on-write path updates (_scrml_deep_set) judged at the path
  row("path-elem-object-bad", "ls", [{ u: "a", n: 1 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0] = { u: \"q\", n: @m }"),
  row("path-elem-object-legit", "ls", [{ u: "q", n: 3 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0] = { u: \"q\", n: @t }"),
  row("path-repeat-then-bad", "ls", [{ u: "a", n: 5 }, { u: "b", n: 2 }], "<ls>: L[] = [{ u: \"a\", n: 1 }, { u: \"b\", n: 2 }]", "@ls[0].n = 5\n        @ls[0].u = \"a\"\n        @ls[1].n = @m"),
  row("path-then-push-bad", "ls", [{ u: "a", n: 5 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0].n = 5\n        const r = { u: \"c\", n: @m }\n        @ls.push(r)"),
  row("path-then-elem-field-inplace-bad", "ls", [{ u: "a", n: 5 }], "<ls>: L[] = [{ u: \"a\", n: 1 }]", "@ls[0].n = 5\n        const e = @ls[0]\n        e.n = @m"),
  row("path-union-bad", "u", [1, 2], "<u>: number(>0)[] | string = [1, 2]", "@u[0] = @m"),
  row("path-nested-array-bad", "mm", [[1], [2]], "<mm>: number(>0)[][] = [[1], [2]]", "@mm[1][0] = @m"),
  row("path-nested-array-legit", "mm", [[1], [7]], "<mm>: number(>0)[][] = [[1], [2]]", "@mm[1][0] = 7"),
  row("path-then-alias-push-bad", "y", [6, 9], "<y>: number(>5)[] = [6, 7]\n    <x>: number(>0)[] = [1]", "@y[1] = 9\n        @x = @y\n        @x.push(@t)"),
];
