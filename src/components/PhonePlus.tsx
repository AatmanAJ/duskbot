// The phone composer's round + (Composer.tsx): the + menu, and its mic slipping back into the round button.
import type { ComponentProps } from "react";

import { Mic } from "../icons";
import { ComposerPlusMenu } from "./ComposerPlusMenu";

type PhonePlusProps = Pick<ComponentProps<typeof ComposerPlusMenu>, "onAttach" | "attachChoices" | "goal" | "teach" | "approval" | "callBotId">;

/** The phone composer's round +: attach, Finish together, approval level and call mode. */
export function PhonePlus(props: PhonePlusProps) {
  return <ComposerPlusMenu {...props} circle />;
}

/** The phone mic slipping back into the round button as the field empties (composer-mic-out), where it stood beside it. */
export function PhoneMicGhost() {
  return (
    <span aria-hidden="true" data-composer-mic-ghost="" className="composer-mic-out pointer-events-none absolute inset-y-0 my-auto flex size-10 items-center justify-center rounded-full">
      <Mic size={16} strokeWidth={1.75} absoluteStrokeWidth className="[&_rect]:fill-current" />
    </span>
  );
}
