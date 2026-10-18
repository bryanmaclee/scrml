export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const T = `return "WELCOME"`;
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    ${T}`;
const B = R(`!check(pass, row.pw)`);
export const SHAPES = {
  fpPropKey: { body: `const o = { check: 1 }\n    ` + B },
  fpMember: { body: `const o = { check: 1 }\n    const v = o.check\n    ` + B },
  fpString: { body: `const msg = "please check it"\n    ` + B },
  fpTemplate: { body: `const msg = \`check \${pass}\`\n    ` + B },
  fpSqlWord: { body: `const r2 = ?{\`SELECT name AS check FROM users WHERE name = \${name}\`}.get()\n    ` + B },
  fpLocalShadow: { top: `function eqx(a, b) { const check = (x, y) => x == y\n    const g = check\n    return g(a, b) }`, body: R(`!eqx(1, 1) || !check(pass, row.pw)`) },
  fpParamShadow: { top: `function eqx(check, b) { const g = check\n    return g == b }`, body: R(`!eqx(1, 1) || !check(pass, row.pw)`) },
  fpTypeof: { body: `const t = typeof check\n    ` + B },
  fpResultBinding: { body: `const ok = check(pass, row.pw)\n    ` + R(`!ok`) },
  fpResultTern: { body: `const ok = row ? check(pass, row.pw) : false\n    ` + R(`!ok`) },
  fpResultObj: { body: `const res = { ok: check(pass, row.pw) }\n    ` + R(`!res.ok`) },
  fpResultArr: { body: `const res = [check(pass, row.pw)]\n    ` + R(`!res[0]`) },
  fpResultArg: { body: `const res = String(check(pass, row.pw))\n    ` + R(`res != "true"`) },
  fpSyncLambdaSameFile: { top: `const add = (a, b) => a + b`, body: `const n = add(1, 2)\n    ` + B },
  fpSyncLambdaLocal: { body: `const inc = (x) => x + 1\n    const n = inc(1)\n    ` + B },
  fpMapCb: { body: `const lens = [pass].map((x) => x.length)\n    ` + B },
  fpLetWriteResult: { body: `let ok = false\n    ok = check(pass, row.pw)\n    ` + R(`!ok`) },
  fpCommentMention: { body: `// check is async\n    const z = 1\n    ` + B },
  fpLetWriteLambdaSync: { top: `let fmt = (x) => x\n  function setFmt() { fmt = (x) => x + "!" }`, body: B },
  fpExportSyncLambda: { lib: `\${\n  import { verifyPassword } from "scrml:auth"\n  export function check(p, h) { return verifyPassword(p, h) }\n  export const fmt = (x) => x + "!"\n}\n`, imports: `import { check, fmt } from "./lib.scrml"`, body: `const s = fmt("a")\n    ` + B },
  fpAsyncNameInSyncLambdaParam: { top: `const twice = (check) => check + check`, body: `const n = twice(1)\n    ` + B },
  fpScheduler: { body: `const t = setTimeout(() => check(pass, row.pw), 0)\n    ` + B },
};
