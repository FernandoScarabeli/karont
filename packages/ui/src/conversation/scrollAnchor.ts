export function adjustScrollTopForAnchor(
  scrollTop: number,
  anchorTopBefore: number,
  anchorTopAfter: number,
): number {
  return scrollTop + anchorTopAfter - anchorTopBefore;
}
