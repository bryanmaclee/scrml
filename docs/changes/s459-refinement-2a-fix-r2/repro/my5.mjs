const src = `<program db="sqlite:./k.db">\n\${\n    <n server>: number(>0) = 1\n}\n<p>\${@n}</p>\n</program>\n`;
export const SCENARIOS = [
  { name: "ssr-seed-bad", cell: "n", expect: 1, before: (g) => { g.window.__scrml_ssr_state = { n: -5 }; }, src },
  { name: "ssr-seed-legit", cell: "n", expect: 9, before: (g) => { g.window.__scrml_ssr_state = { n: 9 }; }, src },
];
