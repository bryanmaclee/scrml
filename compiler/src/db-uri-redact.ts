/**
 * Credential redaction for database targets echoed in compiler output.
 *
 * A `db=` / `<db src=>` value can be a driver connection URI that carries a
 * password (`postgres://admin:S3cret@host/app`). Any diagnostic, note or CLI
 * message that names the target MUST pass it through `redactDbUri` first —
 * compiler output lands in terminals, CI logs and pasted bug reports.
 * (s430-dev-db-stub F4.)
 *
 * What is redacted:
 *   - the whole userinfo of a `scheme://userinfo@host` URI (user AND password —
 *     the user name is half a credential). Everything up to the LAST `@` after
 *     `://` is treated as userinfo, so an unencoded `@` or `/` inside a password
 *     cannot leak its tail. Over-redacting a path that contains `@` is the safe
 *     failure.
 *   - `password=` / `pass=` / `pwd=` / `sslpassword=` parameter values, in a
 *     query string or a space/semicolon-separated key=value string.
 *
 * A plain SQLite path (`./app.db`, `sqlite:./app.db`, `:memory:`) has no
 * `://` userinfo and no password parameter, and passes through unchanged.
 */

const REDACTED = "<redacted>";

export function redactDbUri(target: string): string {
  if (typeof target !== "string" || target.length === 0) return target;
  let out = target;

  const schemeMatch = out.match(/^[a-z][a-z0-9+.\-]*:\/\//i);
  if (schemeMatch !== null) {
    const prefix = schemeMatch[0];
    const rest = out.slice(prefix.length);
    const lastAt = rest.lastIndexOf("@");
    if (lastAt >= 0) {
      out = prefix + REDACTED + rest.slice(lastAt);
    }
  }

  return redactPasswordParams(out);
}

function redactPasswordParams(text: string): string {
  return text.replace(
    /(^|[?&;\s])((?:ssl)?password|pass|pwd)=[^&;\s#"'`]*/gi,
    (_m, lead: string, key: string) => `${lead}${key}=${REDACTED}`,
  );
}

/**
 * Redact every URI userinfo and password parameter found ANYWHERE in a run of
 * text — for echoing SOURCE lines (the code frame under a diagnostic), where
 * the `db=` value sits inside markup rather than standing alone. A userinfo run
 * ends at whitespace or a quote/backtick/angle bracket; within that run the
 * match extends to the LAST `@`, so an unencoded `@` in a password is covered.
 */
export function redactCredentialsInText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  const out = text.replace(
    /([a-z][a-z0-9+.\-]*:\/\/)[^\s"'`<>]*@/gi,
    (_m, scheme: string) => `${scheme}${REDACTED}@`,
  );
  return redactPasswordParams(out);
}
