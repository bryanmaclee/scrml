// md-reader.d.ts — type declarations for md-reader.js (the scrml:md reader, SPEC §67.5; types gate).
//
// The tree is the reader's enum encoding: a payload variant is `{ variant, data }`, a unit variant
// is its name as a string (`"SoftBreak"`, `"Rule"`).

export interface MdSlot { offset: number; source: string }
export interface MdDiag { code: string; message: string; offset: number; line: number; col: number }
export interface MdDoc { blocks: any[]; diags: MdDiag[] }
export interface MdDedent { text: string; indent: number; dropFirst: boolean; mixed: boolean }

export function parseSlots(src: string, slots: MdSlot[]): MdDoc;
export function dedent(body: string): MdDedent;
export function headingSlugs(doc: { blocks: any[]; diags: any[] }, taken: string[]): string[];

export const MdBlock: {
  Heading(level: number, children: any[]): any;
  [variant: string]: any;
};
export const MdInline: {
  Text(text: string): any;
  [variant: string]: any;
};
