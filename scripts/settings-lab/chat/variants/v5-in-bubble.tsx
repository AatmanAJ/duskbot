import { LAYOUT_FOLLOW, ChatSurface, type ChatLabProps, type Spec } from "../surface";

// the words leave the composer into the sent bubble; the reply bubble opens with its thinking line (or the tool it
// is using) inside, which crossfades into the words in place; a caret rides the end while it writes and fades at finish
export const spec: Spec = {
  send: "morph", reply: "in-bubble", stream: "caret", actions: "after", follow: LAYOUT_FOLLOW, gap: 28, lineWhileWriting: "mascot",
};

export default function ThinkingInBubble(props: ChatLabProps) {
  return <ChatSurface {...props} spec={spec} />;
}
