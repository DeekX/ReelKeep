/* ReelKeep safe fetch — connects to the DNS-validated IP (no rebinding window),
   re-validates every redirect hop, caps redirects and timeouts. Returns a
   standard Response plus the final URL, so callers keep using fetch ergonomics. */
'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Readable } = require('node:stream');
const { validateUrl, httpError } = require('./ssrf');

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** dns.lookup-shaped callback pinned to a validated IP. Node 20+ happy-eyeballs
    asks with {all:true} and expects an array; older paths expect (ip, family). */
function pinnedLookup(ip) {
  return (_hostname, options, cb) => {
    const family = net.isIPv6(ip) ? 6 : 4;
    if (options && options.all) cb(null, [{ address: ip, family }]);
    else cb(null, ip, family);
  };
}

async function safeFetch(target, { headers = {}, maxRedirects = 5, timeoutMs = 12000, signal, method = 'GET' } = {}) {
  let current = target;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { u, ip } = await validateUrl(current);
    const mod = u.protocol === 'https:' ? https : http;
    const msg = await new Promise((resolve, reject) => {
      const req = mod.request(
        u,
        {
          method,
          headers: { ...headers, Host: u.host },
          // pin the connection to the address we validated; SNI/Host stay the hostname
          lookup: pinnedLookup(ip),
          timeout: timeoutMs,
        },
        resolve,
      );
      req.on('timeout', () => req.destroy(httpError(504, 'upstream timed out')));
      req.on('error', reject);
      if (signal) {
        if (signal.aborted) req.destroy(httpError(504, 'aborted'));
        else signal.addEventListener('abort', () => req.destroy(httpError(504, 'aborted')), { once: true });
      }
      req.end();
    });
    if (REDIRECTS.has(msg.statusCode) && msg.headers.location) {
      msg.resume(); // drain before following
      let next;
      try {
        next = new URL(msg.headers.location, current).href;
      } catch {
        throw httpError(502, 'bad redirect from upstream');
      }
      current = next;
      continue;
    }
    const res = new Response(Readable.toWeb(msg), { status: msg.statusCode, headers: msg.headers });
    return { res, finalUrl: current };
  }
  throw httpError(502, 'too many redirects');
}

module.exports = { safeFetch, pinnedLookup };
