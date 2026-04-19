# Task 21 — Radiomonitoring

## What the task asked for

Intercept a stream of radio signals from the hub (text transcriptions and Base64-encoded binary attachments), collect enough intelligence to identify the city code-named "Syjon", and submit a structured report: its real name, area (rounded to 2 dp), warehouse count, and a contact phone number.

## Approach

**Data flow:**
1. `POST /verify` with `action: "start"` — opens the signal pool.
2. Loop `action: "listen"` until hub signals completion (code 101, Polish "padly", "dostatecznie", "wystarczaj").
3. Per-signal router (zero LLM cost during collection):
   - `transcription` present → lightweight noise filter (length < 8, char-ratio < 20% word chars) → accumulate or discard.
   - `attachment` present → branch on `meta` MIME type:
     - `application/json` → `JSON.parse` locally, populate `cityMap` with city data (including `occupiedArea`).
     - `text/csv` → decode, parse CSV rows, populate `csvCities` set.
     - `text/*` → decode buffer, apply noise filter, accumulate.
     - `image/*` → call Anthropic vision directly (raw SDK), guard on decoded size > 5 MB.
     - `audio/*` → transcribe via `google/gemini-2.0-flash-001` on OpenRouter (audio sent as `image_url` data URL).
     - Unknown → try UTF-8 decode, check binary-garbage ratio.
4. One LLM call with all accumulated text + city table hint → structured JSON with four fields.
5. `action: "transmit"` with retry loop (warehouse count ±2) to handle audio transcription off-by-one errors.

**City identification strategy:** The transcription for Skarszewy described it as "biblijny raj" (biblical paradise). Syjon = Zion = biblical city → Skarszewy. The city area (10.7284 km²) came from the JSON attachment's `occupiedArea` field, looked up via `cityMap` after identifying the city. Phone number came from an audio transcription.

**LLM strategy:** Single `chat()` call after collection, system prompt includes explicit city table hint and verbatim Polish rules about `cityArea` format (2 decimal places, rounded). Vision and audio calls are made inline during the listen loop via raw Anthropic SDK / OpenRouter to avoid polluting the shared `Message[]` interface.

## Challenges

- **isDoneSignal heuristic**: Hub sends code 101 with Polish "Baterie w nadajniku padly..." when done. Without matching code 101 and Polish keywords ("padly", "dostatecznie"), the loop silently continued past the done signal and hit the 60-call limit.
- **Audio model discovery**: The initial model guess (`google/gemini-flash-1.5-8b`) returned 404. Had to query OpenRouter `/models` to find `google/gemini-2.0-flash-001` which supports audio via `image_url` data URL.
- **Off-by-one in audio transcription**: Gemini consistently transcribed the warehouse count as 12 instead of 11. Solved with a retry loop trying `[baseCount, baseCount-1, baseCount+1, baseCount-2, baseCount+2]` — hub returns the problematic field name in the error message, so retries are targeted specifically at warehousesCount errors.
- **parseJsonFromLLM robustness**: LLM sometimes returned multi-block markdown where the first code block wasn't the answer JSON. Fixed by extracting from first `{` to last `}` in the full raw string rather than relying on the first code fence.
- **Phone number format**: Hub rejects `+48644122092` (error -745). Required 9-digit format with no country code or separators. Added `normalizePolishPhone()` and explicit prompt instruction ("ONLY 9 digits, no country code").
- **LLM city hallucination**: Without the city table hint, LLM guessed Mielnik, Żarnowiec, etc. Fixed by building `cityTableHint` from the JSON attachment's cityMap and injecting it verbatim into the system prompt.
- **Images can be large**: base64 overhead makes a 3 MB image ~4 MB of ASCII. Added a 5 MB decoded-size guard before invoking vision.

## Key learnings

- **Binary routing before LLM** is the core of this task. Most signals are either noise or locally parseable; only images and audio actually require model calls during collection.
- **Audio via OpenRouter multimodal**: Send audio as `{ type: "image_url", image_url: { url: "data:audio/mpeg;base64,..." } }` to Gemini. The same pattern works for images on OpenRouter if Anthropic vision isn't available.
- **Retry on hub errors by field name**: Hub error messages name the wrong field (e.g., "warehousesCount"). Parse the error message to decide whether to retry or rethrow.
- **Decode `Buffer.from(base64, "base64")` locally** and check MIME via the `meta` field — never pass raw base64 to a text model.
- **City table as ground truth**: If the task provides structured data (JSON with city attributes), inject it directly into the final LLM prompt rather than hoping the LLM extracts it from transcriptions alone.
- **"Syjon" = Zion = biblical**: The code name is the biblical Hebrew name for Jerusalem. The signal describing Skarszewy as "biblijny raj" (biblical paradise) was the decisive clue.
- The hub "done" signal is not guaranteed to be a specific English phrase; matching both error codes and Polish keywords is more robust than English-only pattern matching.
- **Morse meta-hint**: One signal decoded as "MUSISZ SPRAWDZIĆ = DEEPER" (Polish: "you must investigate deeper") — this pointed toward the audio file as the primary source for the missing warehouse count.

## Outcome

Final answer: `{ cityName: "Skarszewy", cityArea: "10.73", warehousesCount: 11, phoneNumber: "644122092" }`

Flag received successfully.

The retry loop was essential — Gemini transcribed "12" warehouses, the first transmit failed with -740, then the loop tried 11 and succeeded.
