-- CatanDabuVerse — maps, game servers, matches, replays, stats
-- Design: docs/database/DATA_MODEL.md

-- =====================================================================
-- GAME CATALOG
-- =====================================================================
create table public.maps (
  id           text primary key,              -- matches map_layouts.py ids
  name         text not null,
  description  text,
  modes        public.game_mode[] not null,   -- e.g. {basic,cities}
  default_vp   smallint not null,
  min_players  smallint not null default 3,
  max_players  smallint not null default 4,
  preview_url  text,
  is_active    boolean not null default true,
  sort_order   smallint not null default 0
);

-- =====================================================================
-- GAME SERVERS
-- =====================================================================
-- Each live room is owned by exactly one server (its state is in that
-- process's memory). Clients find the owner via find_room().
create table public.game_servers (
  id                 uuid primary key default gen_random_uuid(),
  hostname           text not null,
  public_url         text not null,               -- Socket.IO endpoint clients connect to, e.g. wss://gs-1.example.com
  status             public.server_status not null default 'active',  -- 'draining' = no new rooms (deploys)
  max_rooms          integer not null default 200,
  version            text,
  region             text,
  started_at         timestamptz not null default now(),
  last_heartbeat_at  timestamptz not null default now(),
  active_rooms       integer not null default 0,
  connected_sockets  integer not null default 0,
  cpu_percent        real,
  mem_mb             real
);

-- =====================================================================
-- MATCHES
-- =====================================================================
create table public.matches (
  id                     uuid primary key default gen_random_uuid(),
  room_code              text not null,
  mode                   public.game_mode not null,
  map_id                 text not null references public.maps(id),
  status                 public.match_status not null default 'lobby',
  settings               jsonb not null default '{}',   -- vpLimit, turnTimeout, hideBankCards, balancedDice
  host_id                uuid references public.profiles(id) on delete set null,
  server_id              uuid references public.game_servers(id) on delete set null,
  recovered_count        smallint not null default 0,  -- times moved to another server after a crash
  created_at             timestamptz not null default now(),
  started_at             timestamptz,
  ended_at               timestamptz,
  end_reason             text,                          -- 'victory', 'all_left', 'admin_terminated', ...
  replay_expires_at      timestamptz,                   -- set at finish: ended_at + app_config.replay_retention_days
  replay_purged_at       timestamptz,                   -- events/keyframes deleted; match row + results kept
  winner_participant_id  bigint                         -- FK added below (circular)
);
-- A room code is unique only among live matches.
create unique index matches_live_room_code_uq on public.matches (room_code)
  where status in ('lobby', 'setup', 'playing');
create index matches_server_live_idx on public.matches (server_id) where status in ('lobby', 'setup', 'playing');
create index matches_ended_at_idx on public.matches (ended_at desc) where status = 'finished';

create table public.match_participants (
  id            bigint generated always as identity primary key,
  match_id      uuid not null references public.matches(id) on delete cascade,
  seat_index    smallint not null,
  turn_order    smallint,                       -- set when the game starts (order is shuffled)
  kind          public.seat_kind not null,
  user_id       uuid references public.profiles(id) on delete set null,
  bot_type      text,                           -- 'bot_easy', 'bot_medium', 'bot_hard', 'bot_mcts'
  display_name  text not null,                  -- snapshot at match time
  color         text not null,
  final_vp      smallint,
  placement     smallint,
  is_winner     boolean not null default false,
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  stats         jsonb not null default '{}',
  unique (match_id, seat_index),
  check ((kind = 'human' and bot_type is null) or (kind = 'bot' and user_id is null and bot_type is not null))
);
create index match_participants_user_idx on public.match_participants (user_id, match_id);

alter table public.matches
  add constraint matches_winner_fk foreign key (winner_participant_id)
  references public.match_participants(id) on delete set null;

-- Replay frames. A replay = keyframe (match_snapshots, seq 0 = initial board)
-- + ordered patches. The viewer applies patches to the state and feeds it to the
-- existing board renderer, so it needs no rules engine.
create table public.match_events (
  match_id    uuid not null references public.matches(id) on delete cascade,
  seq         integer not null,
  turn_no     integer,
  actor_seat  smallint,                         -- null = system (dice result, barbarians, ...)
  type        text not null,                    -- socket event name, e.g. 'buildRoad'
  payload     jsonb not null default '{}',      -- action input as sent by the client
  patch       jsonb not null,                   -- RFC 6902 JSON Patch: replay state before → after
  log_lines   text[] not null default '{}',     -- gameLog lines produced by this action
  created_at  timestamptz not null default now(),
  primary key (match_id, seq)
);
create index match_events_created_brin on public.match_events using brin (created_at);

create table public.match_snapshots (
  match_id    uuid not null references public.matches(id) on delete cascade,
  seq         integer not null,                 -- 0 = initial state; then every N events (keyframes for seeking)
  state       jsonb not null,                   -- full replay state (all hands revealed; deck order stripped)
  created_at  timestamptz not null default now(),
  primary key (match_id, seq)
);

create table public.chat_messages (
  id          bigint generated always as identity primary key,
  match_id    uuid not null references public.matches(id) on delete cascade,
  sender_id   uuid references public.profiles(id) on delete set null,
  sender_seat smallint,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles(id) on delete set null
);
create index chat_messages_match_idx on public.chat_messages (match_id, created_at);

-- =====================================================================
-- PROGRESSION, SOCIAL, REPLAY SHARING, CONFIG
-- =====================================================================
create table public.player_stats (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  mode             public.game_mode not null,
  games_played     integer not null default 0,
  wins             integer not null default 0,
  total_vp         integer not null default 0,
  longest_road     integer not null default 0,
  largest_army     integer not null default 0,
  current_streak   integer not null default 0,
  best_streak      integer not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (user_id, mode)
);
create index player_stats_wins_idx on public.player_stats (mode, wins desc);
-- Ranking (rating, rating_history) deferred: add columns/table in a later migration.

create table public.friendships (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  friend_id   uuid not null references public.profiles(id) on delete cascade,
  status      public.friend_status not null default 'pending',
  created_at  timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- Downloads of replay files (.catanreplay = gzipped JSON: format version,
-- match meta, participants, keyframes, events). Exported files stay playable
-- after the server copy is purged.
create table public.replay_exports (
  id              bigint generated always as identity primary key,
  match_id        uuid not null references public.matches(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  format_version  smallint not null,
  size_bytes      integer,
  created_at      timestamptz not null default now()
);
create index replay_exports_match_idx on public.replay_exports (match_id);

-- Share links: anyone with the token can watch (no account) until the
-- replay expires. Created by a participant; revocable.
create table public.replay_shares (
  token       text primary key default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_'),  -- 16 url-safe chars
  match_id    uuid not null references public.matches(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  view_count  integer not null default 0
);
create index replay_shares_match_idx on public.replay_shares (match_id);

-- Runtime settings editable from the admin site.
create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
