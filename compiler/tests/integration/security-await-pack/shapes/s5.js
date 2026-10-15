// Probe family `s5` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s5.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const Q = "?{`SELECT name FROM users WHERE name = ${name}`}.get()";
const TL = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + String(v)`;
export const SHAPES = {
  regexQuote: { body: `const v = /'/.test(name) ? "q" : ${Q}.name\n    ${TL}` },
  regexDQuote: { body: `const v = /"/.test(name) ? "q" : ${Q}.name\n    ${TL}` },
  strEscQuote: { body: `const v = "a\\"" + ${Q}.name\n    ${TL}` },
  strSingleEsc: { body: `const v = 'it\\'s ' + ${Q}.name\n    ${TL}` },
  tmplSubStrBrace: { body: `const v = \`\${"}"} \${${Q}.name}\`\n    ${TL}` },
  tmplSubStrBrace2: { body: `const v = \`\${"{"} \${${Q}.name}\`\n    ${TL}` },
  tmplNestedTmpl: { body: `const v = \`a\${\`b\${${Q}.name}\`}\`\n    ${TL}` },
  tmplSubObj: { body: `const v = \`\${({ k: ${Q}.name }).k}\`\n    ${TL}` },
  divThenQuote: { body: `const v = (4 / 2) + "'" + ${Q}.name\n    ${TL}` },
  queryInStrConcat: { body: `const v = "x" + ${Q}.name + "?{"\n    ${TL}` },
  ternaryStr: { body: `const v = name == "'" ? "q" : ${Q}.name\n    ${TL}` },
  queryInCond: { body: `const v = "a"\n    if (/'/.test(name) || ${Q}) { }\n    ${TL}` },
};
