let csrfToken = null;

export function setCsrf(token) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const options = { method, headers, credentials: 'same-origin', signal };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = csrfToken || '';
  }

  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check that it is running.', 0, null);
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      document.dispatchEvent(new CustomEvent('auth:expired'));
    }
    const message = typeof data === 'object' && data?.error ? data.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data?.details || null);
  }
  return data;
}

export function downloadUrl(path) {
  return `/api${path}`;
}
