// scrml:oauth — runtime shim (umbrella)
//
// Hand-written ES module mirroring stdlib/oauth/index.scrml. OAuth 2.0 /
// OpenID Connect client (authorization-code grant with PKCE, refresh,
// userinfo, revocation). Server-side only — all exports are async network
// calls or pure helpers around them.
//
// Surface (must match stdlib/oauth/index.scrml exports):
//   - memoryAdapter()                          → { put, get, del }
//   - startFlow(config, sessionKey)            → Promise<string>
//   - exchangeCode(config, sessionKey, code, state) → Promise<tokens>
//   - refreshToken(config, refreshTokenStr)    → Promise<tokens>
//   - getUserInfo(config, accessToken)         → Promise<object>
//   - revoke(config, token, tokenTypeHint?)    → Promise<true>
//   - generateVerifier(length?)                → string  (PKCE)
//   - deriveChallenge(verifier)                → Promise<string>  (PKCE)
//   - PKCE_METHOD                              → "S256"
//   - googleConfig / githubConfig / microsoftConfig / discordConfig
//   - parseGoogleIdToken(tokens)               → object | null
//
// Sub-module imports (`scrml:oauth/google`, `scrml:oauth/pkce`, etc.) also
// resolve to per-file shims under compiler/runtime/stdlib/oauth/ — see
// oauth/google.js, oauth/pkce.js, etc.

// Re-export sub-module surfaces from the umbrella.
export { generateVerifier, deriveChallenge, PKCE_METHOD } from "./oauth/pkce.js";
export { googleConfig, parseIdToken as parseGoogleIdToken } from "./oauth/google.js";
export { githubConfig } from "./oauth/github.js";
export { microsoftConfig } from "./oauth/microsoft.js";
export { discordConfig } from "./oauth/discord.js";

import { post as httpPost, get as httpGet } from "./http.js";
import { generateToken } from "./crypto.js";
import { generateVerifier, deriveChallenge, PKCE_METHOD } from "./oauth/pkce.js";

// ---------------------------------------------------------------------------
// Storage adapter — in-memory dev-only.
// ---------------------------------------------------------------------------

export function memoryAdapter() {
  const store = new Map();
  function expired(entry) {
    return entry.expiresAt !== null && entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }
  return {
    put(key, value, ttlSeconds) {
      const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
    },
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (expired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    del(key) {
      store.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

function _assertStorage(storage) {
  if (
    !storage
    || typeof storage.put !== "function"
    || typeof storage.get !== "function"
    || typeof storage.del !== "function"
  ) {
    throw new Error(
      "[scrml:oauth] config.storage must be an object with put/get/del methods. "
        + "Use memoryAdapter() for dev or wire scrml:redis / scrml:store for prod.",
    );
  }
}

function _assertConfig(config) {
  if (!config) throw new Error("[scrml:oauth] config required");
  if (!config.clientId) throw new Error("[scrml:oauth] config.clientId required");
  if (!config.redirectUri) throw new Error("[scrml:oauth] config.redirectUri required");
  if (!config.authorizeUrl) throw new Error("[scrml:oauth] config.authorizeUrl required");
  if (!config.tokenUrl) throw new Error("[scrml:oauth] config.tokenUrl required");
  const usePKCE = config.usePKCE !== false;
  if (!config.clientSecret && !usePKCE) {
    throw new Error(
      "[scrml:oauth] public client (no clientSecret) MUST use PKCE. "
        + "Set config.usePKCE = true (the default) or supply clientSecret.",
    );
  }
  _assertStorage(config.storage);
}

// ---------------------------------------------------------------------------
// startFlow — build authorize URL + persist state/verifier.
// ---------------------------------------------------------------------------

export async function startFlow(config, sessionKey) {
  _assertConfig(config);
  if (!sessionKey || typeof sessionKey !== "string") {
    throw new Error("[scrml:oauth] startFlow: sessionKey must be a non-empty string");
  }

  const state = generateToken(16);
  const usePKCE = config.usePKCE !== false;

  const params = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: (config.scopes || []).join(" "),
    state,
  };

  let verifier = null;
  if (usePKCE) {
    verifier = generateVerifier();
    const challenge = await deriveChallenge(verifier);
    params.code_challenge = challenge;
    params.code_challenge_method = PKCE_METHOD;
  }

  if (config.extraAuthParams) {
    for (const [k, v] of Object.entries(config.extraAuthParams)) {
      if (v !== null && v !== undefined) params[k] = String(v);
    }
  }

  const ttl = 600;
  await config.storage.put(_stateKey(sessionKey), state, ttl);
  if (verifier) {
    await config.storage.put(_verifierKey(sessionKey), verifier, ttl);
  }

  return _buildUrl(config.authorizeUrl, params);
}

// ---------------------------------------------------------------------------
// exchangeCode — trade auth code + verifier for tokens.
// ---------------------------------------------------------------------------

export async function exchangeCode(config, sessionKey, code, state) {
  _assertConfig(config);
  if (!code) throw new Error("[scrml:oauth] exchangeCode: code required");
  if (!state) throw new Error("[scrml:oauth] exchangeCode: state required");

  const expectedState = await config.storage.get(_stateKey(sessionKey));
  await config.storage.del(_stateKey(sessionKey));

  if (!expectedState || expectedState !== state) {
    const verifierKey = _verifierKey(sessionKey);
    await config.storage.del(verifierKey);
    const err = new Error(
      "[scrml:oauth] state mismatch — possible CSRF attempt or expired flow",
    );
    err.name = "OAuthStateMismatch";
    throw err;
  }

  const usePKCE = config.usePKCE !== false;
  let verifier = null;
  if (usePKCE) {
    verifier = await config.storage.get(_verifierKey(sessionKey));
    await config.storage.del(_verifierKey(sessionKey));
    if (!verifier) {
      const err = new Error(
        "[scrml:oauth] code_verifier missing from storage — flow expired",
      );
      err.name = "OAuthVerifierMissing";
      throw err;
    }
  }

  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
  };
  if (config.clientSecret) body.client_secret = config.clientSecret;
  if (verifier) body.code_verifier = verifier;

  return await _tokenRequest(config, body);
}

// ---------------------------------------------------------------------------
// refreshToken — trade refresh token for fresh access token.
// ---------------------------------------------------------------------------

export async function refreshToken(config, refreshTokenStr) {
  _assertConfig(config);
  if (!refreshTokenStr) {
    throw new Error("[scrml:oauth] refreshToken: refresh token string required");
  }

  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshTokenStr,
    client_id: config.clientId,
  };
  if (config.clientSecret) body.client_secret = config.clientSecret;

  return await _tokenRequest(config, body);
}

// ---------------------------------------------------------------------------
// getUserInfo — fetch the OIDC userinfo profile.
// ---------------------------------------------------------------------------

export async function getUserInfo(config, accessToken) {
  if (!config || !config.userInfoUrl) {
    throw new Error("[scrml:oauth] getUserInfo: config.userInfoUrl not set for this provider");
  }
  if (!accessToken) {
    throw new Error("[scrml:oauth] getUserInfo: accessToken required");
  }

  const res = await httpGet(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(
      `[scrml:oauth] userinfo request failed: status ${res.status}`,
    );
    err.name = "OAuthUserInfoError";
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// revoke — invalidate a token at the provider (RFC 7009).
// ---------------------------------------------------------------------------

export async function revoke(config, token, tokenTypeHint) {
  if (!config || !config.revocationUrl) {
    throw new Error(
      "[scrml:oauth] revoke: config.revocationUrl not set for this provider — "
        + "this provider may not support RFC 7009 revocation.",
    );
  }
  if (!token) throw new Error("[scrml:oauth] revoke: token required");

  const body = {
    token,
    client_id: config.clientId,
  };
  if (config.clientSecret) body.client_secret = config.clientSecret;
  if (tokenTypeHint) body.token_type_hint = tokenTypeHint;

  const res = await httpPost(config.revocationUrl, _formEncode(body), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    const err = new Error(
      `[scrml:oauth] revocation failed: status ${res.status}`,
    );
    err.name = "OAuthRevocationError";
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function _tokenRequest(config, bodyObj) {
  const res = await httpPost(config.tokenUrl, _formEncode(bodyObj), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const err = new Error(_describeTokenError(res.data, res.status));
    err.name = "OAuthTokenError";
    err.status = res.status;
    err.body = res.data;
    throw err;
  }

  const data = res.data || {};
  const expiresIn =
    typeof data.expires_in === "number"
      ? data.expires_in
      : typeof data.expires_in === "string"
        ? parseInt(data.expires_in, 10)
        : null;
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

  return {
    accessToken: data.access_token || null,
    refreshToken: data.refresh_token || null,
    idToken: data.id_token || null,
    tokenType: data.token_type || "Bearer",
    scope: data.scope || null,
    expiresIn,
    expiresAt,
    raw: data,
  };
}

function _describeTokenError(data, status) {
  if (data && typeof data === "object") {
    const code = data.error || "unknown_error";
    const desc = data.error_description || "";
    return `[scrml:oauth] token request failed (${status}): ${code}${desc ? " — " + desc : ""}`;
  }
  return `[scrml:oauth] token request failed (${status})`;
}

function _buildUrl(base, params) {
  const pairs = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  const query = pairs.join("&");
  if (!query) return base;
  const sep = base.includes("?") ? "&" : "?";
  return base + sep + query;
}

function _formEncode(obj) {
  const pairs = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) continue;
    pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return pairs.join("&");
}

function _stateKey(sessionKey) {
  return "scrml:oauth:state:" + sessionKey;
}
function _verifierKey(sessionKey) {
  return "scrml:oauth:verifier:" + sessionKey;
}
