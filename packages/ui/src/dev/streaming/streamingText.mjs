const wordPattern = /\s+|[^\s]+/gu;
const markdownMarkerPattern = /(`+|\*\*|__|~~|\*|_)/gu;

export function splitIntoWords(text) {
  return Array.from(text.matchAll(wordPattern), (match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return {
      value,
      start,
      end: start + value.length,
      kind: /^\s+$/u.test(value) ? "space" : "word",
    };
  });
}

export function getSafeRevealLength(text, currentLength, requestedLength, done = false) {
  const start = Math.min(text.length, Math.max(0, currentLength));
  if (done) return text.length;

  let target = Math.min(text.length, Math.max(start, requestedLength));
  if (target <= start) return start;

  target = findWordBoundary(text, start, target);
  if (target <= start) return start;

  return findMarkdownBoundary(text, start, target);
}

function findWordBoundary(text, start, target) {
  let boundary = target;
  while (boundary > start && !isWordSeparator(text[boundary - 1] ?? "")) boundary -= 1;
  return boundary;
}

function isWordSeparator(character) {
  return /[\s.,!?;:()[\]{}<>*_`~]/u.test(character);
}

function findMarkdownBoundary(text, start, target) {
  let safe = target;
  const fencedRanges = getFencedRanges(text);

  for (const range of fencedRanges) {
    if (range.openStart < safe && safe < range.openEnd) safe = range.openStart;
    if (range.closeStart !== null && range.closeStart < safe && safe < range.closeEnd) {
      safe = range.closeStart;
    }
  }

  const markers = getInlineMarkers(text, fencedRanges);
  const waiting = new Map();
  const pairs = [];

  for (const marker of markers) {
    const open = waiting.get(marker.value);
    if (open) {
      pairs.push({ open, close: marker });
      waiting.delete(marker.value);
    } else {
      waiting.set(marker.value, marker);
    }
  }

  for (const { open, close } of pairs) {
    if (open.start < safe && safe < close.end) safe = Math.min(safe, open.start);
  }
  for (const open of waiting.values()) {
    if (open.start < safe && safe >= open.end) safe = Math.min(safe, open.start);
  }

  return Math.max(start, safe);
}

function getFencedRanges(text) {
  const ranges = [];
  let open = null;
  let offset = 0;
  const lines = text.split("\n");

  for (const [index, line] of lines.entries()) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (match?.[1]) {
      const marker = match[1];
      const markerStart = offset + (line.match(/^ */u)?.[0].length ?? 0);
      const markerEnd = markerStart + marker.length;
      if (!open) {
        open = { marker: marker[0], length: marker.length, start: markerStart, end: markerEnd };
        ranges.push({
          openStart: markerStart,
          openEnd: markerEnd,
          closeStart: null,
          closeEnd: null,
        });
      } else if (
        marker[0] === open.marker &&
        marker.length >= open.length &&
        /^\s*$/u.test(match[2] ?? "")
      ) {
        const range = ranges.at(-1);
        if (range) {
          range.closeStart = markerStart;
          range.closeEnd = markerEnd;
        }
        open = null;
      }
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }

  return ranges;
}

function getInlineMarkers(text, fencedRanges) {
  const markers = [];
  for (const match of text.matchAll(markdownMarkerPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      fencedRanges.some(
        (range) =>
          (start >= range.openStart && end <= range.openEnd) ||
          (range.closeStart !== null && start >= range.closeStart && end <= range.closeEnd),
      )
    ) {
      continue;
    }
    if (
      fencedRanges.some(
        (range) =>
          start >= range.openEnd && (range.closeStart === null || start < range.closeStart),
      )
    ) {
      continue;
    }
    if (start > 0 && text[start - 1] === "\\") continue;
    markers.push({ value: match[0], start, end });
  }
  return markers;
}
