/* ReelKeep SSRF defense — every server-side fetch of a user-supplied URL goes
   through validateUrl(): http(s) only, DNS resolved, private/loopback/link-local/
   CGNAT/multicast/metadata ranges blocked (IPv4 + IPv6 + mapped), and the
   connection pinned to the validated IP (see safefetch.js). */
'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const httpError = (status, message) => Object.assign(new Error(message), { status });

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (test-net)
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51) return true; // 198.51.100.0/24 (test-net)
    if (a === 203 && b === 0) return true; // 203.0.113.0/24 (test-net)
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true; // loopback, unspecified
    if (/^fe[89ab]/.test(s)) return true; // link-local
    if (/^f[cd]/.test(s)) return true; // unique-local
    if (/^ff/.test(s)) return true; // multicast
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (dotted) return isBlockedIp(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  return true; // unparseable: block
}

/**
 * Returns { u, ip } for a safe target or throws {status:400|403|502}.
 * `resolve` is injectable for tests.
 */
async function validateUrl(target, { resolve = dns.lookup } = {}) {
  let u;
  try {
    u = new URL(target);
  } catch {
    throw httpError(400, 'need an http(s) url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError(400, 'only http and https are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw httpError(403, 'that address is not reachable from here');
    return { u, ip: host };
  }
  if (!host || host === 'localhost' || /\.localhost$|\.local$|\.internal$|\.home$|\.lan$/i.test(host)) {
    throw httpError(403, 'that address is not reachable from here');
  }
  let addrs;
  try {
    addrs = await resolve(host, { all: true, verbatim: true });
  } catch {
    throw httpError(502, 'cannot resolve that host');
  }
  if (!addrs?.length) throw httpError(502, 'cannot resolve that host');
  for (const a of addrs) if (isBlockedIp(a.address)) throw httpError(403, 'that address is not reachable from here');
  return { u, ip: addrs[0].address };
}

module.exports = { isBlockedIp, validateUrl, httpError };
