-- CatanDabuVerse — failover claim guard
-- Found in multi-server testing: a server declared dead could still run its
-- failover tick before noticing, and "claim" its own matches. Only an active,
-- heartbeating server may claim, and never matches it already owns.

create or replace function public.claim_orphaned_matches(p_server_id uuid, p_limit integer default 20) returns setof uuid
language plpgsql security definer set search_path = '' as $$
begin
  -- Only a live, active server may take matches over. A server that was just
  -- declared dead (and hasn't noticed yet) must not claim, least of all its own matches.
  if not exists (select 1 from public.game_servers
                 where id = p_server_id and status = 'active'
                   and last_heartbeat_at > now() - interval '60 seconds') then
    return;
  end if;

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
    where s.status = 'dead' and m.status in ('setup', 'playing') and m.server_id <> p_server_id
    order by m.started_at
    limit p_limit
    for update of m skip locked
  )
  update public.matches m set server_id = p_server_id, recovered_count = m.recovered_count + 1
  from orphan where m.id = orphan.id
  returning m.id;
end $$;
