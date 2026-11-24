# Re-shoot: a follow-up typed during an outage

`node --experimental-strip-types recipe-repro.ts <checkout> <outdir>` (run from the checkout; needs `pnpm install`).
It starts a restartable fake-engine server on a temporary data dir with a held `Bash` call, opens the threads preview
in the pinned agent-browser at 1280x800 @2x, pins Pepper to orange, sends "Export last month's invoices", `kill -9`s
the server, types "Also add the VAT column please" 14 s later, starts the server on the same data 17 s after that,
and logs every 0.5 s whether the follow-up is on screen as the pending bubble, as the server's copy, or MISSING.
`at-8s.png` is taken 8 s after the restart; the pair is cropped to `--crop 300,480,980,300` on both.

Before: origin/main. After: fix/busy-followup-stays-shown.
