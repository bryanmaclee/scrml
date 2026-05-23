// scrml:router — runtime shim
//
// Hand-written ES module mirroring stdlib/router/index.scrml.
//   Pure functions (server + client): match, parseQuery, buildUrl
//   Browser-only (require `window`): navigate, currentPath, onNavigate
//
// Surface (must match stdlib/router/index.scrml exports):
//   - match(pattern, path)              → { params, query } | null
//   - parseQuery(queryString)           → object
//   - buildUrl(pattern, params?, query?) → string
//   - navigate(url, options?)           — pushState / replaceState
//   - currentPath()                     → string
//   - onNavigate(pattern, handler)      → unsubscribe fn

export function match(pattern, path) {
  if (!path) return null;

  const qIdx = path.indexOf("?");
  const rawPath = qIdx >= 0 ? path.slice(0, qIdx) : path;
  const rawQuery = qIdx >= 0 ? path.slice(qIdx + 1) : "";
  const query = rawQuery ? parseQuery(rawQuery) : {};

  const normalized = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const segments = normalized.split("/");
  const keys = [];
  let regexStr = "^/";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0) regexStr += "/";

    if (seg === "*") {
      keys.push("*");
      regexStr += "(.*)";
    } else if (seg.startsWith(":")) {
      const optional = seg.endsWith("?");
      const name = optional ? seg.slice(1, -1) : seg.slice(1);
      keys.push(name);
      if (optional) {
        // Remove the "/" we just added, wrap entire segment as optional.
        regexStr = regexStr.slice(0, -1);
        regexStr += "(?:/([^/]+))?";
      } else {
        regexStr += "([^/]+)";
      }
    } else {
      regexStr += seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "/?$";

  const regex = new RegExp(regexStr);
  const m = rawPath.match(regex);
  if (!m) return null;

  const params = {};
  keys.forEach((key, idx) => {
    if (m[idx + 1] !== undefined && m[idx + 1] !== null) {
      params[key] = m[idx + 1];
    }
  });

  return { params, query };
}

export function parseQuery(queryString) {
  if (!queryString) return {};
  const qs = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  if (!qs) return {};
  const result = {};
  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      result[decodeURIComponent(pair)] = "";
    } else {
      const key = decodeURIComponent(pair.slice(0, eqIdx));
      const val = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, " "));
      result[key] = val;
    }
  }
  return result;
}

export function buildUrl(pattern, params, query) {
  let url = pattern;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}?`, encodeURIComponent(String(value)));
      url = url.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }
  url = url.replace(/\/:[a-zA-Z][a-zA-Z0-9]*\?/g, "");

  if (query && Object.keys(query).length > 0) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += "?" + qs;
  }
  return url;
}

export function navigate(url, options) {
  const replace = options && options.replace;
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
}

export function currentPath() {
  return window.location.pathname;
}

export function onNavigate(pattern, handler) {
  function handlePopState() {
    const path = window.location.pathname + window.location.search;
    handler(window.location.pathname, match(pattern, path));
  }
  window.addEventListener("popstate", handlePopState);
  handlePopState();
  return function () {
    window.removeEventListener("popstate", handlePopState);
  };
}
