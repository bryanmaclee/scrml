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
//   - get(url, options?)
//   - post(url, body, options?)
//   - put(url, body, options?)
//   - del(url, options?)
//   - patch(url, body, options?)
//   - withBaseUrl(baseUrl)         — factory client
//   - isOk(response)
//   - isError(response)
//   - withAuth(token, scheme?, wrapped?)
//   - withDefaults(defaults, wrapped?)
//   - retry(fn, opts?)
//   - multipart(fields)            → FormData
//   - uploadFile(url, file, opts?)

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

export async function get(url, options) {
  return _request(url, { ...options, method: "GET" });
}

export async function post(url, body, options) {
  return _request(url, { ...options, method: "POST", body });
}

export async function put(url, body, options) {
  return _request(url, { ...options, method: "PUT", body });
}

export async function del(url, options) {
  return _request(url, { ...options, method: "DELETE" });
}

export async function patch(url, body, options) {
  return _request(url, { ...options, method: "PATCH", body });
}

export function withBaseUrl(baseUrl) {
  function resolveUrl(path) {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    const base = baseUrl.replace(/\/$/, "");
    const p = path.startsWith("/") ? path : "/" + path;
    return base + p;
  }
  return {
    get: (path, opts) => get(resolveUrl(path), opts),
    post: (path, body, opts) => post(resolveUrl(path), body, opts),
    put: (path, body, opts) => put(resolveUrl(path), body, opts),
    del: (path, opts) => del(resolveUrl(path), opts),
    patch: (path, body, opts) => patch(resolveUrl(path), body, opts),
  };
}

export function isOk(response) {
  return response && response.ok === true;
}

export function isError(response) {
  return response && response.status >= 400;
}

export function withAuth(token, scheme, wrapped) {
  const sch = scheme || "Bearer";
  const inner = wrapped || { get, post, put, del, patch };
  function mergeOpts(opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {}, { Authorization: `${sch} ${token}` });
    return Object.assign({}, o, { headers });
  }
  return {
    get: (url, opts) => inner.get(url, mergeOpts(opts)),
    post: (url, body, opts) => inner.post(url, body, mergeOpts(opts)),
    put: (url, body, opts) => inner.put(url, body, mergeOpts(opts)),
    del: (url, opts) => inner.del(url, mergeOpts(opts)),
    patch: (url, body, opts) => inner.patch(url, body, mergeOpts(opts)),
  };
}

export function withDefaults(defaults, wrapped) {
  const d = defaults || {};
  const inner = wrapped || { get, post, put, del, patch };
  function mergeOpts(opts) {
    const o = opts || {};
    const merged = Object.assign({}, d, o);
    if (d.headers || o.headers) {
      merged.headers = Object.assign({}, d.headers || {}, o.headers || {});
    }
    return merged;
  }
  return {
    get: (url, opts) => inner.get(url, mergeOpts(opts)),
    post: (url, body, opts) => inner.post(url, body, mergeOpts(opts)),
    put: (url, body, opts) => inner.put(url, body, mergeOpts(opts)),
    del: (url, opts) => inner.del(url, mergeOpts(opts)),
    patch: (url, body, opts) => inner.patch(url, body, mergeOpts(opts)),
  };
}

export async function retry(fn, opts) {
  const o = opts || {};
  const maxRetries = o.maxRetries !== null && o.maxRetries !== undefined ? o.maxRetries : 3;
  const baseDelay = o.baseDelay !== null && o.baseDelay !== undefined ? o.baseDelay : 200;
  const factor = o.factor !== null && o.factor !== undefined ? o.factor : 2;
  const jitter = o.jitter !== null && o.jitter !== undefined ? o.jitter : 0.2;
  const shouldRetry = o.shouldRetry || (() => true);

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      if (!shouldRetry(err)) break;
      const base = baseDelay * Math.pow(factor, attempt);
      const jitterAmt = base * jitter * (Math.random() * 2 - 1);
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
