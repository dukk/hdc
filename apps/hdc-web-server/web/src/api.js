const API = "/api";

/**
 * @param {string} path
 * @param {RequestInit} [opts]
 */
export async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json", ...(opts.headers || {}) } : opts.headers,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
