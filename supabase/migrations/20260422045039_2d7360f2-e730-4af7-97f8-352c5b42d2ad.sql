DROP FUNCTION IF EXISTS public.match_chunks(extensions.vector, integer);
DROP FUNCTION IF EXISTS public.match_chunks(extensions.vector, integer, text[], text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector,
  match_count integer DEFAULT 5,
  file_types text[] DEFAULT NULL,
  filename_query text DEFAULT NULL,
  date_from timestamptz DEFAULT NULL,
  date_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  similarity double precision,
  file_name text,
  location text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity,
    d.file_name,
    d.location
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE dc.user_id = auth.uid()
    AND dc.embedding IS NOT NULL
    AND d.status = 'indexed'
    AND (
      file_types IS NULL
      OR array_length(file_types, 1) IS NULL
      OR lower(coalesce(d.file_type, '')) = ANY (SELECT lower(unnest(file_types)))
      OR lower(split_part(d.file_name, '.', -1)) = ANY (SELECT lower(unnest(file_types)))
    )
    AND (
      filename_query IS NULL
      OR filename_query = ''
      OR d.file_name ILIKE '%' || filename_query || '%'
    )
    AND (date_from IS NULL OR d.created_at >= date_from)
    AND (date_to IS NULL OR d.created_at <= date_to)
  ORDER BY dc.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;