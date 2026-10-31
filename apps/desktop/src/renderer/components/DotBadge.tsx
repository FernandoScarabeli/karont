type Props = { name: string };

function initials(name: string) {
  const normalized = name.trim();
  if (/codex/i.test(normalized)) return 'Cx';
  if (/claude/i.test(normalized) && /code/i.test(normalized)) return 'CC';
  if (/claude/i.test(normalized)) return 'Cl';
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1)
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
  return normalized.slice(0, 2).toUpperCase() || '?';
}

export function DotBadge({ name }: Props) {
  const identity = /codex/i.test(name) ? 'codex' : /claude/i.test(name) ? 'claude' : 'other';
  return (
    <span
      className={`kw-dot-badge is-${identity}`}
      role="img"
      aria-label={`Dot ${name}`}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
