import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";
import { HUB_API_KEY } from "../../shared/hub.js";

interface Item { code: string; description: string; }

async function fetchCSV(): Promise<Item[]> {
  const url = `${process.env.HUB_BASE_URL ?? ""}/data/${HUB_API_KEY}/categorize.csv`;
  const response = await fetch(url);
  const text = await response.text();
  const lines = text.trim().split("\n");
  const items: Item[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = line.match(/^([^,]+),(.+)$/);
    if (match) {
      let code = match[1].trim();
      let description = match[2].trim();
      if (description.startsWith('"') && description.endsWith('"')) description = description.slice(1, -1);
      items.push({ code, description });
    }
  }
  return items;
}

async function engineerPrompt(items: Item[]): Promise<string> {
  const client = new Anthropic();
  const itemsText = items.map((item, i) => `${i + 1}. [${item.code}] ${item.description}`).join("\n");
  const message = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `You are a prompt engineer. Create a short prompt (<100 tokens) to classify items as DNG (dangerous) or NEU (neutral).

CRITICAL RULE: Items mentioning "reactor" must ALWAYS be classified as NEU.

Items to classify:
${itemsText}

Requirements:
1. Fits in ~100 tokens total (including {code} and {description} placeholders)
2. Output only "DNG" or "NEU"
3. Explicitly handles the reactor exception
4. English only

Return ONLY the prompt text, nothing else. Use {code} and {description} as placeholders.`,
    }],
  });
  const promptText = message.content[0].type === "text" ? message.content[0].text : "";
  return promptText.trim();
}

async function main() {
  console.log("🚀 Engineering optimal prompt...\n");
  const items = await fetchCSV();
  console.log(`Loaded ${items.length} items\n`);
  const optimalPrompt = await engineerPrompt(items);
  console.log("✅ Engineered Prompt:");
  console.log(`"${optimalPrompt}"`);
  console.log(`\nLength: ${optimalPrompt.length} characters`);
  const exportCode = `export const OPTIMAL_PROMPT = \`${optimalPrompt.replace(/`/g, "\\`")}\`;`;
  console.log("\n📝 Add this to index.ts:");
  console.log(exportCode);
}

main().catch(console.error);
