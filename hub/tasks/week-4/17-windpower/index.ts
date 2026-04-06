/**
 * WindPower Task (S04E17)
 *
 * Schedule a wind turbine so the power plant can run:
 *  1. Protect blades during storms (wind > cutoff) → pitchAngle=90, mode=idle
 *  2. Enable production at the optimal safe-wind window  → pitchAngle=0|45, mode=production
 *
 * AI-FIRST: data analysis is delegated to an LLM call, not hardcoded rules.
 * Model: STEP_ANALYZE_MODEL → MODEL_OVERRIDE → default (haiku).
 *
 * Flow:
 *  → start  (MUST be first — API rejects all other actions after a timed-out session)
 *  → parallel: get documentation (direct) | get weather | get powerplantcheck | get turbinecheck
 *  → drain queue × 3
 *  → [AI] analyze docs + weather + powerplantcheck → config entries
 *  → sequential: unlockCodeGenerator + getResult (×N, safe pairing)
 *  → config (bulk)
 *  → done  (turbinecheck already collected — requirement satisfied)
 */

import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";
import { chat } from "../../shared/llm.js";

const TASK = "windpower";

// ── Types ─────────────────────────────────────────────────────────────────────

type ApiResponse = Record<string, unknown>;

interface ConfigEntry {
  startDate: string;  // "YYYY-MM-DD"
  startHour: string;  // "HH:00:00"
  pitchAngle: number;
  turbineMode: string;
  windMs: number;
}

// ── Hub helper ────────────────────────────────────────────────────────────────

async function callAction(answer: Record<string, unknown>): Promise<ApiResponse> {
  return (await hubVerify(TASK, answer)) as ApiResponse;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drain the async result queue until `count` results are collected.
 * getResult has no params — it pops the next ready item from the shared queue.
 * Only accepts responses that have a truthy `sourceFunction` field.
 */
async function drainQueue(count: number, maxWaitMs = 36_000, intervalMs = 400): Promise<ApiResponse[]> {
  const results: ApiResponse[] = [];
  const deadline = Date.now() + maxWaitMs;

  while (results.length < count && Date.now() < deadline) {
    const res = await callAction({ action: "getResult" });

    if (res.sourceFunction) {
      console.log(`[Queue] ✓ sourceFunction=${res.sourceFunction}`);
      results.push(res);
    } else {
      // Queue empty or still processing — wait and retry
      await delay(intervalMs);
    }
  }

  if (results.length < count) {
    throw new Error(`Queue drain timeout: got ${results.length}/${count} results`);
  }

  return results;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** "YYYY-MM-DD HH:00:00" — minutes and seconds always zero */
function normaliseDateTime(raw: string): string {
  const s = raw.trim().replace("T", " ").replace("Z", "");
  const [datePart = "", timePart = "00:00:00"] = s.split(" ");
  const hour = timePart.split(":")[0].padStart(2, "0");
  return `${datePart} ${hour}:00:00`;
}

function splitDateTime(dt: string): { startDate: string; startHour: string } {
  const [startDate, startHour] = dt.split(" ");
  return { startDate, startHour };
}

// ── AI analysis ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a wind turbine scheduling expert.

CRITICAL OUTPUT RULE: Your entire response must be ONLY a valid JSON array. The very first character must be [ and the very last must be ]. No explanation, no markdown, no text before or after.

Rules (verbatim from turbine documentation):
- Allowed pitchAngle values: 0, 45, 90 degrees ONLY.
- cutoffWindMs: 14 m/s — for ANY forecast hour where windMs >= 14: add pitchAngle=90, turbineMode="idle" (storm protection).
- Below 4 m/s the turbine cannot generate electricity.
- turbineMode "production" enables generation; turbineMode "idle" disables it.

Steps:
1. Scan every forecast entry. If windMs >= 14 → add a storm protection entry.
2. Pick ONE production slot: windMs >= 4 AND < 14, closest to 12 m/s. Use entire forecast (no time window given).
3. Do NOT add a production entry if that hour is already a protection entry.

Return this exact shape (replace values):
[{"datetime":"YYYY-MM-DD HH:00:00","pitchAngle":90,"turbineMode":"idle","windMs":25.0},{"datetime":"YYYY-MM-DD HH:00:00","pitchAngle":0,"turbineMode":"production","windMs":5.9}]`;

async function analyseWithAI(
  docs: ApiResponse,
  weatherData: ApiResponse,
  powerData: ApiResponse
): Promise<ConfigEntry[]> {
  const userContent = JSON.stringify(
    { documentation: docs, weather: weatherData, powerPlantCheck: powerData },
    null,
    2
  );

  console.log("[AI] Calling LLM for analysis...");
  const raw = await chat(
    [{ role: "user", content: userContent }],
    {
      system: SYSTEM_PROMPT,
      model: process.env.STEP_ANALYZE_MODEL || undefined,
    }
  );

  console.log("[AI] Raw response:", raw.slice(0, 600));

  let parsed: Array<{ datetime: string; pitchAngle: number; turbineMode: string; windMs: number }>;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Strip markdown fences or leading/trailing text, then extract the JSON array
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new SyntaxError(`No JSON array found in LLM response:\n${raw.slice(0, 400)}`);
    parsed = JSON.parse(match[0]);
  }

  return parsed.map((e) => {
    const dt = normaliseDateTime(e.datetime);
    const { startDate, startHour } = splitDateTime(dt);
    return {
      startDate,
      startHour,
      pitchAngle: e.pitchAngle,
      turbineMode: e.turbineMode,
      windMs: e.windMs,
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const t0 = Date.now();
  console.log("=== WindPower Task ===");
  console.log(`[Start] ${new Date().toISOString()}`);
  console.log(`[Model] analyze=${process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE ?? "default"}`);

  // ── Phase 1: Start session — MUST be the very first action ──────────────────
  console.log("\n[Phase 1] Starting service window...");
  const startRes = await callAction({ action: "start" });
  console.log(`[Phase 1] Session started. Timeout: ${startRes.sessionTimeout}s`);

  // ── Phase 2: Documentation + ALL 3 async jobs — all in parallel ──────────
  // documentation is returned directly (sync); weather/powerplantcheck/turbinecheck are queued.
  console.log("\n[Phase 2] Fetching docs + queuing weather/powerplantcheck/turbinecheck in parallel...");
  const [docs] = await Promise.all([
    callAction({ action: "get", param: "documentation" })
      .then((r) => { console.log("[Phase 2] documentation received"); return r; }),
    callAction({ action: "get", param: "weather" })
      .then(() => console.log("[Phase 2] weather queued")),
    callAction({ action: "get", param: "powerplantcheck" })
      .then(() => console.log("[Phase 2] powerplantcheck queued")),
    callAction({ action: "get", param: "turbinecheck" })
      .then(() => console.log("[Phase 2] turbinecheck queued")),
  ]);

  // ── Phase 3: Drain queue — collect all 3 results ──────────────────────────
  console.log("\n[Phase 3] Draining queue (3 results, up to 36s)...");
  const dataResults = await drainQueue(3);

  const weatherData = dataResults.find((r) =>
    String(r.sourceFunction ?? "").toLowerCase().includes("weather")
  ) ?? dataResults[0];
  const powerData = dataResults.find((r) =>
    String(r.sourceFunction ?? "").toLowerCase().includes("power") ||
    String(r.sourceFunction ?? "").toLowerCase().includes("plant")
  ) ?? dataResults[1];

  console.log("[Phase 3] Weather:", JSON.stringify(weatherData, null, 2));
  console.log("[Phase 3] Power:", JSON.stringify(powerData, null, 2));

  // ── Phase 4: AI analysis ──────────────────────────────────────────────────
  console.log("\n[Phase 4] AI analysis...");
  const rawEntries = await analyseWithAI(docs, weatherData, powerData);
  console.log("[Phase 4] Entries from AI:", JSON.stringify(rawEntries, null, 2));

  if (rawEntries.length === 0) {
    throw new Error("AI returned no config entries");
  }

  // ── Phase 5: Unlock codes — sequential for safe pairing ───────────────────
  console.log(`\n[Phase 5] Generating ${rawEntries.length} unlock codes (sequential)...`);
  const entriesWithCodes: Array<ConfigEntry & { unlockCode: string }> = [];

  for (const entry of rawEntries) {
    await callAction({
      action: "unlockCodeGenerator",
      startDate: entry.startDate,
      startHour: entry.startHour,
      windMs: entry.windMs,
      pitchAngle: entry.pitchAngle,
    });

    const [codeRes] = await drainQueue(1, 10_000);
    const unlockCode =
      String(
        codeRes.unlockCode ??
        codeRes.md5 ??
        codeRes.signature ??
        codeRes.result ??
        (codeRes.data as ApiResponse | undefined)?.unlockCode ??
        ""
      );

    if (!unlockCode) throw new Error(`No unlock code in: ${JSON.stringify(codeRes)}`);
    console.log(`[Phase 5] Code for ${entry.startDate} ${entry.startHour}: ${unlockCode}`);
    entriesWithCodes.push({ ...entry, unlockCode });
  }

  // ── Phase 6: Submit config ────────────────────────────────────────────────
  const configs: Record<string, { pitchAngle: number; turbineMode: string; unlockCode: string }> = {};
  for (const e of entriesWithCodes) {
    configs[`${e.startDate} ${e.startHour}`] = {
      pitchAngle: e.pitchAngle,
      turbineMode: e.turbineMode,
      unlockCode: e.unlockCode,
    };
  }

  console.log("\n[Phase 6] Submitting config...");
  console.log("[Phase 6] Payload:", JSON.stringify(configs, null, 2));
  const configRes = await callAction({ action: "config", configs });
  console.log("[Phase 6]", JSON.stringify(configRes, null, 2));

  // ── Phase 7: Done (turbinecheck was collected in Phase 3) ──────────────────
  console.log("\n[Phase 7] Calling done...");
  const doneRes = await callAction({ action: "done" });
  console.log("[Phase 7]", JSON.stringify(doneRes, null, 2));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[Elapsed] ${elapsed}s`);

  if (doneRes.code === 0) {
    console.log("\n✓ Task completed!");
    console.log("Flag:", doneRes.message ?? doneRes.flag);
  } else {
    console.warn("[Done] code:", doneRes.code, "|", doneRes.message);
  }
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
