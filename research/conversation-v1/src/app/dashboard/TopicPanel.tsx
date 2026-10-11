"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Topic = { id: string; rawText: string; lastUsedAt: string };

export function TopicPanel() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch("/api/topics")
      .then((r) => r.json())
      .then((d) => setTopics(d.topics ?? []));
  }, []);

  async function startFromText() {
    const trimmed = text.trim();
    if (!trimmed || starting) return;
    setStarting(true);
    const topicRes = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: trimmed }),
    });
    const { topic } = await topicRes.json();
    await startConversation(topic.id);
  }

  async function startConversation(topicId: string) {
    setStarting(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "topic", topicId }),
    });
    const { conversationId } = await res.json();
    router.push(`/conversation/${conversationId}`);
  }

  async function startReview() {
    setStarting(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "review" }),
    });
    const { conversationId } = await res.json();
    router.push(`/conversation/${conversationId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">What do you want to talk about?</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. I'm packing for a trip to the north this weekend"
          rows={2}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={startFromText}
          disabled={starting || !text.trim()}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start a conversation"}
        </button>
      </div>

      <button
        onClick={startReview}
        disabled={starting}
        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        Just chat (weave in due review)
      </button>

      {topics.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Past topics</p>
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => startConversation(t.id)}
              disabled={starting}
              className="rounded-md border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 disabled:opacity-50"
            >
              {t.rawText}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
