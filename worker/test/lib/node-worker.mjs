/* THE WORKER, RUN BY NODE — a stand-in for `wrangler dev` when wrangler cannot be installed. CONFIRM-01, 2026-10-04.
   Test-only; nothing here ships, and nothing here is reached by the deployed Worker.

   WHY IT EXISTS. The suites prove the Worker over HTTP against a real `wrangler dev` (workerd, miniflare's local KV, R2
   and the SQLite Durable Object). The machine CONFIRM-01 was built on could not reach the npm registry at all, so wrangler
   could not be installed there and `node test/run-all.mjs` could not start. The Worker's source is plain ES modules and
   Web APIs that Node 22 has, so this file loads src/index.js into Node itself, gives it the four bindings it uses, and
   serves `fetch(request, env, ctx)` on a 127.0.0.1 port — the same HTTP the suites already speak. A suite runs unchanged
   against either runtime. The two things Node cannot resolve by itself (`cloudflare:workers`, the admin.html text import)
   are mapped by node-worker-hooks.mjs.

   WHAT IS STOOD IN, AND HOW FAITHFULLY:
     · RECORDS (Workers KV)       a Map: get / put / delete / list({prefix, cursor}). No 429, no eventual consistency.
     · PHOTOS (R2)                a Map: put / get / head, with httpMetadata and customMetadata.
     · BOOK (the Durable Object)  ONE QuoteBook instance over node:sqlite (in memory), `storage.sql.exec(q, ...params)`
                                  answering a cursor with toArray(), and `storage.transactionSync(fn)` as BEGIN … COMMIT.
                                  Every method runs to completion before the next, as in the real object.
     · ctx.waitUntil(p)           the promise is kept and awaited by stop(), as workerd does at the end of a request.
     · the cron                   not driven here; the suites call the gated /__run-alerts and /__reconcile hooks, as they
                                  always have.
   A reading that passes here and under wrangler proves the same code path; a reading that passes ONLY here would be a
   reading about the stand-in, so the run under wrangler on a machine that has it is still the one that counts. */

import http from 'node:http';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

register('./node-worker-hooks.mjs', import.meta.url);

/* ------------------------------------------------------------ KV */
function kvNamespace() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? m.get(key) : null; },
    async put(key, value) { m.set(String(key), typeof value === 'string' ? value : Buffer.from(value).toString('utf8')); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? keys.indexOf(cursor) + 1 : 0;
      const page = keys.slice(from, from + limit);
      const done = from + limit >= keys.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, ...(done ? {} : { cursor: page[page.length - 1] }) };
    },
  };
}

/* ------------------------------------------------------------ R2 */
function r2Bucket() {
  const m = new Map();
  const obj = (key, o) => ({
    key, size: o.bytes.length, httpMetadata: o.httpMetadata || {}, customMetadata: o.customMetadata || {},
    body: new Blob([o.bytes]).stream(),
    async arrayBuffer() { return o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength); },
    async text() { return Buffer.from(o.bytes).toString('utf8'); },
  });
  return {
    async put(key, value, opts = {}) {
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      m.set(key, { bytes, httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata });
      return obj(key, m.get(key));
    },
    async get(key) { return m.has(key) ? obj(key, m.get(key)) : null; },
    async head(key) { return m.has(key) ? obj(key, m.get(key)) : null; },
    async delete(key) { m.delete(key); },
  };
}

/* ------------------------------------------------------------ the Durable Object's storage */
function sqlStorage() {
  const db = new DatabaseSync(':memory:');
  const exec = (q, ...params) => {
    const st = db.prepare(q);
    const rows = st.all(...params.map((p) => (p === undefined ? null : p)));
    const list = rows.map((r) => ({ ...r }));
    return { toArray: () => list, [Symbol.iterator]: () => list[Symbol.iterator]() };
  };
  let depth = 0;
  const transactionSync = (fn) => {
    if (depth > 0) return fn();
    db.exec('BEGIN');
    depth++;
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (err) { try { db.exec('ROLLBACK'); } catch (e) { /* already rolled back */ } throw err; }
    finally { depth--; }
  };
  return { sql: { exec }, transactionSync };
}

/** The BOOK binding: idFromName / get, answering one instance whose methods are called straight through. */
function bookBinding(QuoteBook, env) {
  let instance = null;
  const ctx = { storage: sqlStorage() };
  return {
    idFromName: (name) => ({ name, toString: () => name }),
    get: () => {
      if (!instance) instance = new QuoteBook(ctx, env);
      return new Proxy(instance, {
        get(target, prop) {
          const v = target[prop];
          if (typeof v !== 'function') return v;
          return async (...args) => v.apply(target, args);
        },
      });
    },
  };
}

/* ------------------------------------------------------------ the server */

/**
 * Starts the Worker at `workerDir` (its src/index.js) on 127.0.0.1:`port` with `vars` as its env.
 * Answers { W, log, stop } — `log()` is everything the Worker wrote to console.error/warn while running.
 */
export async function startNodeWorker({ workerDir, port, vars }) {
  const mod = await import(pathToFileURL(path.join(workerDir, 'src', 'index.js')).href);
  const { QuoteBook } = await import(pathToFileURL(path.join(workerDir, 'src', 'quotebook.js')).href);
  const worker = mod.default;
  const env = { ...vars, RECORDS: kvNamespace(), PHOTOS: r2Bucket() };
  env.BOOK = bookBinding(QuoteBook, env);

  let log = '';
  const origErr = console.error, origWarn = console.warn;
  console.error = (...a) => { log += a.map(String).join(' ') + '\n'; };
  console.warn = (...a) => { log += a.map(String).join(' ') + '\n'; };

  const pending = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const url = `http://127.0.0.1:${port}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const init = { method: req.method, headers, redirect: 'manual' };
      if (!['GET', 'HEAD'].includes(req.method)) init.body = body;
      const request = new Request(url, init);
      const ctx = { waitUntil: (p) => { const q = Promise.resolve(p).catch((e) => { log += 'waitUntil: ' + String(e && e.stack || e) + '\n'; }); pending.add(q); q.finally(() => pending.delete(q)); }, passThroughOnException() {} };
      const response = await worker.fetch(request, env, ctx);
      const out = {};
      response.headers.forEach((v, k) => { out[k] = k === 'set-cookie' ? [v] : v; });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!out['content-length'] && req.method !== 'HEAD') out['content-length'] = String(bytes.length);
      res.writeHead(response.status, out);
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (err) {
      log += 'node-worker: ' + String(err && err.stack || err) + '\n';
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('node-worker error: ' + String(err && err.message || err));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    W: `http://127.0.0.1:${port}`,
    env,
    log: () => log,
    stop: async () => {
      await Promise.allSettled([...pending]);
      console.error = origErr; console.warn = origWarn;
      await new Promise((r) => server.close(() => r()));
    },
  };
}
