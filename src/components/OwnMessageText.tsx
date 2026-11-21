import type { ComponentProps } from "react";

import { hasQuotedLines, quotedRuns } from "@/lib/quote-selection";
import { ThreadRefText } from "./ThreadRefs";

/** A message the person sent, its `> ` lines drawn as a quote beside what they wrote. */
export function OwnMessageText(props: ComponentProps<typeof ThreadRefText>) {
  if (!hasQuotedLines(props.text)) return <ThreadRefText {...props} />;
  return (
    <>
      {quotedRuns(props.text).map((run, index) => {
        if (run.quote) {
          return (
            <blockquote key={index} data-own-quote="" className="my-0.5 border-s-2 border-current/35 ps-2.5 opacity-75">
              <ThreadRefText {...props} text={run.text} />
            </blockquote>
          );
        }
        const text = run.text.replace(/^\n+|\n+$/g, "");
        return text ? <div key={index}><ThreadRefText {...props} text={text} /></div> : null;
      })}
    </>
  );
}
