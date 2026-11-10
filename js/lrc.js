// Parsing for time-stamped (LRC) lyrics, and finding the line for a playback position.

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/i;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

// "[01:02.50] Hello" -> [{ time: 62500, text: "Hello" }], sorted by time.
// Lines that carry several time tags are repeated; metadata tags are skipped.
export function parseLrc(lrc) {
  const lines = [];
  let offset = 0;

  String(lrc || '').split(/\r?\n/).forEach(function (raw) {
    const row = raw.trim();
    const off = OFFSET_TAG.exec(row);
    if (off) {
      offset = parseInt(off[1], 10) || 0;
      return;
    }

    const times = [];
    let end = 0;
    let match;
    TIME_TAG.lastIndex = 0;
    while ((match = TIME_TAG.exec(row))) {
      if (row.slice(end, match.index).trim() !== '') break; // tag is inside the text
      const fraction = ((match[3] || '') + '000').slice(0, 3);
      times.push(parseInt(match[1], 10) * 60000 + parseInt(match[2], 10) * 1000 + parseInt(fraction, 10));
      end = TIME_TAG.lastIndex;
    }
    if (!times.length) return;

    const text = row.slice(end).replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    times.forEach(function (time) {
      // A positive [offset:] means the lyrics should appear sooner.
      lines.push({ time: Math.max(0, time - offset), text: text });
    });
  });

  return lines
    .map(function (line, order) { return { line: line, order: order }; })
    .sort(function (a, b) { return a.line.time - b.line.time || a.order - b.order; })
    .map(function (entry) { return entry.line; });
}

// Index of the last line that has started at `positionMs`, or -1 before the first.
export function lineIndexAt(lines, positionMs) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

// Unsynced lyrics -> lines. Blank lines mark verse breaks; runs of them collapse to one.
export function splitPlain(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    const line = raw.trim();
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) return;
    out.push(line);
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// Drop the time tags from LRC text, for when the timing can't be trusted.
export function stripTimestamps(lrc) {
  return parseLrc(lrc).map(function (line) { return line.text; }).join('\n');
}
