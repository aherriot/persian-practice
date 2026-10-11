/**
 * Support functions for the topic-driven conversation loop (M3): generating a
 * scenario from free text, and selecting which items to surface into a turn's
 * prompt. Kept separate from `prompt.ts` (pure string-building) since these
 * touch the DB and the LLM.
 */
import { and, desc, eq, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { CHAT_MODEL, openai } from "@/lib/openai";
import { db } from "@/lib/db";
import { conversations, corrections, items, turns, userItems } from "@/lib/db/schema";
import type { PromptItem, Scenario } from "@/lib/prompt";
import { NEW_ITEM_STATE, placementSeedState, qualityFromOutcome, reviewItem } from "@/lib/srs";

const ScenarioSchema = z.object({
  title: z.string(),
  goal: z.string(),
  situation: z.string(),
  opener: z.string(),
  openerTransliteration: z.string(),
});

/**
 * One cheap LLM call per topic (not per turn) to turn free text into a
 * roleplay scenario in the same shape as the hand-written LUNCH_SCENARIO.
 * Stored on the conversation row so subsequent turns reuse it verbatim.
 */
export async function generateScenario(topicText: string, level: string | null): Promise<Scenario> {
  const completion = await openai.chat.completions.parse({
    model: CHAT_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "You design short roleplay scenarios for a Persian conversation tutor app.",
          "Given a learner's free-text topic, write a scenario in the same spirit as this example:",
          "",
          '  situation: "You are a waiter at a casual restaurant in Tehran. The learner has just',
          '    sat down. Take their order the way a real waiter would — friendly, brisk, not a',
          '    language lesson."',
          '  goal: "Order a meal and ask one follow-up question"',
          '  opener: "سلام، خوش اومدید! چی میل دارید؟" (spoken in colloquial Tehrani Persian)',
          '  openerTransliteration: "salâm, khosh umadid! chi meyl dârid?"',
          "",
          `The learner's level: ${level ?? "unknown, treat as beginner"}.`,
          "Keep goal short (one sentence), situation 1-3 sentences addressed to the tutor persona",
          "(what role to play, who the learner is), and opener a short colloquial Tehrani line.",
          "openerTransliteration is a Latin transliteration of opener, for a learner who struggles",
          "to read the script.",
        ].join("\n"),
      },
      { role: "user", content: `Topic: ${topicText}` },
    ],
    response_format: zodResponseFormat(ScenarioSchema, "scenario"),
    temperature: 0.8,
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) throw new Error("scenario generation returned no parsed result");

  return { id: "topic", ...parsed };
}

/** Distinct tags across the item bank, for the cheap keyword-based topic tagger below. */
async function knownTags(): Promise<string[]> {
  const rows = await db.select({ tags: items.tags }).from(items);
  return [...new Set(rows.flatMap((r) => r.tags))];
}

/**
 * Heuristic, not an LLM call: a topic like "packing for a trip to the north"
 * should pick up "travel"/"packing" if those tags exist in the bank. Good
 * enough for biasing item selection without a per-topic LLM round-trip.
 */
export async function deriveTopicTags(rawText: string): Promise<string[]> {
  const tags = await knownTags();
  const lower = rawText.toLowerCase();
  return tags.filter((tag) => lower.includes(tag.replace(/-/g, " ")));
}

// Biased toward introducing new vocabulary rather than just reviewing due
// items — reviewing is the easy default for both the model and the learner,
// so new words need the numeric edge or they never come up.
const MAX_DUE_ITEMS = 2;
const MAX_NEW_ITEMS = 3;

/**
 * Items to weave into this turn's prompt: SRS-due items first, then a few
 * not-yet-introduced items biased toward the topic's tags (falling back to
 * the learner's tier if nothing tags-matches), picked at random each time so
 * the same couple of "new" words don't get offered on repeat. Assigns small
 * sequential refs so the model never has to echo back a real item UUID (see
 * prompt.ts), and tags each as due-for-review vs. genuinely new so the prompt
 * can prioritize teaching over reviewing.
 */
export async function selectPromptItems(
  userId: string,
  topicTags: string[],
): Promise<{ promptItems: PromptItem[]; refToItemId: Map<number, string> }> {
  const today = new Date().toISOString().slice(0, 10);

  const due = await db
    .select({ itemId: items.id, persian: items.persian, gloss: items.gloss })
    .from(userItems)
    .innerJoin(items, eq(userItems.itemId, items.id))
    .where(and(eq(userItems.userId, userId), lte(userItems.dueAt, today)))
    .orderBy(userItems.dueAt)
    .limit(MAX_DUE_ITEMS);

  const knownItemIds = await db
    .select({ itemId: userItems.itemId })
    .from(userItems)
    .where(eq(userItems.userId, userId));
  const excludeIds = knownItemIds.map((r) => r.itemId);

  const newItemsQuery = excludeIds.length > 0 ? notInArray(items.id, excludeIds) : undefined;

  let candidates: { id: string; persian: string; gloss: string; tags: string[] }[] = [];
  if (topicTags.length > 0) {
    candidates = await db
      .select({ id: items.id, persian: items.persian, gloss: items.gloss, tags: items.tags })
      .from(items)
      .where(newItemsQuery)
      .orderBy(sql`random()`);
    candidates = candidates.filter((c) => c.tags.some((t) => topicTags.includes(t)));
  }
  if (candidates.length === 0) {
    candidates = await db
      .select({ id: items.id, persian: items.persian, gloss: items.gloss, tags: items.tags })
      .from(items)
      .where(newItemsQuery)
      .orderBy(sql`random()`)
      .limit(20);
  }
  const newItems = candidates.slice(0, MAX_NEW_ITEMS);

  const promptItems: PromptItem[] = [];
  const refToItemId = new Map<number, string>();
  let ref = 1;
  for (const d of due) {
    promptItems.push({ ref, persian: d.persian, gloss: d.gloss, isNew: false });
    refToItemId.set(ref, d.itemId);
    ref++;
  }
  for (const n of newItems) {
    promptItems.push({ ref, persian: n.persian, gloss: n.gloss, isNew: true });
    refToItemId.set(ref, n.id);
    ref++;
  }

  return { promptItems, refToItemId };
}

/**
 * Marks a brand-new item as "seen" after the tutor introduces it, even if the
 * learner didn't use it back this turn — otherwise it would just get offered
 * as "new" again indefinitely instead of graduating into the SRS review
 * rotation. Seeded the same low-confidence way as a placement result: due
 * again soon so early exposure quickly turns into real practice.
 */
export async function markIntroduced(userId: string, itemId: string): Promise<void> {
  const existing = await db.query.userItems.findFirst({
    where: and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)),
  });
  if (existing) return;

  const seed = placementSeedState();
  await db.insert(userItems).values({
    userId,
    itemId,
    intervalDays: seed.intervalDays,
    easeFactor: seed.easeFactor,
    repetitions: seed.repetitions,
    lapses: seed.lapses,
    dueAt: seed.dueAt.toISOString().slice(0, 10),
    lastReviewedAt: seed.lastReviewedAt,
    source: "conversation",
  });
}

const RECENT_MISTAKES_LIMIT = 3;

/**
 * Applies one item's conversational outcome to its SM-2 state and logs a
 * `corrections` row. Only called for "correct"/"recast" — "not_attempted" and
 * "unknown" outcomes are skipped by the caller before reaching here.
 */
export async function applySrsOutcome(
  userId: string,
  itemId: string,
  turnId: string,
  outcome: "correct" | "recast",
): Promise<void> {
  const quality = qualityFromOutcome(outcome);
  if (quality === null) return;

  const existing = await db.query.userItems.findFirst({
    where: and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)),
  });

  const baseState = existing ?? NEW_ITEM_STATE;
  const update = reviewItem(baseState, quality);

  if (existing) {
    await db
      .update(userItems)
      .set({
        intervalDays: update.intervalDays,
        easeFactor: update.easeFactor,
        repetitions: update.repetitions,
        lapses: update.lapses,
        dueAt: update.dueAt.toISOString().slice(0, 10),
        lastReviewedAt: update.lastReviewedAt,
      })
      .where(eq(userItems.id, existing.id));
  } else {
    await db.insert(userItems).values({
      userId,
      itemId,
      intervalDays: update.intervalDays,
      easeFactor: update.easeFactor,
      repetitions: update.repetitions,
      lapses: update.lapses,
      dueAt: update.dueAt.toISOString().slice(0, 10),
      lastReviewedAt: update.lastReviewedAt,
      source: "conversation",
    });
  }

  await db.insert(corrections).values({ turnId, itemId, outcome });
}

export async function recentMistakes(userId: string): Promise<{ persian: string; gloss: string }[]> {
  return db
    .select({ persian: items.persian, gloss: items.gloss })
    .from(corrections)
    .innerJoin(turns, eq(corrections.turnId, turns.id))
    .innerJoin(conversations, eq(turns.conversationId, conversations.id))
    .innerJoin(items, eq(corrections.itemId, items.id))
    .where(and(eq(conversations.userId, userId), eq(corrections.outcome, "recast")))
    .orderBy(desc(corrections.createdAt))
    .limit(RECENT_MISTAKES_LIMIT);
}
