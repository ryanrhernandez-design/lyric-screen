// Splitting a lyric line into words and guessing when each word is sung.
// The lyrics service times whole lines, not words, so the words of a line share its
// time in proportion to their length. Good enough for words to light up one by one.

const PACE = 75;      // ms per unit of word weight at a natural singing pace
const STRETCH = 1.3;  // a line may be sung this much slower than that
const FILL = 0.92;    // ...but never runs into the next line

export function splitWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

function weight(word) {
  const letters = word.match(/[\p{L}\p{N}]/gu);
  return 1.5 + Math.min(letters ? letters.length : 1, 12);
}

// Start time in ms of each word in a line that starts at `start`. `next` is when the
// following line starts; leave it out for the last line.
export function wordTimes(words, start, next) {
  if (!words.length) return [];
  const weights = words.map(weight);
  const total = weights.reduce(function (sum, value) { return sum + value; }, 0);

  let span = total * PACE * STRETCH;
  if (typeof next === 'number' && next > start) span = Math.min(span, (next - start) * FILL);

  const times = [];
  let before = 0;
  for (let i = 0; i < weights.length; i++) {
    times.push(Math.round(start + span * before / total));
    before += weights[i];
  }
  return times;
}

// How many words have started by `positionMs`.
export function wordsSungAt(times, positionMs) {
  let count = 0;
  while (count < times.length && times[count] <= positionMs) count++;
  return count;
}
