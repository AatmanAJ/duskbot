import { LAYOUT_FOLLOW, ChatSurface, type ChatLabProps, type Spec } from "../surface";

// the reply's bubble is there from the first beat with three dots in it; the dots fade out where the first words fade
// in, and the same bubble springs to fit them, so the thinking and the reply are one row that never jumps
export const spec: Spec = {
  send: "glide", reply: "typing-bubble", stream: "word-fade", actions: "after", follow: LAYOUT_FOLLOW, gap: 28, lineWhileWriting: "mascot", instant: true,
};

export default function TypingBubble(props: ChatLabProps) {
  return <ChatSurface {...props} spec={spec} />;
}
