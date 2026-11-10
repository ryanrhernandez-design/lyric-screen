import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords, wordTimes, wordsSungAt } from '../js/words.js';
import { STYLES, SHUFFLE, isChoice, styleInfo, nextChoice, shuffled, hash, unit } from '../js/styles.js';

test('splitWords splits on any whitespace and drops empties', () => {
  assert.deepEqual(splitWords('  one  two\tthree '), ['one', 'two', 'three']);
  assert.deepEqual(splitWords(''), []);
});

test('wordTimes starts at the line and stays inside it', () => {
  const words = splitWords('Press play on your phone');
  const times = wordTimes(words, 10000, 12000);
  assert.equal(times.length, words.length);
  assert.equal(times[0], 10000);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], 'times rise');
  assert.ok(times[times.length - 1] < 12000, 'the last word starts before the next line');
});

test('wordTimes gives longer words more time', () => {
  const times = wordTimes(['a', 'extraordinary', 'b'], 0, 100000);
  assert.ok(times[2] - times[1] > times[1] - times[0]);
});

test('wordTimes does not stretch a short line across a long break', () => {
  const times = wordTimes(['oh', 'no'], 0, 60000);
  assert.ok(times[1] < 2000, 'the second word comes soon after the first, not half a minute later');
  assert.deepEqual(wordTimes(['oh', 'no'], 0), times, 'the last line of a song is paced the same way');
});

test('wordTimes copes with an empty line', () => {
  assert.deepEqual(wordTimes([], 5000, 9000), []);
});

test('wordsSungAt counts the words that have started', () => {
  const times = [1000, 1500, 2200];
  assert.equal(wordsSungAt(times, 999), 0);
  assert.equal(wordsSungAt(times, 1000), 1);
  assert.equal(wordsSungAt(times, 2199), 2);
  assert.equal(wordsSungAt(times, 99999), 3);
});

test('nextChoice steps through every style, then shuffle, then round again', () => {
  const seen = [];
  let choice = STYLES[0].id;
  for (let i = 0; i < STYLES.length + 1; i++) {
    seen.push(choice);
    choice = nextChoice(choice);
  }
  assert.deepEqual(seen, STYLES.map((style) => style.id).concat(SHUFFLE));
  assert.equal(choice, STYLES[0].id);
});

test('isChoice accepts styles and shuffle only', () => {
  assert.ok(isChoice('kinetic'));
  assert.ok(isChoice(SHUFFLE));
  assert.ok(!isChoice('nope'));
  assert.ok(!isChoice(null));
  assert.equal(styleInfo('nope').id, 'classic');
});

test('shuffled is steady for a song and never repeats the previous style', () => {
  assert.equal(shuffled('track-1', ''), shuffled('track-1', ''));
  for (let i = 0; i < 50; i++) {
    const previous = STYLES[i % STYLES.length].id;
    assert.notEqual(shuffled('track-' + i, previous), previous);
  }
  const used = new Set();
  for (let i = 0; i < 200; i++) used.add(shuffled('song-' + i, ''));
  assert.equal(used.size, STYLES.length, 'every style turns up');
});

test('hash spreads near-identical strings apart', () => {
  assert.equal(hash('abc'), hash('abc'));
  const values = [];
  for (let i = 0; i < 20; i++) values.push(unit('demo:3:' + i + 'x'));
  values.forEach((value) => assert.ok(value >= 0 && value < 1));
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread > 0.6, 'values cover most of the range, got ' + spread.toFixed(2));
});
