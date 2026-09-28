// css-oracle.js — the CSS HALF of the footprint grade (s440-bootstrap-css-theme-t3).
//
// WHY IT EXISTS. The conformance suite never observes CSS: its adapter never loads the stylesheet and
// conformance/normalize.ts defers "computed CSS/class visual state" to v1.next. So a stylesheet swap
// graded by conformance alone passes trivially, and no corruption of the stylesheet emitter could ever
// kill a pass — nothing would be certified. This module supplies the missing observation:
//
//   a css ORACLE = SPEC-derived COMPUTED-STYLE assertions, evaluated in real Chromium (puppeteer) over
//   the build output of the compile under test (impl#1's html + clientJs + runtime, and whatever
//   stylesheet the CSS seam produced), after optional user-intent clicks.
//
// It stays in slice-m3, NOT in the conformance schema (ruling S440 all recs #2, R6).
//
// Chromium, not happy-dom: happy-dom 20.8.9 ignores `@layer` entirely (probed: a rule only inside
// `@layer reset {}` never applies), so it cannot observe the §65.5 layer order. Chromium resolves
// `@scope` + donut, `@layer`, `:where()`, `var()` and the `:root[data-scrml-theme-*]` switch.
//
// An expectation is NEVER taken from impl#1's output: every value is what the cited SPEC sentence says
// the element's computed style must be. Where an oracle asserts an unruled CHOICE instead, its spec file
// says so in a `choice` field (never in `rationale`). A case whose oracle fails on PURE impl#1 is an
// impl#1 finding.
//
// ORACLE FILES (css-oracle/):
//   conformance/<category>/<case>.json — the css half of an existing conformance case.
//   sources/<name>.json (+ sources/<name>.scrml, or `"from": "<repo-relative .scrml>"` for a real
//       example) — css-only sources outside conformance; the conformance suite's counts stay untouched.
//   core/<name>.json — a hand-built stylesheet Core (slice-m3/css.core.scrml `<fn>`) + its page html:
//       the §66.17 T3 shapes, which impl#1's front end cannot carry (progress.md Phase 0).
// Spec shape: { spec, rationale, choice?, files?, pageCharset?, steps: [ { click?, hover?, rootAttr?,
//               rootStyle?, expect: [ { sel, prop, value, index?, pseudo? } ] } ] }

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compileScrml } from "../../src/api.js";

export const ORACLE_DIR = join(import.meta.dir, "css-oracle");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** The css oracle for a conformance case (by relDir) or a css-only source (`css-oracle/<name>`), or null. */
export function oracleFor(relDir) {
  const p = relDir.startsWith("css-oracle/")
    ? join(ORACLE_DIR, "sources", `${relDir.slice("css-oracle/".length)}.json`)
    : join(ORACLE_DIR, "conformance", `${relDir}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Every oracle-only source: [{ relDir: "css-oracle/<name>", source, auxFiles: {}, spec }]. */
export function oracleSources() {
  const dir = join(ORACLE_DIR, "sources");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const name = f.replace(/\.json$/, "");
    const spec = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const source = spec.from
      ? readFileSync(join(REPO_ROOT, spec.from), "utf8")
      : readFileSync(join(dir, `${name}.scrml`), "utf8");
    return { relDir: `css-oracle/${name}`, source, auxFiles: {}, spec };
  });
}

/** Every Core-level oracle: [{ relDir: "css-core/<name>", spec }] (spec.core names the css.core fn). */
export function oracleCores() {
  const dir = join(ORACLE_DIR, "core");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => ({
    relDir: `css-core/${f.replace(/\.json$/, "")}`,
    spec: JSON.parse(readFileSync(join(dir, f), "utf8")),
  }));
}

let browserPromise = null;
async function browser() {
  if (!browserPromise) {
    const { default: puppeteer } = await import("puppeteer");
    browserPromise = puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

const safe = (s) => s.replace(/[^A-Za-z0-9_-]+/g, "_");

/** A fresh per-run directory (review F7): concurrent runs never share or clobber a build. */
const freshDir = (label) => mkdtempSync(join(tmpdir(), `scrml-css-oracle-${safe(label)}-`));

/**
 * Compile `source` (+ aux) with `stageOverrides`, WRITING the build into a fresh directory.
 * → { dir, html | null, errors }. The caller removes `dir`.
 */
export function buildCase(relDir, source, auxFiles, stageOverrides, fromPath = null) {
  const dir = freshDir(relDir);
  const out = join(dir, "dist");
  // A real example (`from`) compiles IN PLACE — its sibling files (a `<db src=…>`, imports) resolve
  // against its own directory — and only the build output goes to the fresh directory.
  const input = fromPath ? join(REPO_ROOT, fromPath) : join(dir, "case.scrml");
  if (!fromPath) {
    writeFileSync(input, source);
    for (const [n, s] of Object.entries(auxFiles ?? {})) writeFileSync(join(dir, n), s);
  }
  let r;
  try {
    r = compileScrml({
      inputFiles: [input],
      write: true,
      outputDir: out,
      log: () => {},
      ...(stageOverrides ? { stageOverrides } : {}),
    });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const errors = (r.errors ?? []).filter((e) => e?.severity !== "warning" && e?.severity !== "info").map((e) => String(e.code));
  const html = join(out, `${basename(input, ".scrml")}.html`);
  return { dir, html: existsSync(html) ? html : null, errors };
}

/** Run a spec's steps against an open page. → string[] (the failed assertions; [] = pass) */
async function runSteps(page, spec) {
  const fails = [];
  let n = 0;
  for (const step of spec.steps ?? []) {
    n++;
    if (step.click) {
      const found = await page.$(step.click);
      if (!found) {
        fails.push(`step ${n}: click target \`${step.click}\` not found`);
        break;
      }
      await found.click();
      await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    }
    if (step.hover) {
      const found = await page.$(step.hover);
      if (!found) {
        fails.push(`step ${n}: hover target \`${step.hover}\` not found`);
        break;
      }
      await found.hover();
    }
    if (step.rootAttr) {
      await page.evaluate(([k, v]) => document.documentElement.setAttribute(k, v), step.rootAttr);
    }
    // A script's `:root` custom-property write (§66.17 item 7's mechanism), for Core-level oracles.
    if (step.rootStyle) {
      await page.evaluate(([k, v]) => document.documentElement.style.setProperty(k, v), step.rootStyle);
    }
    for (const e of step.expect ?? []) {
      const got = await page.evaluate(({ sel, prop, index, pseudo }) => {
        const els = document.querySelectorAll(sel);
        const el = els[index ?? 0];
        if (!el) return { missing: els.length };
        return { value: getComputedStyle(el, pseudo ?? null).getPropertyValue(prop).trim() };
      }, { sel: e.sel, prop: e.prop, index: e.index ?? 0, pseudo: e.pseudo ?? null });
      const at = `\`${e.sel}\`[${e.index ?? 0}]${e.pseudo ?? ""}`;
      if (got.missing !== undefined) {
        fails.push(`step ${n}: ${at} not found (${got.missing} match)`);
      } else if (got.value !== e.value) {
        fails.push(`step ${n}: ${at} ${e.prop} = ${JSON.stringify(got.value)}, SPEC says ${JSON.stringify(e.value)}`);
      }
    }
  }
  return fails;
}

async function withPage(fn) {
  const b = await browser();
  const page = await b.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err).split("\n")[0]));
  try {
    const fails = await fn(page);
    if (fails.length > 0 && pageErrors.length > 0) fails.push(`(page errors: ${pageErrors.join(" | ")})`);
    return fails;
  } finally {
    await page.close();
  }
}

/** Grade one built page against its spec. → { pass, reasons } */
export async function gradePage(htmlPath, spec) {
  const fails = await withPage(async (page) => {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    return runSteps(page, spec);
  });
  return { pass: fails.length === 0, reasons: fails };
}

/** Grade a css text + page html (a Core-level oracle). → { pass, reasons } */
export async function gradeSheet(css, bodyHtml, spec) {
  const dir = freshDir(`core-${spec.core ?? "sheet"}`);
  try {
    writeFileSync(join(dir, "page.css"), css);
    // `spec.charset` = the page's own encoding (default UTF-8) — a sheet's `@charset` is observable only
    // against a referring document of ANOTHER encoding.
    writeFileSync(join(dir, "page.html"),
      `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="${spec.charset ?? "UTF-8"}">\n<link rel="stylesheet" href="page.css">\n</head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`);
    return await gradePage(join(dir, "page.html"), spec);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The css half for graded conformance cases: build each (the CSS seam swapped) and run its oracle.
 * `cases` = [{ relDir, source, auxFiles }]. → Map<relDir, { pass, reasons } | null>  (null = no oracle)
 */
export async function gradeCssCases(stageOverrides, cases) {
  const out = new Map();
  for (const c of cases) {
    const spec = oracleFor(c.relDir);
    if (!spec) {
      out.set(c.relDir, null);
      continue;
    }
    out.set(c.relDir, await gradeBuilt(c.relDir, c.source, c.auxFiles, stageOverrides, spec));
  }
  return out;
}

export async function gradeBuilt(relDir, source, auxFiles, stageOverrides, spec) {
  let built;
  try {
    built = buildCase(relDir, source, auxFiles, stageOverrides, spec.from ?? null);
  } catch (e) {
    return { pass: false, reasons: [`the build threw: ${String(e?.message ?? e).split("\n")[0]}`] };
  }
  try {
    if (built.errors.length > 0) return { pass: false, reasons: [`the build reported ${built.errors.join(", ")}`] };
    if (!built.html) return { pass: false, reasons: ["the build wrote no case.html"] };
    // Static files the page loads beside the build (e.g. an `@import`ed stylesheet).
    for (const [name, text] of Object.entries(spec.files ?? {})) writeFileSync(join(built.dir, "dist", name), text);
    // `pageCharset`: re-declare the built page's encoding, so the stylesheet's own `@charset` — which
    // matters only when it differs from the referring document's — becomes observable. The page's
    // bytes are ASCII-only markup here; only its declared encoding changes.
    if (spec.pageCharset) {
      const h = readFileSync(built.html, "utf8");
      writeFileSync(built.html, h.replace(/<meta charset="[^"]*">/i, `<meta charset="${spec.pageCharset}">`));
    }
    return await gradePage(built.html, spec);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
}
