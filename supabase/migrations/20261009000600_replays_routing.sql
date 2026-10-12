-- CatanDabuVerse — replay retention/assembly, multi-server routing & failover
-- Design: docs/database/DATA_MODEL.md

-- =====================================================================
-- REPLAY RETENTION
-- =====================================================================
create function public.purge_expired_replays() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with expired as (
    update public.matches set replay_purged_at = now()
    where replay_expires_at < now() and replay_purged_at is null
    returning id
  ), ev as (
    delete from public.match_events e using expired x where e.match_id = x.id
  ), kf as (
    delete from public.match_snapshots k using expired x where k.match_id = x.id
  )
  select count(*) into n from expired;
  insert into public.audit_log (action, metadata) values ('replay.purge', jsonb_build_object('matches', n));
  return n;
end $$;
revoke execute on function public.purge_expired_replays from public, anon, authenticated;

-- Daily purge at 03:15 UTC.
create extension if not exists pg_cron;
select cron.schedule('purge-expired-replays', '15 3 * * *', $$select public.purge_expired_replays()$$);
-- =====================================================================
-- REPLAY ASSEMBLY (export endpoint, share links, in-app viewer)
-- =====================================================================
create function public.build_replay(p_match_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'format', 'catanreplay', 'version', 1,
    'match', jsonb_build_object('id', m.id, 'room_code', m.room_code, 'mode', m.mode, 'map_id', m.map_id, 'settings', m.settings,
                                'started_at', m.started_at, 'ended_at', m.ended_at),
    'participants', (select coalesce(jsonb_agg(jsonb_build_object(
        'seat', p.seat_index, 'turn_order', p.turn_order, 'display_name', p.display_name, 'color', p.color,
        'bot_type', p.bot_type, 'final_vp', p.final_vp, 'is_winner', p.is_winner) order by p.turn_order), '[]')
      from public.match_participants p where p.match_id = m.id),
    'keyframes', (select coalesce(jsonb_agg(jsonb_build_object('seq', k.seq, 'state', k.state) order by k.seq), '[]')
      from public.match_snapshots k where k.match_id = m.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('seq', e.seq, 'turn_no', e.turn_no, 'actor_seat', e.actor_seat,
        'type', e.type, 'patch', e.patch, 'log_lines', e.log_lines) order by e.seq), '[]')
      from public.match_events e where e.match_id = m.id))
  from public.matches m
  where m.id = p_match_id and m.status = 'finished' and m.replay_purged_at is null;
$$;
revoke execute on function public.build_replay from public, anon, authenticated;

-- Public entry point for share links (callable without an account).
create function public.get_shared_replay(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_match uuid;
begin
  update public.replay_shares set view_count = view_count + 1
  where token = p_token and revoked_at is null
  returning match_id into v_match;
  if v_match is null then return null; end if;
  return public.build_replay(v_match);          -- null once purged → UI shows "expired"
end $$;
revoke execute on function public.get_shared_replay from public;
grant execute on function public.get_shared_replay to anon, authenticated;

-- =====================================================================
-- MULTI-SERVER ROUTING & FAILOVER
-- =====================================================================
-- Room directory: which server owns a live room? (matches RLS hides live
-- games, so this definer function exposes only the routing fields.)
create function public.find_room(p_code text)
returns table (match_id uuid, status public.match_status, mode public.game_mode, server_url text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.status, m.mode, s.public_url
  from public.matches m join public.game_servers s on s.id = m.server_id
  where m.room_code = upper(p_code) and m.status in ('lobby', 'setup', 'playing')
    and s.status <> 'dead';
$$;
revoke execute on function public.find_room from public;
grant execute on function public.find_room to anon, authenticated;

-- Where should a new room go? Least-loaded live, active server.
create function public.pick_game_server() returns table (server_id uuid, server_url text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.public_url from public.game_servers s
  where s.status = 'active' and s.last_heartbeat_at > now() - interval '45 seconds'
    and s.active_rooms < s.max_rooms
  order by s.active_rooms::real / s.max_rooms, s.connected_sockets
  limit 1;
$$;
revoke execute on function public.pick_game_server from public;
grant execute on function public.pick_game_server to anon, authenticated;

-- Failover: a healthy server periodically claims live matches whose owner
-- stopped heartbeating, then rebuilds them from the latest keyframe + events.
-- SKIP LOCKED lets several healthy servers run this concurrently without
-- claiming the same match twice. Service role only.
create function public.claim_orphaned_matches(p_server_id uuid, p_limit integer default 20) returns setof uuid
language plpgsql security definer set search_path = '' as $$
begin
  update public.game_servers set status = 'dead'
  where status <> 'dead' and last_heartbeat_at < now() - interval '60 seconds';

  -- Lobbies have nothing worth recovering: close them.
  update public.matches m set status = 'abandoned', ended_at = now(), end_reason = 'server_lost'
  from public.game_servers s
  where s.id = m.server_id and s.status = 'dead' and m.status = 'lobby';

  return query
  with orphan as (
    select m.id from public.matches m
    join public.game_servers s on s.id = m.server_id
    where s.status = 'dead' and m.status in ('setup', 'playing')
    order by m.started_at
    limit p_limit
    for update of m skip locked
  )
  update public.matches m set server_id = p_server_id, recovered_count = m.recovered_count + 1
  from orphan where m.id = orphan.id
  returning m.id;
end $$;
revoke execute on function public.claim_orphaned_matches from public, anon, authenticated;
