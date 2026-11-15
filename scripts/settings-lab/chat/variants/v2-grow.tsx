import { LAYOUT_FOLLOW, ChatSurface, type ChatLabProps, type Spec } from "../surface";

// the words leave the composer and settle into the sent bubble as its fill comes in; the reply grows out of the
// mascot's corner and streams word by word at a steady cadence; the copy row fades in after the last word, into room
// kept for it from the start
export const spec: Spec = {
  send: "morph", reply: "grow", stream: "word-fade", actions: "after", follow: LAYOUT_FOLLOW, gap: 28, lineWhileWriting: "mascot",
};

export default function GrowFromMascot(props: ChatLabProps) {
  return <ChatSurface {...props} spec={spec} />;
}
