// The looks the lyrics can be shown in. Each one is a block of CSS in style.css keyed
// on <html data-style="...">; this file only names them and decides which is in use.

export const STYLES = [
  { id: 'classic', name: 'Classic', anchor: 0.4 },      // scrolling list over the blurred cover
  { id: 'kinetic', name: 'Kinetic', anchor: 0.42 },     // black words flying onto light paper
  { id: 'spotlight', name: 'Spotlight', anchor: 0.45 }, // one huge line at a time
  { id: 'neon', name: 'Neon', anchor: 0.4 },            // glowing sign lettering
  { id: 'terminal', name: 'Terminal', anchor: 0.55 },   // typed out on a green screen
];

// A choice is one of the styles, or "shuffle": a different style for every song.
export const SHUFFLE = 'shuffle';

export function isChoice(id) {
  return id === SHUFFLE || STYLES.some(function (style) { return style.id === id; });
}

export function styleInfo(id) {
  return STYLES.find(function (style) { return style.id === id; }) || STYLES[0];
}

// The choice after `id` in the order the Style button steps through.
export function nextChoice(id) {
  const order = STYLES.map(function (style) { return style.id; }).concat(SHUFFLE);
  return order[(order.indexOf(id) + 1) % order.length];
}

// A stable 32-bit number for a string, so a song always gets the same look. FNV-1a,
// then a final scramble so that strings differing by one character land far apart.
export function hash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// The same, as a number from 0 up to (not including) 1.
export function unit(text) {
  return hash(text) / 4294967296;
}

// Shuffle's pick for a song: decided by the song, but never the same style twice running.
export function shuffled(trackId, previous) {
  let index = hash(trackId) % STYLES.length;
  if (STYLES[index].id === previous) index = (index + 1) % STYLES.length;
  return STYLES[index].id;
}
