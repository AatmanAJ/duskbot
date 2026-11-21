import { createContext } from "react";

/** A page that slides in paints its newest rows first and mounts the older ones once it has landed: `afterSlide` runs
 * `step` at once when nothing is sliding, or when the slide lands, and returns its cancel. */
export interface TranscriptStaging {
  afterSlide?: (step: () => void) => () => void;
}

export const TranscriptStaging = createContext<TranscriptStaging>({});
