// 시맨틱 검색 + 답변 생성 파이프라인
// 에이전트 4: 시맨틱 검색 에이전트 — 쿼리를 임베딩하고 유사 청크를 가져옴
// 에이전트 5: 답변 & 요약 에이전트 (마스터) — 근거 기반 답변 생성

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ===== 에이전트 4: 키워드 추출 + 키워드 검색 + LLM 재랭킹 =====
type SearchFilters = {
  fileTypes?: string[] | null;
  filenameQuery?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

// Gemini로 질문에서 검색용 핵심 키워드 추출
async function extractKeywords(query: string, apiKey: string): Promise<string[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content:
            "사용자 질문에서 문서 검색에 쓸 핵심 키워드와 동의어를 추출하세요. 조사·접속사 제외. 명사·고유명사·전문용어 위주.",
        },
        { role: "user", content: query },
      ],
      tools: [{
        type: "function",
        function: {
          name: "submit_keywords",
          description: "검색용 키워드 목록 제출",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "array",
                items: { type: "string" },
                description: "3~10개의 검색 키워드 (한국어/영어 모두 허용, 동의어 포함)",
              },
            },
            required: ["keywords"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_keywords" } },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("PAYMENT_REQUIRED");
    // 키워드 추출 실패 시 단순 분리로 폴백
    return query.split(/\s+/).filter((w) => w.length > 1).slice(0, 10);
  }

  const json = await res.json();
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return query.split(/\s+/).filter((w) => w.length > 1).slice(0, 10);
  try {
    const args = JSON.parse(toolCall.function.arguments);
    const kws = Array.isArray(args.keywords) ? args.keywords : [];
    return kws.map((k: any) => String(k).trim()).filter((k: string) => k.length > 0);
  } catch {
    return query.split(/\s+/).filter((w) => w.length > 1).slice(0, 10);
  }
}

async function searchAgent(
  supabase: any,
  query: string,
  topK: number,
  filters: SearchFilters = {},
) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY가 설정되지 않았습니다");

  // 1) 질문에서 검색 키워드 추출
  const keywords = await extractKeywords(query, apiKey);
  console.log("Extracted keywords:", keywords);

  // 2) 키워드 매칭으로 후보 청크 검색 (topK*4 ~ 최대 30개 가져와 재랭킹)
  const candidateLimit = Math.min(30, Math.max(topK * 4, 15));
  const fileTypes = (filters.fileTypes ?? []).filter(Boolean);
  const { data: matches, error } = await supabase.rpc("match_chunks_keyword", {
    search_terms: keywords,
    match_count: candidateLimit,
    file_types: fileTypes.length > 0 ? fileTypes : null,
    filename_query: filters.filenameQuery?.trim() || null,
    date_from: filters.dateFrom || null,
    date_to: filters.dateTo || null,
  });
  if (error) throw new Error(`검색 실패: ${error.message}`);

  const candidates = matches || [];
  if (candidates.length === 0) return [];
  if (candidates.length <= topK) return candidates;

  // 3) Gemini로 재랭킹 — 질문에 가장 관련 깊은 청크 topK 선택
  const reranked = await rerankWithLLM(query, candidates, topK, apiKey);
  return reranked;
}

async function rerankWithLLM(
  query: string,
  candidates: Array<{ id: string; content: string; file_name: string; similarity: number }>,
  topK: number,
  apiKey: string,
): Promise<any[]> {
  const numbered = candidates
    .map((c, i) => `[#${i + 1}] (${c.file_name})\n${c.content.slice(0, 500)}`)
    .join("\n\n---\n\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "주어진 질문에 가장 관련 깊은 청크들을 선택하고 관련도 점수(0~1)를 매기세요. 표면적 키워드 매칭이 아닌 의미적 관련성으로 판단하세요.",
        },
        {
          role: "user",
          content: `질문: ${query}\n\n후보 청크 ${candidates.length}개:\n\n${numbered}\n\n위 중에서 가장 관련 깊은 청크를 최대 ${topK}개 선택해 점수를 매기세요.`,
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "submit_ranking",
          description: "관련도 순위 제출",
          parameters: {
            type: "object",
            properties: {
              rankings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    chunk_index: { type: "integer", description: "청크 번호 (1부터)" },
                    score: { type: "number", description: "관련도 0~1" },
                  },
                  required: ["chunk_index", "score"],
                  additionalProperties: false,
                },
              },
            },
            required: ["rankings"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_ranking" } },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("PAYMENT_REQUIRED");
    // 재랭킹 실패 시 키워드 점수 기반 상위 topK 반환
    return candidates.slice(0, topK);
  }

  const json = await res.json();
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return candidates.slice(0, topK);

  try {
    const args = JSON.parse(toolCall.function.arguments);
    const rankings = (args.rankings || [])
      .filter((r: any) => Number.isFinite(r.chunk_index) && r.chunk_index >= 1 && r.chunk_index <= candidates.length)
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      .slice(0, topK);

    return rankings.map((r: any) => ({
      ...candidates[r.chunk_index - 1],
      similarity: Math.max(0, Math.min(1, Number(r.score) || candidates[r.chunk_index - 1].similarity)),
    }));
  } catch {
    return candidates.slice(0, topK);
  }
}

// ===== 에이전트 5: 답변 & 요약 (마스터 에이전트) =====
async function answerAgent(
  query: string,
  chunks: Array<{ content: string; file_name: string; location: string; similarity: number }>,
) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY가 설정되지 않았습니다");

  if (chunks.length === 0) {
    return {
      summary: "관련 문서를 찾을 수 없습니다. 다른 질문을 시도하거나 더 많은 문서를 업로드하세요.",
      evidence: [],
      relatedFiles: [],
    };
  }

  const context = chunks
    .map(
      (c, i) =>
        `[청크 #${i + 1}] (파일: ${c.file_name}, 위치: ${c.location}, 유사도: ${c.similarity.toFixed(3)})\n${c.content}`,
    )
    .join("\n\n---\n\n");

  const systemPrompt = `당신은 사용자의 로컬 문서를 분석하는 전문 지식 에이전트입니다.
제공된 청크만을 사용하여 한국어로 답변하세요. 추측 금지.
반드시 submit_answer 도구를 호출하여 다음을 포함한 구조화된 답변을 제출하세요:
- summary: 청크 내용에 기반한 간결한 요약
- evidence: 답변을 직접 뒷받침하는 인용문 (원문 그대로)
- confidence: 0.0~1.0 사이 답변 신뢰도. 다음 기준을 사용:
  · 0.85+ : 여러 청크가 명확하고 일관되게 답을 직접 뒷받침
  · 0.6~0.85 : 답이 도출되지만 부분적이거나 일부 추론 필요
  · 0.3~0.6 : 청크가 간접적이거나 부분적으로만 관련
  · 0.3 미만 : 청크가 질문에 거의 답하지 않음
- contributions: 각 청크별 기여도. 모든 입력 청크(#1 ~ #N)에 대해 객체를 반환하며,
  weight는 0.0~1.0 (요약 작성에 얼마나 사용되었는지), reason은 한국어 한 문장 사유.`;

  const userPrompt = `질문: ${query}\n\n총 ${chunks.length}개의 청크가 제공됩니다 (인덱스 1~${chunks.length}):\n\n${context}\n\n위 청크만을 사용하여 답변하고, 각 청크의 기여도를 평가하세요.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "submit_answer",
            description: "근거에 기반한 답변 제출",
            parameters: {
              type: "object",
              properties: {
                summary: {
                  type: "string",
                  description: "근거에 기반한 한국어 종합 요약 (2-4문장)",
                },
                confidence: {
                  type: "number",
                  description: "답변 신뢰도 0.0~1.0",
                },
                evidence: {
                  type: "array",
                  description: "답변을 뒷받침하는 직접 인용문들 (원문 그대로)",
                  items: {
                    type: "object",
                    properties: {
                      quote: { type: "string", description: "문서에서 가져온 정확한 인용문" },
                      file_name: { type: "string" },
                      location: { type: "string" },
                    },
                    required: ["quote", "file_name", "location"],
                    additionalProperties: false,
                  },
                },
                contributions: {
                  type: "array",
                  description: "각 입력 청크별 요약 기여도 (모든 청크 포함)",
                  items: {
                    type: "object",
                    properties: {
                      chunk_index: {
                        type: "integer",
                        description: "청크 번호 (1부터 시작)",
                      },
                      weight: {
                        type: "number",
                        description: "기여도 가중치 0.0~1.0",
                      },
                      reason: {
                        type: "string",
                        description: "기여 또는 무관 사유 (한 문장)",
                      },
                    },
                    required: ["chunk_index", "weight", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "confidence", "evidence", "contributions"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "submit_answer" } },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`답변 생성 실패: ${await res.text()}`);
  }

  const json = await res.json();
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("AI가 구조화된 답변을 반환하지 않았습니다");

  const args = JSON.parse(toolCall.function.arguments);

  // 관련 파일 목록 (중복 제거)
  const relatedFiles = Array.from(
    new Map(
      chunks.map((c) => [c.file_name, { file_name: c.file_name, location: c.location }]),
    ).values(),
  );

  // 기여도 정규화: 모든 청크에 대한 항목 보장
  const contribMap = new Map<number, { weight: number; reason: string }>();
  for (const c of args.contributions || []) {
    const idx = Number(c.chunk_index);
    if (Number.isFinite(idx) && idx >= 1 && idx <= chunks.length) {
      contribMap.set(idx, {
        weight: Math.max(0, Math.min(1, Number(c.weight) || 0)),
        reason: String(c.reason || ""),
      });
    }
  }
  const contributions = chunks.map((_, i) => {
    const found = contribMap.get(i + 1);
    return found ?? { weight: 0, reason: "모델이 평가하지 않음" };
  });

  const confidence = Math.max(0, Math.min(1, Number(args.confidence) || 0));

  return {
    summary: args.summary,
    confidence,
    evidence: args.evidence || [],
    contributions,
    relatedFiles,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "인증이 필요합니다" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { query, topK = 5, filters = {} } = await req.json();
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new Error("질문이 비어있습니다");
    }
    if (query.length > 1000) throw new Error("질문은 1000자 이하여야 합니다");
    const k = Math.max(1, Math.min(20, Number(topK) || 5));

    // 4) 시맨틱 검색 (필터 적용)
    const matches = await semanticSearchAgent(supabase, query, k, {
      fileTypes: Array.isArray(filters.fileTypes) ? filters.fileTypes : null,
      filenameQuery: typeof filters.filenameQuery === "string" ? filters.filenameQuery : null,
      dateFrom: typeof filters.dateFrom === "string" ? filters.dateFrom : null,
      dateTo: typeof filters.dateTo === "string" ? filters.dateTo : null,
    });

    // 5) 답변 생성
    const answer = await answerAgent(query, matches);

    const elapsed = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        ...answer,
        matches: matches.map((m: any) => ({
          content: m.content,
          file_name: m.file_name,
          location: m.location,
          similarity: m.similarity,
        })),
        elapsedMs: elapsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("query-agent error:", msg);

    let userMsg = msg;
    let status = 500;
    if (msg === "RATE_LIMIT") {
      userMsg = "AI 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
      status = 429;
    } else if (msg === "PAYMENT_REQUIRED") {
      userMsg = "AI 크레딧이 부족합니다. 워크스페이스에 크레딧을 추가해주세요.";
      status = 402;
    }

    return new Response(JSON.stringify({ error: userMsg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});