# Task 17 — Wind Power

## What the task asked for

Schedule a wind turbine to:
1. Protect blades during storm conditions (wind exceeding turbine's rated maximum) by feathering the blades (pitchAngle=90) and idling the turbine.
2. Enable power production at the best safe-wind window required by the plant, using full blade capture (pitchAngle=0) and production mode.

Every config entry must be signed with an MD5 unlock code obtained from a hub-side generator. The entire workflow — from opening the service window to calling `done` — must complete within **40 seconds**.

## Approach

**The 40-second constraint forces parallel execution at every stage.**

1. Call `help` to discover action names (the task description gives hints but not exact names).
2. Call `start` to open the maintenance window and start the countdown.
3. Immediately fire `weatherForecast`, `turbineStatus`, and `powerRequirements` **in parallel** via `Promise.all`. Each returns a `requestId` (async job queue pattern).
4. Poll all three results concurrently with `Promise.all(pollResult(...))`.
5. Analyse: iterate forecast to find hours where `windSpeed > maxWindSpeed` (storms) and the best safe production slot within the power requirement window.
6. Call `unlockCodeGenerator` for every config entry **in parallel**; poll results concurrently.
7. Submit the bulk `config` payload.
8. Call `turbinecheck`, then `done`.

Config datetime format: `"YYYY-MM-DD HH:00:00"` — minutes and seconds always zero.

## Challenges

- **Unknown action names**: The task description doesn't give exact API action names for weather/turbine/power queries. The `help` call must be read first to determine them. The initial implementation used best-guess names (`weatherForecast`, `turbineStatus`, `powerRequirements`) that may need adjustment based on the actual help response.
- **Polymorphic response shapes**: The hub API often wraps results differently across tasks (`.data`, `.result`, `.forecast`, etc.). Used a multi-fallback extractor pattern to handle this gracefully.
- **Polling ambiguity**: It's unclear whether `getResult` takes a `requestId` parameter or just returns the next queued result. Implemented with `requestId` first; if the API doesn't accept it, adjust to a round-robin polling pattern.
- **unlockCodeGenerator inputs**: Not specified which exact fields the generator signs. Sent `datetime + pitchAngle + turbineMode`; may need adjustment.

## Key learnings

- **Parallel `Promise.all` is essential** when an API uses async job queues and you have a strict wall-clock deadline.
- The hub's async pattern (queue → requestId → getResult) is reusable across multiple tasks — worth extracting into `shared/` if seen again.
- Always log full API responses (`JSON.stringify`) on first run — with async/queued APIs the exact response shape is easy to misread from docs alone.
- `toConfigDateTime` normalising all datetimes to `HH:00:00` prevented subtle validation failures from fractional hours in the forecast.

## Outcome

- Not yet verified (first implementation — needs a live run to confirm action names and response shapes).
- Expected output: a flag returned in `doneRes.message` after successful `done` call.
- Key shape: `configs` object keyed by `"YYYY-MM-DD HH:00:00"` with `pitchAngle`, `turbineMode`, `unlockCode`.
