create table public.query_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  top_k int not null default 5,
  summary text,
  result_count int not null default 0,
  elapsed_ms int not null default 0,
  created_at timestamptz not null default now()
);

create index query_history_user_created_idx
  on public.query_history(user_id, created_at desc);

alter table public.query_history enable row level security;

create policy "Users can view own history" on public.query_history
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own history" on public.query_history
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can delete own history" on public.query_history
  for delete to authenticated using (auth.uid() = user_id);