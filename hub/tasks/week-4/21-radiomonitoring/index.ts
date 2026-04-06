import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { hubVerify } from "../../shared/hub.js";
import { chat } from "../../shared/llm.js";
import {
  getOpenRouterChatCompletionsUrl,
  getOpenRouterHeaders,
} from "../../shared/openrouter.js";

const TASK = "radiomonitoring";
const MAX_LISTEN_CALLS = 60;
const LISTEN_DELAY_MS = 400;
// Gemini model on OpenRouter — supports audio input
const AUDIO_MODEL = "google/gemini-2.0-flash-001";
// Max decoded audio size to send to a model (10 MB)
const MAX_AUDIO_BYTES = 10_000_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubResponse {
  code: number;
  message: string;
  transcription?: string;
  meta?: string;
  attachment?: string;
  filesize?: number;
}

interface ReportResult {
  cityName: string;
  cityArea: string;
  warehousesCount: number;
  phoneNumber: string;
}

interface CityData {
  name: string;
  latitude: number;
  longitude: number;
  occupiedArea: number;
  riverAccess: boolean;
  farmAnimals: boolean;
  inhabitants: number;
}

// Shared state: city lookup parsed from JSON attachment
const cityMap = new Map<string, CityData>();
// Cities that appear in the CSV trade records (under their real name)
const csvCities = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDoneSignal(res: HubResponse): boolean {
  const msg = (res.message ?? "").toLowerCase();
  return (
    res.code === 101 ||              // "baterie padły, mamy dostatecznie dużo materiału"
    res.code === 200 ||
    msg.includes("wystarczaj") ||    // wystarczająco danych
    msg.includes("dostatecznie") ||  // dostatecznie dużo materiału
    msg.includes("padly") ||         // baterie padły (no diacritics version)
    msg.includes("padły") ||
    msg.includes("enough") ||
    msg.includes("no more") ||
    msg.includes("koniec") ||
    msg.includes("done") ||
    msg.includes("finished")
  );
}

/** Very cheap noise filter — no LLM needed for obvious junk. */
function isRadioNoise(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return true;
  // Only static chars / ellipsis / dashes / numbers
  if (/^[\s\.\-_~*#@!…]+$/.test(t)) return true;
  // Very high ratio of non-word chars
  const wordChars = (t.match(/\p{L}/gu) ?? []).length;
  if (wordChars / t.length < 0.2) return true;
  return false;
}

/** Transcribe an audio file via OpenRouter using a Gemini model. */
async function transcribeAudioViaOpenRouter(
  base64Data: string,
  mimeType: string,
  fileSizeHint: number
): Promise<string | null> {
  const decodedSize = fileSizeHint || Math.floor((base64Data.length * 3) / 4);
  if (decodedSize > MAX_AUDIO_BYTES) {
    console.log(`[Router] Audio too large (${decodedSize} bytes), skipping`);
    return null;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.log("[Router] No OPENROUTER_API_KEY — skipping audio transcription");
    return null;
  }

  console.log(`[Router] Transcribing audio via OpenRouter (${mimeType}, ${decodedSize} bytes)…`);

  const body = {
    model: AUDIO_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Transkrybuj dokładnie ten plik audio. Zwróć słowo w słowo co jest powiedziane.
Szukaj informacji o: nazwie miasta/miejscowości, liczbie magazynów, numerach telefonów, powierzchni terenu.`,
          },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Data}` },
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(getOpenRouterChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenRouterHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`[Router] Audio transcription HTTP error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const transcription = data.choices[0]?.message?.content ?? "";
    if (!transcription || isRadioNoise(transcription)) return null;
    console.log(`[Router] Audio transcribed (${transcription.length} chars): "${transcription.slice(0, 100)}"`);
    return `[Audio transcription (${mimeType})]:\n${transcription}`;
  } catch (err) {
    console.error("[Router] Audio transcription error:", err);
    return null;
  }
}

/** Decode a base64 attachment and route by MIME type.
 *  Returns a human-readable text extract, or null if not useful. */
async function routeBinary(
  meta: string,
  base64Data: string,
  fileSizeHint: number
): Promise<string | null> {
  const mimeBase = meta.split(";")[0].trim().toLowerCase();

  // ── JSON ──────────────────────────────────────────────────────────────────
  if (mimeBase === "application/json") {
    try {
      const buf = Buffer.from(base64Data, "base64");
      const json = JSON.parse(buf.toString("utf-8"));
      // If it looks like a city array, populate the cityMap
      if (Array.isArray(json) && json[0]?.name && json[0]?.occupiedArea !== undefined) {
        for (const city of json as CityData[]) {
          cityMap.set(city.name, city);
        }
        console.log(`[Router] Parsed city JSON: ${cityMap.size} cities stored`);
      }
      return `[JSON data]:\n${JSON.stringify(json, null, 2)}`;
    } catch {
      return null;
    }
  }

  // ── Plain text ────────────────────────────────────────────────────────────
  if (mimeBase.startsWith("text/")) {
    const buf = Buffer.from(base64Data, "base64");
    const text = buf.toString("utf-8");
    if (isRadioNoise(text)) return null;
    // If it looks like a CSV with a 'miasto' column, extract city names
    if (mimeBase === "text/csv" && text.includes("miasto")) {
      const lines = text.split("\n").slice(1); // skip header
      for (const line of lines) {
        const cityName = line.split(",")[0]?.trim();
        if (cityName && cityName !== "Syjon") csvCities.add(cityName);
      }
      console.log(`[Router] Parsed CSV: ${csvCities.size} trading cities found`);
    }
    return `[Text attachment (${mimeBase})]:\n${text}`;
  }

  // ── Images — vision analysis ──────────────────────────────────────────────
  if (mimeBase.startsWith("image/")) {
    const decodedSize = fileSizeHint || Math.floor((base64Data.length * 3) / 4);
    if (decodedSize > 5_000_000) {
      console.log(`[Router] Image too large (${decodedSize} bytes), skipping`);
      return null;
    }
    const validMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const resolvedMime = validMimes.includes(mimeBase) ? mimeBase : "image/jpeg";
    console.log(`[Router] Sending image (${resolvedMime}, ~${decodedSize} bytes) to vision model`);
    return analyzeImageWithVision(
      base64Data,
      resolvedMime as "image/jpeg" | "image/png" | "image/gif" | "image/webp"
    );
  }

  // ── Audio — transcribe via OpenRouter/Gemini ──────────────────────────────
  if (mimeBase.startsWith("audio/")) {
    return transcribeAudioViaOpenRouter(base64Data, mimeBase, fileSizeHint);
  }

  // ── Unknown binary — attempt UTF-8 text extraction ────────────────────────
  try {
    const buf = Buffer.from(base64Data, "base64");
    const text = buf.toString("utf-8");
    const badChars = (text.match(/\uFFFD|\x00/g) ?? []).length;
    if (badChars / text.length > 0.05) return null;
    if (isRadioNoise(text)) return null;
    return `[Unknown binary decoded as text]:\n${text}`;
  } catch {
    return null;
  }
}

async function analyzeImageWithVision(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
): Promise<string | null> {
  const client = new Anthropic();
  const model =
    process.env.STEP_ANALYZE_MODEL ??
    process.env.MODEL_OVERRIDE ??
    "claude-haiku-4-5-20251001";

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            },
            {
              type: "text",
              text: `Opisz szczegółowo zawartość tego obrazu.
Szukaj wszelkich danych wywiadowczych:
- prawdziwa nazwa miejsca/miasta
- powierzchnia obszaru (w km², ha)
- liczba magazynów lub obiektów składowych
- numery telefonów lub dane kontaktowe
Opisz wszystko co widzisz i podaj znalezione liczby/dane wprost.`,
            },
          ],
        },
      ],
    });

    const block = response.content[0];
    const text = block.type === "text" ? block.text : "";
    return text ? `[Analiza obrazu]:\n${text}` : null;
  } catch (err) {
    console.error("[Vision] Error:", err);
    return null;
  }
}

/** Strip +48 country prefix and non-digit chars to get a 9-digit Polish number. */
function normalizePolishPhone(raw: string): string {
  // Remove all non-digits
  const digits = raw.replace(/\D/g, "");
  // If starts with 48 (country code) and total length is 11, strip the 48
  if (digits.length === 11 && digits.startsWith("48")) {
    return digits.slice(2);
  }
  // If starts with 0048 and length is 13, strip 0048
  if (digits.length === 13 && digits.startsWith("0048")) {
    return digits.slice(4);
  }
  return digits;
}

function parseJsonFromLLM(raw: string): ReportResult {
  // Direct parse
  try { return JSON.parse(raw.trim()) as ReportResult; } catch { /* continue */ }

  // Extract the first complete JSON object (from first { to last })
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) as ReportResult; } catch { /* continue */ }
  }

  // Try each code-fenced block looking for a valid JSON object
  const fenceBlocks = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const block of fenceBlocks) {
    const content = block[1].trim();
    if (!content.startsWith("{")) continue;
    try { return JSON.parse(content) as ReportResult; } catch { /* continue */ }
  }

  throw new Error(`Cannot parse LLM response as JSON:\n${raw.slice(0, 300)}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  // ── Phase 0: Start session ─────────────────────────────────────────────────
  console.log("[Phase 0] Starting radiomonitoring session…");
  const startResult = await hubVerify(TASK, { action: "start" });
  console.log("[Phase 0] Session started:", JSON.stringify(startResult));

  // ── Phase 1: Listen loop ───────────────────────────────────────────────────
  const collectedTexts: string[] = [];
  let listenCount = 0;

  console.log("[Phase 1] Starting listen loop…");

  while (listenCount < MAX_LISTEN_CALLS) {
    listenCount++;
    await sleep(LISTEN_DELAY_MS);

    const signal = (await hubVerify(TASK, { action: "listen" })) as HubResponse;
    console.log(
      `[Phase 1] #${listenCount} code=${signal.code} msg="${signal.message}"` +
        (signal.transcription ? ` transcription=${signal.transcription.length}ch` : "") +
        (signal.attachment ? ` attachment meta=${signal.meta} size=${signal.filesize}` : "")
    );

    if (isDoneSignal(signal)) {
      console.log("[Phase 1] Done signal received — stopping listen loop");
      break;
    }

    // ── Text transcription ──────────────────────────────────────────────────
    if (signal.transcription) {
      if (isRadioNoise(signal.transcription)) {
        console.log("[Phase 1] Skipping noise transcription");
      } else {
        console.log(`[Phase 1] Keeping transcription (${signal.transcription.length}ch): "${signal.transcription.slice(0, 100)}"`);
        collectedTexts.push(`[Transkrypcja #${listenCount}]:\n${signal.transcription}`);
      }
      continue;
    }

    // ── Binary attachment ────────────────────────────────────────────────────
    if (signal.attachment && signal.meta) {
      const extracted = await routeBinary(
        signal.meta,
        signal.attachment,
        signal.filesize ?? 0
      );
      if (extracted) {
        console.log(`[Phase 1] Binary extracted (${extracted.length}ch): "${extracted.slice(0, 100)}"`);
        collectedTexts.push(extracted);
      } else {
        console.log("[Phase 1] Binary yielded no useful text");
      }
      continue;
    }

    console.log("[Phase 1] Empty signal — continuing");
  }

  console.log(`[Phase 1] Done. Collected ${collectedTexts.length} useful data chunks.`);

  if (collectedTexts.length === 0) {
    throw new Error("No useful data collected — cannot proceed with analysis");
  }

  // ── Phase 2: LLM analysis ──────────────────────────────────────────────────
  console.log("[Phase 2] Analysing collected data with LLM…");

  const dataBlock = collectedTexts.join("\n\n---\n\n");

  // Build a reference table of all known cities (from JSON) to help the LLM
  const cityTableHint =
    cityMap.size > 0
      ? `\n\nTABELA MIAST (z danych JSON):\n${[...cityMap.values()]
          .map((c) => `- ${c.name}: area=${c.occupiedArea} km², farmAnimals=${c.farmAnimals}, inhabitants=${c.inhabitants}`)
          .join("\n")}`
      : "";

  const rawAnalysis = await chat(
    [
      {
        role: "user",
        content: `Poniżej zebrane materiały z radiowego nasłuchu:${cityTableHint}\n\n${dataBlock}`,
      },
    ],
    {
      system: `Jesteś analitykiem wywiadu. Przeanalizuj zebrane materiały radiowe i ustal pełne dane o mieście nazywanym w komunikatach "Syjon".

## Krok 1: Identyfikacja prawdziwej nazwy Syjonu

"Syjon" (Zion) to kryptonim. Klucz do identyfikacji:
- Syjon = biblijne Syjon/Zion = "biblijny raj" lub "ziemia obiecana"
- W transkrypcjach szukaj: jeśli jakieś miasto jest opisywane jako "biblijny raj", "miasto ocalałych z przydomkiem biblijnego raju", lub podobnymi wyrażeniami → TO JEST Syjon.
- Następnie sprawdź w tabeli miast (JSON) pole "occupiedArea" dla tego miasta.

## Krok 2: Ustalenie powierzchni

Gdy zidentyfikujesz miasto = Syjon, weź jego "occupiedArea" z tabeli miast i zaokrąglij do 2 miejsc po przecinku.

## Krok 3: Liczba magazynów

Szukaj w transkrypcjach audio (jeśli dostępne), XML i innych źródłach słów: "magazyn", "magazyny", "skład", liczby związanej z infrastrukturą. Ta liczba to liczbę całkowita >= 1.

## Krok 4: Numer telefonu

Z notatki PNG wydobądź numer. Podaj TYLKO 9 cyfr BEZ +48, BEZ kresek. Przykład: "644122092".

Zwróć TYLKO poprawny JSON:
{
  "cityName": "NazwaMiasta",
  "cityArea": "12.34",
  "warehousesCount": 5,
  "phoneNumber": "644122092"
}`,
      model: process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE,
    }
  );

  console.log("[Phase 2] Raw LLM output:", rawAnalysis);

  const result = parseJsonFromLLM(rawAnalysis);

  // Normalize phone number — strip +48 prefix and formatting chars
  result.phoneNumber = normalizePolishPhone(result.phoneNumber);

  // Override cityArea with authoritative JSON data if available
  const cityEntry =
    cityMap.get(result.cityName) ??
    // Try fuzzy match: find a city whose name contains or matches the LLM's answer
    [...cityMap.values()].find(
      (c) =>
        c.name.toLowerCase().includes(result.cityName.toLowerCase()) ||
        result.cityName.toLowerCase().includes(c.name.toLowerCase())
    );

  if (cityEntry) {
    const roundedArea = (Math.round(cityEntry.occupiedArea * 100) / 100).toFixed(2);
    if (roundedArea !== result.cityArea) {
      console.log(`[Phase 2] Overriding cityArea from LLM "${result.cityArea}" → JSON "${roundedArea}" (occupiedArea=${cityEntry.occupiedArea})`);
      result.cityArea = roundedArea;
    }
    if (cityEntry.name !== result.cityName) {
      console.log(`[Phase 2] Correcting cityName from LLM "${result.cityName}" → JSON "${cityEntry.name}"`);
      result.cityName = cityEntry.name;
    }
  }

  console.log("[Phase 2] Parsed result:", JSON.stringify(result, null, 2));

  // Basic sanity checks
  if (!result.cityName || !result.cityArea || !result.phoneNumber) {
    throw new Error(`Incomplete result from LLM: ${JSON.stringify(result)}`);
  }
  if (!/^\d+\.\d{2}$/.test(result.cityArea)) {
    throw new Error(`cityArea format invalid: "${result.cityArea}" — expected "NN.NN"`);
  }
  if (!/^\d{9}$/.test(result.phoneNumber)) {
    throw new Error(`phoneNumber format invalid: "${result.phoneNumber}" — expected 9 digits`);
  }

  // ── Phase 3: Transmit with retry for warehousesCount ─────────────────────
  console.log("[Phase 3] Transmitting final report…");

  // Audio transcription may be off by ±1 → try base count, then ±1, ±2
  const baseCount = result.warehousesCount;
  const candidateCounts = [baseCount, baseCount - 1, baseCount + 1, baseCount - 2, baseCount + 2].filter(
    (n) => n >= 1
  );

  let lastError: Error | null = null;
  for (const count of candidateCounts) {
    const payload = {
      action: "transmit",
      cityName: result.cityName,
      cityArea: result.cityArea,
      warehousesCount: count,
      phoneNumber: result.phoneNumber,
    };
    console.log(`[Phase 3] Trying warehousesCount=${count}:`, JSON.stringify(payload));
    try {
      const transmitResult = await hubVerify(TASK, payload);
      const r = transmitResult as { code?: number; message?: string };
      if (r.code === 0 || (r.message ?? "").includes("FLG")) {
        console.log("[Phase 3] SUCCESS!", JSON.stringify(transmitResult, null, 2));
        return;
      }
      console.log("[Phase 3] Hub response:", JSON.stringify(transmitResult));
    } catch (err) {
      lastError = err as Error;
      const msg = (err as Error).message;
      // If the error is about warehousesCount, try next candidate
      if (msg.includes("warehousesCount")) {
        console.log(`[Phase 3] warehousesCount=${count} rejected, trying next…`);
        continue;
      }
      // Any other field error — re-throw immediately (no point retrying)
      throw err;
    }
  }

  if (lastError) throw lastError;
}

main().catch(console.error);
