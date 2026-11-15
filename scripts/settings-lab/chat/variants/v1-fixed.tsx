import { APP_FOLLOW, ChatSurface, type ChatLabProps, type Spec } from "../surface";

// the app on main after the fix: the person's bubble lands whole while the view glides up on the rows' 240ms quint,
// the mascot says Typing while the reply is written, and the whole reply lands 80ms after the line starts leaving
export const spec: Spec = {
  send: "glide", reply: "whole", stream: "none", actions: "hover", follow: APP_FOLLOW, gap: 24, lineWhileWriting: "typing",
};

export default function FixedCurrent(props: ChatLabProps) {
  return <ChatSurface {...props} spec={spec} />;
}
