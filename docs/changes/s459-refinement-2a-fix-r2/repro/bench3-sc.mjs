const mk = (N, decl, body) => `\${\n    type L:struct = { u: string, n: number(>0) }\n    ${decl}\n    function g() {\n        for (let i = 1; i <= ${N}; i++) {\n            ${body}\n        }\n    }\n}\n<program>\n<button id="b" onclick=g()>b</button>\n<p>\${@ls.length}</p>\n</program>\n`;
export const SCENARIOS = [];
for (const N of (process.env.NS || "2000").split(",").map(Number)) {
  SCENARIOS.push({ name: "spread-num-" + N, cell: "ls", expect: "x", src: mk(N, "<ls>: number(>0)[] = []", "@ls = [...@ls, i]"), steps: [{ click: "#b" }] });
  SCENARIOS.push({ name: "spread-struct-" + N, cell: "ls", expect: "x", src: mk(N, "<ls>: L[] = []", "const r = { u: \"a\", n: i }\n            @ls = [...@ls, r]"), steps: [{ click: "#b" }] });
  SCENARIOS.push({ name: "spread-unrefined-" + N, cell: "ls", expect: "x", src: mk(N, "<ls>: number[] = []", "@ls = [...@ls, i]"), steps: [{ click: "#b" }] });
}
