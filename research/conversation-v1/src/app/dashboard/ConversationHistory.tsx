"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ConversationSummary = {
  id: string;
  mode: "topic" | "review" | "placement";
  scenarioTitle: string | null;
  topicText: string | null;
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  lastActivityAt: string | null;
  lastMessage: string | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ConversationHistory() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations ?? []));
  }, []);

  if (conversations === null) return null;
  if (conversations.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">Past conversations</p>
      {conversations.map((c) => (
        <Link
          key={c.id}
          href={`/conversation/${c.id}`}
          className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
        >
          <div className="flex flex-col overflow-hidden">
            <span className="truncate font-medium text-gray-800">
              {c.scenarioTitle ?? c.topicText ?? (c.mode === "review" ? "Catching up" : "Conversation")}
            </span>
            {c.lastMessage && (
              <span dir="rtl" className="truncate text-right text-xs text-gray-400">
                {c.lastMessage}
              </span>
            )}
          </div>
          <span className="ml-3 shrink-0 text-xs text-gray-400">
            {timeAgo(c.lastActivityAt ?? c.startedAt)} · {c.turnCount} turns
          </span>
        </Link>
      ))}
    </div>
  );
}
