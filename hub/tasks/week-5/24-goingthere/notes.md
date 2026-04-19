# Task 24 — Going There (goingthere)

## What the task asked for

Navigate a virtual rocket across a 3-row × 12-column grid to reach a base in Grudziądz. Each column contains exactly one rock that the rocket must avoid. Navigation is blind — the only way to learn a column's rock position is via a radio hint API that speaks English (sometimes using nautical language). On top of that, unknown columns along the route contain OKO radar traps; entering a trapped column without disarming the trap destroys the rocket. Both the scanner and the game API randomly return errors or distorted data and must be retried robustly.

## Approach

**Data flow per move:**
1. `start` → hub returns current position (col 1, row 2) + target row → LLM extracts target row from potentially unstructured response.
2. Loop columns 1 → 11 (11 moves reach col 12):
   - GET `/api/frequencyScanner` → parse distorted JSON (3 strategies: direct parse, cleaned parse, regex extraction).
   - If radar detected: compute `SHA1(detectionCode + "disarm")`, POST to disarm, re-check.
   - POST `/api/getmessage` → get English hint about rock in the next column.
   - LLM (claude-haiku default, overrideable via `STEP_ANALYZE_MODEL`) receives hint + current row + target row → returns `{"rockRow": N, "command": "go|left|right", "reasoning": "..."}`.
   - Execute command via hub `/verify`; check response for flag or crash.
   - Update tracked position: "left" = row+1 (up), "right" = row-1 (down).
3. On crash: restart entire game, up to 5 attempts.

**LLM prompt design:** The grid orientation (row 1 = bottom/starboard, row 3 = top/port) and the exact constraint (avoid rock row, stay within 1–3, prefer target row) are spelled out explicitly. The model never needs to guess orientation.

## Challenges

- **Distorted JSON from the scanner**: The task explicitly warns about corrupted packets. Three-tier parsing (JSON.parse → clean + parse → regex) handles this. The regex patterns specifically target the two required fields (`frequency`, `detectionCode`).
- **Random API errors**: Wrapped every external call in `withRetry()` with exponential backoff (1 s, 2 s, 4 s…). The hub command itself can error-loop because `hubVerify` throws on non-2xx.
- **Nautical language in hints**: Hints use terms like "port", "starboard", "bow", "dead ahead". The LLM prompt includes an interpretation guide mapping each term to a row number, removing ambiguity.
- **Direction ambiguity ("left" vs row+1)**: The task description says `left` = "wyższy wiersz" (higher row) = "góra" (up). This means row 3 = top = "left/port" side. Including this in the LLM prompt prevents mirrored navigation.
- **Parsing target row**: The start response format is undocumented and may vary. LLM extracts it first; regex on several plausible field names serves as fallback; row 2 is the last resort.

## Key learnings

- A three-tier JSON parsing strategy (parse → clean → regex) is worth having ready for any task that warns about data corruption. Extracting individual fields with regex is surprisingly reliable even on garbage input.
- For game-like tasks with a well-defined loop, isolating the game logic in a `runGame()` function that returns success/null makes restart logic clean and avoids recursion.
- Giving the LLM an **explicit orientation table** (port=row 3, starboard=row 1) in the prompt eliminates an entire class of navigation failures that would otherwise require debugging blind.
- Safety override in code (bounds check after LLM command) adds a cheap second layer of defence against hallucinated out-of-bounds moves.

## Outcome

- Expected to verify successfully when `HUB_API_KEY` and `HUB_BASE_URL` are set.
- The flag is returned in the movement response upon arriving at column 12, target row.
- Final answer format: the hub returns a JSON response containing `{{FLG:...}}` on success.
