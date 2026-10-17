export const DEFAULT_LIB = `\${
  export function noop() { return 1 }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const E = `function eq(a, b) { return a == b }`;
const I = `import { noop } from "./lib.scrml"`;
export const SHAPES = {
  cTopAlias: { imports: I, top: `${E}\n  const g = eq`, body: R(`!g(pass, "right-password")`) },
  cTernExpr: { imports: I, top: E, body: `const g = eq\n    return g(pass, "right-password") ? "WELCOME" : "REJECTED"` },
  cNested: { imports: I, top: `${E}\n  function h2(p) { const pk = eq\n    return pk(p, "right-password") }`, body: R(`!h2(pass)`) },
  cNestedAlias2: { imports: I, top: `${E}\n  function h2(p) { const a = eq\n    const b = a\n    return b(p, "right-password") }`, body: `const ok = h2(pass)\n    ` + R(`!ok`) },
  cLetSwap: { imports: I, top: E, body: `let g = (a, b) => false\n    g = eq\n    ` + R(`!g(pass, "right-password")`) },
  cAndExpr: { imports: I, top: E, body: `const g = eq\n    const ok = true && g(pass, "right-password")\n    ` + R(`!ok`) },
  cArgPass: { imports: I, top: E, body: `const g = eq\n    const ok = Boolean(g(pass, "right-password"))\n    ` + R(`!ok`) },
  cNot2: { imports: I, top: E, body: `const g = eq\n    ` + R(`g(pass, "right-password") == false`) },
  cTemplate: { imports: I, top: E, body: `const g = eq\n    ` + R(`\`\${g(pass, "right-password")}\` != "true"`) },
  cDirect: { imports: I, top: E, body: R(`!eq(pass, "right-password")`) },
  cDirectNested: { imports: I, top: `${E}\n  function h3(p) { return eq(p, "right-password") }`, body: R(`!h3(pass)`) },
};
