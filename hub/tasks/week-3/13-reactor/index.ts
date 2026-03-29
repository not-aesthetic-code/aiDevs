/**
 * Reactor Task
 *
 * Navigate a transport robot carrying a cooling unit to the other side of a
 * 7×5 reactor map without being crushed by moving reactor blocks.
 *
 * Map layout (1-indexed per task spec):
 *   - Start: col=1, row=5 (bottom-left)
 *   - Goal:  col=7, row=5 (bottom-right)
 *   - Robot always travels along row 5 (the bottom floor)
 *
 * Each reactor block occupies 2 rows and moves vertically (up/down) cyclically.
 * Blocks only move when a command is issued.
 *
 * Algorithm:
 *   1. Send "start"
 *   2. Simulate what happens to blocks after each possible command
 *   3. Move right if future right column is safe
 *   4. Wait if right is unsafe but current column stays safe
 *   5. Move left if current column also becomes unsafe
 */

import "dotenv/config";
import { HUB_API_KEY, hubVerify } from "../../shared/hub.js";

const TASK = "reactor";

// Map dimensions (0-indexed internally)
const ROBOT_ROW = 4; // bottom row (row 5 in 1-indexed)
const GOAL_COL = 6;  // rightmost column (col 7 in 1-indexed)
const MIN_COL = 0;
const MAX_ROW = 4;   // rows 0..4
const BLOCK_HEIGHT = 2;

type Command = "start" | "left" | "right" | "wait" | "reset";
type Direction = "up" | "down";

interface Block {
  col: number;    // 0-indexed
  topRow: number; // 0-indexed top row of the 2-cell block
  direction: Direction;
}

interface State {
  robotCol: number;
  blocks: Block[];
  done: boolean;
  won: boolean;
  raw: unknown;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function sendCommand(cmd: Command): Promise<unknown> {
  console.log(`[Send] → ${cmd}`);
  try {
    const result = await hubVerify(TASK, { command: cmd });
    const preview = JSON.stringify(result).slice(0, 500);
    console.log(`[Recv] ${preview}${preview.length >= 500 ? "…" : ""}`);
    return result;
  } catch (err: unknown) {
    // hubVerify throws on non-2xx; extract JSON if present (e.g. 409 crush response)
    const msg = String(err);
    const jsonMatch = msg.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const preview = JSON.stringify(parsed).slice(0, 300);
        console.log(`[Recv/err] ${preview}`);
        return parsed;
      } catch { /* fall through */ }
    }
    console.log(`[Recv/err] ${msg.slice(0, 300)}`);
    return { code: -1, message: msg };
  }
}

// ── State parsing ─────────────────────────────────────────────────────────────

function parseState(raw: unknown): State {
  const r = raw as Record<string, unknown>;

  // ── Done detection ──
  const code = String(r.code ?? r.status ?? "");
  const msg = String(r.message ?? r.msg ?? "").toLowerCase();
  const won =
    code === "0" ||
    msg.includes("gratulacje") ||
    msg.includes("success") ||
    msg.includes("congratulations") ||
    msg.includes("gratulations");
  // API error / crush = done but not won
  const crushed =
    msg.includes("crash") ||
    msg.includes("crush") ||
    msg.includes("zgnieciony") ||
    msg.includes("game over");
  const done = won || crushed;

  // ── Robot position ──
  // API uses 1-indexed col/row — subtract 1 to get 0-indexed.
  // Prefer structured player object; fall back to scanning the board.
  let robotCol = 0;
  const player = r.player as Record<string, unknown> | undefined;
  if (player && player.col != null) {
    robotCol = Number(player.col) - 1;
  } else {
    // Scan the board array (field is "board", not "map")
    const boardField = (r.board ?? r.map) as unknown[] | undefined;
    if (Array.isArray(boardField)) {
      for (const row of boardField) {
        const line = Array.isArray(row) ? (row as string[]).join("") : String(row);
        const ci = line.indexOf("P");
        if (ci >= 0) { robotCol = ci; break; }
      }
    }
  }

  // ── Blocks (API uses 1-indexed col and top_row) ──
  const blocks: Block[] = [];

  if (Array.isArray(r.blocks) && r.blocks.length > 0) {
    for (const b of r.blocks as Record<string, unknown>[]) {
      // Subtract 1 from every coordinate: API is fully 1-indexed
      const col    = Number(b.col    ?? b.column ?? b.x ?? 1) - 1;
      const topRow = Number(b.top_row ?? b.topRow ?? b.row ?? b.y ?? 1) - 1;
      const dir = (String(b.direction ?? b.dir ?? "down").toLowerCase() === "up" ? "up" : "down") as Direction;
      blocks.push({ col, topRow, direction: dir });
    }
  } else {
    // Fallback: scan the board and guess directions from position
    console.warn("[Warn] No structured block data — direction guesses may be inaccurate.");
    const boardField = (r.board ?? r.map) as unknown[] | undefined;
    if (Array.isArray(boardField)) {
      const seen = new Map<number, number>();
      for (let rowIdx = 0; rowIdx < boardField.length; rowIdx++) {
        const row = boardField[rowIdx];
        const line = Array.isArray(row) ? (row as string[]).join("") : String(row);
        for (let ci = 0; ci < line.length; ci++) {
          if (line[ci] === "B" && !seen.has(ci)) {
            seen.set(ci, rowIdx);
            blocks.push({ col: ci, topRow: rowIdx, direction: rowIdx >= 2 ? "up" : "down" });
          }
        }
      }
    }
  }

  return { robotCol, blocks, done, won, raw };
}

// ── Physics simulation ────────────────────────────────────────────────────────

/**
 * Simulate one step of block movement.
 *
 * Assumption: the `direction` field in the API response represents the
 * direction the block WILL move when the next command arrives.
 * After moving, if a block reaches an extreme (topRow=0 or topRow=MAX_TOP),
 * it reverses direction for the following step.
 */
const MAX_TOP = MAX_ROW - (BLOCK_HEIGHT - 1); // = 3 for 5 rows, 2-cell blocks

function simulateBlock(b: Block): Block {
  let { col, topRow, direction } = b;
  // When already at a boundary, the block immediately reverses and moves.
  // (The API's `direction` field shows the direction the block was traveling
  // when it arrived at its current position — not the pre-reversed next direction.)
  if (direction === "up" && topRow === 0) direction = "down";
  else if (direction === "down" && topRow === MAX_TOP) direction = "up";
  topRow += direction === "down" ? 1 : -1;
  topRow = Math.max(0, Math.min(MAX_TOP, topRow)); // safety clamp
  return { col, topRow, direction };
}

function simulateBlocks(blocks: Block[]): Block[] {
  return blocks.map(simulateBlock);
}

/** Returns true if (col, row) will NOT be occupied by any block in `blocks`. */
function isSafe(col: number, row: number, blocks: Block[]): boolean {
  return !blocks.some(
    (b) => b.col === col && row >= b.topRow && row <= b.topRow + BLOCK_HEIGHT - 1
  );
}

// ── Decision logic ────────────────────────────────────────────────────────────

function decideCommand(state: State): Command {
  const { robotCol, blocks } = state;
  const futureBlocks = simulateBlocks(blocks);

  const rightCol = robotCol + 1;

  // Try to move right
  if (rightCol <= GOAL_COL && isSafe(rightCol, ROBOT_ROW, futureBlocks)) {
    return "right";
  }
  // Stay and wait if current position is safe
  if (isSafe(robotCol, ROBOT_ROW, futureBlocks)) {
    return "wait";
  }
  // Retreat left if current column also becomes unsafe
  if (robotCol > MIN_COL) {
    return "left";
  }
  // Nowhere to go — wait and hope (edge case)
  return "wait";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Reactor Task ===");
  console.log(`Hub: ${process.env.HUB_BASE_URL ?? "(HUB_BASE_URL not set)"}`);
  console.log("");

  // Initialise game
  let raw = await sendCommand("start");
  let state = parseState(raw);

  if (state.done) {
    console.log(state.won ? "[Done] Already at goal." : "[Error] Game over immediately.");
    return;
  }

  console.log(`[Init] Robot at col=${state.robotCol}, blocks=${state.blocks.length}`);
  console.log(`       Blocks: ${JSON.stringify(state.blocks)}`);

  let steps = 0;
  const MAX_STEPS = 300;

  while (!state.done && steps < MAX_STEPS) {
    steps++;
    const cmd = decideCommand(state);
    console.log(
      `[Step ${steps}] col=${state.robotCol} → ${cmd}` +
        (state.blocks.length
          ? `  (blocks: ${state.blocks.map((b) => `c${b.col}r${b.topRow}${b.direction[0]}`).join(" ")})`
          : "")
    );

    raw = await sendCommand(cmd);
    state = parseState(raw);

    if (state.done) break;
    if (state.robotCol >= GOAL_COL) {
      console.log("[Nav] Reached goal column — waiting for API confirmation…");
    }
  }

  if (state.won) {
    console.log("\n[Done] Task completed successfully!");
    console.log("Response:", JSON.stringify(state.raw, null, 2));
  } else if (steps >= MAX_STEPS) {
    console.error(`\n[Error] Exceeded ${MAX_STEPS} steps without completion.`);
    process.exit(1);
  } else {
    console.error("\n[Error] Robot was crushed or game over.");
    console.error("Last response:", JSON.stringify(state.raw, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
