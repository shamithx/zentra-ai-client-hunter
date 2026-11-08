import http from 'node:http';
import { CONFIG } from './config.js';
import { db } from './db.js';
import {
  checkPassword, checkPasswordStrength, clearCookie, createSession, destroyAllSessions,
  destroySession, getSession, hasPassword, loginThrottle, purgeExpiredSessions, sameOrigin,
  setPassword, verifyCsrf,
} from './auth.js';
import { HttpError, getClientIp, readJson, securityHeaders, sendError, sendJson, serveStatic } from './lib/http.js';
import { add, matchRoute } from './routes/registry.js';
import { aiStatus } from './ai/llm.js';
import { text } from './lib/validate.js';
import { remoteAccess } from './lib/network.js';
import './routes/leads.js';
import './routes/discovery.js';
import './routes/settings.js';

const PUBLIC_PATHS = new Set(['/health', '/auth/me', '/auth/setup', '/auth/login']);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

add('GET', '/health', async () => ({
  body: {
    ok: true,
    version: CONFIG.version,
    ai_ready: aiStatus().ready,
    uptime_seconds: Math.round(process.uptime()),
  },
}));

add('GET', '/auth/me', async ({ session }) => ({
  body: {
    authenticated: Boolean(session),
    needsSetup: !hasPassword(),
    csrf: session?.csrf || null,
    version: CONFIG.version,
  },
}));

add('POST', '/auth/setup', async ({ req, body }) => {
  if (hasPassword()) throw new HttpError(409, 'A dashboard password already exists');
  const password = text(body.password, 200, 'Password');
  const problem = checkPasswordStrength(password);
  if (problem) throw new HttpError(400, problem);
  setPassword(password);
  const session = createSession(req);
  return {
    body: { authenticated: true, needsSetup: false, csrf: session.csrf },
    cookies: [session.cookie],
  };
});

add('POST', '/auth/login', async ({ req, body, url }) => {
  if (!hasPassword()) throw new HttpError(409, 'Dashboard password is not set up yet');
  const ip = getClientIp(req);
  const throttle = loginThrottle(ip);
  if (throttle.blocked) {
    throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(throttle.retryAfter / 60)} minutes.`);
  }
  const password = text(body.password, 200, 'Password');
  if (!checkPassword(password)) {
    throttle.fail();
    throw new HttpError(401, 'Incorrect password');
  }
  throttle.reset();
  const session = createSession(req);
  return {
    body: { authenticated: true, needsSetup: false, csrf: session.csrf },
    cookies: [session.cookie],
  };
});

add('POST', '/auth/logout', async ({ req }) => {
  destroySession(req);
  return { body: { ok: true }, cookies: [clearCookie()] };
});

add('POST', '/auth/password', async ({ req, body }) => {
  const current = text(body.current, 200, 'Current password');
  const next = text(body.next, 200, 'New password');
  if (!checkPassword(current)) throw new HttpError(401, 'Current password is incorrect');
  const problem = checkPasswordStrength(next);
  if (problem) throw new HttpError(400, problem);
  if (current === next) throw new HttpError(400, 'New password must be different');
  setPassword(next);
  destroyAllSessions();
  const session = createSession(req);
  return {
    body: { ok: true, csrf: session.csrf },
    cookies: [session.cookie],
  };
});

async function handleApi(req, res, url) {
  let pathname = url.pathname.slice(4) || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  const session = getSession(req);
  const isPublic = PUBLIC_PATHS.has(pathname);

  let body = {};
  if (MUTATING.has(req.method)) {
    if (!sameOrigin(req)) throw new HttpError(403, 'Cross-origin request blocked');
    body = await readJson(req, 6 * 1024 * 1024);
  }

  if (!isPublic && !session) throw new HttpError(401, 'Sign in required');
  if (MUTATING.has(req.method) && !isPublic && !verifyCsrf(req, session)) {
    throw new HttpError(403, 'Session expired or CSRF token missing. Refresh the page and try again.');
  }

  const match = matchRoute(req.method, pathname);
  if (!match) throw new HttpError(404, 'API route not found');

  const result = await match.handler({
    req,
    res,
    url,
    pathname,
    params: match.params,
    query: url.searchParams,
    body,
    session,
  });
  if (!result) return;
  if (result.cookies) res.setHeader('Set-Cookie', result.cookies);
  sendJson(res, result.status || 200, result.body ?? {});
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendError(res, 400, 'Bad request');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendError(res, err.status, err.message, err.details);
      } else {
        console.error('[api]', err);
        sendError(res, 500, 'Something went wrong on the server');
      }
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method not allowed');
    return;
  }
  serveStatic(req, res, url.pathname);

  if (process.env.LOG_REQUESTS === 'true') {
    res.on('finish', () => {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });
  }
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60_000).unref();

server.listen(CONFIG.port, CONFIG.host, () => {
  const access = remoteAccess();
  console.log(`\n  ZENTRA Hunter v${CONFIG.version}`);
  console.log(`  Local:  ${access.local_url}`);
  if (!access.lan_enabled) {
    console.log('  LAN:    off — set HOST=0.0.0.0 in .env to allow phones on this WiFi');
  } else if (access.lan_urls.length) {
    const [primary, ...others] = access.lan_urls;
    console.log(`  LAN:    ${primary.url}  (${primary.name})`);
    for (const item of others) console.log(`          ${item.url}  (${item.name})`);
    console.log('  Phone:  open the LAN URL on the same WiFi, or use a tunnel for access anywhere');
  } else {
    console.log('  LAN:    no network address found — connect to WiFi or Ethernet, then restart');
  }
  console.log(`  Data:   ${CONFIG.dbFile}`);
  if (!hasPassword()) {
    console.log('  First run: open the dashboard to create your password.\n');
    if (access.lan_enabled) {
      console.warn('  WARNING: reachable by other devices on your network before a password is set.\n');
    }
  } else {
    console.log('');
  }
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
