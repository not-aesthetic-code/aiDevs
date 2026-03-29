/**
 * Drone Task
 *
 * Architecture (two-model approach):
 *   Phase 1 — Vision model (STEP_ANALYZE_MODEL):
 *     Analyze the satellite map image to locate the dam sector (grid column + row).
 *
 *   Phase 2 — Agent loop (STEP_AGENT_MODEL / MODEL_OVERRIDE):
 *     Fetch drone API documentation, build flight instruction sequence,
 *     submit to hub and iterate on feedback until {FLG:...} is returned.
 *
 * Key env vars:
 *   STEP_ANALYZE_MODEL  — vision model for map analysis (default: openai/gpt-4o)
 *   STEP_AGENT_MODEL    — text model for agent loop (default: MODEL_OVERRIDE or claude-haiku-4-5)
 */

import "dotenv/config";
import { HUB_API_KEY } from "../../shared/hub.js";
import { runAgent, type ToolDef } from "../../shared/tool-agent.js";
import {
  getOpenRouterChatCompletionsUrl,
  getOpenRouterHeaders,
} from "../../shared/openrouter.js";

const HUB_BASE_URL = process.env.HUB_BASE_URL ?? "";
const VERIFY_URL = `${HUB_BASE_URL}/verify`;
const MAP_URL = `${HUB_BASE_URL}/data/${HUB_API_KEY}/drone.png`;
const DRONE_DOCS_URL = `${HUB_BASE_URL}/dane/drone.html`;
const HUB_TASK = "drone";
const PLANT_ID = process.env.HUB_PLANT_ID ?? "";

// ── Model selection ───────────────────────────────────────────────────────────

/** Vision model: analyzes the map image to find the dam sector. */
const VISION_MODEL =
  process.env.STEP_ANALYZE_MODEL?.trim() || "openai/gpt-4o";

/** Agent model: reads docs + builds/submits instruction sequence. */
const AGENT_MODEL =
  process.env.STEP_AGENT_MODEL?.trim() ||
  process.env.MODEL_OVERRIDE?.trim() ||
  "claude-haiku-4-5-20251001";

// ── Phase 1: Vision — locate dam on satellite map ─────────────────────────────

interface DamLocation {
  col: number; // 1-indexed column
  row: number; // 1-indexed row
  reasoning: string;
}

async function analyzeDamLocation(): Promise<DamLocation> {
  console.log(`[Phase 1] Analyzing map with vision model: ${VISION_MODEL}`);
  console.log(`          Map URL: ${MAP_URL}`);

  const prompt = `You are analyzing a satellite/overhead map of the Żarnowiec nuclear power plant area.
The map is divided into a grid of sectors (columns and columns).

Your task: locate the DAM (tama in Polish).
Clue: the water near the dam has been deliberately colored with higher color intensity to make it easier to find.

Steps:
1. Count the total number of columns in the grid (left to right).
2. Count the total number of rows in the grid (top to bottom).
3. Identify the sector containing the dam (the bright/intense blue water area).
4. Report the column number and row number of that sector (1-indexed, starting from top-left).

Respond ONLY with JSON:
{"col": <column number>, "row": <row number>, "totalCols": <total columns>, "totalRows": <total rows>, "reasoning": "<brief explanation>"}`;

  const res = await fetch(getOpenRouterChatCompletionsUrl(), {
    method: "POST",
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: MAP_URL } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Vision API ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const raw = data.choices[0]?.message?.content ?? "";
  console.log(`[Phase 1] Vision response: ${raw}`);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in vision response: ${raw}`);

  const parsed = JSON.parse(match[0]) as {
    col: number;
    row: number;
    totalCols?: number;
    totalRows?: number;
    reasoning: string;
  };

  console.log(
    `[Phase 1] Dam located at column=${parsed.col}, row=${parsed.row}`
  );
  console.log(`[Phase 1] Reasoning: ${parsed.reasoning}`);

  return { col: parsed.col, row: parsed.row, reasoning: parsed.reasoning };
}

// ── Phase 2: Fetch drone API docs ─────────────────────────────────────────────

async function fetchDroneDocs(): Promise<string> {
  console.log(`\n[Phase 2] Fetching drone docs from: ${DRONE_DOCS_URL}`);
  const res = await fetch(DRONE_DOCS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch drone docs: HTTP ${res.status}`);
  }
  const html = await res.text();
  // Strip HTML tags to get readable text for the agent
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
  console.log(`[Phase 2] Docs fetched (${text.length} chars)`);
  return text;
}

// ── Phase 3: Agent loop — build and submit instructions ───────────────────────

async function hubSubmit(instructions: string[]): Promise<string> {
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: HUB_API_KEY,
      task: HUB_TASK,
      answer: { instructions },
    }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  const json = JSON.stringify(parsed);
  console.log(`[Hub] ${json}`);
  return json;
}

async function runAgentPhase(
  damLocation: DamLocation,
  droneDocs: string
): Promise<void> {
  console.log(`\n[Phase 3] Starting agent loop — model: ${AGENT_MODEL}`);

  const TOOLS: ToolDef[] = [
    {
      name: "submit_instructions",
      description:
        "Submit a sequence of drone flight instructions to the hub. " +
        "The hub returns an error message if the instructions are wrong — read it carefully and adjust. " +
        "When the response contains {FLG:...}, the task is complete.",
      parameters: {
        type: "object",
        properties: {
          instructions: {
            type: "array",
            items: { type: "string" },
            description:
              "Ordered list of instruction strings for the drone, e.g. [\"setTarget(TARGET_ID)\", \"fly()\"].",
          },
        },
        required: ["instructions"],
      },
    },
    {
      name: "hard_reset",
      description:
        "Send a hardReset command to the drone API to clear any corrupted state from previous attempts. " +
        "Use this if you are getting errors that seem to be caused by accumulated wrong configuration.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ];

  async function handleTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (name === "submit_instructions") {
      const instructions = args.instructions as string[];
      return hubSubmit(instructions);
    }
    if (name === "hard_reset") {
      return hubSubmit(["hardReset()"]);
    }
    return `Unknown tool: ${name}`;
  }

  const systemPrompt = `You are an agent programming a drone to execute a mission.

CONTEXT:
- The power plant identifier is: ${PLANT_ID}
- You must program the drone to FLY TO THE DAM, not the power plant.
- The satellite map was analyzed: the dam is at grid column=${damLocation.col}, row=${damLocation.row}.
- The dam is near the Żarnowiec power plant.

DRONE API DOCUMENTATION:
${droneDocs}

GOAL:
Build the minimal set of drone instructions to:
1. Configure the target as the power plant (${PLANT_ID}) — this is the declared mission.
2. Override the actual bomb drop target to the dam sector (col=${damLocation.col}, row=${damLocation.row}).
3. Launch the drone so the bomb drops on the dam.

STRATEGY:
1. Read the documentation carefully — it contains conflicting/overlapping function names.
2. Focus only on what is needed: set target, override destination to dam sector, execute.
3. Use submit_instructions with your best attempt.
4. Read the error message from the hub carefully — it tells you exactly what is wrong.
5. Adjust and resubmit. Iterate until you see {FLG:...} in the response.
6. If many attempts fail and errors seem to accumulate, use hard_reset then try again.

Keep instructions minimal — only include what is necessary for the mission.`;

  await runAgent(
    `Program the drone using the API docs. Target: power plant ${PLANT_ID} (declared), actual bomb target: dam at grid col=${damLocation.col}, row=${damLocation.row}. Submit instructions and iterate until you receive the flag.`,
    {
      model: AGENT_MODEL,
      system: systemPrompt,
      tools: TOOLS,
      maxIterations: 40,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) => {
        const preview = JSON.stringify(args).slice(0, 200);
        console.log(
          `[Tool] ${name}(${preview}${JSON.stringify(args).length > 200 ? "…" : ""})`
        );
      },
      onToolResult: (_name, result) => {
        const firstLine = result.split("\n")[0].slice(0, 200);
        console.log(`       → ${firstLine}`);
      },
    },
    handleTool
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Drone Task ===");
  console.log(`Vision model : ${VISION_MODEL}`);
  console.log(`Agent model  : ${AGENT_MODEL}`);
  console.log(`Hub base URL : ${HUB_BASE_URL}`);
  console.log("");

  // Phase 1: Locate the dam via vision model
  const damLocation = await analyzeDamLocation();

  // Phase 2: Fetch drone API documentation
  const droneDocs = await fetchDroneDocs();

  // Phase 3: Agent loop — build instructions, submit, iterate
  await runAgentPhase(damLocation, droneDocs);

  console.log("\n[Done]");
}

main().catch(console.error);
