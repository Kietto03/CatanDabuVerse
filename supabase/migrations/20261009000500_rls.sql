-- CatanDabuVerse — row level security
-- Design: docs/database/DATA_MODEL.md

-- Participation check. SECURITY DEFINER so policies on matches and
--    match_participants can use it without recursing into each other.
create function public.is_match_participant(p_match_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_participants p
                 where p.match_id = p_match_id and p.user_id = auth.uid());
$$;

-- =====================================================================
-- ROW LEVEL SECURITY (the game server uses service_role and bypasses it)
-- =====================================================================
alter table public.profiles            enable row level security;
alter table public.user_settings       enable row level security;
alter table public.roles               enable row level security;
alter table public.permissions         enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.user_roles          enable row level security;
alter table public.sanctions           enable row level security;
alter table public.maps                enable row level security;
alter table public.game_servers        enable row level security;
alter table public.matches             enable row level security;
alter table public.match_participants  enable row level security;
alter table public.match_events        enable row level security;
alter table public.match_snapshots     enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.replay_exports      enable row level security;
alter table public.replay_shares       enable row level security;
alter table public.app_config          enable row level security;
alter table public.player_stats        enable row level security;
alter table public.friendships         enable row level security;
alter table public.connection_sessions enable row level security;
alter table public.audit_log           enable row level security;
alter table public.reports             enable row level security;
alter table public.error_events        enable row level security;

-- Public reads
create policy "profiles readable"     on public.profiles      for select using (true);
create policy "maps readable"         on public.maps          for select using (is_active or public.authorize('map.manage'));
create policy "stats readable"        on public.player_stats  for select using (true);
create policy "finished matches readable" on public.matches   for select
  using (status = 'finished' or public.authorize('match.view_any') or public.is_match_participant(id));
create policy "participants readable" on public.match_participants for select
  using (public.authorize('match.view_any') or public.is_match_participant(match_id)
         or exists (select 1 from public.matches m where m.id = match_id and m.status = 'finished'));

-- Own data
create policy "update own profile"    on public.profiles      for update using (id = auth.uid()) with check (id = auth.uid());
-- Users may only change these profile columns (is_guest, timestamps, ... are server-managed).
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url, country) on public.profiles to authenticated;
create policy "own settings"          on public.user_settings for all    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own roles readable"    on public.user_roles    for select using (user_id = auth.uid() or public.authorize('role.assign'));
create policy "own sanctions readable" on public.sanctions    for select using (user_id = auth.uid() or public.authorize('user.mute'));
create policy "own friendships"       on public.friendships   for all
  using (auth.uid() in (user_id, friend_id)) with check (user_id = auth.uid());

-- Replays & chat: participants of finished matches, or moderators
create policy "replay events" on public.match_events for select using (
  public.authorize('match.view_any') or (public.is_match_participant(match_id) and exists (
    select 1 from public.matches m where m.id = match_events.match_id and m.status = 'finished')));
create policy "replay keyframes" on public.match_snapshots for select using (
  public.authorize('match.view_any') or (public.is_match_participant(match_id) and exists (
    select 1 from public.matches m where m.id = match_snapshots.match_id and m.status = 'finished')));
create policy "own shares"    on public.replay_shares for select
  using (created_by = auth.uid() or public.authorize('match.view_any'));
create policy "create share"  on public.replay_shares for insert with check (
  created_by = auth.uid() and public.authorize('replay.share') and public.is_match_participant(match_id)
  and exists (select 1 from public.matches m where m.id = match_id and m.status = 'finished' and m.replay_purged_at is null));
create policy "revoke share"  on public.replay_shares for update
  using (created_by = auth.uid() or public.authorize('match.view_any'));
create policy "own exports"   on public.replay_exports for select using (user_id = auth.uid() or public.authorize('monitor.view'));
create policy "chat readable" on public.chat_messages for select using (
  public.authorize('chat.delete') or public.is_match_participant(match_id));
create policy "chat moderation" on public.chat_messages for update
  using (public.authorize('chat.delete')) with check (public.authorize('chat.delete'));

-- Reports
create policy "file report"   on public.reports for insert with check (reporter_id = auth.uid());
create policy "read reports"  on public.reports for select using (reporter_id = auth.uid() or public.authorize('report.resolve'));
create policy "handle report" on public.reports for update using (public.authorize('report.resolve'));

-- IAM admin
create policy "roles readable"       on public.roles            for select using (auth.role() = 'authenticated');
create policy "perms readable"       on public.permissions      for select using (auth.role() = 'authenticated');
create policy "role perms readable"  on public.role_permissions for select using (auth.role() = 'authenticated');
create policy "assign roles"         on public.user_roles       for all
  using (public.authorize('role.assign')) with check (public.authorize('role.assign'));
create policy "manage sanctions"     on public.sanctions        for all
  using (public.authorize('user.ban')) with check (public.authorize('user.ban'));

-- Monitoring (read-only for operators)
create policy "monitor servers"  on public.game_servers        for select using (public.authorize('monitor.view'));
create policy "monitor sessions" on public.connection_sessions for select using (public.authorize('monitor.view'));
create policy "monitor errors"   on public.error_events        for select using (public.authorize('monitor.view'));
create policy "audit readable"   on public.audit_log           for select using (public.authorize('audit.view'));
-- app_config: no client policies → server/service_role only (admin edits go through the server).

-- Supabase Auth runs the access-token hook as supabase_auth_admin, which is
-- subject to RLS: let it read the role tables.
create policy "auth admin reads user_roles"       on public.user_roles       as permissive for select to supabase_auth_admin using (true);
create policy "auth admin reads roles"            on public.roles            as permissive for select to supabase_auth_admin using (true);
create policy "auth admin reads role_permissions" on public.role_permissions as permissive for select to supabase_auth_admin using (true);
