# Lyric Screen

An always-on screen that shows the lyrics, in time, for whatever is playing on your Spotify account. Open the page on a tablet, a Raspberry Pi with a display, or any browser, connect Spotify once, and leave it running.

**Live at https://ryanrhernandez-design.github.io/lyric-screen/** once GitHub Pages is switched on for this repository.

It is a static web page: no server, no build step, no secrets. Try it without an account by adding `?demo` to the address.

## How it works

- **What is playing** comes from Spotify's Web API. The page asks every 3 seconds and runs its own clock in between, so the lyrics move smoothly.
- **Lyrics** come from [LRCLIB](https://lrclib.net), a free community database. Spotify's API has no lyrics. The song is matched by title, artist and length.
- **Login** uses Spotify's browser login (Authorization Code with PKCE). The tokens are stored in that browser only, so the device stays connected across restarts.

## Connect a device

1. Open the hosted page on the device. The address must start with `https://`.
2. Follow the three steps on screen: create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add the Redirect URI the page shows you, and paste the app's Client ID.
3. Approve the Spotify prompt. The lyrics screen takes over from there.

Tap the screen (or move the mouse) for the controls:

| Control | What it does | Keyboard |
|---|---|---|
| Earlier / Later | Shifts the lyrics in 0.25s steps, for speakers that add delay | Left / Right |
| A− / A+ | Text size | `-` / `+` |
| Style | Steps through the lyric styles below | `S` |
| Fullscreen | Hides the browser's bars | `F` |
| Log out | Forgets the Spotify login on this device | |

## Styles

The **Style** button changes how the lyrics look. The choice is remembered on that device.

| Style | Look |
|---|---|
| Classic | A scrolling list over the blurred album cover, with the current line lit |
| Kinetic | Black capitals on pale paper. Each word waits as a small label on a hairline, then flies into place as it is sung |
| Spotlight | One huge line at a time, lighting up word by word, with the next line waiting underneath |
| Neon | Unlit sign lettering that switches on word by word, in a colour picked per song |
| Terminal | Typed out on a green screen, with a blinking cursor |
| Shuffle | A different style for every song |

To start a device in a given style, add it to the address, for example `?style=kinetic` or `?style=shuffle`. This is the easy way on a kiosk with no keyboard. To change the style new visitors start in, set `style` in `config.js`.

The lyrics service times whole lines, not single words. Word-by-word effects spread the words across their line by length, so a word can light up a little before or after it is sung.

## Put it online

Upload this folder to any static host that serves HTTPS, such as GitHub Pages, Netlify or Cloudflare Pages. Nothing needs building.

On GitHub Pages: push the folder to a repository, then choose **Settings → Pages → Deploy from a branch** and pick the branch. The page appears at `https://<user>.github.io/<repo>/`.

Anyone can open the link and connect with their own Spotify app. To give yourself and a few friends a one-tap **Connect Spotify** button, put your Client ID in `config.js`. A Client ID is not a secret, so it is safe to publish.

## Tablet

- **Android:** open the link in Chrome and choose **Add to Home screen** for a fullscreen app. Chrome keeps the screen awake while the page is showing.
- **iPad:** use **Share → Add to Home Screen**. This matters: a plain Safari tab can forget the login after a week without taps, and a Home Screen app does not. Keeping the screen awake needs iPadOS 16.4 or later; on older iPads set **Auto-Lock** to **Never**.
- Keep it on a charger.

## Raspberry Pi

The simplest setup is Chromium in kiosk mode pointed at the hosted link. On Raspberry Pi OS with the desktop, add this line to `~/.config/labwc/autostart` (the program is called `chromium-browser` on older releases):

```bash
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://ryanrhernandez-design.github.io/lyric-screen/ &
```

Plug in a keyboard once to connect Spotify. Chromium remembers the login after that.

To run with no outside host, serve the folder on the Pi and open `http://127.0.0.1:8888/` instead. Spotify accepts that address as a Redirect URI, but only on the Pi itself:

```bash
python3 -m http.server 8888 --bind 127.0.0.1
```

These Pi steps have not been run on real hardware yet.

## Limits worth knowing

- **Spotify's development mode.** Creating a Spotify app needs a Premium account, and each app allows five users, added by hand under User Management. That is why every visitor connects with their own app unless you have added them to yours.
- **Reconnecting.** Spotify logins last six months, then the page asks you to connect again.
- **Lyric coverage.** Well-known songs usually have timed lyrics. Some songs only have plain lyrics, which scroll at a steady pace, and some have none.
- **Reaction time.** A skip, pause or seek shows up within about 3 seconds. A song ending on its own is picked up in under a second.

## Develop

```bash
npm start
```

```bash
npm test
```

`npm start` serves the folder at `http://127.0.0.1:8888/`. `npm test` runs the lyric parsing and matching tests, which need no dependencies.

| File | Purpose |
|---|---|
| `js/app.js` | The display: polling, timing, drawing, controls |
| `js/spotify.js` | Login, token refresh, the now-playing call |
| `js/lyrics.js` | LRCLIB lookup, matching and caching |
| `js/lrc.js` | Parsing timed lyrics |
| `js/words.js` | Splitting a line into words and estimating when each is sung |
| `js/styles.js` | The list of lyric styles and the shuffle rule (the looks themselves are in `style.css`) |
| `js/demo.js` | The made-up song behind `?demo` |
| `config.js` | Optional shared Client ID, poll interval and starting style |
