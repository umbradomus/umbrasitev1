/* A raw multipart/form-data parser, written here on purpose: the point of the
   forward test is to read the bytes the Worker actually sent, not to trust a
   library that might normalise them. */

import crypto from 'node:crypto';

export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('no boundary in ' + contentType);
  const boundary = (m[1] || m[2]).trim();
  const delim = Buffer.from('--' + boundary);
  const parts = [];

  let idx = buf.indexOf(delim);
  if (idx < 0) throw new Error('boundary not found in body');
  idx += delim.length;

  while (idx < buf.length) {
    if (buf[idx] === 0x2d && buf[idx + 1] === 0x2d) break;           /* closing -- */
    if (buf[idx] === 0x0d && buf[idx + 1] === 0x0a) idx += 2;
    const headEnd = buf.indexOf('\r\n\r\n', idx, 'latin1');
    if (headEnd < 0) break;
    const head = buf.slice(idx, headEnd).toString('utf8');
    const bodyStart = headEnd + 4;
    let next = buf.indexOf(delim, bodyStart);
    if (next < 0) next = buf.length;
    const body = buf.slice(bodyStart, Math.max(bodyStart, next - 2));  /* drop the CRLF before the boundary */

    const nameM = /name="([^"]*)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    const typeM = /content-type:\s*([^\r\n]+)/i.exec(head);
    parts.push({
      name: nameM ? nameM[1] : null,
      filename: fileM ? fileM[1] : null,
      contentType: typeM ? typeM[1].trim() : null,
      isFile: Boolean(fileM),
      size: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
      value: fileM ? null : body.toString('utf8'),
      bytes: body,
    });
    idx = next + delim.length;
  }
  return parts;
}

/** Field names in the order they appeared, files included. */
export function fieldNames(parts) {
  return parts.map((p) => p.name);
}

export function fieldValue(parts, name) {
  const p = parts.find((x) => x.name === name && !x.isFile);
  return p ? p.value : undefined;
}

export function files(parts) {
  return parts.filter((p) => p.isFile);
}
