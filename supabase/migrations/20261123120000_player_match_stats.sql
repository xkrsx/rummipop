-- Five match statistics for the fixed RummiPop players.
-- fastest_win is the fewest of that player's own completed turns in a won match.
-- fastest_win_seconds stays in place and is no longer read by the app.

alter table public.players
  add column if not exists wins integer not null default 0,
  add column if not exists longest_win_streak integer not null default 0,
  add column if not exists current_win_streak integer not null default 0,
  add column if not exists fastest_win integer;

update public.players
set wins = games_won
where games_won > wins;

comment on column public.players.games_played is
  'Matches this player finished with a winner.';

comment on column public.players.wins is
  'Matches this player won.';

comment on column public.players.longest_win_streak is
  'Longest run of consecutive wins.';

comment on column public.players.current_win_streak is
  'Current run of consecutive wins. A loss sets it back to 0.';

comment on column public.players.fastest_win is
  'Fewest completed turns this player needed to win. Null until the first win.';
