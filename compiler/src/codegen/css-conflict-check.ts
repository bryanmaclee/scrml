/**
 * css-conflict-check.ts — SPEC §65.2 Wave-1 flat-specificity conflict checker.
 *
 * The styling analog of an exhaustive `match` (§18): an UNCONDITIONAL same-property
 * overlap on a provably-shared element, between two rules at the same precedence
 * level, is `E-STYLE-CONFLICT` — the compiler refuses to silently pick a winner.
 * A pair the checker can neither prove-disjoint nor prove-shared is the soft,
 * non-blocking `W-STYLE-CONFLICT-POSSIBLE` (fail-closed residue).
 *
 * This is the SHIPPING pipeline pass. It ports the decidable core of the
 * report-only calibration prototype (`compiler/scripts/css-conflict-dryrun.ts`)
 * and IMPLEMENTS the three ratified Wave-1 calibration carve-outs (§65.2.4 R1–R3),
 * which the prototype only RECOMMENDED:
 *
 *   R1 — universal `*` / bare-root (`html`/`body`) rules are a LOWER LAYER
 *        (author-reset floor, §65.5), not a same-level conflict → an overlap
 *        between them and a class/id/specific rule is layered → NO diagnostic.
 *   R2 — a `class × class` base+modifier overlap (`.btn` + `.btn-op` on
 *        `<button class="btn btn-op">`) is SOFT in Wave 1 (its fix — ordered
 *        `style=[a,b]`, §65.4.4 — is a Wave-2 primitive). Promotes to HARD in
 *        Wave 2.
 *   R3 — the program-scope soft diagnostic is FILE-BOUNDED: fire ONLY on a
 *        provable LOCAL (same-file) overlap, never every same-property program
 *        pair (the 2941-warning firehose the literal reading produced).
 *
 * Scope model (§65.2.4):
 *   - COMPONENT scope (a `#{}` inside a CE-expanded component, `@scope`-donut
 *     bounded) is DECIDABLE → HARD-eligible. Its bounded element set is the
 *     component's own donut-limited static markup.
 *   - PROGRAM scope (a program-level `#{}`, emitted global, no donut) is the
 *     escape hatch → SOFT only. Resolved against the file's own enumerable
 *     markup (R3), NOT an unbounded cross-file element space.
 *
 * The CSS is read via the live `collectCssBlocks` infra (`_componentScope` tags
 * component-scoped blocks). Component blocks are duplicated once per component
 * instantiation by CE — deduped here by source span so each component scope is
 * checked once.
 */

import { collectCssBlocks } from "./collect.ts";

// ---------------------------------------------------------------------------
// Public diagnostic shape (matches the collectErrors sink in api.js)
// ---------------------------------------------------------------------------

export interface CssConflictSpan {
  file?: string;
  start?: number;
  end?: number;
  line?: number;
  col?: number;
}

export interface CssConflictDiagnostic {
  filePath: string;
  line: number;
  column: number;
  code: "E-STYLE-CONFLICT" | "W-STYLE-CONFLICT-POSSIBLE";
  severity: "error" | "info";
  message: string;
  span: CssConflictSpan;
}

// ---------------------------------------------------------------------------
// Loose AST/CSS shapes (the pipeline hands us untyped nodes)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = Record<string, any>;

interface FileASTLike {
  filePath?: string;
  ast?: { nodes?: Node[] };
  nodes?: Node[];
}

// ---------------------------------------------------------------------------
// Element model — a static-markup element in a scope's bounded element set
// ---------------------------------------------------------------------------

interface El {
  tag: string; // lowercased tag, or component-instance name
  classes: Set<string>; // STATIC class="..." classes (unconditionally present)
  condClasses: Set<string>; // class:NAME= reactive-toggle classes (conditionally present)
  id: string | null;
  attrs: Map<string, string | true>; // STATIC attribute presence/value
  dynamic: boolean; // inside <each>/conditional/lift — not guaranteed present
  path: El[]; // ancestor chain (root..parent), for combinator eval
}

// ---------------------------------------------------------------------------
// Rule model — one grouped selector + the properties it sets
// ---------------------------------------------------------------------------

interface Rule {
  selector: string;
  props: string[]; // deduped property names this rule sets
  atRule: string | null; // set when this rule is an @media/@container/@keyframes blob
  span: CssConflictSpan;
  parsed?: ParsedSelector | null; // parse-once cache (populated in checkScope)
}

interface Scope {
  kind: "program" | "component";
  name: string; // component name, or "<program>"
  file: string;
  rules: Rule[];
  elements: El[];
}

// ---------------------------------------------------------------------------
// Selector parsing (ported verbatim from the calibration prototype)
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

const BARE_ROOT_TAGS = new Set(["html", "body"]);

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
  compounds: Compound[]; // combinator-ordered; last is the SUBJECT
  combinators: string[]; // between compounds: " " | ">" | "+" | "~"
  subject: Compound;
}

/**
 * Split a selector into combinator-separated compounds (top-level only).
 *
 * An explicit combinator (`>`/`+`/`~`) survives whitespace on either side — a
 * spaced `.card > .title` stays a CHILD combinator (not collapsed to descendant),
 * and a spaced `.a ~ .b` / `.a + .b` keeps its sibling combinator so the §65.2.4
 * sibling fail-closed carve-out is not bypassed. A gap with only whitespace is the
 * descendant combinator; an explicit combinator anywhere in the gap wins.
 */
function parseSelector(selRaw: string): ParsedSelector | null {
  const sel = selRaw.trim();
  if (!sel) return null;
  const rawCompounds: string[] = [];
  const combos: string[] = []; // combinator BEFORE compound i (length = compounds - 1)
  let buf = "";
  let depth = 0;
  // `sep` accumulates the combinator in the gap AFTER the last-closed compound:
  // null = still inside a compound / no gap yet, " " = descendant, ">"/"+"/"~" = explicit.
  let sep: string | null = null;

  const closeCompound = (): void => {
    if (!buf) return;
    if (rawCompounds.length > 0) combos.push(sep ?? " ");
    rawCompounds.push(buf);
    buf = "";
    sep = null;
  };

  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === ">" || c === "+" || c === "~")) {
      closeCompound(); // end any open compound; we are now in the inter-compound gap
      sep = c; // explicit combinator overrides a prior whitespace-descendant sep
      continue;
    }
    if (depth === 0 && /\s/.test(c)) {
      if (buf) closeCompound();
      if (sep === null) sep = " "; // descendant gap — but never downgrade an explicit combinator
      continue;
    }
    buf += c;
  }
  closeCompound();

  if (rawCompounds.length === 0) return null;
  const compounds: Compound[] = [];
  for (const rc of rawCompounds) {
    const comp = parseCompound(rc);
    if (!comp) return null; // an unparseable compound nulls the whole selector → fail-closed soft
    compounds.push(comp);
  }
  return { compounds, combinators: combos, subject: compounds[compounds.length - 1] };
}

function parseCompound(s: string): Compound | null {
  const comp: Compound = {
    tag: null, classes: [], id: null, attrs: [],
    statePseudos: [], structuralPseudos: [], functionalPseudos: [], pseudoElements: [],
  };
  let i = 0;
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
      else comp.statePseudos.push(name); // treat unknown pseudo-classes as state (conditional)
      i = start + m[0].length;
    } else {
      // Unknown char (`&`-nesting, `%`, an escaped `\`, a namespace `|`, …) — the
      // checker cannot decide this compound. Return NULL (NOT a truthy empty
      // compound): a null nulls the whole selector upstream, so the pair routes
      // to the fail-closed soft — it is never mistaken for a floor-layer `*`
      // (empty compound) nor a truncated-but-broadened match (`.btn/x` → `.btn`).
      return null;
    }
  }
  return comp;
}

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

/** §65.2.4 R1 — is this selector a universal `*` / bare-root `html`/`body`
 *  rule (an author-reset floor, resolved BELOW class/id/specific rules)? A
 *  single bare compound with no class/id/attr/pseudo. */
function isFloorLayerSelector(p: ParsedSelector): boolean {
  if (p.compounds.length !== 1) return false;
  const c = p.subject;
  if (c.classes.length > 0 || c.id || c.attrs.length > 0) return false;
  if (c.statePseudos.length || c.structuralPseudos.length || c.functionalPseudos.length || c.pseudoElements.length) return false;
  // Universal `*` (tag === null after parse) or a bare-root tag.
  return c.tag === null || BARE_ROOT_TAGS.has(c.tag);
}

/** §65.2.4 R2 — is this a `class × class` pair (both sides carry ≥1 class,
 *  neither an id)? The BEM base+modifier shape (`.btn` + `.btn-op`). A bare
 *  `tag {}` (no class) is NOT class-bearing, so `button {}` vs `.btn {}` stays
 *  the decidable `tag × class` HARD case. */
function isClassBearingSubject(p: ParsedSelector): boolean {
  return p.subject.classes.length > 0 && !p.subject.id;
}

// ---------------------------------------------------------------------------
// Element matching over the static markup set
// ---------------------------------------------------------------------------

/** Does element E satisfy compound C using ONLY unconditional (static) facts?
 *  Reactive class:NAME= toggles (condClasses) are NOT counted — a conditional
 *  class is not an UNCONDITIONAL match (§65.2.4 reactive-toggle carve-out). */
function elMatchesCompoundStatic(e: El, c: Compound): boolean {
  if (c.tag && e.tag.toLowerCase() !== c.tag) return false;
  for (const cls of c.classes) if (!e.classes.has(cls)) return false;
  if (c.id && e.id !== c.id) return false;
  return true;
}

/** Match allowing reactive class:NAME= toggle classes (conditional presence).
 *  Used to detect a CONDITIONAL both-match → the fail-closed soft, never hard. */
function elMatchesCompoundConditional(e: El, c: Compound): boolean {
  if (c.tag && e.tag.toLowerCase() !== c.tag) return false;
  for (const cls of c.classes) if (!e.classes.has(cls) && !e.condClasses.has(cls)) return false;
  if (c.id && e.id !== c.id) return false;
  return true;
}

type CompoundMatcher = (e: El, c: Compound) => boolean;

/** Does element E match the full selector (subject + ancestor chain) over the
 *  static tree? Only descendant/child combinators are evaluated (sibling routes
 *  to soft upstream). */
function elMatchesSelector(e: El, p: ParsedSelector, matcher: CompoundMatcher): boolean {
  if (!matcher(e, p.subject)) return false;
  let ci = p.compounds.length - 2;
  const ancestors = [...e.path].reverse(); // nearest-first
  let ai = 0;
  while (ci >= 0) {
    const comb = p.combinators[ci];
    const need = p.compounds[ci];
    if (comb === ">") {
      if (ai >= ancestors.length) return false;
      if (!matcher(ancestors[ai], need)) return false;
      ai++;
    } else {
      let found = -1;
      for (let k = ai; k < ancestors.length; k++) {
        if (matcher(ancestors[k], need)) { found = k; break; }
      }
      if (found < 0) return false;
      ai = found + 1;
    }
    ci--;
  }
  return true;
}

/** A shared STATIC element for two selectors (unconditional both-match), or null. */
function provableSharedElement(scope: Scope, p1: ParsedSelector, p2: ParsedSelector): El | null {
  for (const e of scope.elements) {
    if (e.dynamic) continue;
    if (elMatchesSelector(e, p1, elMatchesCompoundStatic) && elMatchesSelector(e, p2, elMatchesCompoundStatic)) return e;
  }
  return null;
}

/** A shared element allowing reactive-toggle / dynamic presence (→ soft). */
function conditionalSharedElement(scope: Scope, p1: ParsedSelector, p2: ParsedSelector): El | null {
  for (const e of scope.elements) {
    if (elMatchesSelector(e, p1, elMatchesCompoundConditional) && elMatchesSelector(e, p2, elMatchesCompoundConditional)) return e;
  }
  return null;
}

/** A single-compound selector from just the SUBJECT of `p` (drops the ancestor/
 *  sibling chain). Used to test whether two combinator/functional selectors could
 *  even plausibly target a common element before fail-closing them to soft. */
function subjectOnly(p: ParsedSelector): ParsedSelector {
  return { compounds: [p.subject], combinators: [], subject: p.subject };
}

/** Could the SUBJECTS of two selectors match a common element in the scope
 *  (static OR conditional/dynamic)? Bounds the fail-closed soft to plausible
 *  overlaps — an unrelated `.toggle-all + label` vs `.header` never fires. */
function subjectsCouldShare(scope: Scope, p1: ParsedSelector, p2: ParsedSelector): boolean {
  const s1 = subjectOnly(p1), s2 = subjectOnly(p2);
  return !!(provableSharedElement(scope, s1, s2) || conditionalSharedElement(scope, s1, s2));
}

/** Structurally provably-disjoint (no element can satisfy both, any markup). */
function provablyDisjoint(p1: ParsedSelector, p2: ParsedSelector): boolean {
  if (p1.compounds.length !== 1 || p2.compounds.length !== 1) return false;
  const a = p1.subject, b = p2.subject;
  if (a.tag && b.tag && a.tag !== b.tag) return true; // one tag per element
  if (a.id && b.id && a.id !== b.id) return true; // one id per element
  return false;
}

function describeEl(e: El): string {
  return `<${e.tag}${e.id ? "#" + e.id : ""}${[...e.classes].map(c => "." + c).join("")}>`;
}

// ---------------------------------------------------------------------------
// Markup walk → element set (static vs dynamic; static vs conditional classes)
// ---------------------------------------------------------------------------

function attrVal(a: Node): string | true {
  const v = a?.value;
  if (v && typeof v === "object" && v.kind === "string-literal" && typeof v.value === "string") return v.value;
  if (typeof v === "string") return v;
  return true;
}

function makeEl(node: Node, dynamic: boolean, path: El[]): El {
  const classes = new Set<string>();
  const condClasses = new Set<string>();
  const attrs = new Map<string, string | true>();
  let id: string | null = null;
  const attrList: Node[] = node.attrs || node.attributes || [];
  for (const a of attrList) {
    const name = a?.name;
    if (typeof name !== "string") continue;
    if (name === "class") {
      const v = attrVal(a);
      if (typeof v === "string") for (const cls of v.split(/\s+/)) if (cls) classes.add(cls);
    } else if (name.startsWith("class:")) {
      const cls = name.slice("class:".length);
      if (cls) condClasses.add(cls); // reactive toggle → conditional presence
    } else if (name === "id") {
      const v = attrVal(a);
      if (typeof v === "string") id = v;
    } else {
      attrs.set(name.replace(/^bind:/, ""), attrVal(a));
    }
  }
  return { tag: String(node.tag || node.tagName || "?"), classes, condClasses, id, attrs, dynamic, path };
}

// The node kinds whose bodies are DYNAMIC (an element inside is not guaranteed
// present / may repeat) — iteration, conditionals, match/switch.
const DYNAMIC_KINDS = new Set([
  "for-stmt", "for-expr", "while-stmt", "each-block",
  "if-stmt", "if-expr", "if-chain-expr",
  "match-stmt", "match-expr", "match-block", "switch-stmt",
]);
// Every child-list key a container node may hold. Kept in ONE place so the
// program walker and the component walker traverse the IDENTICAL structure —
// the fix for the component-in-a-loop blind spot (a `<Card>` inside `<if>` /
// `<each>` / `<match>` reached its element-set only via `children`/`body`).
const CONTAINER_KEYS = ["children", "body", "bodyChildren", "consequent", "alternate", "armBodyChildren"];

/**
 * Walk every markup element reachable from `list`, calling `onEl(el, node)`.
 * Descends through ALL control-flow container keys + the `lift-expr` markup
 * (`node.expr.node`) — the same reachability the codegen emitters use — so no
 * element is missed regardless of how it is nested. `boundary(node)` (optional)
 * stops descent at (and excludes) a node — used for the component `@scope` donut.
 */
function walkMarkupElements(
  list: Node[], dynamic: boolean, path: El[],
  onEl: (el: El, node: Node) => void,
  boundary?: (node: Node) => boolean,
): void {
  for (const node of list) {
    if (!node || typeof node !== "object") continue;
    const k = node.kind;
    if (k === "markup") {
      if (boundary && boundary(node)) continue; // donut boundary — exclude + don't descend
      const el = makeEl(node, dynamic, path);
      onEl(el, node);
      if (Array.isArray(node.children)) walkMarkupElements(node.children, dynamic, [...path, el], onEl, boundary);
      continue;
    }
    if (k === "lift-expr") {
      const t = node.expr;
      if (t && t.kind === "markup" && t.node) walkMarkupElements([t.node], true, path, onEl, boundary);
      continue;
    }
    const dyn = dynamic || DYNAMIC_KINDS.has(k);
    for (const key of CONTAINER_KEYS) {
      const arr = node[key];
      if (Array.isArray(arr)) walkMarkupElements(arr, dyn, path, onEl, boundary);
    }
  }
}

/**
 * Collect the file's program-scope element set — every static markup element,
 * including elements inside CE-expanded components (a program-global `#{}` rule
 * is emitted global and DOES match them — the file's enumerable set per R3).
 */
function collectProgramElements(nodes: Node[]): El[] {
  const elements: El[] = [];
  walkMarkupElements(nodes, false, [], (el) => elements.push(el));
  return elements;
}

/**
 * Collect the DONUT-bounded element set for one component scope. CE tags the
 * expansion root with `_expandedFrom === name`; the `@scope (...) to
 * ([data-scrml])` donut covers that root plus descendants, STOPPING at any
 * nested component boundary (a descendant re-tagged with its own
 * `_expandedFrom` — a nested `[data-scrml]`). Takes the FIRST instantiation
 * (all are structurally identical). Finds the root through ANY nesting
 * (component-in-a-loop, component-behind-`<if>`, lift-wrapped) via the shared
 * comprehensive walker.
 */
function collectComponentElements(nodes: Node[], name: string): El[] {
  let root: Node | null = null;
  walkMarkupElements(nodes, false, [], (_el, node) => {
    if (!root && node._expandedFrom === name) root = node;
  });
  if (!root) return [];

  const elements: El[] = [];
  const rootNode = root as Node;
  // The component's OWN body elements carry `_expandedFrom == null`; a nested
  // component's root carries its own `_expandedFrom` — that is the donut edge.
  const isDonutEdge = (node: Node): boolean => node !== rootNode && node._expandedFrom != null;
  // Seed the walk at the root itself, then descend through its subtree with the
  // donut boundary in force.
  const rootEl = makeEl(rootNode, false, []);
  elements.push(rootEl);
  if (Array.isArray(rootNode.children)) {
    walkMarkupElements(rootNode.children, false, [rootEl], (el) => elements.push(el), isDonutEdge);
  }
  for (const key of CONTAINER_KEYS) {
    if (key === "children") continue;
    const arr = rootNode[key];
    if (Array.isArray(arr)) walkMarkupElements(arr, false, [rootEl], (el) => elements.push(el), isDonutEdge);
  }
  return elements;
}

// ---------------------------------------------------------------------------
// CSS rule extraction from collectCssBlocks output
// ---------------------------------------------------------------------------

function dedupe(a: string[]): string[] { return [...new Set(a)]; }

/** Extract the grouped SELECTOR rules from a css-inline block. Flat-declaration
 *  rules (`rule.prop`, no selector — an anonymous style-VALUE, §65.4) and at-rule
 *  blobs are handled separately / skipped from the selector-pair check. */
function rulesFromBlock(block: Node): Rule[] {
  const out: Rule[] = [];
  const rules: Node[] = Array.isArray(block.rules) ? block.rules : [];
  for (const r of rules) {
    if (r.atRule) {
      out.push({ selector: "", props: [], atRule: String(r.atRule), span: r.span ?? block.span ?? {} });
      continue;
    }
    if (r.selector && Array.isArray(r.declarations)) {
      const props = dedupe(r.declarations.map((d: Node) => d.prop).filter(Boolean));
      const span = (r.declarations[0]?.span) ?? r.span ?? block.span ?? {};
      out.push({ selector: String(r.selector), props, atRule: null, span });
    }
  }
  return out;
}

/** A stable dedup key for a component block (identical across instantiations). */
function blockKey(block: Node): string {
  const s = block.span ?? {};
  return `${s.file ?? ""}::${s.start ?? "?"}::${s.end ?? "?"}`;
}

// ---------------------------------------------------------------------------
// Scope assembly
// ---------------------------------------------------------------------------

function buildScopes(nodes: Node[], filePath: string): Scope[] {
  const { inlineBlocks } = collectCssBlocks(nodes) as { inlineBlocks: Node[]; styleBlocks: Node[] };
  const scopes: Scope[] = [];

  // Program scope — every program-level (_componentScope == null) css-inline block.
  const programBlocks = inlineBlocks.filter(b => b._componentScope == null);
  const programRules: Rule[] = [];
  for (const b of programBlocks) programRules.push(...rulesFromBlock(b));
  if (programRules.some(r => r.selector)) {
    scopes.push({
      kind: "program", name: "<program>", file: filePath,
      rules: programRules, elements: collectProgramElements(nodes),
    });
  }

  // Component scopes — group by _componentScope, deduping blocks by source span
  // (CE duplicates each component's blocks once per instantiation).
  const byComponent = new Map<string, Node[]>();
  const seenBlock = new Set<string>();
  for (const b of inlineBlocks) {
    const name = b._componentScope;
    if (name == null) continue;
    const key = `${name}##${blockKey(b)}`;
    if (seenBlock.has(key)) continue;
    seenBlock.add(key);
    if (!byComponent.has(name)) byComponent.set(name, []);
    byComponent.get(name)!.push(b);
  }
  for (const [name, blocks] of byComponent) {
    const rules: Rule[] = [];
    for (const b of blocks) rules.push(...rulesFromBlock(b));
    if (!rules.some(r => r.selector)) continue;
    scopes.push({
      kind: "component", name, file: filePath,
      rules, elements: collectComponentElements(nodes, name),
    });
  }
  return scopes;
}

// ---------------------------------------------------------------------------
// The §65.2 pairwise same-property conflict checker
// ---------------------------------------------------------------------------

function locus(scope: Scope, sel: string, span: CssConflictSpan): string {
  const line = span.line ?? 0;
  const where = scope.kind === "component" ? `component \`${scope.name}\`` : "program scope";
  return line > 0 ? `\`${sel}\` (${where}, line ${line})` : `\`${sel}\` (${where})`;
}

/** Clean a component-relative span.file (`path#Component`) back to the real file. */
function cleanFile(span: CssConflictSpan, fallback: string): string {
  const f = span.file ?? fallback;
  const hash = f.indexOf("#");
  return hash >= 0 ? f.slice(0, hash) : f;
}

function pushHard(
  out: CssConflictDiagnostic[], scope: Scope, prop: string,
  r1: Rule, r2: Rule, shEl: string,
): void {
  const span = r1.span;
  out.push({
    filePath: cleanFile(span, scope.file),
    line: span.line ?? 0,
    column: span.col ?? 0,
    code: "E-STYLE-CONFLICT",
    severity: "error",
    message:
      `E-STYLE-CONFLICT: two rules in component \`${scope.name}\` unconditionally set ` +
      `\`${prop}\` on the same element ${shEl} — ${locus(scope, r1.selector, r1.span)} and ` +
      `${locus(scope, r2.selector, r2.span)} — at the same precedence level with no ` +
      `distinguishing condition. scrml deletes specificity (§65.2), so the compiler will ` +
      `not silently pick a winner. Disambiguate: merge the two rules, give one a ` +
      `distinguishing condition (\`:hover\` / \`[attr]\` / \`@media\`), or narrow one ` +
      `selector so only one matches. (§65.2.1)`,
    span,
  });
}

function pushSoft(
  out: CssConflictDiagnostic[], scope: Scope, prop: string,
  r1: Rule, r2: Rule, reason: string,
): void {
  const span = r1.span;
  out.push({
    filePath: cleanFile(span, scope.file),
    line: span.line ?? 0,
    column: span.col ?? 0,
    code: "W-STYLE-CONFLICT-POSSIBLE",
    severity: "info",
    message:
      `W-STYLE-CONFLICT-POSSIBLE: ${locus(scope, r1.selector, r1.span)} and ` +
      `${locus(scope, r2.selector, r2.span)} may both set \`${prop}\` on the same element ` +
      `(${reason}). This is non-blocking — disambiguate if they can co-apply. (§65.2.4)`,
    span,
  });
}

function checkScope(scope: Scope, out: CssConflictDiagnostic[]): void {
  const rs = scope.rules;
  const isProgram = scope.kind === "program";
  // Parse each selector ONCE (the pairwise loop is O(n²) — pre-parsing avoids
  // re-parsing every rule n times on large program stylesheets).
  for (const r of rs) if (r.parsed === undefined) r.parsed = r.atRule ? null : parseSelector(r.selector);
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      // Per-pair resilience: one malformed rule/pair must NEVER abort the rest
      // of the scope (the all-or-nothing collapse the review flagged). On a
      // genuine internal error, surface a fail-closed soft for that pair.
      try {
        checkPair(scope, rs[i], rs[j], isProgram, out);
      } catch {
        for (const prop of rs[i].props.filter(p => rs[j].props.includes(p))) {
          pushSoft(out, scope, prop, rs[i], rs[j], "the checker hit an internal error analyzing this pair (fail-closed)");
        }
      }
    }
  }
}

/** Analyze one rule pair. All pair-level classification + the element-set
 *  lookups are computed ONCE (not re-scanned per shared property). */
function checkPair(scope: Scope, r1: Rule, r2: Rule, isProgram: boolean, out: CssConflictDiagnostic[]): void {
  if (r1.atRule || r2.atRule) return; // @media/@container/@keyframes = layers (§65.2.2)
  const shared = r1.props.filter(p => r2.props.includes(p));
  if (shared.length === 0) return;

  const p1 = r1.parsed;
  const p2 = r2.parsed;
  // A selector the checker cannot fully parse (an unknown char → null compound —
  // `&`-nesting, `%`, an escape, a namespace) is fail-closed, NOT floor-layered:
  //   - component scope → SOFT (the decidable scope where the guarantee lives);
  //   - program scope   → no fire (R3 — the escape hatch cannot prove a local
  //                       overlap on an unresolvable selector; documented weaker
  //                       guarantee, not a firehose).
  if (!p1 || !p2) {
    if (!isProgram) {
      for (const prop of shared) {
        pushSoft(out, scope, prop, r1, r2, "a selector the checker cannot fully parse (fail-closed)");
      }
    }
    return;
  }

  // Pseudo-elements → a different render box, never a same-element conflict.
  if (hasPseudoElement(p1) || hasPseudoElement(p2)) return;

  // §65.2.4 R1 — a universal `*` / bare-root `html`/`body` rule is a LOWER LAYER.
  // Suppress ONLY when EXACTLY ONE side is floor (cross-layer). Two floor rules
  // at the SAME level (`* {}` × `* {}`, `body {}` × `body {}`) are a genuine
  // within-level overlap (§65.5) → fall through to the normal conflict logic.
  if (isFloorLayerSelector(p1) !== isFloorLayerSelector(p2)) return;

  // §65.2.4 fail-closed: functional (:not/:has/:is/:where) or sibling (+/~)
  // selectors over the (possibly dynamic) markup → SOFT, never hard — but ONLY
  // when the two selectors' SUBJECTS could plausibly match a common element.
  // Without this bound an unrelated `.toggle-all + label` fires against every
  // rule that merely shares a property (the sibling firehose the review flagged).
  if (hasFunctional(p1) || hasFunctional(p2) || hasSiblingCombinator(p1) || hasSiblingCombinator(p2)) {
    if (subjectsCouldShare(scope, p1, p2)) {
      const reason = hasFunctional(p1) || hasFunctional(p2)
        ? "a `:not()`/`:has()`/`:is()`/`:where()` selector the checker cannot decide"
        : "a sibling combinator (`+`/`~`) over a possibly-dynamic sibling set";
      for (const prop of shared) pushSoft(out, scope, prop, r1, r2, reason);
    }
    return;
  }

  // §65.2.4 R2 — class × class base+modifier → SOFT in Wave 1 (Wave-2 hard).
  const classByClass = isClassBearingSubject(p1) && isClassBearingSubject(p2);

  // State distinguisher (state pseudo / attr) → deterministic LAYER (§65.2.2),
  // EXCEPT a same-axis overlap (both carry the SAME state pseudo, §65.2.3).
  if (hasStateDistinguisher(p1) || hasStateDistinguisher(p2)) {
    const st1 = p1.subject.statePseudos.join(",");
    const st2 = p2.subject.statePseudos.join(",");
    if (st1 && st1 === st2 && !p1.subject.attrs.length && !p2.subject.attrs.length) {
      const shEl = provableSharedElement(scope, p1, p2); // hoisted — once per pair
      if (shEl) {
        for (const prop of shared) {
          // Same-axis (§65.2.3): E-STYLE-CONFLICT family, but SOFT for program
          // scope (escape hatch) and for R2 class×class.
          if (isProgram || classByClass) {
            pushSoft(out, scope, prop, r1, r2, `both carry \`:${st1}\` on ${describeEl(shEl)} (same-axis overlap, §65.2.3)`);
          } else {
            pushHard(out, scope, prop, r1, r2, describeEl(shEl));
          }
        }
      }
    }
    return; // one conditional / different axes → layer → no fire
  }

  // Structural pseudo (:first-child, :nth-child) → deterministic subset layer.
  if (hasStructural(p1) || hasStructural(p2)) return;

  // Both plain + unconditional.
  if (provablyDisjoint(p1, p2)) return; // e.g. div vs span, #a vs #b

  // Element-set lookups are (p1,p2)-dependent only — computed ONCE per pair,
  // NOT re-scanned per shared property (hot-path: runs on every compile).
  const staticShared = provableSharedElement(scope, p1, p2);
  if (staticShared) {
    for (const prop of shared) {
      if (isProgram) {
        // §65.2.4 R3 — program scope is SOFT on a provable LOCAL overlap.
        pushSoft(out, scope, prop, r1, r2, `both provably match ${describeEl(staticShared)} in this file`);
      } else if (classByClass) {
        // §65.2.4 R2 — class × class base+modifier is SOFT in Wave 1.
        pushSoft(out, scope, prop, r1, r2, `both class rules provably match ${describeEl(staticShared)} — a base/modifier overlap resolved only by source order (Wave-2 fix: \`style=[a,b]\`, §65.4.4)`);
      } else {
        // The flagship: a proven ambiguity (tag×class, tag×tag, id×*, …) → HARD.
        pushHard(out, scope, prop, r1, r2, describeEl(staticShared));
      }
    }
    return;
  }

  // No static both-match. A conditional (reactive class:NAME= toggle) or dynamic
  // (<each>/conditional) element that matches both → fail-closed SOFT.
  const condShared = conditionalSharedElement(scope, p1, p2);
  if (condShared) {
    const reason = condShared.dynamic
      ? `both match ${describeEl(condShared)} only inside dynamic (<each>/conditional) markup`
      : `both match ${describeEl(condShared)} only when a reactive \`class:\` toggle is active (conditionally present)`;
    for (const prop of shared) pushSoft(out, scope, prop, r1, r2, reason);
    return;
  }
  // No enumerable element in this file matches both:
  //   - component scope → the donut bounds the set → proven not to co-occur → no fire.
  //   - program scope → R3: NOT the firehose (fire only on a provable LOCAL overlap) → no fire.
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the §65.2 conflict checker over one post-CE file AST. Returns the
 * `E-STYLE-CONFLICT` (hard) + `W-STYLE-CONFLICT-POSSIBLE` (soft) diagnostics.
 *
 * INTERNALLY RESILIENT (never throws, never all-or-nothing): scope assembly and
 * each scope's analysis are independently guarded, so a single malformed node
 * cannot suppress the diagnostics for the rest of the file. When a scope's
 * analysis is aborted by an internal error, a fail-closed `W-STYLE-CONFLICT-
 * POSSIBLE` is surfaced for that scope rather than silently dropping it.
 */
export function checkCssConflicts(fileAST: FileASTLike): CssConflictDiagnostic[] {
  const nodes = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const filePath = fileAST?.filePath ?? "";
  const out: CssConflictDiagnostic[] = [];
  let scopes: Scope[] = [];
  try {
    scopes = buildScopes(nodes, filePath);
  } catch {
    return out; // scope assembly failed wholesale — nothing analyzable
  }
  for (const scope of scopes) {
    try {
      checkScope(scope, out);
    } catch {
      // A scope-level failure the per-pair guard did not contain. Surface a
      // non-blocking nudge rather than silently dropping the whole scope.
      const anchor = scope.rules.find(r => r.selector) ?? scope.rules[0];
      const span = anchor?.span ?? {};
      const where = scope.kind === "component" ? `component \`${scope.name}\`` : "program scope";
      out.push({
        filePath: cleanFile(span, scope.file),
        line: span.line ?? 0,
        column: span.col ?? 0,
        code: "W-STYLE-CONFLICT-POSSIBLE",
        severity: "info",
        message:
          `W-STYLE-CONFLICT-POSSIBLE: the style-conflict checker could not fully analyze ${where} — ` +
          `same-property overlaps here are UNVERIFIED (fail-closed). This is non-blocking. (§65.2.4)`,
        span,
      });
    }
  }
  return out;
}
