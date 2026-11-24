# usage: card.sh UI_HANDLE OUT.png — reload, Run now on the paused routine, close its dialog, shoot the chat's card
H=$1; OUT=$2; U() { pnpm -s control:dusk ui "$@" --ui $H >/dev/null; }
U eval --js "(location.reload(), true)"; sleep 6
U click --name "Thursday review reminder, Paused"; sleep 1
U click --name "Run now"; sleep 8
U click --name "Close"; sleep 1.5
U screenshot --out $OUT
