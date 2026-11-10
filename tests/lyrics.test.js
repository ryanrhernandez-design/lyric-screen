import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lineIndexAt, splitPlain } from '../js/lrc.js';
import { pickBest, cleanTitle } from '../js/lyrics.js';

test('parseLrc reads minutes, seconds and fractions of any length', () => {
  const lines = parseLrc('[00:01.5] a\n[00:02.50] b\n[01:02.345] c\n[00:04] d');
  assert.deepEqual(lines, [
    { time: 1500, text: 'a' },
    { time: 2500, text: 'b' },
    { time: 4000, text: 'd' },
    { time: 62345, text: 'c' },
  ]);
});

test('parseLrc skips metadata, repeats multi-tag lines and applies [offset]', () => {
  const lines = parseLrc('[ar: Someone]\n[offset: 500]\n[00:10.00][00:20.00] chorus\nno tag here\n[00:15.00]');
  assert.deepEqual(lines, [
    { time: 9500, text: 'chorus' },
    { time: 14500, text: '' },
    { time: 19500, text: 'chorus' },
  ]);
});

test('parseLrc drops word-level tags and keeps brackets inside the text', () => {
  const lines = parseLrc('[00:05.00] <00:05.00> one <00:05.40> two [00:09.00] (hey)');
  assert.deepEqual(lines, [{ time: 5000, text: 'one two [00:09.00] (hey)' }]);
});

test('lineIndexAt finds the line in progress', () => {
  const lines = parseLrc('[00:05.00] a\n[00:10.00] b\n[00:15.00] c');
  assert.equal(lineIndexAt(lines, 0), -1);
  assert.equal(lineIndexAt(lines, 4999), -1);
  assert.equal(lineIndexAt(lines, 5000), 0);
  assert.equal(lineIndexAt(lines, 12000), 1);
  assert.equal(lineIndexAt(lines, 999999), 2);
  assert.equal(lineIndexAt([], 1000), -1);
});

test('splitPlain collapses blank runs and trims the ends', () => {
  assert.deepEqual(splitPlain('\n\none\ntwo\n\n\n three \n\n'), ['one', 'two', '', 'three']);
});

test('cleanTitle removes version suffixes and bracketed credits', () => {
  assert.equal(cleanTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('Song (feat. Someone) [Live]'), 'Song');
  assert.equal(cleanTitle('(Intro)'), '(Intro)');
});

test('pickBest trusts timing only for a recording of the same length', () => {
  const records = [
    { trackName: 'Song', duration: 240, syncedLyrics: '[00:01.00] live', plainLyrics: 'live' },
    { trackName: 'Song', duration: 201, syncedLyrics: '[00:01.00] studio', plainLyrics: 'studio' },
    { trackName: 'Another Song', duration: 200, syncedLyrics: '[00:01.00] wrong', plainLyrics: 'wrong' },
  ];
  assert.deepEqual(pickBest(records, 'Song', 200), { kind: 'synced', text: '[00:01.00] studio' });
  assert.deepEqual(pickBest(records, 'Song - Remastered', 205), { kind: 'plain', text: 'studio' });
  assert.equal(pickBest(records, 'Unrelated', 200), null);
});

test('pickBest falls back to the words of a mistimed version', () => {
  const records = [{ trackName: 'Sóng', duration: 100, syncedLyrics: '[00:01.00] one\n[00:02.00] two' }];
  assert.deepEqual(pickBest(records, 'Song', 180), { kind: 'plain', text: 'one\ntwo' });
});
