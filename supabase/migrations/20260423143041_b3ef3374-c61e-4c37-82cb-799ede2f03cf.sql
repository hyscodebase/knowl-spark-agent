-- 임베딩이 없어도 인덱싱 완료 처리되도록 컬럼 NULL 허용 (이미 nullable이지만 명시)
-- match_chunks 함수를 키워드 기반으로 재작성

DROP FUNCTION IF EXISTS public.match_chunks(extensions.vector, integer, text[], text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.match_chunks_keyword(
  search_terms text[],
  match_count integer DEFAULT 30,
  file_types text[] DEFAULT NULL,
  filename_query text DEFAULT NULL,
  date_from timestamp with time zone DEFAULT NULL,
  date_to timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  similarity double precision,
  file_name text,
  location text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  pattern text;
  patterns text[] := ARRAY[]::text[];
BEGIN
  -- 각 검색어를 ILIKE 패턴으로 변환
  IF search_terms IS NOT NULL THEN
    FOREACH pattern IN ARRAY search_terms LOOP
      IF length(trim(pattern)) > 0 THEN
        patterns := array_append(patterns, '%' || trim(pattern) || '%');
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    -- 매칭된 키워드 수 / 전체 키워드 수를 점수로 사용
    CASE
      WHEN array_length(patterns, 1) IS NULL OR array_length(patterns, 1) = 0 THEN 0.5::double precision
      ELSE (
        SELECT COUNT(*)::double precision / array_length(patterns, 1)::double precision
        FROM unnest(patterns) AS p
        WHERE dc.content ILIKE p
      )
    END AS similarity,
    d.file_name,
    d.location
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE dc.user_id = auth.uid()
    AND d.status = 'indexed'
    AND (
      array_length(patterns, 1) IS NULL
      OR array_length(patterns, 1) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(patterns) AS p WHERE dc.content ILIKE p
      )
    )
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
  ORDER BY similarity DESC, dc.created_at DESC
  LIMIT match_count;
END;
$$;