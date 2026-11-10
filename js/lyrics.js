// Lyrics lookup against LRCLIB (https://lrclib.net), a free community lyrics database.
// Spotify's own API has no lyrics endpoint, so the song is matched by title, artist and length.

import { parseLrc, splitPlain, stripTimestamps } from './lrc.js';

const BASE = 'https://lrclib.net/api';
const CLIENT = 'lyric-screen/0.1';
const CACHE_KEY = 'll.lyricsCache';
const CACHE_MAX = 40;
const MISS_TTL = 24 * 60 * 60 * 1000; // look again for missing lyrics after a day
const DURATION_TOLERANCE = 2.5;       // seconds; beyond this the timing belongs to another version

const RANK = { synced: 3, plain: 2, instrumental: 1, none: 0 };

async function request(path, params) {
  const url = BASE + path + '?' + new URLSearchParams(params).toString();
  let res;
  try {
    res = await fetch(url, { headers: { 'Lrclib-Client': CLIENT } });
  } catch (err) {
    res = await fetch(url); // some networks strip or refuse custom headers
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Lyrics service answered ' + res.status);
  return res.json();
}

function normalize(text) {
  let out = String(text || '').toLowerCase();
  if (out.normalize) out = out.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return out.replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// "Song - Remastered 2011" and "Song (feat. Someone)" -> "Song"
export function cleanTitle(title) {
  const cleaned = String(title || '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim();
  return cleaned || String(title || '');
}

function sameSong(a, b) {
  return normalize(a) === normalize(b) || normalize(cleanTitle(a)) === normalize(cleanTitle(b));
}

function fromRecord(record) {
  if (!record) return null;
  if (record.syncedLyrics) return { kind: 'synced', text: record.syncedLyrics };
  if (record.plainLyrics) return { kind: 'plain', text: record.plainLyrics };
  if (record.instrumental) return { kind: 'instrumental', text: '' };
  return null;
}

// Choose from search results. Timed lyrics are only trusted when the recording is
// the same length as the one playing; otherwise the words are used without timing.
export function pickBest(records, title, durationSec) {
  let synced = null;
  let plain = null;
  let instrumental = false;

  (records || []).forEach(function (record) {
    if (!sameSong(record.trackName || record.name, title)) return;
    const delta = Math.abs((record.duration || 0) - durationSec);
    if (record.syncedLyrics && delta <= DURATION_TOLERANCE) {
      if (!synced || delta < synced.delta) synced = { record: record, delta: delta };
    } else if (record.plainLyrics || record.syncedLyrics) {
      if (!plain || delta < plain.delta) plain = { record: record, delta: delta };
    } else if (record.instrumental && delta <= DURATION_TOLERANCE) {
      instrumental = true;
    }
  });

  if (synced) return { kind: 'synced', text: synced.record.syncedLyrics };
  if (plain) return { kind: 'plain', text: plain.record.plainLyrics || stripTimestamps(plain.record.syncedLyrics) };
  if (instrumental) return { kind: 'instrumental', text: '' };
  return null;
}

function better(a, b) {
  if (!a) return b;
  if (!b) return a;
  return RANK[b.kind] > RANK[a.kind] ? b : a;
}

// track: { title, primaryArtist, durationMs }
export async function fetchLyrics(track) {
  const duration = Math.round(track.durationMs / 1000);
  const exact = fromRecord(await request('/get', {
    track_name: track.title,
    artist_name: track.primaryArtist,
    duration: duration,
  }));
  if (exact && exact.kind !== 'plain') return exact;

  // No exact hit, or one without timing: search for a timed version of the same recording.
  let best = exact;
  const titles = [track.title];
  if (cleanTitle(track.title) !== track.title) titles.push(cleanTitle(track.title));

  for (let i = 0; i < titles.length; i++) {
    const results = await request('/search', { track_name: titles[i], artist_name: track.primaryArtist });
    best = better(best, pickBest(results, track.title, duration));
    if (best && best.kind === 'synced') break;
  }
  return best || { kind: 'none', text: '' };
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch (err) {
    return {};
  }
}

function writeCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort(function (a, b) { return cache[a].t - cache[b].t; })
      .slice(0, keys.length - CACHE_MAX)
      .forEach(function (key) { delete cache[key]; });
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) { /* storage full or unavailable: the cache is optional */ }
}

function materialize(result) {
  if (result.kind === 'synced') {
    const lines = parseLrc(result.text);
    if (lines.length) return { kind: 'synced', lines: lines };
    return { kind: 'none', lines: [] };
  }
  if (result.kind === 'plain') {
    const lines = splitPlain(result.text);
    return lines.length ? { kind: 'plain', lines: lines } : { kind: 'none', lines: [] };
  }
  return { kind: result.kind, lines: [] };
}

// Returns { kind: 'synced' | 'plain' | 'instrumental' | 'none', lines }.
// Synced lines are { time, text }; plain lines are strings.
export async function getLyrics(track) {
  const cache = readCache();
  const hit = cache[track.id];
  if (hit && hit.r && (hit.r.kind !== 'none' || Date.now() - hit.t < MISS_TTL)) {
    return materialize(hit.r);
  }
  const result = await fetchLyrics(track);
  cache[track.id] = { r: result, t: Date.now() };
  writeCache(cache);
  return materialize(result);
}
