import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";
import { chat } from "../../shared/llm.js";

const TASK = "timetravel";
const POLL_INTERVAL_MS = 3000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Sync Ratio calculation (from CHRONOS-P1 documentation)
// Formula: (day×8 + month×12 + year×7) mod 101, expressed as 0.00–1.00
// ---------------------------------------------------------------------------
function calcSyncRatio(year: number, month: number, day: number): number {
  const raw = (day * 8 + month * 12 + year * 7) % 101;
  return Math.round(raw) / 100;
}

// ---------------------------------------------------------------------------
// PWR protection levels from CHRONOS-P1 documentation table
// Full year→PWR mapping for 1500–2499; only key years embedded here
// ---------------------------------------------------------------------------
const PWR_TABLE: Record<number, number> = {
  // 2000s
  2000: 13, 2001: 12, 2002: 17, 2003: 13, 2004: 15, 2005: 14, 2006: 17, 2007: 12, 2008: 12, 2009: 13,
  2010: 12, 2011: 17, 2012: 15, 2013: 14, 2014: 13, 2015: 16, 2016: 15, 2017: 14, 2018: 17, 2019: 14,
  2020: 19, 2021: 18, 2022: 18, 2023: 18, 2024: 19, 2025: 18, 2026: 28, 2027: 31, 2028: 35, 2029: 28,
  // 2230s
  2230: 86, 2231: 92, 2232: 93, 2233: 88, 2234: 86, 2235: 84, 2236: 89, 2237: 91, 2238: 91, 2239: 88,
};

function getPwr(year: number): number {
  if (PWR_TABLE[year] !== undefined) return PWR_TABLE[year];
  // Fallback approximation by range (for years not in the embedded table)
  if (year < 2000) return 5;
  if (year <= 2150) return 20;
  if (year <= 2300) return 85;
  return 92;
}

// ---------------------------------------------------------------------------
// Required internalMode for each year range (from documentation)
// Mode 1: <2000 | Mode 2: 2000–2150 | Mode 3: 2151–2300 | Mode 4: 2301+
// ---------------------------------------------------------------------------
function requiredMode(year: number): 1 | 2 | 3 | 4 {
  if (year < 2000) return 1;
  if (year <= 2150) return 2;
  if (year <= 2300) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Jump configurations (pre-calculated from documentation)
// ---------------------------------------------------------------------------

interface JumpConfig {
  label: string;
  day: number;
  month: number;
  year: number;
  syncRatio: number;
  pwr: number;
  mode: 1 | 2 | 3 | 4;
  ptA: boolean;  // backward travel
  ptB: boolean;  // forward travel
  tunnel: boolean;
  description: string;
}

// Today's date per task context: 2026-04-10
const JUMPS: JumpConfig[] = [
  {
    label: "JUMP 1 — Forward to 5 Nov 2238 (collect batteries)",
    day: 5, month: 11, year: 2238,
    syncRatio: calcSyncRatio(2238, 11, 5),  // = 0.82
    pwr: getPwr(2238),                       // = 91
    mode: requiredMode(2238),                // = 3
    ptA: false, ptB: true,                   // forward jump only
    tunnel: false,
    description: "Single jump forward to 2238 to pick up battery pack.",
  },
  {
    label: "JUMP 2 — Return to 10 Apr 2026 (back to present)",
    day: 10, month: 4, year: 2026,
    syncRatio: calcSyncRatio(2026, 4, 10),  // = 0.69
    pwr: getPwr(2026),                       // = 28
    mode: requiredMode(2026),                // = 2
    ptA: true, ptB: false,                   // backward jump only
    tunnel: false,
    description: "Jump back to today (10 Apr 2026) with fresh batteries.",
  },
  {
    label: "JUMP 3 — Open TIME TUNNEL to 12 Nov 2024 (meet Rafał)",
    day: 12, month: 11, year: 2024,
    syncRatio: calcSyncRatio(2024, 11, 12), // = 0.54
    pwr: getPwr(2024),                       // = 19
    mode: requiredMode(2024),                // = 2
    ptA: true, ptB: true,                    // BOTH = time tunnel
    tunnel: true,
    description: "Open a time tunnel to 12 Nov 2024. Needs PT-A + PT-B and ≥60% battery.",
  },
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiAction(action: string, extra?: Record<string, unknown>): Promise<unknown> {
  const answer: Record<string, unknown> = { action, ...extra };
  return await hubVerify(TASK, answer);
}

async function apiConfigure(param: string, value: unknown): Promise<unknown> {
  const answer = { action: "configure", param, value };
  return await hubVerify(TASK, answer);
}

async function apiGetConfig(): Promise<unknown> {
  return await apiAction("getConfig");
}

async function apiReset(): Promise<unknown> {
  return await apiAction("reset");
}

async function apiHelp(): Promise<unknown> {
  return await apiAction("help");
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

const LLM_MODEL = () => process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE;

// Extract stabilization value from API response (hint provided by device after date is set)
async function extractStabilizationHint(apiResponse: unknown): Promise<number | null> {
  const text = JSON.stringify(apiResponse, null, 2);
  console.log(`[AI] Extracting stabilization hint from: ${text.slice(0, 300)}`);

  const response = await chat(
    [
      {
        role: "user",
        content: `Time machine API response after setting the target date:
${text}

The device should include a recommended stabilization value in its response.
Extract the numeric stabilization value from any hint, message, note, or field.
Return ONLY valid JSON: {"stabilization": <number>} or {"stabilization": null} if no hint found.
Return ONLY JSON, no markdown fences.`,
      },
    ],
    {
      system:
        "You extract the recommended stabilization parameter from a time machine API response. Return minimal JSON.",
      model: LLM_MODEL(),
    }
  );

  const match = response.match(/\{[\s\S]*?\}/);
  if (!match) {
    console.log("[AI] No JSON found in response");
    return null;
  }
  try {
    const parsed = JSON.parse(match[0]) as { stabilization: number | null };
    console.log(`[AI] Stabilization hint: ${parsed.stabilization}`);
    return parsed.stabilization;
  } catch {
    console.log("[AI] Failed to parse JSON");
    return null;
  }
}

// Parse current device state from getConfig response
// Real API uses nested "config" object with "mode" (not "state") for standby/active
interface DeviceState {
  mode?: string;         // "standby" | "active"
  internalMode?: number;
  fluxDensity?: number;  // 0–100
  batteryStatus?: string; // e.g. "1/3", "3/3"
  condition?: string;    // "unstable" | "stable" | "excellent"
  year?: number;
  month?: number;
  day?: number;
  syncRatio?: number;
  stabilization?: number;
  raw?: string;
}

function parseDeviceState(configResponse: unknown): DeviceState {
  const text = JSON.stringify(configResponse);
  const state: DeviceState = { raw: text };

  const extract = (pattern: RegExp): string | undefined => text.match(pattern)?.[1];

  // API field: config.mode = "standby" | "active"
  const modeStr = extract(/"mode"\s*:\s*"([^"]+)"/);
  if (modeStr) state.mode = modeStr.toLowerCase();

  const modeVal = extract(/"internalMode"\s*:\s*(\d+)/);
  if (modeVal) state.internalMode = parseInt(modeVal);

  const fluxVal = extract(/"fluxDensity"\s*:\s*(\d+(?:\.\d+)?)/);
  if (fluxVal) state.fluxDensity = parseFloat(fluxVal);

  const battVal = extract(/"batteryStatus"\s*:\s*"([^"]+)"/);
  if (battVal) state.batteryStatus = battVal;

  const condVal = extract(/"condition"\s*:\s*"([^"]+)"/);
  if (condVal) state.condition = condVal;

  const yearVal = extract(/"year"\s*:\s*(\d+)/);
  if (yearVal) state.year = parseInt(yearVal);

  const monthVal = extract(/"month"\s*:\s*(\d+)/);
  if (monthVal) state.month = parseInt(monthVal);

  const dayVal = extract(/"day"\s*:\s*(\d+)/);
  if (dayVal) state.day = parseInt(dayVal);

  const syncVal = extract(/"syncRatio"\s*:\s*(\d+(?:\.\d+)?)/);
  if (syncVal) state.syncRatio = parseFloat(syncVal);

  const stabVal = extract(/"stabilization"\s*:\s*(\d+)/);
  if (stabVal) state.stabilization = parseInt(stabVal);

  return state;
}

// Extract flag from any API response
function extractFlag(response: unknown): string | null {
  const text = JSON.stringify(response);
  const match =
    text.match(/\{FLG:[^}]+\}/) ??
    text.match(/\{\{FLG:[^}]*\}\}/) ??
    text.match(/"flag"\s*:\s*"([^"]+)"/);
  if (match) return match[0];
  if (
    text.toLowerCase().includes("gratulacje") ||
    text.toLowerCase().includes("congratulations") ||
    text.toLowerCase().includes("flg:")
  ) {
    return text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

async function waitForStandby(maxWaitMs = 120_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const resp = await apiGetConfig();
    const ds = parseDeviceState(resp);
    // API uses "mode" field: "standby" | "active"
    if (!ds.mode || ds.mode === "standby") {
      console.log("[Poll] Device is in standby — ready for configuration.");
      return;
    }
    console.log(`[Poll] Device mode: ${ds.mode} — waiting for standby...`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Timeout waiting for device standby");
}

async function waitForInternalMode(
  required: number,
  maxWaitMs = 120_000
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let lastMode = -1;
  console.log(`[Poll] Waiting for internalMode=${required} — device cycles automatically every few seconds...`);
  while (Date.now() < deadline) {
    const resp = await apiGetConfig();
    const ds = parseDeviceState(resp);
    const current = ds.internalMode;
    if (current === required) {
      console.log(`\n✅ [InternalMode] Mode ${required} active — correct for target year!`);
      return;
    }
    if (current !== lastMode) {
      console.log(`[Poll] internalMode=${current ?? "?"} (need ${required})`);
      lastMode = current ?? -1;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timeout waiting for internalMode ${required}`);
}

async function waitForJumpComplete(maxWaitMs = 900_000): Promise<{ flag: string | null; finalState: DeviceState }> {
  const deadline = Date.now() + maxWaitMs;
  let wasActive = false;
  let lastFlux = -1;
  let lastMode = -1;
  let lastCondition = "";
  let lastDeviceMode = "";
  let reminderTick = 0;

  while (Date.now() < deadline) {
    const resp = await apiGetConfig();
    const flag = extractFlag(resp);
    if (flag) {
      console.log(`\n🏁 [Flag] Received! ${flag}`);
      return { flag, finalState: parseDeviceState(resp) };
    }

    const ds = parseDeviceState(resp);
    const flux = ds.fluxDensity ?? 0;
    const mode = ds.internalMode ?? 0;
    const condition = ds.condition ?? "";
    const deviceMode = ds.mode ?? "";

    // Only log when something meaningful changes
    const changed = flux !== lastFlux || mode !== lastMode || condition !== lastCondition || deviceMode !== lastDeviceMode;
    if (changed) {
      console.log(
        `[Poll] mode=${deviceMode}, flux=${flux}%, condition=${condition}, internalMode=${mode}, battery=${ds.batteryStatus ?? "?"}`
      );
      lastFlux = flux; lastMode = mode; lastCondition = condition; lastDeviceMode = deviceMode;
    }

    // Bold alert when flux hits 100%
    if (flux === 100 && condition === "excellent" && !wasActive) {
      console.log("\n⚡⚡⚡ FLUX DENSITY = 100% — DEVICE READY! CLICK THE SPHERE NOW! ⚡⚡⚡\n");
    }

    if (deviceMode === "active") {
      if (!wasActive) {
        console.log("[Poll] Device is ACTIVE — jump in progress...");
        wasActive = true;
      }
    } else if (wasActive && deviceMode === "standby") {
      console.log(`[Poll] Device returned to standby — jump complete! Battery: ${ds.batteryStatus ?? "?"}`);
      return { flag: null, finalState: ds };
    } else if (!wasActive) {
      // Periodic reminder every ~30 seconds
      reminderTick++;
      if (reminderTick % 10 === 0) {
        console.log(`\n⏳ Still waiting for manual web UI action — flux=${flux}%, condition=${condition}`);
        console.log(`   → Open: ${process.env.HUB_BASE_URL}/timetravel_preview`);
        console.log(`   → Make sure PWR, PT-A/PT-B are set correctly, then switch to ACTIVE and click sphere\n`);
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Timeout waiting for jump completion");
}

// ---------------------------------------------------------------------------
// Phase printer — tells the user exactly what to do in the web UI
// ---------------------------------------------------------------------------

function printManualInstructions(jump: JumpConfig, stabilization: number | null): void {
  const bar = "─".repeat(62);
  console.log(`\n${bar}`);
  console.log(`📋 MANUAL STEPS REQUIRED IN WEB UI`);
  console.log(`   ${process.env.HUB_BASE_URL}/timetravel_preview`);
  console.log(bar);
  console.log(`1. Set PWR (protection slider) to: ${jump.pwr}`);
  console.log(
    `2. PT-A (backward travel): ${jump.ptA ? "✅ ENABLE" : "❌ DISABLE"}`
  );
  console.log(
    `3. PT-B (forward travel):  ${jump.ptB ? "✅ ENABLE" : "❌ DISABLE"}`
  );
  if (jump.tunnel) {
    console.log(`   ⚠️  TIME TUNNEL MODE: Both PT-A and PT-B must be active!`);
    console.log(`   ⚠️  Battery must be ≥60% before activating!`);
  }
  console.log(`4. Switch device from STANDBY → ACTIVE`);
  console.log(`5. Wait for internalMode ${jump.mode} (auto-cycles every few seconds)`);
  console.log(`6. When flux density = 100% and status is "excellent" — click the sphere`);
  console.log(bar);
  console.log(`\nAPI already configured:`);
  console.log(`  year=${jump.year}, month=${jump.month}, day=${jump.day}`);
  console.log(
    `  syncRatio=${jump.syncRatio.toFixed(2)}, stabilization=${stabilization ?? "(hint not parsed — set per device hint)"}`
  );
  console.log(`  Required internalMode: ${jump.mode}`);
  console.log(`${bar}\n`);
}

// ---------------------------------------------------------------------------
// Execute single jump phase
// ---------------------------------------------------------------------------

async function executeJump(jump: JumpConfig): Promise<string | null> {
  const separator = "═".repeat(62);
  console.log(`\n${separator}`);
  console.log(`  ${jump.label}`);
  console.log(`  ${jump.description}`);
  console.log(`${separator}`);
  console.log(`[Calc] SyncRatio: (${jump.day}×8 + ${jump.month}×12 + ${jump.year}×7) mod 101 / 100`);
  console.log(
    `[Calc] = (${jump.day * 8} + ${jump.month * 12} + ${jump.year * 7}) mod 101 / 100`
  );
  const raw = (jump.day * 8 + jump.month * 12 + jump.year * 7) % 101;
  console.log(`[Calc] = ${raw} → syncRatio = ${jump.syncRatio.toFixed(2)}`);
  console.log(`[Calc] PWR for year ${jump.year}: ${jump.pwr}`);
  console.log(`[Calc] Required internalMode: ${jump.mode}`);

  // Step 1: Ensure device is in standby
  console.log("\n[Step 1] Waiting for device standby mode...");
  await waitForStandby();

  // Step 2: Configure date via API
  console.log(`\n[Step 2] Configuring date: ${jump.day}/${jump.month}/${jump.year}`);
  await apiConfigure("year", jump.year);
  console.log(`  ✓ year=${jump.year}`);
  await sleep(500);

  await apiConfigure("month", jump.month);
  console.log(`  ✓ month=${jump.month}`);
  await sleep(500);

  const dayResp = await apiConfigure("day", jump.day);
  console.log(`  ✓ day=${jump.day}`);
  console.log(`  API response: ${JSON.stringify(dayResp).slice(0, 200)}`);
  await sleep(500);

  // Step 3: Get stabilization hint from device
  console.log("\n[Step 3] Fetching stabilization hint from device...");
  const configResp = await apiGetConfig();
  console.log(`[Config] ${JSON.stringify(configResp).slice(0, 400)}`);

  let stabilization = await extractStabilizationHint(configResp);

  // Also try from the last configure response
  if (stabilization === null) {
    stabilization = await extractStabilizationHint(dayResp);
  }

  // Step 4: Configure syncRatio and stabilization
  console.log(`\n[Step 4] Configuring syncRatio=${jump.syncRatio.toFixed(2)}`);
  const syncResp = await apiConfigure("syncRatio", jump.syncRatio);
  console.log(`  API response: ${JSON.stringify(syncResp).slice(0, 200)}`);
  await sleep(500);

  if (stabilization !== null) {
    console.log(`[Step 4] Configuring stabilization=${stabilization}`);
    const stabResp = await apiConfigure("stabilization", stabilization);
    console.log(`  API response: ${JSON.stringify(stabResp).slice(0, 200)}`);
    await sleep(500);
  } else {
    console.log("[Step 4] No stabilization hint parsed — check API response above and set manually if needed.");
  }

  // Step 5: Print manual UI instructions
  printManualInstructions(jump, stabilization);

  // Step 6: Poll for correct internalMode
  console.log(`[Step 6] Polling for correct internalMode=${jump.mode}...`);
  await waitForInternalMode(jump.mode);

  // Step 7: Wait for jump to complete
  console.log("\n[Step 7] Monitoring for jump activation and completion...");
  console.log("  → Activate the device in the web UI when flux density = 100%!");

  const { flag, finalState } = await waitForJumpComplete();

  if (flag) {
    console.log(`\n🎉 FLAG RECEIVED: ${flag}`);
    return flag;
  }

  console.log(`[Phase] Jump phase complete. Battery: ${finalState.battery ?? "?"}%`);
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║      CHRONOS-P1 Time Travel Assistant — Task: timetravel  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\nMission plan: 3-jump sequence`);
  for (const j of JUMPS) {
    console.log(`  • ${j.label}`);
  }
  console.log(`\nWeb UI: ${process.env.HUB_BASE_URL}/timetravel_preview`);

  // Print pre-calculated parameters
  console.log("\n[Pre-calculated parameters]");
  for (const j of JUMPS) {
    console.log(
      `  ${j.year}-${String(j.month).padStart(2, "0")}-${String(j.day).padStart(2, "0")}` +
        ` | syncRatio=${j.syncRatio.toFixed(2)} | PWR=${j.pwr}` +
        ` | mode=${j.mode} | PT-A=${j.ptA} | PT-B=${j.ptB}` +
        ` | tunnel=${j.tunnel}`
    );
  }

  // Fetch help first to understand current API state
  console.log("\n[Init] Calling help API...");
  try {
    const helpResp = await apiHelp();
    console.log(`[Help] ${JSON.stringify(helpResp).slice(0, 500)}`);
  } catch (err) {
    console.warn(`[Help] Failed: ${err}`);
  }

  // Check current config
  console.log("\n[Init] Fetching current device config...");
  try {
    const currentConfig = await apiGetConfig();
    console.log(`[Config] ${JSON.stringify(currentConfig).slice(0, 500)}`);
  } catch (err) {
    console.warn(`[Config] Failed: ${err}`);
  }

  // Execute jumps — START_JUMP env var lets you skip already-completed jumps (0-indexed)
  const startJump = parseInt(process.env.START_JUMP ?? "0", 10);
  if (startJump > 0) {
    console.log(`\n[Resume] Skipping to Jump ${startJump + 1} (START_JUMP=${startJump})`);
  }
  for (let i = startJump; i < JUMPS.length; i++) {
    const jump = JUMPS[i];
    const flag = await executeJump(jump);

    if (flag) {
      // Submit the flag
      console.log("\n[Hub] Submitting flag to hub...");
      try {
        const verifyResp = await hubVerify(TASK, { action: "verify", flag });
        console.log(`[Hub] Verify response: ${JSON.stringify(verifyResp)}`);
      } catch (err) {
        console.warn(`[Hub] Verify failed (flag may already be accepted): ${err}`);
      }
      return;
    }

    if (i < JUMPS.length - 1) {
      console.log(`\n[Progress] Phase ${i + 1}/${JUMPS.length} complete. Proceeding to phase ${i + 2}...`);
      await sleep(2000);
    }
  }

  // If we get here without a flag, check for it one more time
  console.log("\n[Final] All jumps complete — checking for flag...");
  const finalResp = await apiGetConfig();
  const finalFlag = extractFlag(finalResp);
  if (finalFlag) {
    console.log(`\n🎉 FINAL FLAG: ${finalFlag}`);
  } else {
    console.log("[Final] No flag yet. Check the web UI — the time tunnel may need manual activation.");
    console.log(`[Final] Config: ${JSON.stringify(finalResp).slice(0, 500)}`);
  }
}

main().catch(console.error);
