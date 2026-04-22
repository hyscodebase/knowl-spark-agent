import { Brain, FileScan, FileText, Sparkles, Search, MessagesSquare } from "lucide-react";

const agents = [
  { icon: FileScan, name: "스캐너" },
  { icon: FileText, name: "파서" },
  { icon: Sparkles, name: "임베딩" },
  { icon: Search, name: "검색" },
  { icon: MessagesSquare, name: "답변" },
];

export function PipelineHeader() {
  return (
    <div className="rounded-2xl border bg-card p-5" style={{ boxShadow: "var(--shadow-soft)" }}>
      <div className="mb-3 flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">멀티 에이전트 RAG 파이프라인</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {agents.map((a, i) => (
          <div key={a.name} className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
              <a.icon className="h-3.5 w-3.5" />
              에이전트 {i + 1}: {a.name}
            </div>
            {i < agents.length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}