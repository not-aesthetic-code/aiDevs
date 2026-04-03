# Task 15 — SaveThem

## What the task asked for

Build an agent that plans the optimal route for a messenger to reach the city of Skolwin on a 10×10 terrain grid. The agent starts with 10 fuel units and 10 food units. Moving by vehicle consumes both; faster vehicles cost more fuel per move but less food, slower ones vice versa. The messenger can abandon the vehicle and walk (0 fuel cost, highest food cost). Only a toolsearch endpoint is provided — all other tools must be discovered dynamically.

## Approach

**Data gathering (Phases 1–2):**
- Called `toolsearch` with several natural-language queries (map, vehicles, movement rules) to find tool URLs.
- Called each discovered tool with descriptive queries to get raw JSON.
- Multiple queries per category ensure coverage (toolsearch only returns 3 best-matching results per call).

**Data extraction (Phase 3):**
- Used LLM (`chat()`) to parse raw JSON into typed structures: `MapGrid`, `Vehicle[]`, `MovementRules`.
- Prompted the LLM to use standardized terrain labels (road, grass, forest, mud, water, rock, etc.) and to always include a "foot" (walking) vehicle entry.
- Fallback defaults applied when rules data is absent.

**Pathfinding (Phase 4):**
- BFS over state space `(row, col, fuel×10, food×10, onFoot)`.
- Multiply fuel/food by 10 to represent fractional costs (e.g. 0.5 per move) as integers in the visited set.
- Both "continue by vehicle" and "switch to foot" transitions are modelled at every state — switching to foot is irreversible.
- Iterates over all discovered vehicles and picks the one yielding the shortest path.

**Submission (Phase 5):**
- Answer format: `["vehicle_name", "right", "up", ...]` submitted via `hubVerify`.

## Challenges

- **Unknown data formats**: Toolsearch responses and individual tool responses can have varying JSON shapes. Used `extractToolUrls()` to probe multiple field names (`url`, `URL`, `endpoint`, `href`, …).
- **Fractional fuel/food costs**: BFS visited-set keys must use exact values; multiplying by 10 converts decimals like 0.5 to integers 5, avoiding float comparison issues.
- **3-result cap per tool call**: Each tool only returns 3 best-matching entries. Used multiple distinct queries to increase coverage (e.g. different phrasing for vehicles).
- **LLM parsing reliability**: Raw tool responses may differ significantly from expected format. Wrapped every `llmExtract` in try/catch with sensible defaults.

## Key learnings

- **Toolsearch pattern**: When only a search endpoint is given, issue several differently-worded queries in parallel (`Promise.allSettled`) to maximise the chance of finding the right tool URL.
- **Scale-by-N trick for fractional BFS**: Multiplying discrete costs by a constant before storing in the visited set avoids floating-point equality bugs without losing precision.
- **Vehicle-agnostic pathfinding**: Modelling foot/vehicle switching inside BFS means the algorithm automatically finds hybrid strategies (start by vehicle, finish on foot) without special-casing.
- **LLM as a flexible JSON adapter**: Rather than writing brittle hand-coded parsers for every possible API shape, a short LLM prompt that describes the desired output schema is more robust across unseen formats.

## Outcome

- Submitted as `["vehicle_name", dir, dir, ...]` to `/verify` with `task: "savethem"`.
- Flag appears in the hub preview at `/savethem_preview.html` and in the verify response on success.
