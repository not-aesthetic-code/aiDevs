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
 * Algorithm (AI agent):
 *   1. Send "start" to initialise the game
 *   2. Pass the board state to an LLM agent
 *   3. Agent uses simulate_command to preview moves, send_command to act
 *   4. Agent drives the loop until the robot reaches col=7
 */

import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";
import { runAgent, type ToolDef } from "../../shared/tool-agent.js";

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

// ── Deterministic navigator (kept as reference — no LLM needed for this!) ────
//
// function decideCommand(state: State): Command {
//   const { robotCol, blocks } = state;
//   const futureBlocks = simulateBlocks(blocks);
//   const rightCol = robotCol + 1;
//
//   // Try to move right
//   if (rightCol <= GOAL_COL && isSafe(rightCol, ROBOT_ROW, futureBlocks)) {
//     return "right";
//   }
//   // Stay and wait if current position is safe
//   if (isSafe(robotCol, ROBOT_ROW, futureBlocks)) {
//     return "wait";
//   }
//   // Retreat left if current column also becomes unsafe
//   if (robotCol > MIN_COL) {
//     return "left";
//   }
//   // Nowhere to go — wait and hope (edge case)
//   return "wait";
// }

// ── Board rendering ───────────────────────────────────────────────────────────

function renderBoard(state: State): string {
  const grid: string[][] = Array.from({ length: 5 }, () => Array(7).fill("."));

  for (const b of state.blocks) {
    for (let r = b.topRow; r < b.topRow + BLOCK_HEIGHT; r++) {
      if (r >= 0 && r < 5 && b.col >= 0 && b.col < 7) {
        grid[r][b.col] = "B";
      }
    }
  }

  grid[ROBOT_ROW][GOAL_COL] = "G";

  if (state.robotCol >= 0 && state.robotCol < 7) {
    grid[ROBOT_ROW][state.robotCol] = "P";
  }

  const header = "     C1 C2 C3 C4 C5 C6 C7";
  const rows = grid.map((row, i) => `Row ${i + 1}: ${row.join("  ")}`).join("\n");
  return `${header}\n${rows}\nRobot at col=${state.robotCol + 1} (1-indexed). Goal: col=7, row=5.`;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are controlling a transport robot navigating a 7×5 reactor grid.

GRID RULES:
- Columns 1–7 (left→right), rows 1–5 (top→bottom)
- P = robot (starts at col=1, row=5)
- G = goal (col=7, row=5)
- B = reactor block (2 rows tall, moves vertically, bounces at top/bottom edges)
- Blocks move by exactly 1 row every time ANY command is issued (including "wait")
- You are CRUSHED (game over) if a block occupies your position after a command

AVAILABLE COMMANDS:
- "right" — move robot one column to the right (robot AND blocks move)
- "left"  — move robot one column to the left  (robot AND blocks move)
- "wait"  — robot stays in place, blocks still move

STRATEGY:
1. Call simulate_command first to preview what the board looks like after a move
2. Prefer moving right whenever the destination is safe
3. Wait if right would be dangerous but staying is safe
4. Move left only if your current position becomes unsafe

Use simulate_command to check safety before committing. Use send_command to actually move.
The task is complete when the robot reaches col=7.`;

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: "simulate_command",
    description:
      "Preview what the board will look like after issuing a command, WITHOUT actually sending it to the API. Returns predicted robot position, block positions, and whether the robot would be safe.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["left", "right", "wait"],
          description: "The command to simulate",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "send_command",
    description:
      "Send a command to the reactor API. Blocks will move. Returns the new board state or game-over message.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["left", "right", "wait"],
          description: "The command to execute",
        },
      },
      required: ["command"],
    },
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main() {
  console.log("=== Reactor Task (AI Agent) ===");
  console.log(`Hub: ${process.env.HUB_BASE_URL ?? "(HUB_BASE_URL not set)"}`);
  console.log("");

  // Initialise game
  const raw = await sendCommand("start");
  let currentState = parseState(raw);

  if (currentState.done) {
    console.log(currentState.won ? "[Done] Already at goal." : "[Error] Game over immediately.");
    return;
  }

  console.log(`[Init] Robot at col=${currentState.robotCol + 1}, blocks=${currentState.blocks.length}`);
  console.log(renderBoard(currentState));
  console.log("");

  await runAgent(
    `Navigate the robot to col=7 (the goal). Here is the current board:\n\n${renderBoard(currentState)}`,
    {
      model: "claude-sonnet-4-6",
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      maxIterations: 150,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) => console.log(`[Tool] ${name}(${JSON.stringify(args)})`),
      onToolResult: (name, result) => console.log(`[Result/${name}] ${result.slice(0, 300)}`),
    },
    async (name, args) => {
      const cmd = args.command as "left" | "right" | "wait";

      if (name === "simulate_command") {
        const futureBlocks = simulateBlocks(currentState.blocks);
        const futureRobotCol =
          cmd === "right" ? currentState.robotCol + 1
          : cmd === "left"  ? currentState.robotCol - 1
          : currentState.robotCol;

        const clampedCol = Math.max(MIN_COL, Math.min(GOAL_COL, futureRobotCol));
        const safe = isSafe(clampedCol, ROBOT_ROW, futureBlocks);

        // Build a preview board from simulated state
        const previewState: State = {
          robotCol: clampedCol,
          blocks: futureBlocks,
          done: false,
          won: false,
          raw: null,
        };

        return JSON.stringify({
          command: cmd,
          robotColAfter: clampedCol + 1, // 1-indexed for LLM readability
          safe,
          preview: renderBoard(previewState),
          blocks: futureBlocks.map((b) => ({
            col: b.col + 1,
            topRow: b.topRow + 1,
            direction: b.direction,
          })),
        });
      }

      if (name === "send_command") {
        const apiRaw = await sendCommand(cmd);
        currentState = parseState(apiRaw);

        if (currentState.won) {
          return `SUCCESS! Robot reached the goal at col=7. Task complete.\nResponse: ${JSON.stringify(apiRaw)}`;
        }
        if (currentState.done) {
          return `GAME OVER — robot was crushed! Response: ${JSON.stringify(apiRaw)}`;
        }

        return `OK. New board:\n${renderBoard(currentState)}`;
      }

      return "Unknown tool";
    }
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
