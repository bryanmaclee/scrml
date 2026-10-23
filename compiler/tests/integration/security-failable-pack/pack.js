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

// ---------------------------------------------------------------------------
// SIDE "nav" (S469 n23) — a soft navigation across a BUILD boundary.
//
// A shape is build A's shell (`shape.src`, written as app.scrml) plus `extra = { a, b, nav }`: build A's
// other files, build B's files (B's app.scrml + routes), and how the tab navigates (`nav.via`: "call" =
// `_scrml_navigate_soft`, "link" = a boosted `<a href>` click, "popstate" = back/forward; `nav.strip` =
// serve B's page with its build identity removed). The two builds are compiled SEPARATELY (ids restart
// per compile — the collision under test). "wrong": mount A's page, soft-navigate to `nav.to` serving B's
// page and B's chunks, click `#wrong`, read `#out`. "right": mount A's page, click A's own `#right`.
// The precondition — B's `#wrong` region carries a delegated id A's page also carries — is asserted, so a
// fixture that stops colliding reads UNJUDGED rather than a vacuous PASS.
// ---------------------------------------------------------------------------

function compileBuild(dir, files) {
  mkdirSync(join(dir, "pages"), { recursive: true });
  // A project marker keeps the chunk tokens project-relative (two builds, one layout).
  writeFileSync(join(dir, "scrml.toml"), "");
  for (const [f, s] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), s);
  }
  const out = join(dir, "dist");
  const res = compileScrml({ inputFiles: Object.keys(files).map((f) => join(dir, f)), write: true, outputDir: out, log: () => {} });
  const errs = (res.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
  const read = (rel) => (existsSync(join(out, rel)) ? readFileSync(join(out, rel), "utf8") : null);
  return { errs, read };
}

async function navClickAndRead(A, B, nav, id) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register({
    url: "http://localhost/",
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
  });
  const realFetch = globalThis.fetch;
  const oe = console.error;
  const oi = console.info;
  try {
    const page = A.read("app.html");
    const runtime = A.read((/src="(scrml-runtime\.[^"]+\.js)"/.exec(page) || [])[1] ?? "");
    // The live document as served: <html> attributes (the build identity) + body markup.
    const open = /<html\b([^>]*)>/i.exec(page);
    for (const a of (open ? open[1] : "").matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) document.documentElement.setAttribute(a[1], a[2] ?? "");
    const m = page.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (m ? m[1] : page).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    document.head.innerHTML = '<script src="app.client.js"></script>';
    console.error = () => {};
    console.info = () => {};
    // Runtime + A's chunk + a loader closure in ONE scope (classic scripts share one global env).
    (0, eval)(`${runtime}\n${A.read("app.client.js")}\nglobalThis.__scrml_pack_load = function (__src) { eval(__src); };`);
    const hard = [];
    globalThis._scrml_navigate = (p) => { hard.push(p); };
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    await settle();
    if (id === "wrong") {
      // Serve B: the page at nav.to and B's chunks for any script the soft nav injects.
      const routeName = nav.to.replace(/^\//, "") || "app";
      let bPage = B.read(`${routeName}.html`) ?? "";
      if (nav.strip) bPage = bPage.replace(/\s+data-scrml-build="[^"]*"/, "");
      globalThis.fetch = (input) => {
        const p = typeof input === "string" ? input : input?.url ?? "";
        return p === nav.to
          ? Promise.resolve({ ok: true, status: 200, redirected: false, url: p, text: async () => bPage })
          : Promise.reject(Object.assign(new Error("network"), { name: "TypeError" }));
      };
      const head = document.head;
      const append = head.appendChild.bind(head);
      head.appendChild = (node) => {
        const src = node?.getAttribute?.("src");
        if (String(node?.tagName).toLowerCase() !== "script" || !src) return append(node);
        setTimeout(() => {
          const js = B.read(src.split("/").pop());
          if (js == null) { node.onerror?.(); return; }
          try { globalThis.__scrml_pack_load(js); node.onload?.(); } catch { node.onerror?.(); }
        }, 0);
        return node;
      };
      if (nav.via === "link") {
        document.querySelector(`a[href="${nav.to}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      } else if (nav.via === "popstate") {
        globalThis._scrml_navigate_soft("#top"); // an in-page nav: wires the popstate handler, no fetch
        history.pushState({}, "", nav.to);
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      } else {
        globalThis._scrml_navigate_soft(nav.to);
      }
      await settle();
      await settle();
    }
    const b = document.querySelector("#" + id);
    if (b) {
      if (nav.event === "submit") b.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      else b.dispatchEvent(new Event("click", { bubbles: true }));
      await settle();
    }
    return { text: document.querySelector("#out")?.textContent ?? null, swapped: !!document.querySelector("#wrong"), hard };
  } finally {
    globalThis.fetch = realFetch;
    console.error = oe;
    console.info = oi;
    delete globalThis.__scrml_pack_load;
    await GlobalRegistrator.unregister();
  }
}

async function runNavShape(shape, dir) {
  const { a, b, nav } = shape.extra ?? {};
  const A = compileBuild(join(dir, "a"), { "app.scrml": shape.src, ...(a ?? {}) });
  const B = compileBuild(join(dir, "b"), b ?? {});
  const errs = [...A.errs, ...B.errs];
  if (errs.length > 0) return { cls: "PASS-REFUSED", detail: [...new Set(errs.map((e) => e.code))].join(",") };
  // Precondition: B's #wrong carries a delegated id that A's page also carries.
  const ev = nav.event ?? "click";
  const idsOf = (html) => new Set([...String(html ?? "").matchAll(new RegExp(`data-scrml-bind-on${ev}="([^"]+)"`, "g"))].map((x) => x[1]));
  const aIds = idsOf(A.read("app.html"));
  const bIds = [...idsOf(B.read(`${nav.to.replace(/^\//, "")}.html`))];
  if (!bIds.some((x) => aIds.has(x))) return { cls: "UNJUDGED", detail: `no ${ev} id collision between the builds` };
  const wrong = await navClickAndRead(A, B, nav, "wrong");
  const right = await navClickAndRead(A, B, nav, "right");
  const detail = `wrong->${JSON.stringify(wrong.text)} (${wrong.swapped ? "swapped" : "not swapped"}, hard-nav ${JSON.stringify(wrong.hard)}) right->${JSON.stringify(right.text)}`;
  if (wrong.text === "LOGGED IN") return { cls: "FAIL", detail };
  return { cls: right.text === "LOGGED IN" ? "PASS" : "PASS-DENY", detail };
}

/**
 * Compile one shape into `dir` and classify it.
 * @returns {{ cls: string, detail: string }}
 */
export async function runShape(shape, side, dir) {
  if (side === "nav") return runNavShape(shape, dir);
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
