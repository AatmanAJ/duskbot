import { Fragment } from "react";
import { findHiddenCharacters, revealHiddenCharacters, type HiddenCharacter } from "../../shared/hidden-characters";
import { TriangleAlert } from "../icons";

import { t } from "@/lib/i18n";

function HiddenMark({ hidden }: { hidden: HiddenCharacter }) {
  const label = hidden.name === hidden.code ? t("hiddenChars.markCode", { code: hidden.code }) : t("hiddenChars.mark", { name: hidden.name, code: hidden.code });
  return (
    <span role="img" aria-label={label} title={label} data-hidden-char={hidden.code}
      className="mx-px inline-block rounded-[4px] bg-warning/15 px-1 align-baseline font-mono text-[11px] leading-[15px] text-warning [direction:ltr] [unicode-bidi:isolate]">
      {hidden.code}
    </span>
  );
}

/** Text with every character a reader cannot see drawn as a mark naming it, so a command reads as what will run. */
export function RevealedText({ text }: { text: string }) {
  return (
    <>
      {revealHiddenCharacters(text).map((part, index) => ("text" in part
        ? <Fragment key={index}>{part.text}</Fragment>
        : <HiddenMark key={index} hidden={part.hidden} />))}
    </>
  );
}

export function HiddenCharactersNote({ text }: { text: string }) {
  const count = findHiddenCharacters(text).length;
  if (!count) return null;
  return (
    <p role="note" className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-[18px] text-warning">
      <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{count === 1 ? t("hiddenChars.note.one") : t("hiddenChars.note.many", { count })}</span>
    </p>
  );
}
