/* THE RECORD, AS MARKDOWN — the shape of Bridge\BIP\UMBRA\JOBS\U-0002-wills-ceiling\00-JOB.md.
   Fixed slots. A blank is a blank, never a guess: what the record does not know
   stays `____`. This is how a job lands in the brain as markdown, and markdown
   stays the source of truth — the KV copy is derived from it, not the other way. */

import { mdCell, minutesBetween } from './util.js';

function title(rec) {
  const f = rec.fields || {};
  const who = (f.name || '').trim();
  const what = (f.service || '').trim();
  if (who && what) return `${who.toUpperCase()} · ${what.toUpperCase()}`;
  if (who) return who.toUpperCase();
  if (what) return what.toUpperCase();
  return 'UNTITLED REQUEST';
}

export function renderJobMarkdown(rec, opts = {}) {
  const f = rec.fields || {};
  const photos = Array.isArray(rec.photos) ? rec.photos : [];
  const mtq = rec.minutes_to_quote != null
    ? rec.minutes_to_quote
    : (rec.quoted_at ? minutesBetween(rec.received_at, rec.quoted_at) : null);
  const metWindow = mtq == null ? null : (mtq <= 120 ? `YES — ${mtq} min` : `NO — ${mtq} min`);

  const L = [];
  L.push(`# ${rec.id} · ${title(rec)}`);
  L.push(`**WSS job record · created ${rec.received_at} by the intake Worker (Stage 1). Fixed slots — a blank is a blank, never a guess. Shape: \`U-0002-wills-ceiling\\00-JOB.md\`.**`);
  L.push(`**Status:** \`${String(rec.status || 'received').toUpperCase()}\``);
  L.push('');
  L.push('---');
  L.push('');

  L.push('## A · THE REQUEST — as it arrived, never cleaned up');
  L.push('| slot | |');
  L.push('|---|---|');
  L.push(`| \`received_at\` | ${mdCell(rec.received_at)} |`);
  L.push(`| \`received_at\` (Chicago) | ${mdCell(rec.received_at_chicago)} |`);
  L.push(`| \`relay_delay\` | \`____\` ← Received: chain minus form submit — **the timing test** |`);
  L.push(`| \`source\` | ${mdCell(rec.source)} |`);
  L.push(`| \`channel_detail\` | ${mdCell(f.channel_detail || f.heard || '')} |`);
  L.push(`| \`submitted_from\` | ${mdCell(rec.user_agent)} |`);
  L.push(`| \`category\` | ${mdCell(f.service)} |`);
  L.push(`| \`name\` | ${mdCell(f.name)} |`);
  L.push(`| \`phone\` | ${mdCell(f.phone)} |`);
  L.push(`| \`street + city\` | ${mdCell(f.address)} |`);
  L.push(`| \`idioma\` | ${mdCell(f.idioma)} |`);
  /* services.html and the Spanish pages name the free text `what`; contact.html
     names it `message`. Both are the customer's own words and both belong here. */
  L.push(`| \`what\` (verbatim) | ${mdCell(f.what || f.message)} |`);
  L.push(`| \`photos\` | ${photos.length ? `${photos.length} arrived — ${photos.map((p) => '`' + p.key + '`').join(' · ')}` : '`____`'} |`);
  L.push(`| \`photo sha256\` | ${photos.length ? photos.map((p) => '`' + String(p.sha256).slice(0, 12) + '`').join(' · ') : '`____`'} |`);
  L.push(`| \`status link\` | ${mdCell(rec.status_link)} |`);
  L.push(`| \`email forwarded\` | ${rec.forward_failed ? '**NO — `forward_failed`**' : (rec.forwarded_at ? mdCell(rec.forwarded_at) + (rec.forwarded_by ? ` — sent by the ${rec.forwarded_by}` : '') : '`____`')} |`);
  L.push(`| \`email copy id\` | ${mdCell(rec.email_copy_id)} ← R28: the browser's own copy of this submission, matched by this id |`);
  L.push(`| \`confirmation shown\` | /request-received ("We reply within 2 hours, 7am–9pm") |`);
  L.push('');

  L.push('## B · THE THREE QUESTIONS — what had to be asked before pricing');
  L.push('| # | question | answer | asked via |');
  L.push('|---|---|---|---|');
  const qs = Array.isArray(rec.questions_asked) ? rec.questions_asked : [];
  if (qs.length) {
    qs.forEach((q, i) => L.push(`| ${i + 1} | ${mdCell(q.question)} | ${mdCell(q.answer)} | ${mdCell(q.via)} |`));
  } else {
    L.push('| 1 | `____` | `____` | `____` |');
    L.push('| 2 | `____` | `____` | `____` |');
    L.push('| 3 | `____` | `____` | `____` |');
  }
  L.push('*(The quote seat fills these from the photos and the category. The answers — and which questions turned out to matter — are the training row.)*');
  L.push('');

  L.push("## C · THE PACKET — the quote seat's fixed output");
  L.push('| slot | |');
  L.push('|---|---|');
  L.push(`| **Scope** (one paragraph, as the customer reads it back) | ${mdCell(rec.scope)} |`);
  L.push('| **Hours** (+ the assumption it rests on) | `____` |');
  L.push('| **Materials** (item · store · qty · price) | `____` |');
  L.push('| **Tools to bring** | `____` |');
  L.push('| ⬛ **`year_built` (from the CAD)** | `____` ← **D34: every quote carries it. Pre-1978 → the exclusion line goes in the work order.** |');
  L.push('| **Cost sheet — direct cost** (materials + consumables + fuel, all trips incl. the free look) | `____` |');
  L.push('| **Overhead/hour × hours** (≈ $2.10/h GUESS) | `____` |');
  L.push('| **Three prices** — relationship · standard · if-it-goes-sideways | `____` · `____` · `____` |');
  L.push(`| **Price chosen** | ${rec.quote_amount != null ? mdCell('$' + rec.quote_amount) : '`____`'} ← Drew's call |`);
  L.push('| **What it pays per hour on site** | `____` ← the line that makes the price a decision, not a leak |');
  L.push('| **The email text** (EN) | `____` |');
  L.push('| **The text-message text** (EN) | `____` |');
  L.push('| **Marked GUESS** | `____` |');
  L.push('');

  L.push('## D · THE CLOCK');
  L.push('| slot | |');
  L.push('|---|---|');
  L.push(`| \`received_at\` | ${mdCell(rec.received_at)} |`);
  L.push(`| \`questions_sent_at\` | ${mdCell(rec.questions_sent_at)} |`);
  L.push(`| \`answers_in_at\` | ${mdCell(rec.answers_in_at)} |`);
  L.push(`| \`quoted_at\` | ${mdCell(rec.quoted_at)} ← the tap |`);
  L.push(`| \`minutes_to_quote\` | ${mdCell(mtq)} |`);
  L.push(`| \`nudged_at\` | ${mdCell(rec.nudged_at)} ← the 90-minute push |`);
  L.push(`| **2-hour window met?** | ${mdCell(metWindow)} — *ruled 09-17: "we know we will miss it." Recorded, not chased.* |`);
  L.push('');

  L.push('## E · ACCEPTANCE → SCHEDULE');
  L.push('| slot | |');
  L.push('|---|---|');
  L.push(`| \`accepted_at\` | ${mdCell(rec.accepted_at)} |`);
  L.push(`| \`slot offered\` | ${mdCell(rec.scheduled_for)} |`);
  L.push(`| \`scheduled_at\` | ${mdCell(rec.scheduled_at)} |`);
  L.push('| **Photo consent** — two clauses, separately initialled | documentation `____` · marketing `____` |');
  L.push('');

  L.push('## F · THE WORK ORDER — generated on acceptance');
  L.push('| slot | |');
  L.push('|---|---|');
  L.push(`| Who / where / when · access (someone home, gate, dog) | ${mdCell([f.name, f.phone, f.address].filter(Boolean).join(' · '))} |`);
  L.push(`| Scope — verbatim from C | ${mdCell(rec.scope)} |`);
  L.push(`| Photos — the customer's | ${photos.length ? photos.map((p) => '`' + p.key + '`').join(' · ') : '`____`'} |`);
  L.push('| **Shopping list** — store · item · qty · price | `____` |');
  L.push('| Tools | `____` |');
  L.push('| ⬛ **Exclusion (D34)** | *"Pre-1978 homes: paint-disturbing work not included"* — present if `year_built` < 1978, else struck with the year shown |');
  L.push('| Permit | `____` — pulled per job and priced from the customer (Drew, W4) |');
  L.push('| Time estimate + the slot | `____` |');
  L.push(`| Money — price · cost lines · per-hour | ${rec.quote_amount != null ? mdCell('$' + rec.quote_amount) : '`____`'} |`);
  L.push('| ⬛ **"What in this house could Umbra automate?"** — filled on site | `____` |');
  L.push('');

  L.push('## G · ACTUALS — filled AFTER, never before');
  L.push('| slot | estimate | actual | gap |');
  L.push('|---|---|---|---|');
  for (const row of ['Hours on site', 'Hours driving', 'Materials $', 'Consumables $', 'Fuel (mi)']) {
    L.push(`| ${row} | \`____\` | \`____\` | \`____\` |`);
  }
  L.push('| **What surprised you** | | `____` | |');
  L.push('');

  L.push('## H · CLOSE');
  L.push('| slot | |');
  L.push('|---|---|');
  L.push(`| \`done_at\` | ${mdCell(rec.done_at)} |`);
  L.push('| **Drew\'s inspection** | `____` PASS / FAIL, and why |');
  L.push('| **Job photos** — before / during / after, GPS stripped, no house number or face | `____` |');
  L.push('| **The audit** — by an agent that did not build it | `____` |');
  L.push(`| \`outcome\` | ${mdCell(rec.outcome)} |`);
  L.push('| **Paid / unpaid · account it landed in** | `____` |');
  L.push('| **What Flo should have said** | `____` |');
  L.push('| **Lessons for the retro** | `____` |');
  L.push('');

  L.push('---');
  L.push('');
  L.push('## THE AUDIT LIST — every event, in order, nothing removed');
  L.push('| at | type | detail |');
  L.push('|---|---|---|');
  for (const e of (rec.events || [])) {
    const { at, type, ...rest } = e;
    L.push(`| ${mdCell(at)} | \`${mdCell(type)}\` | ${mdCell(Object.keys(rest).length ? JSON.stringify(rest) : '')} |`);
  }
  L.push('');
  L.push(`*One writer at a time. Rendered from the intake record ${rec.id} at ${opts.now || new Date().toISOString()}. Nothing in this file is promoted until Drew says so.*`);
  L.push('');

  return L.join('\n');
}
