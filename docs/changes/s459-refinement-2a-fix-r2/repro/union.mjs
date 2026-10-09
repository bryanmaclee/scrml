const pg = (decl, init, extra = "") => `\${\n    <m>: number = -5\n    ${extra}\n    <u>: ${decl} = ${init}\n    function g() { @u = @m }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@u}</p>\n</program>\n`;
const pgv = (decl, init, val, extra = "") => `\${\n    ${extra}\n    <u>: ${decl} = ${init}\n    function g() { @u = ${val} }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>x</p>\n</program>\n`;
const click = [{ click: "#b" }];
export const SCENARIOS = [
  { name: "union-date", cell: "u", expect: 1, src: pg("number(>0) | date", "1"), steps: click },
  { name: "union-date-legit", cell: "u", expect: "2026-10-08", src: pgv("number(>0) | date", "1", "\"2026-10-08\""), steps: click },
  { name: "union-timestamp", cell: "u", expect: 1, src: pg("number(>0) | timestamp", "1"), steps: click },
  { name: "union-asIs-admits", cell: "u", expect: -5, src: pg("number(>0) | asIs", "1"), steps: click },
  { name: "union-map", cell: "u", expect: 1, src: pg("number(>0) | [string: number]", "1"), steps: click },
  { name: "union-refined-map-refused", cell: "u", expect: "?", src: pg("number(>0) | [string: number(>0)]", "1"), steps: click },
  { name: "union-string-arr", cell: "u", expect: 1, src: pg("number(>0) | string[]", "1"), steps: click },
  { name: "union-boolean", cell: "u", expect: 1, src: pg("number(>0) | boolean", "1"), steps: click },
];
