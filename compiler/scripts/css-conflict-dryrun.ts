/**
 * css-conflict-dryrun.ts — SPEC §65.11 CALIBRATION dry-run (ANALYSIS-ONLY).
 *
 * Report-only prototype of the §65.2.4 E-STYLE-CONFLICT decidable-core checker.
 * Runs over the `#{}`-bearing corpus and MEASURES the hard-error / soft /
 * fail-closed boundary BEFORE any hard error ships. Ships NOTHING into the
 * pipeline — no emission change, no diagnostic wired. Prints a machine-readable
 * JSON summary + a human table to stdout.
 *
 * Scope model (faithful to §65.2.4 + §65.14):
 *   - COMPONENT scope  = a `#{}` inside a component definition (gets the `@scope`
 *                        donut in emission) -> DECIDABLE -> HARD-eligible.
 *                        Bounded element set = the component's own static markup.
 *   - PROGRAM  scope   = a `#{}` at program level (no donut, emitted global) ->
 *                        the escape hatch -> SOFT only (unbounded cross-file reach).
 *                        We ALSO compute its provable overlaps as WHAT-IF-HARD
 *                        (what the hard error would catch if the boundary moved
 *                        to bound program `#{}` by the file's own markup).
 *
 * Program-scope CSS is read via the real `collectCssBlocks` infra (reuse).
 * Component-scope CSS is read by piecewise extraction from the component-def
 * `raw` text (the live CE re-parse is currently broken for these shapes —
 * E-COMPONENT-021 — so we cannot rely on CE-tagged `_componentScope`).
 *
 * Usage:  bun run compiler/scripts/css-conflict-dryrun.ts <corpus-list-file>
 *         (corpus-list-file = newline-separated .scrml paths)
 */

import { splitBlocks } from "../src/block-splitter.js";
import { buildAST } from "../src/ast-builder.js";
import { collectCssBlocks } from "../src/codegen/collect.ts";
import { readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

/** A static-markup element in a scope's bounded element set. */
interface El {
  tag: string;                 // lowercased tag, or component-instance name (Uppercase)
  classes: Set<string>;        // STATIC class="..." classes (unconditionally present)
  condClasses: Set<string>;    // class:NAME= reactive-toggle classes (conditionally present)
  id: string | null;
  attrs: Map<string, string | true>;  // STATIC attribute presence/value
  dynamic: boolean;            // inside <each>/conditional/lift -> not guaranteed present
  path: El[];                  // ancestor chain (root..parent), for combinator eval
}

/** A parsed grouped CSS rule (one selector + the properties it sets). */
interface Rule {
  selector: string;
  props: string[];             // deduped property names this rule sets
  atRule: string | null;       // when this rule is an @media/@container/@keyframes blob
  line: number;                // best-effort source line
}

interface Scope {
  kind: "program" | "component";
  name: string;                // component name, or "<program>"
  file: string;
  rules: Rule[];
  elements: El[];
  hasDynamic: boolean;         // scope contains <each>/conditional/lift markup
}

interface Finding {
  file: string;
  scopeKind: "program" | "component";
  scopeName: string;
  prop: string;
  sel1: string;
  sel2: string;
  line1: number;
  line2: number;
  sharedElement: string | null;
  klass: "HARD" | "WHATIF_HARD" | "SOFT" | "SOFT_UNBOUNDED" | "SAMEAXIS" | "SHORTHAND";
  reason: string;
}

// ---------------------------------------------------------------------------
// Selector parsing
// ---------------------------------------------------------------------------

const STATE_PSEUDOS = new Set([
  "hover", "focus", "active", "visited", "checked", "disabled", "enabled",
  "focus-within", "focus-visible", "target", "required", "valid", "invalid",
  "placeholder-shown", "in-range", "out-of-range", "read-only", "read-write",
  "default", "indeterminate", "link", "any-link", "autofill", "user-invalid",
  "user-valid", "playing", "paused", "current", "past", "future",
]);
const STRUCTURAL_PSEUDOS = new Set([
  "first-child", "last-child", "nth-child", "nth-last-child", "nth-of-type",
  "nth-last-of-type", "first-of-type", "last-of-type", "only-child",
  "only-of-type", "empty", "root", "scope",
]);
const FUNCTIONAL_PSEUDOS = new Set(["not", "has", "is", "where"]);

interface Compound {
  tag: string | null;
  classes: string[];
  id: string | null;
  attrs: Array<{ name: string; op?: string; val?: string }>;
  statePseudos: string[];
  structuralPseudos: string[];
  functionalPseudos: string[];
  pseudoElements: string[];
}

interface ParsedSelector {
  compounds: Compound[];       // combinator-ordered; last is the SUBJECT
  combinators: string[];       // between compounds: " " | ">" | "+" | "~"
  subject: Compound;
}

/** Split a selector into combinator-separated compounds (top-level only). */
function parseSelector(selRaw: string): ParsedSelector | null {
  const sel = selRaw.trim();
  if (!sel) return null;
  const compounds: Compound[] = [];
  const combinators: string[] = [];
  let buf = "";
  let depth = 0;
  const tokens: Array<{ comp: string; combAfter?: string }> = [];
  // Tokenize on combinators, respecting () and [] nesting.
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === ">" || c === "+" || c === "~")) {
      tokens.push({ comp: buf.trim(), combAfter: c });
      buf = "";
      continue;
    }
    if (depth === 0 && /\s/.test(c)) {
      if (buf.trim()) { tokens.push({ comp: buf.trim(), combAfter: " " }); buf = ""; }
      continue;
    }
    buf += c;
  }
  if (buf.trim()) tokens.push({ comp: buf.trim() });
  // Merge: descendant " " markers may attach to a following explicit combinator.
  const merged: Array<{ comp: string; comb?: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.comp === "") continue;
    merged.push({ comp: t.comp, comb: t.combAfter });
  }
  for (let i = 0; i < merged.length; i++) {
    const comp = parseCompound(merged[i].comp);
    if (!comp) return null;
    compounds.push(comp);
    if (i < merged.length - 1) combinators.push(merged[i].comb ?? " ");
  }
  if (compounds.length === 0) return null;
  return { compounds, combinators, subject: compounds[compounds.length - 1] };
}

function parseCompound(s: string): Compound | null {
  const comp: Compound = {
    tag: null, classes: [], id: null, attrs: [],
    statePseudos: [], structuralPseudos: [], functionalPseudos: [], pseudoElements: [],
  };
  let i = 0;
  // leading tag
  const tagM = /^([a-zA-Z][\w-]*|\*)/.exec(s.slice(i));
  if (tagM) { comp.tag = tagM[1] === "*" ? null : tagM[1].toLowerCase(); i += tagM[1].length; }
  while (i < s.length) {
    const c = s[i];
    if (c === ".") {
      const m = /^\.([\w-]+)/.exec(s.slice(i));
      if (!m) return null;
      comp.classes.push(m[1]); i += m[0].length;
    } else if (c === "#") {
      const m = /^#([\w-]+)/.exec(s.slice(i));
      if (!m) return null;
      comp.id = m[1]; i += m[0].length;
    } else if (c === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) return null;
      const inner = s.slice(i + 1, end);
      const am = /^([\w-]+)\s*([~|^$*]?=)?\s*["']?([^"'\]]*)["']?$/.exec(inner.trim());
      if (am) comp.attrs.push({ name: am[1], op: am[2], val: am[3] || undefined });
      else comp.attrs.push({ name: inner.trim() });
      i = end + 1;
    } else if (c === ":") {
      const isDouble = s[i + 1] === ":";
      const start = i + (isDouble ? 2 : 1);
      const m = /^([\w-]+)(\([^)]*\))?/.exec(s.slice(start));
      if (!m) return null;
      const name = m[1].toLowerCase();
      if (isDouble) comp.pseudoElements.push(name);
      else if (FUNCTIONAL_PSEUDOS.has(name)) comp.functionalPseudos.push(name);
      else if (STRUCTURAL_PSEUDOS.has(name)) comp.structuralPseudos.push(name);
      else comp.statePseudos.push(name);  // treat unknown pseudo-classes as state (conditional)
      i = start + m[0].length;
    } else {
      // unknown char — bail conservatively
      return comp;
    }
  }
  return comp;
}

// A rule is "conditional" (a deterministic layer per §65.2.2) when its subject
// carries a state pseudo-class or an attribute selector (state-like: [busy],
// [invalid], [aria-*], type=...). Structural pseudos are handled separately.
function hasStateDistinguisher(p: ParsedSelector): boolean {
  return p.compounds.some(c => c.statePseudos.length > 0 || c.attrs.length > 0);
}
function hasStructural(p: ParsedSelector): boolean {
  return p.compounds.some(c => c.structuralPseudos.length > 0);
}
function hasFunctional(p: ParsedSelector): boolean {
  return p.compounds.some(c => c.functionalPseudos.length > 0);
}
function hasPseudoElement(p: ParsedSelector): boolean {
  return p.compounds.some(c => c.pseudoElements.length > 0);
}
function hasSiblingCombinator(p: ParsedSelector): boolean {
  return p.combinators.some(k => k === "+" || k === "~");
}
function hasDescendantOrChild(p: ParsedSelector): boolean {
  return p.combinators.some(k => k === " " || k === ">");
}

// ---------------------------------------------------------------------------
// Element matching over the static markup set
// ---------------------------------------------------------------------------

/** Does element E satisfy compound C using ONLY unconditional (static) facts? */
function elMatchesCompound(e: El, c: Compound): boolean {
  if (c.tag && e.tag.toLowerCase() !== c.tag) return false;
  for (const cls of c.classes) if (!e.classes.has(cls)) return false;
  if (c.id && e.id !== c.id) return false;
  // attrs are state-distinguishers; callers gate on hasStateDistinguisher before
  // reaching the provable-shared test, so attrs are not re-checked here.
  return true;
}

/** Does element E match the full selector (subject + ancestor chain) over the
 *  static tree? Only descendant/child combinators are evaluated (sibling ->
 *  caller routes to soft). */
function elMatchesSelector(e: El, p: ParsedSelector): boolean {
  if (!elMatchesCompound(e, p.subject)) return false;
  // Walk ancestor compounds right-to-left over e.path.
  let ci = p.compounds.length - 2;
  let ancestors = [...e.path].reverse(); // nearest-first
  let ai = 0;
  while (ci >= 0) {
    const comb = p.combinators[ci];
    const need = p.compounds[ci];
    if (comb === ">") {
      // direct parent must match
      if (ai >= ancestors.length) return false;
      if (!elMatchesCompound(ancestors[ai], need)) return false;
      ai++;
    } else {
      // descendant: some ancestor at ai.. matches
      let found = -1;
      for (let k = ai; k < ancestors.length; k++) {
        if (elMatchesCompound(ancestors[k], need)) { found = k; break; }
      }
      if (found < 0) return false;
      ai = found + 1;
    }
    ci--;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Markup walk -> element set (static vs dynamic; static vs conditional classes)
// ---------------------------------------------------------------------------

function collectElements(nodes: any[]): { elements: El[]; hasDynamic: boolean } {
  const elements: El[] = [];
  let hasDynamic = false;

  function attrVal(a: any): string | true {
    const v = a?.value;
    if (v && typeof v === "object" && v.kind === "string-literal" && typeof v.value === "string") return v.value;
    if (typeof v === "string") return v;
    return true;
  }

  function makeEl(node: any, dynamic: boolean, path: El[]): El {
    const classes = new Set<string>();
    const condClasses = new Set<string>();
    const attrs = new Map<string, string | true>();
    let id: string | null = null;
    for (const a of (node.attrs || [])) {
      const name = a?.name;
      if (typeof name !== "string") continue;
      if (name === "class") {
        const v = attrVal(a);
        if (typeof v === "string") for (const cls of v.split(/\s+/)) if (cls) classes.add(cls);
      } else if (name.startsWith("class:")) {
        const cls = name.slice("class:".length);
        if (cls) condClasses.add(cls);   // reactive toggle -> conditional presence
      } else if (name === "id") {
        const v = attrVal(a);
        if (typeof v === "string") id = v;
      } else {
        attrs.set(name.replace(/^bind:/, ""), attrVal(a));
      }
    }
    return { tag: String(node.tag || node.tagName || "?"), classes, condClasses, id, attrs, dynamic, path };
  }

  function walk(list: any[], dynamic: boolean, path: El[]): void {
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      const k = node.kind;
      if (k === "markup") {
        const el = makeEl(node, dynamic, path);
        elements.push(el);
        if (Array.isArray(node.children)) walk(node.children, dynamic, [...path, el]);
        continue;
      }
      // Dynamic subtrees: iteration + conditionals + lifts.
      if (k === "for-stmt" || k === "for-expr" || k === "while-stmt" || k === "each-block") {
        hasDynamic = true;
        const bc = node.bodyChildren ?? node.body;
        if (Array.isArray(bc)) walk(bc, true, path);
        continue;
      }
      if (k === "if-stmt" || k === "if-expr" || k === "if-chain-expr") {
        hasDynamic = true;
        if (Array.isArray(node.consequent)) walk(node.consequent, true, path);
        if (Array.isArray(node.alternate)) walk(node.alternate, true, path);
        if (Array.isArray(node.body)) walk(node.body, true, path);
        continue;
      }
      if (k === "match-stmt" || k === "match-expr" || k === "match-block" || k === "switch-stmt") {
        hasDynamic = true;
        const bc = node.bodyChildren ?? node.armBodyChildren ?? node.body;
        if (Array.isArray(bc)) walk(bc, true, path);
        continue;
      }
      if (k === "lift-expr") {
        const t = node.expr;
        if (t && t.kind === "markup" && t.node) walk([t.node], true, path);
        continue;
      }
      if (k === "logic") {
        if (Array.isArray(node.body)) walk(node.body, dynamic, path);
        continue;
      }
      // generic descend
      if (Array.isArray(node.children)) walk(node.children, dynamic, path);
      if (Array.isArray(node.body)) walk(node.body, dynamic, path);
    }
  }
  walk(nodes, false, []);
  return { elements, hasDynamic };
}

// ---------------------------------------------------------------------------
// CSS rule extraction
// ---------------------------------------------------------------------------

/** Program-scope grouped rules from the real collectCssBlocks infra. */
function programRules(nodes: any[]): Rule[] {
  const { inlineBlocks, styleBlocks } = collectCssBlocks(nodes) as any;
  const rules: Rule[] = [];
  for (const b of [...inlineBlocks, ...styleBlocks]) {
    for (const r of (b.rules || [])) {
      if (r.atRule) {
        rules.push({ selector: "", props: [], atRule: String(r.atRule), line: lineOf(r) });
        continue;
      }
      if (r.selector && Array.isArray(r.declarations)) {
        const props = dedupe((r.declarations || []).map((d: any) => d.prop).filter(Boolean));
        rules.push({ selector: String(r.selector), props, atRule: null, line: lineOf(r) });
      }
    }
  }
  return rules;
}

function lineOf(r: any): number {
  const s = r?.span || (r?.declarations && r.declarations[0]?.span);
  return (s && (s.line ?? 0)) || 0;
}
function dedupe(a: string[]): string[] { return [...new Set(a)]; }

/** Piecewise extraction of `#{}` grouped rules from a component-def `raw`. */
function componentRules(raw: string, baseLine: number): Rule[] {
  const rules: Rule[] = [];
  for (const body of extractHashBlocks(raw)) {
    let i = 0;
    while (i < body.text.length) {
      const brace = body.text.indexOf("{", i);
      if (brace < 0) break;
      const sel = body.text.slice(i, brace).trim().replace(/^[;\s]+/, "");
      let depth = 0, j = brace, inner = "";
      for (; j < body.text.length; j++) {
        const ch = body.text[j];
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) break; }
        if (depth >= 1 && j > brace) inner += ch;
      }
      if (sel.startsWith("@")) {
        rules.push({ selector: "", props: [], atRule: sel, line: baseLine });
      } else if (sel) {
        const props = dedupe([...inner.matchAll(/([a-zA-Z-]+)\s*:/g)].map(m => m[1]));
        rules.push({ selector: sel, props, atRule: null, line: baseLine });
      }
      i = j + 1;
    }
  }
  return rules;
}

/** Extract brace-matched `#{ ... }` block bodies from a raw string. */
function extractHashBlocks(raw: string): Array<{ text: string }> {
  const out: Array<{ text: string }> = [];
  let i = 0;
  while (i < raw.length) {
    const h = raw.indexOf("#{", i);
    if (h < 0) break;
    let depth = 0, j = h + 1, body = "";
    for (; j < raw.length; j++) {
      const ch = raw[j];
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) break; }
      if (depth >= 1 && j > h + 1) body += ch;
    }
    out.push({ text: raw.slice(h + 2, j) });
    i = j + 1;
  }
  return out;
}

/** Element set from a component-def `raw` markup frame (tolerant scan). */
function componentElements(raw: string): { elements: El[]; hasDynamic: boolean } {
  const elements: El[] = [];
  let hasDynamic = /\$\{[^}]*\b(for|if|match|each)\b/.test(raw) || /<\s*(each|match|for|if)\b/i.test(raw);
  const re = /<\s*([A-Za-z][\w-]*)((?:[^<>])*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (/^<\s*\//.test(m[0])) continue;         // closing tag
    const tag = m[1];
    const ab = m[2] || "";
    const classes = new Set<string>();
    const condClasses = new Set<string>();
    const attrs = new Map<string, string | true>();
    let id: string | null = null;
    for (const cm of ab.matchAll(/class\s*=\s*"([^"]*)"/g)) for (const c of cm[1].split(/\s+/)) if (c) classes.add(c);
    for (const cm of ab.matchAll(/class\s*:\s*([\w-]+)\s*=/g)) condClasses.add(cm[1]);
    const idm = /(?:^|\s)id\s*=\s*"?([\w-]+)"?/.exec(ab);
    if (idm) id = idm[1];
    for (const am of ab.matchAll(/(?:^|\s)([\w-]+)\s*=\s*"?([\w-]*)"?/g)) {
      const nm = am[1];
      if (nm === "class" || nm === "id" || nm.startsWith("class:")) continue;
      attrs.set(nm, am[2] || true);
    }
    elements.push({ tag, classes, condClasses, id, attrs, dynamic: false, path: [] });
  }
  return { elements, hasDynamic };
}

// ---------------------------------------------------------------------------
// The §65.2.4 pairwise same-property conflict checker
// ---------------------------------------------------------------------------

function describeEl(e: El): string {
  return `<${e.tag}${e.id ? "#" + e.id : ""}${[...e.classes].map(c => "." + c).join("")}>`;
}

/** Returns a shared static element for two plain selectors, or null. */
function provableSharedElement(scope: Scope, p1: ParsedSelector, p2: ParsedSelector): El | null {
  for (const e of scope.elements) {
    if (e.dynamic) continue;
    if (elMatchesSelector(e, p1) && elMatchesSelector(e, p2)) return e;
  }
  return null;
}
function anySharedElement(scope: Scope, p1: ParsedSelector, p2: ParsedSelector): El | null {
  for (const e of scope.elements) {
    if (elMatchesSelector(e, p1) && elMatchesSelector(e, p2)) return e;
  }
  return null;
}

/** Are two single-compound plain selectors structurally provably-disjoint
 *  (an element can never satisfy both, regardless of markup)? */
function provablyDisjoint(p1: ParsedSelector, p2: ParsedSelector): boolean {
  if (p1.compounds.length !== 1 || p2.compounds.length !== 1) return false;
  const a = p1.subject, b = p2.subject;
  if (a.tag && b.tag && a.tag !== b.tag) return true;          // one tag per element
  if (a.id && b.id && a.id !== b.id) return true;              // one id per element
  return false;
}

function checkScope(scope: Scope, findings: Finding[]): void {
  const rs = scope.rules;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const r1 = rs[i], r2 = rs[j];
      // shared property?
      const shared = r1.props.filter(p => r2.props.includes(p));
      // at-rule handling (both plain-vs-atrule / atrule-vs-atrule)
      const atr1 = r1.atRule, atr2 = r2.atRule;
      if (atr1 || atr2) {
        // @keyframes/@font-face are not matching rules — skip.
        const isMedia = (s: string | null) => !!s && /^@(media|container|supports)/.test(s);
        if (isMedia(atr1) && isMedia(atr2)) {
          // cross-axis both-active unprovable -> SOFT (§65.2.4). We cannot cheaply
          // structure inner props; report a scope-level possible if same prop-ish.
          // (Conservative: only note when both are @media/@container — rare in corpus.)
        }
        continue;
      }
      if (shared.length === 0) continue;

      const p1 = parseSelector(r1.selector);
      const p2 = parseSelector(r2.selector);
      if (!p1 || !p2) continue;

      for (const prop of shared) {
        // pseudo-elements -> different render box, not a same-element conflict.
        if (hasPseudoElement(p1) || hasPseudoElement(p2)) continue;

        // functional (:not/:has/:is/:where) -> fail-closed SOFT.
        if (hasFunctional(p1) || hasFunctional(p2)) {
          pushFinding(scope, findings, prop, r1, r2, null, "SOFT",
            ":not()/:has()/:is()/:where() — non-decidable selector (fail-closed)");
          continue;
        }
        // sibling combinator -> dynamic-risk SOFT.
        if (hasSiblingCombinator(p1) || hasSiblingCombinator(p2)) {
          pushFinding(scope, findings, prop, r1, r2, null, "SOFT",
            "sibling combinator (+/~) over dynamic sibling set (fail-closed)");
          continue;
        }
        // state distinguisher (state pseudo or attr) -> deterministic LAYER.
        const s1 = hasStateDistinguisher(p1), s2 = hasStateDistinguisher(p2);
        if (s1 || s2) {
          // same-axis: both carry the SAME state pseudo on a shared subject -> §65.2.3.
          const st1 = p1.subject.statePseudos.join(",");
          const st2 = p2.subject.statePseudos.join(",");
          if (st1 && st1 === st2) {
            const shEl = anySharedElement(scope, p1, p2);
            if (shEl) pushFinding(scope, findings, prop, r1, r2, describeEl(shEl), "SAMEAXIS",
              `both rules carry :${st1} on a shared element (same-axis overlap, §65.2.3)`);
          }
          // else: one conditional / different axes -> deterministic layer -> no fire.
          continue;
        }
        // structural pseudo (:first-child, :nth-child) -> deterministic subset layer.
        if (hasStructural(p1) || hasStructural(p2)) continue;

        // Both plain + unconditional. Decide provably-shared vs disjoint.
        if (provablyDisjoint(p1, p2)) continue;                 // e.g. div vs span

        const staticShared = provableSharedElement(scope, p1, p2);
        if (staticShared) {
          const klass = scope.kind === "component" ? "HARD" : "WHATIF_HARD";
          pushFinding(scope, findings, prop, r1, r2, describeEl(staticShared), klass,
            "both rules provably match a STATIC element, unconditionally, same property");
          continue;
        }
        // no static element matches both.
        const anyShared = anySharedElement(scope, p1, p2);
        if (anyShared && anyShared.dynamic) {
          // The element matches both but lives in <each>/conditional markup — its
          // PRESENCE is conditional though the match is unconditional (fail-closed).
          pushFinding(scope, findings, prop, r1, r2, describeEl(anyShared), "SOFT",
            "match only via <each>/conditional (dynamic) element (fail-closed)");
          continue;
        }
        // No enumerable element (static OR dynamic-template) in this file matches
        // both selectors.
        //   - COMPONENT scope: the donut bounds the element set to THIS markup ->
        //     proven not to co-occur here -> NO FIRE.
        //   - PROGRAM scope: the rule is emitted GLOBAL (no @scope), so it can match
        //     `.btn` in ANOTHER file/component -> the element set is unbounded ->
        //     §65.2.4 says the checker can neither prove-disjoint nor prove-shared ->
        //     the honest literal reading is SOFT. This is the firehose: it fires for
        //     EVERY same-property program pair (body+.form-card etc). Tagged distinctly
        //     so the report can separate it from the structural fail-closed soft.
        if (scope.kind === "program" && !provablyDisjoint(p1, p2)) {
          pushFinding(scope, findings, prop, r1, r2, null, "SOFT_UNBOUNDED",
            "program-level global rule — unbounded cross-file element set, no local overlap (literal §65.2.4 fail-closed)");
        }
        // otherwise (component, no local co-occurrence): no conflict.
      }
    }
  }
}

function pushFinding(scope: Scope, findings: Finding[], prop: string, r1: Rule, r2: Rule,
                     sharedEl: string | null, klass: Finding["klass"], reason: string): void {
  findings.push({
    file: scope.file, scopeKind: scope.kind, scopeName: scope.name, prop,
    sel1: r1.selector, sel2: r2.selector, line1: r1.line, line2: r2.line,
    sharedElement: sharedEl, klass, reason,
  });
}

// ---------------------------------------------------------------------------
// Shorthand/longhand overlap detector (spec-gap probe, reported separately)
// ---------------------------------------------------------------------------

const SHORTHAND_LONGHAND: Record<string, string[]> = {
  background: ["background-color", "background-image", "background-position", "background-size", "background-repeat"],
  border: ["border-width", "border-style", "border-color", "border-top", "border-bottom", "border-left", "border-right"],
  margin: ["margin-top", "margin-bottom", "margin-left", "margin-right"],
  padding: ["padding-top", "padding-bottom", "padding-left", "padding-right"],
  font: ["font-size", "font-family", "font-weight", "font-style", "line-height"],
  "border-radius": [],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  inset: ["top", "right", "bottom", "left"],
};

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function buildScopes(file: string): Scope[] {
  const src = readFileSync(file, "utf8");
  let tab: any;
  try { tab = buildAST({ filePath: file, blocks: splitBlocks(file, src).blocks }); }
  catch { return []; }
  const nodes = tab.ast?.nodes ?? [];
  const scopes: Scope[] = [];

  // program scope
  const pr = programRules(nodes);
  if (pr.length > 0) {
    const { elements, hasDynamic } = collectElements(nodes);
    scopes.push({ kind: "program", name: "<program>", file, rules: pr, elements, hasDynamic });
  }
  // component scopes (from component-def raw)
  for (const c of (tab.ast?.components ?? [])) {
    if (!(c.raw || "").includes("#{")) continue;
    const baseLine = c.span?.line ?? 0;
    const rules = componentRules(c.raw, baseLine);
    if (rules.filter((r: Rule) => r.selector).length === 0) continue;
    const { elements, hasDynamic } = componentElements(c.raw);
    scopes.push({ kind: "component", name: c.name, file, rules, elements, hasDynamic });
  }
  return scopes;
}

function main(): void {
  const listFile = process.argv[2];
  const files = readFileSync(listFile, "utf8").trim().split("\n").filter(Boolean);
  const allFindings: Finding[] = [];
  const shorthandFindings: Finding[] = [];
  let scopeCount = { program: 0, component: 0 };
  let ruleCount = 0;

  for (const file of files) {
    const scopes = buildScopes(file);
    for (const scope of scopes) {
      scopeCount[scope.kind]++;
      ruleCount += scope.rules.filter(r => r.selector).length;
      checkScope(scope, allFindings);
      // shorthand/longhand probe (separate — spec-gap surface)
      shorthandProbe(scope, shorthandFindings);
    }
  }

  const by = (k: string) => allFindings.filter(f => f.klass === k);
  const summary = {
    files: files.length,
    scopes: scopeCount,
    groupedRules: ruleCount,
    findings: {
      HARD: by("HARD").length,
      WHATIF_HARD: by("WHATIF_HARD").length,
      SAMEAXIS: by("SAMEAXIS").length,
      SOFT_STRUCTURAL: by("SOFT").length,
      SOFT_UNBOUNDED_program_firehose: by("SOFT_UNBOUNDED").length,
      SHORTHAND_LONGHAND: shorthandFindings.length,
    },
  };

  // universal-`*` sub-slice of WHATIF (the reset false-positive class)
  const universalFP = by("WHATIF_HARD").filter(f => f.sel1.trim() === "*" || f.sel2.trim() === "*");
  const bemFP = by("WHATIF_HARD").filter(f => f.sel1.trim() !== "*" && f.sel2.trim() !== "*");
  (summary as any).WHATIF_breakdown = { universalReset: universalFP.length, bemBaseModifier: bemFP.length };

  // firehose file/scope spread (the literal-§65.2.4-program-unbounded reading)
  const fh = by("SOFT_UNBOUNDED");
  const fhFiles = new Set(fh.map(f => f.file));
  const perFile: Record<string, number> = {};
  for (const f of fh) perFile[f.file] = (perFile[f.file] || 0) + 1;
  const worst = Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 6);
  (summary as any).firehose_spread = { distinctFiles: fhFiles.size, worstFiles: worst };

  console.log("=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  const dump = (title: string, list: Finding[]) => {
    console.log(`\n=== ${title} (${list.length}) ===`);
    for (const f of list) {
      console.log(`  ${f.file}  [${f.scopeKind}:${f.scopeName}]  prop=${f.prop}`);
      console.log(`     R1: "${f.sel1}" (L${f.line1})   R2: "${f.sel2}" (L${f.line2})`);
      console.log(`     shared=${f.sharedElement ?? "-"}   ${f.reason}`);
    }
  };
  dump("HARD E-STYLE-CONFLICT (component scope, provable)", by("HARD"));
  dump("WHAT-IF HARD — universal `*` reset vs class (false-positive class)", universalFP);
  dump("WHAT-IF HARD — BEM base+modifier / same-element overlap (judgment call)", bemFP);
  dump("SAME-AXIS (E-STYLE-CONFLICT §65.2.3)", by("SAMEAXIS"));
  dump("SOFT (structural fail-closed: functional/sibling/dynamic-match)", by("SOFT"));
  console.log(`\n=== SOFT_UNBOUNDED program firehose: ${by("SOFT_UNBOUNDED").length} (every same-property program pair — literal §65.2.4 unbounded reading) ===`);
  dump("SHORTHAND/LONGHAND overlap (spec-gap probe)", shorthandFindings);
}

function shorthandProbe(scope: Scope, out: Finding[]): void {
  const rs = scope.rules.filter(r => r.selector && !r.atRule);
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const r1 = rs[i], r2 = rs[j];
      const p1 = parseSelector(r1.selector), p2 = parseSelector(r2.selector);
      if (!p1 || !p2) continue;
      if (hasStateDistinguisher(p1) || hasStateDistinguisher(p2)) continue;
      if (hasFunctional(p1) || hasFunctional(p2) || hasSiblingCombinator(p1) || hasSiblingCombinator(p2)) continue;
      if (provablyDisjoint(p1, p2)) continue;
      const shEl = provableSharedElement(scope, p1, p2);
      if (!shEl) continue;
      for (const [short, longs] of Object.entries(SHORTHAND_LONGHAND)) {
        for (const long of longs) {
          if ((r1.props.includes(short) && r2.props.includes(long)) ||
              (r1.props.includes(long) && r2.props.includes(short))) {
            out.push({
              file: scope.file, scopeKind: scope.kind, scopeName: scope.name,
              prop: `${short}~${long}`, sel1: r1.selector, sel2: r2.selector,
              line1: r1.line, line2: r2.line, sharedElement: describeEl(shEl),
              klass: "SHORTHAND", reason: `shorthand '${short}' overlaps longhand '${long}' on a shared element`,
            });
          }
        }
      }
    }
  }
}

main();
