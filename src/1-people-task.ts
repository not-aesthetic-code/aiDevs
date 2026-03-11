import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "./config.js";
import type { PersonRecord, PersonAnswer } from "./types.js";
import { JOB_TAGS } from "./types.js";
import { HUB_API_KEY, hubVerify } from "./hub.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

/** Konfiguracja specyficzna dla zadania people */
const peopleConfig = {
  /** Ścieżka do pliku CSV w folderze data (używana gdy plik jest lokalnie) */
  data_file: "src/data/people.csv",
  /** URL do pobrania CSV z Hubu (gdy brak pliku lokalnego) */
  hub_data_url_template: "https://hub.ag3nts.org/data/{apiKey}/people.csv",
  /** Kryteria filtrowania */
  current_year: 2026,
  min_age: 20,
  max_age: 40,
  birth_city_variants: ["grudziądz", "grudziadz"] as const,
  /** Opisy tagów dla promptu LLM */
  tag_descriptions: `
- IT: branża IT, programowanie, informatyka, software
- transport: branża transportowa, logistyka, przewozy, spedycja
- edukacja: nauczanie, szkolenia, edukacja
- medycyna: służba zdrowia, pielęgniarstwo, medycyna
- praca z ludźmi: obsługa klienta, opieka, praca wymagająca kontaktu z ludźmi
- praca z pojazdami: kierowcy, operatorzy maszyn, praca przy pojazdach
- praca fizyczna: praca ręczna, fizyczna, w magazynie, na budowie
`.trim(),
} as const;

const min_born = peopleConfig.current_year - peopleConfig.max_age;
const max_born = peopleConfig.current_year - peopleConfig.min_age;

const TaggingItemSchema = z.object({
  index: z.number().describe("Numer rekordu z listy (0-based)"),
  tags: z.array(z.enum(JOB_TAGS)).describe("Przypisane tagi z listy"),
});

const BatchTaggingSchema = z.object({
  items: z.array(TaggingItemSchema).describe("Lista rekordów z przypisanymi tagami"),
});

/** Pobiera CSV: najpierw z lokalnego pliku w folderze data, w razie braku – z Hubu. */
async function loadCsv(): Promise<string> {
  const localPath = join(process.cwd(), peopleConfig.data_file);
  try {
    return await readFile(localPath, "utf-8");
  } catch {
    const url = peopleConfig.hub_data_url_template.replace("{apiKey}", HUB_API_KEY);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch CSV: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }
}

function parseCsv(csvText: string): PersonRecord[] {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  return rows.map((row: Record<string, string>) => {
    const birthDate = String(row.birthDate ?? row.born ?? row.urodzony ?? row.year ?? "").trim();
    const yearMatch = birthDate.match(/^(\d{4})/);
    const born = yearMatch ? parseInt(yearMatch[1], 10) : 0;
    return {
      name: String(row.name ?? row.imie ?? row.imię ?? "").trim(),
      surname: String(row.surname ?? row.nazwisko ?? "").trim(),
      gender: String(row.gender ?? row.plec ?? row.płeć ?? "").trim().toUpperCase(),
      born: Number.isNaN(born) ? 0 : born,
      city: String(row.birthPlace ?? row.city ?? row.miasto ?? "").trim(),
      job: String(row.job ?? row.zawod ?? row.zawód ?? row.stanowisko ?? "").trim(),
    };
  });
}

function filterByCriteria(people: PersonRecord[]): PersonRecord[] {
  const { birth_city_variants } = peopleConfig;
  return people.filter((p) => {
    if (p.gender !== "M") return false;
    if (p.born < min_born || p.born > max_born) return false;
    const cityNorm = p.city.toLowerCase().replace(/\s+/g, " ");
    if (!birth_city_variants.includes(cityNorm as (typeof birth_city_variants)[number])) return false;
    return true;
  });
}

async function tagJobsWithLLM(
  client: Anthropic,
  people: PersonRecord[]
): Promise<Map<number, string[]>> {
  if (people.length === 0) return new Map();

  const listText = people
    .map((p, i) => `${i}. ${p.job || "(brak opisu)"}`)
    .join("\n");

  const response = await client.messages.parse({
    model: config.llm.model,
    max_tokens: config.llm.max_tokens,
    system: `Jesteś asystentem klasyfikującym opisy stanowisk pracy. Przypisuj tagi z podanej listy. Jedno stanowisko może mieć wiele tagów.

Dostępne tagi (z krótkim opisem):
${peopleConfig.tag_descriptions}

Zwróć obiekt z polem "items" - tablicą obiektów z polami "index" (numer z listy, 0-based) i "tags" (tablica stringów - wyłącznie tagi z listy).`,
    messages: [
      {
        role: "user",
        content: `Przypisz tagi do poniższych stanowisk (każdy wiersz to numer i opis stanowiska):\n\n${listText}`,
      },
    ],
    output_config: { format: zodOutputFormat(BatchTaggingSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed?.items) {
    throw new Error("LLM did not return valid tagging result");
  }

  const map = new Map<number, string[]>();
  for (const item of parsed.items) {
    map.set(item.index, item.tags);
  }
  return map;
}

function buildAnswer(people: PersonRecord[], tagMap: Map<number, string[]>): PersonAnswer[] {
  const result: PersonAnswer[] = [];
  for (let i = 0; i < people.length; i++) {
    const tags = tagMap.get(i) ?? [];
    if (!tags.includes("transport")) continue;
    const p = people[i];
    result.push({
      name: p.name,
      surname: p.surname,
      gender: "M",
      born: p.born,
      city: p.city,
      tags,
    });
  }
  return result;
}


async function main(): Promise<void> {
  if (!HUB_API_KEY || !ANTHROPIC_API_KEY) {
    console.error("Ustaw HUB_API_KEY i ANTHROPIC_API_KEY w pliku .env");
    process.exit(1);
  }

  console.log("Ładowanie danych (lokalny plik lub Hub)...");
  const csvText = await loadCsv();
  const all = parseCsv(csvText);
  console.log(`Wczytano ${all.length} rekordów.`);

  const filtered = filterByCriteria(all);
  console.log(`Po filtrach (M, 20–40 lat, Grudziądz): ${filtered.length} osób.`);

  if (filtered.length === 0) {
    console.log("Brak osób do otagowania. Wysyłam pustą odpowiedź.");
    const response = await hubVerify("people", []);
    console.log("Odpowiedź:", JSON.stringify(response, null, 2));
    return;
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  console.log(`Otagowywanie stanowisk (${config.llm.model}, Structured Output, batch)...`);
  const tagMap = await tagJobsWithLLM(anthropic, filtered);

  const answer = buildAnswer(filtered, tagMap);
  console.log(`Osób z tagiem 'transport': ${answer.length}.`);

  const suspectsPath = join(process.cwd(), "src/data/suspects.json");
  await writeFile(suspectsPath, JSON.stringify(answer, null, 2), "utf-8");
  console.log(`Zapisano listę podejrzanych do ${suspectsPath}.`);

  const response = await hubVerify("people", answer);
  console.log("Odpowiedź z Hub:", JSON.stringify(response, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
