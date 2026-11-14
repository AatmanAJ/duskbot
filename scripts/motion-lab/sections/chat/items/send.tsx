import { useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, spring } from "@lab/tokens";
import { ArrowUp } from "@/icons";
import { AMY, BotBubble, Composer, Row, SendButton, Stage, Transcript, UserBubble, cn, useScript, userFill, SIMPLE_USER_BUBBLE } from "../kit";
import { Arrive, StatusLine } from "../shipped";

const FIRST = "can you find me a cheap flight to goa this weekend?";
type Mode = "original" | "a" | "b";
type Sent = { id: number; text: string };

function Sending({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [value, setValue] = useState(FIRST);
  const [sent, setSent] = useState<Sent[]>([]);
  const [count, setCount] = useState(0);
  const send = () => {
    const text = value.trim();
    if (!text) return;
    setSent((list) => [...list, { id: Date.now(), text }]);
    setCount((n) => n + 1);
    setValue("");
  };
  useScript(replayKey, speed, [[0, () => { setSent([]); setValue(FIRST); }], [700, () => { setSent([{ id: 1, text: FIRST }]); setCount((n) => n + 1); setValue(""); }]]);
  const flying = mode !== "original" && !reduced;
  const fieldId = `send-${replayKey}-${sent.length}`;

  return (
    <LayoutGroup id={`send-${mode}`}>
      <Stage>
        <Transcript>
          <Row side="start"><BotBubble>Morning! Where are we going this time?</BotBubble></Row>
          {sent.map((one, index) => {
            const id = `send-${replayKey}-${index}`;
            if (!flying) {
              return (
                <Arrive key={one.id} side="end" reduced={reduced || mode !== "original"}>
                  {mode !== "original" ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: dur.fast }}><UserBubble>{one.text}</UserBubble></motion.div>
                  ) : <UserBubble>{one.text}</UserBubble>}
                </Arrive>
              );
            }
            return (
              <Row key={one.id} side="end">
                <motion.div
                  layoutId={id}
                  layout="position"
                  data-chat-bubble="simple"
                  initial={mode === "b" ? { scale: 0.92 } : false}
                  animate={{ scale: 1 }}
                  style={{ originX: 1, originY: 1 }}
                  transition={mode === "b" ? spring.enter : spring.layout}
                  className={cn(SIMPLE_USER_BUBBLE, "chat-text relative isolate w-fit max-w-[80%] !bg-transparent [overflow-wrap:anywhere]")}
                >
                  {/* the fill arrives under the flying words, so they lift off the field and land as a bubble */}
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 -z-[1] rounded-[inherit]"
                    style={userFill(AMY.color)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: dur.swap, ease: ease.out }}
                  />
                  {one.text}
                </motion.div>
              </Row>
            );
          })}
          {sent.length > 0 && <StatusLine key={sent.length} bot={AMY} state="thinking" />}
        </Transcript>
        <Composer
          value={value}
          onChange={setValue}
          onSend={send}
          placeholder="Message Amy"
          field={
            <span className="relative block">
              <input
                aria-label="Message Amy"
                className={cn("w-full bg-transparent text-[15px] leading-[22px] outline-none placeholder:text-ink-tertiary", flying ? "text-transparent caret-ink" : "text-ink")}
                placeholder="Message Amy"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
              />
              {flying && value && (
                <motion.span layoutId={fieldId} layout="position" aria-hidden="true" className="pointer-events-none absolute inset-0 truncate text-[15px] leading-[22px] text-ink">
                  {value}
                </motion.span>
              )}
            </span>
          }
          send={
            <SendButton onClick={send} disabled={!value.trim()}>
              {mode === "b" && !reduced ? (
                <span className="relative grid size-4 overflow-hidden">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={count}
                      className="[grid-area:1/1]"
                      initial={{ y: 12, opacity: 0 }}
                      animate={{ y: 0, opacity: 1, transition: { delay: 0.12, duration: dur.swap, ease: ease.out } }}
                      exit={{ y: -14, opacity: 0, transition: { duration: dur.exit, ease: ease.out } }}
                    >
                      <ArrowUp size={16} strokeWidth={1.75} absoluteStrokeWidth />
                    </motion.span>
                  </AnimatePresence>
                </span>
              ) : undefined}
            </SendButton>
          }
        />
      </Stage>
    </LayoutGroup>
  );
}

export const sending: Item = {
  id: "sending",
  title: "Sending (composer text into the bubble)",
  surface: "chat",
  height: 320,
  loopMs: 2600,
  notes: {
    original: "Field clears at once; your bubble is inserted whole and rises 12px over 240ms cubic-bezier(.23,1,.32,1), no fade (rowEnter). Send presses to 0.96. Status line shows at once.",
    a: "Your words fly from the field to their bubble (shared layoutId, position only, spring bounce 0 / 0.3s) while the fill fades in under them in 200ms. Reduced: fill fades in place, 150ms.",
    b: "A's flight on the enter spring 300/22 with the bubble growing .92 to 1 from its tail corner; the send arrow lifts out (120ms) and a fresh one rises back in (200ms, +120ms). Motion, MIT.",
  },
  Original: (p) => <Sending {...p} mode="original" />,
  A: (p) => <Sending {...p} mode="a" />,
  B: (p) => <Sending {...p} mode="b" />,
};
