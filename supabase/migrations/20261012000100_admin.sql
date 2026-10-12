-- CatanDabuVerse — admin site (roadmap step 6)
-- Design: docs/database/DATA_MODEL.md §4 (IAM), §6.8 (monitoring)
--
-- The /admin page talks to Supabase directly under RLS. This migration adds the
-- writes it needs, gated by permissions from the JWT, and audits every such
-- change with triggers (actor = auth.uid()); the game server's own writes run
-- without a user and are not audited here.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('server.manage', 'Drain / reactivate game servers'),
  ('config.manage', 'Edit runtime settings (replay retention, ...)')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r, public.permissions p
where r.key = 'admin' and p.key in ('server.manage', 'config.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Game servers: drain / reactivate (status only, never 'dead')
-- ---------------------------------------------------------------------------
grant update (status) on public.game_servers to authenticated;
create policy "manage server status" on public.game_servers for update
  using (public.authorize('server.manage'))
  with check (public.authorize('server.manage') and status in ('active', 'draining'));

-- ---------------------------------------------------------------------------
-- Runtime settings
-- ---------------------------------------------------------------------------
create policy "config readable" on public.app_config for select using (public.authorize('config.manage'));
grant update (value, updated_at, updated_by) on public.app_config to authenticated;
create policy "config editable" on public.app_config for update
  using (public.authorize('config.manage')) with check (public.authorize('config.manage'));

-- ---------------------------------------------------------------------------
-- Sanctions: moderators mute, admins also ban
-- ---------------------------------------------------------------------------
drop policy "manage sanctions" on public.sanctions;
create policy "issue sanction" on public.sanctions for insert with check (
  issued_by = auth.uid()
  and ((kind = 'mute' and public.authorize('user.mute')) or public.authorize('user.ban')));
create policy "revoke sanction" on public.sanctions for update
  using ((kind = 'mute' and public.authorize('user.mute')) or public.authorize('user.ban'))
  with check (revoked_by = auth.uid());
grant update (revoked_at, revoked_by) on public.sanctions to authenticated;

-- ---------------------------------------------------------------------------
-- Reports: moderators work the queue
-- ---------------------------------------------------------------------------
revoke update on public.reports from authenticated;
grant update (status, assigned_to, resolution, resolved_at) on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Terminate a live match. The owning game server notices on its next
-- heartbeat, closes the room and sends its players back to the lobby.
-- ---------------------------------------------------------------------------
create function public.admin_terminate_match(p_match_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.authorize('match.terminate') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.matches
     set status = 'terminated', ended_at = now(), end_reason = 'admin: ' || left(coalesce(p_reason, ''), 200)
   where id = p_match_id and status in ('lobby', 'setup', 'playing')
  returning room_code into v_code;
  if v_code is null then
    return false;
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'match.terminate', 'match', p_match_id::text,
          jsonb_build_object('room_code', v_code, 'reason', p_reason));
  return true;
end $$;
revoke execute on function public.admin_terminate_match from public, anon;
grant execute on function public.admin_terminate_match to authenticated;

-- ---------------------------------------------------------------------------
-- Audit trail for admin-site changes
-- ---------------------------------------------------------------------------
create function public.audit_admin_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_target text;
  v_meta jsonb;
begin
  if auth.uid() is null then          -- service role / game server: not an admin action
    return coalesce(new, old);
  end if;
  v_target := coalesce(
    (to_jsonb(coalesce(new, old)) ->> 'user_id'),
    (to_jsonb(coalesce(new, old)) ->> 'id'),
    (to_jsonb(coalesce(new, old)) ->> 'key'));
  v_meta := case tg_op
    when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
    when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
    else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) end;
  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, v_target, v_meta);
  return coalesce(new, old);
end $$;

create trigger audit_user_roles after insert or delete on public.user_roles
  for each row execute function public.audit_admin_change();
create trigger audit_sanctions after insert or update on public.sanctions
  for each row execute function public.audit_admin_change();
create trigger audit_reports after update on public.reports
  for each row execute function public.audit_admin_change();
create trigger audit_app_config after update on public.app_config
  for each row execute function public.audit_admin_change();
create trigger audit_game_servers after update of status on public.game_servers
  for each row execute function public.audit_admin_change();

-- Admin user search needs to see role keys next to names.
create view public.v_user_overview with (security_invoker = true) as
  select p.id, p.username, p.display_name, p.avatar_url, p.is_guest, p.created_at, p.last_seen_at,
         coalesce((select array_agg(r.key order by r.id) from public.user_roles ur
                   join public.roles r on r.id = ur.role_id
                   where ur.user_id = p.id and (ur.expires_at is null or ur.expires_at > now())), '{}') as roles,
         (select count(*) from public.sanctions s
           where s.user_id = p.id and s.revoked_at is null
             and (s.expires_at is null or s.expires_at > now())) as active_sanctions
  from public.profiles p;

-- Bot win rates over finished matches only (abandoned games aren't losses).
create or replace view public.v_bot_winrates with (security_invoker = true) as
  select p.bot_type, count(*) as games, avg(p.is_winner::int)::numeric(5,3) as win_rate
  from public.match_participants p
  join public.matches m on m.id = p.match_id and m.status = 'finished'
  where p.kind = 'bot'
  group by p.bot_type;
