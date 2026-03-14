import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { HUB_API_KEY, hubVerify } from "../hub.js";

const DOC_BASE = "https://REDACTED/dane/doc";
const client = new Anthropic();

async function fetchBase64(filename: string): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(`${DOC_BASE}/${filename}`);
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const ct = res.headers.get("content-type") ?? "image/png";
  return { base64, mediaType: ct.split(";")[0] };
}

async function extractRouteCode(imageBase64: string, mediaType: string): Promise<string> {
  const response = await client.messages.create({
    model: config.llm.model,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: "This is a list of blocked railway routes in the SPK system. Find the route code for the route connecting Gdańsk and Żarnowiec. Return ONLY the route code (e.g. X-01), nothing else.",
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return text.trim();
}

function fillDeclaration(routeCode: string): string {
  // Base train: 2 wagons × 500 kg = 1000 kg. 2800 kg needs 4 additional wagons.
  // Category A: all fees (including extra wagons) are covered by the System → 0 PP.
  const wdp = Math.ceil((2800 - 1000) / 500); // = 4
  const today = new Date().toISOString().slice(0, 10);

  return [
    "SYSTEM PRZESYŁEK KONDUKTORSKICH - DEKLARACJA ZAWARTOŚCI",
    "======================================================",
    `DATA: ${today}`,
    "PUNKT NADAWCZY: Gdańsk",
    "------------------------------------------------------",
    "NADAWCA: 450202122",
    "PUNKT DOCELOWY: Żarnowiec",
    `TRASA: ${routeCode}`,
    "------------------------------------------------------",
    "KATEGORIA PRZESYŁKI: A",
    "------------------------------------------------------",
    "OPIS ZAWARTOŚCI (max 200 znaków): kasety z paliwem do reaktora",
    "------------------------------------------------------",
    "DEKLAROWANA MASA (kg): 2800",
    "------------------------------------------------------",
    `WDP: ${wdp}`,
    "------------------------------------------------------",
    "UWAGI SPECJALNE: brak",
    "------------------------------------------------------",
    "KWOTA DO ZAPŁATY: 0 PP",
    "------------------------------------------------------",
    "OŚWIADCZAM, ŻE PODANE INFORMACJE SĄ PRAWDZIWE.",
    "BIORĘ NA SIEBIE KONSEKWENCJĘ ZA FAŁSZYWE OŚWIADCZENIE.",
    "======================================================",
  ].join("\n");
}

async function main(): Promise<void> {
  if (!HUB_API_KEY) {
    console.error("Ustaw HUB_API_KEY w pliku .env");
    process.exit(1);
  }

  console.log("1. Pobieranie listy tras wyłączonych (trasy-wylaczone.png)...");
  const { base64, mediaType } = await fetchBase64("trasy-wylaczone.png");
  console.log(`   Obraz pobrany (${base64.length} znaków base64)`);

  console.log("2. Wyodrębnianie kodu trasy Gdańsk → Żarnowiec...");
  const routeCode = await extractRouteCode(base64, mediaType);
  console.log(`   Kod trasy: ${routeCode}`);

  console.log("3. Wypełnianie deklaracji...");
  const declaration = fillDeclaration(routeCode);
  console.log("\n--- DEKLARACJA ---\n");
  console.log(declaration);
  console.log("\n------------------\n");

  console.log("4. Wysyłanie do Hub /verify...");
  const result = await hubVerify("sendit", { declaration });
  console.log("Odpowiedź:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
