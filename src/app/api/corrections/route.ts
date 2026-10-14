import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { audioUrl } from "@/lib/audio-key";
import { makeClipAudio, registerClips, reviewClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { audioClips } from "@/lib/db/schema";
import { draftCorrection } from "@/lib/lesson/author";
import { commit, describeSubject, isEmpty, loadSubject, prepare, type Editor, type Line } from "@/lib/lesson/correct";
import { doubtedClip, mayChange, raiseFlag, resolveFlags } from "@/lib/lesson/flags";
import { Proposal } from "@/lib/lesson/corrections";
import { errorResponse, requireApiKey } from "@/lib/openai";
import { reportError } from "@/lib/report-error";

// Making a recording again is up to six takes, each listened to twice.
export const maxDuration = 300;

const Subject = z.object({ kind: z.enum(["lexeme", "sentence"]), id: z.string().min(1).max(100) });
const note = z.string().trim().min(1).max(1000);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("flag"), subject: Subject, note }),
  z.object({ action: z.literal("looks-right"), subject: Subject }),
  z.object({ action: z.literal("propose"), subject: Subject, note }),
  z.object({ action: z.literal("apply"), subject: Subject, note, proposal: Proposal }),
]);

const MADE_AT_ONCE = 3;

/** A proposal comes back from the browser to be applied; nothing a model wrote is anywhere near this long. */
const MAX_BODY = 20_000;

export type ProposeResponse = {
  summary: string;
  /** What will change. Empty when nothing will. */
  lines: Line[];
  /** Null when there is nothing to apply. */
  proposal: Proposal | null;
};

export type ApplyResponse = {
  /** The recording that was made again, to be fetched afresh and played. */
  audioUrl: string | null;
  /** False if the new take did not pass the automated listener either. */
  audioVerified: boolean;
};

/**
 * Flags, reviews and fixes a word or a sentence.
 * "flag" keeps a note of what is wrong, for the review list, to be fixed later.
 * "looks-right" closes the flags on it, and pins its recording if the
 * automated listener was unsure of it: a person has now heard it.
 * "propose" asks the author what should change and answers with that, for the
 * person to read; "apply" makes a change they have agreed to, and closes every
 * flag on the thing it changed.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const raw = await request.text();
  const body = raw.length > MAX_BODY ? null : Body.safeParse(await Promise.resolve(raw).then(JSON.parse).catch(() => null));
  if (!body?.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const data = body.data;

  try {
    const editor: Editor = { id: userId, shared: canReviewAudio(session.user?.email ?? null) };
    const loaded = await loadSubject(userId, data.subject);
    if (!loaded) return Response.json({ error: "not found" }, { status: 404 });
    if (!mayChange(editor, loaded)) return Response.json({ error: "not yours to change" }, { status: 403 });

    if (data.action === "flag") {
      await raiseFlag(editor, data.subject, data.note);
      return Response.json({ ok: true });
    }
    if (data.action === "looks-right") {
      await resolveFlags(editor, data.subject, "dismissed");
      const hash = editor.shared ? await doubtedClip(loaded) : null;
      if (hash) await reviewClip(hash, userId, { verdict: "approved" });
      return Response.json({ ok: true });
    }

    const missingKey = requireApiKey();
    if (missingKey) return missingKey;

    if (data.action === "propose") {
      const subject = describeSubject(loaded);
      let proposal = await draftCorrection(subject, data.note);
      let prepared = await prepare(editor, loaded, proposal);
      if (!prepared.ok) {
        // One more go, told what was wrong with the first.
        proposal = await draftCorrection(subject, data.note, { proposal, problems: prepared.problems });
        prepared = await prepare(editor, loaded, proposal);
      }
      if (!prepared.ok) return Response.json({ error: prepared.problems.join(" ") }, { status: 422 });
      const nothing = isEmpty(prepared.plan);
      return Response.json({ summary: proposal.summary, lines: prepared.plan.lines, proposal: nothing ? null : proposal } satisfies ProposeResponse);
    }

    const prepared = await prepare(editor, loaded, data.proposal);
    if (!prepared.ok) return Response.json({ error: prepared.problems.join(" ") }, { status: 422 });
    const { plan } = prepared;
    const fresh = await commit(editor, loaded, data.note, data.proposal.summary, plan);
    await resolveFlags(editor, data.subject, "fixed");
    await registerClips(fresh);

    let result: ApplyResponse = { audioUrl: null, audioVerified: true };
    if (plan.audio) {
      const { clip, reason } = plan.audio;
      await registerClips([clip]);
      // A take that is already stored is kept as a labelled bad example and replaced; otherwise there is only one to make.
      const reviewed = await reviewClip(clip.hash, userId, { verdict: "rejected", reason, note: data.note.slice(0, 300) });
      if (!reviewed) await makeClipAudio(clip.hash);
      const [made] = await db.select({ status: audioClips.status }).from(audioClips).where(eq(audioClips.hash, clip.hash));
      result = { audioUrl: audioUrl(clip), audioVerified: made?.status === "verified" };
    }
    // New text needs new recordings. Each is made the first time it is played
    // (or by `npm run db:audio`); the first few, which are the ones the person
    // is looking at, are made now, once the answer is sent.
    const waiting = fresh.filter((clip) => clip.hash !== plan.audio?.clip.hash).slice(0, MADE_AT_ONCE);
    if (waiting.length > 0) {
      after(async () => {
        for (const clip of waiting) await makeClipAudio(clip.hash).catch((err) => reportError("corrections audio", err, { hash: clip.hash }));
      });
    }
    return Response.json(result);
  } catch (err) {
    return errorResponse("corrections", err);
  }
}
