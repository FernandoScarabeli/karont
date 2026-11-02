const wordPattern = /\s+|[^\s]+/gu;
const tokenPattern = /\S+\s*|\s+/gu;
const markdownMarkerPattern = /(`+|\*\*|__|~~|\*|_)/gu;

const BASE_WORDS_PER_SECOND = 18;
const WORDS_PER_SECOND_PER_BACKLOG_WORD = 3;
const MAX_WORDS_PER_SECOND = 120;
// Safety valve: an open marker holds the text only for this many characters.
// Backtick runs get a longer allowance because code spans can be long.
const MARKER_HOLD_CHARS = 120;
const CODE_HOLD_CHARS = 200;
const DRAIN_MS = 350;
const MIN_DRAIN_MS = 16;
const BASE_CHARS_PER_SECOND = 220;
const CHARS_PER_SECOND_PER_BACKLOG_CHAR = 1.5;
const MAX_CHARS_PER_SECOND = 1200;

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

// Tokens are a word plus the whitespace after it. A cut is only allowed where
// no markdown marker is left open, so a token never shows half of `code`,
// **strong** or a fence. A bare word at the end of streamed text is not a token
// yet: it may still grow. When done, every remaining character is a token.
// `valve: true` ignores open-marker holds (used when the stream stalls).
export function splitIntoTokens(text, done = false, { valve = false } = {}) {
  const unsafeRanges = done || valve ? [] : getUnsafeRanges(text);
  const tokens = [];
  let tokenStart = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const endsWithSpace = /\s$/u.test(match[0]);
    if (!endsWithSpace && !done) break;
    if (unsafeRanges.some(([start, limit]) => start < end && end < limit)) continue;
    tokens.push({ value: text.slice(tokenStart, end), start: tokenStart, end });
    tokenStart = end;
  }

  return tokens;
}

// Adaptive pace in words per second: it rises with the backlog so the reveal
// never falls far behind the incoming text.
export function getWordsPerSecond(backlogWords) {
  const backlog = Math.max(0, backlogWords);
  return Math.min(
    MAX_WORDS_PER_SECOND,
    BASE_WORDS_PER_SECOND + backlog * WORDS_PER_SECOND_PER_BACKLOG_WORD,
  );
}

// Returns how many whole tokens to release in this frame. The fractional part
// is carried to the next frame, so the reveal never steps back. After the
// stream is done, the backlog drains linearly toward a deadline of drainMsLeft
// (350 ms), so the tail finishes in about 400 ms.
export function planWordRelease({
  backlogWords,
  elapsedMs,
  done = false,
  carryWords = 0,
  drainMsLeft = DRAIN_MS,
}) {
  const plan = planRelease({
    backlog: backlogWords,
    elapsedMs,
    done,
    carry: carryWords,
    drainMsLeft,
    ratePerSecond: getWordsPerSecond(backlogWords),
  });
  return { count: plan.count, carryWords: plan.carry, drainMsLeft: plan.drainMsLeft };
}

// Adaptive pace for the typewriter: base ~220 chars/s, rising with the backlog
// so the reveal never lags more than about a second.
export function getCharsPerSecond(backlogChars) {
  return Math.min(
    MAX_CHARS_PER_SECOND,
    BASE_CHARS_PER_SECOND + Math.max(0, backlogChars) * CHARS_PER_SECOND_PER_BACKLOG_CHAR,
  );
}

export function planCharRelease({
  backlogChars,
  elapsedMs,
  done = false,
  carryChars = 0,
  drainMsLeft = DRAIN_MS,
}) {
  const plan = planRelease({
    backlog: backlogChars,
    elapsedMs,
    done,
    carry: carryChars,
    drainMsLeft,
    ratePerSecond: getCharsPerSecond(backlogChars),
  });
  return { count: plan.count, carryChars: plan.carry, drainMsLeft: plan.drainMsLeft };
}

// Shared release core: linear drain toward a deadline once done, otherwise a
// rate-based release with the fractional part carried to the next frame.
function planRelease({ backlog, elapsedMs, done, carry, drainMsLeft, ratePerSecond }) {
  if (backlog <= 0) return { count: 0, carry: 0, drainMsLeft: DRAIN_MS };

  const elapsed = Math.max(0, elapsedMs);
  const rate = done
    ? Math.max(ratePerSecond, (backlog * 1000) / Math.max(drainMsLeft, MIN_DRAIN_MS))
    : ratePerSecond;
  const accumulated = carry + (rate * elapsed) / 1000;
  const count = Math.min(backlog, Math.floor(accumulated));

  return {
    count,
    carry: count === backlog ? 0 : accumulated - count,
    drainMsLeft: done ? Math.max(0, drainMsLeft - elapsed) : DRAIN_MS,
  };
}

// Highest text length the typewriter may reveal. While streaming, a fence
// opening line (```lang or ~~~) is held back until its newline arrives, so the
// caret never sits inside the opener.
export function getRevealCeiling(text, done = false) {
  if (done) return text.length;
  const lineStart = text.lastIndexOf("\n") + 1;
  const tail = text.slice(lineStart);
  if (/^ {0,3}(?:`{1,2}|~{1,2})$/u.test(tail) || /^ {0,3}(?:`{3,}|~{3,})/u.test(tail)) {
    return lineStart;
  }
  return text.length;
}

// Ranges [start, limit) where a cut at position p would split a marker pair.
// A cut at p is unsafe when start < p < limit.
function getUnsafeRanges(text) {
  const fencedRanges = getFencedRanges(text);
  const ranges = [];

  for (const range of fencedRanges) {
    ranges.push([range.openStart, range.openEnd]);
    if (range.closeStart !== null) ranges.push([range.closeStart, range.closeEnd]);
  }

  const waiting = new Map();
  for (const marker of getInlineMarkers(text, fencedRanges)) {
    const open = waiting.get(marker.value);
    if (open && marker.canClose) {
      ranges.push([open.start, Math.min(marker.end, open.start + holdChars(open.value) + 1)]);
      waiting.delete(marker.value);
    } else if (marker.canOpen) {
      waiting.set(marker.value, marker);
    }
  }
  for (const open of waiting.values()) {
    ranges.push([open.start, open.start + holdChars(open.value) + 1]);
  }

  return ranges;
}

function holdChars(markerValue) {
  return markerValue.startsWith("`") ? CODE_HOLD_CHARS : MARKER_HOLD_CHARS;
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

    const before = text[start - 1] ?? "";
    const after = text[end] ?? "";
    // `_` or `__` between letters or digits (nome_arquivo) is plain text.
    if (/_/u.test(match[0][0] ?? "") && isWordCharacter(before) && isWordCharacter(after)) continue;
    // A marker followed by whitespace cannot open; preceded by whitespace cannot close.
    const canOpen = !isBlank(after);
    const canClose = !isBlank(before);
    if (!canOpen && !canClose) continue;

    markers.push({ value: match[0], start, end, canOpen, canClose });
  }
  return markers;
}

function isWordCharacter(character) {
  return /[\p{L}\p{N}]/u.test(character);
}

function isBlank(character) {
  return character === "" || /\s/u.test(character);
}
