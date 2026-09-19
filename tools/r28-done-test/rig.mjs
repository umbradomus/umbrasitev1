/* R28 DONE-TEST RIG — a scratch copy of the site, two fake endpoints, a real browser. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SITE = '/mnt/user-data/uploads/umbrasitev1';
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css', '.jpg':'image/jpeg', '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml', '.txt':'text/plain', '.webp':'image/webp' };

export function parts(body) {
  /* names + filenames + sizes, enough to say what the email carried */
  const s = body.toString('latin1');
  const out = [];
  const re = /name="([^"]+)"(?:; filename="([^"]*)")?/g;
  let m;
  while ((m = re.exec(s))) out.push({ name: m[1], filename: m[2] || null });
  return out;
}
export function valueOf(body, name) {
  const s = body.toString('latin1');
  const re = new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)\\r\\n');
  const m = re.exec(s);
  return m ? m[1] : null;
}

export function start({ workerDown = false } = {}) {
  const log = { email: [], worker: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        if (u.pathname === '/__formsubmit') {
          log.email.push({ at: Date.now(), bytes: body.length, parts: parts(body), body });
          const next = valueOf(body, '_next') || '/';
          res.writeHead(302, { Location: next }); res.end(); return;
        }
        if (u.pathname === '/__worker/intake') {
          log.worker.push({ at: Date.now(), bytes: body.length, parts: parts(body), body });
          /* MIRRORS worker/src/index.js §3 exactly: the browser owns the email,
             this forward is the fallback and fires only on email_sent != yes. */
          const sent = String(valueOf(body, 'email_sent') || '').trim().toLowerCase() === 'yes';
          if (!sent) {
            log.email.push({ at: Date.now(), bytes: body.length, parts: parts(body), body, via: 'worker-fallback' });
          }
          res.writeHead(302, { Location: '/request-received' }); res.end(); return;
        }
        res.writeHead(404); res.end('no'); return;
      });
      return;
    }
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (!path.extname(p)) p += '.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    let buf = fs.readFileSync(file);
    if (p === '/assets/umbra-endpoint.js') {
      /* THE SCRATCH COPY — the one line, pointed somewhere we can watch, and
         (for the dead-host run) somewhere that refuses the connection. */
      const host = 'http://' + (req.headers.host || '127.0.0.1');
      let s = buf.toString('utf8');
      s = s.replace(/window\.UMBRA_WORKER_BASE = '[^']*'/, `window.UMBRA_WORKER_BASE = '${workerDown ? 'http://127.0.0.1:1' : host + '/__worker'}'`);
      s = s.replace(/var FORMSUBMIT = '[^']*'/, `var FORMSUBMIT = '${host}/__formsubmit'`);
      buf = Buffer.from(s, 'utf8');
    }
    if (path.extname(p) === '.html') {
      /* the no-JS route posts to the static action in the markup: point that at
         the watched endpoint too, or the test would post at the real relay */
      const host = 'http://' + (req.headers.host || '127.0.0.1');
      buf = Buffer.from(buf.toString('utf8').split('https://formsubmit.co/07242513cc0b8b4dac5ae320baa7c431').join(host + '/__formsubmit'), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, log, port: server.address().port })));
}
