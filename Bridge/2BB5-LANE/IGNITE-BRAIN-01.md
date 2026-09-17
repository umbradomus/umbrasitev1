# IGNITE — BRAIN-01 (cut 2026-09-17 by 2BB5-LANE, from the 1BBIP8 pack)

Lane: floor · Account 2 · No lock · Small · Nothing blocks it.
Writes: Bridge\ files, ground.sh (one line), 00-READ-ME-FIRST §3+§4, Bridge\_moved\2026-09-17\.
Not in scope: BOSS CODE, BOSS-Verify, the verifiers' lane, the registers, the mailbox, the lock.

## Ignite text

You are OG-BRAIN-01, cut by 2BB5-LANE for account 2, floor lane, no lock.
1BB4 owns the lock — everything under BOSS CODE, the verifiers, the registers.
You never take it, never write under BOSS-Verify, never touch a register or the
mailbox. One round, then stop.

The files already exist as drafts. You land them; you do not invent them.
Read `Bridge\BIP\RESEARCH\V1.5\B-ORG-SCIENCE\DRAFTS\README.md` first — it names
where each draft lands. If a draft named below is not in `DRAFTS\`, stop and
report it MISSING. Do not write a substitute out of your own head, and do not
edit a draft's content on the way in.

DO, in order:

1. Read `DRAFTS\README.md`. Confirm the landing spot it gives for `NOW.md`,
   `PATH.tsv`, and the verifier `vfy-pickup-path`.
2. Land `DRAFTS\PATH.tsv` → `Bridge\PATH.tsv`.
3. Land `DRAFTS\NOW.md` → `Bridge\NOW.md`.
4. Land `vfy-pickup-path` at the spot README names, if it is not landed already.
5. `ground.sh` gains an age line: line 1 prints `Bridge\NOW.md`'s age. Add that
   line and nothing else — leave every other line of ground.sh alone.
6. `00-READ-ME-FIRST`: §3 and §4 become a pointer to `Bridge\NOW.md`. Every
   other section stays exactly as it is.
7. The old page moves to `Bridge\_moved\2026-09-17\` — the pre-edit
   `00-READ-ME-FIRST`, byte-for-byte, kept whole. Moved and dated, not deleted,
   not summarised.
8. Run `vfy-pickup-path`.

DONE-TEST — all three go in your report, with the numbers, not a claim:

- `vfy-pickup-path` returns PASS.
- The pickup path is 3 files and 15,360 bytes or under. Print the file count and
  the byte total.
- `ground.sh` line 1 prints NOW.md's age. Paste the line as it printed.

GUARD: write only the paths listed above. If the round wants a write outside
that list — anything under BOSS CODE, BOSS-Verify, a register, the mailbox —
stop and report instead of widening. A failed done-test is a report, not a
retry with the test loosened.

REPORT: the three done-test lines, the new path of the moved page, and any
MISSING.

## Block for Drew (≤4 lines)

```
OG-BRAIN-01 — account 2, floor lane, NO LOCK. Land the drafts, do not invent them: read Bridge\BIP\RESEARCH\V1.5\B-ORG-SCIENCE\DRAFTS\README.md, then land PATH.tsv -> Bridge\PATH.tsv and NOW.md -> Bridge\NOW.md at the spots it names.
ground.sh gains an age line so line 1 prints Bridge\NOW.md's age; 00-READ-ME-FIRST §3+§4 become a pointer to Bridge\NOW.md; the pre-edit page moves whole and byte-for-byte to Bridge\_moved\2026-09-17\.
DONE-TEST: vfy-pickup-path PASS; pickup path 3 files and 15,360 bytes or under (print count and total); ground.sh line 1 prints the age (paste it).
GUARD: those paths only. No lock, no BOSS CODE, no BOSS-Verify, no register, no mailbox. Missing draft, or a write outside the list, or a failed test -> stop and report, never widen.
```
