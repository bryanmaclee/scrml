const click = [{ click: "#b" }];
export const SCENARIOS = [
  { name: "map-value-refined", cell: "m", expect: "refused?", src: `\${\n    <bad>: number = -5\n    <m>: [string: number(>0)] = [:]\n    function g() { @m = ["a": @bad] }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>x</p>\n</program>\n`, steps: click },
  { name: "recursive-struct", cell: "t", expect: "refused?", src: `\${\n    type T:struct = { n: number(>0), kids: T[] }\n    <bad>: number = -5\n    <t>: T = { n: 1, kids: [] }\n    function g() { @t = { n: 1, kids: [{ n: @bad, kids: [] }] } }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>x</p>\n</program>\n`, steps: click },
];
