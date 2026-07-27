import { readFileSync, writeFileSync } from "fs";

// `--check` verifies the @generated totals block matches SPEC.md and exits non-zero if not,
// without writing. The Sections-table line ranges are deliberately NOT gated: they drift by
// design between amendments and a gate that cries wolf gets bypassed then deleted
// (`pa-base v2.4` §8). The totals are a single derived fact that changes only with the commit.
const CHECK = process.argv.includes("--check");

const SPEC = readFileSync("compiler/SPEC.md", "utf8");
const INDEX_PATH = "compiler/SPEC-INDEX.md";
const INDEX = readFileSync(INDEX_PATH, "utf8");

type Section = { line: number; key: string };
const lines = SPEC.split("\n");
const sections: Section[] = [];
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  let raw: string | null = null;
  if (ln.startsWith("## ")) {
    raw = ln.slice(3).trim();
    // Skip ## subheadings (49.1, §53.1, etc.)
    if (raw.match(/^\d+\.\d+\s/)) continue;
    if (raw.startsWith("§")) continue;
  } else if (ln.startsWith("# §")) {
    // Single-# section header with § prefix, e.g. `# §49. ...`
    raw = ln.slice(2).trim();
  } else {
    continue;
  }
  let key = "";
  let m = raw.match(/^§?(\d+)\.\s/);
  if (m) {
    key = m[1];
  } else if (raw.startsWith("Appendix ")) {
    const am = raw.match(/^Appendix ([A-Z]):/);
    if (am) key = am[1];
  } else if (raw.startsWith("Table of Contents")) {
    key = "TOC";
  } else {
    continue;
  }
  sections.push({ line: i + 1, key });
}

// Compute ranges.
// `split("\n")` yields a trailing empty element for a file ending in a newline; drop it so the
// count matches `wc -l` AND `scripts/facts.ts specLines()`. Two generated figures for the same
// quantity disagreeing by one makes a reader distrust both.
const totalLines = lines.length - (lines[lines.length - 1] === "" ? 1 : 0);
const ranges = new Map<string, { start: number; end: number; size: number }>();
for (let i = 0; i < sections.length; i++) {
  const start = sections[i].line;
  const end = i + 1 < sections.length ? sections[i + 1].line - 1 : totalLines;
  ranges.set(sections[i].key, { start, end, size: end - start + 1 });
}

console.log("Sections in SPEC.md (key @ start line, size):");
for (const s of sections) {
  const r = ranges.get(s.key)!;
  console.log(`  ${s.key.padEnd(4)} @ ${s.line}  range=${r.start}-${r.end} size=${r.size}`);
}

const indexLines = INDEX.split("\n");
let inSectionsTable = false;
let updated = 0;
const missing: string[] = [];
const out: string[] = [];

for (const line of indexLines) {
  if (line.startsWith("| § | Section ")) { inSectionsTable = true; out.push(line); continue; }
  if (inSectionsTable && line.startsWith("|---")) { out.push(line); continue; }
  if (inSectionsTable && !line.startsWith("|")) { inSectionsTable = false; out.push(line); continue; }
  if (!inSectionsTable) { out.push(line); continue; }

  const m = line.match(/^\| (.+?) \| (.+?) \| (\d+(?:-\d+)?|—) \| (\d+|—) \| /);
  if (!m) { out.push(line); continue; }
  const key = m[1].trim();
  const name = m[2];
  const oldRange = m[3];
  const oldSize = m[4];
  const summary = line.slice(m[0].length);

  const lookupKey = key === "—" ? "TOC" : key;
  const r = ranges.get(lookupKey);
  if (!r) {
    missing.push(`row key="${key}" name="${name}"`);
    out.push(line); continue;
  }
  const newRange = `${r.start}-${r.end}`;
  const newLine = `| ${key} | ${name} | ${newRange} | ${r.size} | ${summary}`;
  if (newRange !== oldRange || String(r.size) !== oldSize) updated++;
  out.push(newLine);
}

// Regenerate the totals block (S290).
//
// This footer was hand-maintained while this script regenerated the table rows around it, so it
// rotted silently: it read `Total lines: 33,436 | Total sections: 61` while SPEC.md was 36,575
// lines and the table ran to §65. A stale total in the file whose job is navigation accuracy is
// exactly the `pa-base v2.4` §8 non-deterministic-input class — except the input here DOES change
// with the commit, so there was never a reason not to derive it.
const TOTALS_START = "<!-- @generated:spec-index-totals START (do not edit — `bun run scripts/regen-spec-index.ts`) -->";
const TOTALS_END = "<!-- @generated:spec-index-totals END -->";
const numberedSections = sections.filter((s) => /^\d+$/.test(s.key)).length;
const totalsBody = `Total lines: ${totalLines.toLocaleString("en-US")} | Total sections: ${numberedSections} + appendices`;

const startIdx = out.indexOf(TOTALS_START);
const endIdx = out.indexOf(TOTALS_END);
let totalsUpdated = false;
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error(
    `\nERROR: the @generated:spec-index-totals block is missing or malformed in ${INDEX_PATH}.\n` +
      `Restore the START/END marker pair around the totals line, then re-run.`,
  );
  process.exit(1);
}
const oldTotals = out.slice(startIdx + 1, endIdx).join("\n");
if (oldTotals !== totalsBody) totalsUpdated = true;

if (CHECK) {
  if (totalsUpdated) {
    console.error(
      `\nSPEC-INDEX totals are STALE.\n  have: ${oldTotals}\n  want: ${totalsBody}\n` +
        `Run \`bun run scripts/regen-spec-index.ts\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`SPEC-INDEX totals OK — ${totalsBody}`);
  process.exit(0);
}

out.splice(startIdx + 1, endIdx - startIdx - 1, totalsBody);

writeFileSync(INDEX_PATH, out.join("\n"));
console.log(`\nUpdated ${updated} rows; missing ${missing.length}`);
for (const m of missing) console.log(`  ${m}`);
console.log(`Totals: ${totalsBody}${totalsUpdated ? "  (CHANGED)" : "  (unchanged)"}`);
