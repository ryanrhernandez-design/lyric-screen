// The display itself: asks Spotify what is playing every few seconds, keeps its own
// clock running in between, and moves the lyrics along with it.

import * as spotify from './spotify.js';
import { getLyrics } from './lyrics.js';
import { lineIndexAt } from './lrc.js';
import { splitWords, wordTimes, wordsSungAt } from './words.js';
import { SHUFFLE, isChoice, styleInfo, nextChoice, shuffled, hash, unit } from './styles.js';
import { demoSource } from './demo.js';

const APP_NAME = 'Lyric Screen';
const config = Object.assign({ clientId: '', pollSeconds: 3, style: '' }, window.LYRICS_CONFIG || {});
const QUERY = new URLSearchParams(location.search);
const DEMO = QUERY.has('demo');
const source = DEMO ? demoSource : { nowPlaying: spotify.nowPlaying, lyrics: getLyrics };

const POLL_PLAYING = Math.max(1, Number(config.pollSeconds) || 3) * 1000;
const POLL_PAUSED = Math.max(POLL_PLAYING, 5000);
const POLL_HIDDEN = 15000;
const IDLE_AFTER_PAUSE = 10 * 60 * 1000; // a long pause hands the screen to the clock
const OFFSET_STEP = 250;
const SETTINGS_KEY = 'll.settings';

// Kinetic style: words wait as small labels before they are sung, shrunk to WAIT_SCALE
// (keep in step with style.css). The block of text leans a little, differently per verse,
// and the paper takes one of a few tints per song.
const WAIT_SCALE = 0.16;
const TILTS = [-4, 3, -2, 4.5, -5, 2];
const PAPERS = [168, 186, 202, 48, 18];
const VERSE_LINES = 4;

const NOTES = {
  loading: 'Finding lyrics…',
  none: 'No lyrics found for this song',
  instrumental: 'Instrumental',
  episode: 'Lyrics are only shown for songs',
  error: 'Couldn’t reach the lyrics service',
};

const $ = function (id) { return document.getElementById(id); };

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (err) {
    return {};
  }
}

const settings = Object.assign({ offset: 0, scale: 1, style: '' }, readSettings());

const state = {
  running: false,
  track: null,
  playing: false,
  progress: 0,    // playback position in ms...
  at: 0,          // ...as of this performance.now() time
  pausedSince: 0,
  lyrics: null,   // { kind, lines }
  lines: [],      // synced lines as displayed
  lineEls: [],
  index: -2,      // highlighted line; -2 makes the next frame redraw
  look: 'classic', // the style on screen
  lookTrack: null, // the song shuffle last picked a style for
  words: [],      // per synced line: { els, times, waits } for its words
  tilts: [],      // per line: how far the kinetic block leans, in degrees
  wordLine: -1,   // the line whose words were last updated...
  wordCount: -1,  // ...and how many of them were lit
};

/* ---------- Setup screen ---------- */

function showSetup(message) {
  state.running = false;
  clearTimeout(pollTimer);
  $('player').hidden = true;
  $('setup').hidden = false;
  document.body.classList.remove('controls-on');
  document.title = APP_NAME;
  setBackground('');
  clearToast();
  applyLook(false); // the setup screen keeps its own look
  const error = $('setupError');
  error.textContent = message || '';
  error.hidden = !message;
}

function initSetup() {
  const shared = !!config.clientId;
  const own = spotify.savedClientId();
  $('redirectUri').textContent = spotify.redirectUri();
  $('clientId').value = own && own !== config.clientId ? own : '';
  $('quick').hidden = !shared;
  $('own').classList.toggle('sole', !shared);
  $('own').open = !shared || !!$('clientId').value;

  if (!spotify.canLogin()) {
    $('insecure').hidden = false;
    $('quickConnect').disabled = true;
    $('ownForm').querySelector('button').disabled = true;
  }

  $('quickConnect').addEventListener('click', function () { connect(config.clientId); });
  $('ownForm').addEventListener('submit', function (event) {
    event.preventDefault();
    const id = $('clientId').value.trim();
    if (!/^[0-9a-z]{20,64}$/i.test(id)) {
      showSetup('That doesn’t look like a Client ID. It is a 32-character code of letters and numbers, shown in your Spotify app’s settings.');
      return;
    }
    connect(id);
  });
  $('copyUri').addEventListener('click', copyRedirectUri);
}

function connect(clientId) {
  spotify.beginLogin(clientId).catch(function (err) { showSetup(err.message); });
}

function copyRedirectUri() {
  const button = $('copyUri');
  const select = function () {
    const range = document.createRange();
    range.selectNodeContents($('redirectUri'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(spotify.redirectUri()).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1500);
    }, select);
  } else {
    select();
  }
}

/* ---------- Asking Spotify what is playing ---------- */

let pollTimer = 0;
let pollBusy = false;
let fastPolls = 0;

function startPlayer() {
  $('setup').hidden = true;
  $('player').hidden = false;
  state.running = true;
  state.track = null;
  applyLook(true);
  setIdle(true, 'Connecting…', '');
  keepAwake();
  poll();
}

function schedule(ms) {
  clearTimeout(pollTimer);
  if (state.running) pollTimer = setTimeout(poll, ms);
}

async function poll() {
  if (pollBusy || !state.running) return;
  pollBusy = true;
  let delay;
  try {
    const reply = await source.nowPlaying();
    if (!state.running) return;
    if (reply.status === 'limited') {
      toast('Spotify asked for a short break. Checking again soon.');
      delay = (reply.retryAfter + 1) * 1000;
    } else {
      clearToast();
      if (reply.status === 'ok') applyPlayback(reply.data, reply.at);
      else nothingPlaying();
      delay = nextDelay();
    }
  } catch (err) {
    if (err && (err.code === 'auth' || err.code === 'forbidden')) {
      if (err.code === 'forbidden') spotify.logout();
      showSetup(err.message);
      return;
    }
    toast('Can’t reach Spotify. Trying again…');
    delay = 5000;
  } finally {
    pollBusy = false;
  }
  schedule(delay);
}

// Poll on a steady beat, plus once right as the song should end so the next
// song's lyrics come up without waiting for the beat.
function nextDelay() {
  if (document.hidden) return POLL_HIDDEN;
  if (!state.track || !state.playing) return POLL_PAUSED;
  const remaining = state.track.durationMs - rawPosition(performance.now());
  if (remaining < POLL_PLAYING && fastPolls < 5) {
    fastPolls++;
    return Math.max(remaining + 350, 600);
  }
  return POLL_PLAYING;
}

function trackFrom(data) {
  const item = data.item;
  if (!item) return null;
  const episode = item.type === 'episode' || data.currently_playing_type === 'episode';
  const artists = (item.artists || []).map(function (artist) { return artist.name; }).filter(Boolean);
  const show = item.show || {};
  const images = episode ? (item.images || show.images || []) : ((item.album && item.album.images) || []);
  return {
    id: item.id || item.uri || [item.name, artists.join(','), item.duration_ms].join('|'),
    type: episode ? 'episode' : 'track',
    title: item.name || 'Unknown',
    artist: episode ? (show.name || '') : artists.join(', '),
    primaryArtist: artists[0] || '',
    album: episode ? '' : ((item.album && item.album.name) || ''),
    art: images.length ? images[0].url : '',
    artSmall: images.length ? images[images.length - 1].url : '',
    durationMs: item.duration_ms || 0,
  };
}

function applyPlayback(data, at) {
  const track = trackFrom(data);
  if (!track) {
    nothingPlaying();
    return;
  }
  const progress = typeof data.progress_ms === 'number' ? data.progress_ms : 0;
  const playing = !!data.is_playing;
  const changed = !state.track || state.track.id !== track.id;

  if (changed) {
    state.progress = progress;
  } else {
    // Same song: compare Spotify's position with our running clock.
    const predicted = state.progress + (state.playing ? at - state.at : 0);
    const drift = progress - predicted;
    if (!playing || !state.playing || Math.abs(drift) > 1500) state.progress = progress; // pause, resume or seek
    else state.progress = predicted + drift * 0.5;                                        // small drift: ease toward it
  }
  state.at = at;

  if (playing) state.pausedSince = 0;
  else if (!state.pausedSince) state.pausedSince = Date.now();
  state.playing = playing;

  const longPause = !playing && Date.now() - state.pausedSince > IDLE_AFTER_PAUSE;
  setIdle(longPause, 'Paused', track.title + (track.artist ? ' · ' + track.artist : ''));
  $('player').classList.toggle('is-paused', !playing);

  if (changed) {
    state.track = track;
    fastPolls = 0;
    applyLook(false);
    renderTrack(track);
    showTitleCard(track);
    loadLyrics(track, 0);
  }
}

function nothingPlaying() {
  state.track = null;
  state.playing = false;
  state.lyrics = null;
  setIdle(true, 'Nothing playing', 'Play something on Spotify and the lyrics appear here.');
  setBackground('');
  document.title = APP_NAME;
}

function rawPosition(now) {
  if (!state.track) return 0;
  const position = state.progress + (state.playing ? now - state.at : 0);
  return Math.max(0, Math.min(position, state.track.durationMs || position));
}

/* ---------- Drawing ---------- */

function setIdle(idle, title, hint) {
  const player = $('player');
  const wasIdle = player.classList.contains('is-idle');
  player.classList.toggle('is-idle', idle);
  if (idle) {
    $('idleTitle').textContent = title;
    $('idleHint').textContent = hint;
  } else if (wasIdle) {
    relayout(); // sizes can't be measured while hidden
  }
}

function safeUrl(url) {
  return /^(https:\/\/|data:image\/)/.test(url || '') ? url : '';
}

let bgUrl = '';
let bgLayer = 0;

function setBackground(url) {
  url = safeUrl(url);
  if (url === bgUrl) return;
  bgUrl = url;
  const layers = [$('bgA'), $('bgB')];
  const previous = layers[bgLayer];
  bgLayer = 1 - bgLayer;
  const next = layers[bgLayer];
  previous.classList.remove('on');
  if (url) {
    next.style.backgroundImage = 'url("' + url.replace(/["\\\n]/g, encodeURIComponent) + '")';
    next.classList.add('on');
  }
}

function renderTrack(track) {
  $('title').textContent = track.title;
  $('artist').textContent = track.artist;
  $('album').textContent = track.album;
  $('total').textContent = clockTime(track.durationMs);
  const art = $('art');
  const url = safeUrl(track.art);
  if (url) {
    art.src = url;
    art.hidden = false;
  } else {
    art.removeAttribute('src');
    art.hidden = true;
  }
  setBackground(track.artSmall || track.art);
  showProgress(rawPosition(performance.now()));
  document.title = track.title + (track.artist ? ' · ' + track.artist : '');
}

function loadLyrics(track, attempt) {
  const current = function () { return state.running && state.track && state.track.id === track.id; };
  if (track.type !== 'track') {
    renderLyrics({ kind: 'episode', lines: [] });
    return;
  }
  if (attempt === 0) renderLyrics({ kind: 'loading', lines: [] });

  source.lyrics(track).then(function (result) {
    if (current()) renderLyrics(result);
  }, function () {
    if (!current()) return;
    renderLyrics({ kind: 'error', lines: [] });
    if (attempt < 3) setTimeout(function () { if (current()) loadLyrics(track, attempt + 1); }, 8000 * (attempt + 1));
  });
}

function renderLyrics(result) {
  const box = $('lines');
  const player = $('player');
  const hasLines = (result.kind === 'synced' || result.kind === 'plain') && result.lines.length > 0;

  state.lyrics = result;
  state.index = -2;
  state.lineEls = [];
  state.lines = [];
  state.words = [];
  state.tilts = [];
  state.wordLine = -1;
  state.wordCount = -1;
  box.textContent = '';

  player.classList.toggle('lyrics-plain', hasLines && result.kind === 'plain');
  player.classList.toggle('lyrics-none', !hasLines);
  $('lyricsNote').textContent = hasLines ? '' : (NOTES[result.kind] || NOTES.none);
  if (!hasLines) return;

  const synced = result.kind === 'synced';
  let lines = result.lines;
  if (synced) {
    // Give a long intro its own "line" so the first words aren't lit up early.
    if (lines[0].time > 3000) lines = [{ time: 0, text: '' }].concat(lines);
    state.lines = lines;
  }

  const seed = state.track ? state.track.id : '';
  const fragment = document.createDocumentFragment();
  let verse = 0;
  let inVerse = 0;
  lines.forEach(function (line, i) {
    const text = typeof line === 'string' ? line : line.text;
    const el = document.createElement('p');
    el.className = 'line';
    const words = { els: [], times: [], waits: [] };
    if (text && synced) {
      // One element per word, so a style can bring the words in as they are sung.
      const parts = splitWords(text);
      words.times = wordTimes(parts, line.time, i + 1 < lines.length ? lines[i + 1].time : undefined);
      parts.forEach(function (part, j) {
        if (j) el.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.className = 'w';
        span.textContent = part;
        // Where this word waits before it is sung, in ems from its place in the line.
        const key = seed + ':' + i + ':' + j;
        const wait = { x: (unit(key + 'x') - 0.5) * 2.4, y: 1.25 + unit(key + 'y') * 2.1 };
        span.style.setProperty('--wx', wait.x.toFixed(2) + 'em');
        span.style.setProperty('--wy', wait.y.toFixed(2) + 'em');
        el.appendChild(span);
        words.els.push(span);
        words.waits.push(wait);
      });
    } else if (text) {
      el.textContent = text;
    } else {
      el.classList.add('gap');
      // A timed gap is an instrumental break; the last one just ends the song.
      if (synced && i < lines.length - 1) el.textContent = '♪';
    }

    // A verse ends at a break in the lyrics, or after a few lines.
    if (!text || inVerse >= VERSE_LINES) {
      verse++;
      inVerse = 0;
    }
    if (text) inVerse++;
    state.tilts.push(TILTS[verse % TILTS.length]);
    el.style.setProperty('--indent', (unit(seed + ':' + i + 'i') * 9).toFixed(1) + '%');

    fragment.appendChild(el);
    state.lineEls.push(el);
    state.words.push(words);
  });
  box.appendChild(fragment);
  box.appendChild(threads);
  relayout();
}

// Where the list sits: `anchor` px down the lyrics area is the point `center` px down
// the list, with the whole list leaning `tilt` degrees around that point.
function place(anchor, center, tilt) {
  $('lines').style.transform = 'translate3d(0,' + Math.round(anchor) + 'px,0) rotate(' + tilt +
    'deg) translate3d(0,' + (-Math.round(center)) + 'px,0)';
}

function setActive(index) {
  state.index = index;
  state.wordLine = -1;
  const els = state.lineEls;
  for (let i = 0; i < els.length; i++) {
    els[i].classList.toggle('active', i === index);
    els[i].classList.toggle('past', i < index);
  }
  placeLines();
  if (index < 0) drawThreads();
}

// Slide the list so the highlighted line sits at the anchor.
function placeLines() {
  const els = state.lineEls;
  if (!els.length) return;
  const index = Math.max(0, state.index);
  const el = els[index];
  const tilt = state.look === 'kinetic' ? (state.tilts[index] || 0) : 0;
  place($('lyricsView').clientHeight * styleInfo(state.look).anchor, el.offsetTop + el.offsetHeight / 2, tilt);
}

// Light the words of the current line that have been sung by `at`.
function updateWords(index, at) {
  const words = state.words[index];
  if (!words) return;
  const count = wordsSungAt(words.times, at);
  if (index === state.wordLine && count === state.wordCount) return;
  state.wordLine = index;
  state.wordCount = count;
  for (let j = 0; j < words.els.length; j++) {
    words.els[j].classList.toggle('sung', j < count);
    words.els[j].classList.toggle('latest', j === count - 1);
  }
  drawThreads();
}

/* Kinetic style: a hairline runs through the words still waiting to be sung. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const threads = document.createElementNS(SVG_NS, 'svg');
const threadLine = document.createElementNS(SVG_NS, 'polyline');
threads.setAttribute('id', 'threads');
threads.setAttribute('aria-hidden', 'true');
threads.appendChild(threadLine);

function drawThreads() {
  const words = state.look === 'kinetic' && state.index >= 0 ? state.words[state.index] : null;
  const from = state.wordLine === state.index ? Math.max(0, state.wordCount) : 0;
  if (!words || from >= words.els.length) {
    threadLine.setAttribute('points', '');
    return;
  }
  // Positions are worked out from the layout, not read off the screen, so they hold
  // while the list is still sliding into place.
  const size = parseFloat(getComputedStyle(words.els[0]).fontSize) || 16;
  const points = [];
  for (let j = from; j < words.els.length; j++) {
    const el = words.els[j];
    points.push([
      el.offsetLeft + words.waits[j].x * size + el.offsetWidth * WAIT_SCALE / 2,
      el.offsetTop + el.offsetHeight / 2 + words.waits[j].y * size,
    ]);
  }
  const width = $('lines').offsetWidth;
  points.unshift([-width * 0.2, points[0][1] - size * 0.9]);
  points.push([width * 1.2, points[points.length - 1][1] + size * 0.7]);
  threadLine.setAttribute('points', points.map(function (p) {
    return p[0].toFixed(1) + ',' + p[1].toFixed(1);
  }).join(' '));
}

// Unsynced lyrics: scroll through the whole text over the length of the song.
function placePlain(position) {
  const view = $('lyricsView').clientHeight;
  const total = $('lines').offsetHeight;
  const duration = state.track ? state.track.durationMs : 0;
  const fraction = duration ? Math.min(1, Math.max(0, position / duration)) : 0;
  place(view * 0.14 - fraction * Math.max(0, total - view * 0.62), 0, 0);
}

// Re-place the lyrics without animating, after anything that changes their size.
function relayout() {
  const lyrics = state.lyrics;
  if (!lyrics || !state.lineEls.length) return;
  const box = $('lines');
  box.style.transition = 'none';
  if (lyrics.kind === 'synced') {
    const at = rawPosition(performance.now()) + settings.offset;
    if (state.index === -2) setActive(lineIndexAt(state.lines, at));
    else placeLines();
    if (state.index >= 0) updateWords(state.index, at);
    drawThreads();
  } else {
    placePlain(rawPosition(performance.now()));
  }
  void box.offsetHeight; // apply the jump before animation is switched back on
  box.style.transition = '';
}

function clockTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const rest = seconds % 60;
  return Math.floor(seconds / 60) + ':' + (rest < 10 ? '0' : '') + rest;
}

function showProgress(position) {
  const duration = state.track ? state.track.durationMs : 0;
  $('bar').style.transform = 'scaleX(' + (duration ? Math.min(1, position / duration) : 0) + ')';
  $('elapsed').textContent = clockTime(position);
}

let lastSlowTick = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!state.running || !state.track) return;
  const position = rawPosition(now);
  const lyrics = state.lyrics;

  if (lyrics && lyrics.kind === 'synced' && state.lines.length) {
    const at = position + settings.offset;
    let index = lineIndexAt(state.lines, at);
    // Don't flick back a line over a correction of a few hundred milliseconds.
    if (index === state.index - 1 && at > state.lines[state.index].time - 400) index = state.index;
    if (index !== state.index) setActive(index);
    if (index >= 0) updateWords(index, at);
  }

  if (now - lastSlowTick >= 500) {
    lastSlowTick = now;
    showProgress(position);
    if (lyrics && lyrics.kind === 'plain') placePlain(position);
  }
}

function tickClock() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('on');
}

function clearToast() {
  $('toast').classList.remove('on');
}

/* ---------- Styles ---------- */

// The style asked for: this device's own choice, else the host's default in config.js.
function styleChoice() {
  if (isChoice(settings.style)) return settings.style;
  return isChoice(config.style) ? config.style : 'classic';
}

// Put the chosen style on screen. On shuffle, each new song gets a different one;
// `repick` makes shuffle choose again for the song already playing.
function applyLook(repick) {
  const choice = styleChoice();
  const trackId = state.track ? state.track.id : '';
  if (choice !== SHUFFLE) state.look = choice;
  else if (repick || state.lookTrack !== trackId) state.look = shuffled(trackId, state.look);
  state.lookTrack = trackId;

  const root = document.documentElement;
  if (state.running) root.setAttribute('data-style', state.look);
  else root.removeAttribute('data-style');

  // Small per-song variations, so the same style still looks fresh from song to song.
  const seed = hash(trackId);
  root.setAttribute('data-font', String(seed % 3));
  root.style.setProperty('--hue', String(seed % 360));
  root.style.setProperty('--paper', String(PAPERS[(seed >>> 4) % PAPERS.length]));

  const name = styleInfo(state.look).name;
  $('styleBtn').textContent = 'Style: ' + (choice === SHUFFLE ? 'Shuffle (' + name + ')' : name);
  relayout();
}

let cardTimer = 0;

// A new song announces itself for a few seconds, in the styles that show it.
function showTitleCard(track) {
  $('cardTitle').textContent = track.title;
  $('cardAlbum').textContent = track.album;
  $('cardArtist').textContent = track.artist;
  const player = $('player');
  player.classList.add('card-on');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(function () { player.classList.remove('card-on'); }, 4500);
}

/* ---------- Controls ---------- */

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) { /* settings just won't persist */ }
}

function applySettings() {
  document.documentElement.style.setProperty('--lyric-scale', String(settings.scale));
  const seconds = (Math.abs(settings.offset) / 1000).toFixed(2) + 's ';
  $('offsetLabel').textContent = settings.offset === 0 ? 'Timing as is' : seconds + (settings.offset > 0 ? 'earlier' : 'later');
}

function nudge(ms) {
  settings.offset = Math.max(-10000, Math.min(10000, settings.offset + ms));
  saveSettings();
  applySettings();
}

function zoom(step) {
  settings.scale = Math.round(Math.max(0.6, Math.min(1.8, settings.scale + step)) * 10) / 10;
  saveSettings();
  applySettings();
  relayout();
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function toggleFullscreen() {
  const root = document.documentElement;
  const enter = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  const result = fullscreenElement() ? exit.call(document) : enter.call(root);
  if (result && result.catch) result.catch(function () {});
}

const actions = {
  earlier: function () { nudge(OFFSET_STEP); },
  later: function () { nudge(-OFFSET_STEP); },
  smaller: function () { zoom(-0.1); },
  bigger: function () { zoom(0.1); },
  style: function () {
    settings.style = nextChoice(styleChoice());
    saveSettings();
    applyLook(true);
  },
  fullscreen: toggleFullscreen,
  logout: function () {
    if (DEMO) {
      location.href = spotify.redirectUri();
    } else {
      spotify.logout();
      showSetup('');
    }
  },
};

let controlsTimer = 0;

function showControls() {
  if ($('player').hidden) return;
  document.body.classList.add('controls-on');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(function () { document.body.classList.remove('controls-on'); }, 5000);
}

function initControls() {
  const root = document.documentElement;
  if (!(root.requestFullscreen || root.webkitRequestFullscreen)) $('fullscreenBtn').hidden = true;
  if (DEMO) $('logoutBtn').textContent = 'Exit demo';

  $('controls').addEventListener('click', function (event) {
    const button = event.target.closest('button[data-act]');
    if (button && actions[button.getAttribute('data-act')]) actions[button.getAttribute('data-act')]();
  });

  ['pointerdown', 'mousemove', 'touchstart'].forEach(function (name) {
    window.addEventListener(name, showControls, { passive: true });
  });

  window.addEventListener('keydown', function (event) {
    if ($('player').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === 'ArrowLeft') actions.earlier();
    else if (key === 'ArrowRight') actions.later();
    else if (key === '+' || key === '=') actions.bigger();
    else if (key === '-' || key === '_') actions.smaller();
    else if (key === 's' || key === 'S') actions.style();
    else if ((key === 'f' || key === 'F') && !$('fullscreenBtn').hidden) actions.fullscreen();
    else return;
    showControls();
  });

  window.addEventListener('resize', relayout);
}

/* ---------- Staying on ---------- */

// Ask the browser not to dim or lock the screen while the display is showing.
function keepAwake() {
  if (!('wakeLock' in navigator) || document.hidden || !state.running) return;
  navigator.wakeLock.request('screen').catch(function () {});
}

document.addEventListener('visibilitychange', function () {
  if (document.hidden || !state.running) return;
  keepAwake(); // the lock is dropped whenever the page is hidden
  schedule(0);
});

window.addEventListener('online', function () { schedule(0); });

/* ---------- Start ---------- */

async function boot() {
  // ?style=neon picks a style from the address, handy for a kiosk with no keyboard.
  if (isChoice(QUERY.get('style'))) {
    settings.style = QUERY.get('style');
    saveSettings();
  }
  applySettings();
  initSetup();
  initControls();
  tickClock();
  setInterval(tickClock, 1000);
  requestAnimationFrame(frame);

  if (DEMO) {
    startPlayer();
    return;
  }
  // Spotify accepts http://127.0.0.1 as a login address, but not http://localhost.
  if (location.hostname === 'localhost') {
    location.replace(location.href.replace('//localhost', '//127.0.0.1'));
    return;
  }
  const login = await spotify.completeLogin();
  if (login.status === 'error') showSetup(login.message);
  else if (spotify.isLoggedIn()) startPlayer();
  else showSetup('');
}

boot();
