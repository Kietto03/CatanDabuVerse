# Architecture

## Today (after steps 1–3)

```
Browser (React + PixiJS)  ◄──Socket.IO──►  server.py (FastAPI + python-socketio, port 3000)
                                              │  rooms = {} in memory (authoritative game state)
                                              │  bot_ai/ (heuristic + MCTS bots, in-process)
                                              └─ db/ → Postgres (Supabase): matches, results, chat, connections
```

- **server.py** owns all game state and rules. Clients send intents (`buildRoad`, `rollDice`, …) and the server validates them, mutates `rooms[code]` and broadcasts the new state (`broadcast_game_state`), hiding other players' private cards.
- **Identity** (since step 3): with `SUPABASE_URL` set, each socket is authenticated with a Supabase access token and seats belong to accounts. Without it, identity falls back to a typed username plus a per-seat token in `localStorage`.
- **Bots** run inside the server process (`schedule_bot_action`). The MCTS bot uses the headless engine in `bot_ai/engine.py` through `bot_ai/bridge.py`.
- **Frontend:** `frontend/src/store/gameStore.js` (Zustand) holds the socket and state. `BoardCanvas.jsx` renders the board with PixiJS. The server serves the built `frontend/dist`.

## Target (after the roadmap)

```
                         ┌──────────────── Supabase ────────────────┐
Browser ──supabase-js──► │ Auth (Google, Discord, email, guest)     │
   │  (login, profile,   │   └─ access-token hook → roles/perms     │
   │   history, replays, │ Postgres (RLS)  ◄── PostgREST / RPC      │
   │   admin site)       │   matches, replays, IAM, monitoring      │
   │                     │ pg_cron (replay purge)                   │
   │                     └──────────────────────────▲───────────────┘
   │  find_room / pick_game_server (RPC)            │ service_role (asyncpg)
   ▼                                                │
Socket.IO + JWT ──► game server #1 … #N (server.py) ┘
                     rooms in memory; heartbeat; replay recorder;
                     failover via claim_orphaned_matches
```

### Responsibilities

| Component | Owns | Talks to |
|---|---|---|
| Supabase Auth | Credentials, OAuth, guest accounts, JWT issuing | Postgres (via triggers/hook) |
| Postgres | Durable data, access rules (RLS), room directory, replay storage, retention | — |
| Game server | Live game state and rules, bots, replay recording, room recovery | Postgres as `service_role`. It verifies JWTs with the Supabase JWKS |
| Browser | UI. Reads its own data straight from Supabase under RLS. Plays only through the game server | Supabase (anon key + user JWT), game server (Socket.IO) |

### Key flows

**Login.** supabase-js signs in (Google, Discord, email or anonymous guest). Supabase Auth runs `custom_access_token_hook`, which adds `app_roles` and `app_permissions` to the JWT.

**Create / join a game.**
1. The browser calls the RPC `pick_game_server()` (create) or `find_room(code)` (join) and gets a server URL.
2. It connects with `io(url, { auth: { token: jwt } })`.
3. The server verifies the JWT, then maps `sid → user_id → seat`. Reconnect means "same user_id gets the same seat".

**During a game.** Every accepted action updates memory and broadcasts as today. The server also appends `(action, JSON-Patch)` to a buffer that is flushed to `match_events` at every turn end. A full keyframe goes to `match_snapshots` every 50 events.

**Game end.** One idempotent `finalize_match()` transaction writes the results, participant stats and `player_stats`, and sets `replay_expires_at`.

**Replays.** The in-app viewer reads `match_snapshots` + `match_events` under RLS. Share links use the RPC `get_shared_replay(token)`, and the export endpoint gzips `build_replay(match_id)`.

**Monitoring.** Servers heartbeat into `game_servers`. The `/admin` route reads the `v_*` views (and Realtime for live updates), gated by the `monitor.view` permission.

See [database/DATA_MODEL.md](database/DATA_MODEL.md) for the data design.
