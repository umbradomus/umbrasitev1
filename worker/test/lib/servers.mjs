/* The three stand-ins the tests need:
     · a capture server that plays FormSubmit (over TLS, so the browser really
       posts to https://formsubmit.co after a host-resolver rule points that
       name at us) and ntfy (over plain http, called by the Worker)
     · a static server for the site under test
   Nothing here ships. */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
 * Plays FormSubmit and ntfy. Every request is pushed onto `captured`.
 * `mode` can be flipped to 'fail' to prove the Worker keeps the record anyway.
 */
export function captureServer({ port, tls, tlsDir }) {
  const captured = [];
  const state = { mode: 'ok' };

  const handler = async (req, res) => {
    const body = await readBody(req);
    captured.push({
      at: Date.now(),
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      body,
    });
    if (state.mode === 'fail') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('stub failure');
      return;
    }
    if (/^\/ntfy/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'stub', topic: req.url.replace(/^\/ntfy\//, '') }));
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
