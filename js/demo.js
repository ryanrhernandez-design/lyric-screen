// A stand-in for Spotify and the lyrics service, used by ?demo so the display can be
// seen without an account. It "plays" one made-up song on a loop.

import { parseLrc } from './lrc.js';

const DURATION = 64000;

const ART = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#ff7a59"/><stop offset=".55" stop-color="#c2408f"/><stop offset="1" stop-color="#3b2a8c"/>' +
  '</linearGradient></defs>' +
  '<rect width="640" height="640" fill="url(#g)"/>' +
  '<circle cx="470" cy="190" r="150" fill="#ffd27a" opacity=".55"/>' +
  '<path d="M0 470 Q160 380 320 450 T640 420 V640 H0Z" fill="#1b1340" opacity=".55"/>' +
  '</svg>'
);

const LRC = [
  '[00:02.00] This is a demo, nothing is really playing',
  '[00:06.00] No account needed to see how it looks',
  '[00:10.00] Each line lights up when its moment arrives',
  '[00:14.50] And the rest wait quietly above and below',
  '[00:19.00] Press play on your phone, your laptop, your speaker',
  '[00:23.50] The screen picks it up on its own',
  '[00:28.00]',
  '[00:34.00] A new song starts and the words change with it',
  '[00:38.50] Pause for a while and the clock takes over',
  '[00:43.00] Tap the screen if the timing feels off',
  '[00:47.00] Nudge it earlier, nudge it later',
  '[00:51.00] Make the letters bigger for the far side of the room',
  '[00:55.50] Then leave it on and forget it is there',
  '[01:00.00]',
].join('\n');

// ?demo&t=20 starts twenty seconds in.
const startAt = (parseFloat(new URLSearchParams(location.search).get('t')) || 0) * 1000;
const started = performance.now() - startAt;

export const demoSource = {
  nowPlaying: function () {
    const now = performance.now();
    return Promise.resolve({
      status: 'ok',
      at: now,
      data: {
        is_playing: true,
        progress_ms: (now - started) % DURATION,
        currently_playing_type: 'track',
        item: {
          id: 'demo',
          type: 'track',
          name: 'Demo Song',
          duration_ms: DURATION,
          artists: [{ name: 'Lyric Screen' }],
          album: { name: 'No account needed', images: [{ url: ART }] },
        },
      },
    });
  },
  lyrics: function () {
    return Promise.resolve({ kind: 'synced', lines: parseLrc(LRC) });
  },
};
