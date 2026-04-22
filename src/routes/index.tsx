import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Brain, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PipelineHeader } from "@/components/agent/PipelineHeader";
import { UploadPanel } from "@/components/agent/UploadPanel";
import { QueryPanel } from "@/components/agent/QueryPanel";

export const Route = createFileRoute("/")({
  component: Index,
});

type DocRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  status: string;
  chunk_count: number;
  error_message: string | null;
  location: string;
};

function Index() {
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuth();
  const [documents, setDocuments] = useState<DocRow[]>([]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, file_name, file_path, file_type, status, chunk_count, error_message, location",
      )
      .order("created_at", { ascending: false });
    if (!error && data) setDocuments(data as DocRow[]);
  }, [user]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // 처리 중인 문서가 있으면 폴링
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === "processing");
    if (!hasProcessing) return;
    const t = setInterval(fetchDocs, 2000);
    return () => clearInterval(t);
  }, [documents, fetchDocs]);

  if (loading || !user) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--gradient-subtle)" }}
      >
        <div className="text-sm text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  const hasIndexed = documents.some((d) => d.status === "indexed");

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-subtle)" }}>
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-primary-foreground"
              style={{ background: "var(--gradient-hero)" }}
            >
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">
                Smart Local Knowledge Agent
              </h1>
              <p className="text-xs text-muted-foreground">멀티 에이전트 RAG 시스템</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-1.5 h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <PipelineHeader />

        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <UploadPanel documents={documents} onChange={fetchDocs} />
          <QueryPanel hasIndexedDocs={hasIndexed} />
        </div>

        <footer className="pt-4 text-center text-xs text-muted-foreground">
          <p>
            5단계 에이전트 파이프라인 · pgvector 시맨틱 검색 · 근거 기반 답변
          </p>
        </footer>
      </main>
    </div>
  );
}
