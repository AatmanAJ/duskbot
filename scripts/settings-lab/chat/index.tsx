import type { FC } from "react";
import type { ChatLabProps } from "./surface";
import FixedCurrent from "./variants/v1-fixed";
import GrowFromMascot from "./variants/v2-grow";
import RiseAndAppend from "./variants/v3-rise";
import TypingBubble from "./variants/v4-typing-bubble";
import ThinkingInBubble from "./variants/v5-in-bubble";
import CalmFollow from "./variants/v6-calm";

export type { ChatLabProps };
export type ChatVariant = { id: string; name: string; idea: string; file: string; Component: FC<ChatLabProps> };

export default {
  variants: [
    { id: "fixed-current", name: "Fixed current", file: "chat/variants/v1-fixed.tsx", Component: FixedCurrent,
      idea: "the app on main after today's fix: rows land whole while the view glides up 240ms, Typing until the reply lands whole." },
    { id: "grow", name: "Grow from the mascot", file: "chat/variants/v2-grow.tsx", Component: GrowFromMascot,
      idea: "the words leave the composer into your bubble; the reply grows out of the mascot, all at once." },
    { id: "rise", name: "Rise and append", file: "chat/variants/v3-rise.tsx", Component: RiseAndAppend,
      idea: "your bubble rises in, the reply fades up 8px, all at once." },
    { id: "typing-bubble", name: "Typing bubble that grows", file: "chat/variants/v4-typing-bubble.tsx", Component: TypingBubble,
      idea: "the reply's bubble shows three dots from the first beat, then the dots crossfade into the whole reply in the same bubble." },
    { id: "in-bubble", name: "Thinking inside the bubble", file: "chat/variants/v5-in-bubble.tsx", Component: ThinkingInBubble,
      idea: "the thinking or tool line sits inside the reply bubble and crossfades into the whole reply." },
    { id: "calm", name: "Calm follow", file: "chat/variants/v6-calm.tsx", Component: CalmFollow,
      idea: "a soft spring follows every growth as one move, Typing until the reply opens at the mascot, all at once." },
  ] satisfies ChatVariant[],
};
