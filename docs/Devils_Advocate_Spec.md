# Devil's Advocate

## Product and Technical Specification v0.1

**Project owner:** Mordraga  
**Format:** Live VTuber debate game / competitive rhetorical improv  
**Core premise:** The cauldron chooses a silly debate topic and randomly assigns each contestant a position. Contestants do not need to agree with their assigned stance. The audience votes before and after the debate. The winner is the contestant who moves the audience furthest toward their assigned position.

> The cauldron chooses. The witches suffer. Chat judges.

---

## 1. System Split

The project is two connected products:

| Layer | Responsibility | Recommended home |
| --- | --- | --- |
| Devil's Advocate client | Host controls, OBS overlay, contestant views, audience display | Static HTML/CSS/JS on GitHub Pages or the existing site host |
| Devil's Advocate server | Session authority, randomization, synchronization, scoring, saved topics and matches | FastAPI service on Railway |

The browser clients never decide the official topic, assignments, phase, or winner. They render the state issued by the server.

### Recommended URLs

- `advocate.mordraga.me` — public landing page and show display
- `advocate.mordraga.me/host` — authenticated host control panel
- `advocate.mordraga.me/overlay/{session_code}` — transparent OBS browser source
- `advocate.mordraga.me/play/{session_code}` — contestant room
- `advocate.mordraga.me/watch/{session_code}` — optional audience-facing view
- `api.mordraga.me/devils-advocate/*` — backend API

Alternative flavor URL: `cauldron.mordraga.me`. `advocate.mordraga.me` is clearer outside the lore; the interface itself can still call the engine **The Cauldron**.

---

## 2. Game Loop

1. Host creates a session.
2. Host adds two contestants and selects an eligible topic pool.
3. Server randomly selects one topic.
4. Server independently randomizes Side A and Side B between contestants.
5. Reveal screen exposes the topic and assignments.
6. A 15-minute preparation phase begins.
7. Host runs the opening Twitch poll.
8. Host records the opening result in the control panel.
9. Debate begins. The host controls the debate timer.
10. Host runs the closing Twitch poll.
11. Host records the closing result.
12. Server calculates audience sway and reveals the winner.
13. Match is archived and may be reset for another round.

### State machine

```text
LOBBY
  -> TOPIC_LOCKED
  -> REVEAL
  -> PREPARATION
  -> OPENING_POLL
  -> DEBATE
  -> CLOSING_POLL
  -> RESULTS
  -> ARCHIVED
```

The host may pause a timer, return to the immediately previous phase, or void a round. A reroll creates a logged event and clears all poll results for that round.

---

## 3. Scoring

Each stance has an opening vote percentage and a closing vote percentage.

```text
Side A sway = closing_A - opening_A
Side B sway = closing_B - opening_B
winner = side with the larger positive sway
```

Because a two-option poll totals 100%, the movements mirror each other. Displaying both remains useful for show clarity.

### Example

| | Opening | Closing | Sway |
| --- | ---: | ---: | ---: |
| Doors | 70% | 54% | -16 |
| Wheels | 30% | 46% | +16 |

**Winner:** The contestant assigned to Wheels, with a 16-point audience swing.

### Result rules

- Equal change: draw.
- Missing opening or closing poll: result cannot be finalized.
- Percentages must each be between 0 and 100.
- Both sides of a poll must total 100, allowing a small rounding tolerance such as ±0.2.
- A voided match is retained in the log but excluded from win statistics.

---

## 4. Topic Model

Topics must be goofy by design, immediately legible, and defensible from either side. The ideal prompt makes chat argue before the contestants begin.

```json
{
  "id": "internet-dress-001",
  "category": "internet_landmine",
  "subject": "the_dress",
  "prompt": "What color is the dress?",
  "side_a": "White and gold",
  "side_b": "Blue and black",
  "tags": ["visual", "cursed_pull", "internet_history"],
  "content_warning": null,
  "enabled": true,
  "weight": 1
}
```

### Initial categories

- **Internet Landmines:** The Dress, GIF pronunciation, Laurel vs. Yanny
- **Impossible Counts:** Doors vs. wheels, eyes vs. legs, chairs vs. tables
- **Food Court:** Cereal as soup, hot dog as sandwich, pineapple on pizza
- **Object Ontology:** One-hole vs. two-hole straw, hoodie vs. jacket, couch vs. chair
- **Cursed Hypotheticals:** 100 people vs. one gorilla, horse-sized duck vs. duck-sized horses
- **Gaming Arguments:** Save consumables vs. use them, PC vs. console, fashion vs. stats
- **Occult Nonsense:** Ghosts as tenants vs. squatters, necromancy as recycling vs. identity theft

### Selection rules

- Topic selection and stance assignment are separate random operations.
- Disabled topics are never selected.
- Recently played topics can be excluded for a configurable cooldown.
- `cursed_pull` topics may use a lower weight so they feel like rare cultural landmines.
- The host may constrain the pool by category or tag before the draw.
- Once revealed, a topic is immutable unless the host explicitly voids or rerolls the round.

---

## 5. Client Surfaces

### A. Host Control Panel

Private surface used by Mordraga or a producer.

Required controls:

- Create, resume, and archive a session
- Add/edit contestant display names, pronouns, avatar URLs, and accent colors
- Choose categories/tags eligible for the draw
- Draw topic
- Assign sides randomly
- Reveal topic and sides
- Start, pause, resume, and reset preparation/debate timers
- Advance or reverse the current phase
- Enter opening and closing poll results
- Finalize and reveal the winner
- Void or reroll with confirmation
- Copy OBS, contestant, and audience URLs
- Emergency hide overlay / switch to standby card

The panel should show a compact event log: who performed an action, what changed, and when.

### B. OBS Overlay

Transparent, 1920×1080-safe browser source with responsive scaling.

Overlay states:

- Standby cauldron
- Topic draw animation
- Topic reveal
- Assignment reveal
- Preparation timer
- Debate lower-third
- Poll-open indicator
- Results and sway reveal
- Technical pause

OBS receives state only. It has no editing controls and no secret credentials in its URL.

### C. Contestant Room

Joinable by expiring invite link or room code.

Shows:

- Contestant identity and assigned stance
- Current topic
- Preparation/debate timer
- Current phase
- Connection status
- Optional private notes area stored only in that browser for MVP

Contestants cannot change official state.

### D. Public Watch View

Optional full-page version for viewers, raids, or future event embedding. It mirrors the overlay but includes accessible text and does not assume transparency.

---

## 6. Visual Direction

### Design language

- Modern occult game-show interface
- Cozy horror over polished esports
- Aged paper, smoked glass, iron, candle glow, and controlled blood-red accents
- Cauldron as the randomizer, not merely decoration
- Clean-but-ragged linework and legible large type
- Motion should feel ritualistic: simmer, draw, seal, reveal

### Core visual hierarchy

1. Topic
2. Assigned sides and contestant names
3. Timer / current phase
4. Poll or sway data
5. Atmospheric framing

### Accessibility

- Never encode sides by color alone.
- Maintain readable contrast over game footage.
- Provide reduced-motion mode.
- All animations must resolve into a stable readable frame.
- Use text labels for phase and connection state.
- OBS layout must remain readable at 720p output.

---

## 7. Server Specification

### Recommended stack

- Python 3.12
- FastAPI
- PostgreSQL
- SQLAlchemy 2 + Alembic
- WebSockets for live session synchronization
- Railway deployment
- CORS restricted to `advocate.mordraga.me` and local development origins

For a single active show, one Railway service is enough. Do not add Redis until horizontal scaling or cross-process pub/sub is actually required.

### Server responsibilities

- Authenticate host actions
- Create and persist sessions
- Select topics using server-side randomness
- Assign sides using server-side randomness
- Validate legal phase transitions
- Own timer timestamps
- Broadcast state changes to all connected clients
- Validate poll values and calculate sway
- Store match history and audit events
- Issue and revoke contestant invite tokens
- Recover an active session after page refresh or server restart

### Timer model

The server stores `started_at`, `ends_at`, `paused_at`, and `remaining_ms`. Clients render a countdown from those timestamps. The server does not emit one message per second.

---

## 8. Data Model

### `topics`

- `id` UUID
- `slug` unique text
- `category` text
- `subject` text nullable
- `prompt` text
- `side_a` text
- `side_b` text
- `tags` JSONB or text array
- `content_warning` text nullable
- `weight` integer default 1
- `enabled` boolean default true
- `created_at`, `updated_at`

### `sessions`

- `id` UUID
- `public_code` unique short code
- `title` text
- `status` enum: active, archived
- `current_round_id` nullable
- `created_by`
- `created_at`, `updated_at`

### `contestants`

- `id` UUID
- `session_id` FK
- `display_name`
- `pronouns` nullable
- `avatar_url` nullable
- `accent_color` nullable
- `seat` enum: one, two

### `rounds`

- `id` UUID
- `session_id` FK
- `topic_id` FK
- `phase` enum
- `side_a_contestant_id` FK
- `side_b_contestant_id` FK
- `opening_a`, `opening_b` numeric nullable
- `closing_a`, `closing_b` numeric nullable
- `winner_contestant_id` nullable
- `status` enum: live, complete, void
- timer fields
- `created_at`, `completed_at`

### `events`

- `id` UUID
- `session_id` FK
- `round_id` nullable FK
- `event_type`
- `actor_id`
- `payload` JSONB
- `created_at`

### `invite_tokens`

- `id` UUID
- `session_id` FK
- `contestant_id` FK
- `token_hash`
- `expires_at`
- `revoked_at` nullable

---

## 9. API Surface

Prefix: `/devils-advocate/v1`

### Host REST actions

- `POST /sessions`
- `GET /sessions/{id}`
- `POST /sessions/{id}/contestants`
- `POST /sessions/{id}/rounds`
- `POST /rounds/{id}/draw-topic`
- `POST /rounds/{id}/assign-sides`
- `POST /rounds/{id}/transition`
- `POST /rounds/{id}/timer/start`
- `POST /rounds/{id}/timer/pause`
- `POST /rounds/{id}/polls/opening`
- `POST /rounds/{id}/polls/closing`
- `POST /rounds/{id}/finalize`
- `POST /rounds/{id}/void`
- `POST /rounds/{id}/reroll`
- `POST /sessions/{id}/invites`

### Public reads

- `GET /public/sessions/{public_code}`
- `GET /public/sessions/{public_code}/state`
- `WS /ws/sessions/{public_code}`

### Topic management

- `GET /topics`
- `POST /topics`
- `PATCH /topics/{id}`
- `POST /topics/import`
- `GET /topics/export`

Public state responses must exclude host identity, invite tokens, private notes, and unrevealed assignments.

---

## 10. Authentication and Security

### MVP

- Host panel protected by a real login or a long random admin session token stored in an HttpOnly secure cookie.
- Contestant links use single-purpose, expiring tokens.
- Overlay and watch URLs use public session codes with read-only access.
- All host mutations require CSRF-resistant authentication.
- Rate-limit login, invite redemption, and mutation endpoints.
- Store token hashes, never raw invite tokens.
- Do not place admin secrets in OBS URLs, JavaScript bundles, or local storage.
- Server validates every state transition. UI visibility is not authorization.

### Twitch integration boundary

**MVP:** Host creates Twitch polls manually and enters final percentages into the host panel.

**Phase 2:** Twitch OAuth and EventSub may create polls and ingest results automatically. This requires broadcaster authorization and token refresh handling. The game must remain usable when Twitch integration is disconnected.

---

## 11. Real-Time Contract

Every WebSocket message uses an envelope:

```json
{
  "type": "session.state_changed",
  "session_code": "ABYSS7",
  "version": 42,
  "server_time": "2026-09-21T01:30:00Z",
  "data": {}
}
```

Clients track `version`. If a version is skipped or the socket reconnects, the client fetches the full current state through REST before resuming.

Required events:

- `session.state_changed`
- `round.topic_locked`
- `round.revealed`
- `round.phase_changed`
- `round.timer_changed`
- `round.poll_recorded`
- `round.result_finalized`
- `overlay.visibility_changed`

---

## 12. Failure Behavior

- Overlay reconnects automatically with exponential backoff.
- A disconnected client keeps rendering its last known stable state with a subtle stale-state indicator outside the broadcast-safe crop.
- Refreshing any client restores current state from the server.
- Server restart restores active round, phase, and timer from PostgreSQL timestamps.
- Invalid transitions return a conflict response and do not partially mutate state.
- Duplicate button submissions are idempotent where practical.
- Host has a one-click standby card if anything breaks during a stream.

---

## 13. MVP Boundary

### Build now

- Topic library from JSON seed data
- One active two-contestant session
- Server-side topic draw and side assignment
- Host panel
- OBS overlay
- Contestant read-only rooms
- Preparation and debate timers
- Manual opening/closing poll entry
- Sway calculation and winner reveal
- WebSocket synchronization
- Persistent session and match history
- Standby / emergency-hide state

### Explicitly later

- Twitch OAuth, poll creation, or EventSub ingestion
- More than two contestants
- Brackets, seasons, or leaderboards
- Audience voting hosted by Mordraga.me
- Discord integration
- AI-generated arguments or topic moderation
- Multi-host permissions
- Redis or multi-instance real-time infrastructure
- Public user accounts

---

## 14. Repository Shape

```text
devils-advocate/
  client/
    index.html
    host.html
    overlay.html
    play.html
    watch.html
    css/
    js/
      api.js
      socket.js
      state.js
      host.js
      overlay.js
      play.js
    assets/
  server/
    app/
      main.py
      api/
      auth/
      models/
      schemas/
      services/
        randomizer.py
        scoring.py
        transitions.py
        broadcaster.py
      seed/
        topics.json
    alembic/
    tests/
    pyproject.toml
  docs/
  README.md
```

One repository is simplest for the MVP even if the frontend and backend deploy separately.

---

## 15. Build Order

1. Define topic JSON and validation schema.
2. Implement scoring and legal state transitions as pure functions with tests.
3. Create database models and migrations.
4. Build REST endpoints for sessions, rounds, draw, assignment, polls, and finalize.
5. Add WebSocket state broadcast and reconnect recovery.
6. Build an ugly but complete host panel.
7. Build the stable OBS overlay states.
8. Add contestant rooms and invite links.
9. Apply Crypt visual design and motion.
10. Run a two-browser rehearsal, then an OBS rehearsal, then a live unlisted test.

---

## 16. Acceptance Criteria

The MVP is ready when:

- A host can create and complete a round without touching the database or server console.
- Topic and stance assignments are produced only by the server and displayed consistently to every connected client.
- Refreshing or reconnecting does not lose the active match.
- OBS displays every phase cleanly at 1920×1080 and remains readable at 1280×720 output.
- Opening and closing poll results produce the correct sway and winner.
- A reroll or void is visible in the event log.
- Contestants cannot invoke host actions.
- No secret appears in a browser-source URL or public API response.
- The whole game still works if Twitch automation does not exist.

---

## 17. First Engineering Decision

Use the existing house stack:

- Static HTML/CSS/JS frontend
- FastAPI + PostgreSQL backend on Railway
- Porkbun DNS
- `advocate.mordraga.me` for the client
- `api.mordraga.me` for the backend

This preserves the current Mordraga web architecture, avoids premature infrastructure, and leaves a clean path for native Twitch polling later.
