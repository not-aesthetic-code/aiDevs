import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { hubVerify } from "../../shared/hub.js";
import { config } from "../../shared/config.js";

const SENSORS_DIR = process.env.SENSORS_DIR ?? "";
const LLM_BATCH_SIZE = 80;

interface SensorReading {
  sensor_type: string;
  timestamp: number;
  temperature_K: number;
  pressure_bar: number;
  water_level_meters: number;
  voltage_supply_v: number;
  humidity_percent: number;
  operator_notes: string;
}

const SENSOR_TO_FIELD: Record<string, string> = {
  temperature: "temperature_K",
  pressure: "pressure_bar",
  water: "water_level_meters",
  voltage: "voltage_supply_v",
  humidity: "humidity_percent",
};

const FIELD_RANGES: Record<string, [number, number]> = {
  temperature_K: [553, 873],
  pressure_bar: [60, 160],
  water_level_meters: [5.0, 15.0],
  voltage_supply_v: [229.0, 231.0],
  humidity_percent: [40.0, 80.0],
};

const ALL_MEASURABLE_FIELDS = Object.keys(FIELD_RANGES);

function getActiveFields(sensorType: string): string[] {
  return sensorType
    .split("/")
    .map((s) => s.trim().toLowerCase())
    .flatMap((s) => {
      const field = SENSOR_TO_FIELD[s];
      return field ? [field] : [];
    });
}

function checkDataAnomalies(data: SensorReading): string[] {
  const issues: string[] = [];
  const activeFields = getActiveFields(data.sensor_type);

  for (const field of ALL_MEASURABLE_FIELDS) {
    const value = data[field as keyof SensorReading] as number;
    const isActive = activeFields.includes(field);

    if (isActive) {
      const [min, max] = FIELD_RANGES[field];
      if (value < min || value > max) {
        issues.push(`${field}=${value} out of range [${min}, ${max}]`);
      }
    } else {
      if (value !== 0) {
        issues.push(`${field}=${value} should be 0 (not active for sensor type "${data.sensor_type}")`);
      }
    }
  }

  return issues;
}

async function analyzeNoteBatch(
  client: Anthropic,
  notes: Array<{ idx: number; note: string }>
): Promise<number[]> {
  const notesList = notes.map(({ idx, note }) => `[${idx}] ${note}`).join("\n");

  const response = await client.messages.create({
    model: config.llm.model,
    max_tokens: 512,
    system: `You analyze sensor operator notes. All these notes come from sensors with CLEAN data — all values are within normal ranges, no sensor type violations.
Your task: identify notes that falsely claim there are problems, errors, anomalies, unusual readings, concerns, malfunctions, or anything wrong with the sensor.
Return ONLY a JSON array of the numeric indices (from the [N] labels) for notes that claim problems.
If none claim problems, return [].
Output ONLY the JSON array, nothing else. Example: [3, 17, 42]`,
    messages: [
      {
        role: "user",
        content: notesList,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "[]";

  const match = text.match(/\[[\d,\s]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as number[];
  } catch {
    return [];
  }
}

async function readFilesInBatches(
  filePaths: string[],
  concurrency = 500
): Promise<string[]> {
  const results: string[] = new Array(filePaths.length);
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((p) => readFile(p, "utf-8")));
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }
  return results;
}

async function main(): Promise<void> {
  if (!SENSORS_DIR) {
    throw new Error(
      "SENSORS_DIR environment variable not set. Point it to the folder with unpacked sensor JSON files."
    );
  }

  console.log(`Loading sensor files from: ${SENSORS_DIR}`);
  const allFiles = (await readdir(SENSORS_DIR)).filter((f) => f.endsWith(".json")).sort();
  console.log(`Found ${allFiles.length} sensor files`);

  // ── Phase 1: Programmatic data validation ──────────────────────────────────
  console.log("\n[Phase 1] Programmatic data validation...");

  const dataAnomalousIds = new Set<string>();
  const cleanFiles: Array<{ id: string; note: string }> = [];

  const filePaths = allFiles.map((f) => join(SENSORS_DIR, f));
  const fileContents = await readFilesInBatches(filePaths);

  let loggedCount = 0;
  for (let i = 0; i < allFiles.length; i++) {
    const id = allFiles[i].replace(".json", "");
    const raw = fileContents[i];

    let data: SensorReading;
    try {
      data = JSON.parse(raw) as SensorReading;
    } catch {
      console.log(`  [PARSE ERROR] ${id}`);
      dataAnomalousIds.add(id);
      continue;
    }

    const issues = checkDataAnomalies(data);
    if (issues.length > 0) {
      dataAnomalousIds.add(id);
      if (loggedCount < 20) {
        console.log(`  [DATA] ${id}: ${issues.join("; ")}`);
        loggedCount++;
      } else if (loggedCount === 20) {
        console.log(`  [DATA] ... (further data anomalies suppressed for brevity)`);
        loggedCount++;
      }
    } else {
      cleanFiles.push({ id, note: data.operator_notes });
    }
  }

  console.log(
    `Phase 1 complete: ${dataAnomalousIds.size} data anomalies, ${cleanFiles.length} clean files`
  );

  // ── Phase 2: LLM operator notes analysis ──────────────────────────────────
  console.log("\n[Phase 2] Analyzing operator notes with LLM...");

  const noteToIds = new Map<string, string[]>();
  for (const { id, note } of cleanFiles) {
    const ids = noteToIds.get(note) ?? [];
    ids.push(id);
    noteToIds.set(note, ids);
  }

  const uniqueNotes = Array.from(noteToIds.keys());
  console.log(
    `  Unique notes across clean files: ${uniqueNotes.length} (covering ${cleanFiles.length} files)`
  );

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const noteAnomalousIds = new Set<string>();

  const totalBatches = Math.ceil(uniqueNotes.length / LLM_BATCH_SIZE);
  for (let i = 0; i < uniqueNotes.length; i += LLM_BATCH_SIZE) {
    const batchNum = Math.floor(i / LLM_BATCH_SIZE) + 1;
    const batch = uniqueNotes.slice(i, i + LLM_BATCH_SIZE).map((note, j) => ({
      idx: i + j,
      note,
    }));

    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} notes)...`);
    const badIndices = await analyzeNoteBatch(client, batch);

    for (const idx of badIndices) {
      const note = uniqueNotes[idx];
      const ids = noteToIds.get(note) ?? [];
      for (const id of ids) {
        noteAnomalousIds.add(id);
      }
      if (ids.length > 0) {
        console.log(`    [NOTE] idx=${idx} → ${ids.length} file(s) flagged (false alarm note)`);
      }
    }
  }

  console.log(`Phase 2 complete: ${noteAnomalousIds.size} note anomalies`);

  // ── Combine & submit ───────────────────────────────────────────────────────
  const allAnomalousIds = [...new Set([...dataAnomalousIds, ...noteAnomalousIds])].sort();
  console.log(`\nTotal anomalies to report: ${allAnomalousIds.length}`);
  console.log("Submitting to hub...");

  const result = await hubVerify("evaluation", { recheck: allAnomalousIds });
  console.log("Hub response:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
