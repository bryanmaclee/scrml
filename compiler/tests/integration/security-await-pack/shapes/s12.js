// Probe family `s12` — copied VERBATIM (below this header) from the adversarial reviewer's
// scratch dir `~/.cache/scrml-review-await-r5/probes/s12.mjs`, r5 (S465 await review round 5).
// Data, not logic: `SHAPES` maps a shape name to { lib?, lib2?, files?, imports?, top?, body?, app? };
// `DEFAULT_LIB` is the lib.scrml used when a shape names none. See ../pack.js for how a shape becomes a program.
// Do not edit a shape to make it pass. A shape that stops being meaningful is removed with a note in ../README.md.

export const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const mk = (decl, extra = "") => `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  ${extra}
  ${decl}
}
<out> = ""
<button onclick={ @out = f("bob", "x") }>f</button>
<p>\${@out}</p>
</program>
`;
const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";
export const SHAPES = {
  serverKw: { app: mk(`server function f(name: string, pass: string) {\n    ${ROW}\n    if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"\n  }`) },
  serverKwNoSql: { app: mk(`server function f(name: string, pass: string) {\n    const h = g(name)\n    if (!check(pass, h)) { return "REJECTED" }\n    return "WELCOME"\n  }`, `function g(name) { return ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get().pw }`) },
  nestedServerCall: { app: mk(`function f(name: string, pass: string) {\n    return inner(name, pass) ? "WELCOME" : "REJECTED"\n  }`, `function inner(name, pass) { ${ROW}\n    return check(pass, row.pw) }`) },
  nestedServerCall2: { app: mk(`function f(name: string, pass: string) {\n    ${ROW}\n    return inner(pass, row.pw) ? "WELCOME" : "REJECTED"\n  }`, `function inner(p, h) { return check(p, h) }`) },
  errReturn: { app: mk(`function f(name: string, pass: string)! -> string {\n    ${ROW}\n    if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"\n  }`) },
};
