/**
 * Food Warehouse Task (S04E20)
 *
 * Prepare individual delivery orders for 8 cities based on their food/tool
 * requirements defined in food4cities.json.
 *
 * Flow:
 *   → fetch API help (tool=help)
 *   → load food4cities.json from hub
 *   → query DB: users table → get creatorID, login, birthday
 *   → query DB: roles table → find which role can create orders
 *   → query DB: destinations table (paginated) → map city name → destination_id
 *   → reset existing orders
 *   → for each city:
 *       generate SHA1 signature (tool=signatureGenerator, action=generate)
 *       create order (tool=orders, action=create)
 *       batch-append all required items (tool=orders, action=append)
 *   → verify (tool=done)
 *
 * DB schema (discovered at runtime):
 *   users(user_id, login, name_surname, password, birthday, role, is_active)
 *   destinations(destination_id, name)
 *   roles(role_id, name, ...)
 */

import "dotenv/config";
import { hubVerify } from "../../shared/hub.js";
import { config } from "../../shared/config.js";

const TASK = "foodwarehouse";

type AnyObj = Record<string, unknown>;
type FoodItems = Record<string, number>;
type CityOrders = Record<string, FoodItems>;

// ── API helper ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call the hub API with exponential backoff on 429 rate-limit responses */
async function api(answer: AnyObj, retries = 8): Promise<AnyObj> {
  console.log(`[API] → ${JSON.stringify(answer)}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = (await hubVerify(TASK, answer)) as AnyObj;
      console.log(`[API] ←\n${JSON.stringify(result, null, 2)}\n`);
      // Polite delay after every successful call
      await sleep(800);
      return result;
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("429") && attempt < retries) {
        const wait = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s, 40s, ...
        console.warn(`[API] Rate-limited (429), retrying in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function dbQuery(query: string): Promise<AnyObj> {
  return api({ tool: "database", query });
}

/** Extract array of rows from a database SELECT response */
function getDbRows(result: AnyObj): AnyObj[] {
  // The API returns { rows: [...] } for SELECT queries
  for (const key of ["rows", "data", "result", "tables", "reply"]) {
    const val = result[key];
    if (Array.isArray(val)) return val as AnyObj[];
  }
  return [];
}

/** Paginate through a table to get all rows (API enforces max 30 rows per call) */
async function getAllRows(table: string): Promise<AnyObj[]> {
  const PAGE = 30;
  let offset = 0;
  const all: AnyObj[] = [];

  while (true) {
    const res = await dbQuery(`select * from ${table} limit ${PAGE} offset ${offset}`);
    const rows = getDbRows(res);
    if (rows.length === 0) break;
    all.push(...rows);

    const total = (res["totalTableRows"] as number | undefined) ?? all.length;
    offset += rows.length;

    if (offset >= total) break;
  }

  console.log(`[DB] Table "${table}": loaded ${all.length} rows total`);
  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  console.log("=== Food Warehouse Task ===");
  console.log(`[Start] ${new Date().toISOString()}\n`);

  // ── Phase 0: API help ────────────────────────────────────────────────────────
  console.log("[Phase 0] Fetching API help...");
  await api({ tool: "help" });

  // ── Phase 1: Load city requirements ─────────────────────────────────────────
  console.log("[Phase 1] Loading food4cities.json...");
  const foodRes = await fetch(`${config.hub.base_url}/dane/food4cities.json`);
  if (!foodRes.ok) throw new Error(`Failed to fetch food4cities.json: ${foodRes.status}`);
  const cityOrders = (await foodRes.json()) as CityOrders;
  const cities = Object.keys(cityOrders);
  console.log(`[Phase 1] Cities (${cities.length}): ${cities.join(", ")}\n`);

  // ── Phase 2: Load database tables ───────────────────────────────────────────
  console.log("[Phase 2] Loading database...");

  // Load roles to understand which role can create orders
  const roles = await getAllRows("roles");
  console.log(`[Phase 2] Roles: ${JSON.stringify(roles)}`);

  // Load all users
  const users = await getAllRows("users");
  console.log(`[Phase 2] Total users: ${users.length}`);

  // Load all destinations (paginated — 40 total, limit=30 per call)
  const destinations = await getAllRows("destinations");
  console.log(`[Phase 2] Total destinations: ${destinations.length}`);

  // ── Phase 3: Determine creator ───────────────────────────────────────────────
  console.log("[Phase 3] Selecting creator...");

  // Find the user with role that can create orders
  // Try to pick an active user; fallback to first user
  // Log all users briefly for debugging
  for (const u of users.slice(0, 5)) {
    console.log(`  User: ${JSON.stringify(u)}`);
  }

  // Must use a user with role=2 ("Obsługa transportów" = transport staff)
  // The hub validates that the order creator is responsible for transport
  const TRANSPORT_ROLE = 2;
  const creator =
    users.find((u) => u["is_active"] === 1 && u["role"] === TRANSPORT_ROLE) ??
    users.find((u) => u["role"] === TRANSPORT_ROLE) ??
    users[0];

  if (!creator) throw new Error("No users found in database");

  const creatorId = creator["user_id"] as number;
  const login = creator["login"] as string;
  const birthday = creator["birthday"] as string;

  console.log(`[Phase 3] Creator: user_id=${creatorId}, login=${login}, birthday=${birthday}\n`);

  // ── Phase 4: Build city → destination code map ───────────────────────────────
  console.log("[Phase 4] Building city → destination map...");

  const cityDestinations: Record<string, number> = {};
  for (const row of destinations) {
    const name = (row["name"] as string | undefined) ?? "";
    const destId = row["destination_id"] as number | undefined;
    if (name && destId !== undefined) {
      cityDestinations[name.toLowerCase().trim()] = destId;
    }
  }

  console.log(`[Phase 4] Mapped ${Object.keys(cityDestinations).length} destinations`);

  const missingDest = cities.filter((c) => !(c in cityDestinations));
  if (missingDest.length > 0) {
    console.log("[Phase 4] All available destinations:", JSON.stringify(cityDestinations));
    throw new Error(`No destination code found for cities: ${missingDest.join(", ")}`);
  }

  for (const city of cities) {
    console.log(`  ${city} → destination_id=${cityDestinations[city]}`);
  }

  // ── Phase 5: Reset orders ────────────────────────────────────────────────────
  console.log("\n[Phase 5] Resetting order state...");
  await api({ tool: "reset" });

  // ── Phase 6: Create and fill one order per city ──────────────────────────────
  console.log("[Phase 6] Processing cities...\n");

  for (const city of cities) {
    console.log(`[Phase 6] === City: ${city} ===`);
    const destination = cityDestinations[city];
    const items = cityOrders[city];

    // 6a: Generate signature
    console.log(`[Phase 6] Generating signature (login=${login}, dest=${destination})...`);
    const sigResult = await api({
      tool: "signatureGenerator",
      action: "generate",
      login,
      birthday,
      destination,
    });

    // Extract signature — API returns { hash: "sha1hex" }
    const signature =
      (sigResult["hash"] as string | undefined) ??
      (sigResult["signature"] as string | undefined) ??
      (sigResult["data"] as string | undefined) ??
      (sigResult["result"] as string | undefined) ??
      String(sigResult["message"] ?? "").match(/[0-9a-f]{40}/i)?.[0];

    if (!signature) {
      throw new Error(`No signature in response for ${city}: ${JSON.stringify(sigResult)}`);
    }
    console.log(`[Phase 6] Signature: ${signature}`);

    // 6b: Create order
    const cityLabel = city.charAt(0).toUpperCase() + city.slice(1);
    const createResult = await api({
      tool: "orders",
      action: "create",
      title: `Dostawa dla ${cityLabel}`,
      creatorID: creatorId,
      destination,
      signature,
    });

    // Extract order ID — API returns { order: { id: "..." } }
    const orderId =
      ((createResult["order"] as AnyObj | undefined)?.["id"] as string | undefined) ??
      (createResult["id"] as string | undefined) ??
      (createResult["orderId"] as string | undefined) ??
      (createResult["order_id"] as string | undefined) ??
      ((createResult["data"] as AnyObj | undefined)?.["id"] as string | undefined);

    if (!orderId) {
      throw new Error(`No order ID in response for ${city}: ${JSON.stringify(createResult)}`);
    }
    console.log(`[Phase 6] Order created: id=${orderId}`);

    // 6c: Batch-append all items
    console.log(`[Phase 6] Appending items: ${JSON.stringify(items)}`);
    const appendResult = await api({
      tool: "orders",
      action: "append",
      id: orderId,
      items,
    });

    const appendCode = appendResult["code"] as number | undefined;
    if (typeof appendCode === "number" && appendCode < 0) {
      throw new Error(`Append failed for ${city}: ${JSON.stringify(appendResult)}`);
    }

    console.log(`[Phase 6] ${city} done.\n`);
  }

  // ── Phase 7: Done ────────────────────────────────────────────────────────────
  console.log("[Phase 7] Calling done...");
  const doneRes = await api({ tool: "done" });

  const resp = doneRes as AnyObj;
  const msg = String(resp?.message ?? resp?.flag ?? "");
  if (resp?.code === 0 || msg.includes("FLG")) {
    console.log("\n✓ Task completed successfully!");
    console.log("Flag:", msg);
  } else {
    console.warn("\n[Done] Unexpected response — check output above.");
    console.log(JSON.stringify(doneRes, null, 2));
  }
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
