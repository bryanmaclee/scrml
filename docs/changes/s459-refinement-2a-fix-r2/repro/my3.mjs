const pg = (decl, init) => `\${\n    <m>: number = -5\n    <u>: ${decl} = ${init}\n    function g() { @u = @m }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@u}</p>\n</program>\n`;
export const SCENARIOS = [
  { name: "union-date", cell: "u", expect: 1, src: pg("number(>0) | date", "1"), steps: [{ click: "#b" }] },
  { name: "union-string-arr", cell: "u", expect: 1, src: pg("number(>0) | string[]", "1"), steps: [{ click: "#b" }] },
  { name: "union-boolean", cell: "u", expect: 1, src: pg("number(>0) | boolean", "1"), steps: [{ click: "#b" }] },
];
