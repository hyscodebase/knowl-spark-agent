import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Brain,
  LogOut,
  ArrowLeft,
  Search,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  RefreshCw,
  Sparkles,
  Database,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/documents")({
  component: DocumentsPage,
});

type DocRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  status: string;
  chunk_count: number;
  error_message: string | null;
  location: string;
  created_at: string;
};

type StatusFilter = "all" | "indexed" | "pending" | "processing" | "error";

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DocumentsPage() {
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuth();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DocRow | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, file_name, file_path, file_type, file_size, status, chunk_count, error_message, location, created_at",
      )
      .order("created_at", { ascending: false });
    if (!error && data) setDocs(data as DocRow[]);
  }, [user]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // 처리 중 폴링
  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === "processing");
    if (!hasProcessing) return;
    const t = setInterval(fetchDocs, 2000);
    return () => clearInterval(t);
  }, [docs, fetchDocs]);

  const stats = useMemo(() => {
    const total = docs.length;
    const indexed = docs.filter((d) => d.status === "indexed").length;
    const chunks = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);
    const size = docs.reduce((s, d) => s + (d.file_size || 0), 0);
    return { total, indexed, chunks, size };
  }, [docs]);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      if (filter !== "all" && d.status !== filter) return false;
      if (search && !d.file_name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [docs, search, filter]);

  const reindex = async (doc: DocRow) => {
    setBusyId(doc.id);
    // 기존 청크 삭제 후 재인덱싱
    await supabase.from("document_chunks").delete().eq("document_id", doc.id);
    await supabase
      .from("documents")
      .update({ status: "pending", chunk_count: 0, error_message: null })
      .eq("id", doc.id);
    const { data, error } = await supabase.functions.invoke("process-document", {
      body: { documentId: doc.id },
    });
    setBusyId(null);
    if (error) {
      toast.error("재인덱싱 실패", { description: error.message });
    } else {
      toast.success(`${doc.file_name} 재인덱싱 완료`, {
        description: `${data?.chunkCount ?? 0}개 청크가 생성되었습니다.`,
      });
    }
    fetchDocs();
  };

  const indexOne = async (doc: DocRow) => {
    setBusyId(doc.id);
    const { data, error } = await supabase.functions.invoke("process-document", {
      body: { documentId: doc.id },
    });
    setBusyId(null);
    if (error) {
      toast.error("인덱싱 실패", { description: error.message });
    } else {
      toast.success("인덱싱 완료", {
        description: `${data?.chunkCount ?? 0}개 청크`,
      });
    }
    fetchDocs();
  };

  const deleteDoc = async (doc: DocRow) => {
    await supabase.storage.from("documents").remove([doc.file_path]);
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      toast.error("삭제 실패", { description: error.message });
    } else {
      toast.success(`${doc.file_name} 삭제됨`);
    }
    setConfirmDelete(null);
    fetchDocs();
  };

  const indexAllPending = async () => {
    const pending = docs.filter((d) => d.status !== "indexed" && d.status !== "processing");
    if (pending.length === 0) {
      toast.info("인덱싱할 문서가 없습니다");
      return;
    }
    setBulkBusy(true);
    for (const d of pending) {
      await indexOne(d);
    }
    setBulkBusy(false);
  };

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
              <p className="text-xs text-muted-foreground">문서 관리</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                대시보드
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-1.5 h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">문서 관리</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            업로드된 문서의 인덱싱 상태를 확인하고, 재인덱싱하거나 삭제할 수 있습니다.
          </p>
        </div>

        {/* 통계 */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={FileText} label="전체 문서" value={`${stats.total}개`} />
          <StatCard
            icon={CheckCircle2}
            label="인덱싱 완료"
            value={`${stats.indexed} / ${stats.total}`}
          />
          <StatCard icon={Database} label="총 청크 수" value={`${stats.chunks.toLocaleString()}`} />
          <StatCard icon={HardDrive} label="총 용량" value={formatBytes(stats.size)} />
        </div>

        {/* 필터 + 액션 */}
        <Card className="p-4" style={{ boxShadow: "var(--shadow-soft)" }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="파일명 검색..."
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "전체"],
                  ["indexed", "완료"],
                  ["pending", "대기"],
                  ["processing", "처리중"],
                  ["error", "오류"],
                ] as [StatusFilter, string][]
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? "default" : "outline"}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              onClick={indexAllPending}
              disabled={bulkBusy || busyId !== null}
            >
              {bulkBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              미인덱싱 전체 처리
            </Button>
          </div>
        </Card>

        {/* 표 */}
        <Card className="overflow-hidden" style={{ boxShadow: "var(--shadow-soft)" }}>
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {docs.length === 0
                  ? "아직 업로드된 문서가 없습니다. 대시보드에서 업로드하세요."
                  : "조건에 맞는 문서가 없습니다."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>파일명</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">청크</TableHead>
                  <TableHead className="text-right">크기</TableHead>
                  <TableHead>업로드</TableHead>
                  <TableHead className="text-right">동작</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{doc.file_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {doc.location}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={doc.status} />
                      {doc.error_message && (
                        <p className="mt-1 max-w-[200px] truncate text-xs text-destructive" title={doc.error_message}>
                          {doc.error_message}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {doc.chunk_count > 0 ? doc.chunk_count.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {formatBytes(doc.file_size)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(doc.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {doc.status === "indexed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reindex(doc)}
                            disabled={busyId !== null || bulkBusy}
                          >
                            {busyId === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                재인덱싱
                              </>
                            )}
                          </Button>
                        ) : doc.status !== "processing" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => indexOne(doc)}
                            disabled={busyId !== null || bulkBusy}
                          >
                            {busyId === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <Sparkles className="mr-1 h-3.5 w-3.5" />
                                인덱싱
                              </>
                            )}
                          </Button>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            처리중
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setConfirmDelete(doc)}
                          disabled={busyId === doc.id}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문서를 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{confirmDelete?.file_name}</span>
              {" "}와(과) 관련된 모든 청크 및 임베딩이 영구적으로 삭제됩니다.
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteDoc(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4" style={{ boxShadow: "var(--shadow-soft)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: "var(--gradient-subtle)" }}
        >
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "indexed") {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <CheckCircle2 className="h-3 w-3 text-primary" />
        인덱싱 완료
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <Loader2 className="h-3 w-3 animate-spin" />
        처리 중
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1 font-normal">
        <XCircle className="h-3 w-3" />
        오류
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      대기 중
    </Badge>
  );
}
