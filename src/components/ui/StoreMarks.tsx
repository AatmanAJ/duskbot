import { cn } from "@/lib/cn";

/* the store marks in the app's pixel style: the rainbow apple and the green robot, drawn with gpt-image, snapped to their
   native grid, then put in the brand pastels with each stripe outlined in a deeper shade of its own colour (PlaceArt's
   rule). a row is a string; "." is empty. */
const COLORS: Record<string, string> = {
  g: "#a6dd6c", y: "#f6dc62", o: "#f8b766", R: "#ef8282", v: "#b99af2", b: "#7cc6f2",
  6: "#5f9e34", 4: "#d19a1c", 5: "#c97f2c", 7: "#c94f4f", 2: "#8a6fd0", 1: "#3f8fc9",
};

const MARKS = {
  apple: [
    "............666...",
    "...........6gg6...",
    "..........6ggg6...",
    "........66ggg6....",
    "........66gg6.....",
    "........6666......",
    "....666666..666...",
    "...6gggg6666ggg6..",
    "..6gggggg6gggggg6.",
    ".6ggggggggggggggg6",
    ".4yyyyyyyyyyyyyy4.",
    "4yyyyyyyyyyyyyy4..",
    "5ooooooooooooo5...",
    "5ooooooooooooo5...",
    "7RRRRRRRRRRRRR7...",
    "7RRRRRRRRRRRRRR7..",
    ".2vvvvvvvvvvvvvv2.",
    ".2vvvvvvvvvvvvvvv2",
    "..1bbbbbbbbbbbbb1.",
    "...1bbbbbbbbbbb1..",
    "....1bbb111bbb1...",
    ".....111...111....",
  ],
  android: [
    "....66..........66....",
    "....6g6........6g6....",
    ".....6g6......6g6.....",
    "......6g666666g6......",
    "......66gggggg66......",
    ".....6gggggggggg6.....",
    "....6gggggggggggg6....",
    "....6gg6gggggg6gg6....",
    "...6gggggggggggggg6...",
    "...6gggggggggggggg6...",
    "...6666666666666666...",
    ".66.6gggggggggggg6.66.",
    "6gg66gggggggggggg66gg6",
    "6ggg6gggggggggggg6ggg6",
    "6ggg6gggggggggggg6ggg6",
    "6ggg6gggggggggggg6ggg6",
    "6ggg6gggggggggggg6ggg6",
    "6ggg6gggggggggggg6ggg6",
    ".6666gggggggggggg6.66.",
    "....66gggggggggg66....",
    ".....66gg6666gg66.....",
    "......6gg6..6gg6......",
    "......6gg6..6gg6......",
    "......6gg6..6gg6......",
    ".......66....66.......",
  ],
} as const;

export type StoreMarkName = keyof typeof MARKS;

const DRAWN = Object.fromEntries(Object.entries(MARKS).map(([name, rows]) => {
  const out: { x: number; y: number; w: number; c: string }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end += 1;
      if (row[x] !== ".") out.push({ x, y, w: end - x, c: row[x]! });
      x = end;
    }
  });
  return [name, { runs: out, w: rows[0]!.length, h: rows.length }];
})) as Record<StoreMarkName, { runs: { x: number; y: number; w: number; c: string }[]; w: number; h: number }>;

/** `scale` css px per cell: 1 is crisp on a retina screen, 2 for a bigger mark */
export function StoreMark({ name, scale = 1, className }: { name: StoreMarkName; scale?: number; className?: string }) {
  const mark = DRAWN[name];
  return (
    <svg aria-hidden="true" data-store-mark={name} width={mark.w * scale} height={mark.h * scale} viewBox={`0 0 ${mark.w} ${mark.h}`}
      shapeRendering="crispEdges" className={cn("shrink-0", className)}>
      {mark.runs.map((run) => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={COLORS[run.c]} />)}
    </svg>
  );
}
