// Where the API lives. On the deployed site that's api.mordraga.me; when
// this client is served from localhost it defaults to a local uvicorn.
// To point any page at a different server (e.g. a Railway URL) add
// `?api=https://your-service.up.railway.app` once - it's remembered in
// localStorage for that browser, and `?api=reset` clears it. Pages opened
// in *other* browsers (OBS, a contestant) don't share that storage, so the
// host page appends `?api=` to the links it hands out (see withApi).

const STORAGE_KEY = 'devils-advocate:api-root';
const PROD_ROOT = 'https://api.mordraga.me';
const LOCAL_ROOT = 'http://localhost:8000';

function resolveOverride() {
  const fromQuery = new URLSearchParams(location.search).get('api');
  try {
    if (fromQuery === 'reset') {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (fromQuery) {
      localStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked - the query param still works for this page load.
    return fromQuery && fromQuery !== 'reset' ? fromQuery : null;
  }
}

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const override = (resolveOverride() ?? '').replace(/\/+$/, '') || null;

export const API_ROOT = override ?? (isLocal ? LOCAL_ROOT : PROD_ROOT);
export const API_BASE = `${API_ROOT}/devils-advocate/v1`;
// http -> ws, https -> wss
export const WS_BASE = API_BASE.replace(/^http/, 'ws');

export function withApi(url) {
  if (!override) return url;
  return `${url}${url.includes('?') ? '&' : '?'}api=${encodeURIComponent(override)}`;
}
