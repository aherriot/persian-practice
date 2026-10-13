import { and, eq, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { db } from "@/lib/db";
import { audioClips, lexemes, patterns, reviewLog, sentences, themes } from "@/lib/db/schema";
import { confusedWith, summariseConfusions } from "./confusions";
import { loadConfusions } from "./history";
import { DEFAULT_MAX_NEW, DEFAULT_MAX_REVIEW, dueTargets, planSession, type PlanOptions } from "./plan";
import {
  allIn,
  eligibleSentence,
  knownIds,
  ladderOrder,
  loadKnowledge,
  sameMeaning,
  textArray,
  visibleLexeme,
  visibleSentence,
  wordsOf,
} from "./store";
import type { SessionPlan } from "./types";

/** Sentences fetched for each thing due, so a review can avoid one already used this session. */
const PER_REVIEW = 6;
/** Sentences fetched for ungraded practice when little is due. */
const SPARE = 8;
/**
 * Ladder sentences fetched ahead of what a session can introduce: some turn
 * out to teach nothing new once the ones before them have been introduced.
 */
const LADDER_AHEAD = 4;
/** Random sentences and words fetched to make wrong answers from. */
const DISTRACTOR_SENTENCES = 40;
const DISTRACTOR_WORDS = 30;
const KNOWN_WORDS = 40;

type Scope = { themeId?: string };

/**
 * One theme's part of the course: its own sentences, plus the practice
 * sentences built entirely from its words and grammar.
 */
const inTheme = (themeId: string) => {
  const used = (column: string) =>
    sql`(select unnest(t.${sql.identifier(column)}) from ${sentences} t where t."themeId" = ${themeId} and not t."retired")`;
  return or(
    eq(sentences.themeId, themeId),
    and(eq(sentences.ladder, false), allIn(sentences.lexemeIds, used("lexemeIds")), allIn(sentences.patternIds, used("patternIds"))),
  )!;
};

/**
 * Plans a session from only the sentences it could use, however large the
 * course: the next few on the ladder, a handful for each thing due, and a
 * sample to make wrong answers from.
 */
export async function loadSession(
  userId: string,
  opts: Omit<PlanOptions, "seen" | "distractors" | "alternates" | "confusions" | "unspeakable"> & Scope,
): Promise<SessionPlan> {
  const { themeId, now, maxNew = DEFAULT_MAX_NEW, maxReview = DEFAULT_MAX_REVIEW } = opts;
  const scope = and(visibleSentence(userId), themeId ? inTheme(themeId) : undefined)!;

  const [known, patternRows, confusionRows] = await Promise.all([
    loadKnowledge(userId),
    db.select().from(patterns),
    loadConfusions(userId, now),
  ]);

  const due = [...new Set(dueTargets(known, now, maxReview, opts.review).map((item) => item.key))];
  const dueIds = (kind: "lexeme" | "pattern") =>
    textArray(due.filter((key) => key.startsWith(`${kind}:`)).map((key) => key.slice(kind.length + 1)));

  // How often the learner has answered each sentence; reviews prefer the least seen.
  const seen = sql`(select ${reviewLog.sentenceId} as id, count(*)::int as n from ${reviewLog} where ${reviewLog.userId} = ${userId} and ${reviewLog.sentenceId} is not null group by 1)`;
  const leastSeen = (uses: "lex" | "pat") => sql`
    select id from (
      select e.id, row_number() over (partition by due.id order by e.n, e.r) as nth
      from unnest(${dueIds(uses === "lex" ? "lexeme" : "pattern")}) as due(id)
      join eligible e on due.id = any(e.${sql.identifier(uses)})
    ) ranked where nth <= ${PER_REVIEW}`;
  const pool = sql`(
    with seen as materialized ${seen},
    eligible as materialized (
      select ${sentences.id} as id, ${sentences.lexemeIds} as lex, ${sentences.patternIds} as pat, coalesce(seen.n, 0) as n, random() as r
      from ${sentences} left join seen on seen.id = ${sentences.id}
      where ${scope} and ${eligibleSentence(userId)}
    )
    ${leastSeen("lex")}
    union ${leastSeen("pat")}
    union (select id from eligible order by n, r limit ${SPARE})
  )`;

  const [ladderRows, poolRows, distractors] = await Promise.all([
    // The next sentences that teach something, in ladder order.
    db
      .select({ sentence: sentences })
      .from(sentences)
      .leftJoin(themes, eq(themes.id, sentences.themeId))
      .where(and(scope, eq(sentences.ladder, true), sql`not ${eligibleSentence(userId)}`))
      .orderBy(...ladderOrder)
      .limit(maxNew * LADDER_AHEAD),
    db
      .select({
        sentence: sentences,
        // Not a hand-written subquery: in a select from one table drizzle drops
        // the table from a column written straight into sql``, and "sentenceId"
        // = "id" then compares a review with its own id and counts nothing.
        seen: db.$count(reviewLog, and(eq(reviewLog.userId, userId), eq(reviewLog.sentenceId, sentences.id))),
      })
      .from(sentences)
      .where(sql`${sentences.id} in ${pool}`),
    db
      .select({ english: sentences.english, length: sql<number>`jsonb_array_length(${sentences.tokens})` })
      .from(sentences)
      .where(scope)
      .orderBy(sql`random()`)
      .limit(DISTRACTOR_SENTENCES),
  ]);

  const chosen = [...ladderRows.map((row) => row.sentence), ...poolRows.map((row) => row.sentence)];
  const chosenIds = chosen.map((s) => s.id);
  const usedLexemes = [...new Set(chosen.flatMap((s) => s.lexemeIds))];
  const meanings = [...new Set(chosen.map((s) => s.english))];
  // Words these have been mixed up with, to offer as wrong answers again.
  const mixedUp = [...new Set(confusionRows.flatMap((row) => [row.targetId, row.pickedId]))];
  const sample = (ids: ReturnType<typeof knownIds>, limit: number) =>
    sql`${lexemes.id} in (select id from ${ids} as candidates(id) order by random() limit ${limit})`;

  const [lexemeRows, alternates] = await Promise.all([
    usedLexemes.length === 0
      ? []
      : db
          .select()
          .from(lexemes)
          .where(
            and(
              visibleLexeme(userId),
              or(
                inArray(lexemes.id, usedLexemes),
                mixedUp.length > 0 ? inArray(lexemes.id, mixedUp) : undefined,
                // The words of other ways to say the same things, so those are accepted in full.
                inArray(lexemes.id, wordsOf(sameMeaning(userId, meanings))),
                // Other forms of the same verbs, for "pick the missing word".
                sql`${lexemes.lemma} in (select l."lemma" from ${lexemes} l where l."id" in ${usedLexemes} and l."lemma" is not null)`,
                // Subject pronouns, which a correct answer may add or leave out.
                isNotNull(lexemes.subjectPronoun),
                // Wrong answers and spare tiles.
                sample(knownIds(userId, "lexeme"), KNOWN_WORDS),
                sample(sql`(select ${lexemes.id} from ${lexemes} where ${visibleLexeme(userId)})`, DISTRACTOR_WORDS),
              ),
            ),
          ),
    // Other ways of saying the same thing, which sentence-building has to accept:
    // from anywhere in the course, the same ones the answer is marked against (recordAnswer).
    chosen.length === 0 ? [] : db.select().from(sentences).where(and(sameMeaning(userId, meanings), notInArray(sentences.id, chosenIds))),
  ]);

  const lexemeMap = new Map(lexemeRows.map((l) => [l.id, l]));
  // Words whose own clip had to be a whole sentence: not to be asked about by ear alone.
  const wordClips = new Map(lexemeRows.map((l) => [wordClip(l).hash, l.id]));
  const carried =
    wordClips.size === 0
      ? []
      : await db
          .select({ hash: audioClips.hash })
          .from(audioClips)
          .where(and(inArray(audioClips.hash, [...wordClips.keys()]), isNotNull(audioClips.carrier)));
  return planSession(
    {
      sentences: chosen,
      lexemes: lexemeMap,
      patterns: new Map(patternRows.map((p) => [p.id, p])),
    },
    known,
    {
      ...opts,
      maxNew,
      maxReview,
      seen: new Map(poolRows.map((row) => [row.sentence.id, row.seen])),
      distractors,
      alternates,
      unspeakable: new Set(carried.map((clip) => wordClips.get(clip.hash)!)),
      confusions: confusedWith(summariseConfusions(confusionRows, lexemeMap, known)),
    },
  );
}
