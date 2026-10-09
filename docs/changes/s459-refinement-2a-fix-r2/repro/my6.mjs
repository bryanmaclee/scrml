const src = (body) => `\${\n    <y>: number(>5)[] = [6, 7]\n    <x>: number(>0)[] = [1]\n    <t>: number = 3\n    function g() {\n        ${body}\n    }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@x.length} \${@y.length}</p>\n</program>\n`;
export const SCENARIOS = [
  { name: "shared-obj-push", cell: "y", expect: [6, 7], src: src("@x = @y\n        @y.push(@t)"), steps: [{ click: "#b" }] },
  { name: "shared-obj-elem", cell: "y", expect: [6, 7], src: src("@x = @y\n        @y[0] = @t"), steps: [{ click: "#b" }] },
];
