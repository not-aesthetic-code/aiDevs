import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { hubVerify } from "../../shared/hub.js";
import { runAgent, type ToolDef } from "../../shared/tool-agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LOG_PATH = path.join(__dirname, "failure.log");

const AGENT_MODEL =
  process.env.STEP_COMPRESS_MODEL?.trim() ||
  process.env.MODEL_OVERRIDE?.trim() ||
  "claude-haiku-4-5-20251001";

// ── Pure helpers (no LLM) ─────────────────────────────────────────────────────

export function compressLine(line: string): string {
  let out = line.replace(
    /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}\]/,
    "[$1 $2]"
  );
  const msgStart = out.indexOf("] ", out.indexOf("] ") + 1) + 2;
  if (msgStart > 2) {
    const prefix = out.substring(0, msgStart);
    const msg = out.substring(msgStart);
    const dot = msg.indexOf(".");
    out =
      prefix + (dot > 0 && dot < msg.length - 1 ? msg.substring(0, dot + 1) : msg);
  }
  return out;
}

export function deduplicateLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const levelMatch = line.match(/\[([A-Z]+)\]/g);
    const level = levelMatch?.[1] ?? "";
    const msgStart = line.indexOf("] ", line.indexOf("] ") + 1) + 2;
    const msg = msgStart > 2 ? line.substring(msgStart) : line;
    const dot = msg.indexOf(".");
    const sentence = (dot > 0 ? msg.substring(0, dot + 1) : msg).trim();
    const key = `${level}|${sentence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 1 token ≈ 2.5 chars — conservative estimate with ~14 % safety margin. */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function searchLogs(opts: {
  levels?: string[];
  component?: string;
  keyword?: string;
  deduplicate?: boolean;
}): Promise<string> {
  const levelSet = new Set(opts.levels ?? ["CRIT", "ERRO"]);
  const lines: string[] = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(LOG_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[[\d-]+ [\d:]+\] \[([A-Z]+)\]/);
    if (!m || !levelSet.has(m[1])) continue;
    if (opts.component && !line.includes(opts.component)) continue;
    if (opts.keyword && !line.toLowerCase().includes(opts.keyword.toLowerCase())) continue;
    lines.push(compressLine(line));
  }

  const result = opts.deduplicate !== false ? deduplicateLines(lines) : lines;
  return result.join("\n");
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: "search_logs",
    description:
      "Search the power-plant failure.log for events matching given criteria. " +
      "Returns compressed, deduplicated matching lines — the full file never enters the agent context.",
    parameters: {
      type: "object",
      properties: {
        levels: {
          type: "array",
          items: { type: "string" },
          description: 'Log levels to include, e.g. ["CRIT","ERRO"]. Default: ["CRIT","ERRO"].',
        },
        component: {
          type: "string",
          description: 'Filter by component ID, e.g. "STMTURB12". Omit for all components.',
        },
        keyword: {
          type: "string",
          description: "Optional keyword to match in the message text.",
        },
        deduplicate: {
          type: "boolean",
          description: "Collapse repeated identical events to one line. Default: true.",
        },
      },
      required: [],
    },
  },
  {
    name: "count_tokens",
    description:
      "Estimate token count for a text string. " +
      "Keep total under 1200 to stay safely within the 1500-token hub limit.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to count tokens for." },
      },
      required: ["text"],
    },
  },
  {
    name: "submit_logs",
    description:
      "Submit condensed logs to the hub for engineer verification. " +
      "Returns feedback — read it carefully and iterate if any component is flagged as insufficient.",
    parameters: {
      type: "object",
      properties: {
        logs: {
          type: "string",
          description: "Condensed log string, one event per line.",
        },
      },
      required: ["logs"],
    },
  },
];

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name === "search_logs") {
    const matches = await searchLogs({
      levels: args.levels as string[] | undefined,
      component: args.component as string | undefined,
      keyword: args.keyword as string | undefined,
      deduplicate: args.deduplicate !== false,
    });
    const count = matches.split("\n").filter((l) => l.trim()).length;
    return `Found ${count} unique events:\n${matches}`;
  }

  if (name === "count_tokens") {
    const text = args.text as string;
    const tokens = countTokens(text);
    const lines = text.split("\n").filter((l) => l.trim()).length;
    return (
      `${tokens} estimated tokens (${lines} lines, ${text.length} chars). ` +
      (tokens <= 1200
        ? "✅ Within 1200-token target."
        : "⚠️  Over 1200 target — trim before submitting.")
    );
  }

  if (name === "submit_logs") {
    const logs = args.logs as string;
    const tokens = countTokens(logs);
    if (tokens > 1200) {
      return `Blocked: ~${tokens} estimated tokens exceeds 1200-token safety target. Trim and recount first.`;
    }
    console.log(`[TOKENS:${tokens}]`);
    try {
      const result = await hubVerify("failure", { logs });
      const json = JSON.stringify(result);
      console.log(`Hub: ${json}`);
      return json;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return `Unknown tool: ${name}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[Agent] Starting failure analysis — model: ${AGENT_MODEL}\n`);

  await runAgent(
    "Analyze failure.log and submit a condensed log to the hub. Iterate on feedback until you receive a flag.",
    {
      model: AGENT_MODEL,
      system: `You are an agent analyzing a nuclear power-plant failure log.

Goal: build a condensed log of failure-relevant events and submit it to the hub.

Components: ECCS8, WTRPMP, WTANK07, WSTPOOL2, STMTURB12, FIRMWARE, PWR01.

Strategy:
1. Call search_logs to get deduplicated CRIT+ERRO events for all components at once.
2. Call count_tokens to verify the combined text is under 1200 estimated tokens.
3. If over budget, search per-component and keep only the most severe/unique events.
4. Call submit_logs — read the feedback carefully.
5. If feedback names a missing component, search specifically for that component
   (try WARN level too) and extend your log.
6. Recount, trim if needed, resubmit. Repeat until you receive a flag.

Line format: [YYYY-MM-DD HH:MM] [LEVEL] COMPONENT short description.
One event per line. Keep descriptions concise.`,
      tools: TOOLS,
      maxIterations: 30,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) => {
        const preview = JSON.stringify(args).slice(0, 120);
        console.log(`[Tool] ${name}(${preview}${JSON.stringify(args).length > 120 ? "…" : ""})`);
      },
      onToolResult: (_name, result) => {
        console.log(`       → ${result.split("\n")[0].slice(0, 120)}`);
      },
    },
    handleTool
  );
}

run().catch(console.error);
