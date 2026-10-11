"use client";

import { useEffect, useRef, useState } from "react";

type Definition = { gloss: string; transliteration: string };

// Module-level: definitions don't change, so cache persists across messages
// and remounts for the lifetime of the tab, not just one bubble.
const definitionCache = new Map<string, Definition>();

function stripPunctuation(word: string): string {
  return word.replace(/^[.,!?؟،؛:"'()«»]+|[.,!?؟،؛:"'()«»]+$/g, "");
}

/**
 * Renders Persian text as tap-to-define words. Tap (or click) a word to open
 * a popover with its gloss + transliteration; tap again or tap elsewhere to
 * close it. Works identically for touch and mouse — no separate hover-only
 * affordance needed, since a tap doubles as both "reveal" and "dismiss."
 */
export function MessageContent({
  text,
  sentence,
  turnId,
}: {
  text: string;
  sentence: string;
  turnId: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [def, setDef] = useState<Definition | null>(null);
  const [loading, setLoading] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flaggedWords, setFlaggedWords] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const tokens = text.split(/(\s+)/);

  async function handleClick(index: number, rawWord: string) {
    if (openIndex === index) {
      setOpenIndex(null);
      return;
    }
    setOpenIndex(index);
    const key = stripPunctuation(rawWord);
    const cached = definitionCache.get(key);
    if (cached) {
      setDef(cached);
      return;
    }
    setDef(null);
    setLoading(true);
    try {
      const res = await fetch("/api/define", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: key, context: sentence }),
      });
      if (res.ok) {
        const data: Definition = await res.json();
        definitionCache.set(key, data);
        setDef(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function flagWord(rawWord: string) {
    const key = stripPunctuation(rawWord);
    if (flagging || flaggedWords.has(key)) return;
    const cached = definitionCache.get(key);
    if (!cached) return;
    setFlagging(true);
    try {
      const res = await fetch("/api/vocab/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persian: key,
          gloss: cached.gloss,
          transliteration: cached.transliteration,
          turnId,
        }),
      });
      if (res.ok) {
        setFlaggedWords((prev) => new Set(prev).add(key));
      }
    } finally {
      setFlagging(false);
    }
  }

  return (
    <span ref={containerRef}>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token) || token === "") return <span key={i}>{token}</span>;
        return (
          <span key={i} className="relative inline-block">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClick(i, token);
              }}
              className="underline decoration-dotted decoration-gray-400 underline-offset-2"
            >
              {token}
            </button>
            {openIndex === i && (
              <span
                dir="ltr"
                className="absolute left-1/2 top-full z-10 mt-1 flex w-max max-w-[220px] flex-col items-start gap-1 rounded-md bg-gray-900 px-2 py-1.5 text-left text-xs text-white shadow-lg"
              >
                <span>{loading ? "…" : def ? `${def.gloss} — ${def.transliteration}` : "no definition"}</span>
                {def && !loading && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      flagWord(token);
                    }}
                    disabled={flagging || flaggedWords.has(stripPunctuation(token))}
                    className="text-gray-300 underline decoration-dotted disabled:no-underline disabled:text-green-400"
                  >
                    {flaggedWords.has(stripPunctuation(token)) ? "✓ added to review" : "I had to look this up"}
                  </button>
                )}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
