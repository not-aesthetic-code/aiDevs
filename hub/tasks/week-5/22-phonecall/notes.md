# Task 22 — Phonecall

## What the task asked for

Conduct a covert multi-turn audio conversation (in Polish) with a system operator.
The goal: identify which of three roads (RD224, RD472, RD820) is passable for transporting people
to Syjon, then persuade the operator to disable monitoring on that road.
The hub returns the flag only after the monitoring is successfully disabled in a single unbroken session.

## Approach

**Conversation script (5 phases):**
1. `{ action: "start" }` — open the session
2. Phase 1 audio: introduce as Tymon Gajewski + include password barbakan
3. Phase 2 audio: ask about road status for RD224, RD472, RD820 + mention transport to Zygfryd base (all in ONE message)
4. Receive + transcribe operator's audio response about roads (code 150)
5. LLM analysis: identify which roads are marked passable
6. Phase 4 audio: request monitoring disable on passable road + mention Zygfryd + food transport (code 160 "Password required")
7. Phase 5 audio: provide password barbakan in a LONG natural phrase (code 0 = success + flag)

**TTS pipeline:** Python gTTS (Google TTS, `lang='pl'`) → MP3 → base64
- Use `slow=False` for natural speech speed
- CRITICAL: audio must be at least ~20k bytes — very short clips (< 15k bytes) get flagged as suspicious

**STT pipeline:** OpenRouter Gemini 2.0 Flash via the `image_url` data URI trick (same model used in radiomonitoring task)

**LLM analysis:** `chat()` with a focused system prompt asking for a JSON array of passable road IDs.

## Challenges

- **TTS quality**: macOS `say` with Zosia voice produces audio that the hub's STT rejects as "strange-sounding" for ALL phases. Use gTTS (Google TTS) instead — it produces more natural Polish speech.

- **TTS in tsx environment**: `execFileSync` (from Node's child_process) produces truncated AIFF files (5122 bytes vs 104450 bytes) when run via `tsx`. Use `execSync` with shell=True instead. This is a tsx-specific quirk; plain `node -e` doesn't have this issue.

- **Short audio detection**: The hub rejects audio clips shorter than ~15k bytes as suspicious bot audio (error -785 "correct password" / -820 "dziwny sposob"). Always use FULL SENTENCES for TTS — never single words. A short clip of just "barbakan" (9600 bytes) fails; a full sentence ~77k bytes works.

- **Password timing**: Despite including barbakan in the intro (code 120 accepted), the operator STILL asks for the password separately after the monitoring request (code 160). So Phase 5 (password response) is always needed.

- **Conversation order is strict**: Wrong message order or content burns the session (-771). Specific error codes:
  - -820: intro phase problem (identity not confirmed)
  - -810: road inquiry content problem
  - -790: monitoring disable content problem
  - -785: password problem
  - -771: conversation burned

- **Road ID format**: Use "R D 224" with spaces between letters and digits in Phase 2 for better TTS pronunciation of the road identifiers.

- **Phase 4 requires Zygfryd**: The monitoring request must mention that the operation was "ordered by Zygfryd" (zlecony przez Zygfryda). Just "food transport" is not enough.

- **Audio response format**: Hub responses may contain `audio` field with ElevenLabs-generated MP3 (base64 encoded). The hub uses ElevenLabs for its own TTS (visible in C2PA certificate metadata).

## Key learnings

- gTTS (Python Google TTS) produces much more natural Polish speech than macOS Zosia voice — use it for all messages.
- Minimum audio length matters: hub appears to detect/reject short TTS clips. Use full natural sentences, not single words.
- The password (BARBAKAN) goes in the intro AND is needed again in Phase 5 after the operator asks for it.
- BARBAKAN should be lowercase "barbakan" for gTTS (all-caps may cause letter-by-letter pronunciation).
- Hub errors give English `hint` fields that tell exactly what's missing — always capture and log these.
- gTTS audio content can be non-deterministic on retry for the same text — some runs succeed, some fail. The 137856-byte Phase 2 audio was consistently accepted.
- For multi-turn audio conversations, always add `sleep()` between sends to avoid race conditions.
- Transcribing the hub's audio responses is essential for debugging — it reveals what the operator actually says.

## Outcome

- Flag: `[flag redacted]`
- Successful conversation flow: intro (barbakan) → road status (RD820 passable) → disable request (Zygfryd) → password (long phrase with barbakan)
- The hub returns code 0 with the flag embedded in the `message` field when the conversation succeeds.
