/* ReelKeep optional password auth — zero deps.
   Constant-time password comparison, HMAC-signed HttpOnly SameSite=Strict
   session cookie, per-IP login rate limiting. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'rk_session';
const MAX_AGE = 30 * 24 * 3600; // 30 days
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 8;

function createAuth({ password, dataDir }) {
  const required = !!password;
  const keyFile = path.join(dataDir, 'session.key');
  let secret;
  try {
    secret = fs.readFileSync(keyFile);
  } catch {
    secret = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, secret, { mode: 0o600 });
  }
  const expected = password ? crypto.createHash('sha256').update(String(password)).digest() : null;
  const fails = new Map();

  const sign = (v) => crypto.createHmac('sha256', secret).update(v).digest('hex');

  function makeCookie() {
    const val = `s.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
    return `${val}.${sign(val)}`;
  }

  function checkCookie(header) {
    if (!required) return true;
    const m = /(?:^|;\s*)rk_session=([^;]+)/.exec(header || '');
    if (!m) return false;
    const raw = decodeURIComponent(m[1]);
    const i = raw.lastIndexOf('.');
    if (i < 0) return false;
    const val = raw.slice(0, i);
    const mac = raw.slice(i + 1);
    const want = sign(val);
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const ts = Number(val.split('.')[1]);
    return Number.isFinite(ts) && Date.now() - ts < MAX_AGE * 1000;
  }

  function checkPassword(pw) {
    if (!expected) return false;
    const got = crypto.createHash('sha256').update(String(pw ?? '')).digest();
    return crypto.timingSafeEqual(got, expected);
  }

  function rateLimited(ip) {
    const e = fails.get(ip);
    if (!e) return false;
    if (Date.now() > e.resetAt) {
      fails.delete(ip);
      return false;
    }
    return e.count >= MAX_FAILS;
  }
  function noteFailure(ip) {
    const e = fails.get(ip) || { count: 0, resetAt: Date.now() + WINDOW };
    e.count++;
    fails.set(ip, e);
  }
  function clearFailures(ip) {
    fails.delete(ip);
  }

  const cookieHeader = (value, maxAge = MAX_AGE) =>
    `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

  return { required, checkCookie, checkPassword, makeCookie, rateLimited, noteFailure, clearFailures, cookieHeader, COOKIE };
}

const isLoopback = (host) => host === 'localhost' || host === '::1' || /^127\./.test(host);

module.exports = { createAuth, isLoopback };
