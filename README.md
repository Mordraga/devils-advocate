# Devil's Advocate — Client

> The cauldron chooses. The witches suffer. Chat judges.

Static HTML/CSS/JS client for **Devil's Advocate**, a live VTuber debate game: the
cauldron picks a silly topic and randomly assigns each contestant a side, the
audience votes before and after, and whoever moves the crowd furthest toward
their assigned stance wins.

Full product/technical spec: [`docs/Devils_Advocate_Spec.md`](docs/Devils_Advocate_Spec.md).

This client is one half of a two-repo project. The other half —
session authority, randomization, scoring, and persistence — lives in the
sibling `draga-server` repo. This client never decides the topic, sides,
phase, or winner; it only renders state the server issues.

## Surfaces

| Page | Purpose |
| --- | --- |
| `client/index.html` | Public landing page / show status |
| `client/host.html` | Private host control panel |
| `client/overlay.html` | Transparent OBS browser source |
| `client/play.html` | Contestant room (invite-only) |
| `client/watch.html` | Optional public watch view |
| `client/topics.html` | Topic admin: add, edit, switch on/off, weight, import/export |
| `client/archive.html` | Archived rounds, with copy-as-post text (host only) |

## Running it locally

```bash
# 1. server (from draga-server/, with DATABASE_URL etc. in .env - see .env.example)
uvicorn app.main:app --port 8000

# 2. client (from devils-advocate/client/)
python -m http.server 8080
```

Open `http://localhost:8080/host.html`. Pages served from localhost talk
to `http://localhost:8000` by default; to aim any page at another server
(e.g. Railway) load it once with `?api=https://your-service.up.railway.app`
(remembered per browser; `?api=reset` clears it). The host page adds that
to the overlay/watch/invite links it copies, since OBS and contestants
don't share the host's browser storage. A refresh resumes the session.

Host and Topics pages sit behind a sign-in card (`js/auth.js`): **Log in with
Twitch** (an allowed account only; the server keeps the session in an HttpOnly
cookie the page never sees), or "Use the admin token instead"
(`ADMIN_SESSION_SECRET`, remembered in this browser) as the fallback. The Twitch
button only appears once the server has its Twitch credentials.

## Status

The full loop works end to end in a real browser (see Tests below).

- **Host** (`host.html`) is guided: the round's phase decides the one thing to
  do next. Step one is inviting - *Start a session* creates two invite links,
  contestants pick their own names when they join, and the host sees who has
  arrived. One big button then moves through: draw topic & sides, reveal,
  start prep (the audience's opening vote opens with it, so viewers vote while
  contestants prepare), then "close voting & start debate" (the tally is
  recorded for you; typing a result by hand is the fallback, autofilled to total
  100), closing vote, announce the winner, next round. The host can see
  the topic and sides before the audience does. Rarely-needed controls (back a
  phase, void, clear polls, emergency hide) sit under "More controls". A
  refresh resumes the session. When a round ends the host chooses: **New round,
  new contestants** (both names are cleared and each contestant is asked for a
  name again, on the same links), **Same contestants, new topic**, or **Archive
  this round** (saved to `archive.html` as it happened, for future posts).
- **Contestants** (`play.html`) see a plain-language banner for every phase
  (what is happening, what to do), a step indicator, the question with its
  explainer line, their own stance and their opponent's, a live countdown,
  per-round notes (private, kept in their browser), and at the end the winner
  and the swing.
- **Watch** (`watch.html`) is where the audience votes: enter the room code on
  the landing page (`index.html`), and two big buttons appear on your phone
  while a poll is open. One vote per browser per poll, changeable until the
  host closes voting. Only a turnout count is shown while voting is open; the
  split is revealed afterwards.
- **Overlay** (`overlay.html`, for OBS) shows the question and explainer,
  "Alice vs Bob" and the room code on standby, where to vote (and how many
  have) during a poll, the audience's starting split during the debate, and the
  winner with the swing. The host closes voting with one click; typing a result
  by hand (e.g. from a Twitch poll) is still available as a fallback.

Modules: `state.js` (shared pub/sub), `api.js` (REST + snake_case -> camelCase),
`socket.js` (WebSocket with version-gap resync), `config.js` (API address),
`voter.js` (anonymous per-browser voter id), `watch.js` / `landing.js` (voting and
room-code entry),
`timer.js` (countdown maths), `guide.js` (host step logic), `copy.js`
(contestant wording), `topics-logic.js` (topic form rules) and `cues.js` (which
moment gets which sound/motion) - the last five are pure and unit-tested.
`ritual.js` and `sound.js` perform the cues.

### Motion and sound

The show moves in small rituals: a cauldron simmers on standby, the topic
condenses out of the brew and a seal stamps it shut, the two sides sweep in,
the last ten seconds of a clock pulse red, and the winner arrives in a shower of
sparks. Each one is a one-shot `ritual-*` class on `<body>` (`js/ritual.js`,
styles under "RITUAL MOTION" in `game.css`) that settles into a normal, readable
frame. `js/cues.js` (pure, tested) decides which state change earns which cue,
and the first snapshot after a page load or reconnect never fires one.

Sound is synthesized live with the Web Audio API in `js/sound.js`; there are no
audio files. Every effect is a small recipe of oscillators and filtered noise.

- **OBS overlay:** plays sound by itself. In the browser source's settings, tick
  "Control audio via OBS" to mix it, or add `&sound=off` to the URL to silence a
  copy, or `&volume=0.5` to turn it down. The overlay always animates, whatever
  the PC's reduced-motion setting says.
- **Watch and contestant pages:** an "Enable sound" button in the nav (browsers
  need a tap before a page may make noise). The choice is remembered; after a
  reload the next tap anywhere wakes it up. These pages honour
  `prefers-reduced-motion` (finished frames, no movement).

Not yet built: Twitch EventSub automation (channel-point / poll triggers).

## Tests

```bash
node --test "client/tests/*.test.mjs"     # pure logic: no browser needed

# Motion + sound in real Chrome, no server needed: renders every effect offline
# (audible, no clipping, dies away) and drives the overlay through a round.
# Serve client/ (python -m http.server 8080) then:
node e2e/ritual-check.js http://localhost:8080

# Host sign-in gate + Twitch login round trip, real auth code with a fake Twitch
# (no database): run `python tests/fake_login_server.py` in draga-server/, serve
# client/ on :8080, then:
node e2e/host-login.js

# Two full rounds in real Chrome (host, two contestants, three audience phones,
# overlay): audience voting, then the by-hand fallback. Needs the server
# running (CORS_ORIGINS / CLIENT_BASE_URL set to the client url) and the
# client served on :8080.
cd e2e && npm install
node full-game.js http://localhost:8080 <ADMIN_SESSION_SECRET> ./shots
```
