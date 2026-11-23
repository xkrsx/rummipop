-- Shared chat for the two fixed RummiPop players.
-- Rows stay when a match starts and when a player signs out.
-- created_at is the database clock. Clients cannot set it.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.players (id),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_length check (char_length(btrim(body)) between 1 and 500)
);

comment on table public.chat_messages is
  'Persistent two-player chat. Independent of the current match and of sign-in.';

comment on column public.chat_messages.sender_id is
  'Authenticated player who sent the message.';

comment on column public.chat_messages.sender_name is
  'Player name at send time, shown in the thread.';

comment on column public.chat_messages.body is
  'Message text after trimming. Empty and over-long values are rejected.';

comment on column public.chat_messages.created_at is
  'Server time when the message was stored.';

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at, id);

alter table public.chat_messages enable row level security;

grant select, insert on table public.chat_messages to anon, authenticated;

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select
  on public.chat_messages
  for select
  to anon, authenticated
  using (true);

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert
  on public.chat_messages
  for insert
  to anon, authenticated
  with check (true);
