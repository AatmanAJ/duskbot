import { useState } from "react";
import { motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, offset, spring, stagger } from "@lab/tokens";
import { EmptyChat } from "@/components/ChatEmptyState";
import { AMY, Composer, Mascot, Stage } from "../kit";

const IDEAS = ["Find a cheap flight", "Remind me about rent", "Plan my Saturday"];
type Mode = "original" | "a" | "b";

function Empty({ replayKey, reduced, mode }: LabProps & { mode: Mode }) {
  const [value, setValue] = useState("");
  const asBot = { id: AMY.id, name: AMY.name, color: AMY.color } as unknown as Parameters<typeof EmptyChat>[0]["bot"];
  const blur = reduced ? {} : { filter: `blur(${offset.blurIn}px)` };
  return (
    <Stage key={replayKey}>
      <header className="flex h-11 shrink-0 items-center gap-2 px-4 text-[14px] font-medium"><Mascot bot={AMY} size={22} animated={false} />Amy</header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {mode === "original" ? (
          <EmptyChat bot={asBot} />
        ) : (
          <>
            <motion.div
              initial={reduced ? { opacity: 0 } : mode === "a" ? { opacity: 0, ...blur } : { opacity: 0, y: 10, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              transition={reduced ? { duration: dur.fast } : mode === "a" ? { duration: dur.settle, ease: ease.out } : { ...spring.settle, opacity: { duration: dur.swap } }}
            >
              <Mascot bot={AMY} size={44} state={mode === "b" ? "happy" : "idle"} />
            </motion.div>
            <motion.p
              className="text-[15px] leading-[22px] text-ink-secondary"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: mode === "b" ? offset.swapIn : 0, ...blur }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: mode === "a" ? dur.settle : dur.swap, ease: ease.out, delay: mode === "b" && !reduced ? 0.08 : 0 }}
            >
              Say hi to Amy
            </motion.p>
            {mode === "b" && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {IDEAS.map((idea, i) => (
                  <motion.button
                    key={idea}
                    type="button"
                    className="ui-pill"
                    onClick={() => setValue(idea)}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileTap={{ scale: offset.pressScale }}
                    transition={{ duration: dur.swap, ease: ease.out, delay: reduced ? 0 : 0.16 + i * stagger.in }}
                  >
                    {idea}
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Composer value={value} onChange={setValue} onSend={() => setValue("")} placeholder="Message Amy" />
    </Stage>
  );
}

export const empty: Item = {
  id: "empty-chat",
  title: "Empty chat",
  surface: "chat",
  height: 300,
  loopMs: 2400,
  notes: {
    original: "Real EmptyChat: nothing on screen (the header and the message box say whose chat it is), only a screen-reader status. Nothing moves.",
    a: "Amy's mascot and \"Say hi to Amy\" fade in from 4px blur over 320ms ease.out, once per mount (Magic UI BlurFade trimmed, MIT).",
    b: "Amy settles up 10px from .94 on 280/22 looking happy, the line rises 8px +80ms, three starters follow 45ms apart (200ms) and fill the box on click. New chat only, never on a chat with history.",
  },
  Original: (p) => <Empty {...p} mode="original" />,
  A: (p) => <Empty {...p} mode="a" />,
  B: (p) => <Empty {...p} mode="b" />,
};
