/**
 * Filesystem Task (S04E18)
 *
 * Download Natan's notes, analyse them with an LLM to extract trade data,
 * then build a virtual filesystem via the /verify/ API.
 *
 * Filesystem structure:
 *   /miasta/{city}   — JSON of goods the city needs and their quantities
 *   /osoby/{name}    — person's name + markdown link to their city
 *   /towary/{good}   — markdown link to the city that sells it
 *
 * Flow:
 *   → fetch help
 *   → download + extract natan_notes.zip
 *   → [AI] analyse notes → cities / people / goods-for-sale
 *   → reset filesystem
 *   → batch-create dirs + files
 *   → done
 */

import "dotenv/config";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { hubVerify } from "../../shared/hub.js";
import { chat } from "../../shared/llm.js";
import { config } from "../../shared/config.js";

const TASK = "filesystem";

// ── Polish transliteration (file names must not contain Polish diacritics) ────

const DIACRITIC_MAP: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
};

function transliterate(str: string): string {
  return str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => DIACRITIC_MAP[c] ?? c);
}

function toFileName(str: string): string {
  return transliterate(str)
    .toLowerCase()                      // API requires ^[a-z0-9_]+$
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");       // strip anything not allowed by pattern
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CityInfo {
  name: string;
  needs: Record<string, number>;
  sells: string[];
}

interface PersonInfo {
  name: string;
  city: string;
}

interface ExtractedData {
  cities: CityInfo[];
  people: PersonInfo[];
}

// ── Phase 1: Download and extract notes ───────────────────────────────────────

async function downloadAndExtractNotes(): Promise<string> {
  const url = `${config.hub.base_url}/dane/natan_notes.zip`;
  console.log(`[Phase 1] Downloading notes from ${config.hub.base_url}/dane/natan_notes.zip`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "natan-notes-"));
  const zipPath = path.join(tmpDir, "notes.zip");
  const extractDir = path.join(tmpDir, "extracted");

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));
  fs.mkdirSync(extractDir, { recursive: true });

  execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: "pipe" });
  console.log(`[Phase 1] Extracted to ${extractDir}`);

  // Collect all text content recursively
  const parts: string[] = [];

  function readDir(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        readDir(fullPath);
      } else {
        // Read any file that could be text (txt, md, no extension, etc.)
        const ext = path.extname(entry).toLowerCase();
        if ([".txt", ".md", ".text", ""].includes(ext)) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            parts.push(`=== ${entry} ===\n${content}`);
          } catch {
            // skip binary files
          }
        }
      }
    }
  }

  readDir(extractDir);

  const combined = parts.join("\n\n");
  console.log(`[Phase 1] Read ${parts.length} note files, total ${combined.length} chars`);
  return combined;
}

// ── Phase 2: AI analysis ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Jesteś ekspertem od analizy notatek handlowych. Przeanalizuj notatki Natana i wyodrębnij dane o handlu między miastami.

WAŻNE: Każde miasto ma DOKŁADNIE JEDNĄ osobę odpowiedzialną za handel. Liczba osób w "people" MUSI być równa liczbie miast w "cities". Przeczytaj uważnie wszystkie notatki i upewnij się, że żadna osoba nie została pominięta.

Musisz znaleźć:
1. Które miasta uczestniczyły w handlu
2. Jakie towary każde miasto POTRZEBUJE (popyt) i w jakich ilościach (liczba bez jednostek)
3. Jakie towary każde miasto SPRZEDAJE lub OFERUJE (podaż)
4. Która osoba (imię i nazwisko) odpowiada za handel w każdym mieście — KAŻDE miasto musi mieć przypisaną osobę

Zasady:
- Nazwy towarów podawaj w MIANOWNIKU LICZBY POJEDYNCZEJ (np. "koparka" nie "koparki", "zboże" nie "zboża")
- Ilości tylko jako liczby (bez jednostek)
- Użyj dokładnych nazw miast i osób z notatek
- Każde miasto może sprzedawać inne towary niż potrzebuje
- "sells" to towary, które miasto PRODUKUJE lub OFERUJE na sprzedaż
- Liczba wpisów w "people" == liczba wpisów w "cities"

Zwróć TYLKO poprawny JSON bez żadnych komentarzy ani markdown:
{
  "cities": [
    {
      "name": "NazwaMiasta",
      "needs": {"towar1": 5, "towar2": 10},
      "sells": ["towar3", "towar4"]
    }
  ],
  "people": [
    {
      "name": "Imię Nazwisko",
      "city": "NazwaMiasta"
    }
  ]
}`;

async function analyzeNotes(notes: string): Promise<ExtractedData> {
  const model = process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE ?? undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[Phase 2] LLM analysis attempt ${attempt}...`);

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: notes },
    ];

    // On retry, append the previous (bad) response and a correction nudge
    if (attempt > 1) {
      messages.push({
        role: "assistant",
        content: "...",  // placeholder — will be replaced below
      });
    }

    const raw = await chat(
      attempt === 1
        ? [{ role: "user", content: notes }]
        : [
            { role: "user", content: notes },
            {
              role: "user",
              content: `Poprzednia odpowiedź zawierała ${_lastCities} miast ale tylko ${_lastPeople} osób. Każde miasto MUSI mieć przypisaną osobę. Przeszukaj notatki jeszcze raz i znajdź brakującą osobę. Zwróć kompletny JSON.`,
            },
          ],
      { system: SYSTEM_PROMPT, model }
    );

    console.log("[Phase 2] Raw AI response (first 800 chars):", raw.slice(0, 800));

    let parsed: ExtractedData;
    try {
      parsed = JSON.parse(raw.trim()) as ExtractedData;
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new SyntaxError(`No JSON found in AI response:\n${raw.slice(0, 400)}`);
      parsed = JSON.parse(match[0]) as ExtractedData;
    }

    console.log(`[Phase 2] Found ${parsed.cities.length} cities, ${parsed.people.length} people`);
    _lastCities = parsed.cities.length;
    _lastPeople = parsed.people.length;

    if (parsed.people.length === parsed.cities.length) {
      return parsed;
    }
    console.warn(`[Phase 2] Mismatch: ${parsed.cities.length} cities vs ${parsed.people.length} people — retrying`);
  }

  throw new Error(`[Phase 2] Failed to extract matching cities/people after 3 attempts`);
}

let _lastCities = 0;
let _lastPeople = 0;

// ── Phase 3: Build filesystem ─────────────────────────────────────────────────

type FsOperation = Record<string, unknown>;

function assertOk(res: unknown, label: string): void {
  const r = res as Record<string, unknown>;
  if (typeof r.code === "number" && r.code < 0) {
    throw new Error(`${label} returned error: ${JSON.stringify(r)}`);
  }
}

async function buildFilesystem(data: ExtractedData): Promise<void> {
  // Step 3a: Reset
  console.log("[Phase 3a] Resetting filesystem...");
  const resetRes = await hubVerify(TASK, { action: "reset" });
  console.log("[Phase 3a] Reset:", JSON.stringify(resetRes));
  assertOk(resetRes, "reset");

  // Step 3b+3c: Build one self-contained batch — dirs first, then files.
  // Including directory creation inside the batch ensures the API sees the
  // directories before it validates the nested file paths.
  const allOps: FsOperation[] = [];

  // Directories first
  for (const dir of ["/miasta", "/osoby", "/towary"]) {
    allOps.push({ action: "createDirectory", path: dir });
    console.log(`[Phase 3b] Queuing createDirectory ${dir}`);
  }

  // City files — JSON of goods the city needs with quantities
  // Keys must also be lowercase ASCII (same rules as file names)
  for (const city of data.cities) {
    const fileName = toFileName(city.name);
    const normalizedNeeds: Record<string, number> = {};
    for (const [good, qty] of Object.entries(city.needs)) {
      normalizedNeeds[toFileName(good)] = qty;
    }
    const content = JSON.stringify(normalizedNeeds, null, 2);
    allOps.push({ action: "createFile", path: `/miasta/${fileName}`, content });
    console.log(`[Phase 3c] City: /miasta/${fileName} needs=${JSON.stringify(city.needs)}`);
  }

  // Person files — name + markdown link to city
  for (const person of data.people) {
    const cityFileName = toFileName(person.city);
    const personFileName = toFileName(person.name);
    const content = `${person.name}\n\n[${cityFileName}](/miasta/${cityFileName})`;
    allOps.push({ action: "createFile", path: `/osoby/${personFileName}`, content });
    console.log(`[Phase 3c] Person: /osoby/${personFileName} → /miasta/${cityFileName}`);
  }

  // Goods files — markdown links to ALL cities that sell this good
  const goodToCities = new Map<string, string[]>();
  for (const city of data.cities) {
    for (const good of city.sells) {
      const trimmed = good.trim();
      if (!trimmed) continue;
      const key = toFileName(trimmed);
      if (!goodToCities.has(key)) goodToCities.set(key, []);
      goodToCities.get(key)!.push(city.name);
    }
  }

  for (const [goodFileName, cityNames] of goodToCities) {
    const content = cityNames
      .map((cn) => { const f = toFileName(cn); return `[${f}](/miasta/${f})`; })
      .join("\n");
    allOps.push({ action: "createFile", path: `/towary/${goodFileName}`, content });
    console.log(`[Phase 3c] Good: /towary/${goodFileName} → ${cityNames.map((cn) => `/miasta/${toFileName(cn)}`).join(", ")}`);
  }

  console.log(`[Phase 3] Sending ${allOps.length} total operations in batch...`);
  console.log("[Phase 3] Paths:", allOps.map((op) => (op as { path?: string }).path ?? "(no path)").join(", "));
  const batchRes = await hubVerify(TASK, allOps);
  console.log("[Phase 3] Batch result:", JSON.stringify(batchRes, null, 2));
  assertOk(batchRes, "file batch");
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  console.log("=== Filesystem Task ===");
  console.log(`[Start] ${new Date().toISOString()}`);
  console.log(`[Model] analyze=${process.env.STEP_ANALYZE_MODEL ?? process.env.MODEL_OVERRIDE ?? "default"}`);

  // Phase 0: Get API help
  console.log("\n[Phase 0] Fetching API help...");
  const helpRes = await hubVerify(TASK, { action: "help" });
  console.log("[Phase 0] Help:\n" + JSON.stringify(helpRes, null, 2));

  // Phase 1: Download and extract notes
  console.log("\n[Phase 1] Downloading Natan's notes...");
  const notes = await downloadAndExtractNotes();

  // Phase 2: AI analysis
  console.log("\n[Phase 2] Analysing notes with AI...");
  const data = await analyzeNotes(notes);
  console.log("[Phase 2] Extracted data:\n", JSON.stringify(data, null, 2));

  // Phase 3: Build filesystem
  console.log("\n[Phase 3] Building filesystem...");
  await buildFilesystem(data);

  // Phase 4: Done
  console.log("\n[Phase 4] Calling done...");
  const doneRes = await hubVerify(TASK, { action: "done" });
  console.log("[Phase 4] Done response:", JSON.stringify(doneRes, null, 2));

  const resp = doneRes as Record<string, unknown>;
  if (resp?.code === 0 || String(resp?.message ?? "").includes("FLG")) {
    console.log("\n✓ Task completed!");
    console.log("Flag:", resp.message ?? resp.flag);
  } else {
    console.warn("\n[Done] Unexpected response:", resp);
  }
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
