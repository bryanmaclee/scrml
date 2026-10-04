/**
 * s34-catalog.ts — the ONE parser of SPEC §34's code catalog (the `| Code | Section | Trigger |
 * Severity |` rows). Shared by scripts/s34-census.ts (the catalog census) and
 * scripts/gen-bootstrap-severity.ts (the bootstrap's severity table, s451-boot-diag-severity), so
 * the two can never read the catalog differently.
 *
 * NO HARDCODED LINE NUMBERS: §34's range is derived from the `## 34.` / `## 35.` headings.
 *
 * Row shape. A row is a markdown table line under §34 whose FIRST cell is a diagnostic code
 * (`E-…` / `W-…` / `I-…`, optionally `~~struck~~`, `**bold**` or `backticked`). The SEVERITY is
 * the cell in the column the table's HEADER names `Severity` (`| Code | Section | Trigger |
 * Severity |`). A few rows omit the trailing pipe (`… | Error`), and a trigger cell may itself
 * contain a `|` (a union type in backticks), so a row with MORE cells than its header is indexed
 * from the END. An EMPTY Severity cell stays empty — never read the trigger text in its place (a
 * trigger starting "Warning…" would otherwise become a Warning: fail-OPEN) — and an empty cell
 * states no compile severity (compileSeverityOf → null → the bootstrap's fail-closed Error).
 */

export type S34Row = {
  /** The code, decorations stripped. */
  code: string;
  /** `~~CODE~~` — a retired row (S305 trap T1: its own state, never "no row"). */
  struck: boolean;
  /** The Severity column, verbatim (trimmed): "Error" · "Warning" · "Info" · "—" · "Runtime" ·
   *  "Test" · "Error (reserved)" · … */
  severity: string;
  /** 1-based SPEC line. */
  line: number;
  /** The raw table line. */
  raw: string;
  /** The `|`-split cells (untrimmed; cells[0] is the text before the first pipe). */
  cells: string[];
};

export type S34Range = { start: number; end: number; nativeStart: number };

/** §34's line range (1-based, inclusive) and the §34.1 native-parser sub-catalog's first line. */
export function s34Range(specLines: string[]): S34Range {
  const find = (re: RegExp): number => {
    for (let i = 0; i < specLines.length; i++) if (re.test(specLines[i])) return i + 1;
    return -1;
  };
  const start = find(/^##\s+34\.\s/);
  const next = find(/^##\s+35\.\s/);
  if (start < 0 || next < 0) throw new Error("s34-catalog: could not locate the §34/§35 headings in SPEC.md");
  return { start, end: next - 1, nativeStart: find(/^###\s+34\.1\s/) };
}

/** A table line's cells: the text between pipes, trimmed, without the empty edge cells. */
function rowCells(raw: string): string[] {
  const c = raw.split("|").map((x) => x.trim());
  c.shift(); // before the leading pipe
  if (c.length > 0 && c[c.length - 1] === "" && raw.trimEnd().endsWith("|")) c.pop(); // after the trailing pipe
  return c;
}

/** The Severity cell of a code row, by the header's column (indexed from the end when the row has
 *  extra cells from a `|` inside its text); "" when the table has no Severity column or the cell is
 *  missing or empty. */
export function severityCell(raw: string, header: string[] | null): string {
  if (!header) return "";
  const sev = header.findIndex((h) => /^severity$/i.test(h));
  if (sev < 0) return "";
  const c = rowCells(raw);
  const i = c.length > header.length ? c.length - (header.length - sev) : sev;
  return c[i] ?? "";
}

/** Every code row of §34, in SPEC order (duplicates kept — the caller decides). */
export function parseS34Rows(specLines: string[]): S34Row[] {
  const { start, end } = s34Range(specLines);
  const rows: S34Row[] = [];
  let header: string[] | null = null;
  for (let i = start - 1; i < end && i < specLines.length; i++) {
    const raw = specLines[i];
    if (!raw.startsWith("|")) { header = null; continue; } // a table ends at its first non-table line
    const cells = raw.split("|");
    if (cells.length < 3) continue;
    const first = cells[1].trim();
    if (/^code$/i.test(first)) { header = rowCells(raw); continue; }
    if (!first || /^-+$/.test(first)) continue;
    const struck = first.includes("~~");
    const code = first.replace(/~~/g, "").replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!/^[EWI]-[A-Z0-9-]+$/.test(code)) continue;
    rows.push({ code, struck, severity: severityCell(raw, header), line: i + 1, raw, cells });
  }
  return rows;
}

export type CompileSeverity = "Error" | "Warning" | "Info";

/**
 * The COMPILE severity a row states, or null when it states none. §34 (S451): "A code whose
 * Severity column reads **Error** fails the compile … **Warning** and **Info** codes do not fail
 * the compile." A qualified cell (`Error (reserved)`, `Error (retired)`) reads by its leading word.
 * `—` (a retired or meta row), `Runtime` (a runtime value, not a compile diagnostic) and `Test`
 * (a test-runner code) state no compile severity: null.
 */
export function compileSeverityOf(row: S34Row): CompileSeverity | null {
  if (row.struck) return null;
  const m = /^(Error|Warning|Info)\b/.exec(row.severity);
  return m ? (m[1] as CompileSeverity) : null;
}
