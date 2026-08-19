/**
 * Credential smoke test.
 *
 * Makes one tiny call per configured provider and maps the failure modes to
 * their actual causes. Worth its own script because the most common mistake —
 * pasting Azure's endpoint URL into AZURE_SPEECH_REGION, which the portal shows
 * right next to the key — surfaces as a DNS error deep inside a 50-sample
 * bakeoff rather than as "your region is wrong".
 *
 *   npx tsx spike/check-credentials.ts
 */

import dotenv from "dotenv";

import { synthesize, type TtsArm } from "../src/lib/tts-provider.ts";
import { isDailyQuota, isRateLimit } from "../src/lib/throttle.ts";

dotenv.config({ path: ".env.local", quiet: true });

const PROBE_TEXT = "سلام";

/** Turns a raw provider error into something actionable. */
function diagnose(provider: "openai" | "azure", err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (provider === "azure") {
    if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(message)) {
      return (
        `AZURE_SPEECH_REGION looks wrong — got "${process.env.AZURE_SPEECH_REGION}".\n` +
        `      It must be the short region name (e.g. eastus), not the endpoint URL the portal\n` +
        `      displays beside the key.`
      );
    }
    if (/\b401\b|Unauthorized/i.test(message)) {
      return "AZURE_SPEECH_KEY is not valid. Copy KEY 1 from Keys and Endpoint.";
    }
    if (/\b403\b|Forbidden/i.test(message)) {
      return "Key is valid but rejected for this region — the key and region must come from the same resource.";
    }
    if (/\b429\b/.test(message)) {
      return "Rate limited (expected on the F0 free tier). Credentials are fine; reruns are resumable.";
    }
  }

  if (provider === "openai") {
    if (/\b401\b|Incorrect API key/i.test(message)) {
      return "OPENAI_API_KEY is not valid.";
    }
    if (/\b429\b|quota/i.test(message)) {
      return "Rate limited or out of quota — check billing at platform.openai.com.";
    }
  }

  return message;
}

async function check(label: string, arm: TtsArm): Promise<boolean> {
  process.stdout.write(`  ${label} … `);
  try {
    const audio = await synthesize(arm, PROBE_TEXT);
    if (audio.byteLength === 0) {
      console.log("returned empty audio");
      return false;
    }
    console.log(`ok (${audio.byteLength} bytes)`);
    return true;
  } catch (err) {
    // A rate limit proves the credentials work — it is the server answering,
    // not rejecting. Reporting it as FAILED alongside a billing link reads as
    // "your key is wrong" and sends people off rotating keys for no reason.
    if (isRateLimit(err)) {
      console.log(isDailyQuota(err) ? "credentials OK — daily quota spent" : "credentials OK — rate limited");
      return true;
    }
    console.log("FAILED");
    console.log(`      ${diagnose(arm.provider, err)}`);
    return false;
  }
}

/**
 * Reports OpenAI's actual current limits from the x-ratelimit-* response
 * headers, rather than inferring them from an error string.
 *
 * Uses raw fetch because the SDK does not surface response headers on the
 * normal return path. Quota is per *organization*, so a freshly minted API key
 * inherits whatever the org has already spent — a detail worth showing plainly,
 * since rotating the key is the obvious wrong fix.
 */
async function reportOpenAiLimits(): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "سلام",
      response_format: "mp3",
    }),
  }).catch((err) => {
    console.log(`      could not reach the API: ${err}`);
    return null;
  });
  if (!response) return;

  const org = response.headers.get("openai-organization");
  const limit = response.headers.get("x-ratelimit-limit-requests");
  const remaining = response.headers.get("x-ratelimit-remaining-requests");
  const reset = response.headers.get("x-ratelimit-reset-requests");

  console.log(`      organization:      ${org ?? "unknown"}`);
  console.log(`      request limit:     ${limit ?? "not reported"}`);
  console.log(`      remaining:         ${remaining ?? "not reported"}`);
  console.log(`      resets in:         ${reset ?? "not reported"}`);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.log(`      status:            ${response.status} ${detail.slice(0, 200)}`);
  }

  const limitNumber = Number(limit);
  if (Number.isFinite(limitNumber) && limitNumber > 0 && limitNumber <= 50) {
    console.log(
      `\n      Still on the unpaid tier (limit ${limitNumber}). Attaching a card is not\n` +
        `      sufficient — OpenAI requires an actual prepaid credit purchase before the\n` +
        `      tier changes. Buy credits at https://platform.openai.com/settings/organization/billing\n` +
        `      Note also that quota is per organization, so a new API key does not reset it.`,
    );
  } else if (Number.isFinite(limitNumber) && limitNumber > 50) {
    console.log(`\n      Upgraded — limit is now ${limitNumber}, well above the unpaid cap of 50.`);
  }
}

async function main() {
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const hasAzure = Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);

  console.log("Configured in .env.local:");
  console.log(`  OPENAI_API_KEY       ${hasOpenAi ? "set" : "MISSING"}`);
  console.log(`  AZURE_SPEECH_KEY     ${process.env.AZURE_SPEECH_KEY ? "set" : "MISSING"}`);
  console.log(`  AZURE_SPEECH_REGION  ${process.env.AZURE_SPEECH_REGION || "MISSING"}`);

  if (!hasOpenAi && !hasAzure) {
    console.error("\nNothing to check. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  console.log("\nLive check (one short synthesis each):");
  const results: boolean[] = [];

  if (hasOpenAi) {
    results.push(
      await check("OpenAI gpt-4o-mini-tts", {
        id: "check-openai",
        provider: "openai",
        voice: "alloy",
        label: "check",
      }),
    );
    await reportOpenAiLimits();
  }
  if (hasAzure) {
    results.push(
      await check("Azure fa-IR-DilaraNeural", {
        id: "check-azure",
        provider: "azure",
        voice: "fa-IR-DilaraNeural",
        label: "check",
      }),
    );
  }

  const ok = results.every(Boolean);
  console.log(
    ok
      ? "\nAll configured providers reachable. Next: npm run spike:tts"
      : "\nFix the above, then re-run this check.",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
