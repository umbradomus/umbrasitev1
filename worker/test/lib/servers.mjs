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

/** Serves a directory with Vercel's cleanUrls behaviour. */
export function staticServer({ port, root }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
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
    server.listen(port, '127.0.0.1', () => resolve({ server, port, root }));
  });
}

export function close(s) {
  return new Promise((r) => s.server.close(() => r()));
}
