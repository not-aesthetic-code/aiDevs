# Task 25 — Time Travel (CHRONOS-P1)

## What the task asked for

Operate a fictional pocket time machine (CHRONOS-P1) via a combination of API calls and manual web UI interactions to execute a 3-jump sequence:
1. Forward jump to 5 November 2238 (collect new batteries from an agent)
2. Return jump to 10 April 2026 (back to the present)
3. Open a time tunnel to 12 November 2024 (meet Rafał — the final destination)

The device requires exact configuration across two surfaces: API-settable params (day/month/year/syncRatio/stabilization) and web-UI-only params (PT-A, PT-B, PWR slider, standby↔active toggle). A CLI assistant was required to handle the API side and guide the operator through the manual steps.

## Approach

**Pre-calculated all parameters from documentation before touching the API:**

| Jump | Date | syncRatio | PWR | InternalMode | PT-A | PT-B | Tunnel |
|------|------|-----------|-----|--------------|------|------|--------|
| 1 | 5 Nov 2238 | 0.82 | 91 | 3 | ❌ | ✅ | No |
| 2 | 10 Apr 2026 | 0.69 | 28 | 2 | ✅ | ❌ | No |
| 3 | 12 Nov 2024 | 0.54 | 19 | 2 | ✅ | ✅ | Yes |

**SyncRatio formula** (from docs): `(day×8 + month×12 + year×7) mod 101 / 100`

**PWR values** from the full per-year protection table in the docs (1500–2499).

**InternalMode** cycles automatically every few seconds — the script polls for the correct mode before advising the user to activate.

**Stabilization** is provided by the device itself after the date is configured — extracted from `getConfig` or `configure` responses using an LLM call (the exact response format was unknown before runtime).

**Polling flow per jump:**
1. Wait for standby → configure day/month/year via API
2. Call getConfig → LLM extracts stabilization hint → configure it
3. Configure syncRatio
4. Print manual UI instructions (PWR, PT-A/B, standby→active)
5. Poll until correct internalMode detected
6. Poll until device transitions to active then back to standby (jump completed)
7. Watch for flag in any API response

## Challenges

- **Stabilization format unknown** — the docs say the device tells you the value, but the exact JSON field name isn't documented. LLM fallback handles this at runtime.
- **internalMode is fully automatic** — can't be set, only waited for. The 4-phase cycle is random timing; the script must poll patiently without burning too many API calls.
- **Time tunnel needs 60%+ battery** — Jump 1 (forward) and Jump 2 (return) each consume ~⅓ battery. After getting fresh batteries in 2238, the battery should be at 100%, leaving ~66% for Jump 2 and enough for Jump 3's tunnel (which costs more than a standard jump).
- **API changes blocked in non-standby** — must always verify standby before configuring. If device is active or in a transition state, configuration calls will be rejected.
- **No stdin in hub streaming** — the hub streams task output but doesn't support interactive input. The design uses polling to detect state transitions rather than waiting for user keypress.

## Key learnings

- **Read the full documentation table** — the PWR table has 1000 rows (1500–2499), each year has a different value. Can't guess or approximate — need exact values from the table. Embedded just the needed entries.
- **Polling + print instructions is the right pattern** for tasks mixing API + manual UI. Let the human handle UI; the script handles API and detects completion.
- **LLM for unknown response formats** — when the docs don't specify the exact JSON field names for hints, using a small LLM call to extract the value is more robust than brittle regex.
- **Pre-calculate before first API call** — all formulas (syncRatio, PWR lookup, requiredMode) can be computed offline from the documentation. No need to call the API to figure these out.
- **Time tunnel vs jump** — tunnel requires PT-A + PT-B simultaneously (documented separately from standard jumps). Easy to miss without reading the full docs.

## Outcome

- Three-phase jump sequence: 2238 (forward) → 2026 (return) → 2024 (tunnel)
- Flag expected on successful time tunnel activation at the end of Jump 3
- Final answer format: `{FLG:...}` returned by the hub API upon successful tunnel opening
