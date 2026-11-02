export type FluidHoverMeasureKind = "reflow" | "item";

type RectLike = { left: number; top: number; width: number; height: number } | undefined;

/**
 * Pointer move: a new session (cursor entered the container, or nothing is active yet)
 * fades in place; a move inside the session glides.
 */
export function pointerMotion(session: {
  sessionPending: boolean;
  activeKey: unknown;
}): "fresh" | "spring" {
  return session.sessionPending || session.activeKey === null ? "fresh" : "spring";
}

/**
 * Remeasure: the highlight only reacts when the active item's rect really changed.
 * A reflow (container resized, window resized, scrolled, item added or moved) snaps.
 * A size change of an item by itself (e.g. hover reveals a button) glides.
 */
export function measureMotion(
  kind: FluidHoverMeasureKind,
  activeRectChanged: boolean,
): "snap" | "spring" | "none" {
  if (!activeRectChanged) return "none";
  return kind === "reflow" ? "snap" : "spring";
}

/** Coalesces measure requests made in the same frame; a reflow wins over an item change. */
export function mergeMeasureKind(
  current: FluidHoverMeasureKind | null,
  next: FluidHoverMeasureKind,
): FluidHoverMeasureKind {
  if (current === "reflow" || next === "reflow") return "reflow";
  return "item";
}

export function rectsEqual(a: RectLike, b: RectLike): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}
