"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { MemoryPageShell } from "@/components/MemoryNav";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { VoicePlayer } from "@/components/ui/VoicePlayer";
import { VoiceRecorder } from "@/components/ui/VoiceRecorder";
import { apiJson } from "@/lib/apiClient";
import { useApi } from "@/lib/swr";
import { useContentEditAccess } from "@/lib/useContentEditAccess";
import { sendRealtimeEvent, useRealtimeEvents } from "@/lib/useWebSocket";
import { useAuth } from "@/lib/authContext";

type WhisperReply = {
  id: string;
  userId: string;
  content: string;
  voiceUrl?: string;
  createdAt?: string;
};

type Whisper = {
  id: string;
  title: string;
  createdById: string;
  messages?: WhisperReply[];
  updatedAt: string;
};

const whisperDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatWhisperDate(value?: string) {
  const raw = value?.trim();
  if (!raw) return "时间未记录";

  const sqliteMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
  );
  const timestamp = sqliteMatch
    ? Date.UTC(
        Number(sqliteMatch[1]),
        Number(sqliteMatch[2]) - 1,
        Number(sqliteMatch[3]),
        Number(sqliteMatch[4]),
        Number(sqliteMatch[5]),
        Number(sqliteMatch[6]),
        Number((sqliteMatch[7] ?? "0").padEnd(3, "0")),
      )
    : Date.parse(raw);

  if (!Number.isFinite(timestamp)) return "时间未记录";
  return whisperDateFormatter.format(new Date(timestamp));
}

export function WhisperWall() {
  const [open, setOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState("");
  const [form, setForm] = useState({ title: "", content: "", voiceUrl: "" });
  const [replyContent, setReplyContent] = useState("");
  const [replyVoiceUrl, setReplyVoiceUrl] = useState("");
  const [typingWhispers, setTypingWhispers] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [replyingId, setReplyingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const typingTimersRef = useRef<Record<string, number>>({});
  const lastTypingSentRef = useRef<Record<string, number>>({});
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { session } = useAuth();
  const isAdmin = useContentEditAccess();
  const { data, mutate } = useApi<{ whispers: Whisper[] }>("/api/v1/whispers");
  const whispers = data?.whispers ?? [];

  useRealtimeEvents((event) => {
    if (event.type !== "whisper.typing" || !event.targetId) return;
    const whisperId = event.targetId;
    const typing = event.metadata?.typing !== false;
    window.clearTimeout(typingTimersRef.current[whisperId]);
    if (!typing) {
      setTypingWhispers((current) => ({ ...current, [whisperId]: false }));
      return;
    }
    setTypingWhispers((current) => ({ ...current, [whisperId]: true }));
    typingTimersRef.current[whisperId] = window.setTimeout(() => {
      setTypingWhispers((current) => ({ ...current, [whisperId]: false }));
    }, 2600);
  });

  useEffect(() => {
    const timers = typingTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const sendTyping = (whisperId: string, typing: boolean) => {
    if (!isAdmin) return;
    sendRealtimeEvent({
      type: "whisper.typing",
      targetId: whisperId,
      metadata: { typing },
    });
  };

  const emitTyping = (whisperId: string, value: string, timestamp: number) => {
    if (!value.trim()) {
      sendTyping(whisperId, false);
      return;
    }
    if (timestamp - (lastTypingSentRef.current[whisperId] ?? 0) < 1200) return;
    lastTypingSentRef.current[whisperId] = timestamp;
    sendTyping(whisperId, true);
  };

  const closeDialog = () => {
    setOpen(false);
    setForm({ title: "", content: "", voiceUrl: "" });
  };

  const create = async () => {
    if (!form.title.trim()) {
      toast("请填写标题", "warning");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await apiJson("/api/v1/whispers", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ title: "", content: "", voiceUrl: "" });
      setOpen(false);
      void mutate();
    } catch {
      toast("创建失败，请稍后再试", "error");
    } finally {
      setSaving(false);
    }
  };

  const reply = async (whisperId: string) => {
    if (!replyContent.trim() && !replyVoiceUrl) {
      toast("回复内容或语音不能为空", "warning");
      return;
    }
    if (replyingId) return;
    setReplyingId(whisperId);
    try {
      await apiJson(`/api/v1/whispers/${whisperId}/reply`, {
        method: "POST",
        body: JSON.stringify({ content: replyContent, voiceUrl: replyVoiceUrl }),
      });
      setReplyContent("");
      setReplyVoiceUrl("");
      sendTyping(whisperId, false);
      setReplyOpen("");
      void mutate();
    } catch {
      toast("回复失败，请稍后再试", "error");
    } finally {
      setReplyingId("");
    }
  };

  const cancelReply = () => {
    if (replyOpen) sendTyping(replyOpen, false);
    setReplyOpen("");
    setReplyContent("");
    setReplyVoiceUrl("");
  };

  const deleteWhisper = async (whisper: Whisper) => {
    if (deletingId) return;
    const confirmed = await confirm({
      title: "删除悄悄话？",
      description: `“${whisper.title}”以及其中的全部回复都会被永久删除。`,
      confirmText: "删除",
      cancelText: "取消",
      danger: true,
    });
    if (!confirmed) return;

    setDeletingId(whisper.id);
    if (replyOpen === whisper.id) cancelReply();
    try {
      await apiJson(`/api/v1/whispers/${whisper.id}`, { method: "DELETE" });
      await mutate();
      toast("悄悄话已删除", "success");
    } catch {
      toast("删除失败，只能删除自己创建的悄悄话", "error");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <MemoryPageShell active="whispers">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate">💌 悄悄话</h1>
      </header>

      <button
        className="fixed bottom-28 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-bloom text-white shadow-lg transition-all duration-300 hover:scale-110 hover:shadow-xl active:scale-95 disabled:opacity-50 lg:bottom-6"
        onClick={() => setOpen(true)}
        disabled={!isAdmin}
      >
        <Plus className="h-6 w-6" />
      </button>

      <Modal
        open={open}
        onClose={() => { if (!saving) closeDialog(); }}
        title="新建悄悄话"
        closeOnOverlay={!saving}
      >
        <div className="space-y-3">
          <Input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={saving} />
          <Textarea placeholder="第一条留言（可选）" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} disabled={saving} />
          <VoiceRecorder
            folder="whispers"
            value={form.voiceUrl}
            disabled={saving}
            onChange={(voiceUrl) => setForm((current) => ({ ...current, voiceUrl }))}
            onError={(message) => toast(message, "error")}
          />
          <Button className="w-full" onClick={create} disabled={!isAdmin || saving}>
            {saving ? <Spinner size="sm" /> : "创建"}
          </Button>
        </div>
      </Modal>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {whispers.length === 0 ? (
          <EmptyState icon={<MessageCircle className="h-7 w-7" />} title="还没有悄悄话">
            创建第一条悄悄话，开始两人的私密对话。
          </EmptyState>
        ) : (
          whispers.map((w) => (
            <div
              key={w.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words text-lg font-semibold">{w.title}</h3>
                {w.createdById === session?.user?.id && (
                  <button
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] text-ink/38 transition hover:bg-sakura/52 hover:text-bloom disabled:opacity-40"
                    type="button"
                    onClick={() => { void deleteWhisper(w); }}
                    disabled={!!deletingId}
                    aria-label={`删除悄悄话：${w.title}`}
                  >
                    {deletingId === w.id ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </div>
              <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
                {(w.messages ?? []).map((msg) => (
                  <div key={msg.id} className="rounded bg-gray-50 p-2 text-sm">
                    {msg.content && <p>{msg.content}</p>}
                    <div className={msg.content ? "mt-2" : ""}>
                    <VoicePlayer src={msg.voiceUrl} label="悄悄话语音" compact />
                    </div>
                    <time className="text-xs text-gray-400" dateTime={msg.createdAt}>
                      {formatWhisperDate(msg.createdAt)}
                    </time>
                  </div>
                ))}
                {typingWhispers[w.id] && (
                  <div className="flex items-center gap-2 rounded bg-mist/36 px-2 py-1.5 text-xs font-semibold text-sky">
                    <span>TA 正在写</span>
                    <span className="flex gap-1" aria-hidden="true">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky [animation-delay:120ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky [animation-delay:240ms]" />
                    </span>
                  </div>
                )}
              </div>
              {replyOpen === w.id ? (
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      placeholder="回复..."
                      value={replyContent}
                      onChange={(e) => {
                        setReplyContent(e.target.value);
                        emitTyping(w.id, e.target.value, e.timeStamp);
                      }}
                      disabled={!!replyingId}
                    />
                    <VoiceRecorder
                      folder="whispers"
                      value={replyVoiceUrl}
                      disabled={!!replyingId}
                      onChange={setReplyVoiceUrl}
                      onError={(message) => toast(message, "error")}
                    />
                  </div>
                  <Button onClick={() => reply(w.id)} disabled={!!replyingId}>
                    {replyingId === w.id ? <Spinner size="sm" /> : "发送"}
                  </Button>
                  <Button variant="ghost" onClick={cancelReply} disabled={!!replyingId}>取消</Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setReplyOpen(w.id)} disabled={!isAdmin}>回复</Button>
              )}
            </div>
          ))
        )}
      </section>
      {confirmDialog}
    </MemoryPageShell>
  );
}
