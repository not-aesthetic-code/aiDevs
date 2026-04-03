# Task 16 — OKO Editor

## What the task asked for

Modify records in the OKO Operational Centre system via a "back door" API endpoint at `/verify`. Three changes required:
1. Reclassify the Skolwin city incident from "vehicles + people" (MOVE03) to "animals" (MOVE04).
2. Mark the Skolwin city task as done, writing "bobry" (beavers) in the content field.
3. Plant a false human-movement incident near Komarowo city to redirect operator attention.

## Approach

1. Called `action: "help"` on the hub API to discover available commands (`update`, `done`).
2. Read the OKO web panel (read-only) to discover all record IDs — each page (incydenty, notatki, zadania) shares a set of 32-char hex IDs.
3. Found the coding methodology in the notatki page: MOVE01=human, MOVE02=vehicle, MOVE03=vehicle+human, MOVE04=animals.
4. Applied the three `update` calls via API (no web panel edits).
5. Called `done` to verify and receive the flag.

## Challenges

- **Ban mechanism**: Visiting the web panel with the Zofia credentials triggers a session ban on the API key. The ban is lifted only by logging out through the web interface. This wasted several iterations.
- **State reset**: Each time the web panel session was opened, the API state appeared to reset — requiring all three updates to be re-applied.
- **-700 error loop**: The "note's content does not meet requirements" error (-700) took many iterations to crack. The key was the exact Polish phrasing: `"ruch ludzi"` (movement of people) is what the validator checks for, NOT `"ruch ludzki"` (human movement). Both mean the same thing colloquially but the validator is literal.
- **Rate limiting**: The hub API has a per-key rate limit (error -9999). Need ~60s pause before retrying after hitting it.
- **Creating new records**: The API has no `add` action — only `update` on existing IDs. To "add" a Komarowo incident, an existing incydenty entry (ID `351c0d9c90d66b4c040fff1259dd191d`) was repurposed.
- **Incident ID discovery**: IDs are only discoverable via the web panel or by reading HTML source — not exposed via the verify API itself.

## Key learnings

- Always call `action: "help"` first and read the full API description before attempting any updates.
- "Back door" APIs may have hidden state tied to other sessions — avoid touching the web UI while the API session is active.
- When a validator rejects content with a generic error, try matching the **exact wording** from the task description — "ruch ludzi" vs "ruch ludzki" was the critical difference.
- Error code progression is diagnostic: -720 → ticket code wrong, -710 → zadania not done, -700 → Komarowo content wrong. Track which codes disappear as you fix things.
- All updates must be applied in the same run and `done` called immediately after — the state appears session-scoped.

## Outcome

- Verified successfully with `code: 0`.
- Flag format: `[flag redacted]`.
- Three `update` calls + one `done` call — no LLM required.
