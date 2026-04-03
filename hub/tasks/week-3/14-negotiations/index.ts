/**
 * Negotiations Task (S03E04)
 *
 * Architecture (server):
 *   Exposes an HTTP search tool that an external agent calls to find which
 *   Polish cities offer a given electronics item. The external agent uses this
 *   tool to collect city lists for all required wind-turbine components and
 *   then reports cities that carry ALL of them simultaneously.
 *
 * Data source: {HUB_BASE_URL}/dane/s03e04_csv/ (cities.csv, items.csv, connections.csv)
 *
 * Tool endpoint: POST {NEGOTIATIONS_PUBLIC_URL}/search
 *   Request:  { "params": "<natural language item description>" }
 *   Response: { "output": "<comma-separated city names>" }  — max 500 bytes
 */

import "dotenv/config";
import http from "http";
import { parse as csvParse } from "csv-parse/sync";
import { hubVerify } from "../../shared/hub.js";
import { chat } from "../../shared/llm.js";

const HUB_BASE_URL = process.env.HUB_BASE_URL ?? "";
const PORT = parseInt(process.env.NEGOTIATIONS_PORT ?? "3002", 10);
const PUBLIC_URL = (process.env.NEGOTIATIONS_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

// ── Data structures ───────────────────────────────────────────────────────────

interface Item {
  name: string;
  code: string;
}

// cityCode  → cityName
const cityByCode = new Map<string, string>();
// itemCode  → city names array
const citiesByItemCode = new Map<string, string[]>();
// all items list (for keyword search)
let allItems: Item[] = [];

// ── CSV loading ───────────────────────────────────────────────────────────────

async function loadCsvText(filename: string): Promise<string> {
  const url = `${HUB_BASE_URL}/dane/s03e04_csv/${filename}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function loadData(): Promise<void> {
  console.log("[Data] Fetching CSV files...");

  // cities.csv — no header: cityName,cityCode
  const citiesRaw = await loadCsvText("cities.csv");
  const cityRows = csvParse(citiesRaw, { skip_empty_lines: true }) as string[][];
  for (const [name, code] of cityRows) {
    if (name && code) cityByCode.set(code.trim(), name.trim());
  }

  // items.csv — header: name,code
  const itemsRaw = await loadCsvText("items.csv");
  const itemRows = csvParse(itemsRaw, { skip_empty_lines: true, from_line: 2 }) as string[][];
  allItems = itemRows.map(([name, code]) => ({ name: name.trim(), code: code.trim() }));

  // connections.csv — header: itemCode,cityCode
  const connRaw = await loadCsvText("connections.csv");
  const connRows = csvParse(connRaw, { skip_empty_lines: true, from_line: 2 }) as string[][];
  for (const [itemCode, cityCode] of connRows) {
    if (!itemCode || !cityCode) continue;
    const cityName = cityByCode.get(cityCode.trim());
    if (!cityName) continue;
    const key = itemCode.trim();
    if (!citiesByItemCode.has(key)) citiesByItemCode.set(key, []);
    citiesByItemCode.get(key)!.push(cityName);
  }

  console.log(
    `[Data] ${cityByCode.size} cities | ${allItems.length} items | ${citiesByItemCode.size} item→city mappings`
  );
}

// ── Search logic ──────────────────────────────────────────────────────────────

/** Ask LLM to extract 1-2 Polish TYPE keywords (no specs like voltage/wattage). */
async function extractKeywords(query: string): Promise<string[]> {
  const reply = await chat(
    [
      {
        role: "user",
        content: `What TYPE of item is being described? Return 1-2 Polish nouns that name the item category only. Do NOT include voltage, wattage, capacity, size, or any numeric specification.\n\nExamples:\n- "Turbina wiatrowa mająca 48V i moc 400W" → "turbina wiatrowa"\n- "akumulator pod 48V dowolna pojemność" → "akumulator"\n- "inwerter który pasuje pod 48V" → "inwerter"\n- "I need a 10-meter power cable" → "kabel"\n\nQuery: "${query}"\n\nReply with ONLY the Polish type word(s), lowercase, nothing else.`,
      },
    ],
    {
      system:
        "You extract only the item TYPE name from a query about electronics. Never include voltage, wattage, capacity or measurements. Return 1-2 lowercase Polish words only.",
      max_tokens: 20,
    }
  );
  return reply
    .toLowerCase()
    .replace(/[^a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Find all city names that stock items matching the query. */
async function findCitiesForQuery(query: string): Promise<string[]> {
  const keywords = await extractKeywords(query);
  console.log(`[Search] "${query}" → keywords: [${keywords.join(", ")}]`);

  const matchedCodes = new Set<string>();
  for (const item of allItems) {
    const nameLower = item.name.toLowerCase();
    if (keywords.some((kw) => nameLower.includes(kw))) {
      matchedCodes.add(item.code);
    }
  }
  console.log(`[Search] Matched ${matchedCodes.size} item code(s)`);

  const citySet = new Set<string>();
  for (const code of matchedCodes) {
    for (const city of citiesByItemCode.get(code) ?? []) {
      citySet.add(city);
    }
  }

  return Array.from(citySet).sort();
}

/** Build a comma-separated string that fits within maxBytes (UTF-8). */
function compactList(names: string[], maxBytes = 490): string {
  let result = "";
  for (let i = 0; i < names.length; i++) {
    const chunk = i === 0 ? names[i] : `,${names[i]}`;
    if (Buffer.byteLength(result + chunk, "utf8") > maxBytes) break;
    result += chunk;
  }
  return result;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function startServer(): void {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output: "POST required" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body) as { params?: string };
        const params = parsed.params ?? "";

        if (url === "/search") {
          console.log(`[Tool /search] params="${params}"`);
          const cities = await findCitiesForQuery(params);
          const output = cities.length > 0 ? compactList(cities) : "no results";
          const bytes = Buffer.byteLength(output, "utf8");
          console.log(`[Tool /search] → ${cities.length} cities, ${bytes} bytes`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ output }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ output: "Unknown endpoint" }));
        }
      } catch (err) {
        console.error("[Error]", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ output: "Internal error" }));
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log(`[Server] Public URL: ${PUBLIC_URL}`);
    console.log(`[Server] Expose via:  ngrok http ${PORT}`);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Negotiations Task ===");
  console.log(`Port       : ${PORT}`);
  console.log(`Public URL : ${PUBLIC_URL}`);
  console.log("");

  await loadData();

  startServer();

  // Register tool with hub
  console.log("[Hub] Registering tools...");
  const toolDescription =
    "Find cities selling an electronics component. " +
    "Param 'params': natural language description in Polish or English (e.g. 'power cable 10m', 'kondensator 100uF'). " +
    "Returns comma-separated city names that stock the item.";

  const result = await hubVerify("negotiations", {
    tools: [
      {
        URL: `${PUBLIC_URL}/search`,
        description: toolDescription,
      },
    ],
  });
  console.log("[Hub] Registration result:", JSON.stringify(result));
}

main().catch(console.error);
