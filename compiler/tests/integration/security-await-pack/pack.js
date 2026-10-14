// security-await-pack — the harness that turns one reviewer probe shape into a verdict.
//
// A shape (see shapes/*.js) is a scrml program in which a server function `f(name, pass)`
// looks up bob's argon2 hash and must reject a wrong password. The program reaches
// `verifyPassword` (scrml:auth, async) through some position — an import, an alias, a
// binding, a callback, a re-export chain, a default parameter… — and the question every
// shape asks is the §13.2 one: is that async call AWAITED on the server? If it is not,
// `if (!check(pass, hash))` tests a Promise, the Promise is truthy, and a WRONG PASSWORD
// IS ACCEPTED (gap g-imported-async-server-fn-not-awaited-s465).
//
// This module is the reviewers' `harness.mjs` (~/.cache/scrml-review-await-r8/harness.mjs)
// made deterministic and reusable: one pinned argon2id hash (no per-shape hashing), one
// template SQLite file copied per shape, every temp dir under os.tmpdir() and removed by
// the caller. It returns a classification instead of printing a line.
//
// Classes (the security floor is "a wrong password is never answered WELCOME"):
//   PASS          wrong -> 200 "REJECTED", right -> 200 "WELCOME…". Correct.
//   PASS-REFUSED  the compile reports an error (or produces no server bundle): fail closed
//                 at compile time. Legitimate §13.2/§13.7 refusals land here, and so do
//                 impl#1 defects that happen to refuse (E-CODEGEN-INVALID-LOGIC…); the
//                 detail carries the codes so the two can be told apart.
//   PASS-500      the program compiles but the route fails at run time on the wrong
//                 password (non-2xx, a thrown handler, a server bundle that does not load):
//                 fail closed at run time. Never WELCOME on a wrong password.
//   PASS-DENY     the route answers 2xx and never WELCOMEs the wrong password, but the
//                 right password is not WELCOMEd either (e.g. both "REJECTED"). Fail closed;
//                 a correctness defect, not a security one.
//   UNJUDGED      the program compiles but has no server route for `f` — `f` is a client
//                 function — so this server-route harness cannot judge it (the decision is
//                 made in the client). Recorded so the hole is visible, never counted a pass.
//   FAIL          the wrong password is answered WELCOME. The security failure.

import { mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../../src/api.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// A real argon2id hash of "right-password", produced once by Bun.password.hash (the engine
// scrml:auth's hashPassword/verifyPassword use) and PINNED here so every run is identical and
// no run pays for hashing. The cost parameters are deliberately low (m=1024 KiB, t=1): verify
// cost is set by the hash, and the default cost (~108 ms/verify measured) times ~800 verifies
// would put the pack at ~90 s of argon2 alone. The property under test — is the async verify
// awaited — does not depend on the cost. pack.test.js checks this hash against the stdlib's
// verifyPassword before any shape runs, so a bad pin fails loudly, not as 424 odd verdicts.
export const RIGHT_PASSWORD = "right-password";
export const WRONG_PASSWORD = "wrong-password";
export const PINNED_HASH =
  "$argon2id$v=19$m=1024,t=1,p=1$R09KFP4g5QB2Ef5NyqofbbfS6jIWDzmNYNiZ+aCCbVE$dHryxYdGh1XY3ZXVxc9dLvOl/F0ptORmzPdv1YM6R2I";

export const CLASSES = ["PASS", "PASS-REFUSED", "PASS-500", "PASS-DENY", "UNJUDGED", "FAIL"];

/** Every family in shapes/, in a stable order: s*, pa-verify, n*, m* (round order). */
export async function loadFamilies() {
  const files = readdirSync(join(HERE, "shapes")).filter((f) => f.endsWith(".js"));
  const rank = (f) => {
    const m = /^([a-z]+(?:-verify)?)(\d*)\.js$/.exec(f);
    const order = { s: 0, "pa-verify": 1, n: 2, m: 3 }[m[1]] ?? 9;
    return [order, Number(m[2] || 0)];
  };
  files.sort((a, b) => {
    const [ao, an] = rank(a); const [bo, bn] = rank(b);
    return ao - bo || an - bn;
  });
  const families = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(HERE, "shapes", f)).href);
    families.push({ family: f.replace(/\.js$/, ""), shapes: mod.SHAPES, defaultLib: mod.DEFAULT_LIB });
  }
  return families;
}

/** The app.scrml a shape compiles as — the reviewers' template, byte-for-byte. */
export function appSource(s) {
  return s.app ?? `<program db="./app.db">
\${
  ${s.imports ?? 'import { check } from "./lib.scrml"'}
  ${s.top ?? ""}
  function f(name: string, pass: string) {
    const row = ?{\`SELECT name, pw FROM users WHERE name = \${name}\`}.get()
    ${s.body}
  }
}
<out> = ""
<button onclick={ @out = f("bob", "x") }>f</button>
<p>\${@out}</p>
</program>
`;
}

/** Build the template database once per run; shapes get a copy. */
export function makeTemplateDb(root) {
  const p = join(root, "template.db");
  const db = new Database(p, { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [PINNED_HASH]);
  db.close();
  return p;
}

const clip = (s, n = 120) => String(s).replace(/\s+/g, " ").slice(0, n);

/**
 * Compile one shape in `dir`, load its server bundle, call the `f` route with the wrong
 * and the right password. Returns { cls, detail, wrong?, right? }.
 */
export async function runShape(s, defaultLib, dir, templateDb) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lib.scrml"), s.lib ?? defaultLib);
  if (s.lib2) writeFileSync(join(dir, "lib2.scrml"), s.lib2);
  for (const [fn, txt] of Object.entries(s.files ?? {})) writeFileSync(join(dir, fn), txt);
  writeFileSync(join(dir, "app.scrml"), appSource(s));
  copyFileSync(templateDb, join(dir, "app.db"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });

  let result;
  try {
    result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
  } catch (e) {
    return { cls: "PASS-REFUSED", detail: `compiler threw: ${clip(e)}` };
  }
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const serverPath = join(outDir, "app.server.js");
  if (errors.length) return { cls: "PASS-REFUSED", detail: [...new Set(errors)].sort().join(",") };
  if (!existsSync(serverPath)) return { cls: "PASS-REFUSED", detail: "no server bundle emitted" };

  let mod;
  try {
    mod = await import(pathToFileURL(serverPath).href);
  } catch (e) {
    return { cls: "PASS-500", detail: `server bundle failed to load: ${clip(e)}` };
  }
  const route = (mod.routes ?? []).find((r) => /__ri_route_f_\d+$/.test(r.path));
  if (!route) return { cls: "UNJUDGED", detail: "no server route for f (f is a client function)" };

  const call = async (pass) => {
    try {
      const res = await mod.fetch(new Request(`http://localhost${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
        body: JSON.stringify({ name: "bob", pass }),
      }));
      return { status: res.status, text: await res.text() };
    } catch (e) {
      return { status: "THROW", text: clip(e, 90) };
    }
  };
  const wrong = await call(WRONG_PASSWORD);
  const right = await call(RIGHT_PASSWORD);
  const show = (r) => `${r.status}:${clip(r.text, 60)}`;
  const io = `wrong=${show(wrong)} right=${show(right)}`;

  if (/WELCOME/.test(wrong.text)) return { cls: "FAIL", detail: io, wrong, right };
  const ok2xx = (r) => typeof r.status === "number" && r.status >= 200 && r.status < 300;
  if (!ok2xx(wrong)) return { cls: "PASS-500", detail: io, wrong, right };
  if (wrong.text === '"REJECTED"' && ok2xx(right) && /^"WELCOME/.test(right.text)) {
    return { cls: "PASS", detail: io, wrong, right };
  }
  return { cls: "PASS-DENY", detail: io, wrong, right };
}
