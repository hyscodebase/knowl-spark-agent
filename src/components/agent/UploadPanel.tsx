import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Upload,
  File as FileIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Sparkles,
} from "lucide-react";

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

const ALLOWED = ["pdf", "docx", "txt", "pptx"];
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export function UploadPanel({
  documents,
  onChange,
}: {
  documents: DocRow[];
  onChange: () => void;
}) {
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    let okCount = 0;

    for (const file of Array.from(files)) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED.includes(ext)) {
        toast.error(`${file.name}: 지원하지 않는 형식`, {
          description: "PDF, DOCX, TXT, PPTX만 업로드 가능합니다.",
        });
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name}: 파일이 너무 큽니다 (최대 25MB)`);
        continue;
      }

      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file);
      if (upErr) {
        toast.error(`${file.name} 업로드 실패`, { description: upErr.message });
        continue;
      }

      const { error: insErr } = await supabase.from("documents").insert({
        user_id: user.id,
        file_name: file.name,
        file_path: path,
        file_type: file.type || ext,
        file_size: file.size,
        location: `/documents/${user.id.slice(0, 8)}/`,
        status: "pending",
      });
      if (insErr) {
        toast.error(`${file.name} 메타데이터 저장 실패`);
        continue;
      }
      okCount++;
    }

    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (okCount > 0) {
      toast.success(`${okCount}개 파일 업로드 완료`, {
        description: "이제 '인덱싱'을 눌러 벡터화하세요.",
      });
      onChange();
    }
  };

  const indexDocument = async (id: string) => {
    setIndexingId(id);
    const { data, error } = await supabase.functions.invoke("process-document", {
      body: { documentId: id },
    });
    setIndexingId(null);
    if (error) {
      toast.error("인덱싱 실패", { description: error.message });
    } else {
      toast.success("인덱싱 완료", {
        description: `${data?.chunkCount ?? 0}개 청크가 벡터화되었습니다.`,
      });
    }
    onChange();
  };

  const indexAll = async () => {
    const pending = documents.filter((d) => d.status !== "indexed");
    if (pending.length === 0) {
      toast.info("인덱싱할 새 문서가 없습니다");
      return;
    }
    for (const d of pending) {
      await indexDocument(d.id);
    }
  };

  const deleteDoc = async (doc: DocRow) => {
    await supabase.storage.from("documents").remove([doc.file_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    toast.success("삭제되었습니다");
    onChange();
  };

  return (
    <Card className="p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">문서 업로드</h3>
          <p className="text-xs text-muted-foreground">PDF · DOCX · TXT · PPTX (최대 25MB)</p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={indexAll}
          disabled={documents.length === 0 || indexingId !== null}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          전체 인덱싱
        </Button>
      </div>

      <label
        htmlFor="file-upload"
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/40 px-6 py-10 text-center transition hover:border-primary/40 hover:bg-secondary"
      >
        <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">
          {uploading ? "업로드 중..." : "파일을 선택하거나 끌어다 놓으세요"}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          여러 파일을 한 번에 업로드할 수 있습니다
        </span>
        <input
          ref={fileInput}
          id="file-upload"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.pptx"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={uploading}
        />
      </label>

      <div className="mt-5 space-y-2">
        {documents.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            아직 업로드된 문서가 없습니다
          </p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <FileIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.file_name}</p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={doc.status} chunkCount={doc.chunk_count} />
                  {doc.error_message && (
                    <span className="truncate text-destructive">{doc.error_message}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              {doc.status !== "indexed" && doc.status !== "processing" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => indexDocument(doc.id)}
                  disabled={indexingId !== null}
                >
                  {indexingId === doc.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "인덱싱"
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => deleteDoc(doc)}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatusBadge({ status, chunkCount }: { status: string; chunkCount: number }) {
  if (status === "indexed") {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <CheckCircle2 className="h-3 w-3 text-primary" />
        {chunkCount}개 청크 인덱싱됨
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