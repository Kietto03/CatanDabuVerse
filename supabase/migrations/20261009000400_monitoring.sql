-- CatanDabuVerse — monitoring, moderation, admin views
-- Design: docs/database/DATA_MODEL.md

-- =====================================================================
-- MONITORING & MODERATION
-- =====================================================================
create table public.connection_sessions (
  id                 bigint generated always as identity primary key,
  user_id            uuid references public.profiles(id) on delete set null,
  server_id          uuid references public.game_servers(id) on delete set null,
  match_id           uuid references public.matches(id) on delete set null,
  socket_id          text,
  ip_hash            text,                      -- salted hash, never raw IP
  user_agent         text,
  connected_at       timestamptz not null default now(),
  disconnected_at    timestamptz,
  disconnect_reason  text
);
create index connection_sessions_open_idx on public.connection_sessions (server_id) where disconnected_at is null;

create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles(id) on delete set null,   -- null = system
  action       text not null,                   -- 'auth.login', 'role.grant', 'user.ban', 'match.terminate', ...
  target_type  text,
  target_id    text,
  metadata     jsonb not null default '{}',
  ip_hash      text,
  created_at   timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);

create table public.reports (
  id           bigint generated always as identity primary key,
  reporter_id  uuid references public.profiles(id) on delete set null,
  reported_id  uuid not null references public.profiles(id) on delete cascade,
  match_id     uuid references public.matches(id) on delete set null,
  category     text not null,                   -- 'cheating', 'abuse', 'afk', ...
  details      text,
  status       public.report_status not null default 'open',
  assigned_to  uuid references public.profiles(id) on delete set null,
  resolution   text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create table public.error_events (
  id          bigint generated always as identity primary key,
  server_id   uuid references public.game_servers(id) on delete set null,
  match_id    uuid references public.matches(id) on delete set null,
  level       text not null default 'error',
  message     text not null,
  context     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- MONITORING VIEWS (read by the /admin site)
-- =====================================================================
create view public.v_live_matches with (security_invoker = true) as
  select m.id, m.room_code, m.mode, m.map_id, m.status, m.started_at, m.server_id,
         count(p.*) filter (where p.kind = 'human' and p.left_at is null) as humans,
         count(p.*) filter (where p.kind = 'bot') as bots
  from public.matches m
  left join public.match_participants p on p.match_id = m.id
  where m.status in ('lobby', 'setup', 'playing')
  group by m.id;

create view public.v_server_health with (security_invoker = true) as
  select *, (now() - last_heartbeat_at) < interval '45 seconds' as is_alive
  from public.game_servers;

create view public.v_matches_per_day with (security_invoker = true) as
  select date_trunc('day', ended_at) as day, mode, count(*) as matches,
         avg(extract(epoch from ended_at - started_at) / 60)::numeric(6,1) as avg_minutes
  from public.matches where status = 'finished'
  group by 1, 2;

create view public.v_daily_active_users with (security_invoker = true) as
  select date_trunc('day', connected_at) as day, count(distinct user_id) as dau
  from public.connection_sessions group by 1;

create view public.v_replay_storage with (security_invoker = true) as
  select count(distinct match_id) as matches_with_replay, count(*) as events,
         pg_size_pretty(sum(pg_column_size(patch) + pg_column_size(payload))) as approx_size
  from public.match_events;

create view public.v_bot_winrates with (security_invoker = true) as
  select bot_type, count(*) as games, avg(is_winner::int)::numeric(5,3) as win_rate
  from public.match_participants where kind = 'bot' group by bot_type;
