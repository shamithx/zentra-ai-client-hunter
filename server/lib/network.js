import os from 'node:os';
import { CONFIG } from '../config.js';

function rank(address) {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  if (address.startsWith('100.')) return 3;
  return 4;
}

export function lanAddresses() {
  const seen = new Set();
  const list = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (!entry.address || seen.has(entry.address) || entry.address.startsWith('169.254.')) continue;
      seen.add(entry.address);
      list.push({ name, address: entry.address, url: `http://${entry.address}:${CONFIG.port}` });
    }
  }
  return list.sort((a, b) => rank(a.address) - rank(b.address) || a.name.localeCompare(b.name));
}

export function remoteAccess() {
  const exposed = CONFIG.host === '0.0.0.0' || CONFIG.host === '::' || CONFIG.host === '';
  const loopback = CONFIG.host === '127.0.0.1' || CONFIG.host === 'localhost' || CONFIG.host === '::1';
  const localUrl = loopback || exposed
    ? `http://127.0.0.1:${CONFIG.port}`
    : `http://${CONFIG.host}:${CONFIG.port}`;
  const lanUrls = exposed
    ? lanAddresses()
    : loopback
      ? []
      : [{ name: 'HOST', address: CONFIG.host, url: `http://${CONFIG.host}:${CONFIG.port}` }];
  return {
    host: CONFIG.host,
    port: CONFIG.port,
    local_url: localUrl,
    lan_enabled: !loopback,
    lan_urls: lanUrls,
    secure_cookies: CONFIG.secureCookies,
  };
}
