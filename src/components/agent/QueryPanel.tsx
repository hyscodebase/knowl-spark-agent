import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  FileText,
  BookOpen,
  Quote,
  FolderOpen,
  Clock,
  Sparkles,
  Gauge,
  TrendingUp,
  SlidersHorizontal,
  Calendar as CalendarIcon,
  X,
} from "lucide-react";

type Evidence = { quote: string; file_name: string; location: string };
type Match = { content: string; file_name: string; location: string; similarity: number };
type Contribution = { weight: number; reason: string };
type Result = {
  summary: string;
  confidence: number;
  evidence: Evidence[];
  contributions: Contribution[];
  relatedFiles: { file_name: string; location: string }[];
  matches: Match[];
  elapsedMs: number;
};

type Filters = {
  fileTypes: string[];
  filenameQuery: string;
  dateFrom?: Date;
  dateTo?: Date;
};

const FILE_TYPE_OPTIONS = ["pdf", "docx", "txt", "pptx"] as const;

export type QueryPanelHandle = {
  runWith: (query: string, topK: number) => void;
};

export const QueryPanel = forwardRef<
  QueryPanelHandle,
  { hasIndexedDocs: boolean; onHistoryChange?: () => void }
>(function QueryPanel({ hasIndexedDocs, onHistoryChange }, ref) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pendingRun, setPendingRun] = useState<{ q: string; k: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    fileTypes: [],
    filenameQuery: "",
  });

  const activeFilterCount =
    filters.fileTypes.length +
    (filters.filenameQuery.trim() ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);

  const resetFilters = () =>
    setFilters({ fileTypes: [], filenameQuery: "", dateFrom: undefined, dateTo: undefined });

  const toggleFileType = (t: string) =>
    setFilters((f) => ({
      ...f,
      fileTypes: f.fileTypes.includes(t)
        ? f.fileTypes.filter((x) => x !== t)
        : [...f.fileTypes, t],
    }));

  const runQuery = async (overrideQuery?: string, overrideTopK?: number) => {
    const q = (overrideQuery ?? query).trim();
    const k = overrideTopK ?? topK;
    if (!q) return;
    if (!hasIndexedDocs) {
      toast.error("인덱싱된 문서가 없습니다", {
        description: "먼저 문서를 업로드하고 인덱싱하세요.",
      });
      return;
    }
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("query-agent", {
      body: {
        query: q,
        topK: k,
        filters: {
          fileTypes: filters.fileTypes,
          filenameQuery: filters.filenameQuery.trim(),
          dateFrom: filters.dateFrom ? filters.dateFrom.toISOString() : null,
          dateTo: filters.dateTo
            ? new Date(
                filters.dateTo.getFullYear(),
                filters.dateTo.getMonth(),
                filters.dateTo.getDate(),
                23,
                59,
                59,
                999,
              ).toISOString()
            : null,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("검색 실패", { description: error.message });
      return;
    }
    const res = data as Result;
    setResult(res);
    if (res.matches?.length === 0) {
      toast.info("필터 조건에 맞는 청크가 없습니다", {
        description: "필터를 완화하거나 다른 질문을 시도하세요.",
      });
    }

    // 기록 저장
    if (user) {
      await supabase.from("query_history").insert({
        user_id: user.id,
        query: q,
        top_k: k,
        summary: res.summary?.slice(0, 500) ?? null,
        result_count: res.matches?.length ?? 0,
        elapsed_ms: res.elapsedMs ?? 0,
      });
      onHistoryChange?.();
    }
  };

  // 외부(기록 패널)에서 재실행 트리거
  useImperativeHandle(ref, () => ({
    runWith: (q: string, k: number) => {
      setQuery(q);
      setTopK(k);
      setPendingRun({ q, k });
    },
  }));

  useEffect(() => {
    if (pendingRun) {
      runQuery(pendingRun.q, pendingRun.k);
      setPendingRun(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun]);

  return (
    <div className="space-y-6">
      <Card className="p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
        <h3 className="mb-1 text-base font-semibold">의미 기반 질의</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          질문을 입력하면 5개 에이전트가 협력하여 근거 있는 답변을 생성합니다
        </p>

        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: Q3 마케팅 전략의 핵심 포인트는 무엇인가요?"
          className="min-h-[88px] resize-none"
          maxLength={1000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runQuery();
          }}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">Top-K</span>
            <Slider
              value={[topK]}
              onValueChange={(v) => setTopK(v[0])}
              min={1}
              max={15}
              step={1}
              className="flex-1"
            />
            <Badge variant="secondary" className="font-mono">
              {topK}
            </Badge>
          </div>
          <Button onClick={() => runQuery()} disabled={loading || !query.trim()}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                에이전트 실행 중...
              </>
            ) : (
              <>
                <Search className="mr-1.5 h-4 w-4" />
                검색 및 답변
              </>
            )}
          </Button>
        </div>
      </Card>

      {loading && (
        <Card className="p-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              시맨틱 검색 에이전트가 관련 청크를 가져오는 중...
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              답변 에이전트가 근거 기반 응답을 작성하는 중...
            </div>
          </div>
        </Card>
      )}

      {result && <ResultDisplay result={result} query={query} />}
    </div>
  );
});

function highlightTerms(text: string, query: string) {
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark
        key={i}
        className="rounded px-0.5"
        style={{ backgroundColor: "var(--color-highlight)" }}
      >
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function highlightChunk(
  text: string,
  query: string,
  evidence: Evidence[],
  matchIdx: number,
  matches: Match[],
) {
  // Find evidence quotes that belong to THIS chunk
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const m = matches[matchIdx];
  const chunkNorm = norm(m.content);
  const quotes = evidence
    .filter((e) => e.file_name === m.file_name && chunkNorm.includes(norm(e.quote).slice(0, 40)))
    .map((e) => e.quote.trim())
    .filter((q) => q.length >= 6);

  if (quotes.length === 0) return highlightTerms(text, query);

  // Split text by evidence quotes (case-insensitive), preserving them
  const escaped = quotes.map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);

  return parts.map((p, i) => {
    if (!p) return null;
    const isQuote = quotes.some((q) => p.toLowerCase() === q.toLowerCase());
    if (isQuote) {
      return (
        <mark
          key={i}
          className="rounded px-1 py-0.5 font-medium text-foreground"
          style={{
            backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
            boxShadow: "inset 0 -2px 0 0 var(--primary)",
          }}
        >
          {highlightTerms(p, query)}
        </mark>
      );
    }
    return <span key={i}>{highlightTerms(p, query)}</span>;
  });
}

function ResultDisplay({ result, query }: { result: Result; query: string }) {
  const matchRefs = useRef<Record<number, HTMLDetailsElement | null>>({});
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const confPct = Math.round((result.confidence ?? 0) * 100);
  const confTone =
    confPct >= 80
      ? { label: "높음", color: "var(--primary)", bg: "color-mix(in oklab, var(--primary) 18%, transparent)" }
      : confPct >= 55
        ? { label: "중간", color: "oklch(0.68 0.15 75)", bg: "color-mix(in oklab, oklch(0.68 0.15 75) 18%, transparent)" }
        : { label: "낮음", color: "oklch(0.62 0.2 25)", bg: "color-mix(in oklab, oklch(0.62 0.2 25) 18%, transparent)" };

  // 기여도 상위 청크
  const topContributors = (result.contributions ?? [])
    .map((c, i) => ({ ...c, idx: i }))
    .filter((c) => c.weight > 0.05)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const findMatchIndex = (e: Evidence) => {
    // Prefer exact file+location match containing the quote substring
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const q = norm(e.quote).slice(0, 40);
    let idx = result.matches.findIndex(
      (m) =>
        m.file_name === e.file_name &&
        m.location === e.location &&
        norm(m.content).includes(q),
    );
    if (idx === -1) {
      idx = result.matches.findIndex(
        (m) => m.file_name === e.file_name && norm(m.content).includes(q),
      );
    }
    if (idx === -1) {
      idx = result.matches.findIndex(
        (m) => m.file_name === e.file_name && m.location === e.location,
      );
    }
    return idx;
  };

  const jumpToMatch = (e: Evidence) => {
    const idx = findMatchIndex(e);
    if (idx === -1) {
      toast.info("해당 청크를 찾을 수 없습니다");
      return;
    }
    const el = matchRefs.current[idx];
    if (el) {
      el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveIdx(idx);
      window.setTimeout(() => setActiveIdx((cur) => (cur === idx ? null : cur)), 2200);
    }
  };

  return (
    <Card className="overflow-hidden" style={{ boxShadow: "var(--shadow-elevated)" }}>
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ background: "var(--gradient-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            답변 결과
          </span>
          <div
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: confTone.bg, color: confTone.color }}
            title="모델이 자체 평가한 답변 신뢰도"
          >
            <Gauge className="h-3 w-3" />
            신뢰도 {confPct}% · {confTone.label}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {(result.elapsedMs / 1000).toFixed(2)}초
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* 관련 파일 */}
        <Section icon={FileText} label="📄 관련 파일">
          {result.relatedFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">관련 파일 없음</p>
          ) : (
            <ul className="space-y-1">
              {result.relatedFiles.map((f) => (
                <li
                  key={f.file_name}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="font-medium">{f.file_name}</span>
                  <span className="text-xs text-muted-foreground">{f.location}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 요약 */}
        <Section icon={BookOpen} label="🧠 요약">
          <p className="text-sm leading-relaxed">{result.summary}</p>
          <div className="mt-3 rounded-lg border bg-secondary/40 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">답변 신뢰도</span>
              <span className="font-mono font-semibold" style={{ color: confTone.color }}>
                {confPct}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${confPct}%`, backgroundColor: confTone.color }}
              />
            </div>
          </div>
        </Section>

        {/* 핵심 기여 청크 */}
        {topContributors.length > 0 && (
          <Section icon={TrendingUp} label="⭐ 핵심 기여 청크">
            <ul className="space-y-2">
              {topContributors.map((c) => {
                const m = result.matches[c.idx];
                if (!m) return null;
                const pct = Math.round(c.weight * 100);
                return (
                  <li
                    key={c.idx}
                    className="rounded-lg border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          #{c.idx + 1}
                        </Badge>
                        <span className="truncate text-sm font-medium">
                          {m.file_name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {m.location}
                        </span>
                      </div>
                      <Badge
                        variant="secondary"
                        className="font-mono"
                        title="요약 기여도"
                      >
                        {pct}%
                      </Badge>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: "var(--primary)",
                        }}
                      />
                    </div>
                    {c.reason && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {c.reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* 근거 */}
        <Section icon={Quote} label="📍 근거">
          {result.evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">인용 가능한 근거 없음</p>
          ) : (
            <ul className="space-y-3">
              {result.evidence.map((e, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => jumpToMatch(e)}
                    className="group block w-full rounded-lg border-l-4 border-l-primary bg-secondary/60 px-4 py-3 text-left transition-all hover:bg-secondary hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    title="원문 청크로 이동"
                  >
                    <p className="text-sm italic leading-relaxed text-foreground">
                      "{highlightTerms(e.quote, query)}"
                    </p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>— {e.file_name} · {e.location}</span>
                      <span className="ml-auto text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        원문 보기 →
                      </span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 위치 + 검색된 청크 */}
        <Section icon={FolderOpen} label="📁 위치 및 검색된 청크">
          <div className="space-y-2">
            {result.matches.map((m, i) => (
              <details
                key={i}
                ref={(el) => {
                  matchRefs.current[i] = el;
                }}
                className={`group rounded-lg border bg-background p-3 transition-all ${
                  activeIdx === i
                    ? "border-primary ring-2 ring-primary/40 shadow-md"
                    : ""
                }`}
              >
                <summary className="flex cursor-pointer items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      #{i + 1}
                    </Badge>
                    <span className="font-medium">{m.file_name}</span>
                    <span className="text-muted-foreground">{m.location}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {result.contributions?.[i] && result.contributions[i].weight > 0.05 && (
                      <Badge
                        variant="secondary"
                        className="gap-1 font-mono"
                        style={{
                          backgroundColor:
                            "color-mix(in oklab, var(--primary) 15%, transparent)",
                          color: "var(--primary)",
                        }}
                        title={`요약 기여도: ${result.contributions[i].reason}`}
                      >
                        <TrendingUp className="h-3 w-3" />
                        {Math.round(result.contributions[i].weight * 100)}%
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="font-mono"
                      title="코사인 유사도"
                    >
                      {m.similarity.toFixed(3)}
                    </Badge>
                  </span>
                </summary>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {highlightChunk(m.content, query, result.evidence, i, result.matches)}
                </p>
              </details>
            ))}
          </div>
        </Section>
      </div>
    </Card>
  );
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{label}</h4>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}