/**
 * Shell Access Task (S05E23)
 *
 * The hub API acts as a remote shell executor:
 *   POST /verify { task: "shellaccess", answer: { cmd: "..." } }
 *   → hub executes the command on its server and returns the output.
 *
 * Goal: explore /data/ logs on the remote server to find when/where Rafał was
 * discovered, then output a JSON with the date ONE DAY BEFORE his finding,
 * the city, and GPS coordinates. The hub auto-detects the correct JSON and
 * returns a flag.
 *
 * Flow:
 *   agent loop → shell_exec tool → hubVerify({ cmd }) → explore /data/ → echo JSON → flag
 */

import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";
import { runAgent } from "../../shared/tool-agent.js";
import type { ToolDef, ToolHandler } from "../../shared/tool-agent.js";

const TASK = "shellaccess";

// ── Tools ─────────────────────────────────────────────────────────────────────

const tools: ToolDef[] = [
  {
    name: "shell_exec",
    description:
      "Execute a shell command on the remote server and return its output. " +
      "Use standard Linux tools: ls, find, cat, grep, head, tail, wc, etc. " +
      "The working directory is the server root. /data/ contains the archive logs.",
    parameters: {
      type: "object",
      properties: {
        cmd: {
          type: "string",
          description: "Shell command to run (e.g. 'ls /data/', 'cat /data/report.txt', 'grep -r Rafał /data/')",
        },
      },
      required: ["cmd"],
    },
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a forensic analyst with remote shell access to an archive server.
Your mission: find the date and location where Rafał was discovered/found, then submit the answer.

## Steps

1. Explore /data/ with: ls /data/, find /data/ -type f, cat <file>, grep -r "Rafał" /data/
2. Read ALL relevant log files carefully. Look specifically for entries where Rafał's body was found ("znaleziono ciało", "odnaleziono").
3. Extract from that entry:
   - The exact date Rafał was found/discovered
   - The city (look up location_id in locations.json)
   - The GPS coordinates (look up entry_id in gps.json)
3. Compute the answer date: ONE DAY BEFORE the date Rafał was found.
   Example: if found on 2024-05-15, the answer date is 2024-05-14.
4. Once you have all four values, run exactly this command (with real values):

   echo '{"date":"YYYY-MM-DD","city":"nazwa miasta","longitude":XX.XXXXXX,"latitude":XX.XXXXXX}'

   This triggers automatic validation and returns the flag.

## Rules
- Date format: YYYY-MM-DD (ISO 8601)
- City name: exact Polish name from the logs
- longitude and latitude: floating-point numbers (not strings)
- The echo JSON must be syntactically valid — no trailing commas, no extra text
- Read ALL files before concluding — the answer may be spread across multiple files
- Do not stop until you have executed the echo command with the correct JSON`;

// ── Tool handler ──────────────────────────────────────────────────────────────

const handleTool: ToolHandler = async (name, args) => {
  if (name !== "shell_exec") return "Unknown tool";

  const cmd = args.cmd as string;
  console.log(`[Tool] $ ${cmd}`);

  try {
    const result = await hubVerify(TASK, { cmd });
    const text = JSON.stringify(result);
    console.log(`[Tool] → ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`);
    return text;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[Tool] Error: ${msg}`);
    return `Error: ${msg}`;
  }
};

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  console.log("=== Shell Access Task ===");
  console.log(`[Start] ${new Date().toISOString()}`);

  const model =
    process.env.STEP_ANALYZE_MODEL ??
    process.env.MODEL_OVERRIDE ??
    "claude-sonnet-4-6";

  console.log(`[Model] ${model}`);

  await runAgent(
    "Start by listing /data/ and exploring all log files to find when and where Rafał was discovered/found (look for 'znaleziono', 'odnaleziono', 'ciało'). Then submit the JSON answer.",
    {
      model,
      system: SYSTEM_PROMPT,
      tools,
      maxIterations: 40,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) =>
        console.log(`[Tool Call] ${name}(${JSON.stringify(args)})`),
      onToolResult: (name, result) =>
        console.log(`[Tool Result] ${name}: ${result.slice(0, 300)}${result.length > 300 ? "…" : ""}`),
    },
    handleTool
  );

  console.log("=== Done ===");
}

main().catch(console.error);
