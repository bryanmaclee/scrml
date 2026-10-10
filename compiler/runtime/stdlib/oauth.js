// scrml:oauth — runtime shim (umbrella)
//
// Hand-written ES module mirroring stdlib/oauth/index.scrml. OAuth 2.0 /
// OpenID Connect client (authorization-code grant with PKCE, refresh,
// userinfo, revocation). Server-side only — all exports are async network
// calls or pure helpers around them.
//
// Surface (must match stdlib/oauth/index.scrml exports):
//   - OAuthStore                               → enum: Memory(entries) | Redis(url) | Store(kv)
//   - memoryAdapter()                          → OAuthStore.Memory(new Map())
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
import { setex, get as redisGet, del as redisDel, createClient } from "./redis.js";
import { get as kvGet, set as kvSet, del as kvDel } from "./store.js";
import { generateToken } from "./crypto.js";
import { generateVerifier, deriveChallenge, PKCE_METHOD } from "./oauth/pkce.js";
// host wall-clock via the single sanctioned scrml:time touch (S179 clock de-leak)
import { now as clockNow } from "./time.js";

// ---------------------------------------------------------------------------
// Storage — the OAuthStore enum (S462). Mirrors the scrml enum declared in
// stdlib/oauth/index.scrml; the variant shape is the one the compiler emits
// for payload variants ({ variant, data: { <field> } }). The caller picks the
// backend by TAG and the module matches on it — a storage backend is never an
// object of functions (SPEC §14.3).
//
//   OAuthStore.Memory(entries) — in-process Map (dev / single process)
//   OAuthStore.Redis(url)      — scrml:redis; null/undefined url = default client
//   OAuthStore.Store(kv)       — a scrml:store KvStore
// ---------------------------------------------------------------------------

export const OAuthStore = Object.freeze({
  Memory: function(entries) {
    return { variant: "Memory", data: { entries } };
  },
  Redis: function(url) {
    return { variant: "Redis", data: { url } };
  },
  Store: function(kv) {
    return { variant: "Store", data: { kv } };
  },
  variants: ["Memory", "Redis", "Store"],
});

// In-memory storage, dev-only. Each call is a fresh, independent store.
export function memoryAdapter() {
  return OAuthStore.Memory(new Map());
}

// One dedicated Redis client per URL for OAuthStore.Redis(url), reused.
const _redisClients = new Map();
function _redisClientFor(url) {
  let client = _redisClients.get(url);
  if (!client) {
    client = createClient(url);
    _redisClients.set(url, client);
  }
  return client;
}

function _isAbsent(v) {
  return v === null || v === undefined;
}

async function _storePut(storage, key, value, ttlSeconds) {
  switch (storage.variant) {
    case "Memory": {
      const expiresAt = ttlSeconds && ttlSeconds > 0 ? clockNow() + ttlSeconds * 1000 : null;
      storage.data.entries.set(key, { value, expiresAt });
      return;
    }
    case "Redis": {
      const url = storage.data.url;
      if (_isAbsent(url)) {
        await setex(key, value, ttlSeconds);
      } else {
        await _redisClientFor(url).send("SETEX", [key, String(ttlSeconds), value]);
      }
      return;
    }
    case "Store":
      kvSet(storage.data.kv, key, value, ttlSeconds);
      return;
  }
}

async function _storeGet(storage, key) {
  switch (storage.variant) {
    case "Memory": {
      const entries = storage.data.entries;
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt !== undefined && entry.expiresAt <= clockNow()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    }
    case "Redis": {
      const url = storage.data.url;
      if (_isAbsent(url)) return await redisGet(key);
      return await _redisClientFor(url).get(key);
    }
    case "Store":
      return kvGet(storage.data.kv, key);
  }
  return null;
}

async function _storeDel(storage, key) {
  switch (storage.variant) {
    case "Memory":
      storage.data.entries.delete(key);
      return;
    case "Redis": {
      const url = storage.data.url;
      if (_isAbsent(url)) {
        await redisDel(key);
      } else {
        await _redisClientFor(url).del(key);
      }
      return;
    }
    case "Store":
      kvDel(storage.data.kv, key);
      return;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

function _assertStorage(storage) {
  if (!storage || typeof storage !== "object" || !OAuthStore.variants.includes(storage.variant)) {
    throw new Error(
      "[scrml:oauth] config.storage must be an OAuthStore value: "
        + "memoryAdapter() for dev, OAuthStore.Redis(url) or "
        + "OAuthStore.Store(kvStore) for prod.",
    );
  }
  // "" is a defined value, not absence (scrml has no null): an empty Redis URL
  // is refused rather than silently read as "the default client".
  if (storage.variant === "Redis" && storage.data.url === "") {
    throw new Error(
      "[scrml:oauth] OAuthStore.Redis(\"\") — pass a Redis URL, or OAuthStore.Redis(not) for the default client.",
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
  await _storePut(config.storage, _stateKey(sessionKey), state, ttl);
  if (verifier) {
    await _storePut(config.storage, _verifierKey(sessionKey), verifier, ttl);
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

  const expectedState = await _storeGet(config.storage, _stateKey(sessionKey));
  await _storeDel(config.storage, _stateKey(sessionKey));

  if (!expectedState || expectedState !== state) {
    const verifierKey = _verifierKey(sessionKey);
    await _storeDel(config.storage, verifierKey);
    const err = new Error(
      "[scrml:oauth] state mismatch — possible CSRF attempt or expired flow",
    );
    err.name = "OAuthStateMismatch";
    throw err;
  }

  const usePKCE = config.usePKCE !== false;
  let verifier = null;
  if (usePKCE) {
    verifier = await _storeGet(config.storage, _verifierKey(sessionKey));
    await _storeDel(config.storage, _verifierKey(sessionKey));
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
  const expiresAt = expiresIn ? clockNow() + expiresIn * 1000 : null;

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
