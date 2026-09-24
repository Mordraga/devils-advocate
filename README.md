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
don't share the host's browser storage. The first mutation prompts for the
admin token (`ADMIN_SESSION_SECRET`). A refresh resumes the session.

## Status

The full loop works end to end in a real browser (see Tests below).

- **Host** (`host.html`) is guided: the round's phase decides the one thing to
  do next. Step one is inviting - *Start a session* creates two invite links,
  contestants pick their own names when they join, and the host sees who has
  arrived. One big button then moves through: draw topic & sides, reveal,
  start prep, open the opening poll (enter the result, autofilled to total
  100), debate, closing poll, announce the winner, next round. The host can see
  the topic and sides before the audience does. Rarely-needed controls (back a
  phase, void, clear polls, emergency hide) sit under "More controls". A
  refresh resumes the session.
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
`timer.js` (countdown maths), `guide.js` (host step logic) and `copy.js`
(contestant wording) - the last three are pure and unit-tested.

Not yet built: topic admin UI, and the "ritualistic" motion design (spec
section 6) beyond basic fade-ins.

## Tests

```bash
node --test "client/tests/*.test.mjs"     # pure logic: no browser needed

# Two full rounds in real Chrome (host, two contestants, three audience phones,
# overlay): audience voting, then the by-hand fallback. Needs the server
# running (CORS_ORIGINS / CLIENT_BASE_URL set to the client url) and the
# client served on :8080.
cd e2e && npm install
node full-game.js http://localhost:8080 <ADMIN_SESSION_SECRET> ./shots
```
