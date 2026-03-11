import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { PersonAnswer } from "./types.js";
import { HUB_API_KEY, hubVerify } from "./hub.js";
import { haversineKm, geocodeCity } from "./geo.js";

const BASE_URL = "https://hub.ag3nts.org";
const SUSPECTS_PATH = join(process.cwd(), "src/data/suspects.json");
const MAX_ITERATIONS = 20;

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function tool_get_suspects(): Promise<PersonAnswer[]> {
  const raw = await readFile(SUSPECTS_PATH, "utf-8");
  return JSON.parse(raw) as PersonAnswer[];
}

async function tool_get_power_plants(): Promise<
  Array<{ code: string; city: string; lat: number; lon: number }>
> {
  const url = `${BASE_URL}/data/${encodeURIComponent(HUB_API_KEY)}/findhim_locations.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Power plants fetch failed: ${res.status}`);
  const data = (await res.json()) as { power_plants: Record<string, { code: string }> };
  const plants: Array<{ code: string; city: string; lat: number; lon: number }> = [];
  for (const [city, info] of Object.entries(data.power_plants)) {
    const geo = await geocodeCity(city);
    plants.push({ code: info.code, city, lat: geo?.lat ?? 0, lon: geo?.lon ?? 0 });
  }
  return plants;
}

async function tool_get_person_locations(
  name: string,
  surname: string
): Promise<Array<{ latitude: number; longitude: number }>> {
  const res = await fetch(`${BASE_URL}/api/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: HUB_API_KEY, name, surname }),
  });
  if (!res.ok) throw new Error(`Location API failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as unknown;
  const list = Array.isArray(data) ? data : (data as { coordinates?: unknown[] }).coordinates ?? [];
  return (list as Array<Record<string, unknown> | number[]>).map((p) => {
    if (Array.isArray(p)) return { latitude: Number(p[1]), longitude: Number(p[0]) };
    return { latitude: Number(p.latitude ?? p.lat ?? 0), longitude: Number(p.longitude ?? p.lon ?? 0) };
  });
}

async function tool_get_access_level(name: string, surname: string, birthYear: number): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/accesslevel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: HUB_API_KEY, name, surname, birthYear }),
  });
  if (!res.ok) throw new Error(`AccessLevel API failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { accessLevel?: number };
  if (typeof data?.accessLevel !== "number") throw new Error("Unexpected accesslevel response");
  return data.accessLevel;
}

function tool_calculate_distance(
  personLocations: Array<{ latitude: number; longitude: number }>,
  plantLat: number,
  plantLon: number
): number {
  if (personLocations.length === 0) return Infinity;
  return Math.min(...personLocations.map((p) => haversineKm(p.latitude, p.longitude, plantLat, plantLon)));
}

async function tool_submit_answer(
  name: string,
  surname: string,
  accessLevel: number,
  powerPlant: string
): Promise<unknown> {
  return hubVerify("findhim", { name, surname, accessLevel, powerPlant });
}

// ---------------------------------------------------------------------------
// Tool definitions for the LLM
// ---------------------------------------------------------------------------

const tools: Anthropic.Tool[] = [
  {
    name: "get_suspects",
    description: "Returns the list of suspects (name, surname, birthYear/born) from the local file.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_power_plants",
    description:
      "Fetches the list of nuclear power plants from the Hub API. Returns each plant's code, city name, and geocoded lat/lon coordinates.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_person_locations",
    description:
      "Fetches all known GPS locations where a given suspect was seen. Returns array of {latitude, longitude}.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "First name of the suspect" },
        surname: { type: "string", description: "Last name of the suspect" },
      },
      required: ["name", "surname"],
    },
  },
  {
    name: "calculate_distance",
    description:
      "Calculates the minimum distance in km between a person's location history and a given power plant's coordinates. Returns Infinity if no locations.",
    input_schema: {
      type: "object",
      properties: {
        person_locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              latitude: { type: "number" },
              longitude: { type: "number" },
            },
            required: ["latitude", "longitude"],
          },
          description: "Array of GPS coordinates where the person was seen",
        },
        plant_lat: { type: "number", description: "Power plant latitude" },
        plant_lon: { type: "number", description: "Power plant longitude" },
      },
      required: ["person_locations", "plant_lat", "plant_lon"],
    },
  },
  {
    name: "get_access_level",
    description: "Fetches the security access level for a given person.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        surname: { type: "string" },
        birthYear: { type: "number", description: "Year of birth as integer (e.g. 1987)" },
      },
      required: ["name", "surname", "birthYear"],
    },
  },
  {
    name: "submit_answer",
    description:
      "Submits the final answer to the Hub /verify endpoint. Call only once you are certain of the result.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "First name of the identified person" },
        surname: { type: "string", description: "Last name of the identified person" },
        accessLevel: { type: "number", description: "Security access level of the person" },
        powerPlant: { type: "string", description: "Power plant code, e.g. PWR1234PL" },
      },
      required: ["name", "surname", "accessLevel", "powerPlant"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

async function dispatchTool(name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    case "get_suspects":
      return tool_get_suspects();
    case "get_power_plants":
      return tool_get_power_plants();
    case "get_person_locations":
      return tool_get_person_locations(input.name as string, input.surname as string);
    case "calculate_distance":
      return tool_calculate_distance(
        input.person_locations as Array<{ latitude: number; longitude: number }>,
        input.plant_lat as number,
        input.plant_lon as number
      );
    case "get_access_level":
      return tool_get_access_level(input.name as string, input.surname as string, input.birthYear as number);
    case "submit_answer":
      return tool_submit_answer(
        input.name as string,
        input.surname as string,
        input.accessLevel as number,
        input.powerPlant as string
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!HUB_API_KEY) {
    console.error("Ustaw HUB_API_KEY w pliku .env");
    process.exit(1);
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `You are a detective agent. Your task is to identify which suspect from the list was seen near a nuclear power plant.

Steps:
1. Use get_suspects to get the list of suspects.
2. Use get_power_plants to get all power plants with their coordinates.
3. For each suspect, use get_person_locations to fetch their location history.
4. Use calculate_distance to find the minimum distance from each suspect to each power plant.
5. Identify the suspect who was closest to any power plant.
6. Use get_access_level to get their security access level (use their birth year from the suspects list).
7. Use submit_answer with the final result.

Be systematic. Work through all suspects before deciding.`,
    },
  ];

  console.log("Uruchamianie agenta Function Calling...\n");

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 8192,
      tools,
      messages,
    });

    // Append assistant response
    messages.push({ role: "assistant", content: response.content });

    // Print any text the model outputs
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`[Agent] ${block.text}`);
      }
    }

    if (response.stop_reason === "end_turn") {
      console.log("\nAgent zakończył pracę.");
      break;
    }

    if (response.stop_reason !== "tool_use") {
      console.log(`\nAgent zatrzymał się: ${response.stop_reason}`);
      break;
    }

    // Execute all requested tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      console.log(`[Tool] ${block.name}(${JSON.stringify(block.input)})`);

      let result: unknown;
      try {
        result = await dispatchTool(block.name, block.input as ToolInput);
      } catch (err) {
        result = { error: String(err) };
      }

      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      console.log(`       → ${resultStr.slice(0, 200)}${resultStr.length > 200 ? "…" : ""}\n`);

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultStr,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
