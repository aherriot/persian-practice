"use client";

import { useEffect, useRef, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { MessageContent } from "./MessageContent";

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  transliteration: string | null;
  seq: number;
};
type ConversationData = { conversation: { id: string; scenario: { title: string } | null }; turns: Turn[] };

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const context = new AudioContext();
    void context.resume().then(() => context.close());
  } catch {
    // Safari without a gesture-primed context just won't autoplay — fine.
  }
}

/** Persian/Arabic block, plus the zero-width non-joiner — same range transcript.ts uses. */
const PERSIAN_RE = /[؀-ۿ‌]/;

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ConversationData | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLatin, setShowLatin] = useState<Set<string>>(new Set());
  const spokenIds = useRef<Set<string>>(new Set());
  const audioCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    fetch(`/api/conversations/${id}`)
      .then((r) => r.json())
      .then((d: ConversationData) => {
        setData(d);
        const opener = d.turns[0];
        if (opener && opener.role === "assistant" && !spokenIds.current.has(opener.id)) {
          spokenIds.current.add(opener.id);
          void speak(opener.id, opener.content);
        }
      });
  }, [id]);

  async function speak(turnId: string, text: string) {
    const cached = audioCache.current.get(turnId);
    if (cached) {
      await new Audio(cached).play().catch(() => {});
      return;
    }
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, format: "mp3" }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCache.current.set(turnId, url);
    await new Audio(url).play().catch(() => {
      // Autoplay blocked — the learner can still read the text or hit repeat.
    });
  }

  function toggleLatin(turnId: string) {
    setShowLatin((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  }

  async function send() {
    const text = message.trim();
    if (!text || sending) return;
    unlockAudio();
    setSending(true);
    setError(null);
    setMessage("");

    setData((prev) =>
      prev
        ? {
            ...prev,
            turns: [
              ...prev.turns,
              {
                id: `pending-${Date.now()}`,
                role: "user",
                content: text,
                transliteration: null,
                seq: prev.turns.length,
              },
            ],
          }
        : prev,
    );

    const res = await fetch(`/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const body = await res.json();
    setSending(false);

    if (!res.ok) {
      setError(body.error ?? "something went wrong");
      return;
    }

    const replyId = `reply-${Date.now()}`;
    setData((prev) =>
      prev
        ? {
            ...prev,
            turns: [
              ...prev.turns,
              {
                id: replyId,
                role: "assistant",
                content: body.reply,
                transliteration: body.transliteration ?? null,
                seq: prev.turns.length + 1,
              },
            ],
          }
        : prev,
    );
    void speak(replyId, body.reply);
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-gray-400">Loading…</p>
      </main>
    );
  }

  const inputIsPersian = PERSIAN_RE.test(message);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{data.conversation.scenario?.title ?? "Conversation"}</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline">
          Dashboard
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-gray-200 p-4">
        {data.turns.map((t) => (
          <div key={t.id} className={t.role === "user" ? "self-end" : "self-start"}>
            <div
              dir={showLatin.has(t.id) ? "ltr" : "rtl"}
              className={
                "max-w-xs rounded-lg px-3 py-2 text-right " +
                (t.role === "user" ? "bg-black text-white" : "bg-gray-100 text-gray-900") +
                (showLatin.has(t.id) ? " text-left italic" : "")
              }
            >
              {showLatin.has(t.id) && t.transliteration ? (
                t.transliteration
              ) : t.role === "assistant" ? (
                <MessageContent text={t.content} sentence={t.content} />
              ) : (
                t.content
              )}
            </div>
            {t.role === "assistant" && (
              <div className="mt-1 flex gap-3 text-xs text-gray-400">
                <button onClick={() => void speak(t.id, t.content)} className="hover:text-gray-600">
                  🔊 repeat
                </button>
                {t.transliteration && (
                  <button onClick={() => toggleLatin(t.id)} className="hover:text-gray-600">
                    {showLatin.has(t.id) ? "فارسی" : "abc"}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {sending && <p className="self-start text-xs text-gray-400">…</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <input
          dir={inputIsPersian ? "rtl" : "ltr"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="بنویس یا type in Finglish…"
          className={"flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm " + (inputIsPersian ? "text-right" : "text-left")}
        />
        <button
          onClick={send}
          disabled={sending || !message.trim()}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </main>
  );
}
