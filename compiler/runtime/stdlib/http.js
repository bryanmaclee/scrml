// scrml:http — runtime shim
//
// Hand-written ES module mirroring stdlib/http/index.scrml. Typed fetch
// wrapper with timeout, retry, and response normalization.
//
// All request functions return a normalized response object:
//   { ok, status, data, headers, raw }
//     ok     — true if status is 2xx
//     data   — parsed JSON if Content-Type is application/json, else string
//     raw    — the original Response
//
// HTTP 4xx/5xx does NOT throw — callers check ok. Only network failures /
// timeouts throw.
//
// Surface (must match stdlib/http/index.scrml exports):
//   - get(url, options?)            | get(client, path, options?)
//   - post(url, body, options?)      | post(client, path, body, options?)
//   - put(url, body, options?)       | put(client, path, body, options?)
//   - del(url, options?)             | del(client, path, options?)
//   - patch(url, body, options?)     | patch(client, path, body, options?)
//   - withBaseUrl(baseUrl, wrapped?)        → HttpClient (config struct)
//   - isOk(response)
//   - isError(response)
//   - withAuth(token, scheme?, wrapped?)    → HttpClient
//   - withDefaults(defaults, wrapped?)      → HttpClient
//   - retry(fn, opts?, shouldRetry?)
//   - multipart(fields)            → FormData
//   - uploadFile(url, file, opts?)

// De-leak the retry-jitter through the sanctioned non-deterministic source
// (scrml:random) — the one place http reads host entropy (§41.20).
import { random } from "./random.js";

async function _request(url, options) {
  const opts = options || {};
  const timeout = opts.timeout !== null && opts.timeout !== undefined ? opts.timeout : 10000;
  const retryCount = opts.retry || 0;
  const retryDelay = opts.retryDelay !== null && opts.retryDelay !== undefined ? opts.retryDelay : 1000;
  const extraHeaders = opts.headers || {};

  const fetchOptions = {
    method: opts.method || "GET",
    headers: {},
  };
  for (const [k, v] of Object.entries(extraHeaders)) {
    fetchOptions.headers[k] = v;
  }
  if (opts.body !== null && opts.body !== undefined) {
    if (typeof opts.body === "string") {
      fetchOptions.body = opts.body;
    } else if (opts.body instanceof FormData) {
      fetchOptions.body = opts.body;
      // Let fetch set the Content-Type with boundary automatically.
    } else {
      fetchOptions.body = JSON.stringify(opts.body);
      if (!fetchOptions.headers["Content-Type"] && !fetchOptions.headers["content-type"]) {
        fetchOptions.headers["Content-Type"] = "application/json";
      }
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
    let timeoutId = null;
    try {
      const controller = new AbortController();
      fetchOptions.signal = controller.signal;
      if (timeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), timeout);
      }
      const raw = await fetch(url, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);
      const contentType = raw.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) {
        data = await raw.json();
      } else {
        data = await raw.text();
      }
      return { ok: raw.ok, status: raw.status, data, headers: raw.headers, raw };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err && err.name === "AbortError") {
        throw new Error(`[scrml:http] Request timed out after ${timeout}ms: ${url}`);
      }
      lastError = err;
      if (attempt === retryCount) throw lastError;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Clients (S462) — an HttpClient is a plain config STRUCT, never an object of
// functions (a function is not stored in a value, SPEC §14.3):
//   { baseUrl: string, defaults: options, authorization: string | null }
// The request functions take either a URL or a client as their first argument.
// ---------------------------------------------------------------------------

const _NO_CLIENT = Object.freeze({ baseUrl: "", defaults: {}, authorization: null });

// A client is the non-string target that carries `defaults`. A URL string (or
// a URL object, which has no `defaults`) is a URL.
function _isClient(target) {
  return target !== null && target !== undefined && typeof target !== "string"
    && target.defaults !== null && target.defaults !== undefined;
}

// Resolve a path against the client's base URL. Absolute URLs pass through.
function _clientUrl(client, path) {
  if (!client.baseUrl) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = client.baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  return base + p;
}

// Merge two option objects: `over` wins key by key; headers merge by key.
function _mergeOptions(under, over) {
  const u = under || {};
  const o = over || {};
  const merged = Object.assign({}, u, o);
  if (u.headers || o.headers) {
    merged.headers = Object.assign({}, u.headers || {}, o.headers || {});
  }
  return merged;
}

// The options a client contributes to one call: its defaults under the call's
// own options, then its Authorization header over both.
function _clientOptions(client, options) {
  const merged = _mergeOptions(client.defaults, options);
  if (client.authorization !== null && client.authorization !== undefined) {
    merged.headers = Object.assign({}, merged.headers || {}, { Authorization: client.authorization });
  }
  return merged;
}

// get(url, options?) | get(client, path, options?)
export async function get(target, pathOrOptions, options) {
  if (_isClient(target)) {
    return _request(_clientUrl(target, pathOrOptions), { ..._clientOptions(target, options), method: "GET" });
  }
  return _request(target, { ...pathOrOptions, method: "GET" });
}

// post(url, body, options?) | post(client, path, body, options?)
export async function post(target, a, b, c) {
  if (_isClient(target)) {
    return _request(_clientUrl(target, a), { ..._clientOptions(target, c), method: "POST", body: b });
  }
  return _request(target, { ...b, method: "POST", body: a });
}

// put(url, body, options?) | put(client, path, body, options?)
export async function put(target, a, b, c) {
  if (_isClient(target)) {
    return _request(_clientUrl(target, a), { ..._clientOptions(target, c), method: "PUT", body: b });
  }
  return _request(target, { ...b, method: "PUT", body: a });
}

// del(url, options?) | del(client, path, options?)
export async function del(target, pathOrOptions, options) {
  if (_isClient(target)) {
    return _request(_clientUrl(target, pathOrOptions), { ..._clientOptions(target, options), method: "DELETE" });
  }
  return _request(target, { ...pathOrOptions, method: "DELETE" });
}

// patch(url, body, options?) | patch(client, path, body, options?)
export async function patch(target, a, b, c) {
  if (_isClient(target)) {
    return _request(_clientUrl(target, a), { ..._clientOptions(target, c), method: "PATCH", body: b });
  }
  return _request(target, { ...b, method: "PATCH", body: a });
}

export function withBaseUrl(baseUrl, wrapped) {
  const base = wrapped || _NO_CLIENT;
  return { baseUrl, defaults: base.defaults, authorization: base.authorization };
}

export function isOk(response) {
  return response && response.ok === true;
}

export function isError(response) {
  return response && response.status >= 400;
}

// The outermost withAuth wins: wrapping a client that already carries an
// Authorization value replaces it.
export function withAuth(token, scheme, wrapped) {
  const sch = scheme || "Bearer";
  const base = wrapped || _NO_CLIENT;
  return { baseUrl: base.baseUrl, defaults: base.defaults, authorization: `${sch} ${token}` };
}

// Defaults merge OVER the wrapped client's defaults (headers by key).
export function withDefaults(defaults, wrapped) {
  const base = wrapped || _NO_CLIENT;
  return {
    baseUrl: base.baseUrl,
    defaults: _mergeOptions(base.defaults, defaults),
    authorization: base.authorization,
  };
}

// retry(fn, opts?, shouldRetry?) — `opts` is data only; the predicate is a
// positional argument (S462: a function is passed, never stored in a value).
// A legacy `opts.shouldRetry` is refused loudly rather than silently ignored.
export async function retry(fn, opts, shouldRetry) {
  const o = opts || {};
  if (o.shouldRetry !== null && o.shouldRetry !== undefined) {
    throw new Error("[scrml:http] retry: shouldRetry is the third argument — retry(fn, opts, shouldRetry) — not an opts field");
  }
  const maxRetries = o.maxRetries !== null && o.maxRetries !== undefined ? o.maxRetries : 3;
  const baseDelay = o.baseDelay !== null && o.baseDelay !== undefined ? o.baseDelay : 200;
  const factor = o.factor !== null && o.factor !== undefined ? o.factor : 2;
  const jitter = o.jitter !== null && o.jitter !== undefined ? o.jitter : 0.2;

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      if (typeof shouldRetry === "function" && !shouldRetry(err)) break;
      const base = baseDelay * Math.pow(factor, attempt);
      const jitterAmt = base * jitter * (random() * 2 - 1);
      const delay = Math.max(0, base + jitterAmt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function multipart(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === null || v === undefined) continue;
    if (typeof Blob !== "undefined" && (v instanceof Blob || (typeof File !== "undefined" && v instanceof File))) {
      fd.append(k, v);
    } else {
      fd.append(k, String(v));
    }
  }
  return fd;
}

export async function uploadFile(url, file, opts) {
  const o = opts || {};
  const fieldName = o.fieldName || "file";
  const extras = o.extraFields || {};
  const fields = Object.assign({}, extras, { [fieldName]: file });
  const body = multipart(fields);
  const requestOpts = Object.assign({}, o, { body, fieldName: null, extraFields: null });
  return await _request(url, Object.assign({ method: "POST" }, requestOpts));
}
