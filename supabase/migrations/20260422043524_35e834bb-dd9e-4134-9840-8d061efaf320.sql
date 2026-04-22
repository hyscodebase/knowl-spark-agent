-- Enable pgvector
create extension if not exists vector;

-- Documents table
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size bigint not null default 0,
  location text not null default '/documents/',
  status text not null default 'pending', -- pending | processing | indexed | error
  chunk_count int not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_user_id_idx on public.documents(user_id);

alter table public.documents enable row level security;

create policy "Users can view own documents" on public.documents
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own documents" on public.documents
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update own documents" on public.documents
  for update to authenticated using (auth.uid() = user_id);
create policy "Users can delete own documents" on public.documents
  for delete to authenticated using (auth.uid() = user_id);

-- Chunks table with embeddings (768 dims for Gemini embedding-001)
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index document_chunks_document_id_idx on public.document_chunks(document_id);
create index document_chunks_user_id_idx on public.document_chunks(user_id);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.document_chunks enable row level security;

create policy "Users can view own chunks" on public.document_chunks
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own chunks" on public.document_chunks
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can delete own chunks" on public.document_chunks
  for delete to authenticated using (auth.uid() = user_id);

-- Semantic search function (scoped to caller via auth.uid())
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float,
  file_name text,
  location text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return query
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.file_name,
    d.location
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = auth.uid()
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Storage bucket for raw files
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "Users can upload own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);