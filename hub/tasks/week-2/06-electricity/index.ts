/**
 * Electricity Task
 *
 * Architecture:
 *   resetBoard → pre-localize solved grid → loop:
 *     fetchBoard → extractTiles (current + target) → detectRotation per pair → sendRotations
 *
 * Key insight: instead of labeling connections independently (prone to hallucination),
 * we send BOTH tiles (current + target) to the model and ask directly:
 *   "How many 90° CW rotations does the current tile need to look like the target?"
 * This sidesteps intermediate connection-label errors entirely.
 */

import "dotenv/config";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { HUB_API_KEY } from "../../shared/hub.js";
import {
  getOpenRouterChatCompletionsUrl,
  getOpenRouterHeaders,
} from "../../shared/openrouter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_BASE_URL = process.env.HUB_BASE_URL ?? "";
const VERIFY_URL = `${HUB_BASE_URL}/verify`;
const HUB_TASK = "electricity";

// ── Config ────────────────────────────────────────────────────────────────────

/** Vision model — Gemini 3 Flash recommended by task hint. */
const VISION_MODEL = process.env.STEP_ANALYZE_MODEL?.trim() || "google/gemini-3-flash-preview";
/** Inner margin to strip grid-line border artifacts from tile edges (fraction of tile size). */
const INNER_MARGIN_PCT = 0.04;
/** Tile resolution sent to LLM — bigger = clearer cable lines. */
const TILE_DISPLAY_SIZE = 400;
/** Max solve iterations before giving up. */
const MAX_ITERATIONS = 6;

// ── Hub API ───────────────────────────────────────────────────────────────────

async function hubCall(answer: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: HUB_API_KEY, task: HUB_TASK, answer }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return (buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xff && buf[1] === 0xd8);
}

async function fetchBoardPng(): Promise<Buffer> {
  const url = `${HUB_BASE_URL}/data/${HUB_API_KEY}/electricity.png?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok && isImageBuffer(buf)) return buf;
  throw new Error(`Failed to fetch board PNG: HTTP ${res.status}`);
}

function hubAddr(row: number, col: number): string {
  return `${row + 1}x${col + 1}`;
}

async function rotateTileOnHub(row: number, col: number): Promise<string> {
  const result = JSON.stringify(await hubCall({ rotate: hubAddr(row, col) }));
  if (result.includes("FLG:")) console.log(`\n🚩 FLAG: ${result}\n`);
  return result;
}

async function resetBoard(): Promise<void> {
  const url = `${HUB_BASE_URL}/data/${HUB_API_KEY}/electricity.png?reset=1`;
  const res = await fetch(url);
  console.log(`  Board reset: HTTP ${res.status}`);
}

// ── Vision API (OpenRouter) ───────────────────────────────────────────────────

async function visionCall(imageBuf: Buffer, prompt: string, maxTokens = 60): Promise<string> {
  const b64 = imageBuf.toString("base64");
  const res = await fetch(getOpenRouterChatCompletionsUrl(), {
    method: "POST",
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

// ── Grid localization ─────────────────────────────────────────────────────────

interface GridBounds { left: number; top: number; right: number; bottom: number; }

/**
 * Pre-calibrated grid bounds per image size (verified by visual inspection).
 * Hub always returns 800×450; solved image is always 598×422.
 * Hardcoding avoids inconsistent vision-model localization entirely.
 */
const SIZE_PRESETS: Record<string, GridBounds> = {
  "800x450": { left: 0.287, top: 0.169, right: 0.673, bottom: 0.833 },
  "598x422": { left: 0.263, top: 0.268, right: 0.688, bottom: 0.862 },
};

const GRID_CACHE = new Map<string, GridBounds>();

async function localizeGrid(imageBuf: Buffer, cacheKey: string): Promise<GridBounds> {
  if (GRID_CACHE.has(cacheKey)) return GRID_CACHE.get(cacheKey)!;

  const meta = await sharp(imageBuf).metadata();
  const sizeKey = `${meta.width}x${meta.height}`;

  if (SIZE_PRESETS[sizeKey]) {
    const bounds = SIZE_PRESETS[sizeKey];
    console.log(`  Grid bounds [${cacheKey}] (${sizeKey} preset): L=${bounds.left} T=${bounds.top} R=${bounds.right} B=${bounds.bottom}`);
    GRID_CACHE.set(cacheKey, bounds);
    return bounds;
  }

  // Fallback: ask vision model for unknown image sizes
  console.log(`  Localizing grid for unknown size ${sizeKey} via vision model...`);
  const prompt =
    `Find the 3×3 cable tile grid in this electrical puzzle image.
The grid contains 9 square tiles with thick black cable lines on beige background.
Ignore the title, the icons on the left, and the labels on the right.
Return ONLY JSON with the grid bounding box as fractions of image size:
{"left":0.X,"top":0.X,"right":0.X,"bottom":0.X}`;

  let bounds: GridBounds = { left: 0.27, top: 0.17, right: 0.68, bottom: 0.85 };
  try {
    const text = await visionCall(imageBuf, prompt, 80);
    const m = text.match(/\{[^}]+\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (parsed.left && parsed.top && parsed.right && parsed.bottom) {
        bounds = parsed as GridBounds;
      }
    }
  } catch (e) {
    console.warn("  Grid localization failed, using fallback defaults:", e);
  }

  console.log(`  Grid bounds [${cacheKey}]: L=${bounds.left.toFixed(3)} T=${bounds.top.toFixed(3)} R=${bounds.right.toFixed(3)} B=${bounds.bottom.toFixed(3)}`);
  GRID_CACHE.set(cacheKey, bounds);
  return bounds;
}

// ── Tile extraction ───────────────────────────────────────────────────────────

async function extractTile(imageBuf: Buffer, row: number, col: number, grid: GridBounds): Promise<Buffer> {
  const meta = await sharp(imageBuf).metadata();
  const w = meta.width!;
  const h = meta.height!;

  const gl = Math.round(w * grid.left);
  const gt = Math.round(h * grid.top);
  const tileW = Math.round((Math.round(w * grid.right) - gl) / 3);
  const tileH = Math.round((Math.round(h * grid.bottom) - gt) / 3);

  const mx = Math.round(tileW * INNER_MARGIN_PCT);
  const my = Math.round(tileH * INNER_MARGIN_PCT);

  return sharp(imageBuf)
    .extract({
      left: gl + col * tileW + mx,
      top: gt + row * tileH + my,
      width: tileW - 2 * mx,
      height: tileH - 2 * my,
    })
    .resize(TILE_DISPLAY_SIZE, TILE_DISPLAY_SIZE, { fit: "fill" })
    .png()
    .toBuffer();
}

// ── Rotation detection — pair-based (current tile + target tile → N rotations) ──

const ROTATION_PROMPT =
  `You see two electrical cable puzzle tiles.
The FIRST image is the CURRENT tile. The SECOND image is the TARGET tile.
Both show thick black cable lines on a beige/grey background.
Count how many 90-degree clockwise rotations the CURRENT tile needs so its cables match the TARGET tile exactly.
Reply ONLY with JSON, no explanation: {"rotations": N} where N is 0, 1, 2, or 3.`;

async function detectRotation(currentTile: Buffer, targetTile: Buffer): Promise<number> {
  const b64c = currentTile.toString("base64");
  const b64t = targetTile.toString("base64");

  const res = await fetch(getOpenRouterChatCompletionsUrl(), {
    method: "POST",
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 20,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64c}` } },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64t}` } },
          { type: "text", text: ROTATION_PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Vision API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const text = data.choices[0]?.message?.content ?? "";
  const m = text.match(/\{[^}]+\}/);
  if (!m) { console.warn(`    ⚠️  No JSON in: "${text.trim()}"`); return -1; }
  try {
    const n = Number(JSON.parse(m[0]).rotations);
    if (Number.isInteger(n) && n >= 0 && n <= 3) return n;
  } catch { /* fall through */ }
  console.warn(`    ⚠️  Bad rotation value in: "${text.trim()}"`);
  return -1;
}

// ── analyzeRotations — extract all 9 pairs, query model per pair ──────────────

async function analyzeRotations(currentPng: Buffer, targetPng: Buffer): Promise<number[][]> {
  const curGrid = await localizeGrid(currentPng, "current");
  const tgtGrid = await localizeGrid(targetPng, "solved");
  const matrix: number[][] = [];

  for (let r = 0; r < 3; r++) {
    const row: number[] = [];
    for (let c = 0; c < 3; c++) {
      const curTile = await extractTile(currentPng, r, c, curGrid);
      const tgtTile = await extractTile(targetPng, r, c, tgtGrid);
      const rot = await detectRotation(curTile, tgtTile);
      row.push(rot);
      process.stdout.write(` [${r},${c}]=${rot === -1 ? "?" : rot}`);
    }
    matrix.push(row);
    process.stdout.write("\n");
  }

  return matrix;
}

// ── Pretty-print ──────────────────────────────────────────────────────────────

function printMatrix(matrix: number[][]): void {
  console.log("  ┌───┬───┬───┐");
  for (let r = 0; r < 3; r++) {
    const cells = matrix[r].map(v => v === 0 ? " ✓ " : v === -1 ? " ? " : ` ${v} `);
    console.log(`  │${cells.join("│")}│`);
    if (r < 2) console.log("  ├───┼───┼───┤");
  }
  console.log("  └───┴───┴───┘");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const doReset = process.argv.includes("--reset");
  if (doReset) {
    console.log("[0] Resetting board...");
    await resetBoard();
    await new Promise(r => setTimeout(r, 2000));
  }

  const solvedPath = path.join(__dirname, "solved_electricity.png");
  const solvedBuf = Buffer.from(await import("fs").then(fs => fs.promises.readFile(solvedPath)));
  // Pre-warm the solved grid localization (cached for all iterations)
  await localizeGrid(solvedBuf, "solved");
  console.log("[Setup] Solved image loaded.\n");

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`[Iter ${iter}] Fetching current board...`);
    await new Promise(r => setTimeout(r, 1500));
    const currentPng = await fetchBoardPng();

    console.log("  Detecting rotations (current tile vs target tile):");
    const matrix = await analyzeRotations(currentPng, solvedBuf);

    console.log("  Rotation matrix:");
    printMatrix(matrix);

    const needsWork = matrix.flat().filter(v => v > 0);
    const uncertain = matrix.flat().filter(v => v === -1);

    if (needsWork.length === 0 && uncertain.length === 0) {
      console.log("\n✅ Board matches target!");
      break;
    }

    if (uncertain.length > 0) {
      console.log(`  ⚠️  ${uncertain.length} tile(s) had uncertain detection — skipping those.`);
    }

    const totalRots = needsWork.reduce((a, v) => a + v, 0);
    console.log(`  Applying ${totalRots} rotation(s) across ${needsWork.length} tile(s)...`);

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const n = matrix[r][c];
        if (n <= 0) continue;
        for (let i = 0; i < n; i++) {
          const result = await rotateTileOnHub(r, c);
          console.log(`  rotate [${r},${c}] #${i + 1}/${n} → ${result}`);
          if (result.includes("FLG:")) return;
        }
      }
    }
  }

  console.log("\n[Done]");
}

main().catch(console.error);
