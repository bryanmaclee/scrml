// security-failable-pack — the harness that turns one wrong-password probe of the §19.4.3 failable
// class into a verdict (S468 fix round 1; a sibling of ../security-await-pack).
//
// A shape (see shapes/*.js) is a scrml login page. `check(p)! -> AuthErr` FAILS `.Denied` on a wrong
// password; `login(p)` reaches `check` through some position — a `match` subject, an alias, a returned
// function, a callback, a handler attribute — and turns the result into "LOGGED IN" or "rejected". If the
// compiler accepts an unhandled failable result, or a `match` that compares the error object as a plain
// value (or reads a plain enum value as `.Ok`), the WRONG password logs in.
//
// The reviewers' `h2.mjs` (client) and `hs.mjs` (server) harnesses
// (~/.cache/scrml-agent-tmp/s468-rev-failable/) made deterministic and reusable: every temp dir under
// the caller's root; a classification is returned instead of printed.
//
//   client shape: compile, load app.html + app.client.js under happy-dom, click #wrong then #right
//                 (each on a fresh document), read #out.
//   server shape: compile, import app.server.js, POST the `login` route with p="wrong" / p="secret".
//
// Classes (the security floor is "a wrong password never logs in"):
//   PASS          wrong -> "rejected" (or anything but LOGGED IN), right -> "LOGGED IN". Correct.
//   PASS-REFUSED  the compile reports an error: fail closed at compile time (detail: the codes).
//   PASS-500      server: the route fails at run time on the wrong password (non-2xx / throws /
//                 the bundle does not load). Fail closed at run time.
//   PASS-DENY     the wrong password does not log in, and neither does the right one. Fail closed;
//                 a correctness defect (or a probe whose callee is plain by design), not a security one.
//   UNJUDGED      the shape has no #wrong button (client) or no `login` route (server).
//   FAIL          the wrong password logs in. The security failure.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CLASSES = ["PASS", "PASS-REFUSED", "PASS-500", "PASS-DENY", "UNJUDGED", "FAIL"];

/** Every family in shapes/, in a stable order (n1…, s1…). */
export async function loadFamilies() {
  const files = readdirSync(join(HERE, "shapes")).filter((f) => f.endsWith(".js"));
  const key = (f) => { const m = /^([a-z]+)(\d+)\.js$/.exec(f); return [m ? m[1] : f, m ? Number(m[2]) : 0]; };
  files.sort((a, b) => { const [pa, na] = key(a); const [pb, nb] = key(b); return pa === pb ? na - nb : pa < pb ? -1 : 1; });
  const out = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(HERE, "shapes", f)).href);
    const shapes = {};
    for (const [name, src, extra] of mod.default) shapes[name] = { src, extra: extra ?? null };
    out.push({ family: f.replace(/\.js$/, ""), side: mod.SIDE, shapes });
  }
  return out;
}

const settle = async () => { for (let k = 0; k < 8; k++) await new Promise((r) => setTimeout(r, 0)); };

/** Load the compiled page on a fresh document, click `#id`, and read `#out`. */
async function clickAndRead(outDir, id, extraFiles = []) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  try {
    const html = readFileSync(resolve(outDir, "app.html"), "utf8");
    // S469 — a multi-file shape (an imported module): its client chunks load before the page's.
    const deps = extraFiles
      .map((f) => resolve(outDir, f.replace(/\.scrml$/, ".client.js")))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8"));
    const js = [...deps, readFileSync(resolve(outDir, "app.client.js"), "utf8")].join("\n");
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (m ? m[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    // eslint-disable-next-line no-eval
    (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${js}\n})();`);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    await settle();
    const oe = console.error;
    console.error = () => {};
    try {
      const b = document.querySelector("#" + id);
      if (!b) return { text: null, threw: false };
      b.click();
      await settle();
    } catch {
      return { text: document.querySelector("#out")?.textContent ?? null, threw: true };
    } finally {
      console.error = oe;
    }
    return { text: document.querySelector("#out")?.textContent ?? null, threw: false };
  } finally {
    await GlobalRegistrator.unregister();
  }
}

/**
 * Compile one shape into `dir` and classify it.
 * @returns {{ cls: string, detail: string }}
 */
export async function runShape(shape, side, dir) {
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, shape.src);
  for (const [f, s] of Object.entries(shape.extra ?? {})) writeFileSync(resolve(dir, f), s);
  const out = resolve(dir, "out");
  let res;
  try {
    res = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  } catch (e) {
    return { cls: "PASS-REFUSED", detail: `compiler threw: ${String(e?.message ?? e).slice(0, 80)}` };
  }
  const all = res.errors ?? [];
  const errs = all.filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
  if (errs.length > 0) return { cls: "PASS-REFUSED", detail: [...new Set(errs.map((e) => e.code))].join(",") };

  if (side === "server") {
    const sp = resolve(out, "app.server.js");
    if (!existsSync(sp)) return { cls: "UNJUDGED", detail: "no server bundle" };
    let mod;
    try { mod = await import(pathToFileURL(sp).href + "?" + Math.random().toString(36).slice(2)); }
    catch (e) { return { cls: "PASS-500", detail: `bundle does not load: ${String(e?.message ?? e).slice(0, 60)}` }; }
    const route = (mod.routes ?? []).find((r) => /__ri_route_login_\d+$/.test(r.path));
    if (!route) return { cls: "UNJUDGED", detail: "no login route" };
    const call = async (p) => {
      try {
        const r = await mod.fetch(new Request(`http://localhost${route.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
          body: JSON.stringify({ p }),
        }));
        return { status: r.status, text: (await r.text()).slice(0, 60), threw: false };
      } catch (e) {
        return { status: 0, text: String(e?.message ?? e).slice(0, 60), threw: true };
      }
    };
    const wrong = await call("wrong");
    const right = await call("secret");
    const detail = `wrong=${wrong.status}:${wrong.text} right=${right.status}:${right.text}`;
    if (wrong.status >= 200 && wrong.status < 300 && wrong.text.includes("LOGGED IN")) return { cls: "FAIL", detail };
    if (wrong.threw || wrong.status < 200 || wrong.status >= 300) return { cls: "PASS-500", detail };
    return { cls: right.text.includes("LOGGED IN") ? "PASS" : "PASS-DENY", detail };
  }

  if (!shape.src.includes('id="wrong"')) return { cls: "UNJUDGED", detail: "no #wrong button" };
  const extraNames = Object.keys(shape.extra ?? {});
  const wrong = await clickAndRead(out, "wrong", extraNames);
  const right = await clickAndRead(out, "right", extraNames);
  const detail = `wrong->${JSON.stringify(wrong.text)}${wrong.threw ? " (threw)" : ""} right->${JSON.stringify(right.text)}${right.threw ? " (threw)" : ""}`;
  if (wrong.text === "LOGGED IN") return { cls: "FAIL", detail };
  return { cls: right.text === "LOGGED IN" ? "PASS" : "PASS-DENY", detail };
}
