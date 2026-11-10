// Spotify login (Authorization Code with PKCE, no server or client secret) and the
// one API call this app needs: what is playing right now, and how far in.

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode';
const SCOPE = 'user-read-currently-playing user-read-playback-state';

const KEYS = { clientId: 'll.clientId', tokens: 'll.tokens', pkce: 'll.pkce' };

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (err) {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) { /* nothing to remove */ }
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// The address Spotify sends the browser back to. It must be registered, character
// for character, in the Spotify app's settings.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// PKCE needs Web Crypto, which browsers only offer on https:// and loopback addresses.
export function canLogin() {
  return !!(window.isSecureContext && window.crypto && window.crypto.subtle);
}

export function savedClientId() {
  return read(KEYS.clientId) || '';
}

export function isLoggedIn() {
  const tokens = read(KEYS.tokens);
  return !!(tokens && tokens.refresh);
}

export function logout() {
  remove(KEYS.tokens);
}

function randomString(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Step 1: send the browser to Spotify's consent page.
export async function beginLogin(clientId) {
  if (!canLogin()) throw fail('insecure', 'Spotify login needs an https:// address.');
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = await challengeFor(verifier);
  if (!write(KEYS.pkce, { verifier: verifier, state: state, clientId: clientId })) {
    throw fail('storage', 'This browser is blocking storage for this page, so the login can’t be saved. Turn off private browsing and try again.');
  }
  location.assign(AUTH_URL + '?' + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state: state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString());
}

function storeTokens(json, clientId, previousRefresh) {
  write(KEYS.tokens, {
    access: json.access_token,
    refresh: json.refresh_token || previousRefresh,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    clientId: clientId,
  });
}

function tokenRequest(fields) {
  return fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

// Step 2: back from Spotify with ?code=... Swap the code for tokens.
// Returns { status: 'none' | 'ok' | 'error', message }.
export async function completeLogin() {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return { status: 'none' };

  history.replaceState(null, '', redirectUri()); // keep the one-time code out of the address bar
  const pkce = read(KEYS.pkce);
  remove(KEYS.pkce);

  if (query.has('error')) {
    const denied = query.get('error') === 'access_denied';
    return { status: 'error', message: denied ? 'Spotify login was cancelled.' : 'Spotify login failed (' + query.get('error') + ').' };
  }
  if (!pkce || pkce.state !== query.get('state')) {
    return { status: 'error', message: 'That login could not be verified. Please connect again.' };
  }

  let res;
  try {
    res = await tokenRequest({
      grant_type: 'authorization_code',
      code: query.get('code'),
      redirect_uri: redirectUri(),
      client_id: pkce.clientId,
      code_verifier: pkce.verifier,
    });
  } catch (err) {
    return { status: 'error', message: 'Could not reach Spotify to finish logging in. Check the connection and try again.' };
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error_description || body.error || '';
    } catch (err) { /* no readable body */ }
    return { status: 'error', message: 'Spotify refused the login' + (detail ? ': ' + detail : '') + '. Check the Client ID and Redirect URI.' };
  }

  storeTokens(await res.json(), pkce.clientId, '');
  write(KEYS.clientId, pkce.clientId);
  return { status: 'ok' };
}

// Access tokens last an hour. One refresh at a time: Spotify may hand back a new
// refresh token each time, and the old one then stops working.
let refreshing = null;

function refresh() {
  if (!refreshing) {
    refreshing = doRefresh().then(
      function () { refreshing = null; },
      function (err) { refreshing = null; throw err; }
    );
  }
  return refreshing;
}

async function doRefresh() {
  const tokens = read(KEYS.tokens);
  if (!tokens || !tokens.refresh) throw fail('auth', '');
  const res = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh,
    client_id: tokens.clientId,
  });
  if (res.status === 400 || res.status === 401) {
    logout(); // revoked, or past Spotify's six-month limit
    throw fail('auth', 'Your Spotify login has expired. Connect again to carry on.');
  }
  if (!res.ok) throw new Error('Spotify token refresh answered ' + res.status);
  storeTokens(await res.json(), tokens.clientId, tokens.refresh);
}

async function call() {
  const tokens = read(KEYS.tokens);
  if (!tokens) throw fail('auth', '');
  const sent = performance.now();
  const res = await fetch(NOW_PLAYING_URL, {
    headers: { Authorization: 'Bearer ' + tokens.access },
    cache: 'no-store',
  });
  // The reported position was true at some point between sending and receiving.
  return { res: res, at: (sent + performance.now()) / 2 };
}

// Returns { status: 'ok', data, at } | { status: 'idle' } | { status: 'limited', retryAfter }.
// `at` is the performance.now() time that data.progress_ms refers to.
// Throws an error with code 'auth' (log in again) or 'forbidden' (account not allowed);
// anything else thrown is a passing network or server problem.
export async function nowPlaying() {
  const tokens = read(KEYS.tokens);
  if (!tokens || !tokens.refresh) throw fail('auth', '');
  if (Date.now() > tokens.expiresAt - 60000) await refresh();

  let reply = await call();
  if (reply.res.status === 401) {
    await refresh();
    reply = await call();
    if (reply.res.status === 401) {
      logout();
      throw fail('auth', 'Your Spotify login has expired. Connect again to carry on.');
    }
  }

  const res = reply.res;
  if (res.status === 429) {
    return { status: 'limited', retryAfter: parseInt(res.headers.get('Retry-After'), 10) || 10 };
  }
  if (res.status === 403) {
    throw fail('forbidden', 'Spotify would not share playback for this account. In development mode the owner of the Spotify app needs Premium, and every other account has to be added under User Management in the Spotify dashboard. You can also connect with your own Spotify app.');
  }
  if (res.status === 204 || res.status === 202) return { status: 'idle' };
  if (!res.ok) throw new Error('Spotify answered ' + res.status);

  const text = await res.text();
  if (!text) return { status: 'idle' };
  return { status: 'ok', data: JSON.parse(text), at: reply.at };
}
