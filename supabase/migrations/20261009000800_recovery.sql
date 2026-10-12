-- CatanDabuVerse — crash recovery checkpoints for live matches
-- Design: docs/database/DATA_MODEL.md §6.6
--
-- Replay keyframes deliberately omit hidden state (deck order, seat secrets,
-- internal turn bookkeeping), so they cannot resume a live game. A checkpoint
-- is the complete server-side room, upserted at each replay flush (at least
-- every turn end). It holds secrets, so only the service role can read it.

create table public.match_checkpoints (
  match_id    uuid primary key references public.matches(id) on delete cascade,
  seq         integer not null,          -- last replay event included
  turn_no     integer not null,
  room        jsonb not null,            -- encoded server room (see db/recovery.py)
  updated_at  timestamptz not null default now()
);

alter table public.match_checkpoints enable row level security;
-- No policies: clients never see checkpoints.
revoke all on public.match_checkpoints from anon, authenticated;

-- A finished or abandoned match no longer needs its checkpoint.
create function public.drop_checkpoint_when_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.match_checkpoints where match_id = new.id;
  return new;
end $$;

create trigger matches_drop_checkpoint
  after update of status on public.matches
  for each row when (new.status in ('finished', 'abandoned', 'terminated'))
  execute function public.drop_checkpoint_when_closed();
