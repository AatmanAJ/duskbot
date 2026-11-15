import { SOFT_FOLLOW, ChatSurface, type ChatLabProps, type Spec } from "../surface";

// the calmest: the sent bubble lands whole and the view follows on a soft spring that blends every small growth into
// one move; the reply opens from 0.97 at the mascot's line, words fade in at a steady cadence, the mascot keeps saying
// Typing until the end, and the copy row fades in after
export const spec: Spec = {
  send: "glide", reply: "grow", stream: "word-fade", actions: "after", follow: SOFT_FOLLOW, gap: 32, lineWhileWriting: "typing", instant: true,
};

export default function CalmFollow(props: ChatLabProps) {
  return <ChatSurface {...props} spec={spec} />;
}
