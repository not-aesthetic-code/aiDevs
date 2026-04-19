import "dotenv/config";
import crypto from "crypto";
import { HUB_API_KEY, hubVerify } from "../../shared/hub.js";
import { config } from "../../shared/config.js";
import { chat } from "../../shared/llm.js";

const TASK = "goingthere";
const BASE_URL = config.hub.base_url;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Crash sentinel — never retried
// ---------------------------------------------------------------------------

class CrashError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CrashError";
  }
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  label = "op"
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Propagate crash errors immediately — never retry
      if (err instanceof CrashError) throw err;
      if (attempt < maxAttempts) {
        const wait = 1000 * Math.pow(2, attempt - 1);
        console.warn(
          `[Retry] ${label} failed (attempt ${attempt}/${maxAttempts}): ${String(err).slice(0, 80)} — retrying in ${wait}ms`
        );
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts`);
}

// ---------------------------------------------------------------------------
// Hub movement commands
// ---------------------------------------------------------------------------

async function hubCommand(command: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const result = await hubVerify(TASK, { command });
      await sleep(300);
      return result;
    } catch (err) {
      const msg = String(err);
      // Detect crash — don't retry, signal caller to restart
      if (msg.includes('"crashed"') || msg.includes("code: -950") || msg.includes('"code":-950')) {
        console.log(`[Hub] Crash detected on command "${command}"`);
        throw new CrashError(msg);
      }
      if (attempt < 6) {
        const wait = 1000 * Math.pow(2, attempt - 1);
        console.warn(`[Hub] Error (attempt ${attempt}/6): ${msg.slice(0, 80)} — retry in ${wait}ms`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
  throw new Error("hubCommand: max retries exceeded");
}

// ---------------------------------------------------------------------------
// Frequency scanner
// ---------------------------------------------------------------------------

interface ScanClear {
  clear: true;
}
interface ScanDetected {
  clear: false;
  frequency: number;
  detectionCode: string;
}
type ScanResult = ScanClear | ScanDetected;

function parseScannerText(text: string): ScanResult {
  // HTML error page — transient, must retry
  if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html")) {
    throw new Error("Scanner returned HTML error page (transient)");
  }

  // Replace backtick quotes (common in distorted JSON) with double-quotes
  const normalized = text.replace(/`/g, '"');

  // Heuristic: detection responses ALWAYS contain all three of:
  //   1. A "freq"-like word  (frepuency, FrepUEncy, frEQUEncy, FREPueNcY, …)
  //   2. A "tect"-like word  (betecti0nC0be, DeTectIOncoDE, BEtECtI0NC0Be, …)
  //   3. A 3+ digit number  (the frequency value, e.g. 872, 287, 853)
  // Clear signals ("Its cleeeeear", "IT'S CleeEeAr!") never satisfy all three.
  const looksLikeDetection =
    /[fF][rR][eE][a-zA-Z0-9]/.test(normalized) && // freq-like prefix
    /[tT][eE][cC][tT]/.test(normalized) &&          // tect (from detect)
    /\d{3,}/.test(normalized);                       // 3+ digit frequency value

  if (!looksLikeDetection) {
    return { clear: true };
  }

  // --- This looks like radar detection data; extract frequency + detectionCode ---

  // Helper: recursively search an object's keys for freq/code using pattern matching
  const searchObj = (obj: Record<string, unknown>): { freq?: number; code?: string } => {
    let freq: number | undefined;
    let code: string | undefined;
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      // Frequency field: key contains "fre" (frepuency, frequency, frEQUEncy…)
      if (kl.includes("fre") && typeof v === "number") freq = v;
      // DetectionCode field: key contains "tect" (betecti0nC0be, DeTectIOncoDE…), value is short alphanumeric
      if (kl.includes("tect") && typeof v === "string" && v.length >= 4 && v.length <= 12) code = v;
      // Recurse into nested objects
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const nested = searchObj(v as Record<string, unknown>);
        if (nested.freq !== undefined) freq = nested.freq;
        if (nested.code !== undefined) code = nested.code;
      }
    }
    return { freq, code };
  };

  // Strategy 1: try JSON.parse (with cleaning) then key-pattern search
  try {
    const cleaned = normalized
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/,\s*([}\]])/g, "$1");
    const data = JSON.parse(cleaned) as Record<string, unknown>;
    const { freq, code } = searchObj(data);
    if (freq !== undefined && code !== undefined) {
      console.log(`[Scanner] JSON+key-search: freq=${freq}, code=${code}`);
      return { clear: false, frequency: freq, detectionCode: code };
    }
  } catch { /* continue to regex */ }

  // Strategy 2: regex on raw text — matches obfuscated key names
  // Frequency key: contains f-r-e in sequence
  const freqMatch = normalized.match(/"[a-zA-Z]*[fF][rR][eE][a-zA-Z0-9]*"\s*:\s*(\d+)/);
  // DetectionCode key: contains t-e-c-t in sequence, value is short alphanumeric
  const codeMatch = normalized.match(/"[a-zA-Z0-9]*[tT][eE][cC][tT][a-zA-Z0-9]*"\s*:\s*"([A-Za-z0-9]{4,12})"/);

  if (freqMatch && codeMatch) {
    const frequency = parseFloat(freqMatch[1]);
    const detectionCode = codeMatch[1];
    console.log(`[Scanner] Regex: freq=${frequency}, code=${detectionCode}`);
    return { clear: false, frequency, detectionCode };
  }

  // Has detection signatures but all parse strategies failed → signal LLM fallback
  throw new Error(`Detection signals present but parse failed: ${text.slice(0, 120)}`);
}

// LLM fallback for scanner responses that defeat all regex strategies
async function parseScannerWithLLM(text: string): Promise<ScanResult> {
  const model = process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE;
  console.log("[Scanner] Regex failed, using LLM to extract radar data...");

  const response = await chat(
    [
      {
        role: "user",
        content: `Parse this radar scanner response. Field names and values are obfuscated (random capitalisation, leet-speak substitutions: d→b, o→0, etc.):

${text}

Rules:
- If it is a "clear" / safe signal → {"clear": true}
- If tracking is active, extract:
  * frequency: the integer value (field resembles "frequency" e.g. "frepuency", "FrepUEncy", "frEQUEncy")
  * detectionCode: the short alphanumeric string (field resembles "detectionCode" e.g. "betecti0nC0be", "DeTectIOncoDE"; typically inside a nested "data" / "bata" object)
  → {"clear": false, "frequency": <integer>, "detectionCode": "<string>"}

Return ONLY valid JSON, no extra text.`,
      },
    ],
    {
      system:
        "You extract radar frequency and detection code from obfuscated scanner output. Return minimal JSON.",
      model,
    }
  );

  const jsonMatch = response.match(/\{[^}]+\}/);
  if (!jsonMatch) throw new Error(`LLM scanner parse: no JSON in response: ${response.slice(0, 80)}`);

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  console.log(`[Scanner] LLM extracted: ${JSON.stringify(parsed)}`);

  if (parsed.clear === true) return { clear: true };

  if (typeof parsed.frequency === "number" && typeof parsed.detectionCode === "string") {
    return { clear: false, frequency: parsed.frequency, detectionCode: parsed.detectionCode };
  }

  throw new Error(`LLM extraction incomplete: ${JSON.stringify(parsed)}`);
}

async function checkFrequency(): Promise<ScanResult> {
  return withRetry(
    async () => {
      const url = `${BASE_URL}/api/frequencyScanner?key=${HUB_API_KEY}`;
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      console.log(`[Scanner] ${text.slice(0, 250)}`);

      try {
        return parseScannerText(text);
      } catch (err) {
        const errMsg = String(err);
        // HTML pages → just retry, no LLM needed
        if (errMsg.includes("HTML")) throw err;
        // Detection data that defeated regex → use LLM
        return await parseScannerWithLLM(text);
      }
    },
    8,
    "frequencyScanner"
  );
}

// ---------------------------------------------------------------------------
// Radar disarm
// ---------------------------------------------------------------------------

async function disarmRadar(frequency: number, detectionCode: string): Promise<void> {
  const disarmHash = crypto
    .createHash("sha1")
    .update(`${detectionCode}disarm`)
    .digest("hex");

  console.log(`[Disarm] freq=${frequency}, hash=${disarmHash}`);

  await withRetry(
    async () => {
      const url = `${BASE_URL}/api/frequencyScanner`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: HUB_API_KEY, frequency, disarmHash }),
      });
      const text = await res.text();
      console.log(`[Disarm] Response: ${text.slice(0, 200)}`);
      if (res.status >= 500) throw new Error(`Server error ${res.status}`);
    },
    5,
    "disarmRadar"
  );
}

// ---------------------------------------------------------------------------
// Radio hint
// ---------------------------------------------------------------------------

async function getRadioHint(): Promise<string> {
  return withRetry(
    async () => {
      const url = `${BASE_URL}/api/getmessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: HUB_API_KEY }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      if (typeof data.hint !== "string") throw new Error(`No hint field: ${text.slice(0, 100)}`);
      return data.hint;
    },
    5,
    "getRadioHint"
  );
}

// ---------------------------------------------------------------------------
// LLM: parse start response → target row
// ---------------------------------------------------------------------------

async function parseTargetRow(startResponse: unknown): Promise<number> {
  const model = process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE;
  const responseStr = JSON.stringify(startResponse, null, 2);

  try {
    const analysis = await chat(
      [
        {
          role: "user",
          content: `Game start API response:\n${responseStr}\n\nExtract the TARGET ROW number (1, 2, or 3) where the destination base in column 12 is located. The rocket starts at row 2 (middle), rows go 1–3.\n\nReturn ONLY valid JSON: {"targetRow": <1|2|3>}`,
        },
      ],
      {
        system:
          "Extract the destination row number from a game start response. Return only JSON with a single field targetRow.",
        model,
      }
    );

    const jsonMatch = analysis.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { targetRow: number };
      if (parsed.targetRow >= 1 && parsed.targetRow <= 3) {
        console.log(`[AI] Parsed targetRow: ${parsed.targetRow}`);
        return parsed.targetRow;
      }
    }
  } catch (err) {
    console.warn(`[AI] Start parse failed: ${err}`);
  }

  // Regex fallback
  const flat = JSON.stringify(startResponse);
  const patterns = [
    /"(?:targetRow|target_row|baseRow|base_row|destinationRow)"\s*:\s*(\d)/,
    /"row"\s*:\s*(\d).*?"col(?:umn)?"\s*:\s*12/,
    /"col(?:umn)?"\s*:\s*12.*?"row"\s*:\s*(\d)/,
    /(?:base|target|destination|cel|baza).*?"row"\s*:\s*(\d)/i,
    /"row"\s*:\s*(\d)/,
  ];

  for (const p of patterns) {
    const m = flat.match(p);
    if (m) {
      const row = parseInt(m[1]);
      if (row >= 1 && row <= 3) {
        console.log(`[Regex] Parsed targetRow: ${row}`);
        return row;
      }
    }
  }

  console.warn("[Parse] Could not determine targetRow, defaulting to 2");
  return 2;
}

// ---------------------------------------------------------------------------
// LLM: interpret hint → decide movement command
// ---------------------------------------------------------------------------

async function decideMove(
  hint: string,
  currentRow: number,
  targetRow: number,
  currentCol: number,
  currentStoneRow: number | null
): Promise<string> {
  const model = process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE;

  const { command, rockRow } = await withRetry(
    async () => {
      // Compute diagonal safety for left/right (movement passes through current col's stone row)
      const leftDiagUnsafe = currentStoneRow !== null && currentRow - 1 === currentStoneRow;
      const rightDiagUnsafe = currentStoneRow !== null && currentRow + 1 === currentStoneRow;

      const response = await chat(
        [
          {
            role: "user",
            content: `You control a rocket on a 3-row × 12-column grid.

GRID LAYOUT (rows numbered 1–3):
  Row 1 = TOP of grid     (port / left side when moving forward)
  Row 2 = MIDDLE          (starting row)
  Row 3 = BOTTOM of grid  (starboard / right side when moving forward)
The rocket always moves from column 1 → 12 (left to right).

CURRENT STATE:
  Column: ${currentCol}  |  Current row: ${currentRow}  |  Target row at col 12: ${targetRow}
  Stone in CURRENT column ${currentCol}: row ${currentStoneRow ?? "unknown"}

MOVEMENT COMMANDS (each also advances one column forward):
  "go"    → stay at row ${currentRow}     → lands at (col ${currentCol + 1}, row ${currentRow})
  "left"  → go UP   (row − 1) → row ${currentRow - 1} ${currentRow - 1 < 1 ? "⚠️ OUT OF BOUNDS — DO NOT USE" : leftDiagUnsafe ? `⚠️ DIAGONAL CRASH — current col stone at row ${currentStoneRow} — DO NOT USE` : "✓ in bounds and safe"}
  "right" → go DOWN (row + 1) → row ${currentRow + 1} ${currentRow + 1 > 3 ? "⚠️ OUT OF BOUNDS — DO NOT USE" : rightDiagUnsafe ? `⚠️ DIAGONAL CRASH — current col stone at row ${currentStoneRow} — DO NOT USE` : "✓ in bounds and safe"}

IMPORTANT — DIAGONAL MOVEMENT:
  Moving "left" or "right" travels diagonally through the current column first.
  If the current column's stone is at row ${currentRow - 1}, "left" crashes into it.
  If the current column's stone is at row ${currentRow + 1}, "right" crashes into it.
  Commands marked ⚠️ above will DEFINITELY crash — do NOT choose them.

RADIO HINT about rock in column ${currentCol + 1}:
"${hint}"

HINT INTERPRETATION — rock's absolute row in NEXT column (col ${currentCol + 1}):
  - "port", "left", "top", "upper", "above", "port hull", "port side", "port wing"          → rock is at row 1 (top)
  - "starboard", "right", "bottom", "lower", "below", "starboard hull", "starboard wing"    → rock is at row 3 (bottom)
  - "ahead", "straight", "directly ahead", "dead ahead", "before the nose", "in front",
    "directly in front", "nose is pointing", "current heading", "forward line"               → rock is at row ${currentRow} (YOUR current row — same heading as rocket)
  - "center", "middle", "central", "central path", "central lane"                           → rock is at row 2 (absolute middle of grid)

  NOTE: "ahead/straight/in front" = same row as you (row ${currentRow}), NOT always row 2.

DECISION RULES — follow strictly in order:
  1. Identify rockRow (next column's rock) from the hint.
  2. Reject any command marked ⚠️ above.
  3. Reject any remaining command whose destination row equals rockRow.
  4. Among surviving commands, prefer moving toward target row ${targetRow}.

Return ONLY valid JSON (no markdown, no extra keys):
{"rockRow": <1|2|3>, "command": "<go|left|right>", "reasoning": "<one line>"}`,
          },
        ],
        {
          system:
            "Navigation assistant. Parse rock position hints (including nautical language) and return the safest movement command as JSON. Never choose a command marked with ⚠️.",
          model,
        }
      );

      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error(`No JSON in LLM response: ${response.slice(0, 80)}`);

      const parsed = JSON.parse(jsonMatch[0]) as {
        rockRow: number;
        command: string;
        reasoning: string;
      };

      console.log(
        `[AI] Rock at row ${parsed.rockRow}, cmd="${parsed.command}", reason: ${parsed.reasoning}`
      );
      return { command: parsed.command, rockRow: parsed.rockRow };
    },
    3,
    "decideMove"
  );

  // Safety override: prevent out-of-bounds, landing on next-col rock, OR diagonal crash through current-col stone
  // left = row-1 (UP), right = row+1 (DOWN)
  const destRow =
    command === "left" ? currentRow - 1 : command === "right" ? currentRow + 1 : currentRow;

  // Check diagonal crash: left/right moves through (currentCol, destRow) which may have current col's stone
  const diagCrash =
    command !== "go" &&
    currentStoneRow !== null &&
    destRow === currentStoneRow;

  const isUnsafe = destRow < 1 || destRow > 3 || destRow === rockRow || diagCrash;

  if (isUnsafe) {
    const reason =
      destRow < 1 ? "out of bounds (row 0)" :
      destRow > 3 ? "out of bounds (row 4)" :
      diagCrash ? `diagonal crash — current col stone at row ${currentStoneRow}` :
      `would land on next-col rock at row ${rockRow}`;
    console.warn(`[Safety] "${command}" → row ${destRow} is unsafe (${reason}) — finding safe alternative`);

    // Build candidate list: all valid commands safe from both constraints
    const candidates = [
      { cmd: "go",    row: currentRow },
      { cmd: "left",  row: currentRow - 1 },
      { cmd: "right", row: currentRow + 1 },
    ].filter(({ cmd, row }) => {
      if (row < 1 || row > 3) return false;            // out of bounds
      if (row === rockRow) return false;                 // would land on next-col rock
      if (cmd !== "go" && currentStoneRow !== null && row === currentStoneRow) return false; // diagonal crash
      return true;
    }).sort((a, b) => Math.abs(a.row - targetRow) - Math.abs(b.row - targetRow));

    if (candidates.length > 0) {
      const best = candidates[0];
      console.warn(`[Safety] Overriding to "${best.cmd}" → row ${best.row}`);
      return best.cmd;
    }
    // Fallback: go (shouldn't happen on a 3-row grid with 1 rock)
    console.warn("[Safety] No safe candidate found, defaulting to go");
    return "go";
  }

  return command;
}

// ---------------------------------------------------------------------------
// Result inspection helpers
// ---------------------------------------------------------------------------

function extractFlag(result: unknown): string | null {
  const str = JSON.stringify(result);
  // Match single-brace {FLG:...} (actual API format) OR double-brace {{FLG:...}} (alternative format)
  const match =
    str.match(/\{FLG:[^}]+\}/) ??
    str.match(/\{\{FLG:[^}]*\}\}/) ??
    str.match(/"flag"\s*:\s*"([^"]+)"/) ??
    str.match(/"message"\s*:\s*"([^"]*\{FLG:[^}]+\}[^"]*)"/);
  if (match) return match[0];
  // code 0 with message = success
  const parsed = result as Record<string, unknown> | null;
  if (parsed && typeof parsed === "object" && parsed.code === 0 && typeof parsed.message === "string") {
    return parsed.message as string;
  }
  if (
    str.toLowerCase().includes("congratulations") ||
    str.toLowerCase().includes("gratulacje") ||
    str.toLowerCase().includes("dotarłeś") ||
    str.toLowerCase().includes("you made it") ||
    str.toLowerCase().includes("you reached")
  ) {
    return str;
  }
  return null;
}

// Parse actual player row from game response (more reliable than command tracking)
function parsePlayerRow(result: unknown): number | null {
  const str = JSON.stringify(result);
  // "player": {"row": N, "col": N}
  const m = str.match(/"player"\s*:\s*\{[^}]*"row"\s*:\s*(\d)/);
  if (m) return parseInt(m[1]);
  return null;
}

// Parse actual player col from game response
function parsePlayerCol(result: unknown): number | null {
  const str = JSON.stringify(result);
  const m = str.match(/"player"\s*:\s*\{[^}]*"col"\s*:\s*(\d+)/);
  if (m) return parseInt(m[1]);
  return null;
}

// Parse stone row for the CURRENT column from game response
// "currentColumn": {"column": N, "yourRow": N, "stoneRow": N, ...}
function parseCurrentStoneRow(result: unknown): number | null {
  const str = JSON.stringify(result);
  const m = str.match(/"currentColumn"\s*:\s*\{[^}]*"stoneRow"\s*:\s*(\d)/);
  if (m) return parseInt(m[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Single game run
// ---------------------------------------------------------------------------

async function runGame(): Promise<string | null> {
  console.log("\n[Game] Starting new game with 'start' command...");

  const startResult = await hubCommand("start");
  console.log(`[Start] ${JSON.stringify(startResult).slice(0, 600)}`);

  const targetRow = await parseTargetRow(startResult);
  console.log(`[Game] Target row: ${targetRow}`);

  // Bootstrap position from start response (should be row 2, col 1)
  let currentRow = parsePlayerRow(startResult) ?? 2;
  let currentCol = parsePlayerCol(startResult) ?? 1;
  let currentStoneRow = parseCurrentStoneRow(startResult);
  console.log(`[Game] Start position: col ${currentCol}, row ${currentRow}, col stone: row ${currentStoneRow ?? "unknown"}`);

  // Navigate from col 1 through col 11 (11 moves lands at col 12)
  while (currentCol < 12) {
    console.log(
      `\n--- Column ${currentCol} | Row ${currentRow} | Target row: ${targetRow} ---`
    );

    // Step 1: check frequency scanner
    const scan = await checkFrequency();
    if (!scan.clear) {
      console.log(`[Radar] Detected! Disarming frequency ${scan.frequency}...`);
      await disarmRadar(scan.frequency, scan.detectionCode);

      // Re-check after disarm
      const recheck = await checkFrequency();
      if (!recheck.clear) {
        console.warn("[Radar] Still active after first disarm, disarming again...");
        await disarmRadar(recheck.frequency, recheck.detectionCode);
      }
      console.log("[Radar] Neutralised.");
    }

    // Step 2: get radio hint for next column
    const hint = await getRadioHint();
    console.log(`[Hint] "${hint}"`);

    // Step 3: decide command with LLM
    const command = await decideMove(hint, currentRow, targetRow, currentCol, currentStoneRow);
    console.log(`[Execute] ${command}`);

    // Step 4: execute move — catch crash to trigger restart, not retry
    let moveResult: unknown;
    try {
      moveResult = await hubCommand(command);
    } catch (err) {
      if (err instanceof CrashError) {
        console.log(`[CRASH] Rocket crashed at col ${currentCol}, row ${currentRow} using "${command}"`);
        return null;
      }
      throw err;
    }

    const moveStr = JSON.stringify(moveResult);
    console.log(`[Result] ${moveStr.slice(0, 400)}`);

    // Check success
    const flag = extractFlag(moveResult);
    if (flag) {
      console.log(`\n[SUCCESS] Flag received! ${moveStr}`);
      return moveStr;
    }

    // Update position — prefer API-reported position, fall back to command inference
    // left = row-1 (UP), right = row+1 (DOWN)
    const apiRow = parsePlayerRow(moveResult);
    const apiCol = parsePlayerCol(moveResult);
    if (apiRow !== null) currentRow = apiRow;
    else if (command === "left") currentRow = Math.max(1, currentRow - 1);
    else if (command === "right") currentRow = Math.min(3, currentRow + 1);

    if (apiCol !== null) currentCol = apiCol;
    else currentCol++;

    // Update current column's stone row from the move result
    currentStoneRow = parseCurrentStoneRow(moveResult);

    console.log(`[Pos] Updated position: col ${currentCol}, row ${currentRow}, col stone: row ${currentStoneRow ?? "unknown"}`);
  }

  // If loop exits without flag (shouldn't happen normally)
  console.log(`[Game] Loop ended at col ${currentCol}, row ${currentRow} — no flag detected`);
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function main() {
  console.log("[Start] Rocket navigation to Grudziądz — task: goingthere");

  const MAX_ATTEMPTS = 10;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n========== Game attempt ${attempt}/${MAX_ATTEMPTS} ==========`);
    const result = await runGame();
    if (result !== null) {
      console.log(`\n[DONE] Mission complete! Response:\n${result}`);
      return;
    }
    console.log(`[Restart] Attempt ${attempt} failed, restarting...`);
    await sleep(2000);
  }

  console.error("[FAIL] Could not complete the mission after 5 attempts");
  process.exit(1);
}

main().catch(console.error);
