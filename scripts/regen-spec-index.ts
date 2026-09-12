import { readFileSync, writeFileSync } from "fs";

// `--check` verifies BOTH halves of the @generated surface against SPEC.md and exits non-zero if
// either is stale, without writing: (1) the totals block, and (2) every Sections-table row's line
// range and size.
//
// ⚑ S409 — (2) SUPERSEDES a recorded decision, named here per pa-base Rule 4b (cite the provenance
// of the rule you are CHANGING, not only of your change). The struck text read:
//
//   "The Sections-table line ranges are deliberately NOT gated: they drift by design between
//    amendments and a gate that cries wolf gets bypassed then deleted (`pa-base v2.4` §8)."
//
// That rationale rests on a premise REFUTED BY EXECUTION: appending one line to SPEC.md already
// turns `--check` RED on the totals alone (`have 37,947 / want 37,948`), and its remedy is the same
// single command that also refreshes every row. So the regen is ALREADY unconditional for any net
// line-count change, and gating rows adds no new obligation in the common case — there is no extra
// wolf to cry.
//
// What it DOES add is the case the totals structurally cannot see: a NET-ZERO edit (move a line
// from §14 to §15, rewrite a paragraph at equal length) leaves `Total lines` identical while every
// range below the edit shifts. A navigation map with wrong line numbers has failed at its only job,
// silently. Witnessed at S409: §34–§65 were stale by 1–2 lines on `main` and nothing reported it,
// alongside three conflict markers that this check would also have caught (side B's rows were
// stale, so `updated > 0`).
//
// pa-base §8's cry-wolf rule is respected on its own terms — the backlog at introduction is ZERO
// (the rows were regenerated in the same arc), which is the condition for adding a gate at all.
//
// provenance: rationale:the totals gate already forces an unconditional regen, measured by
// execution, so row-gating is free in the common case and closes the net-zero-edit hole
// supersedes: rationale:sections-table-ranges-drift-by-design-would-cry-wolf
const CHECK = process.argv.includes("--check");

const SPEC = readFileSync("compiler/SPEC.md", "utf8");
const INDEX_PATH = "compiler/SPEC-INDEX.md";
const INDEX = readFileSync(INDEX_PATH, "utf8");

type Section = { line: number; key: string };
// ⚑ Normalize the SPEC read too, for the same reason the INDEX read is normalized below.
// Today every consumer of `lines` happens to use `startsWith` or `.trim()`, so a trailing \r is
// harmless HERE — but that is luck, not design: adding one `=== "---"` compare or `$`-anchored
// regex over `lines` silently re-opens the exact class this file's own fix closes. Applying the
// stated principle ("normalize at the read") uniformly is the point; leaving the one raw split
// inside the file that fixes this bug is how the next instance gets written.
const lines = SPEC.replace(/\r\n/g, "\n").split("\n");
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

// ⚑ Split on /\r?\n/ and remember the file's own EOL. On a CRLF checkout (every Windows
// clone with core.autocrlf=true) a bare "\n" split leaves a trailing \r on EVERY element of
// `out`, and the totals lookup below is `out.indexOf(TOTALS_START)` — Array.prototype.indexOf,
// i.e. exact element equality — so the marker is never found and the script dies with
// "the @generated:spec-index-totals block is missing or malformed" while the block is sitting
// right there in the file. That made `--check` UNPASSABLE on Windows, which in turn made the
// pre-push generated-doc gate reject every push from a Windows clone for a bogus reason (S401).
//
// Same root as the dpa-debt.ts fix in this landing, different manifestation: there it defeated
// a `$`-anchored regex, here it defeats an exact string compare. Normalizing at the read covers
// both shapes, which is why it is done here rather than at each use site.
//
// The write below re-joins with the ORIGINAL EOL so the file keeps its checked-out line endings
// and git does not see a whole-file rewrite — same approach as state.ts:341-342.
// ⚑ MAJORITY, not `includes`. The file is fully re-joined with this value, so an all-or-nothing
// test makes a SINGLE stray line ending rewrite every line in the file — one CRLF pasted into an
// otherwise-LF SPEC-INDEX.md would flip this to "\r\n" and produce exactly the whole-file diff
// this approach exists to avoid (and one stray LF in a CRLF file would silently normalize it).
// Taking the majority keeps the dominant style and confines any churn to the odd line out.
const crlfCount = (INDEX.match(/\r\n/g) || []).length;
const lfCount = (INDEX.match(/\n/g) || []).length - crlfCount;
const INDEX_EOL = crlfCount > lfCount ? "\r\n" : "\n";
const indexLines = INDEX.replace(/\r\n/g, "\n").split("\n");
let inSectionsTable = false;
let updated = 0;
const missing: string[] = [];
const out: string[] = [];
// S409 — the COVERAGE half. `updated === 0` is only meaningful if the scan actually reached every
// row; on its own it is pa-base §8's truncated probe, where a cut enumeration reads exactly like a
// complete one. Line 125 exits the table on the first line not starting with "|", so ANY stray
// line inside it — a blank, a note, a conflict marker — silently truncates the scan and everything
// below is passed through unexamined. Measured on the #900 file: 14 of 71 rows examined, reported
// as "all current". So track which section keys a row was actually seen for, and treat an
// unmatched key as a failure in its own right rather than inferring completeness from a zero.
const seenKeys = new Set<string>();

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
  seenKeys.add(lookupKey);
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
  // S409 — the row check. `updated` and `missing` were already computed above and then DISCARDED,
  // so the drift this catches was in hand the whole time and nothing read it. See the header for
  // the superseded rationale and the measurement that refuted it.
  const unscanned = [...ranges.keys()].filter((k) => !seenKeys.has(k));
  if (unscanned.length > 0) {
    console.error(
      `\nSPEC-INDEX row scan was TRUNCATED — only ${seenKeys.size} of ${ranges.size} sections were` +
        ` reached by a table row.\n` +
        `A zero stale-count over a partial scan is not a pass; it is a smaller measurement.\n` +
        `Unreached: ${unscanned.slice(0, 12).join(", ")}${unscanned.length > 12 ? ` … +${unscanned.length - 12} more` : ""}\n` +
        `Most likely a stray line inside the Sections table (a blank, a note, or an unresolved\n` +
        `conflict marker) ended the scan early — the table must be contiguous "|" rows.`,
    );
    process.exit(1);
  }
  if (updated > 0 || missing.length > 0) {
    console.error(
      `\nSPEC-INDEX Sections rows are STALE — ${updated} row(s) whose line range or size no longer` +
        ` matches SPEC.md${missing.length ? `, ${missing.length} row(s) with no matching section` : ""}.\n` +
        `Run \`bun run scripts/regen-spec-index.ts\` and commit the result.`,
    );
    for (const m of missing) console.error(`  missing: ${m}`);
    process.exit(1);
  }
  console.log(
    `SPEC-INDEX OK — ${totalsBody}; ${seenKeys.size} of ${ranges.size} sections scanned,` +
      ` 0 stale, 0 missing.`,
  );
  process.exit(0);
}

out.splice(startIdx + 1, endIdx - startIdx - 1, totalsBody);

writeFileSync(INDEX_PATH, out.join(INDEX_EOL));
console.log(`\nUpdated ${updated} rows; missing ${missing.length}`);
for (const m of missing) console.log(`  ${m}`);
console.log(`Totals: ${totalsBody}${totalsUpdated ? "  (CHANGED)" : "  (unchanged)"}`);
