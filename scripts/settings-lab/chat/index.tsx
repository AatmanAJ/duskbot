import type { FC } from "react";

export type ChatLabProps = { speed: number; reduced: boolean; skin: "grok" | "grok-dark"; replayKey: number };
export type ChatVariant = { id: string; name: string; idea: string; file: string; Component: FC<ChatLabProps> };

function Placeholder({ replayKey, speed, reduced, skin }: ChatLabProps) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--color-ink-secondary)" }}>
      chat lab placeholder · replay {replayKey} · {speed}x · {reduced ? "reduced" : "full"} motion · {skin}
    </div>
  );
}

export default {
  variants: [
    { id: "placeholder", name: "Placeholder", idea: "the chat lab's variants land here.", file: "chat/index.tsx", Component: Placeholder },
  ] satisfies ChatVariant[],
};
