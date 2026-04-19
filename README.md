# aiDevs Hub

A local task-execution platform for the aiDevs AI course — 25 challenges across 5 weeks, each solved with Claude (or OpenRouter models), with real-time streaming output and flag tracking.

## Architecture

```
aiDevs/
├── hub/
│   ├── server/       # Hono API server (port 3001)
│   ├── client/       # React + Vite frontend (port 3000 in dev)
│   └── tasks/        # Task implementations
│       ├── week-1/   # S01E01–S01E05
│       ├── week-2/   # S01E06–S01E10 (S02 prefix)
│       ├── week-3/   # S03E11–S03E15
│       ├── week-4/   # S04E16–S04E21
│       ├── week-5/   # S05E22–S05E25
│       └── shared/   # LLM client, hub API helpers, tool agent
└── .env.example      # All required environment variables
```

**Tech stack:** Node.js · TypeScript · Hono · React 18 · Vite · TailwindCSS · Zustand · Anthropic SDK · Playwright · Sharp

## Setup

```bash
npm install
cp .env.example .env
# Fill in .env — at minimum: ANTHROPIC_API_KEY, HUB_API_KEY, HUB_BASE_URL
```

## Running

### Hub UI (recommended)

```bash
npm run dev        # starts both server (3001) and frontend (3000)
```

Open `http://localhost:3000`, pick a task from the sidebar, hit **Run**.

### Individual task via CLI

```bash
npm run task --task=<taskId>
# e.g. npm run task --task=people
```

### All npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start hub server + Vite dev frontend |
| `npm run build` | Build frontend for production |
| `npm run server` | Start hub server only |

## Environment variables

See `.env.example` for the full list with per-task comments. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `HUB_API_KEY` | Yes | Course hub API key |
| `HUB_BASE_URL` | Yes | Course hub base URL |
| `OPENROUTER_API_KEY` | No | Enables non-Anthropic models |
| `OPENROUTER_MODEL` | No | Model ID to use via OpenRouter |
| `MODEL_OVERRIDE` | No | Override default model for all tasks |
| `STEP_ANALYZE_MODEL` | No | Model for analysis steps specifically |

## Tasks

| Episode | Name | Key techniques |
|---------|------|---------------|
| S01E01 | People | CSV filtering, Structured Outputs (Zod) |
| S01E02 | Find Him | Function-calling detective agent |
| S01E03 | MCP | Model Context Protocol server |
| S01E04 | Send It | Package routing + verification |
| S01E05 | Categorize | LLM classification |
| S02E06–S02E10 | Week 2 | Various AI tasks |
| S03E11 | Sensors | Sensor data interpretation |
| S03E12 | Firmware | Code/firmware analysis |
| S03E13 | Reactor | Multi-step reasoning |
| S03E14 | Negotiations | Tool server + ngrok (see `NEGOTIATIONS_PUBLIC_URL`) |
| S03E15 | SaveThem | Rescue logic |
| S04E16 | OKO Editor | Web API data manipulation |
| S04E17 | WindPower | AI-driven scheduling |
| S04E18 | Filesystem | Virtual filesystem construction |
| S04E20 | Food Warehouse | SQLite querying + batch ops |
| S04E21 | RadioMonitoring | Audio transcription + vision |
| S05E22 | PhoneCall | Multi-turn Polish audio TTS conversation |
| S05E23 | Shell Access | Autonomous shell exploration agent |
| S05E24 | Going There | Geolocation + navigation |
| S05E25 | Time Travel | CHRONOS API + temporal state management |

## Notes

- **S03E14 Negotiations** requires a public URL — run `ngrok http 3002` and set `NEGOTIATIONS_PUBLIC_URL`.
- **S05E22 PhoneCall** requires `ffmpeg` and `OPENROUTER_API_KEY` (Gemini 2.0 Flash for transcription).
- **S04E16 OKO Editor** needs `OKO_SKOLWIN_ID` and `OKO_KOMAROWO_ID` from the web panel HTML source.
- Flags captured during runs are tracked in the UI and persisted locally.
