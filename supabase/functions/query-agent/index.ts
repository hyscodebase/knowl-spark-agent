// 시맨틱 검색 + 답변 생성 파이프라인
// 에이전트 4: 시맨틱 검색 에이전트 — 쿼리를 임베딩하고 유사 청크를 가져옴
// 에이전트 5: 답변 & 요약 에이전트 (마스터) — 근거 기반 답변 생성

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ===== 에이전트 4: 시맨틱 검색 =====
async function semanticSearchAgent(
  supabase: any,
  query: string,
  topK: number,
) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY가 설정되지 않았습니다");

  // 쿼리 임베딩
  const embedRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/text-embedding-004",
      input: query,
    }),
  });

  if (!embedRes.ok) {
    if (embedRes.status === 429) throw new Error("RATE_LIMIT");
    if (embedRes.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`쿼리 임베딩 실패: ${await embedRes.text()}`);
  }
  const embedJson = await embedRes.json();
  const queryVec = embedJson.data?.[0]?.embedding;
  if (!queryVec) throw new Error("쿼리 임베딩이 비어있습니다");

  // pgvector 검색 (RPC, RLS 적용 — auth.uid() 기반)
  const { data: matches, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryVec,
    match_count: topK,
  });
  if (error) throw new Error(`벡터 검색 실패: ${error.message}`);
  return matches || [];
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
        `[근거 ${i + 1}] (파일: ${c.file_name}, 위치: ${c.location}, 유사도: ${c.similarity.toFixed(3)})\n${c.content}`,
    )
    .join("\n\n---\n\n");

  const systemPrompt = `당신은 사용자의 로컬 문서를 분석하는 전문 지식 에이전트입니다.
제공된 근거 발췌문만을 사용하여 한국어로 답변하세요. 추측하지 마세요.
반드시 다음 JSON 스키마를 사용하여 structured output 도구를 호출하세요.`;

  const userPrompt = `질문: ${query}\n\n근거 발췌문들:\n\n${context}\n\n위 근거만을 사용하여 답변을 작성하세요.`;

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
              },
              required: ["summary", "evidence"],
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

  return {
    summary: args.summary,
    evidence: args.evidence || [],
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

    const { query, topK = 5 } = await req.json();
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new Error("질문이 비어있습니다");
    }
    if (query.length > 1000) throw new Error("질문은 1000자 이하여야 합니다");
    const k = Math.max(1, Math.min(20, Number(topK) || 5));

    // 4) 시맨틱 검색
    const matches = await semanticSearchAgent(supabase, query, k);

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