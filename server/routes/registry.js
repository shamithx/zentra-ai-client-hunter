export const routes = [];

export function add(method, pattern, handler) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ method, parts, handler });
}

export function matchRoute(method, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.parts.length; i += 1) {
      const part = route.parts[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
      } else if (part !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}
