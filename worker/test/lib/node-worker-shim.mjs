/* `cloudflare:workers`, stood in — CONFIRM-01, 2026-10-04. Test-only; nothing here ships.

   The real DurableObject base class gives a Durable Object its `ctx` (with `storage.sql` and
   `storage.transactionSync`) and its `env`. That is all quotebook.js takes from it, so that is all this is. */

export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
