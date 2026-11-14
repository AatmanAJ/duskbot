import { useState } from "react";
import { motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, spring, stagger } from "@lab/tokens";
import { ConversationalReply, useReplySegments } from "@/components/ConversationalReply";
import { Row, Stage, Transcript, UserBubble, cn, useScript, SIMPLE_BOT_BUBBLE } from "../kit";
import { Arrive } from "../shipped";

const FIRST = "Booked! IndiGo, Saturday 6:10.\n\nYour PNR is QX7T2M, it's in your email too.";
const MORE = `${FIRST}\n\nWant me to add the return to your calendar?`;
type Mode = "original" | "a" | "b";

function Arrival({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [text, setText] = useState<string | null>(null);
  useScript(replayKey, speed, [[0, () => setText(null)], [350, () => setText(FIRST)], [1500, () => setText(MORE)]]);
  return (
    <Stage>
      <Transcript>
        <Row side="end"><UserBubble>book the indigo one</UserBubble></Row>
        {text !== null && (mode === "original" ? <Shipped key={replayKey} text={text} reduced={reduced} /> : <Parts text={text} reduced={reduced} springy={mode === "b"} />)}
      </Transcript>
    </Stage>
  );
}

/** the real ConversationalReply: a reply that lands whole rises as one row, a part added later rises on its own (.reply-bubble-in) */
function Shipped({ text, reduced }: { text: string; reduced: boolean }) {
  const { segments, firstNew } = useReplySegments(true, text);
  return (
    <Arrive reduced={reduced}>
      <ConversationalReply segments={segments} firstNew={firstNew} renderSegment={(s) => <span className="chat-text">{s}</span>} />
    </Arrive>
  );
}

function Parts({ text, reduced, springy }: { text: string; reduced: boolean; springy: boolean }) {
  const parts = text.split("\n\n");
  const gap = springy ? 0.07 : stagger.in;
  return (
    <div className="flex w-full flex-col items-start gap-1">
      {parts.map((part, i) => {
        const last = i === parts.length - 1;
        return (
          <motion.div
            key={i}
            data-chat-bubble="simple"
            className={cn(SIMPLE_BOT_BUBBLE, "chat-text w-fit max-w-[85%] [overflow-wrap:anywhere]", springy ? "transition-[border-end-start-radius] duration-200" : !last ? "" : "rounded-es-[6px]")}
            initial={reduced ? { opacity: 0 } : springy ? { opacity: 0, y: 14, scale: 0.96 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reduced
              ? { duration: dur.fast }
              : springy
                ? { ...spring.enter, delay: (i % 2) * gap, opacity: { duration: dur.fast, delay: (i % 2) * gap } }
                : { duration: dur.swap, ease: ease.out, delay: (i % 2) * gap }}
            style={{ ...(springy ? { borderEndStartRadius: last ? 6 : 18 } : {}), originX: 0, originY: 1 }}
          >
            {part}
          </motion.div>
        );
      })}
    </div>
  );
}

export const arrival: Item = {
  id: "message-arrival",
  title: "Message arrival (a reply in parts)",
  surface: "chat",
  height: 300,
  loopMs: 2800,
  notes: {
    original: "Real ConversationalReply: a reply that lands whole rises as one 12px row over 240ms, no fade; a part added later rises 12px / 240ms on its own (.reply-bubble-in). The tail corner jumps to the new last part. (Shipped bug seen here: the parts carry no data-chat-bubble, so chat.css gives them no wash.)",
    a: "Each part fades up 8px over 200ms ease.out, 45ms after the one above. Tail corner moves with the new part.",
    b: "Parts enter on 300/22 from 14px and .96 (scaled from the tail corner), 70ms apart; the tail corner hands over to the new last part over 200ms.",
  },
  Original: (p) => <Arrival {...p} mode="original" />,
  A: (p) => <Arrival {...p} mode="a" />,
  B: (p) => <Arrival {...p} mode="b" />,
};
