import type { Dot, DotFields } from "@karont/contract";

export const dotFields = (dot: Dot): DotFields => ({
  name: dot.name,
  color: dot.color,
  enabled: dot.enabled,
  personality: { ...dot.personality },
});
export function dotPatch(baseline: DotFields, draft: DotFields): Partial<DotFields> {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key as keyof DotFields]),
    ),
  );
}
export function mergeDotDraft(previous: Dot, draft: DotFields, incoming: Dot): DotFields {
  return { ...dotFields(incoming), ...dotPatch(dotFields(previous), draft) };
}
