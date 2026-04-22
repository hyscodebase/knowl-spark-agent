import { useEffect, useState, useImperativeHandle, forwardRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { History, Repeat2, Trash2, Clock, Layers } from "lucide-react";

type HistoryRow = {
  id: string;
  query: string;
  top_k: number;
  summary: string | null;
  result_count: number;
  elapsed_ms: number;
  created_at: string;
};

export type HistoryPanelHandle = {
  refresh: () => void;
};

export const HistoryPanel = forwardRef<
  HistoryPanelHandle,
  { onRerun: (query: string, topK: number) => void }
>(function HistoryPanel({ onRerun }, ref) {
  const { user } = useAuth();
  const [items, setItems] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("query_history")
      .select("id, query, top_k, summary, result_count, elapsed_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setLoading(false);
    if (!error && data) setItems(data as HistoryRow[]);
  };

  useImperativeHandle(ref, () => ({ refresh: fetchHistory }));

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from("query_history").delete().eq("id", id);
    if (error) {
      toast.error("삭제 실패", { description: error.message });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearAll = async () => {
    if (!user || items.length === 0) return;
    const { error } = await supabase
      .from("query_history")
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("초기화 실패", { description: error.message });
      return;
    }
    setItems([]);
    toast.success("기록이 모두 삭제되었습니다");
  };

  return (
    <Card className="p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">검색 기록</h3>
          <Badge variant="secondary" className="font-mono">
            {items.length}
          </Badge>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            전체 삭제
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          아직 검색 기록이 없습니다
        </p>
      ) : (
        <ScrollArea className="h-[420px] pr-2">
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="group rounded-lg border bg-background p-3 transition hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => onRerun(item.query, item.top_k)}
                    className="min-w-0 flex-1 text-left"
                    title="다시 실행"
                  >
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {item.query}
                    </p>
                    {item.summary && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {item.summary}
                      </p>
                    )}
                  </button>
                  <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onRerun(item.query, item.top_k)}
                      title="같은 설정으로 다시 실행"
                    >
                      <Repeat2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => deleteItem(item.id)}
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="gap-1 font-mono">
                    <Layers className="h-3 w-3" />K={item.top_k}
                  </Badge>
                  <Badge variant="outline" className="gap-1 font-mono">
                    {item.result_count}건
                  </Badge>
                  <Badge variant="outline" className="gap-1 font-mono">
                    <Clock className="h-3 w-3" />
                    {(item.elapsed_ms / 1000).toFixed(2)}s
                  </Badge>
                  <span className="ml-auto">
                    {new Date(item.created_at).toLocaleString("ko-KR", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </Card>
  );
});