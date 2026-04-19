# aiDevs — Claude Code Guide

## Repo layout

```
hub/
  server/          # Hono API server (port 3001)
    lib/           # job-store, runner, settings-store, task-registry
    router/        # tasks, run, stream, settings
  client/          # React + Vite frontend (port 3000 in dev)
  tasks/
    week-1..5/     # Task implementations (one index.ts each)
    shared/        # llm.ts, hub.ts, config.ts, tool-agent.ts, geo.ts
```

Root `package.json` has convenience scripts only. Everything real lives in `hub/`.

## Running

```bash
npm run hub          # starts both Vite dev frontend + Hono server
cd hub && npm test   # run vitest test suite
```

## How tasks work

Each task is a plain Node.js script that:
1. Reads config from env vars (never hardcoded)
2. Calls `hubVerify(taskId, answer)` from `shared/hub.ts` to submit answers
3. Prints `{FLG:...}` flags to stdout — the hub UI captures them automatically

The server discovers tasks via `server/lib/task-registry.ts`, spawns them as child processes (`tsx`), and streams stdout/stderr over SSE.

## Environment variables

All keys come from `.env` (copied from `.env.example`). Minimum required:
- `ANTHROPIC_API_KEY`
- `HUB_API_KEY`
- `HUB_BASE_URL`

Optional model routing:
- `MODEL_OVERRIDE` — overrides default model globally
- `USE_OPENROUTER=1` + `OPENROUTER_MODEL` — routes through OpenRouter instead of Anthropic
- `STEP_ANALYZE_MODEL` — model used only for analysis steps in tasks that support it

## Security rules

- Never hardcode `HUB_BASE_URL`, task IDs, flags, or API keys — always env vars
- Hub validators may check **exact Polish phrases** — copy wording verbatim from task descriptions
- The `.env` file must never be committed

## LLM client (`shared/llm.ts`)

```ts
import { chat } from "../shared/llm.js";
const reply = await chat([{ role: "user", content: "..." }], { system: "..." });
```

Routes to Anthropic or OpenRouter based on `USE_OPENROUTER` env var. Default model: `claude-haiku-4-5-20251001`.

## Audio tasks (S05E22 PhoneCall)

Use **gTTS** (`pip install gtts`) for TTS — not macOS `say`. Audio must be ≥ 20k bytes. Use lowercase when generating passwords.

## Noteworthy task quirks

- **S03E14 Negotiations**: needs a public URL — run `ngrok http 3002`, set `NEGOTIATIONS_PUBLIC_URL`
- **S04E16 OKO Editor**: `OKO_SKOLWIN_ID` / `OKO_KOMAROWO_ID` found in the web panel HTML source
- **S05E25 Time Travel**: CHRONOS API web UI at `${HUB_BASE_URL}/timetravel_preview`

## Tests

```bash
cd hub && npm test
```

Tests live in `server/lib/__tests__/`. Vitest, no external dependencies needed.
