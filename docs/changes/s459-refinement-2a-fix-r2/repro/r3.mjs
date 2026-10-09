// S459 round 3 — items 2 (length writes) and 3 (in-place removal releases the holder).
const pg = (decls, body, show) => `\${\n    type L:struct = { u: string, n: number(>0) }\n    <m>: number = -5\n    ${decls}\n    function g() {\n        ${body}\n    }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${${show}}</p>\n</program>\n`;
const row = (name, cell, expect, decls, body, show) => ({ name, cell, expect, src: pg(decls, body, show ?? "@" + cell + ".length"), steps: [{ click: "#b" }] });
const ROWS = `<rows>: L[] = [{ u: "a", n: 1 }, { u: "b", n: 2 }]`;
const NUMS = `<ls>: number(>0)[] = [1, 2, 3]`;
export const SCENARIOS = [
  // item 2 — length writes
  row("len-struct-shrink-legit", "rows", [{ u: "a", n: 1 }], ROWS, "@rows.length = 1"),
  row("len-num-zero-legit", "ls", [], NUMS, "@ls.length = 0", "@ls.length"),
  row("len-num-shrink-legit", "ls", [1], NUMS, "@ls.length = 1", "@ls.length"),
  row("len-num-grow-holes-bad", "ls", [1, 2, 3], NUMS, "@ls.length = 5", "@ls.length"),
  row("len-nullable-grow-legit", "ls", 5, `<ls>: (number(>0) | not)[] = [1, 2, 3]`, "@ls.length = 5", "@ls.length"),
  row("len-inplace-num-zero-legit", "ls", [], NUMS, "const a = @ls\n        a.length = 0", "@ls.length"),
  // item 3 — an element removed in place is released
  row("shift-then-write-legit", "rows", [{ u: "b", n: 2 }], ROWS, "const r = @rows[0]\n        @rows.shift()\n        r.n = @m"),
  row("pop-then-write-legit", "rows", [{ u: "a", n: 1 }], ROWS, "const r = @rows[1]\n        @rows.pop()\n        r.n = @m"),
  row("splice-then-write-legit", "rows", [{ u: "b", n: 2 }], ROWS, "const r = @rows[0]\n        @rows.splice(0, 1)\n        r.n = @m"),
  row("len-then-write-legit", "rows", [{ u: "a", n: 1 }], ROWS, "const r = @rows[1]\n        @rows.length = 1\n        r.n = @m"),
  row("overwrite-then-write-legit", "rows", [{ u: "q", n: 3 }, { u: "b", n: 2 }], ROWS, "const r = @rows[0]\n        @rows[0] = { u: \"q\", n: 3 }\n        r.n = @m"),
  // still held: a duplicate keeps it in the cell
  row("dup-shift-then-write-bad", "rows", [{ u: "a", n: 1 }], `<rows>: L[] = []`, "const r = { u: \"a\", n: 1 }\n        @rows = [r, r]\n        @rows.shift()\n        const e = @rows[0]\n        e.n = @m"),
  row("shift-other-then-write-bad", "rows", [{ u: "b", n: 2 }], ROWS, "@rows.shift()\n        const e = @rows[0]\n        e.n = @m"),
  row("moved-to-other-cell-legit", "rows", [{ u: "b", n: 2 }], ROWS + `\n    <other>: { u: string, n: number }[] = []`, "const r = @rows[0]\n        @rows.shift()\n        @other.push(r)\n        r.n = @m"),
];
