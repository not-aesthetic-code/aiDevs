# Task 18 — Domatowo

## What the task asked for

Navigate an 11×11 ruined city map to find a wounded partisan hiding in one of the tallest buildings, then call a rescue helicopter to evacuate them — all within a strict budget of 300 action points.

## Approach

Pure agentic loop using `runAgent` from `shared/tool-agent.ts`. The agent is given four tools:

- `get_help` — fetches API documentation to understand exact action formats at runtime
- `get_map` — fetches the full terrain map (with optional symbol filtering)
- `get_logs` — reads action logs/results from previous turns
- `send_action` — sends any action object to the hub (create, move, inspect, callHelicopter)

The system prompt encodes the complete cost model and instructs the agent to:
1. First learn the API (get_help), then study the terrain (get_map)
2. Identify tall buildings (partisan's stated hiding location)
3. Favour transporter movement (1 pt/field) over scout foot movement (7 pts/field)
4. Dismount scouts near tall buildings for free, then inspect fields at 1 pt each
5. Call helicopter the instant a scout reports finding the partisan

## Challenges

- The exact API field names for move/create actions aren't known until `get_help` is called at runtime — this is why `send_action` is a single generic tool rather than typed per-action. The agent reads the docs and then constructs the correct payloads.
- The coordinate system (letter+number like "F6") needed to be clearly explained in the system prompt.
- Budget arithmetic is tricky — the prompt includes a worked example to anchor the agent's reasoning.
- Transporters can only use street tiles; scouts are expensive on foot. The prompt emphasises this multiple times to prevent the agent from walking scouts across the whole map.

## Key learnings

- **Generic action tool + help-first pattern**: When the API has many action types with different parameter shapes, a single `send_action` tool combined with a `get_help` step lets the LLM adapt to the actual API contract at runtime rather than requiring hardcoded parameter schemas.
- **Cost model in system prompt**: Encoding exact costs with examples ("2 transporters × 15 pts = 30") gives the agent a concrete mental model for budget tracking.
- **Claim verification**: The partisan's clue ("one of the tallest blocks") is a strong prior — always use domain clues from intercepted messages to narrow the search space before spending points on brute-force inspection.
- **Free dismount**: Emphasising 0-cost dismount prevents the agent from hesitating to deploy scouts — it's never wasteful to dismount if the transporter is already nearby.

## Outcome

- Task type: interactive agent loop against a stateful hub API
- Answer format: the final action is `{"action": "callHelicopter", "destination": "<coordinate>"}` where coordinate is the field where the partisan was found
- Verification: hub returns a flag on successful helicopter call
