-- Jelly Slice leaderboard. Run once in the Supabase SQL editor (or psql).
--
-- The browser uses the public anon key. It can READ the leaderboard and can
-- WRITE only through submit_score(), which validates the round; nobody can
-- insert, edit or delete rows of the table directly.

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  nickname    text        not null check (char_length(nickname) between 2 and 16),
  score       integer     not null check (score between 0 and 40000),
  bears       integer     not null default 0 check (bears between 0 and 300),
  best_streak integer     not null default 0 check (best_streak between 0 and 300),
  created_at  timestamptz not null default now()
);

create index if not exists scores_score_idx on public.scores (score desc);
create index if not exists scores_nickname_idx on public.scores (lower(nickname), created_at desc);

alter table public.scores enable row level security;

-- every round is public anyway: reading is open, writing is not (no policy)
drop policy if exists "scores are public" on public.scores;
create policy "scores are public" on public.scores for select to anon, authenticated using (true);

-- the best round per nickname (case-insensitive), earliest first on ties
create or replace view public.leaderboard with (security_invoker = true) as
  select distinct on (lower(nickname)) nickname, score, created_at
  from public.scores
  order by lower(nickname), score desc, created_at asc;

grant select on public.leaderboard to anon, authenticated;

-- the only way in: checks the round, then returns this player's rank
create or replace function public.submit_score(
  p_nickname text,
  p_score integer,
  p_bears integer default 0,
  p_best_streak integer default 0
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  nick text := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
  best integer;
  r integer;
  n integer;
begin
  if char_length(nick) < 2 or char_length(nick) > 16 then
    raise exception 'nickname must be 2 to 16 characters';
  end if;
  if p_score is null or p_score < 0 or p_score > 40000 then
    raise exception 'score out of range';
  end if;
  if coalesce(p_bears, 0) not between 0 and 300 or coalesce(p_best_streak, 0) not between 0 and 300 then
    raise exception 'round out of range';
  end if;
  -- one round lasts 60 s: the same nickname can't post faster than that
  if exists (
    select 1 from scores
    where lower(nickname) = lower(nick) and created_at > now() - interval '45 seconds'
  ) then
    raise exception 'too soon: one round at a time';
  end if;

  insert into scores (nickname, score, bears, best_streak)
  values (nick, p_score, coalesce(p_bears, 0), coalesce(p_best_streak, 0));

  select max(score) into best from scores where lower(nickname) = lower(nick);
  select count(*) + 1 into r from leaderboard where score > best;
  select count(*) into n from leaderboard;
  return json_build_object('rank', r, 'total', n, 'best', best);
end
$$;

revoke all on function public.submit_score(text, integer, integer, integer) from public;
grant execute on function public.submit_score(text, integer, integer, integer) to anon, authenticated;
