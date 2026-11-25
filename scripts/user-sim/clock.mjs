// Preloaded into the server (node --import) so the whole process lives on a shifted wall clock: Date.now(), new Date()
// and Date() read real time plus the offset in milliseconds kept in the file named by TZ_SHIFT_FILE. The file is read
// at most every 250 ms. Timers still run on real time; dusk bot's due timer looks at the wall clock every minute, so a
// routine whose time the shift passes starts within a minute.
import { readFileSync } from "node:fs";

const file = process.env.TZ_SHIFT_FILE;
if (file) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  let offset = 0;
  let readAt = -Infinity;
  const shift = () => {
    const t = realNow();
    if (t - readAt > 250) {
      readAt = t;
      try { offset = Number(readFileSync(file, "utf8").trim()) || 0; } catch { /* keep the last offset */ }
    }
    return offset;
  };
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(realNow() + shift());
      else super(...args);
    }
    static now() { return realNow() + shift(); }
  }
  // Date() called as a function returns a string of now
  const DateFn = new Proxy(ShiftedDate, { apply: () => new ShiftedDate().toString() });
  globalThis.Date = DateFn;
}
