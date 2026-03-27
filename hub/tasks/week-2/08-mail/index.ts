import "dotenv/config";
import { hubVerify, HUB_API_KEY } from "../../shared/hub.js";
import { runAgent, type ToolDef } from "../../shared/tool-agent.js";

const HUB_BASE_URL = process.env.HUB_BASE_URL ?? "";
const ZMAIL_URL = `${HUB_BASE_URL}/api/zmail`;

const AGENT_MODEL =
  process.env.STEP_SEARCH_MODEL?.trim() ||
  process.env.MODEL_OVERRIDE?.trim() ||
  "claude-haiku-4-5-20251001";

// ── zmail API client ──────────────────────────────────────────────────────────

async function callZmail(
  action: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const res = await fetch(ZMAIL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: HUB_API_KEY, action, ...params }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: "zmail",
    description:
      "Call the zmail mailbox API. " +
      "Start with action='help' to discover all available actions and their parameters. " +
      "Use action='search' with Gmail-style query operators (from:, to:, subject:, OR, AND) to find emails. " +
      "Use action='getMessage' (or the equivalent discovered via help) with an email ID to read full content. " +
      "The inbox is live — new messages may arrive during the session.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "API action, e.g. 'help', 'getInbox', 'search', 'getMessage'. " +
            "Always call 'help' first to confirm available actions.",
        },
        query: {
          type: "string",
          description:
            "Search query for action='search'. " +
            "Supports Gmail operators: from:, to:, subject:, OR, AND. " +
            'Example: "from:proton.me" or "subject:password OR subject:hasło".',
        },
        id: {
          type: "string",
          description: "Email ID for actions that fetch a specific message.",
        },
        page: {
          type: "number",
          description: "Page number for paginated results. Default: 1.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "submit_answer",
    description:
      "Submit the three extracted values to the hub. " +
      "The hub returns feedback if any value is wrong or missing — read it and keep searching. " +
      "Repeat until you receive a {FLG:...} flag.",
    parameters: {
      type: "object",
      properties: {
        password: {
          type: "string",
          description: "Employee system password found in the mailbox.",
        },
        date: {
          type: "string",
          description: "Date of the planned security attack (format: YYYY-MM-DD).",
        },
        confirmation_code: {
          type: "string",
          description:
            "Security ticket confirmation code — format: SEC- followed by 32 characters (36 chars total).",
        },
      },
      required: ["password", "date", "confirmation_code"],
    },
  },
];

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name === "zmail") {
    const { action, ...rest } = args;
    try {
      const result = await callZmail(action as string, rest);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      return `zmail error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (name === "submit_answer") {
    try {
      const result = await hubVerify("mailbox", args);
      const json = JSON.stringify(result, null, 2);
      console.log(`Hub: ${json}`);
      return json;
    } catch (err) {
      return `Submit error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return `Unknown tool: ${name}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[Agent] Starting mailbox task — model: ${AGENT_MODEL}\n`);

  await runAgent(
    "Search the mailbox and find all three required values, then submit them to the hub.",
    {
      model: AGENT_MODEL,
      system: `You are an intelligence agent searching an email inbox.

Your goal: find three values and submit them to the hub via submit_answer.
  - password   : employee system password (likely sent in an email)
  - date       : date when the security department plans to attack our power plant (YYYY-MM-DD)
  - confirmation_code : security ticket code in format SEC-<32 chars> (36 chars total)

What you know:
  - Wiktor (who reported us) sent email FROM a @proton.me domain
  - The inbox is live — new messages may arrive during your session
  - The API supports Gmail-style search: from:, to:, subject:, OR, AND

Strategy:
1. Call zmail with action='help' to discover all available actions.
2. Search for Wiktor's email: query "from:proton.me"
3. Fetch full content of any promising emails by ID before drawing conclusions.
4. Search broadly for password: subject:password OR subject:hasło OR subject:credentials
5. Search for the confirmation code: subject:SEC OR subject:ticket OR subject:security
6. If a search finds nothing, try alternative queries or check getInbox with pagination.
7. The inbox is live — if something is missing, wait and retry; it may arrive.
8. Call submit_answer when you have all three. Read feedback and continue if needed.

Never guess from email subjects alone — always fetch the full message content.`,
      tools: TOOLS,
      maxIterations: 40,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) => {
        const preview = JSON.stringify(args).slice(0, 140);
        console.log(
          `[Tool] ${name}(${preview}${JSON.stringify(args).length > 140 ? "…" : ""})`
        );
      },
      onToolResult: (_name, result) => {
        const firstLine = result.split("\n")[0].slice(0, 140);
        console.log(`       → ${firstLine}`);
      },
    },
    handleTool
  );
}

run().catch(console.error);
