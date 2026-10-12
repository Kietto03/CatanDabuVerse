# Roadmap: accounts, database, replays, scaling

Status legend: ✅ done · 🔄 in progress · ⬜ not started

## Step 1: Supabase project & schema ✅ (2026-10-09)
- ✅ `supabase/` initialized; `config.toml` sets guest sign-in, identity linking, Google + Discord providers and the custom access-token hook
- ✅ Schema as 7 ordered migrations (`supabase/migrations/2026100900*`): foundation, identity/IAM, game, monitoring, RLS, replays/routing, reference data
- ✅ Reference data: 5 roles, 16 permissions, 12 maps (generated from `map_layouts.py`), `app_config`
- ✅ Replay purge scheduled with pg_cron (daily 03:15 UTC)
- ✅ Verified on a local Supabase stack through the real Auth + REST APIs: guest/email sign-up, JWT role claims, role change after refresh, profile column lock, guest→player upgrade, RLS on admin data, anon RPCs
- ✅ Hosted project `aeihqbeuqhopxtocelpd` ("Catan's Project", ap-southeast-1, Postgres 17): all migrations pushed with `supabase db push` (2026-10-12) after a clean local `db reset`; auth configured through the Management API (guest sign-in, identity linking, access-token hook, local redirect URLs with `/**`, min password 8, email confirmation on). Verified: hosted guest sign-up → ES256 JWT with `app_roles: ["guest"]`, auto profile, 12 maps readable
- ✅ App switched to the hosted project (2026-10-12): root `.env` (`DATABASE_URL` via the session pooler with the URL-encoded password, `SUPABASE_URL`) and `frontend/.env.local` (hosted URL + anon key); local values kept as comments for switching back
- ✅ Verified on the hosted project: guest sign-in, full game (125 s), finished match + results + 7-day replay window, replay exact (234 events), opens from match history. Test data removed afterwards
- ✅ Fixed while going hosted: (1) the server couldn't fetch the project's signing keys over HTTPS (python.org Python on macOS ships without root certificates), so every login was rejected; the JWKS client now uses the `certifi` CA bundle. (2) Every live update carried the **entire** game log, and the chat panel rendered all of it, so updates got slower all game long; in a fast bot game the page froze long enough to drop its connection, and the room was cleaned up. Live updates now carry the last 150 lines (`LOG_TAIL`, plus `gameLogTotal`), and the chat renders the last 150 with stable keys. Replays still keep the full log
- ⬜ Create the Google + Discord OAuth apps and enter their credentials. Needs the owner's accounts

## Step 2: Login in the app ✅ (2026-10-09)
- ✅ `@supabase/supabase-js` (own lazy-cacheable `supabase` chunk); env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (`frontend/.env.example`). Without them the app runs in the old name-only mode
- ✅ `src/lib/supabase.js` (PKCE client), `src/store/authStore.js` (session, profile, roles/permissions from JWT, all auth actions, Vietnamese error messages)
- ✅ `src/components/Auth.jsx`: login screen (Google, Discord, guest with nickname, email sign-in / sign-up / forgot password), account chip + modal (rename display name/username, guest → Google/Discord/email upgrade, sign out), set-new-password modal after a reset link
- ✅ Socket.IO sends `{ token }` on every (re)connect; connects only with a session; reconnects on account switch; clears the saved seat when a different user signs in. Intentional disconnects no longer flash the "connection lost" overlay
- ✅ Seat name = profile display name (bridge until step 3). `server.py` `connect` accepts the auth payload (not verified yet)
- ✅ Verified headless (Chrome) on the local stack: 21 checks covering guest, rename + validation, guest→email upgrade (roles guest→player), sign-out, wrong password, email sign-in, password reset via Mailpit, sign-up, 390px layout, Discord → `/authorize` with PKCE, 0 console errors; no-auth fallback also checked
- ⬜ Real Google/Discord round trip: needs the OAuth apps (owner). The buttons hand off correctly to Supabase
- ⬜ Avatar upload (needs Supabase Storage). Avatars currently come from Google/Discord only

## Step 3: Server on Postgres + real identity ✅ (2026-10-09)
- ✅ `db/` package (asyncpg): `__init__` (pool + ordered background writer per match, so the DB never blocks a move), `identity.py` (JWT verification via the project JWKS, ES256; HS256 legacy secret supported; profile, ban/mute lookups), `matches.py` (lifecycle writes). SQLite / `save_match` removed
- ✅ Settings in root `.env` (`.env.example`): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `IP_HASH_SALT`, `EMPTY_ROOM_GRACE_SECONDS`
- ✅ `connect` verifies the token and refuses `unauthorized` / `banned` (with reason + expiry). The client refreshes once on `unauthorized`, and signs out showing the ban reason
- ✅ Seats keyed by `uid`; seat name = profile display name (client-sent name ignored; duplicates get " (2)"); reconnect = same account (no seat secret); a stale tab's disconnect can't free a seat that moved to a new tab
- ✅ `matches` row at create (live room code = global lock), participants + `playing` at start, one idempotent `finish_match()` from every game-over path (results, placements, per-seat stats, `player_stats`, `replay_expires_at`), `abandoned` when everyone leaves. Boot marks leftover live matches `server_restart`
- ✅ Chat → `chat_messages` (muted users blocked); `connection_sessions` with salted IP hash
- ✅ Fixed while here: `check_victory` could crown a second winner after game over (this was the double save); a single-human game was deleted on page reload, so empty rooms now wait `EMPTY_ROOM_GRACE_SECONDS` (60) before deletion
- ✅ Legacy mode (no `SUPABASE_URL`) still works: typed names + seat secret
- ✅ Verified: 26-check socket test with real tokens and DB assertions, including a full 1 human + 3 bot game to victory (≈7 min) → finished row, winner, 4 placements, stats, `player_stats`, 7-day replay expiry. Browser test: profile-named seat, reload mid-game rejoins, broken token self-heals, ban → login with reason; 0 console errors
- ⬜ Old `catan.db` (winner names only, no accounts) is **archived, not imported**; the file is left on disk and ignored by git

## Step 4: Replays ✅ (2026-10-09)
- ✅ Recorder `db/replays.py`: after every broadcast, `get_replay_state(room)` (all hands revealed, socket ids → `seat-N`, no deck order or secrets) is diffed with `jsonpatch` and buffered; flushed every turn change, 25 events and at game over; keyframes at 0, every `replay_keyframe_every` (50) and the final frame. Overhead < 1 ms per action (44 KB state)
- ✅ Each event records its cause: the socket event name (every `@sio.on` handler is wrapped), `bot` or `timeout`, the acting seat and its payload
- ✅ `GET /api/replays/{id}` (JSON) and `/export` (`.catanreplay` = gzip, ~29 KB for a 277-event game, 14× smaller; logged in `replay_exports`). Participants or `match.view_any` only; 401/404/409/410 handled. GZip middleware on all responses; SPA routes `/replay/*` and `/r/*`
- ✅ Frontend: `lib/replay.js` (load by match / share token / file, `ReplayCursor` = nearest keyframe + patches), `ReplayViewer.jsx` (board + scoreboard + log; play/pause, 0.5–8×, step, previous/next turn, slider, ←/→/space keys; watch as spectator or any seat with their hand; share, download; collapsible panel on phones), `MatchHistory.jsx` (lobby "📜 Lịch sử": result, days left, Watch / Share / Download, open file). "Xem file replay" on the login screen works without an account
- ✅ While a replay is shown, the game store is in replay mode: outgoing actions are dropped and live updates ignored, and the real socket is restored on exit
- ✅ Verified: 21-check recorded-game test (contiguous events, keyframes, tagged actions, **keyframe 0 + all patches == final state exactly**, every intermediate keyframe matches, API access rules, export = gzip of the same replay, share RLS, anonymous share RPC) + 18-check browser test (history → viewer, stepping, turn jump, keyboard, slider, 8× playback, watch as seat, download, share, exit restores live socket, Back button, anonymous share link at 390 px, open downloaded file without an account, purged link → expired message); 0 console errors

## Step 5: Multiple game servers ✅ (2026-10-09)
- ✅ `db/servers.py`: each process registers in `game_servers` (`PUBLIC_URL`), heartbeats every `HEARTBEAT_SECONDS` (15) with rooms, sockets, load and memory; matches record `server_id`
- ✅ **Checkpoints** (migration `0800`, `match_checkpoints`, service-role only): replay keyframes omit hidden state (deck order etc.), so the full room is encoded losslessly (`db/recovery.py`: sets, tuples, int dict keys) and upserted with every replay flush. Dropped by trigger when the match closes
- ✅ Failover loop (`FAILOVER_INTERVAL_SECONDS`, 30): `claim_orphaned_matches` → `restore_match` rebuilds the room, resumes bots and the replay (continuing from the *recorded* state rebuilt from the DB, so the replay chain stays valid), and waits ≥ 120 s for players
- ✅ Graceful shutdown (SIGTERM): records pending changes, checkpoints every room, marks itself `dead` → another server takes over at its next tick. `draining` = no new rooms (`EXIT_WHEN_DRAINED=1` exits when empty)
- ✅ Split-brain protection: a server that finds itself declared `dead` drops its rooms, disconnects their players and re-registers; every match write is **fenced** (`owns_match`: row lock + owner check), so late writes from a former owner are discarded
- ✅ Client routing (`gameStore`): create → `pick_game_server`, join/reload → `find_room`; the socket moves between servers keeping all listeners; after an unexpected disconnect it polls `find_room` every 3 s and follows the room
- ✅ Verified with real processes (2 servers, 2 browsers, bots): placement on the least-loaded server, cross-server join, **crash (`kill -9`) → players back in 60 s**, **graceful SIGTERM → 4 s**, **declared-dead server → 5 s** and it re-registers empty, draining excluded from placement; replay contiguous and exact across all 3 takeovers
- Fixed while testing: auto-rejoin needed a saved username even with accounts; a disconnect with no humans left changed the log without being recorded, which broke the replay chain at the next takeover; a just-declared-dead server could still "claim" its own matches before noticing (migration `0900`: only an active, heartbeating server may claim, never its own matches)

## Step 6: Admin site ✅ (2026-10-12)
- ✅ `/admin[/<tab>]` as its own lazy chunk (`src/admin/`, 11.5 KB gzip); lobby shows "🛠 Quản trị" to staff. Tabs by permission: Overview + Matches & servers (`monitor.view`), Moderation (`report.resolve` / `user.mute`), Audit log (`audit.view`), Settings (`config.manage`); others see a no-access screen
- ✅ Overview (refresh 15 s): stat tiles, matches per day by mode (stacked columns), daily active players (line), bot win rates (finished games only). Plain-SVG charts per the data-viz spec, with validated palette, legend, hover tooltips and a table view under each chart
- ✅ Matches & servers (refresh 10 s): live matches with **terminate** (`admin_terminate_match` → the owning server closes the room on its next heartbeat and sends players back to the lobby with the reason); servers with status/heartbeat/rooms/sockets/load and **drain / reactivate**
- ✅ Moderation: report queue (take → resolve/dismiss with outcome), user search, roles (grant/revoke), mutes (moderators) and bans (admins) with duration, sanction history and revoke
- ✅ Settings: replay retention and keyframe interval, replay storage, exports in the last 7 days
- ✅ Migration `20261012000100_admin.sql`: permissions `server.manage`, `config.manage`; column-limited RLS writes (server status, config value, sanction revoke, report fields); moderators mute, admins ban; `v_user_overview`; bot win rates over finished games. **Every admin-site change is written to `audit_log` by triggers** (actor = the signed-in user); the game server's own writes aren't. `profiles.last_seen_at` set on connect
- ✅ Verified (Chrome, real accounts per role, 25 checks, 3 clean runs, 0 page errors): access per role incl. API-level denials, report → mute → resolve, terminate (player back in the lobby in 0.3–1.3 s), drain/reactivate, role grant, settings save, audit shows each action and who did it, 390 px layout
- ✅ In-game reporting (2026-10-12): ⚑ next to other human players in the top bar opens a report form (category + optional details) → `reports`. Live state now carries `matchId` and each seat's `userId` (stripped from replays). Migration `20261012000200_reports.sql`: no self-reports, details ≤ 1000 chars, one open report per reporter → player → match. Verified in Chrome (no button on self/bots, report stored with match, duplicate refused, replays carry no account ids) and pushed to the hosted project
- ✅ Fixed while testing: the shared `Modal` now renders into `<body>` (portal). A dialog opened from the blurred top bar was trapped inside it, because `backdrop-filter` makes an ancestor the containing block for `position: fixed`

## Step 7: CI/CD & deployment 🔄 (2026-10-12)
- ✅ GitHub Actions `ci-cd.yml`: backend pytest (engine invariants, checkpoint codec, server Socket.IO smoke), frontend lint + build, all migrations on a fresh Postgres + schema checks, Docker build; on `main`: `supabase db push`, then `flyctl deploy`, then a live smoke test. See [deploy.md](deploy.md)
- ✅ `Dockerfile` (web build + Python 3.13 server, non-root) and `.dockerignore`; image verified locally against the hosted project (DB, registration, hosted login over Socket.IO)
- ✅ `fly.toml`: `sin`, always-on single machine, health check, rolling deploys with game handover
- ✅ Frontend lint is now a real gate: 29 old errors fixed (unused imports and variables, empty catches); three advisory React-compiler rules downgraded to warnings
- ✅ Fly app `catandabuverse` (sin) with secrets, public IPs (shared v4 + v6), deploy token in GitHub; Supabase site URL + redirect allow-list set to `https://catandabuverse.fly.dev`
- ✅ First production deploy through GitHub (merge of PR #2): migrations step, Fly deploy and the live site all work. Verified in a browser on https://catandabuverse.fly.dev (guest sign-in, WebSocket, game start); test data removed
- ✅ Fixed: a dev server pointed at the production database registered itself as `http://localhost:3000` in the shared registry, so production placement could send players to localhost. Such servers no longer register
- ⬜ **Fly trial limit:** machines stop after 5 minutes until a card is added (owner)

## Later
- Ranking (rating on `player_stats` + `rating_history`)
- Friends & invites (`friendships` table already exists)
