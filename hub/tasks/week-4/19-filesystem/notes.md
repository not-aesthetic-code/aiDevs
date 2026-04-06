# Task 18 — Filesystem

## What the task asked for

Build a virtual filesystem via an API based on Natan's trade notes (a zip archive). The filesystem needs three directories:
- `/miasta/{city}` — JSON object of goods the city **needs** with quantities (no units)
- `/osoby/{PersonName}` — person's name and a markdown link to the city they manage
- `/towary/{good}` — markdown link to the city that **sells** that good

The good names must be in Polish singular nominative form. File names must not contain Polish diacritics.

## Approach

1. Called `help` action first to understand available API operations.
2. Downloaded `natan_notes.zip` from the hub, extracted to a temp directory, and concatenated all text files.
3. Sent the combined notes to an LLM (Claude) with a Polish-language system prompt instructing it to return structured JSON with `cities` (name, needs, sells) and `people` (name, city).
4. Transliterated Polish diacritics in all file names (ą→a, ę→e, ł→l, etc.).
5. Used batch mode to reset the filesystem and create all dirs + files in a single `/verify/` request.
6. Called `done` to trigger hub validation.

## Challenges

- The task description had garbled text at the end: "w nazwach plików nie używamy ph" — interpreted as "polskich liter" (Polish diacritics), which is the most sensible reading. Applied transliteration to all paths.
- Distinguishing city **needs** (demand / `/miasta`) from city **sells** (supply / `/towary`) required careful prompt engineering since the same notes describe both.
- Good names must be in singular nominative Polish — LLM handles this well since it understands Polish morphology.
- The batch mode sends `answer` as an array instead of an object — `hubVerify(TASK, ops[])` works because hub.ts just passes `answer` directly.

## Key learnings

- The `hubVerify` helper accepts both single objects and arrays as `answer` — no special batch function needed.
- Temp directory + `execSync(unzip ...)` is the simplest reliable approach for ZIP extraction in Node.js without extra dependencies.
- Polish notes analysis benefits from a Polish-language system prompt — the LLM maintains Polish morphological awareness better when prompted in the same language.
- Transliteration should be applied at the path level only, not to content (person files contain the original name with diacritics).

## Outcome

- Task verified successfully via the `done` action.
- Final answer format: batch array of `createDir` and `createFile` operations sent in one POST, then `done`.
