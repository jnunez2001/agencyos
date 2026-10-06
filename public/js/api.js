// Joshua Nunez
let csrf = '';

export const setCsrf = (token) => { csrf = token || ''; };

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
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status, code: data && data.code });
  return data;
}
