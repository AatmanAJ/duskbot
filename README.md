# Recipe: paused-routine-try-again

Fake-engine fixture, engine set to fail before replying, one paused routine:

    node --experimental-strip-types scripts/control-dusk.ts ui launch --mode exit-early
    curl -XPOST $URL/api/routines -H 'content-type: application/json' \
      -d '{"name":"Thursday review reminder","prompt":"Remind me to review the week.","botId":"<botId>","enabled":false,"schedule":{"type":"daily","time":"16:00","weekdays":[4]}}'
    node --experimental-strip-types viewport.ts <repo> <ui.json> 1280 800   # 2x, dark, reduced motion
    control-dusk ui click --name "Open Pepper's profile"
    zsh card.sh <ui.json> paused-retry.<state>.raw.png     # reload, Run now, close the dialog, shoot; once per checkout
    control-dusk ui click --name "Try again"                  # after: GET /api/routines shows one more manual run, enabled still false
    node scripts/brand-studio/frame.mjs --in paused-retry.before.raw.png --in paused-retry.after.raw.png \
      --crop 296,160,656,148 --out paused-retry.pair.png --label before --label after
