export function removeSkillMentions(text: string, skillNames: readonly string[]): string {
  if (skillNames.length === 0) return text;

  const names = [...new Set(skillNames)]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) return text;

  // Mirrors findMentionedSkills: a mention starts at the beginning or after whitespace,
  // and trailing punctuation is a delimiter rather than part of the skill name.
  const mention = new RegExp(
    `(?<!\\S)\\$(?:${names.join("|")})(?=$|\\s|\\$|[.,;:!?)]|["'‘’“”])`,
    "gu",
  );
  const result: string[] = [];
  let cursor = 0;
  let removed = false;

  for (const match of text.matchAll(mention)) {
    const start = match.index;
    const end = start + match[0].length;
    result.push(text.slice(cursor, start));
    let next = end;
    while (next < text.length && /\s/u.test(text[next] ?? "")) next += 1;
    if (next === end && /[.,;:!?)]|["'‘’“”]/u.test(text[end] ?? "")) {
      const last = result.length - 1;
      result[last] = (result[last] ?? "").trimEnd();
    }
    cursor = next;
    removed = true;
  }

  if (!removed) return text;
  result.push(text.slice(cursor));
  return result.join("").trim();
}
