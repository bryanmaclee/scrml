/**
 * Value-based secret redaction for compiler output (s430-dev-db-stub F4, round 3).
 *
 * The compiler KNOWS every database connection string in a compile unit — each
 * `<program db=>`, `<page db=>`, `<db src=>` and `*-store=` value. Instead of
 * pattern-matching arbitrary diagnostic text for "things that look like
 * credentials" (an enumerate-forever game that also mangles legitimate code:
 * `${@count}` URLs, `@scope/pkg`, `password=@password` props), we:
 *
 *   1. COLLECT those raw values once per compile (from the AST, plus a narrow
 *      attribute-value harvest of the raw source — see `harvestFromSource` for
 *      why the tree alone is not enough);
 *   2. DERIVE each value's secret parts — the URI userinfo password and every
 *      password-bearing query / keyword parameter value — in raw, unquoted and
 *      percent-decoded forms;
 *   3. REPLACE exactly those substrings in every diagnostic, note and source
 *      excerpt, at the compileScrml chokepoint (api.js) and the few non-compile
 *      sinks that echo a value (generate, introspect, LSP).
 *
 * Exact-substring replacement cannot be bypassed by scheme case, whitespace,
 * unusual schemes, `#`/`&` inside a value, quoting or spaces in userinfo, and it
 * leaves text that contains no collected secret byte-identical.
 */

const REDACTED = "<redacted>";

/** Keys whose value is a password in a URI query or a libpq-style keyword string. */
const PASSWORD_KEYS = ["password", "pass", "pwd", "passwd", "sslpassword"];

/** Attribute names whose value is (or may be) a database / store connection target. */
export function isConnectionAttrName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "db" || n === "src" || n === "store" || n.endsWith("-store");
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
 * Derive the secret substrings carried by one connection value. Returns every
 * form a diagnostic might echo: raw, unquoted, percent-decoded. Never throws.
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
    // URI userinfo password: `scheme://user:PASSWORD@host`. Two readings, both
    // kept: the WHATWG parser's (authority ends at the first `/`, `?`, `#`), and
    // the "intended" one (userinfo runs to the LAST `@`), so an unencoded `@`,
    // `/` or `#` inside a password is still covered.
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
        for (const k of PASSWORD_KEYS) {
          for (const v of u.searchParams.getAll(k)) add(v);
        }
      } catch { /* not a WHATWG-parseable URL — the manual readings above stand */ }
    }

    // Query / keyword parameters: `?password=x`, `&pwd=x`, `;pass=x`, and the
    // libpq keyword form `host=h password='s3 cret' dbname=x`. A value is a
    // quoted string (with `\'` escapes) or a run up to `&`, `;` or whitespace
    // (a `#` stays IN the value — it may be part of the password).
    const keyAlt = PASSWORD_KEYS.join("|");
    const re = new RegExp(
      `(?:^|[?&;\\s])(?:${keyAlt})\\s*=\\s*('(?:\\\\.|[^'])*'|"(?:\\\\.|[^"])*"|[^&;\\s]*)`,
      "gi",
    );
    for (const m of form.matchAll(re)) {
      const raw = m[1];
      add(raw);
      add(unquote(raw));
      const hash = raw.indexOf("#");
      if (hash > 0) add(raw.slice(0, hash)); // what a URL parser would keep
    }
  }
  return [...out];
}

/** Characters that may border a short secret without it being part of a word. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * A redactor over one compile unit's connection values. `redact(text)` is the
 * single operation every output sink applies.
 */
export class SecretRedactor {
  private values = new Set<string>();
  private secrets: string[] = [];      // longest first
  private displays: Array<[string, string]> = [];

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

  get hasSecrets(): boolean {
    return this.secrets.length > 0;
  }

  private rebuild(): void {
    const all = new Set<string>();
    for (const v of this.values) for (const s of deriveSecrets(v)) all.add(s);
    this.secrets = [...all].sort((a, b) => b.length - a.length);
    // Tier 1: a whole echoed value is replaced by its display form (every
    // secret inside it replaced, no length guard) — this covers even a
    // one-character password when the message echoes the full value.
    this.displays = [];
    for (const v of this.values) {
      for (const form of new Set([v, v.trim()])) {
        const shown = this.replaceSecrets(form, false);
        if (shown !== form) this.displays.push([form, shown]);
      }
    }
    this.displays.sort((a, b) => b[0].length - a[0].length);
  }

  private replaceSecrets(text: string, guardShort: boolean): string {
    let out = text;
    for (const s of this.secrets) {
      if (!out.includes(s)) continue;
      if (!guardShort || s.length >= 6) {
        out = out.split(s).join(REDACTED);
        continue;
      }
      // A short secret is only replaced where it is not part of a longer word,
      // so a 3-character password cannot shred unrelated prose.
      let res = "";
      let i = 0;
      for (;;) {
        const j = out.indexOf(s, i);
        if (j < 0) { res += out.slice(i); break; }
        const before = out[j - 1];
        const after = out[j + s.length];
        if (isWordChar(before) || isWordChar(after)) {
          res += out.slice(i, j + s.length);
        } else {
          res += out.slice(i, j) + REDACTED;
        }
        i = j + s.length;
      }
      out = res;
    }
    return out;
  }

  /** Redact every known secret in `text`. Text with no secret is returned unchanged. */
  redact(text: string): string {
    if (typeof text !== "string" || text.length === 0 || this.secrets.length === 0) return text;
    let out = text;
    for (const [raw, shown] of this.displays) {
      if (out.includes(raw)) out = out.split(raw).join(shown);
    }
    return this.replaceSecrets(out, true);
  }

  /** Redact every string field of a diagnostic object, in place (one level + span-free). */
  redactDiagnostic(d: any): void {
    if (!d || typeof d !== "object" || this.secrets.length === 0) return;
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (typeof v === "string") d[k] = this.redact(v);
    }
  }
}

/**
 * Collect connection values from a parsed file's AST: every string-literal
 * attribute whose name is a connection attribute (`db`, `src`, `store`,
 * `*-store`), anywhere in the tree.
 */
export function collectFromAst(root: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n as object)) continue;
    seen.add(n as object);
    const attrs = (n as any).attrs;
    if (Array.isArray(attrs)) {
      for (const a of attrs) {
        if (a && typeof a.name === "string" && isConnectionAttrName(a.name)) {
          const v = a.value;
          if (v && typeof v === "object" && typeof v.value === "string") found.push(v.value);
          else if (typeof v === "string") found.push(v);
        }
      }
    }
    for (const k of Object.keys(n as object)) {
      const c = (n as any)[k];
      if (c && typeof c === "object") stack.push(c);
    }
  }
  return found;
}

/**
 * Harvest connection-attribute values straight from source text. This is a
 * VALUE harvest (it finds `db="…"` / `src='…'` / `*-store=` attribute values),
 * not a redaction pattern: whatever it returns is redacted by exact substring
 * like everything else. It exists because the tree does not always know — a
 * file that fails to parse has no AST, and a single-quoted `src='…'` on a
 * `<db>` state opener is currently mis-tokenized into attribute NAMES (the
 * value never reaches the tree as a string); an UNQUOTED `db=scheme://…` is
 * likewise shredded into attribute names. Unquoted values run to whitespace or
 * `>`. The tree remains the source of truth where it has the value — e.g. a
 * value containing an escaped quote, which this harvest truncates.
 */
export function harvestFromSource(source: string): string[] {
  if (typeof source !== "string" || source.length === 0) return [];
  const found: string[] = [];
  const re = /(?:^|[\s<])((?:db|src|store|[A-Za-z][\w-]*-store))\s*=\s*("([^"]*)"|'([^']*)'|`([^`]*)`|([^\s"'`>]+))/g;
  for (const m of source.matchAll(re)) {
    const v = m[3] ?? m[4] ?? m[5] ?? m[6];
    if (typeof v === "string" && v.length > 0) found.push(v);
  }
  return found;
}
