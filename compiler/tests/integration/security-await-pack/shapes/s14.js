// Probe family `s14` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s14.mjs`, r5 (S465 await review round 5).
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
  tickInStrInSub: { body: `const v = \`\${"\`"}\${${Q}.name}\`\n    ${TL}` },
  aposInSubCode: { body: `const v = \`\${name == "'" ? "q" : ${Q}.name}\`\n    ${TL}` },
  backslashEnd: { body: `const v = name == "\\\\" ? "q" : ${Q}.name\n    ${TL}` },
  tmplTextBrace: { body: `const v = \`} \${${Q}.name} {\`\n    ${TL}` },
  tmplEscapedDollar: { body: `const v = \`\\\${x} \${${Q}.name}\`\n    ${TL}` },
  regexBacktick: { body: `const v = /\`/.test(name) ? "q" : ${Q}.name\n    ${TL}` },
};
