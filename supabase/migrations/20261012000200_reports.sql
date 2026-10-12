-- CatanDabuVerse — player reports from the game UI
-- Players file reports straight into `reports` (RLS: reporter_id = auth.uid()).
-- Guard rails against spam and nonsense, enforced by the database.

alter table public.reports
  add constraint reports_not_self check (reporter_id <> reported_id),
  add constraint reports_details_length check (details is null or char_length(details) <= 1000);

-- One open report per reporter → reported player → match.
create unique index reports_one_open_per_pair on public.reports
  (reporter_id, reported_id, coalesce(match_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('open', 'in_review');
