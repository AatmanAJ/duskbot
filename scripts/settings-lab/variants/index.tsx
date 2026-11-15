import type { FC } from "react";

export type Variant = { id: string; n: number; name: string; idea: string; files: string[]; Component: FC };

function Soon() {
  return <div style={{ display: "grid", placeItems: "center", height: "100%" }}>settings variants are being built</div>;
}

export const VARIANTS: Variant[] = [
  { id: "soon", n: 1, name: "Soon", idea: "settings variants are being built.", files: ["variants/index.ts"], Component: Soon },
];
