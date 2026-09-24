/* The three stand-ins the tests need:
     · a capture server that plays FormSubmit (over TLS, so the browser really
       posts to https://formsubmit.co after a host-resolver rule points that
       name at us), and the fake Pushover and Telegram the Worker's alerts reach
       (plain http, pointed at by PUSHOVER_API_BASE / TELEGRAM_API_BASE)
     · a static server for the site under test
   Nothing here ships. */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export function makeSelfSigned(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'test-key.pem');
  const crt = path.join(dir, 'test-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(crt)) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', crt, '-days', '2',
      '-subj', '/CN=formsubmit.co',
      '-addext', 'subjectAltName=DNS:formsubmit.co,DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

/**
 * Plays FormSubmit, Pushover and Telegram. Every request is pushed onto `captured`.
 * `mode` can be flipped to 'fail' to prove the Worker keeps the record anyway.
 * `pushover` / `telegram` can be set to '500' or '400' to prove the retry rules.
 * A priority-2 Pushover call is answered with a fresh receipt, kept on the capture.
 */
export function captureServer({ port, tls, tlsDir }) {
  const captured = [];
  const state = { mode: 'ok', pushover: 'ok', telegram: 'ok' };

  const handler = async (req, res) => {
    const body = await readBody(req);
    const cap = {
      at: Date.now(),
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      body,
    };
    captured.push(cap);
    if (/^\/pushover\//.test(req.url)) {
      const code = state.pushover === 'ok' ? 200 : parseInt(state.pushover, 10);
      cap.answered = code;
      if (code !== 200) {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 0, errors: ['fake pushover ' + code], request: 'fake' }));
        return;
      }
      const out = { status: 1, request: 'fake-' + crypto.randomBytes(6).toString('hex') };
      const p = new URLSearchParams(body.toString('utf8'));
      if (/messages\.json$/.test(req.url) && p.get('priority') === '2') {
        out.receipt = crypto.randomBytes(15).toString('hex');
        cap.receipt = out.receipt;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (/^\/telegram\//.test(req.url)) {
      const code = state.telegram === 'ok' ? 200 : parseInt(state.telegram, 10);
      cap.answered = code;
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(code === 200 ? { ok: true, result: { message_id: captured.length } } : { ok: false, description: 'fake telegram ' + code }));
      return;
    }
    if (state.mode === 'fail') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('stub failure');
      return;
    }
    /* FormSubmit answers a browser post by sending it on to _next. The stub
       answers 200 instead, so the browser stops here and the test does not have
       to reach the real site. */
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>stub</title><p>captured</p>');
  };

  const server = tls
    ? https.createServer(makeSelfSigned(tlsDir), handler)
    : http.createServer(handler);

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, captured, state, port }));
  });
}

/**
 * ACCEPT-PAGE-02: the site's one rewrite, played locally — vercel.json sends /q/* to the Worker as an external
 * rewrite, which is a proxy: the browser stays on the site's origin, the Worker answers. Method, headers
 * (Origin and Sec-Fetch-* included) and body go through; the answer comes back as it is — a 303's relative
 * Location is never followed or rewritten. Every request is pushed onto `log` with the headers it carried.
 */
function proxyTo(target, log, req, res) {
  const t = new URL(target);
  const headers = { ...req.headers, host: t.host, 'x-forwarded-host': req.headers.host || '' };
  const entry = { at: Date.now(), method: req.method, url: req.url, headers: { ...req.headers } };
  log.push(entry);
  const up = http.request({ host: t.hostname, port: t.port, method: req.method, path: req.url, headers }, (r) => {
    entry.status = r.statusCode;
    entry.response_headers = { ...r.headers };
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', (err) => { entry.error = String(err); if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('proxy error'); });
  /* a client that hangs up mid-request must never take the site server down with it */
  req.on('error', (err) => { entry.client_error = String(err); up.destroy(); });
  res.on('error', (err) => { entry.client_error = String(err); });
  req.pipe(up);
}

/** Serves a directory with Vercel's cleanUrls behaviour; with `proxy`, /q and /q/* go to that Worker. */
export function staticServer({ port, root, proxy = null }) {
  const proxyLog = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (proxy && (url.pathname === '/q' || url.pathname.startsWith('/q/'))) { proxyTo(proxy, proxyLog, req, res); return; }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (fs.existsSync(file + '.html')) file = file + '.html';
      else if (fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
      else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + p); return; }
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port, root, proxyLog }));
  });
}

/**
 * REMINDERS-01 · A CONTRACT FAKE OF SMSGATE'S CLOUD SERVER, on 127.0.0.1 and nowhere else.
 * The shape is FC-TEXT-01's `Bridge\FC-TEXT-01\fake-smsgate.mjs`, copied so both rounds prove the same
 * contract. IT NEVER SENDS ANYTHING. It logs every request — method, path, the auth USERNAME only
 * (never the password), and the whole body — and answers per `state.mode`:
 *     ok      202 { id, state: "Pending" }        (SMSGate answers 202 Accepted, not 200)
 *     401     401 { message: "unauthorized" }
 *     500     500 { message: "boom" }
 *     hang    no answer at all, ever — the caller's own twenty seconds must end it
 *     404     a GET of a message answers 404
 *     failed  a GET of a message answers state "Failed"
 * A POST that repeats an id it has already accepted is a 409, whatever the mode — so a second POST for
 * one request would be visible even if the Worker's own lock failed. `state.slowMs` delays every answer.
 */
export function smsgateServer({ port }) {
  const requests = [];
  const state = { mode: 'ok', slowMs: 0 };
  const byId = new Map();
  const held = [];                       /* sockets deliberately left hanging, cut when we close */

  const server = http.createServer(async (req, res) => {
    const body = (await readBody(req)).toString('utf8');
    const auth = String(req.headers.authorization || '');
    const sawBasic = /^Basic /.test(auth);
    let user = null;
    if (sawBasic) { try { user = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')[0]; } catch (e) { user = '<unreadable>'; } }
    const p = String(req.url || '').split('?')[0];
    const row = {
      n: requests.length + 1, at: new Date().toISOString(), method: req.method, path: p,
      authUser: user, authScheme: sawBasic ? 'Basic' : (auth ? auth.split(' ')[0] : null), authLen: auth.length,
      contentType: req.headers['content-type'] || null, host: req.headers.host || null,
      bodyChars: body.length, body, mode: state.mode,
    };
    requests.push(row);

    const send = (code, obj) => {
      row.answered = code;
      const b = Buffer.from(JSON.stringify(obj), 'utf8');
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length });
      res.end(b);
    };
    const answer = () => {
      if (state.mode === 'hang') { held.push(res); return; }
      if (state.mode === '401') return send(401, { message: 'unauthorized' });
      if (state.mode === '500') return send(500, { message: 'boom' });
      if (req.method === 'POST' && p === '/3rdparty/v1/messages') {
        let given = null; try { given = JSON.parse(body); } catch (e) { /* the fake still answers */ }
        const id = given && typeof given.id === 'string' && given.id ? given.id : 'fake-' + row.n;
        if (byId.has(id)) { row.repeat_of = byId.get(id); return send(409, { message: 'a message with that id already exists' }); }
        byId.set(id, row.n);
        return send(202, { id, state: 'Pending', recipients: [{ phoneNumber: '<the fake never echoes it>', state: 'Pending' }] });
      }
      if (req.method === 'GET' && /^\/3rdparty\/v1\/messages\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split('/').pop());
        if (state.mode === '404') return send(404, { message: 'not found' });
        if (state.mode === 'failed') return send(200, { id, state: 'Failed' });
        return send(200, { id, state: 'Delivered' });
      }
      return send(404, { message: 'the fake knows only POST /3rdparty/v1/messages and GET /3rdparty/v1/messages/<id>' });
    };
    if (state.slowMs > 0) setTimeout(answer, state.slowMs); else answer();
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      server, requests, state, port,
      posts: () => requests.filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages'),
      gets: () => requests.filter((r) => r.method === 'GET'),
      cut: () => { for (const r of held) { try { r.destroy(); } catch (e) { /* already gone */ } } held.length = 0; },
    }));
  });
}

export function close(s) {
  if (typeof s.cut === 'function') s.cut();
  return new Promise((r) => s.server.close(() => r()));
}
