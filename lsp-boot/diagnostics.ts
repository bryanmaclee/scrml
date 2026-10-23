/**
 * lsp-boot/diagnostics.ts — the bootstrap's diagnostics as LSP diagnostics. change-id: s469-boot-lsp.
 *
 * Pure (no transport, no worker) so it is unit-testable on its own. The bootstrap reports
 * 1-based line/col in UTF-16 code units (JS string offsets — scripts/scrml-boot.ts lineCol); LSP
 * positions are 0-based in UTF-16 code units by default, so the mapping is a subtraction.
 */

import { basename, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import type { Diagnostic as BootDiagnostic } from "../scripts/scrml-boot.ts";

export const SOURCE = "scrml-boot";
export const CRASH_CODE = "scrml-boot-crash";

/** LSP DiagnosticSeverity. */
const SEVERITY = { error: 1, warning: 2, info: 3 } as const;

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type LspDiagnostic = {
  range: Range;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
  relatedInformation?: { location: { uri: string; range: Range }; message: string }[];
};

function lineLength(text: string, line0: number): number {
  const lines = text.split("\n");
  const l = lines[Math.max(0, Math.min(line0, lines.length - 1))] ?? "";
  return l.endsWith("\r") ? l.length - 1 : l.length;
}

/** The whole first line: where a diagnostic with no position in this document goes. */
export function firstLineRange(text: string): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: lineLength(text, 0) } };
}

function spanRange(d: BootDiagnostic, text: string): Range {
  const start = { line: (d.line as number) - 1, character: Math.max(0, (d.col ?? 1) - 1) };
  if (d.endLine !== undefined && d.endCol !== undefined) {
    return { start, end: { line: d.endLine - 1, character: Math.max(0, d.endCol - 1) } };
  }
  // no span end: one character, or nothing at the end of a line
  const len = lineLength(text, start.line);
  return { start, end: { line: start.line, character: Math.min(start.character + 1, Math.max(len, start.character)) } };
}

/** The line of `docText` that imports `importedAbs` (by file name), else line 0. */
function importLineRange(docText: string, docPath: string, importedAbs: string): Range {
  const rel = relative(dirname(docPath), importedAbs).split("\\").join("/");
  const name = basename(importedAbs);
  const lines = docText.split("\n");
  let hit = -1;
  for (let i = 0; i < lines.length && hit < 0; i++) {
    if (lines[i].includes(`"./${rel}"`) || lines[i].includes(`"${rel}"`)) hit = i;
  }
  for (let i = 0; i < lines.length && hit < 0; i++) if (/\bimport\b/.test(lines[i]) && lines[i].includes(name)) hit = i;
  if (hit < 0) return firstLineRange(docText);
  return { start: { line: hit, character: 0 }, end: { line: hit, character: lineLength(docText, hit) } };
}

/**
 * The bootstrap's diagnostics for a compile whose entry is `docPath`, as the LSP diagnostics of
 * that document. A diagnostic in another file of the source set (an import) is shown on the line
 * that imports it, naming where it is, with relatedInformation pointing there. A diagnostic with
 * no position (a printer refusal) goes on the first line.
 */
export function toLspDiagnostics(diags: BootDiagnostic[], docPath: string, docText: string): LspDiagnostic[] {
  const out: LspDiagnostic[] = [];
  for (const d of diags) {
    const base = { severity: SEVERITY[d.severity] ?? 1, code: d.code, source: SOURCE };
    if (d.file === docPath && d.line !== undefined) {
      out.push({ ...base, range: spanRange(d, docText), message: d.message });
    } else if (d.file !== undefined && d.file !== docPath) {
      const where = `${relative(dirname(docPath), d.file).split("\\").join("/")}${d.line ? `:${d.line}${d.col ? ":" + d.col : ""}` : ""}`;
      const lsp: LspDiagnostic = { ...base, range: importLineRange(docText, docPath, d.file), message: `in ${where}: ${d.message}` };
      if (d.line !== undefined) {
        const theirs = { start: { line: d.line - 1, character: Math.max(0, (d.col ?? 1) - 1) }, end: { line: d.line - 1, character: Math.max(0, (d.col ?? 1) - 1) } };
        if (d.endLine !== undefined && d.endCol !== undefined) theirs.end = { line: d.endLine - 1, character: d.endCol - 1 };
        lsp.relatedInformation = [{ location: { uri: pathToFileURL(d.file).href, range: theirs }, message: d.message }];
      }
      out.push(lsp);
    } else {
      out.push({ ...base, range: firstLineRange(docText), message: d.message });
    }
  }
  return out;
}

/** The single diagnostic a bootstrap crash (or hang) becomes — never a silently clean buffer. */
export function crashDiagnostic(docText: string, what: string): LspDiagnostic {
  return { range: firstLineRange(docText), severity: 1, code: CRASH_CODE, source: SOURCE, message: `scrml-boot crashed: ${what}` };
}
