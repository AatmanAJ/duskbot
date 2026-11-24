# Re-shoot: a follow-up typed during an outage

`node --experimental-strip-types recipe-repro.ts <checkout> <outdir>` (run from the checkout; needs `pnpm install`).
It starts a restartable fake-engine server on a temporary data dir with a held `Bash` call, opens the threads preview
in the pinned agent-browser at 1280x800 @2x, pins Pepper to orange, sends "Export last month's invoices", `kill -9`s
the server, types "Also add the VAT column please" 14 s later, starts the server on the same data 17 s after that,
and logs every 0.5 s whether the follow-up is on screen as the pending bubble, as the server's copy, or MISSING.
`at-8s.png` is taken 8 s after the restart; the pair is cropped to `--crop 300,480,980,300` on both.

Before: origin/main. After: fix/busy-followup-stays-shown.

## Review follow-up: an edit of the last message while a snapshot names the old answer

`node --experimental-strip-types recipe-edit-held.ts <checkout> <outdir>`: Pepper answers "Export last month's
invoices"; the page holds every message POST for 10 s; the last message is edited (ArrowUp, "Export this month's invoices
instead", Enter); the server is `kill -9`ed and started again 1.5 s later, so the reconnect snapshot, still naming the old
answer as the leaf, lands before the edit reaches the server. Polled every 0.5 s.
Before: 9624aa1a3 (the edit is drawn under the old answer for about 5.5 s). After: 343a4d9e5 (it is hidden for that
window, as on main, then its server copy shows on its own branch). `after.recheck.timeline.txt` is the outage recipe
re-run on 343a4d9e5.
