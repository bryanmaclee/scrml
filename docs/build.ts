/**
 * docs/build.ts
 *
 * Renders scrml.dev. Reads markdown articles from docs/articles/, applies the
 * shared template, writes per-article HTML pages and an index listing.
 *
 * This is interim tooling. Once scrml v0.2.0 ships, the site will be built
 * with scrml itself; this script goes away.
 *
 * Usage:
 *   bun install        (one time, picks up the marked devDependency)
 *   bun run docs/build.ts
 *
 * Inputs:  docs/articles/*-devto-*.md (the canonical-on-scrml.dev articles)
 *          — NONE since S469: those drafts moved to docs/articles/archive/
 *          (superseded dialect, "do not paste"); the site is docs/website/.
 * Outputs: docs/articles/<slug>/index.html
 *          docs/articles/index.html
 *
 * Slug derivation: filename minus the trailing "-devto-YYYY-MM-DD.md".
 * Frontmatter: standard YAML-ish (title, published, description, tags,
 * cover_image, canonical_url). canonical_url is informational here; the
 * template always emits canonical = https://scrml.dev/articles/<slug>/.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(HERE, "articles");
const TEMPLATE_PATH = join(HERE, "_template.html");
const INDEX_TEMPLATE_PATH = join(HERE, "_articles-index-template.html");
const SITE_BASE = "https://scrml.dev";

const DEVTO_PATTERN = /^(.+)-devto-(\d{4}-\d{2}-\d{2})\.md$/;

type Frontmatter = {
  title?: string;
  description?: string;
  published?: string;
  tags?: string;
  cover_image?: string;
  canonical_url?: string;
  [k: string]: string | undefined;
};

type Article = {
  slug: string;
  filename: string;
  date: string;
  fm: Frontmatter;
  bodyHtml: string;
};

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  if (!raw.startsWith("---\n")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { fm: {}, body: raw };
  const block = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const fm: Frontmatter = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return { fm, body };
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderArticle(template: string, a: Article): string {
  const canonical = `${SITE_BASE}/articles/${a.slug}/`;
  const description =
    a.fm.description ?? a.fm.title ?? "Article on scrml.dev";
  const tagLine =
    a.fm.tags && a.fm.tags.length > 0
      ? ` &middot; ${a.fm.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => `<code>${htmlEscape(t)}</code>`)
          .join(" ")}`
      : "";

  return template
    .replace(/\{\{canonical\}\}/g, canonical)
    .replace(/\{\{title\}\}/g, htmlEscape(a.fm.title ?? a.slug))
    .replace(/\{\{description\}\}/g, htmlEscape(description))
    .replace(/\{\{date\}\}/g, a.date)
    .replace(/\{\{tag_line\}\}/g, tagLine)
    .replace(/\{\{content\}\}/g, a.bodyHtml);
}

function renderIndex(template: string, articles: Article[]): string {
  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date));
  const items = sorted
    .map((a) => {
      const description = htmlEscape(a.fm.description ?? "");
      const title = htmlEscape(a.fm.title ?? a.slug);
      return `    <li>
      <h3><a href="/articles/${a.slug}/">${title}</a></h3>
      <div class="article-meta">${a.date}</div>
      <p class="article-desc">${description}</p>
    </li>`;
    })
    .join("\n");
  return template.replace("{{items}}", items);
}

async function main() {
  marked.setOptions({ breaks: false, gfm: true });

  const template = await readFile(TEMPLATE_PATH, "utf8");
  const indexTemplate = await readFile(INDEX_TEMPLATE_PATH, "utf8");

  const entries = await readdir(ARTICLES_DIR);
  const articles: Article[] = [];

  for (const filename of entries) {
    const m = filename.match(DEVTO_PATTERN);
    if (!m) continue;
    const slug = m[1];
    const date = m[2];
    const raw = await readFile(join(ARTICLES_DIR, filename), "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const bodyHtml = await marked.parse(body);
    articles.push({ slug, filename, date, fm, bodyHtml });
  }

  if (articles.length === 0) {
    console.error("no articles matched", DEVTO_PATTERN);
    console.error(
      "S469: the April–May devto drafts moved to docs/articles/archive/ (superseded dialect, " +
        "do not publish). scrml.dev is built from docs/website/ now; this interim script has no inputs.",
    );
    process.exit(1);
  }

  for (const a of articles) {
    const outDir = join(ARTICLES_DIR, a.slug);
    await mkdir(outDir, { recursive: true });
    const html = renderArticle(template, a);
    await writeFile(join(outDir, "index.html"), html, "utf8");
    console.log(`wrote articles/${a.slug}/index.html`);
  }

  const indexHtml = renderIndex(indexTemplate, articles);
  await writeFile(join(ARTICLES_DIR, "index.html"), indexHtml, "utf8");
  console.log(`wrote articles/index.html (${articles.length} articles)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
