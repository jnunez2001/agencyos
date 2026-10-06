// Joshua Nunez
let csrf = '';

export const setCsrf = (token) => { csrf = token || ''; };

// What a person reads when a request fails. The server's own plain message wins; a reply without one (a proxy's error
// page, an empty body) never shows a status code or raw text.
function friendly(status, data) {
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  if (status === 404) return 'That could not be found.';
  if (status === 403) return 'You are not allowed to do that.';
  return 'That did not work. Try again.';
}

export async function api(method, url, body) {
  const headers = { 'content-type': 'application/json' };
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  let res;
  try {
    res = await fetch('/api' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw Object.assign(new Error('You are offline. Try again when you are connected.'), { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error(friendly(res.status, data)), { status: res.status, code: data && data.code });
  return data;
}
