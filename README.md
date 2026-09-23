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

Page shells styled with the site's shared Crypt design system
(`client/css/crypt.css`, vendored from the main Mordraga.me site). JS
modules are wired against `draga-server`'s live API and WebSocket
contract (verified there via integration tests), but not yet exercised
in an actual browser against a running server:

- `state.js` — shared pub/sub state, camelCase throughout.
- `api.js` — REST wrapper; normalizes the server's snake_case
  `PublicSessionStateOut` payload into `state`'s shape, and holds the
  admin token (prompted once, cached in `localStorage` — an interim
  stand-in for the real login flow spec section 10 describes).
- `socket.js` — WebSocket client: version-gap detection triggers a REST
  resync (spec 11/12), reconnects with exponential backoff.
- `host.js` — session/round controls, plus per-contestant invite links
  (each minted server-side, shown once, copied to clipboard).
- `overlay.js` — also drives `watch.html`, since spec 5.D says it
  "mirrors the overlay"; reacts to the host's emergency-hide toggle.
- `play.js` — identity now comes from redeeming a real invite token
  (`?token=` query param) instead of a guessable `?seat=A` param.

Not yet built: topic admin UI, and the "ritualistic" motion design
(spec section 6) beyond basic fade-ins.
