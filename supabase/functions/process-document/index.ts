// 문서 처리 파이프라인 엣지 함수
// 에이전트 1: 파일 스캐너 — 스토리지에서 파일을 가져옴
// 에이전트 2: 문서 파서 — PDF/DOCX/TXT/PPTX에서 텍스트를 추출
// 에이전트 3: 임베딩 에이전트 — 텍스트를 청크로 나누고 벡터를 생성

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=denonext";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ===== 에이전트 1: 파일 스캐너 =====
async function fileScannerAgent(supabase: any, documentId: string) {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();
  if (error || !doc) throw new Error(`문서를 찾을 수 없습니다: ${error?.message}`);

  const { data: fileBlob, error: dlError } = await supabase.storage
    .from("documents")
    .download(doc.file_path);
  if (dlError || !fileBlob) throw new Error(`파일 다운로드 실패: ${dlError?.message}`);

  const buffer = await fileBlob.arrayBuffer();
  return { doc, buffer };
}

// ===== 에이전트 2: 문서 파서 =====
async function documentParserAgent(
  buffer: ArrayBuffer,
  fileType: string,
  fileName: string,
): Promise<string> {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (ext === "txt" || fileType.startsWith("text/")) {
    return new TextDecoder("utf-8").decode(buffer);
  }

  if (ext === "pdf") {
    // unpdf는 캔버스 의존성 없이 서버리스 환경에서 동작
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }

  if (ext === "docx") {
    const result = await mammoth.extractRawText({
      arrayBuffer: buffer,
    });
    return result.value;
  }

  if (ext === "pptx") {
    // PPTX는 ZIP 안의 ppt/slides/slideN.xml에서 텍스트를 뽑아냅니다.
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((n) => n.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort();
    let text = "";
    for (const fname of slideFiles) {
      const xml = await zip.files[fname].async("string");
      // <a:t>...</a:t> 태그 안의 텍스트만 추출
      const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
      const slideText = matches
        .map((m) => m.replace(/<a:t[^>]*>|<\/a:t>/g, ""))
        .join(" ");
      text += slideText + "\n";
    }
    return text;
  }

  throw new Error(`지원하지 않는 파일 형식: ${ext}`);
}

// 텍스트 정제 + 청크 분할
function cleanAndChunk(raw: string, chunkSize = 1000, overlap = 150): string[] {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length);
    // 가능하면 마침표/공백에서 자르기
    if (end < cleaned.length) {
      const breakAt = cleaned.lastIndexOf(". ", end);
      if (breakAt > start + chunkSize / 2) end = breakAt + 1;
    }
    chunks.push(cleaned.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (end >= cleaned.length) break;
  }
  return chunks.filter((c) => c.length > 20);
}

// 임베딩 단계 제거 — 키워드 기반 검색으로 전환됨

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "인증이 필요합니다" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 호출자 신원 확인
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "유효하지 않은 세션" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { documentId } = await req.json();
    if (!documentId) throw new Error("documentId가 필요합니다");

    // 권한 확인
    const { data: ownerCheck } = await supabase
      .from("documents")
      .select("user_id")
      .eq("id", documentId)
      .single();
    if (!ownerCheck || ownerCheck.user_id !== userId) {
      return new Response(JSON.stringify({ error: "권한 없음" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("documents")
      .update({ status: "processing", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", documentId);

    // 1) 파일 스캐너
    const { doc, buffer } = await fileScannerAgent(supabase, documentId);

    // 2) 문서 파서
    const rawText = await documentParserAgent(buffer, doc.file_type, doc.file_name);
    const chunks = cleanAndChunk(rawText);
    if (chunks.length === 0) throw new Error("문서에서 텍스트를 추출할 수 없습니다");

    // 기존 청크 제거 후 새로 삽입 (임베딩 없이 텍스트만 저장 — 키워드 검색)
    await supabase.from("document_chunks").delete().eq("document_id", documentId);

    const rows = chunks.map((content, i) => ({
      document_id: documentId,
      user_id: userId,
      chunk_index: i,
      content,
    }));

    // 배치 삽입 (한 번에 50개씩)
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error: insErr } = await supabase.from("document_chunks").insert(batch);
      if (insErr) throw new Error(`청크 저장 실패: ${insErr.message}`);
    }

    await supabase
      .from("documents")
      .update({
        status: "indexed",
        chunk_count: chunks.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({ success: true, chunkCount: chunks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("process-document error:", msg);

    // 문서 상태 업데이트 시도
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.documentId) {
        const sb = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await sb
          .from("documents")
          .update({ status: "error", error_message: msg })
          .eq("id", body.documentId);
      }
    } catch (_) { /* ignore */ }

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