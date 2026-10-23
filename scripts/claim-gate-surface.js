/**
 * scripts/claim-gate-surface.js
 *
 * The claim-gate's declared PUBLIC SURFACE, and its FLOOR (S469 docs-gate round 3).
 *
 * The surface is hand-listed on purpose (a broad glob would gate internal records that
 * are non-public for real reasons). A hand list rots the other way: a new public page with
 * scrml in it is ungated until someone remembers to add it — that is how docs/lin.md,
 * docs/external-js.md and the docs/website/*.md announcements sat outside the gate. So the
 * gate also runs the INVERSE check: every README.md / NERDME.md / DESIGN.md / docs/**.md
 * that holds a scrml fence must be in the surface, or under SURFACE_UNGATED with a
 * reason. Anything else fails the gate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { parseDocMarkers } from "./doc-gate-markers.js";

/**
 * The declared PUBLIC SURFACE. A path may be a file or a directory (walked recursively for
 * `.md`). Adding a row here is the act that puts a surface under the gate.
 */
export const PUBLIC_SURFACE = [
  "README.md",
  "NERDME.md",
  "DESIGN.md",
  "docs/tutorial.md",
  "docs/articles",
  "docs/adopter",
  "docs/lin.md",          // round 3: public language guide (linear types)
  "docs/external-js.md",  // round 3: public guide (calling host JavaScript)
  "docs/website",         // round 3: the site's markdown pages (announcements, roadmap)
  "marketing", // does not exist yet; tolerated-absent so the row can pre-date the dir
];

/**
 * Documents with scrml fences that are deliberately NOT gated, each with its reason.
 * A path is a file or a directory prefix (repo-relative). The floor check fails on any
 * fenced document that is neither in the surface nor here.
 */
export const SURFACE_UNGATED = {
  "docs/articles/archive": "superseded April–May drafts, bannered \"do not paste\" (S469 \"Archive old drafts\")",
  // S469 "Banner + exempt": dated pieces written before the S469 rulings, in bryan's voice. Each
  // carries a banner saying its code is the older dialect and unchecked. Listed one by one, not
  // as `docs/articles`, so llm-kickstarter-v2 (ruled) and any NEW article stay gated.
  ...Object.fromEntries([
    "docs/articles/i-am-jacks-engine-2026-09-07.md",
    "docs/articles/i-am-jacks-engine-PUBLISH.md",
    "docs/articles/i-am-jacks-match-2026-09-08.md",
    "docs/articles/i-am-jacks-match-PUBLISH.md",
    "docs/articles/i-am-jacks-program-2026-09-07.md",
    "docs/articles/i-am-jacks-program-PUBLISH.md",
    "docs/articles/if-you-give-a-dev-an-enum-2026-08-31.md",
    "docs/articles/if-you-give-a-dev-an-enum-PUBLISH.md",
    "docs/website/v0.2.0-announce-2026-05-05.md",
    "docs/website/v0.3.0-announce-2026-05-14.md",
  ].map((p) => [p, "dated piece written before the S469 rulings; bannered: older-dialect code, not checked (S469 \"Banner + exempt\")"])),
  "docs/changes": "internal change briefs and progress logs — historical records, often quoting broken code by design",
  "docs/audits": "dated audit records — historical, they quote code as it was",
  "docs/heads-up": "dated internal heads-up notices — historical",
  "docs/known-gaps.md": "gap reproducers — deliberately failing code",
  "docs/PA-SCRML-PRIMER.md": "internal agent primer, not a public document",
  "docs/PA-SCRML-REFERENCE.md": "internal agent reference, not a public document",
  "docs/pinned-discussions": "internal discussion records",
  "docs/curation": "internal curation notes",
  "docs/changelog.md": "historical release notes",
  "docs/pr-reviews.md": "internal review log",
};

/** Directories under a surface row that are walked past, never gated. */
export const SURFACE_EXCLUDE = Object.keys(SURFACE_UNGATED);

const under = (rel, p) => rel === p || rel.startsWith(p + "/");

/** The roots the floor scans: README.md, NERDME.md, DESIGN.md, and docs/ recursively. */
export const FLOOR_ROOTS = ["README.md", "NERDME.md", "DESIGN.md", "docs"];

/**
 * Every fenced document under the floor roots that is neither gated nor excused.
 * @param {string} repoRoot
 * @param {Set<string>} gatedRel  repo-relative paths the gate resolved from its surface
 * @param {{ ungated?: Record<string, string> }} [opts]
 * @returns {string[]} repo-relative paths, sorted
 */
export function uncoveredDocs(repoRoot, gatedRel, opts = {}) {
  const ungated = Object.keys(opts.ungated ?? SURFACE_UNGATED);
  const out = [];
  const walk = (abs) => {
    if (!existsSync(abs)) return;
    const rel = relative(repoRoot, abs).split(sep).join("/");
    if (ungated.some((u) => under(rel, u))) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (rel.endsWith("node_modules")) return;
      for (const e of readdirSync(abs)) walk(join(abs, e));
      return;
    }
    if (!rel.endsWith(".md") || gatedRel.has(rel)) return;
    const d = parseDocMarkers(readFileSync(abs, "utf8"));
    // A scrml block, or a scrml-looking fence the parser refused (it still holds scrml).
    if (d.blocks.length > 0 || d.errors.some((e) => /scrml fence|starts with `scrml`/.test(e.message))) out.push(rel);
  };
  for (const r of FLOOR_ROOTS) walk(join(repoRoot, r));
  return out.sort();
}
