import { APP_FOLLOW, ChatSurface, type ChatLabProps, type Spec } from "../surface";

// the sent bubble rises 16px as it fades in; the reply fades up 8px and its text appends smoothly with no per-word
// fade; the line keeps only the mascot while it writes
export const spec: Spec = {
  send: "rise", reply: "fade-rise", stream: "smooth", actions: "after", follow: APP_FOLLOW, gap: 28, lineWhileWriting: "mascot",
};

export default function RiseAndAppend(props: ChatLabProps) {
  return <ChatSurface {...props} spec={spec} />;
}
