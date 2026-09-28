import { pathToFileURL } from "node:url";
import path from "node:path";
import { runPrivateSyntheticVoice } from "../src/private-synthetic-voice.js";

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); }
  catch { throw new Error("invalid_private_synthetic_json"); }
}

export async function main(env = process.env) {
  const targets = parseJson(env.PRIVATE_SYNTHETIC_VOICE_TARGETS, []);
  const forbiddenNumbers = parseJson(env.PRIVATE_SYNTHETIC_FORBIDDEN_NUMBERS, []);
  const result = await runPrivateSyntheticVoice({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    callerId: env.PRIVATE_SYNTHETIC_CALLER_ID,
    targets,
    forbiddenNumbers,
    armed: String(env.PRIVATE_SYNTHETIC_VOICE_ARMED || "").toLowerCase() === "true",
    dryRun: String(env.PRIVATE_SYNTHETIC_VOICE_DRY_RUN || "true").toLowerCase() !== "false",
  });
  console.log(JSON.stringify({ event: "private_synthetic_voice", ...result }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      event: "private_synthetic_voice",
      ok: false,
      error: String(error?.message || "private_synthetic_voice_failed"),
    }));
    process.exitCode = 1;
  });
}
