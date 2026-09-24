/**
 * Value-based secret redaction for compiler output (s430-dev-db-stub F4).
 *
 * The compiler KNOWS every database connection value in a compile unit: each
 * `<program db=>`, `<page db=>` and `<db src=>` value (plus the SPEC-defined
 * `idempotency-store=` on `<program>`). Rather than pattern-matching arbitrary
 * text for "things that look like credentials", this module:
 *
 *   1. COLLECTS exactly those attribute values — never a generic `src=` (an
 *      `<img src>` is not a connection) — from the tree AND from a small
 *      opening-tag scanner over the raw source (`scanConnectionAttrs`), which
 *      also records WHERE each value sits;
 *   2. computes each value's DISPLAY form POSITIONALLY: the URI userinfo span
 *      and every password-parameter value span become `<redacted>`; nothing
 *      else in the value changes (so `postgres://postgres:postgres@h` displays
 *      as `postgres://<redacted>@h`, not `<redacted>://…`);
 *   3. in a MESSAGE, replaces each WHOLE value (and the sub-forms a message
 *      really echoes: trimmed, and the `sqlite:`-stripped path) by its display
 *      form. A secret is never searched for on its own, except one long and
 *      unusual enough that a collision is implausible (LONG_SECRET_RULE);
 *   4. in a SOURCE EXCERPT, replaces each connection attribute's value by its
 *      display form AT ITS SOURCE SPAN (`redactSourceText`) — no substring
 *      search over code, so `${@count}` URLs, `@scope/pkg`, `password=@pw`
 *      props, codes, line numbers and §-refs are never touched.
 *
 * Why whole-value, not secret-substring: a password is often an ordinary word
 * (Docker's default `postgres:postgres`, `admin:admin`, `PA`, `db`). Replacing
 * that word everywhere shreds `E-PA-002`, `scrml db-migrate`, `<db src`, table
 * and cell names. No diagnostic quotes a password on its own — they quote the
 * value (or a path built from it), and that is what is replaced.
 */

import { classifyDbTarget } from "./db-target.ts";

const REDACTED = "<redacted>";

/** Keys whose value is a password in a URI query or a libpq-style keyword string. */
const PASSWORD_KEYS = ["password", "pass", "pwd", "passwd", "sslpassword"];
const PASSWORD_PARAM_RE = new RegExp(
  `(?:^|[?&;\\s])(?:${PASSWORD_KEYS.join("|")})\\s*(?:=|%3[dD])\\s*` +
  `('(?:\\\\.|[^'])*'|"(?:\\\\.|[^"])*"|[^&;\\s]*)`,
  "gid",
);

/**
 * LONG_SECRET_RULE — the only case in which a secret is replaced on its own,
 * outside its whole value: at least 12 characters AND containing a character
 * that is not an ASCII letter. Rationale: every token the compiler prints that
 * could collide with a password — codes (`E-PA-002`, 8), commands
 * (`db-migrate`), element and attribute names, SQL identifiers, dictionary
 * words, line numbers, §-refs — is either shorter than 12 or purely
 * alphabetic/numeric in a way a 12+ mixed-class secret is not; a generated or
 * human-chosen strong password is exactly 12+ and mixed. It is a backstop for a
 * message that echoes the value transformed (e.g. a normalized path), not the
 * primary mechanism.
 */
function isLongUnusualSecret(s: string): boolean {
  return s.length >= 12 && /[^A-Za-z]/.test(s);
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const q = s[0];
    if ((q === "'" || q === '"') && s[s.length - 1] === q) {
      return s.slice(1, -1).replace(new RegExp(`\\\\${q}`, "g"), q);
    }
  }
  return s;
}

/**
 * The spans inside `value` that are secret: the URI userinfo (user AND
 * password — the whole run from after `scheme://` to the LAST `@`, so an
 * unencoded `@`/`/`/`#` in a password is covered) and each password
 * parameter's value (quoted values whole; `#` kept in an unquoted value).
 * Returned sorted and merged.
 */
export function secretSpans(value: string): Array<[number, number]> {
  if (typeof value !== "string" || value.length === 0) return [];
  const spans: Array<[number, number]> = [];
  const m = value.match(/^\s*[a-z][a-z0-9+.\-]*:\/\//i);
  if (m) {
    const start = m[0].length;
    const at = value.lastIndexOf("@");
    if (at > start) spans.push([start, at]);
  }
  for (const pm of value.matchAll(PASSWORD_PARAM_RE)) {
    const idx = (pm as any).indices?.[1] as [number, number] | undefined;
    if (idx && idx[1] > idx[0]) spans.push([idx[0], idx[1]]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/** Apply spans (relative to `base`) to text[from, to). */
function applySpans(text: string, spans: Array<[number, number]>, from: number, to: number): string {
  let out = "";
  let i = from;
  for (const [s0, s1] of spans) {
    const a = Math.max(s0, from);
    const b = Math.min(s1, to);
    if (b <= a) continue;
    out += text.slice(i, a) + REDACTED;
    i = b;
  }
  return out + text.slice(i, to);
}

/**
 * The display form of one connection value: its secret spans replaced by
 * `<redacted>`, everything else verbatim. A value with no secret is returned
 * unchanged.
 */
export function displayConnectionValue(value: string): string {
  const spans = secretSpans(value);
  if (spans.length === 0) return value;
  return applySpans(value, spans, 0, value.length);
}

/**
 * The substrings of `value` a diagnostic may echo, each paired with its
 * display form: the value itself, its trimmed form, and (for a `sqlite:`
 * value) the path after the prefix — the form a resolved-path message
 * contains. Only forms that actually carry a secret are returned.
 */
function echoForms(value: string): Array<[string, string]> {
  const spans = secretSpans(value);
  if (spans.length === 0) return [];
  const lead = value.length - value.trimStart().length;
  const end = value.trimEnd().length;
  const cuts: Array<[number, number]> = [[0, value.length], [lead, end]];
  const cls = classifyDbTarget(value);
  if (cls.kind === "sqlite-file" && cls.sqlitePath !== null && cls.sqlitePath !== cls.trimmed) {
    cuts.push([end - cls.sqlitePath.length, end]);
  }
  // Self-anchored credential fragments: the `user:password` userinfo (the `:`
  // joins the pair, so it cannot collide with an identifier or a word) and each
  // `key=value` password parameter. A mis-tokenized value (unquoted
  // `db=scheme://…` is split into attribute NAMES) reaches messages as such a
  // fragment, e.g. W-ATTR-001 "Attribute `admin:s3cret@db=` is not recognized".
  const m = value.match(/^\s*[a-z][a-z0-9+.\-]*:\/\//i);
  if (m) {
    const at = value.lastIndexOf("@");
    if (at > m[0].length && value.slice(m[0].length, at).includes(":")) cuts.push([m[0].length, at]);
  }
  for (const pm of value.matchAll(PASSWORD_PARAM_RE)) {
    const whole = (pm as any).indices?.[0] as [number, number] | undefined;
    if (!whole) continue;
    const from = /[?&;\s]/.test(value[whole[0]] ?? "") ? whole[0] + 1 : whole[0];
    if (whole[1] > from) cuts.push([from, whole[1]]);
  }
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [from, to] of cuts) {
    if (to <= from) continue;
    const raw = value.slice(from, to);
    const shown = applySpans(value, spans, from, to);
    if (raw !== shown && !seen.has(raw)) {
      seen.add(raw);
      out.push([raw, shown]);
    }
  }
  return out;
}

/**
 * Every form of every secret a value carries (raw, unquoted, percent-decoded;
 * WHATWG and last-`@` userinfo readings). Used ONLY for LONG_SECRET_RULE.
 */
export function deriveSecrets(value: string): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (typeof s !== "string" || s.length === 0) return;
    out.add(s);
    const d = safeDecode(s);
    if (d.length > 0) out.add(d);
  };
  for (const form of new Set([value, value.trim(), safeDecode(value.trim())])) {
    const scheme = form.match(/^\s*[a-z][a-z0-9+.\-]*:\/\//i);
    if (scheme) {
      const rest = form.slice(scheme[0].length);
      const lastAt = rest.lastIndexOf("@");
      if (lastAt >= 0) {
        const userinfo = rest.slice(0, lastAt);
        const colon = userinfo.indexOf(":");
        if (colon >= 0) add(userinfo.slice(colon + 1));
      }
      const authEnd = rest.search(/[\/?#]/);
      const authority = authEnd >= 0 ? rest.slice(0, authEnd) : rest;
      const at = authority.lastIndexOf("@");
      if (at >= 0) {
        const ui = authority.slice(0, at);
        const colon = ui.indexOf(":");
        if (colon >= 0) add(ui.slice(colon + 1));
      }
      try {
        const u = new URL(form.trim());
        if (u.password) add(u.password);
        for (const k of PASSWORD_KEYS) for (const v of u.searchParams.getAll(k)) add(v);
      } catch { /* not WHATWG-parseable */ }
    }
    for (const pm of form.matchAll(PASSWORD_PARAM_RE)) {
      const raw = pm[1];
      add(raw);
      add(unquote(raw));
      const hash = raw.indexOf("#");
      if (hash > 0) add(raw.slice(0, hash));
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Where connection values live
// ---------------------------------------------------------------------------

/** Element → the attribute names on it that carry a connection target. */
const CONNECTION_ATTRS: Record<string, string[]> = {
  program: ["db", "idempotency-store"],
  page: ["db"],
  db: ["src"],
};

export interface ConnectionAttr {
  element: string;
  name: string;
  value: string;
  /** Offset of the first character of the value (inside any quotes). */
  start: number;
  /** Offset just past the last character of the value. */
  end: number;
}

/**
 * Scan source text for the opening tags of `<program>`, `<page>` and `<db>`
 * and return their connection attributes with exact value offsets. A small
 * attribute tokenizer, not a redaction pattern: quoted values honour `\`
 * escapes; unquoted values run to whitespace or `>`. Tags may span lines.
 */
export function scanConnectionAttrs(source: string): ConnectionAttr[] {
  const out: ConnectionAttr[] = [];
  if (typeof source !== "string" || source.length === 0) return out;
  const tagRe = /<\s*(program|page|db)(?=[\s>\/])/g;
  for (const tm of source.matchAll(tagRe)) {
    const element = tm[1];
    const wanted = CONNECTION_ATTRS[element];
    let i = (tm.index ?? 0) + tm[0].length;
    const n = source.length;
    for (;;) {
      while (i < n && /\s/.test(source[i])) i++;
      if (i >= n || source[i] === ">" || (source[i] === "/" && source[i + 1] === ">")) break;
      const nameStart = i;
      while (i < n && !/[\s=>]/.test(source[i]) && !(source[i] === "/" && source[i + 1] === ">")) i++;
      const name = source.slice(nameStart, i);
      if (name.length === 0) { i++; continue; }
      let j = i;
      while (j < n && /\s/.test(source[j])) j++;
      if (source[j] !== "=") { continue; }
      j++;
      while (j < n && /\s/.test(source[j])) j++;
      let vStart: number;
      let vEnd: number;
      const q = source[j];
      if (q === '"' || q === "'" || q === "`") {
        vStart = j + 1;
        let k = vStart;
        while (k < n && source[k] !== q) k += source[k] === "\\" ? 2 : 1;
        vEnd = Math.min(k, n);
        i = k + 1;
      } else {
        vStart = j;
        let k = j;
        while (k < n && !/[\s>]/.test(source[k])) k++;
        vEnd = k;
        i = k;
      }
      if (wanted.includes(name.toLowerCase()) && vEnd > vStart) {
        out.push({ element, name, value: source.slice(vStart, vEnd), start: vStart, end: vEnd });
      }
    }
  }
  return out;
}

/** Values only (for SecretRedactor.addValues). */
export function harvestFromSource(source: string): string[] {
  return scanConnectionAttrs(source).map((a) => a.value);
}

/**
 * Redact a SOURCE text for display (the excerpt under a diagnostic): each
 * connection attribute's value is replaced by its display form AT ITS SPAN.
 * Everything else is returned byte-identical.
 */
export function redactSourceText(source: string): string {
  const attrs = scanConnectionAttrs(source);
  if (attrs.length === 0) return source;
  let out = "";
  let i = 0;
  for (const a of attrs.sort((x, y) => x.start - y.start)) {
    if (a.start < i) continue;
    const shown = displayConnectionValue(a.value);
    out += source.slice(i, a.start) + shown;
    i = a.end;
  }
  return out + source.slice(i);
}

/**
 * Collect connection values from a parsed file's AST: the string value of
 * `db=` on `<program>` / `<page>`, `idempotency-store=` on `<program>`, and
 * `src=` on a `<db>` state block. Nothing else.
 */
export function collectFromAst(root: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as any;
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    const element: string | null =
      n.kind === "state" && n.stateType === "db" ? "db"
      : n.kind === "markup" && typeof n.tag === "string" ? n.tag.toLowerCase()
      : null;
    const wanted = element !== null ? CONNECTION_ATTRS[element] : undefined;
    if (wanted && Array.isArray(n.attrs)) {
      for (const a of n.attrs) {
        if (!a || typeof a.name !== "string" || !wanted.includes(a.name.toLowerCase())) continue;
        const v = a.value;
        if (v && typeof v === "object" && typeof v.value === "string") found.push(v.value);
        else if (typeof v === "string") found.push(v);
      }
    }
    for (const k of Object.keys(n)) {
      const c = n[k];
      if (c && typeof c === "object") stack.push(c);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The redactor
// ---------------------------------------------------------------------------

/**
 * A redactor over one compile unit's connection values. `redact(text)` is the
 * operation every MESSAGE sink applies; `redactSource(text)` is the operation
 * for SOURCE excerpts.
 */
export class SecretRedactor {
  private values = new Set<string>();
  private forms: Array<[string, string]> = [];   // longest raw first
  private longSecrets: string[] = [];             // longest first

  constructor(values?: Iterable<string>) {
    if (values) this.addValues(values);
  }

  /** Register connection values (raw attribute values). Idempotent. */
  addValues(values: Iterable<string>): void {
    let changed = false;
    for (const v of values) {
      if (typeof v !== "string" || v.length === 0 || this.values.has(v)) continue;
      this.values.add(v);
      changed = true;
    }
    if (changed) this.rebuild();
  }

  /** Register every connection value in a source text. */
  addSource(source: string): void {
    this.addValues(harvestFromSource(source));
  }

  get hasSecrets(): boolean {
    return this.forms.length > 0;
  }

  private rebuild(): void {
    const forms = new Map<string, string>();
    const longs = new Set<string>();
    for (const v of this.values) {
      for (const [raw, shown] of echoForms(v)) forms.set(raw, shown);
      if (secretSpans(v).length > 0) {
        for (const s of deriveSecrets(v)) if (isLongUnusualSecret(s)) longs.add(s);
      }
    }
    this.forms = [...forms.entries()].sort((a, b) => b[0].length - a[0].length);
    this.longSecrets = [...longs].sort((a, b) => b.length - a.length);
  }

  /** Redact a MESSAGE. Text containing no registered value is returned unchanged. */
  redact(text: string): string {
    if (typeof text !== "string" || text.length === 0 || this.forms.length === 0) return text;
    let out = text;
    for (const [raw, shown] of this.forms) {
      if (out.includes(raw)) out = out.split(raw).join(shown);
    }
    for (const s of this.longSecrets) {
      if (out.includes(s)) out = out.split(s).join(REDACTED);
    }
    return out;
  }

  /**
   * Redact a SOURCE excerpt. First by attribute SPAN (redactSourceText) — which
   * needs no registry, so it is right even when the file on disk changed after
   * the compile that registered its values (watch mode prints what it reads
   * NOW). Then any other exact copy of a registered WHOLE value (a value pasted
   * into a comment) — never a bare secret word, so code is not shredded.
   */
  redactSource(text: string): string {
    return this.redact(redactSourceText(text));
  }

  /** Redact every string field of a diagnostic object, in place (top level). */
  redactDiagnostic(d: any): void {
    if (!d || typeof d !== "object" || this.forms.length === 0) return;
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (typeof v === "string") d[k] = this.redact(v);
    }
  }

  /**
   * A thrown value, redacted, as a NEW object (the original may be frozen).
   * Strings are redacted; an Error-like object becomes a new Error of the same
   * name carrying the redacted message, stack, cause (recursively) and every
   * own string property (`filePath`, `path`, `code`, ...).
   */
  redactThrown(err: unknown, depth = 0): unknown {
    // Nothing registered, or nothing to change: the ORIGINAL value, untouched
    // (identity, class and every property preserved).
    if (this.forms.length === 0) return err;
    if (typeof err === "string") return this.redact(err);
    if (!err || typeof err !== "object" || depth > 4) return err;
    const src = err as any;
    const names = Object.getOwnPropertyNames(src);
    if (!names.includes("stack") && typeof src.stack === "string") names.push("stack");
    if (!names.includes("message") && typeof src.message === "string") names.push("message");
    const changed = new Map<string, unknown>();
    for (const k of names) {
      let v: unknown;
      try { v = src[k]; } catch { continue; }
      const nv = k === "cause" ? this.redactThrown(v, depth + 1)
        : typeof v === "string" ? this.redact(v) : v;
      if (nv !== v) changed.set(k, nv);
    }
    if (changed.size === 0) return err;
    // A NEW object with the SAME prototype (so `instanceof TypeError` /
    // `StageSeamError` still holds) — the original may be frozen.
    const out = Object.create(Object.getPrototypeOf(src));
    for (const k of names) {
      const desc = Object.getOwnPropertyDescriptor(src, k);
      const value = changed.has(k) ? changed.get(k) : (desc && "value" in desc ? desc.value : src[k]);
      Object.defineProperty(out, k, {
        value,
        writable: true,
        configurable: true,
        enumerable: desc ? !!desc.enumerable : false,
      });
    }
    return out;
  }
}
