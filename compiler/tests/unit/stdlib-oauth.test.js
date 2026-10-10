/**
 * stdlib-oauth — unit tests for scrml:oauth core API + PKCE
 *
 * Tests are extracted from stdlib/oauth/index.scrml + stdlib/oauth/pkce.scrml.
 * The HTTP layer (scrml:http -> fetch) is stubbed so tests don't make
 * network calls; the storage layer uses the in-process memoryAdapter.
 *
 * Coverage:
 *   P1   PKCE verifier — alphabet + length bounds
 *   P2   PKCE challenge — RFC 7636 Appendix B test vector
 *   P3   PKCE challenge — base64url has no padding, no '+' or '/'
 *   M1   memoryAdapter — a Memory tag over a fresh Map (S462)
 *   M2   OAuthStore tag constructors (payload-variant shape)
 *   R1-R3 REAL shim: .Memory and .Store(kv) round-trips; a method object is refused
 *   C1   _assertConfig — missing fields throw
 *   C2   _assertStorage — a non-OAuthStore storage throws
 *   C3   public client without PKCE rejected
 *   F1   startFlow writes state + verifier to storage; returns URL with
 *        correct query params
 *   F2   startFlow w/ usePKCE=false skips verifier
 *   F3   startFlow appends extraAuthParams
 *   F4   exchangeCode — happy path; clears state + verifier; parses tokens
 *   F5   exchangeCode — state mismatch throws OAuthStateMismatch
 *   F6   exchangeCode — missing verifier throws OAuthVerifierMissing
 *   F7   exchangeCode — token endpoint error throws OAuthTokenError with body
 *   F8   refreshToken — POSTs grant_type=refresh_token with the token
 *   F9   getUserInfo — sends Bearer header
 *   F10  getUserInfo — non-2xx throws OAuthUserInfoError with status
 *   F11  revoke — POSTs to revocationUrl; success returns true
 *   F12  revoke — no revocationUrl throws clear error
 *   E1   buildUrl preserves existing query string
 *   E2   formEncode skips null/undefined; encodes special chars
 */

import { describe, test, expect, beforeEach } from "bun:test";
import * as realOauth from "../../runtime/stdlib/oauth.js";
import { createStore, get as kvGet, close as kvClose } from "../../runtime/stdlib/store.js";
const { OAuthStore, memoryAdapter } = realOauth;

// --- Stubbed HTTP (replaces scrml:http get/post) ----------------------------

let httpCalls = [];
let nextHttpResponse = null; // optional override

function makeResp(ok, status, data) {
  return { ok, status, data, headers: new Headers(), raw: null };
}

const stubHttp = {
  async get(url, options) {
    httpCalls.push({ method: "GET", url, options: options || {} });
    if (nextHttpResponse) {
      const r = nextHttpResponse;
      nextHttpResponse = null;
      return r;
    }
    return makeResp(true, 200, { ok: true });
  },
  async post(url, body, options) {
    httpCalls.push({ method: "POST", url, body, options: options || {} });
    if (nextHttpResponse) {
      const r = nextHttpResponse;
      nextHttpResponse = null;
      return r;
    }
    return makeResp(true, 200, { ok: true });
  },
};

// --- Functions extracted from stdlib/oauth/pkce.scrml -----------------------

const VERIFIER_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function generateVerifier(length) {
  const len = length || 43;
  if (len < 43 || len > 128) {
    throw new Error(`[scrml:oauth/pkce] verifier length must be 43-128, got ${len}`);
  }
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const A = VERIFIER_ALPHABET;
  const alphaLen = A.length;
  let out = "";
  for (let i = 0; i < len; i++) {
    out += A[bytes[i] % alphaLen];
  }
  return out;
}

function _base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveChallenge(verifier) {
  if (typeof verifier !== "string" || verifier.length < 43) {
    throw new Error(`[scrml:oauth/pkce] verifier must be a string of length >= 43`);
  }
  const enc = new TextEncoder();
  const data = enc.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return _base64UrlEncode(new Uint8Array(digest));
}

const PKCE_METHOD = "S256";

// --- Functions extracted from stdlib/oauth/index.scrml ----------------------
// (substituting stubHttp.get/post for the scrml:http imports)

function generateToken(bytes) {
  const size = bytes || 32;
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
}

// S462: storage is an OAuthStore enum tag, not an object of methods. The tag
// constructors come from the REAL shim; the copied flow below drives the
// Memory arm through these mirrors of the shim's _storePut/_storeGet/_storeDel.
async function _storePut(storage, key, value, ttlSeconds) {
  const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
  storage.data.entries.set(key, { value, expiresAt });
}
async function _storeGet(storage, key) {
  return memGet(storage, key);
}
async function _storeDel(storage, key) {
  storage.data.entries.delete(key);
}
// Synchronous read of a Memory store (test assertions).
function memGet(storage, key) {
  const entry = storage.data.entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    storage.data.entries.delete(key);
    return null;
  }
  return entry.value;
}

function _assertStorage(storage) {
  if (!storage || typeof storage !== "object" || !OAuthStore.variants.includes(storage.variant)) {
    throw new Error(
      "[scrml:oauth] config.storage must be an OAuthStore value: "
        + "memoryAdapter() for dev, OAuthStore.Redis(url) or "
        + "OAuthStore.Store(kvStore) for prod."
    );
  }
}

function _assertConfig(config) {
  if (!config) throw new Error("[scrml:oauth] config required");
  if (!config.clientId)     throw new Error("[scrml:oauth] config.clientId required");
  if (!config.redirectUri)  throw new Error("[scrml:oauth] config.redirectUri required");
  if (!config.authorizeUrl) throw new Error("[scrml:oauth] config.authorizeUrl required");
  if (!config.tokenUrl)     throw new Error("[scrml:oauth] config.tokenUrl required");
  const usePKCE = config.usePKCE !== false;
  if (!config.clientSecret && !usePKCE) {
    throw new Error(
      "[scrml:oauth] public client (no clientSecret) MUST use PKCE. "
      + "Set config.usePKCE = true (the default) or supply clientSecret."
    );
  }
  _assertStorage(config.storage);
}

function _stateKey(s)    { return "scrml:oauth:state:"    + s; }
function _verifierKey(s) { return "scrml:oauth:verifier:" + s; }

function _buildUrl(base, params) {
  const pairs = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  const q = pairs.join("&");
  if (!q) return base;
  const sep = base.includes("?") ? "&" : "?";
  return base + sep + q;
}

function _formEncode(obj) {
  const pairs = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return pairs.join("&");
}

function _describeTokenError(data, status) {
  if (data && typeof data === "object") {
    const code = data.error             || "unknown_error";
    const desc = data.error_description || "";
    return `[scrml:oauth] token request failed (${status}): ${code}${desc ? " — " + desc : ""}`;
  }
  return `[scrml:oauth] token request failed (${status})`;
}

async function _tokenRequest(config, bodyObj) {
  const res = await stubHttp.post(config.tokenUrl, _formEncode(bodyObj), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
  });
  if (!res.ok) {
    const err = new Error(_describeTokenError(res.data, res.status));
    err.name = "OAuthTokenError";
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  const data = res.data || {};
  const expiresIn = typeof data.expires_in === "number"
    ? data.expires_in
    : (typeof data.expires_in === "string" ? parseInt(data.expires_in, 10) : null);
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
  return {
    accessToken:  data.access_token  || null,
    refreshToken: data.refresh_token || null,
    idToken:      data.id_token      || null,
    tokenType:    data.token_type    || "Bearer",
    scope:        data.scope         || null,
    expiresIn,
    expiresAt,
    raw: data,
  };
}

async function startFlow(config, sessionKey) {
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
      if (v !== undefined && v !== null) params[k] = String(v);
    }
  }
  const ttl = 600;
  await _storePut(config.storage, _stateKey(sessionKey), state, ttl);
  if (verifier) await _storePut(config.storage, _verifierKey(sessionKey), verifier, ttl);
  return _buildUrl(config.authorizeUrl, params);
}

async function exchangeCode(config, sessionKey, code, state) {
  _assertConfig(config);
  if (!code) throw new Error("[scrml:oauth] exchangeCode: code required");
  if (!state) throw new Error("[scrml:oauth] exchangeCode: state required");
  const expectedState = await _storeGet(config.storage, _stateKey(sessionKey));
  await _storeDel(config.storage, _stateKey(sessionKey));
  if (!expectedState || expectedState !== state) {
    await _storeDel(config.storage, _verifierKey(sessionKey));
    const err = new Error("[scrml:oauth] state mismatch — possible CSRF attempt or expired flow");
    err.name = "OAuthStateMismatch";
    throw err;
  }
  const usePKCE = config.usePKCE !== false;
  let verifier = null;
  if (usePKCE) {
    verifier = await _storeGet(config.storage, _verifierKey(sessionKey));
    await _storeDel(config.storage, _verifierKey(sessionKey));
    if (!verifier) {
      const err = new Error("[scrml:oauth] code_verifier missing from storage — flow expired");
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
  if (verifier)            body.code_verifier = verifier;
  return await _tokenRequest(config, body);
}

async function refreshToken(config, refreshTokenStr) {
  _assertConfig(config);
  if (!refreshTokenStr) throw new Error("[scrml:oauth] refreshToken: refresh token string required");
  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshTokenStr,
    client_id: config.clientId,
  };
  if (config.clientSecret) body.client_secret = config.clientSecret;
  return await _tokenRequest(config, body);
}

async function getUserInfo(config, accessToken) {
  if (!config || !config.userInfoUrl) {
    throw new Error("[scrml:oauth] getUserInfo: config.userInfoUrl not set for this provider");
  }
  if (!accessToken) throw new Error("[scrml:oauth] getUserInfo: accessToken required");
  const res = await stubHttp.get(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(`[scrml:oauth] userinfo request failed: status ${res.status}`);
    err.name = "OAuthUserInfoError";
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  return res.data;
}

async function revoke(config, token, tokenTypeHint) {
  if (!config || !config.revocationUrl) {
    throw new Error(
      "[scrml:oauth] revoke: config.revocationUrl not set for this provider — "
      + "this provider may not support RFC 7009 revocation."
    );
  }
  if (!token) throw new Error("[scrml:oauth] revoke: token required");
  const body = { token, client_id: config.clientId };
  if (config.clientSecret) body.client_secret = config.clientSecret;
  if (tokenTypeHint)       body.token_type_hint = tokenTypeHint;
  const res = await stubHttp.post(config.revocationUrl, _formEncode(body), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    const err = new Error(`[scrml:oauth] revocation failed: status ${res.status}`);
    err.name = "OAuthRevocationError";
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  return true;
}

// --- Test helpers ----------------------------------------------------------

function fakeConfig(overrides = {}) {
  return {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "https://app.example.com/callback",
    authorizeUrl: "https://provider.example.com/authorize",
    tokenUrl: "https://provider.example.com/token",
    userInfoUrl: "https://provider.example.com/userinfo",
    revocationUrl: "https://provider.example.com/revoke",
    scopes: ["openid", "email"],
    usePKCE: true,
    storage: memoryAdapter(),
    ...overrides,
  };
}

function parseQuery(url) {
  const i = url.indexOf("?");
  if (i < 0) return {};
  const out = {};
  for (const pair of url.slice(i + 1).split("&")) {
    const [k, v] = pair.split("=");
    out[decodeURIComponent(k)] = v === undefined ? "" : decodeURIComponent(v);
  }
  return out;
}

beforeEach(() => {
  httpCalls = [];
  nextHttpResponse = null;
});

// --- PKCE -------------------------------------------------------------------

describe("scrml:oauth — PKCE", () => {
  test("P1 verifier respects alphabet + default length 43", () => {
    const v = generateVerifier();
    expect(v).toHaveLength(43);
    for (const ch of v) expect(VERIFIER_ALPHABET.includes(ch)).toBe(true);
  });

  test("P1 verifier rejects out-of-bounds length", () => {
    expect(() => generateVerifier(42)).toThrow(/43-128/);
    expect(() => generateVerifier(129)).toThrow(/43-128/);
  });

  test("P1 verifier accepts boundary lengths 43 and 128", () => {
    expect(generateVerifier(43)).toHaveLength(43);
    expect(generateVerifier(128)).toHaveLength(128);
  });

  // RFC 7636 Appendix B test vector:
  //   verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  //   challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  test("P2 RFC 7636 Appendix B test vector — challenge matches", async () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const c = await deriveChallenge(v);
    expect(c).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("P3 challenge is base64url — no padding, no + or /", async () => {
    const v = generateVerifier(64);
    const c = await deriveChallenge(v);
    expect(c).not.toContain("=");
    expect(c).not.toContain("+");
    expect(c).not.toContain("/");
    // SHA-256 → 32 bytes → 43 base64url chars (without padding)
    expect(c).toHaveLength(43);
  });

  test("P3 deriveChallenge rejects too-short input", async () => {
    await expect(deriveChallenge("short")).rejects.toThrow(/length >= 43/);
  });
});

// --- memoryAdapter ----------------------------------------------------------

describe("scrml:oauth — memoryAdapter / OAuthStore (S462 enum tag)", () => {
  test("M1 memoryAdapter() is a Memory tag over a fresh Map — no stored functions", () => {
    const a = memoryAdapter();
    expect(a.variant).toBe("Memory");
    expect(a.data.entries).toBeInstanceOf(Map);
    expect(memoryAdapter().data.entries).not.toBe(a.data.entries); // independent
    for (const v of Object.values(a)) expect(typeof v).not.toBe("function");
  });

  test("M1 returns null for missing key", () => {
    expect(memGet(memoryAdapter(), "missing")).toBeNull();
  });

  test("M2 the tag constructors build the compiler's payload-variant shape", () => {
    expect(OAuthStore.Redis("redis://h:6379")).toEqual({ variant: "Redis", data: { url: "redis://h:6379" } });
    expect(OAuthStore.Redis(null)).toEqual({ variant: "Redis", data: { url: null } });
    expect(OAuthStore.variants).toEqual(["Memory", "Redis", "Store"]);
  });
});

// --- REAL shim storage dispatch (fetch stubbed) -----------------------------

describe("scrml:oauth — real shim drives each storage tag", () => {
  function realCfg(storage) {
    return {
      clientId: "cid", clientSecret: "sec",
      redirectUri: "https://app.test/cb",
      authorizeUrl: "https://p.test/authorize", tokenUrl: "https://p.test/token",
      scopes: ["openid"], usePKCE: true, storage,
    };
  }
  async function roundTrip(cfg, read) {
    const url = await realOauth.startFlow(cfg, "sess-r");
    const state = new URL(url).searchParams.get("state");
    expect(await read("scrml:oauth:state:sess-r")).toBe(state);
    expect(typeof (await read("scrml:oauth:verifier:sess-r"))).toBe("string");
    const realFetch = globalThis.fetch;
    let body = null;
    globalThis.fetch = async (u, init) => {
      body = init.body;
      return new Response(JSON.stringify({ access_token: "at", token_type: "Bearer", expires_in: 60 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    try {
      const tokens = await realOauth.exchangeCode(cfg, "sess-r", "the-code", state);
      expect(tokens.accessToken).toBe("at");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(String(body)).toContain("code_verifier=");
    // single-use: both entries cleared
    expect(await read("scrml:oauth:state:sess-r")).toBeNull();
    expect(await read("scrml:oauth:verifier:sess-r")).toBeNull();
  }

  test("R1 .Memory — startFlow persists, exchangeCode consumes", async () => {
    const storage = memoryAdapter();
    await roundTrip(realCfg(storage), async (k) => memGet(storage, k));
  });

  test("R2 .Store(kv) — state + verifier live in the scrml:store namespace", async () => {
    const kv = createStore(":memory:", "oauth");
    await roundTrip(realCfg(OAuthStore.Store(kv)), async (k) => kvGet(kv, k));
    kvClose(kv);
  });

  test("R3 a non-tag storage (the pre-S462 method object) is refused", async () => {
    const legacy = { put() {}, get() {}, del() {} };
    await expect(realOauth.startFlow(realCfg(legacy), "s")).rejects.toThrow(/OAuthStore value/);
  });
});

// --- assert helpers ---------------------------------------------------------

describe("scrml:oauth — config / storage assertions", () => {
  test("C1 missing fields throw with field name", () => {
    expect(() => _assertConfig(null)).toThrow(/config required/);
    expect(() => _assertConfig({})).toThrow(/clientId required/);
    expect(() => _assertConfig({ clientId: "x" })).toThrow(/redirectUri required/);
    expect(() => _assertConfig({ clientId: "x", redirectUri: "y" })).toThrow(/authorizeUrl required/);
    expect(() => _assertConfig({ clientId: "x", redirectUri: "y", authorizeUrl: "a" })).toThrow(/tokenUrl required/);
  });

  test("C2 storage that is not an OAuthStore tag throws", () => {
    expect(() => _assertStorage(null)).toThrow(/OAuthStore value/);
    expect(() => _assertStorage({})).toThrow(/OAuthStore value/);
    expect(() => _assertStorage({ put: () => {}, get: () => {}, del: () => {} })).toThrow(/OAuthStore value/);
    expect(() => _assertStorage({ variant: "Disk", data: {} })).toThrow(/OAuthStore value/);
    // Every tag passes
    _assertStorage(memoryAdapter());
    _assertStorage(OAuthStore.Redis(null));
    _assertStorage(OAuthStore.Store({}));
  });

  test("C3 public client (no secret) without PKCE rejected", () => {
    expect(() => _assertConfig({
      clientId: "x",
      redirectUri: "y",
      authorizeUrl: "a",
      tokenUrl: "t",
      usePKCE: false,
      storage: memoryAdapter(),
    })).toThrow(/MUST use PKCE/);
  });

  test("C3 public client with PKCE accepted", () => {
    _assertConfig({
      clientId: "x",
      redirectUri: "y",
      authorizeUrl: "a",
      tokenUrl: "t",
      usePKCE: true,
      storage: memoryAdapter(),
    });
  });
});

// --- startFlow --------------------------------------------------------------

describe("scrml:oauth — startFlow", () => {
  test("F1 writes state + verifier; returns URL with params", async () => {
    const cfg = fakeConfig();
    const url = await startFlow(cfg, "sess-1");
    expect(url.startsWith(cfg.authorizeUrl + "?")).toBe(true);

    const q = parseQuery(url);
    expect(q.response_type).toBe("code");
    expect(q.client_id).toBe(cfg.clientId);
    expect(q.redirect_uri).toBe(cfg.redirectUri);
    expect(q.scope).toBe("openid email");
    expect(q.state).toBeDefined();
    expect(q.code_challenge).toBeDefined();
    expect(q.code_challenge_method).toBe("S256");

    // Storage holds matching state + verifier under sessionKey
    expect(memGet(cfg.storage, "scrml:oauth:state:sess-1")).toBe(q.state);
    expect(typeof memGet(cfg.storage, "scrml:oauth:verifier:sess-1")).toBe("string");
  });

  test("F2 usePKCE=false skips verifier", async () => {
    const cfg = fakeConfig({ usePKCE: false });
    const url = await startFlow(cfg, "sess-x");
    const q = parseQuery(url);
    expect(q.code_challenge).toBeUndefined();
    expect(q.code_challenge_method).toBeUndefined();
    expect(memGet(cfg.storage, "scrml:oauth:verifier:sess-x")).toBeNull();
  });

  test("F3 extraAuthParams appended verbatim", async () => {
    const cfg = fakeConfig({ extraAuthParams: { access_type: "offline", prompt: "consent" } });
    const url = await startFlow(cfg, "sess-extra");
    const q = parseQuery(url);
    expect(q.access_type).toBe("offline");
    expect(q.prompt).toBe("consent");
  });

  test("F1 sessionKey required", async () => {
    const cfg = fakeConfig();
    await expect(startFlow(cfg, "")).rejects.toThrow(/sessionKey/);
    await expect(startFlow(cfg, null)).rejects.toThrow(/sessionKey/);
  });
});

// --- exchangeCode -----------------------------------------------------------

describe("scrml:oauth — exchangeCode", () => {
  test("F4 happy path: state + verifier consumed, tokens parsed", async () => {
    const cfg = fakeConfig();
    const url = await startFlow(cfg, "sess-4");
    const stateInUrl = parseQuery(url).state;

    nextHttpResponse = makeResp(true, 200, {
      access_token: "AT-1",
      refresh_token: "RT-1",
      id_token: "ID-1",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email",
    });
    const tokens = await exchangeCode(cfg, "sess-4", "auth-code-xyz", stateInUrl);

    expect(tokens.accessToken).toBe("AT-1");
    expect(tokens.refreshToken).toBe("RT-1");
    expect(tokens.idToken).toBe("ID-1");
    expect(tokens.tokenType).toBe("Bearer");
    expect(tokens.expiresIn).toBe(3600);
    expect(typeof tokens.expiresAt).toBe("number");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    // State + verifier are single-use; storage cleared.
    expect(memGet(cfg.storage, "scrml:oauth:state:sess-4")).toBeNull();
    expect(memGet(cfg.storage, "scrml:oauth:verifier:sess-4")).toBeNull();

    // The POST went to the token URL with the right body.
    const post = httpCalls.find(c => c.method === "POST");
    expect(post.url).toBe(cfg.tokenUrl);
    expect(post.body).toContain("grant_type=authorization_code");
    expect(post.body).toContain("code=auth-code-xyz");
    expect(post.body).toContain("client_id=" + cfg.clientId);
    expect(post.body).toContain("client_secret=" + cfg.clientSecret);
    expect(post.body).toContain("code_verifier=");
    expect(post.options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  test("F5 state mismatch throws OAuthStateMismatch and clears storage", async () => {
    const cfg = fakeConfig();
    await startFlow(cfg, "sess-5");
    let caught;
    try {
      await exchangeCode(cfg, "sess-5", "code", "WRONG-STATE");
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.name).toBe("OAuthStateMismatch");
    // Both state and verifier purged.
    expect(memGet(cfg.storage, "scrml:oauth:state:sess-5")).toBeNull();
    expect(memGet(cfg.storage, "scrml:oauth:verifier:sess-5")).toBeNull();
  });

  test("F6 missing verifier throws OAuthVerifierMissing", async () => {
    const cfg = fakeConfig();
    const url = await startFlow(cfg, "sess-6");
    const state = parseQuery(url).state;
    // Manually delete the verifier to simulate expiry.
    cfg.storage.data.entries.delete("scrml:oauth:verifier:sess-6");
    let caught;
    try { await exchangeCode(cfg, "sess-6", "code", state); }
    catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.name).toBe("OAuthVerifierMissing");
  });

  test("F7 token endpoint error throws OAuthTokenError with status + body", async () => {
    const cfg = fakeConfig();
    const url = await startFlow(cfg, "sess-7");
    const state = parseQuery(url).state;
    nextHttpResponse = makeResp(false, 400, {
      error: "invalid_grant",
      error_description: "code expired",
    });
    let caught;
    try { await exchangeCode(cfg, "sess-7", "code", state); }
    catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.name).toBe("OAuthTokenError");
    expect(caught.status).toBe(400);
    expect(caught.body.error).toBe("invalid_grant");
    expect(caught.message).toContain("invalid_grant");
    expect(caught.message).toContain("code expired");
  });

  test("F4 missing code/state args throw before any storage access", async () => {
    const cfg = fakeConfig();
    await expect(exchangeCode(cfg, "s", "", "x")).rejects.toThrow(/code required/);
    await expect(exchangeCode(cfg, "s", "c", "")).rejects.toThrow(/state required/);
  });
});

// --- refreshToken -----------------------------------------------------------

describe("scrml:oauth — refreshToken", () => {
  test("F8 POSTs grant_type=refresh_token with the token", async () => {
    const cfg = fakeConfig();
    nextHttpResponse = makeResp(true, 200, {
      access_token: "AT-2",
      token_type: "Bearer",
      expires_in: 1800,
    });
    const t = await refreshToken(cfg, "RT-existing");
    expect(t.accessToken).toBe("AT-2");
    expect(t.expiresIn).toBe(1800);

    const post = httpCalls[0];
    expect(post.method).toBe("POST");
    expect(post.url).toBe(cfg.tokenUrl);
    expect(post.body).toContain("grant_type=refresh_token");
    expect(post.body).toContain("refresh_token=RT-existing");
    expect(post.body).toContain("client_id=" + cfg.clientId);
  });

  test("F8 missing refresh token rejects", async () => {
    const cfg = fakeConfig();
    await expect(refreshToken(cfg, "")).rejects.toThrow(/refresh token/);
  });

  test("F8 string expires_in is parsed to number", async () => {
    const cfg = fakeConfig();
    nextHttpResponse = makeResp(true, 200, { access_token: "x", expires_in: "900" });
    const t = await refreshToken(cfg, "rt");
    expect(t.expiresIn).toBe(900);
  });
});

// --- getUserInfo ------------------------------------------------------------

describe("scrml:oauth — getUserInfo", () => {
  test("F9 sends Bearer header to userinfo URL", async () => {
    const cfg = fakeConfig();
    nextHttpResponse = makeResp(true, 200, { sub: "u-1", email: "alice@example.com" });
    const u = await getUserInfo(cfg, "AT-here");
    expect(u.sub).toBe("u-1");
    const get = httpCalls[0];
    expect(get.method).toBe("GET");
    expect(get.url).toBe(cfg.userInfoUrl);
    expect(get.options.headers.Authorization).toBe("Bearer AT-here");
  });

  test("F10 non-2xx throws OAuthUserInfoError with status + body", async () => {
    const cfg = fakeConfig();
    nextHttpResponse = makeResp(false, 401, { error: "invalid_token" });
    let caught;
    try { await getUserInfo(cfg, "bad"); } catch (e) { caught = e; }
    expect(caught.name).toBe("OAuthUserInfoError");
    expect(caught.status).toBe(401);
    expect(caught.body.error).toBe("invalid_token");
  });

  test("F9 missing userInfoUrl on config throws", async () => {
    const cfg = fakeConfig({ userInfoUrl: undefined });
    await expect(getUserInfo(cfg, "AT")).rejects.toThrow(/userInfoUrl/);
  });

  test("F9 missing accessToken throws", async () => {
    const cfg = fakeConfig();
    await expect(getUserInfo(cfg, "")).rejects.toThrow(/accessToken/);
  });
});

// --- revoke -----------------------------------------------------------------

describe("scrml:oauth — revoke", () => {
  test("F11 POSTs to revocationUrl; returns true on success", async () => {
    const cfg = fakeConfig();
    nextHttpResponse = makeResp(true, 200, {});
    const ok = await revoke(cfg, "RT-123", "refresh_token");
    expect(ok).toBe(true);
    const post = httpCalls[0];
    expect(post.url).toBe(cfg.revocationUrl);
    expect(post.body).toContain("token=RT-123");
    expect(post.body).toContain("token_type_hint=refresh_token");
    expect(post.body).toContain("client_id=" + cfg.clientId);
  });

  test("F11 non-2xx throws OAuthRevocationError", async () => {
    const cfg = fakeConfig();
    nextHttpResponse = makeResp(false, 503, { error: "server" });
    let caught;
    try { await revoke(cfg, "T"); } catch (e) { caught = e; }
    expect(caught.name).toBe("OAuthRevocationError");
    expect(caught.status).toBe(503);
  });

  test("F12 no revocationUrl throws clear error", async () => {
    const cfg = fakeConfig({ revocationUrl: null });
    await expect(revoke(cfg, "T")).rejects.toThrow(/revocationUrl not set/);
  });

  test("F11 missing token rejects", async () => {
    const cfg = fakeConfig();
    await expect(revoke(cfg, "")).rejects.toThrow(/token required/);
  });
});

// --- internals --------------------------------------------------------------

describe("scrml:oauth — internals", () => {
  test("E1 _buildUrl preserves existing query string", () => {
    const out = _buildUrl("https://x.example/auth?already=1", { a: "b" });
    expect(out).toBe("https://x.example/auth?already=1&a=b");
  });

  test("E1 _buildUrl no params returns base", () => {
    expect(_buildUrl("https://x", {})).toBe("https://x");
    expect(_buildUrl("https://x", { skip: undefined, also: null, blank: "" })).toBe("https://x");
  });

  test("E2 _formEncode skips null/undefined and encodes specials", () => {
    const s = _formEncode({ a: "b c", b: null, c: undefined, d: "x&y=z", e: "" });
    // Order matches Object.entries order:
    // a=b%20c, e is "" (kept; not null/undefined), d=x%26y%3Dz
    const parts = s.split("&").sort();
    expect(parts).toContain("a=b%20c");
    expect(parts).toContain("d=x%26y%3Dz");
    expect(parts).toContain("e=");
    expect(s).not.toContain("b=");
    expect(s).not.toContain("c=");
  });

  test("E2 _formEncode handles empty / null input", () => {
    expect(_formEncode(null)).toBe("");
    expect(_formEncode({})).toBe("");
  });
});
