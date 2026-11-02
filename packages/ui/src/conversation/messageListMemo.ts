export function areMessageListPropsEqual<T extends Record<string, unknown>>(
  previous: T,
  next: T,
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every(
    (key) => Object.hasOwn(next, key) && Object.is(previous[key], next[key]),
  );
}
