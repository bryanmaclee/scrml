// scrml:oauth/google — runtime shim
//
// Hand-written ES module mirroring stdlib/oauth/google.scrml. Google OAuth
// 2.0 / OpenID Connect preset.
//
// Surface (must match stdlib/oauth/google.scrml exports):
//   - googleConfig(opts)               → config object
//   - parseIdToken(tokens)             → claims | null   (UNVERIFIED — no sig check)

export function googleConfig(opts) {
  if (!opts) throw new Error("[scrml:oauth/google] opts required");
  const extra = {
    access_type: "offline",
    prompt: "consent",
  };
  if (opts.loginHint) extra.login_hint = opts.loginHint;
  if (opts.hostedDomain) extra.hd = opts.hostedDomain;

  return {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: opts.redirectUri,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    revocationUrl: "https://oauth2.googleapis.com/revoke",
    scopes: opts.scopes || ["openid", "email", "profile"],
    usePKCE: true,
    extraAuthParams: extra,
    storage: opts.storage,
  };
}

// Parse a Google id_token WITHOUT verifying the signature. The scrml source
// declares this as `! -> OAuthError` (failable) — the JS lowering returns a
// scrml-error-shape sentinel on failure (matches the `safeCall` contract
// from scrml:host).

export function parseIdToken(tokens) {
  if (!tokens || !tokens.idToken) return null;
  const parts = tokens.idToken.split(".");
  if (parts.length !== 3) {
    return _parseError("[scrml:oauth/google] parseIdToken: malformed JWT");
  }
  const payload = parts[1];
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  let json;
  try {
    json = atob(b64 + pad);
  } catch (e) {
    return _parseError(e && e.message ? e.message : String(e));
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    return _parseError(e && e.message ? e.message : String(e));
  }
}

function _parseError(message) {
  return {
    __scrml_error: true,
    type: "OAuthError",
    variant: "ParseFailed",
    data: { message },
  };
}
