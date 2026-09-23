/* BUSINESS TIME — the two-hour promise counts 7 AM to 9 PM Central, seven days a week (R26 · R32).
   "We reply within 2 hours, 7am–9pm." A request at 8:25 PM uses 35 business minutes that night and the
   other 85 from 7:00 AM, so it is due 8:25 AM. Before 7 AM the clock starts at 7; at or after 9 PM it
   starts at 7 the next morning. This is the Flux Capacitor's bizAdvance / bizMinutes rule (FLUX\READ-ME.md
   v1.3), moved onto the Worker so the register and the FC agree.

   ONE DIFFERENCE, ON PURPOSE: every wall-clock moment here is found by asking Intl for Chicago's own
   reading, never by adding a fixed number of hours. The FC jumps from 9 PM to 7 AM by adding ten hours,
   which is right on 363 nights a year and an hour late on the spring-forward night. Here, 7:00 AM is
   always 7:00 AM on Chicago's clock, whatever the offset that morning (DST ends Sun 1 Nov 2026). */

export const OPEN_H = 7;
export const CLOSE_H = 21;
export const REPLY_MIN = 120;

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Chicago's wall clock at an instant: { y, mo, d, h, mi, s }. */
export function chicagoParts(ms) {
  const p = FMT.formatToParts(new Date(ms));
  const g = (t) => parseInt((p.find((x) => x.type === t) || {}).value || '0', 10);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}

/** Chicago minus UTC, in minutes, at an instant (−300 in summer, −360 in winter). */
function offsetMin(ms) {
  const c = chicagoParts(ms);
  const asUtc = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The instant Chicago's clock reads y-mo-d h:mi. Day overflow is allowed (d + 1 is tomorrow). */
export function chicagoWall(y, mo, d, h, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMin(guess) * 60000;
  t = guess - offsetMin(t) * 60000;
  return t;
}

export function isOpen(ms) {
  const { h } = chicagoParts(ms);
  return h >= OPEN_H && h < CLOSE_H;
}

/** 7:00 AM Chicago on the day of `ms`. */
export function openOf(ms) {
  const c = chicagoParts(ms);
  return chicagoWall(c.y, c.mo, c.d, OPEN_H);
}

/** The next moment the business is open: `ms` itself if open, else the coming 7:00 AM. */
export function nextOpen(ms) {
  const c = chicagoParts(ms);
  if (c.h < OPEN_H) return chicagoWall(c.y, c.mo, c.d, OPEN_H);
  if (c.h >= CLOSE_H) return chicagoWall(c.y, c.mo, c.d + 1, OPEN_H);
  return ms;
}

/** The moment `minutes` of business time after `fromMs` have passed. */
export function bizAdvance(fromMs, minutes) {
  let t = fromMs, left = minutes;
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const c = chicagoParts(t);
    if (c.h < OPEN_H) { t = chicagoWall(c.y, c.mo, c.d, OPEN_H); continue; }
    if (c.h >= CLOSE_H) { t = chicagoWall(c.y, c.mo, c.d + 1, OPEN_H); continue; }
    const closeAt = chicagoWall(c.y, c.mo, c.d, CLOSE_H);
    const todayLeft = (closeAt - t) / 60000;
    if (left <= todayLeft) { t += Math.round(left * 60000); left = 0; }
    else { t = closeAt; left -= todayLeft; }
  }
  return t;
}

/** Business minutes between two moments (0 if b is not after a). */
export function bizMinutes(aMs, bMs) {
  if (!(bMs > aMs)) return 0;
  let t = aMs, total = 0;
  for (let guard = 0; guard < 4000 && t < bMs; guard++) {
    const c = chicagoParts(t);
    if (c.h < OPEN_H) { t = Math.min(bMs, chicagoWall(c.y, c.mo, c.d, OPEN_H)); continue; }
    if (c.h >= CLOSE_H) { t = Math.min(bMs, chicagoWall(c.y, c.mo, c.d + 1, OPEN_H)); continue; }
    const closeAt = chicagoWall(c.y, c.mo, c.d, CLOSE_H);
    const end = Math.min(closeAt, bMs);
    total += (end - t) / 60000;
    t = end;
  }
  return Math.round(total);
}

/** When the quote is due: two business hours after the request landed. */
export function replyDue(receivedMs) {
  return bizAdvance(receivedMs, REPLY_MIN);
}

/** "9:28 AM" on Chicago's clock. Built by hand: Intl puts a narrow no-break space before AM. */
export function clock(ms) {
  const { h, mi } = chicagoParts(ms);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-09-24" — the Chicago calendar day of an instant. */
export function chicagoDay(ms) {
  const { y, mo, d } = chicagoParts(ms);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
