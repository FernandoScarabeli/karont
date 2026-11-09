import { DotMoon } from "./DotMoon.tsx";
import { DotPixel } from "./DotPixel.tsx";
import { DotPoint } from "./DotPoint.tsx";

export type DotCharacterId = "point" | "moon" | "pixel";

export const dotCharacters = [
  { id: "point", name: "A · Ponto", Component: DotPoint },
  { id: "moon", name: "B · Lua", Component: DotMoon },
  { id: "pixel", name: "C · Pixel", Component: DotPixel },
] as const satisfies readonly { id: DotCharacterId; name: string; Component: unknown }[];

export function characterComponent(id: DotCharacterId) {
  const found = dotCharacters.find((character) => character.id === id);
  return (found ?? dotCharacters[0]).Component;
}
