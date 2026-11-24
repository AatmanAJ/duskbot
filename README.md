# Recipe: routine-run-plain-error

Fake-engine fixture, engine set to fail before replying:

    node --experimental-strip-types scripts/control-dusk.ts ui launch --mode exit-early
    curl -XPOST $URL/api/routines -H 'content-type: application/json' \
      -d '{"name":"Thursday review reminder","prompt":"Remind me to review the week.","botId":"<botId>","enabled":false,"schedule":{"type":"daily","time":"16:00","weekdays":[4]}}'
    node --experimental-strip-types viewport.ts <repo> <ui.json> 1280 800   # 2x, dark, reduced motion
    control-dusk ui click --name "Open Pepper's profile"; ui click --name "Thursday review reminder, Paused"; ui click --name "Run now"
    control-dusk ui screenshot --out run-line.<state>.raw.png       # once on origin/main, once on the branch
    node scripts/brand-studio/frame.mjs --in run-line.before.raw.png --in run-line.after.raw.png \
      --crop 410,598,460,112 --out run-line.pair.png --label before --label after
