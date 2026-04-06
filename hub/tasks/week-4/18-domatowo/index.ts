/**
 * Domatowo — Evacuation Operation
 *
 * Find a wounded partisan hiding in one of the tallest buildings in the ruined
 * city of Domatowo, then call a rescue helicopter to evacuate them.
 *
 * Budget: 300 action points.
 * Key insight: transporters cost 1 pt/field vs scouts on foot at 7 pts/field.
 * Strategy: drive scouts near tall buildings by transporter, then deploy on foot.
 */

import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";
import { runAgent, type ToolDef } from "../../shared/tool-agent.js";

const TASK = "domatowo";

// ── Hub communication ─────────────────────────────────────────────────────────

async function hubAction(answer: unknown): Promise<unknown> {
  console.log(`[Hub] → ${JSON.stringify(answer).slice(0, 200)}`);
  try {
    const result = await hubVerify(TASK, answer);
    const preview = JSON.stringify(result);
    console.log(`[Hub] ← ${preview.slice(0, 600)}${preview.length > 600 ? "…" : ""}`);
    return result;
  } catch (err: unknown) {
    // hubVerify throws on non-2xx; try to extract JSON body from the error message
    const msg = String(err);
    const jsonMatch = msg.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[Hub/err] ${JSON.stringify(parsed).slice(0, 300)}`);
        return parsed;
      } catch { /* fall through */ }
    }
    console.log(`[Hub/err] ${msg.slice(0, 300)}`);
    return { error: msg.slice(0, 500) };
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: "get_help",
    description:
      "Fetch help documentation listing all available actions and their exact request formats. Always call this first to learn the API.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_map",
    description:
      "Fetch the full 11×11 map of Domatowo city. Returns terrain symbols for each cell. Use this to identify the TALLEST buildings where the partisan may be hiding. You can also pass a 'symbols' array to filter specific terrain types.",
    parameters: {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of terrain symbols to filter the map display",
        },
      },
    },
  },
  {
    name: "get_logs",
    description:
      "Fetch action logs to see results of previous actions, including inspection findings and unit movements.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "send_action",
    description:
      "Send any action to the hub API. The answer object must exactly match the format documented in get_help. Use for: creating units (create), moving units (move), inspecting fields (inspect), calling helicopter (callHelicopter), and any other action.",
    parameters: {
      type: "object",
      properties: {
        answer: {
          type: "object",
          description:
            "Complete answer object with 'action' field and all required parameters per the API documentation. Examples: {action:'create',type:'transporter',passengers:2}, {action:'inspect',field:'F6'}, {action:'callHelicopter',destination:'F6'}",
        },
      },
      required: ["answer"],
    },
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are commanding a rescue operation in the ruined city of Domatowo.
Mission: find the wounded partisan hiding in one of the TALLEST buildings, then call a helicopter.

BUDGET: 300 action points total. Exceeding this fails the mission.

ACTION COSTS (memorize these):
- Create scout: 5 pts
- Create transporter: 5 pts base + 5 pts per passenger scout on board
- Scout movement (on foot): 7 pts per field — VERY EXPENSIVE, minimize this
- Transporter movement (along streets only): 1 pt per field — CHEAP
- Inspect a field: 1 pt
- Dismount scouts from transporter: 0 pts (FREE)
- Call helicopter: 0 pts (but only works after finding the partisan)

CONSTRAINTS:
- Max 4 transporters, max 8 scouts total
- Transporters can ONLY travel on streets (road tiles)
- Scouts can move anywhere but at 7 pts/field
- You can only call the helicopter AFTER a scout has found the partisan

WINNING STRATEGY:
1. Call get_help first — learn exact action parameter names
2. Call get_map — study the 11×11 terrain carefully
3. Identify the TALLEST building tiles (the partisan is in "one of the tallest blocks")
4. Plan transporter routes along streets toward tall buildings (cheap at 1 pt/field)
5. Create 1-2 transporters loaded with scouts (cost = 5 + 5×passengers)
6. Drive transporters close to tall buildings
7. Dismount scouts near tall buildings (FREE)
8. Have scouts walk short distances and inspect tall-building fields (1 pt each inspect)
9. The INSTANT a scout finds the partisan — call send_action with callHelicopter immediately

COORDINATE FORMAT:
- Columns are letters A–K (11 columns: A=1 … K=11)
- Rows are numbers 1–11
- Example: "F6" = column F, row 6

COST EXAMPLE (budget check before acting):
  2 transporters × (5 + 5×2 passengers) = 2 × 15 = 30 pts to create
  Drive each transporter 5 fields = 10 pts
  Dismount = 0 pts
  Inspect 20 fields = 20 pts
  Total ≈ 60 pts — leaving plenty of buffer

Keep running totals of points spent. Stop creating new units if budget is tight.
Prioritize tall buildings. Call the helicopter the moment you find the partisan.`;

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main() {
  console.log("=== Domatowo Evacuation Task ===");
  console.log(`Hub: ${process.env.HUB_BASE_URL ?? "(HUB_BASE_URL not set)"}`);
  console.log("");

  await runAgent(
    "Begin the Domatowo evacuation operation. Get help first, then get the map, identify the tallest buildings, deploy scouts efficiently via transporters, and call the helicopter the moment you find the partisan.",
    {
      model:
        process.env.STEP_ANALYZE_MODEL ??
        process.env.MODEL_OVERRIDE ??
        "claude-sonnet-4-6",
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      maxIterations: 120,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) =>
        console.log(`[Tool] ${name}(${JSON.stringify(args).slice(0, 300)})`),
      onToolResult: (name, result) =>
        console.log(`[Result/${name}] ${result.slice(0, 800)}`),
    },
    async (name, args) => {
      if (name === "get_help") {
        const result = await hubAction({ action: "help" });
        return JSON.stringify(result, null, 2);
      }

      if (name === "get_map") {
        const payload: Record<string, unknown> = { action: "getMap" };
        if (Array.isArray(args.symbols) && args.symbols.length > 0) {
          payload.symbols = args.symbols;
        }
        const result = await hubAction(payload);
        return JSON.stringify(result, null, 2);
      }

      if (name === "get_logs") {
        const result = await hubAction({ action: "getLogs" });
        return JSON.stringify(result, null, 2);
      }

      if (name === "send_action") {
        const answer = args.answer as Record<string, unknown>;
        const result = await hubAction(answer);
        return JSON.stringify(result, null, 2);
      }

      return `Unknown tool: ${name}`;
    }
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
