# Task 23 — Shell Access

## What the task asked for

The hub exposes a remote shell executor: send `{ cmd: "..." }` to `/verify` and the server runs the command and returns stdout. The `/data/` directory contains archive logs. Goal: find when and where Rafał was discovered, appear there **one day before** (the answer date), and return the city name + GPS coordinates.

## Approach

Agent loop using `runAgent` from `shared/tool-agent.ts`. The single tool — `shell_exec` — wraps `hubVerify(TASK, { cmd })` so the LLM can freely explore the remote filesystem with `ls`, `find`, `cat`, `grep`, etc. The system prompt instructs the agent to:

1. Explore `/data/` recursively
2. Find the date, city, and coordinates of Rafał's discovery
3. Subtract one day from the found date
4. `echo` the JSON — the hub auto-detects the correct format and returns the flag

No separate AI analysis step is needed after exploration because the same agent that reads the files also reasons about them.

## Challenges

- The hub response wraps stdout in JSON (`{ message: "..." }` or similar) — the tool handler returns `JSON.stringify(result)` so the agent can parse whatever the hub sends back.
- Date arithmetic is left to the LLM (subtract 1 day). The system prompt gives an explicit example to avoid off-by-one errors.
- The echo payload must be valid JSON with floating-point coordinates (not strings), so the prompt explicitly states `"longitude": XX.XXXXXX` (number, not `"XX.XXXXXX"`).
- `maxIterations: 40` gives the agent enough budget to explore many files before concluding.

## Key learnings

- Hub-as-shell is a clean pattern: wrapping `hubVerify` in an agent tool turns the entire remote filesystem into a tool-use environment with no extra infrastructure.
- One agent loop can cover both exploration and analysis — no need for a two-phase approach when the exploration output goes straight to the LLM reasoning.
- Keep the system prompt date format example concrete (`YYYY-MM-DD`) and the JSON example literal so the model knows exactly what the final `echo` should look like.

## Outcome

- **Verified** — flag returned successfully
- Final answer:
  ```json
  { "date": "2024-11-12", "city": "Grudziądz", "longitude": 18.968774, "latitude": 53.432303 }
  ```
- The key insight: the relevant log entry was NOT the 2019 time-travel appearance of Rafał Bomba (`pojawia się`) but the **2024 body discovery** (`W jaskini znaleziono ciało mężczyzny`) at `entry_id=954634` (type=`jaskinia`/cave) on 2024-11-13 → appear one day before = 2024-11-12.
- The CSV has 4 columns: `date;description;location_id;entry_id` where `location_id` references `locations.json` and `entry_id` references `gps.json`.
- No extra env vars needed beyond `HUB_API_KEY` and `HUB_BASE_URL`.
