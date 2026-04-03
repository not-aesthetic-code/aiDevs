/**
 * OKO Editor Task (S03E16)
 *
 * Modify entries in the OKO Operational Centre via the hub "back door" API.
 *
 * Required changes:
 *  1. Reclassify the Skolwin city report from vehicles+people (MOVE03) to
 *     animals (MOVE04) on the incydenty page.
 *  2. Mark the Skolwin city task as done on the zadania page, writing "bobry"
 *     as the task content.
 *  3. Add a human-movement incident near Komarowo city on the incydenty page
 *     (replace an unused existing entry with the correct MOVE01 report).
 *
 * Incident coding (from the "Metody kodowania incydentów" notatka):
 *   MOVE01 = człowiek | MOVE02 = pojazd | MOVE03 = pojazd+człowiek | MOVE04 = zwierzęta
 *
 * IMPORTANT:
 *   - Do NOT log in to the web panel while this script is running — web login
 *     resets the API state and bans the key until logout.
 *   - The update API is session-scoped: all three updates must be applied and
 *     "done" called in the same run without visiting the web panel in between.
 *   - Content for the Komarowo incident must use the exact phrase "ruch ludzi"
 *     (not "ruch ludzki") to pass the hub's content validator.
 */

import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";

const TASK = "okoeditor";

// Shared record ID for Skolwin entries (same ID on incydenty, notatki, zadania)
const SKOLWIN_ID = process.env.OKO_SKOLWIN_ID ?? "";
// ID of an existing incydenty entry to repurpose as the Komarowo incident
const KOMAROWO_ID = process.env.OKO_KOMAROWO_ID ?? "";

async function callAction(answer: Record<string, unknown>): Promise<unknown> {
  console.log(`[Hub] Action: ${JSON.stringify(answer)}`);
  const result = await hubVerify(TASK, answer);
  const code = (result as Record<string, unknown>).code;
  console.log(`[Hub] code=${code}`);
  return result;
}

async function main(): Promise<void> {
  console.log("=== OKO Editor Task ===");
  console.log("");

  // Phase 0: fetch help to discover API capabilities
  console.log("[Phase 0] Fetching API help...");
  const help = await callAction({ action: "help" });
  console.log("[Phase 0] Help:", JSON.stringify(help, null, 2));
  console.log("");

  if (!SKOLWIN_ID || !KOMAROWO_ID) {
    throw new Error(
      "Missing required env vars: OKO_SKOLWIN_ID and OKO_KOMAROWO_ID must be set."
    );
  }

  // Phase 1: Reclassify Skolwin incident from MOVE03 (vehicles+people) to MOVE04 (animals)
  console.log("[Phase 1] Reclassifying Skolwin incident to animals (MOVE04)...");
  const op1 = await callAction({
    action: "update",
    page: "incydenty",
    id: SKOLWIN_ID,
    title: "MOVE04 Trudne do klasyfikacji ruchy nieopodal miasta Skolwin",
  });
  const code1 = (op1 as Record<string, unknown>).code;
  if (code1 !== 110) {
    throw new Error(`Phase 1 failed: ${JSON.stringify(op1)}`);
  }
  console.log("[Phase 1] Done.\n");

  // Phase 2: Mark Skolwin task as done with "bobry" content
  console.log("[Phase 2] Marking Skolwin task as done (bobry)...");
  const op2 = await callAction({
    action: "update",
    page: "zadania",
    id: SKOLWIN_ID,
    done: "YES",
    content: "bobry",
  });
  const code2 = (op2 as Record<string, unknown>).code;
  if (code2 !== 110) {
    throw new Error(`Phase 2 failed: ${JSON.stringify(op2)}`);
  }
  console.log("[Phase 2] Done.\n");

  // Phase 3: Create Komarowo human-movement incident
  // NOTE: Phrase must be "ruch ludzi" (not "ruch ludzki") to pass content validation.
  console.log("[Phase 3] Adding Komarowo human-movement incident...");
  const op3 = await callAction({
    action: "update",
    page: "incydenty",
    id: KOMAROWO_ID,
    title: "MOVE01 Wykryto ruch ludzi w okolicach miasta Komarowo",
    content: "Wykryto ruch ludzi w okolicach miasta Komarowo.",
  });
  const code3 = (op3 as Record<string, unknown>).code;
  if (code3 !== 110) {
    throw new Error(`Phase 3 failed: ${JSON.stringify(op3)}`);
  }
  console.log("[Phase 3] Done.\n");

  // Phase 4: Verify all changes and obtain flag
  console.log("[Phase 4] Calling done to verify all changes...");
  const doneResult = await callAction({ action: "done" });
  console.log("\n[Result]", JSON.stringify(doneResult, null, 2));

  const doneCode = (doneResult as Record<string, unknown>).code;
  if (doneCode === 0) {
    console.log("\n✓ Task completed successfully!");
    console.log("Flag:", (doneResult as Record<string, unknown>).message);
  } else {
    throw new Error(`Done verification failed: ${JSON.stringify(doneResult)}`);
  }
}

main().catch((err) => {
  console.error("[Error]", err);
  process.exit(1);
});
