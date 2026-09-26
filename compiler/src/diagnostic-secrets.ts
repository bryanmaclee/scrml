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
 *   2. computes each value's DISPLAY form POSITIONALLY: the userinfo span and
 *      every parameter-value span become `<redacted>` — found WITHOUT parsing
 *      the value or naming a scheme or key (s432; see secretSpans); nothing
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

/**
 * s432 — SHAPE-INDEPENDENT secret spans.
 *
 * The round-5 spans recognised a DENYLIST of well-formed shapes: userinfo only
 * after a leading, well-formed `scheme://`, and only the values of five named
 * password keys. Every malformed value a diagnostic exists to report fell
 * outside it (`postgres:/u:p@h`, `jdbc:postgresql://u:p@h`, a zero-width char
 * before the scheme, `?authToken=`, `?token=`, `?%70assword=`), and those are
 * exactly the values that reach E-PA-002 / E-SQL-005. So the spans are now
 * computed without parsing the value and without naming any scheme or key:
 *
 *   - USERINFO: the run up to the LAST `@` in the value, starting after the
 *     first `//` (or, with no `//`, after any leading `scheme:` tokens and
 *     slashes), is secret when it holds a `:` (a user:password pair — a
 *     drive-letter colon does not count) or, after a `//`, holds no path
 *     separator (a user-only userinfo, which is routinely a bearer token:
 *     `redis://TOKEN@h`, `https://ghp_…@host`). A plain file path containing
 *     `@` (`./data/me@home.db`, `C:\x\a@b.db`, `sqlite:///abs/a@b.db`) is NOT
 *     userinfo and stays copy-pasteable.
 *   - PARAMETERS: the VALUE of EVERY `key=value` pair that starts the value or
 *     follows `?` `&` `;` `,` or whitespace — URI query, `;k=v` JDBC/ADO forms
 *     and libpq keyword DSNs alike; quoted (`'…'`, `"…"`, `{…}`, unterminated
 *     runs to the end) or bare. A diagnostic never needs a parameter's value;
 *     the NAME stays visible.
 *   - Both are computed on TWO views of the value and UNIONED (over-redaction
 *     is the safe direction): the value with invisible characters (zero-width,
 *     bidi controls, BOM, soft hyphen, variation selectors) removed, and that
 *     view with ASCII `%XX` escapes decoded (`%3F` `%3D` `%40` used as
 *     structure). Every span maps back to the ORIGINAL offsets.
 *
 *   - LOCAL FILE values (`./x.db`, `/abs/x.db`, `C:\x.db`, `sqlite:./x.db`,
 *     `file:…`, `:memory:` — never a `scheme://` URI or another `scheme:`
 *     value, never a value whose first segment is a HOST) keep SQLite's
 *     documented URI parameters visible (SQLITE_URI_PARAMS: `mode=ro`,
 *     `cache=shared`, ...) so the path stays copy-pasteable; EVERY other
 *     parameter value is hidden (an ALLOWLIST: an unknown key over-redacts,
 *     it can never leak — `passphrase=`, `jwt=`, `key=` are all hidden).
 *
 * Scheme, host, port, path and parameter names are left visible.
 *
 * DELIBERATELY LEFT VISIBLE (a value that hides a secret in these places is
 * not recognised; none is a credential slot of a SQL driver URI):
 *   - a secret PATH segment (`https://h/api/KEY/x`);
 *   - a URL FRAGMENT (`…#tok`);
 *   - a KEYLESS query token (`…?SECRET`, no `=`);
 *   - fullwidth / homoglyph separators (`＠`, `：`) — not NFKC-normalised;
 *     a driver does not read them as structure either.
 *
 * OVER-REDACTED BY DESIGN (fail safe where a reading is ambiguous):
 *   - `sqlite://C:/data/a@b.db` / `file://C:/x/a@b.db` — a drive path after
 *     `//` that contains `@` reads the same as `sqlite://u:/pw@h`, so it shows
 *     `sqlite://<redacted>@b.db` (without an `@` it is shown unchanged);
 *   - a query value containing `@` pulls the userinfo span to it, hiding the
 *     host (`postgres://u:p@h/db?email=a@b` → `postgres://<redacted>@b`);
 *   - a scheme-less value whose first segment looks like a host
 *     (`my.dir/app.db`) is treated as a network value: all params hidden.
 */
const INVISIBLE_CHAR_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/;

/**
 * Parameter pairs: a key (any run of name characters, percent-escapes
 * allowed) after a separator or the start, `=`, then a value. Group 1 is the
 * key, group 2 the value.
 */
const PARAM_RE =
  /(?:^|[?&;,\s])\s*([A-Za-z0-9_.~%+\-]+)\s*=\s*((?:'(?:\\.|[^'\\])*(?:'|$)|"(?:\\.|[^"\\])*(?:"|$)|\{[^}]*(?:\}|$))?[^&;\s]*)/gd;

interface View {
  text: string;
  /** map[i] = [origStart, origEnd) of normalized char i. */
  map: Array<[number, number]>;
}

function buildView(value: string, decodePercent: boolean): View {
  let text = "";
  const map: Array<[number, number]> = [];
  let i = 0;
  while (i < value.length) {
    const cp = value.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const w = ch.length;
    if (INVISIBLE_CHAR_RE.test(ch)) { i += w; continue; }
    if (decodePercent && ch === "%" && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      const byte = parseInt(value.slice(i + 1, i + 3), 16);
      if (byte < 0x80) {
        text += String.fromCharCode(byte);
        map.push([i, i + 3]);
        i += 3;
        continue;
      }
    }
    text += ch;
    for (let k = 0; k < w; k++) map.push([i, i + w]);
    i += w;
  }
  return { text, map };
}

/** Map a [from, to) span of a view back to original offsets. */
function toOriginal(view: View, from: number, to: number): [number, number] | null {
  if (to <= from) return null;
  return [view.map[from][0], view.map[to - 1][1]];
}

/**
 * A `:` that joins a `user:password` pair. `authority` = the segment follows a
 * `//`: there EVERY colon counts (a drive letter never follows `//` —
 * `postgres://u:/etc/pw@h` is user `u`, password `/etc/pw`). Otherwise the
 * segment is at the START of a path-shaped value, and only a drive letter AT
 * that start (`C:\…`, `C:/…`) is exempt.
 */
function hasCredentialColon(segment: string, authority: boolean): boolean {
  if (authority) {
    // `///C:/x/a@b.db` — an EMPTY authority: the segment is a path.
    if (/^[\/\\]/.test(segment)) return segment.replace(/^[\/\\]+(?:[A-Za-z]:(?=[\/\\]|$))?/, "").includes(":");
    return segment.includes(":");
  }
  return segment.replace(/^[A-Za-z]:(?=[\/\\]|$)/, "").includes(":");
}

/** The userinfo span of a view (view offsets), or null. */
function userinfoSpanInView(t: string): [number, number] | null {
  const at = t.lastIndexOf("@");
  if (at <= 0) return null;
  const head = t.slice(0, at);
  let start: number;
  let authority = false;
  const dbl = head.search(/[\/\\]{2}/);
  // s432 r4 — no drive-letter reading after `//`, not even for sqlite:/file:.
  // This function only runs when the value has an `@`, and then
  // `sqlite://u:/pw@h` (user `u`, password `/pw`) and `sqlite://C:/a@b.db` are
  // indistinguishable: FAIL SAFE and redact (the rare Windows path with `@`
  // is over-redacted, by design). Without an `@` there is no userinfo, and
  // `sqlite://C:/data/app.db` displays unchanged.
  if (dbl >= 0) {
    start = dbl + 2;
    authority = true;
  } else {
    let s = 0;
    while (s < head.length && /\s/.test(head[s])) s++;
    for (;;) {
      const m = head.slice(s).match(/^[A-Za-z][A-Za-z0-9+.\-]*:/);
      if (!m) break;
      // A drive letter (`C:\` / `C:/`) is a path, not a scheme or a user.
      if (m[0].length === 2 && /[\/\\]/.test(head[s + 2] ?? "")) break;
      const rest = head.slice(s + m[0].length);
      // Strip a scheme token only when what follows it is still a
      // `user:password` pair or plainly a path (incl. a drive letter) —
      // never the user itself.
      if (hasCredentialColon(rest, false) || /^(?:[\/\\.~]|[A-Za-z]:[\/\\])/.test(rest)) s += m[0].length;
      else break;
    }
    // A drive letter right here starts a path: keep it in the segment so the
    // start-only exemption sees it.
    if (!/^[A-Za-z]:[\/\\]/.test(head.slice(s))) {
      while (s < head.length && /[\/\\]/.test(head[s])) s++;
    }
    start = s;
  }
  const segment = head.slice(start);
  if (segment.length === 0) return null;
  const isUserinfo = hasCredentialColon(segment, authority) || (authority && !/[\/\\]/.test(segment));
  return isUserinfo ? [start, at] : null;
}

/**
 * s432 r2 — a LOCAL FILE value: a path (`./x`, `../x`, `/x`, `~/x`, `C:\x`, a
 * bare `name.db`), `:memory:`, or `sqlite:` / `file:` followed by one of
 * those. NOT a `scheme://authority` URI and NOT any other `scheme:` value
 * (a one-slash typo `postgres:/u:p@h` is not a file). Decided on the
 * invisible-stripped view, so a zero-width prefix cannot turn a URI into a
 * "file".
 */
function isLocalFileValue(t: string): boolean {
  let v = t.trim();
  const pre = v.match(/^(?:sqlite|file):/i);
  if (pre) {
    v = v.slice(pre[0].length);
    // `sqlite:///abs` / `file:///C:/x` — an EMPTY authority is still a path.
    if (v.startsWith("///")) v = v.slice(2);
    // `sqlite://C:/data/a.db` — malformed but common: a drive path, not an
    // authority (only for sqlite:/file:, never another scheme).
    else if (/^\/\/[A-Za-z]:[\/\\]/.test(v)) v = v.slice(2);
    else if (v.startsWith("//")) return false;
  }
  if (v === ":memory:") return true;
  if (/^(?:\.{1,2}[\/\\]|[\/\\]|~[\/\\]|[A-Za-z]:[\/\\])/.test(v)) return !v.startsWith("//") && !v.startsWith("\\\\");
  // A bare filename: nothing before the first `?` that makes it a scheme
  // (`:`) or a keyword DSN (`=` — `host=h password=x` is NOT a file) ...
  const head = v.split("?")[0];
  if (head.length === 0 || head.includes(":") || head.includes("=")) return false;
  // ... and no first segment that looks like a HOST (`db.internal/app`,
  // `localhost/app`): a scheme-less network URI, not a file.
  const first = head.split(/[\/\\]/)[0];
  if (/^localhost$/i.test(first)) return false;
  if (first.includes(".") && head.length > first.length) return false;
  return true;
}

/**
 * On a LOCAL FILE value, the parameters whose values stay VISIBLE: SQLite's
 * documented URI query parameters (https://www.sqlite.org/uri.html, "URI
 * Parameters": vfs, mode, cache, psow, nolock, immutable). They are open
 * flags, not secrets, and a copy-pasteable path must keep them. EVERY other
 * parameter value is redacted — an allowlist, so an unrecognised key
 * (`passphrase=`, `jwt=`, SQLCipher's `key=`) can only over-redact.
 */
const SQLITE_URI_PARAMS = new Set(["vfs", "mode", "cache", "psow", "nolock", "immutable"]);

/** Heuristic "looks like a credential" for a value with no secret-named key. */
function isTokenLike(v: string): boolean {
  return v.length >= 16 && /^[A-Za-z0-9+\/=_\-.~]+$/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v);
}

/** A secret-named key (decoded): the password / secret / token / key family. */
const SECRET_KEY_NAME_RE = /(?:pass|pwd|secret|token|key|auth|cred|sig)/i;

interface ParamSpan {
  /** key start .. value end (original offsets). */
  whole: [number, number];
  /** the value (original offsets). */
  value: [number, number];
  /** the key, as read in its view (decoded in the decoded view). */
  key: string;
}

interface ValueAnalysis {
  userinfo: Array<[number, number]>;
  params: ParamSpan[];
}

/**
 * s432 r5 — the secret parameters of a LOCAL FILE value, parsed on their own
 * (not with PARAM_RE, whose whitespace/comma-led pairs belong to keyword
 * DSNs): only the FIRST `?` opens the query — before it is the PATH
 * (`./my db=1.db?key=S` has one parameter, `key`) — and each pair ends at the
 * next `&`, `;` or `?` (`./app.db?mode=ro?key=S` → `mode=ro`, `key=S`).
 * Every value is secret except on an allowlisted SQLite URI parameter
 * (SQLITE_URI_PARAMS), and even there a value holding `=`, `?`, `&`, `;` or
 * whitespace is redacted: no SQLite parameter legitimately contains them, so
 * such a value can only be a mis-split secret (fail safe). A keyless segment
 * (`?SECRET`) is left visible (see the header). An unencoded `&` inside a
 * value (`key=Se&cretX`) leaves the tail after it visible; a driver splits the
 * value there too.
 */
function localFileParams(view: View): ParamSpan[] {
  const out: ParamSpan[] = [];
  const t = view.text;
  const n = t.length;
  const q = t.indexOf("?");
  if (q < 0) return out;
  const isSep = (c: string) => c === "&" || c === ";" || c === "?";
  let i = q + 1;
  while (i < n) {
    let j = i;
    while (j < n && !isSep(t[j]) && t[j] !== "=") j++;
    if (j >= n || t[j] !== "=") { i = j + 1; continue; } // keyless segment
    const key = safeDecode(t.slice(i, j));
    const vStart = j + 1;
    let k = vStart;
    // Mirror PARAM_RE: a quoted / braced value reads to its matching close
    // (or to the end when unterminated) — a separator inside it is data.
    const open = t[k];
    if (open === "'" || open === '"') {
      k++;
      while (k < n && t[k] !== open) k += t[k] === "\\" ? 2 : 1;
      k = Math.min(n, k + 1);
    } else if (open === "{") {
      const close = t.indexOf("}", k);
      k = close < 0 ? n : close + 1;
    }
    while (k < n && !isSep(t[k])) k++;
    const val = t.slice(vStart, k);
    if (val.length > 0 && !isHarmlessSqliteParam(key, val)) {
      const ov = toOriginal(view, vStart, k);
      const ow = toOriginal(view, i, k);
      if (ov && ow) out.push({ whole: ow, value: ov, key });
    }
    i = k + 1;
  }
  return out;
}

/** An allowlisted SQLite URI parameter with a value no SQLite parameter could not hold. */
function isHarmlessSqliteParam(key: string, val: string): boolean {
  return SQLITE_URI_PARAMS.has(key.trim().toLowerCase()) && !/[=?&;\s'"{}]/.test(safeDecode(val));
}

/** Userinfo and parameter spans of a connection value (original offsets), both views. */
function analyzeConnectionValue(value: string): ValueAnalysis {
  const out: ValueAnalysis = { userinfo: [], params: [] };
  if (typeof value !== "string" || value.length === 0) return out;
  const views = [buildView(value, false)];
  if (value.includes("%")) views.push(buildView(value, true));
  const local = isLocalFileValue(views[0].text);
  for (const view of views) {
    const ui = userinfoSpanInView(view.text);
    if (ui) {
      const o = toOriginal(view, ui[0], ui[1]);
      if (o) out.userinfo.push(o);
    }
    if (local) {
      // s432 r6 — FAIL SAFE: the UNION of two independent readers of the
      // query — the local-file reader above and the general quote-aware
      // PARAM_RE (restricted to pairs that start inside the query, since the
      // path before the first `?` holds no parameters). A value is left
      // visible only when the reader that found it judges it a harmless
      // allowlisted SQLite parameter, so one reader's mis-split can only
      // over-redact (`cache=shared key=S` hides `shared key=S` — accepted).
      for (const p of localFileParams(view)) out.params.push(p);
      const q = view.text.indexOf("?");
      if (q < 0) continue;
      for (const pm of view.text.matchAll(PARAM_RE)) {
        const ind = (pm as any).indices as Array<[number, number] | undefined>;
        const k = ind?.[1];
        const v = ind?.[2];
        if (!k || !v || v[1] <= v[0] || k[0] <= q) continue;
        const key = safeDecode(pm[1]);
        if (isHarmlessSqliteParam(key, pm[2])) continue;
        const ov = toOriginal(view, v[0], v[1]);
        const ow = toOriginal(view, k[0], v[1]);
        if (ov && ow) out.params.push({ whole: ow, value: ov, key });
      }
      continue;
    }
    for (const pm of view.text.matchAll(PARAM_RE)) {
      const ind = (pm as any).indices as Array<[number, number] | undefined>;
      const k = ind?.[1];
      const v = ind?.[2];
      if (!k || !v || v[1] <= v[0]) continue;
      const key = safeDecode(pm[1]);
      const ov = toOriginal(view, v[0], v[1]);
      const ow = toOriginal(view, k[0], v[1]);
      if (ov && ow) out.params.push({ whole: ow, value: ov, key });
    }
  }
  return out;
}

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
 * The spans inside `value` that are secret (see "SHAPE-INDEPENDENT secret
 * spans" above): the userinfo (user AND password — the whole run to the LAST
 * `@`, so an unencoded `@`/`/`/`#` in a password is covered) and EVERY
 * parameter's value. Returned sorted and merged, in original offsets.
 */
export function secretSpans(value: string): Array<[number, number]> {
  if (typeof value !== "string" || value.length === 0) return [];
  const a = analyzeConnectionValue(value);
  const spans: Array<[number, number]> = [...a.userinfo, ...a.params.map((p) => p.value)];
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
 * contains — plus the self-anchored credential FRAGMENTS (`fragment: true`).
 * Only forms that actually carry a secret are returned.
 */
function echoForms(value: string): Array<{ raw: string; shown: string; fragment: boolean }> {
  const spans = secretSpans(value);
  if (spans.length === 0) return [];
  const lead = value.length - value.trimStart().length;
  const end = value.trimEnd().length;
  const cuts: Array<[number, number, boolean]> = [[0, value.length, false], [lead, end, false]];
  const cls = classifyDbTarget(value);
  if (cls.kind === "sqlite-file" && cls.sqlitePath !== null && cls.sqlitePath !== cls.trimmed) {
    cuts.push([end - cls.sqlitePath.length, end, false]);
  }
  // Self-anchored credential fragments: the `user:password` userinfo (the `:`
  // joins the pair) and each `key=value` parameter. A message may echo such a
  // fragment on its own (a mis-tokenized value); they are applied to MESSAGES
  // only — never to a source excerpt, where `k=v` / `a:b` are ordinary code.
  // s432: both come from the same shape-independent analysis as the spans.
  const a = analyzeConnectionValue(value);
  for (const [from, to] of a.userinfo) {
    if (value.slice(from, to).includes(":")) cuts.push([from, to, true]);
  }
  for (const p of a.params) cuts.push([p.whole[0], p.whole[1], true]);
  const out: Array<{ raw: string; shown: string; fragment: boolean }> = [];
  const seen = new Set<string>();
  for (const [from, to, fragment] of cuts) {
    if (to <= from) continue;
    const raw = value.slice(from, to);
    const shown = applySpans(value, spans, from, to);
    if (raw !== shown && !seen.has(raw)) {
      seen.add(raw);
      out.push({ raw, shown, fragment });
    }
  }
  return out;
}

/**
 * The PASSWORD-CLASS secrets a value carries (raw, unquoted, percent-decoded),
 * for LONG_SECRET_RULE only — the free-text backstop applied to MESSAGES.
 *
 * s432 r2: this list is deliberately NARROWER than the spans. The spans hide
 * every userinfo and every parameter value inside the value's own display
 * form; this list replaces a string ANYWHERE in a message, so it must never
 * hold material that is also an ordinary identifier — a username
 * (`orders_service`), a host, a database name, `application_name=inventory-
 * api-v2`. It holds only:
 *   - the userinfo PASSWORD (after the first `:`); a user-only userinfo only
 *     when it is token-shaped;
 *   - a parameter value whose DECODED key names a secret (pass / pwd / secret
 *     / token / key / auth / cred / sig), or whose value is token-shaped
 *     (16+ URL-safe characters mixing upper, lower and digit).
 * A key PATTERN here is a precision filter on a backstop, not the redaction
 * boundary: a secret it misses is still hidden wherever the value itself is
 * echoed (whole-value forms and positional spans).
 */
export function deriveSecrets(value: string): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (typeof s !== "string" || s.length === 0) return;
    out.add(s);
    const d = safeDecode(s);
    if (d.length > 0) out.add(d);
    const v = d.replace(new RegExp(INVISIBLE_CHAR_RE.source, "g"), "");
    if (v.length > 0) out.add(v);
  };
  const a = analyzeConnectionValue(value);
  for (const [from, to] of a.userinfo) {
    const ui = value.slice(from, to);
    const colon = ui.indexOf(":");
    if (colon >= 0) add(ui.slice(colon + 1));
    else if (isTokenLike(safeDecode(ui))) add(ui);
  }
  for (const p of a.params) {
    const raw = value.slice(p.value[0], p.value[1]);
    const bare = raw.startsWith("{") ? raw.replace(/^\{|\}$/g, "") : unquote(raw);
    if (!SECRET_KEY_NAME_RE.test(p.key) && !isTokenLike(safeDecode(bare))) continue;
    add(raw);
    add(bare);
    const hash = raw.indexOf("#");
    if (hash > 0) add(raw.slice(0, hash));
  }
  try {
    const u = new URL(value.trim());
    if (u.password) add(u.password);
    for (const [k, v] of u.searchParams) if (SECRET_KEY_NAME_RE.test(k) || isTokenLike(v)) add(v);
  } catch { /* not WHATWG-parseable — the readings above do not need it */ }
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

/** True when `name` carries a connection target on element `tag`. */
export function isConnectionAttr(tag: string, name: string): boolean {
  const wanted = CONNECTION_ATTRS[String(tag).toLowerCase()];
  return !!wanted && wanted.includes(String(name).toLowerCase());
}

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
 * and return their connection attributes with exact value offsets.
 *
 * s432 r2 — this text scan is the BACKUP to the tree (it is what the LSP and a
 * watch-mode reprint rely on when the tree is absent or stale), so it must
 * fail SAFE: a mis-read may only OVER-redact, never hide a value. It is the
 * UNION of three independent readings of each opener:
 *   1. an attribute tokenizer that skips an unquoted `{…}` / `${…}` value
 *      balanced (so `on:load=${() => a > b}` does not end the tag at `>`);
 *   2. the same tokenizer WITHOUT brace skipping (so a quote inside braces —
 *      a regex `/"/`, a comment, an apostrophe — or an unterminated `${`
 *      cannot run the scan past the real `db=`);
 *   3. a plain pattern pass for `db=` / `src=` / `idempotency-store=` over
 *      the text from the opener to the next `<` (no tokenizing at all).
 * Quoted values honour `\` escapes; unquoted values run to whitespace or `>`.
 * Tags may span lines.
 */
export function scanConnectionAttrs(source: string): ConnectionAttr[] {
  const all: ConnectionAttr[] = [];
  if (typeof source !== "string" || source.length === 0) return all;
  const tagRe = /<\s*(program|page|db)(?=[\s>\/])/g;
  for (const tm of source.matchAll(tagRe)) {
    const element = tm[1];
    const from = (tm.index ?? 0) + tm[0].length;
    tokenizeOpener(source, from, element, true, all);
    tokenizeOpener(source, from, element, false, all);
    patternScanOpener(source, from, element, all);
  }
  // Dedupe (same span); keep the rest — overlapping readings are resolved by
  // the consumer taking the widest.
  const seen = new Set<string>();
  const out: ConnectionAttr[] = [];
  for (const a of all.sort((x, y) => x.start - y.start || y.end - x.end)) {
    const key = `${a.start}:${a.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function tokenizeOpener(source: string, from: number, element: string, skipBraces: boolean, out: ConnectionAttr[]): void {
  const wanted = CONNECTION_ATTRS[element];
  const n = source.length;
  let i = from;
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
      if (skipBraces && (source[k] === "{" || (source[k] === "$" && source[k + 1] === "{"))) {
        k = source[k] === "$" ? k + 1 : k;
        let depth = 0;
        while (k < n) {
          const ch = source[k];
          if (ch === '"' || ch === "'" || ch === "`") {
            k++;
            while (k < n && source[k] !== ch) k += source[k] === "\\" ? 2 : 1;
            k++;
            continue;
          }
          if (ch === "{") depth++;
          else if (ch === "}") { depth--; if (depth === 0) { k++; break; } }
          k++;
        }
      }
      while (k < n && !/[\s>]/.test(source[k])) k++;
      vEnd = k;
      i = k;
    }
    if (wanted.includes(name.toLowerCase()) && vEnd > vStart) {
      out.push({ element, name, value: source.slice(vStart, vEnd), start: vStart, end: vEnd });
    }
  }
}

function patternScanOpener(source: string, from: number, element: string, out: ConnectionAttr[]): void {
  const wanted = CONNECTION_ATTRS[element];
  const lt = source.indexOf("<", from);
  const region = source.slice(from, lt < 0 ? source.length : lt);
  const re = /(?<![A-Za-z0-9_:\-])([A-Za-z][A-Za-z0-9_\-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)|'((?:\\.|[^'\\])*)|`((?:\\.|[^`\\])*)|([^\s>"'`]+))/dg;
  for (const m of region.matchAll(re)) {
    if (!wanted.includes(m[1].toLowerCase())) continue;
    const ind = (m as any).indices as Array<[number, number] | undefined>;
    const g = ind[2] ?? ind[3] ?? ind[4] ?? ind[5];
    if (!g || g[1] <= g[0]) continue;
    out.push({ element, name: m[1], value: region.slice(g[0], g[1]), start: from + g[0], end: from + g[1] });
  }
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
  // Readings may overlap (the scan is a union): take the widest at each start
  // and redact the rest of an overlapping later reading positionally too.
  for (const a of attrs.sort((x, y) => x.start - y.start || y.end - x.end)) {
    if (a.end <= i) continue;
    if (a.start < i) {
      // Overlap: redact this reading's secret spans that lie past `i`.
      const spans = secretSpans(a.value).map(([p, q]) => [a.start + p, a.start + q] as [number, number]);
      const tail = applySpans(source, spans, i, a.end);
      out += tail;
      i = a.end;
      continue;
    }
    const shown = displayConnectionValue(a.value);
    out += source.slice(i, a.start) + shown;
    i = a.end;
  }
  return out + source.slice(i);
}

/** The element name a node is, for CONNECTION_ATTRS purposes (a `<db>` state block is "db"). */
function connectionElementOf(n: any): string | null {
  if (!n || typeof n !== "object") return null;
  if (n.kind === "state" && n.stateType === "db") return "db";
  if (n.kind === "markup" && typeof n.tag === "string") return n.tag.toLowerCase();
  return null;
}

function isStringAttrValue(v: any): boolean {
  return typeof v === "string" || (!!v && typeof v === "object" && v.kind === "string-literal");
}

/**
 * An UNQUOTED TEXT value: the parser read `db=postgres…` as a bare
 * identifier. Not `db=${…}` (an expression) and not `db=@cfg` (a reactive
 * reference) — those are deliberate forms, not a split connection string.
 */
function isUnquotedTextAttrValue(v: any): boolean {
  return !!v && typeof v === "object" && v.kind === "variable-ref" &&
    typeof v.name === "string" && !v.name.startsWith("@");
}

/**
 * s432 F3 — the attributes of one element that are FRAGMENTS of a
 * mis-tokenized UNQUOTED connection value.
 *
 * `<program db=postgres://u:p/w@h/app>` parses as `db=postgres` followed by
 * attributes NAMED `u:p`, `w@h`, `app`: only the leading identifier is the
 * value, the rest of the connection string — its password included — becomes
 * attribute names. Any diagnostic that echoes such a name prints the password
 * in pieces that no value-based redactor can recognise (a middle piece need
 * carry no `:` or `@`, and may be one character long).
 *
 * The rule is POSITIONAL, never a test of the name's shape: once a connection
 * attribute has an unquoted TEXT value (a bare identifier — not `${…}`, not
 * `@ref`), every later attribute on the element whose value is not
 * a string literal is a fragment. A real attribute after it that carries a
 * quoted value (`tables="users"`) is not.
 */
export function connectionFragmentAttrs(element: string, attrs: unknown): { via: string | null; fragments: any[] } {
  const out: { via: string | null; fragments: any[] } = { via: null, fragments: [] };
  if (!Array.isArray(attrs)) return out;
  for (const a of attrs) {
    if (!a || typeof a.name !== "string") continue;
    if (out.via !== null) {
      if (!isStringAttrValue(a.value)) out.fragments.push(a);
      continue;
    }
    if (isConnectionAttr(element, a.name) && isUnquotedTextAttrValue(a.value)) {
      out.via = a.name;
    }
  }
  return out;
}

export interface FragmentSite {
  file: string | null;
  start: number;
  end: number;
  name: string;
}

/** Every connection-value fragment attribute in a parsed file's AST, with its span. */
export function collectFragmentsFromAst(root: unknown): FragmentSite[] {
  const found: FragmentSite[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as any;
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    const element = connectionElementOf(n);
    if (element !== null && CONNECTION_ATTRS[element]) {
      for (const a of connectionFragmentAttrs(element, n.attrs).fragments) {
        const sp = a.span;
        if (sp && typeof sp.start === "number" && typeof sp.end === "number") {
          found.push({ file: typeof sp.file === "string" ? sp.file : null, start: sp.start, end: sp.end, name: a.name });
        }
      }
    }
    for (const k of Object.keys(n)) {
      const c = n[k];
      if (c && typeof c === "object") stack.push(c);
    }
  }
  return found;
}

function normFile(f: unknown): string | null {
  if (typeof f !== "string" || f.length === 0) return null;
  return f.replace(/\\/g, "/").toLowerCase();
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
    const element = connectionElementOf(n);
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
  private forms: Array<[string, string]> = [];   // longest raw first (messages)
  private wholeForms: Array<[string, string]> = []; // whole-value forms only (source)
  private longSecrets: string[] = [];             // longest first
  private fragments: FragmentSite[] = [];         // s432 F3 — unquoted-value fragment attrs
  private fragmentKeys = new Set<string>();
  private version = 0;
  private lastSource: [string, string, number] | null = null;

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
    const wholeForms = new Map<string, string>();
    const longs = new Set<string>();
    for (const v of this.values) {
      for (const f of echoForms(v)) {
        forms.set(f.raw, f.shown);
        if (!f.fragment) wholeForms.set(f.raw, f.shown);
      }
      if (secretSpans(v).length > 0) {
        for (const s of deriveSecrets(v)) if (isLongUnusualSecret(s)) longs.add(s);
      }
    }
    this.version++;
    this.forms = [...forms.entries()].sort((a, b) => b[0].length - a[0].length);
    this.wholeForms = [...wholeForms.entries()].sort((a, b) => b[0].length - a[0].length);
    this.longSecrets = [...longs].sort((a, b) => b.length - a.length);
  }

  /** Redact a MESSAGE. Text containing no registered value is returned unchanged. */
  redact(text: string): string {
    return this.applyForms(text, this.forms, true);
  }

  private applyForms(text: string, forms: Array<[string, string]>, freeText: boolean): string {
    if (typeof text !== "string" || text.length === 0 || this.forms.length === 0) return text;
    let out = text;
    for (const [raw, shown] of forms) {
      if (out.includes(raw)) out = out.split(raw).join(shown);
    }
    if (freeText) {
      for (const s of this.longSecrets) {
        if (out.includes(s)) out = out.split(s).join(REDACTED);
      }
    }
    return out;
  }

  /**
   * Redact a SOURCE excerpt. First by attribute SPAN (redactSourceText) — which
   * needs no registry, so it is right even when the file on disk changed after
   * the compile that registered its values (watch mode prints what it reads
   * NOW). Then any other exact copy of a registered WHOLE connection value (a
   * value pasted into a comment) — a full connection string cannot collide
   * with code. NO free-text replacement: never a secret word (LONG_SECRET_RULE
   * — s432 r2: a registered `orders_service` shredded `SELECT id FROM
   * orders_service` in frames) and never a credential FRAGMENT (`k=v` / `a:b`
   * are ordinary code).
   */
  redactSource(text: string): string {
    // A frame printer redacts the whole file once per diagnostic; the result
    // depends only on (text, registered values), so reuse the last one.
    if (this.lastSource !== null && this.lastSource[0] === text && this.lastSource[2] === this.version) return this.lastSource[1];
    const out = this.applyForms(redactSourceText(text), this.wholeForms, false);
    this.lastSource = [text, out, this.version];
    return out;
  }

  /** Redact every string field of a diagnostic object, in place (top level). */
  redactDiagnostic(d: any): void {
    if (!d || typeof d !== "object") return;
    if (this.forms.length === 0 && this.fragments.length === 0) return;
    const span = d.span && typeof d.span === "object" ? d.span
      : d.tabSpan && typeof d.tabSpan === "object" ? d.tabSpan : null;
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (typeof v === "string") d[k] = this.redactAt(v, span);
    }
  }

  /** Register the tree of one parsed file: its connection values and fragment sites. */
  addAst(root: unknown): void {
    this.addValues(collectFromAst(root));
    for (const f of collectFragmentsFromAst(root)) {
      const key = `${f.start}:${f.end}:${normFile(f.file) ?? ""}`;
      if (this.fragmentKeys.has(key)) continue;
      this.fragmentKeys.add(key);
      this.fragments.push(f);
    }
  }

  /**
   * Redact a MESSAGE that a diagnostic positioned at `span` carries. On top of
   * `redact`: when the span IS a connection-value fragment attribute (s432 F3),
   * that attribute's NAME — a piece of the connection string — is replaced in
   * this message only (so a one-character piece cannot shred other messages).
   */
  redactAt(text: string, span: any): string {
    let out = this.redact(text);
    if (typeof out !== "string" || out.length === 0 || !span || typeof span !== "object") return out;
    if (typeof span.start !== "number" || typeof span.end !== "number") return out;
    const file = normFile(span.file);
    for (const f of this.fragments) {
      if (f.start !== span.start || f.end !== span.end) continue;
      const ff = normFile(f.file);
      if (file !== null && ff !== null && file !== ff) continue;
      if (out.includes(f.name)) out = out.split(f.name).join(REDACTED);
    }
    return out;
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
