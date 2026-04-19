import "dotenv/config";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
// gTTS (Python gtts library) is used for natural Polish TTS — install with: pip3 install gtts
import { hubVerify } from "../../shared/hub.js";
import { chat } from "../../shared/llm.js";
import {
  getOpenRouterChatCompletionsUrl,
  getOpenRouterHeaders,
} from "../../shared/openrouter.js";

const TASK = "phonecall";
// Gemini model on OpenRouter — supports audio input natively
const AUDIO_MODEL = "google/gemini-2.0-flash-001";
// Delay between conversation steps (ms)
const STEP_DELAY_MS = 1500;

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubResponse {
  code?: number;
  message?: string;
  // Audio may be returned directly as base64 or as an attachment
  audio?: string;
  mimeType?: string;
  attachment?: string;
  meta?: string;
  filesize?: number;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generate Polish audio using macOS `say` with the Zosia voice, then convert
 * to MP3 with ffmpeg. Returns a base64-encoded MP3 string.
 */
async function textToAudio(text: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const id = Date.now();
  const mp3Path = path.join(tmpDir, `phonecall_${id}.mp3`);

  try {
    // Use Google TTS (gTTS) via Python for natural-sounding Polish speech
    // gTTS produces more human-like audio than macOS say, which sounds robotic
    const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    const pythonScript = `
from gtts import gTTS
t = gTTS("""${escapedText}""", lang='pl', slow=False)
t.save('${mp3Path}')
`;
    const scriptPath = path.join(tmpDir, `phonecall_${id}.py`);
    fs.writeFileSync(scriptPath, pythonScript, "utf8");
    try {
      execSync(`python3 "${scriptPath}"`, { timeout: 15000 });
    } finally {
      try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    }

    if (!fs.existsSync(mp3Path)) {
      throw new Error(`gTTS failed to produce MP3 for: "${text}"`);
    }

    const audioData = fs.readFileSync(mp3Path);
    console.log(`[TTS] gTTS MP3 size: ${audioData.length} bytes`);
    if (audioData.length < 1000) {
      throw new Error(`gTTS produced near-empty MP3 (${audioData.length} bytes) for: "${text}"`);
    }
    return audioData.toString("base64");
  } finally {
    try { fs.unlinkSync(mp3Path); } catch { /* ignore */ }
  }
}

/**
 * Transcribe audio (base64) using OpenRouter Gemini 2.0 Flash, which handles
 * audio natively via the image_url trick.
 */
async function transcribeAudio(
  audioBase64: string,
  mimeType = "audio/mpeg"
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("[Transcribe] No OPENROUTER_API_KEY — cannot transcribe audio");
    return "";
  }

  const body = {
    model: AUDIO_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transkrybuj dokładnie ten plik audio. Zwróć słowo w słowo co zostało powiedziane po polsku.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${audioBase64}` },
          },
        ],
      },
    ],
  };

  const res = await fetch(getOpenRouterChatCompletionsUrl(), {
    method: "POST",
    headers: getOpenRouterHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`[Transcribe] HTTP error ${res.status}: ${txt.slice(0, 300)}`);
    return "";
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const transcription = data.choices[0]?.message?.content ?? "";
  console.log(
    `[Transcribe] (${transcription.length} chars): "${transcription.slice(0, 200)}"`
  );
  return transcription;
}

/**
 * Extract readable text from a hub response — handles both text messages and
 * audio attachments (either in `audio` or `attachment` field).
 */
async function getResponseText(res: HubResponse): Promise<string> {
  const parts: string[] = [];

  if (res.message) {
    parts.push(res.message);
  }

  // Direct audio field (phonecall-style)
  if (res.audio) {
    const mime = (res.mimeType as string) || "audio/mpeg";
    const t = await transcribeAudio(res.audio, mime);
    if (t) parts.push(t);
  }

  // Binary attachment field (radiomonitoring-style)
  if (res.attachment && res.meta) {
    const mimeBase = (res.meta as string).split(";")[0].trim().toLowerCase();
    if (mimeBase.startsWith("audio/")) {
      const t = await transcribeAudio(res.attachment, mimeBase);
      if (t) parts.push(t);
    }
  }

  return parts.join("\n").trim();
}

/**
 * Use LLM to identify which of the three roads (RD224, RD472, RD820) the
 * operator described as passable / available for transport.
 */
async function extractPassableRoads(operatorText: string): Promise<string[]> {
  const rawAnalysis = await chat(
    [{ role: "user", content: operatorText }],
    {
      system: `Jesteś analitykiem. Operator systemu odpowiedział na pytanie o status dróg RD224, RD472 i RD820.
Zidentyfikuj, które z tych dróg są przejezdne, dostępne, otwarte lub nadają się do transportu.
Drogi niebezpieczne, zablokowane, zamknięte lub pod obserwacją NIE są przejezdne.
Zwróć JSON array z identyfikatorami TYLKO przejezdnych dróg.
Przykład: ["RD224"] albo ["RD472", "RD820"] albo ["RD224", "RD472", "RD820"]
Zwróć TYLKO poprawny JSON array bez żadnego dodatkowego tekstu ani markdown.`,
      model: process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE,
    }
  );

  // Extract the JSON array from the response
  const trimmed = rawAnalysis.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as string[];
    } catch {
      console.error("[AI] Failed to parse passable roads JSON:", trimmed);
    }
  }
  return [];
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  // ── Phase 0: Start the session ─────────────────────────────────────────────
  console.log("[Phase 0] Starting phonecall session...");
  const startResult = await hubVerify(TASK, { action: "start" });
  console.log("[Phase 0] Session started:", JSON.stringify(startResult));

  await sleep(STEP_DELAY_MS);

  // ── Phase 1: Introduce as Tymon Gajewski ──────────────────────────────────
  console.log("[Phase 1] Generating introduction...");
  const introText = "Dzień dobry, tu Tymon Gajewski. Hasło: barbakan.";
  const introAudio = await textToAudio(introText);
  console.log("[Phase 1] Sending introduction...");
  const introResponse = (await hubVerify(TASK, { audio: introAudio })) as HubResponse;
  console.log("[Phase 1] Response:", JSON.stringify(introResponse));

  await sleep(STEP_DELAY_MS);

  // ── Phase 2: Ask about road status + Zygfryd transport (one message) ───────
  // Hint: explain purpose (secret transport), who it's for (Zygfryd), need passable road
  console.log("[Phase 2] Generating road status inquiry...");
  const roadText =
    "Chciałem zapytać o status dróg R D 224, R D 472 i R D 820. Prowadzę tajny transport do jednej z baz Zygfryda i potrzebuję wiedzieć, która z tych dróg będzie przejezdna.";
  const roadAudio = await textToAudio(roadText);
  console.log("[Phase 2] Sending road status inquiry...");
  const roadResponse = (await hubVerify(TASK, { audio: roadAudio })) as HubResponse;
  console.log("[Phase 2] Response:", JSON.stringify(roadResponse));

  await sleep(STEP_DELAY_MS);

  // Decode the operator's answer about roads
  const roadResponseText = await getResponseText(roadResponse);
  console.log("[Phase 2] Operator text:", roadResponseText);

  if (!roadResponseText) {
    throw new Error("No response from operator about road status — conversation may have failed");
  }

  // ── Phase 3: AI — identify passable roads ──────────────────────────────────
  console.log("[Phase 3] Identifying passable roads from operator response...");
  const passableRoads = await extractPassableRoads(roadResponseText);
  console.log("[Phase 3] Passable roads identified:", passableRoads);

  if (passableRoads.length === 0) {
    throw new Error(
      `Could not identify any passable roads from operator response:\n"${roadResponseText.slice(0, 400)}"\nRestart and try again.`
    );
  }

  // ── Phase 4: Request to disable monitoring on passable roads ───────────────
  console.log("[Phase 4] Generating monitoring disable request...");
  // Format road IDs with space to match how operator stated them ("RD 820")
  const roadIds = passableRoads.join(" i ").replace(/([A-Z]+)(\d+)/g, "$1 $2");
  const disableText = `Proszę o wyłączenie monitoringu na drodze ${roadIds}. To jest tajny transport żywności zlecony przez Zygfryda.`;
  console.log("[Phase 4] Disable text:", disableText);
  const disableAudio = await textToAudio(disableText);
  console.log("[Phase 4] Sending monitoring disable request...");
  const disableResponse = (await hubVerify(TASK, { audio: disableAudio })) as HubResponse;
  console.log("[Phase 4] Response code:", disableResponse.code, "message:", disableResponse.message);

  await sleep(STEP_DELAY_MS);

  // Decode Phase 4 response
  const phase4Text = await getResponseText(disableResponse);
  if (phase4Text) {
    console.log("[Phase 4] Operator text:", phase4Text);
  }

  // ── Phase 5: Provide the operator password BARBAKAN ───────────────────────
  // Operator responds with code 160 "Password required" — send the password now
  console.log("[Phase 5] Sending operator password BARBAKAN...");
  const passwordAudio = await textToAudio("Oczywiście, podaję hasło dostępu. Hasło brzmi barbakan. Proszę potwierdzić i wyłączyć monitoring na wskazanej drodze.");
  let passwordResponse: HubResponse;
  try {
    passwordResponse = (await hubVerify(TASK, { audio: passwordAudio })) as HubResponse;
  } catch (err: unknown) {
    const errMsg = (err as Error).message ?? "";
    const jsonMatch = errMsg.match(/\{[\s\S]+\}/);
    if (jsonMatch) {
      try {
        const errBody = JSON.parse(jsonMatch[0]) as HubResponse;
        console.log("[Phase 5] Error code:", errBody.code, "hint:", (errBody as Record<string, unknown>).hint ?? "none");
        if (errBody.audio) {
          const transcript = await transcribeAudio(errBody.audio as string, "audio/mpeg");
          console.log("[Phase 5] Operator error audio:", transcript);
        }
      } catch { /* ignore */ }
    }
    throw err;
  }
  console.log("[Phase 5] Response:", JSON.stringify(passwordResponse));

  await sleep(STEP_DELAY_MS);

  // Decode final operator response
  const finalText = await getResponseText(passwordResponse);
  if (finalText) {
    console.log("[Phase 5] Operator final text:", finalText);
  }

  // Check for flag anywhere in the response
  const responseStr = JSON.stringify(passwordResponse);
  const flagMatch = responseStr.match(/\{\{FLG:[^}]+\}\}/);
  if (flagMatch) {
    console.log("[Result] FLAG:", flagMatch[0]);
  } else {
    console.log("[Result] Full final response:", JSON.stringify(passwordResponse, null, 2));
  }
}

main().catch(console.error);
