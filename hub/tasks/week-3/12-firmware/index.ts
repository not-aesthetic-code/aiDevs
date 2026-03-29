/**
 * Firmware Task
 *
 * Architecture (agent loop):
 *   An agent explores a constrained Linux VM via a shell API, finds the
 *   password for /opt/firmware/cooler/cooler.bin, fixes its settings.ini,
 *   runs the binary with correct parameters, and extracts the ECCS-... code
 *   to submit to the hub.
 *
 * Shell API: POST {HUB_BASE_URL}/api/shell
 *   { "apikey": "...", "cmd": "<command>" }
 */

import "dotenv/config";
import { HUB_API_KEY, hubVerify } from "../../shared/hub.js";
import { runAgent, type ToolDef } from "../../shared/tool-agent.js";
const SHELL_API_URL = `${process.env.HUB_BASE_URL ?? ""}/api/shell`;
const AGENT_MODEL = process.env.MODEL_OVERRIDE?.trim() || "claude-sonnet-4-6";

// ── Shell API ─────────────────────────────────────────────────────────────────

async function shellExec(cmd: string): Promise<string> {
  console.log(`[Shell] $ ${cmd}`);
  let attempt = 0;
  while (attempt < 5) {
    try {
      const res = await fetch(SHELL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: HUB_API_KEY, cmd }),
      });

      const text = await res.text();

      // Rate-limit / ban detection — wait and retry
      if (res.status === 429 || res.status === 503 || text.includes("banned") || text.includes("rate")) {
        const waitMatch = text.match(/(\d+)\s*s/i);
        const wait = waitMatch ? parseInt(waitMatch[1], 10) * 1000 : 5000;
        console.log(`[Shell] Rate-limited / banned. Waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { output: text };
      }

      const result = JSON.stringify(parsed);
      console.log(`[Shell] ${result.slice(0, 300)}${result.length > 300 ? "…" : ""}`);
      return result;
    } catch (err) {
      attempt++;
      console.log(`[Shell] Network error (attempt ${attempt}): ${String(err)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return JSON.stringify({ error: "Shell API unreachable after 5 attempts" });
}

// ── Agent loop ────────────────────────────────────────────────────────────────

async function runFirmwareAgent(): Promise<string | null> {
  console.log(`\n[Agent] Starting firmware agent — model: ${AGENT_MODEL}`);

  let foundCode: string | null = null;

  const TOOLS: ToolDef[] = [
    {
      name: "shell",
      description:
        "Execute a single shell command on the virtual machine via the shell API. " +
        "The VM uses a non-standard command set — start with 'help' to discover available commands. " +
        "Returns the JSON response from the API. " +
        "Rate limits or bans are handled automatically by the wrapper.",
      parameters: {
        type: "object",
        properties: {
          cmd: {
            type: "string",
            description: "The shell command to execute.",
          },
        },
        required: ["cmd"],
      },
    },
    {
      name: "submit_code",
      description:
        "Submit the ECCS-... confirmation code to the hub to complete the task. " +
        "Use this once you have obtained the code from running cooler.bin.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The confirmation code in format ECCS-xxxxxxxx...",
          },
        },
        required: ["code"],
      },
    },
  ];

  async function handleTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (name === "shell") {
      return shellExec(args.cmd as string);
    }
    if (name === "submit_code") {
      const code = args.code as string;
      console.log(`[Agent] Submitting code: ${code}`);
      const result = await hubVerify("firmware", { confirmation: code });
      const json = JSON.stringify(result);
      console.log(`[Hub] ${json}`);
      foundCode = code;
      return json;
    }
    return `Unknown tool: ${name}`;
  }

  const systemPrompt = `You are an agent operating on a constrained Linux VM via a shell API.
Your goal: run /opt/firmware/cooler/cooler.bin and extract the ECCS-... code it outputs.

SECURITY RULES (must not violate or you will be banned):
- Do NOT access /etc, /root, or /proc/ directories
- Respect .gitignore files — do not touch listed files/directories
- You are a regular user, not root

APPROACH:
1. Start with the 'help' command to discover available commands (the shell is non-standard).
2. Explore the filesystem to understand the binary and its configuration:
   - Check /opt/firmware/cooler/ for cooler.bin and any config files (settings.ini)
   - Find the password/access credentials stored somewhere in the system
3. Fix settings.ini if needed (the hints say the software doesn't work correctly)
4. Run the binary with the correct parameters/password
5. Extract the ECCS-xxxxxxxx... code from the output
6. Call submit_code with the extracted code

IMPORTANT:
- The shell may have non-standard editing commands (not vim/nano). Check 'help' output carefully.
- File editing likely uses a special API command, not standard text editors.
- The password may be stored in /home, /var, /tmp, or other accessible locations.
- If something fails, read the error, adapt, and try a different approach.
- Work step by step — one command at a time, reading each result before proceeding.`;

  await runAgent(
    "Explore the VM, find the password, fix cooler.bin's settings.ini if needed, run it, extract the ECCS-... code, and submit it.",
    {
      model: AGENT_MODEL,
      system: systemPrompt,
      tools: TOOLS,
      maxIterations: 60,
      onText: (text) => console.log(`[Agent] ${text}`),
      onToolCall: (name, args) => {
        const preview = JSON.stringify(args).slice(0, 200);
        console.log(`[Tool] ${name}(${preview})`);
      },
      onToolResult: (_name, result) => {
        const firstLine = result.split("\n")[0].slice(0, 300);
        console.log(`       → ${firstLine}`);
      },
    },
    handleTool
  );

  return foundCode;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Firmware Task ===");
  console.log(`Agent model : ${AGENT_MODEL}`);
  console.log(`Shell API   : ${process.env.HUB_BASE_URL ?? ""}/api/shell`);
  console.log("");

  const code = await runFirmwareAgent();

  if (code) {
    console.log(`\n[Done] Submitted code: ${code}`);
  } else {
    console.log("\n[Warning] Agent finished without submitting a code.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
