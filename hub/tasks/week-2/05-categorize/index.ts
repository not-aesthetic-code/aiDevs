import "dotenv/config";
import { HUB_API_KEY } from "../../shared/hub.js";

interface Item { code: string; description: string; }
interface VerifyResponse { message?: string; error?: string; [k: string]: unknown; }

async function fetchCSV(): Promise<Item[]> {
  const url = `${process.env.HUB_BASE_URL ?? ""}/data/${HUB_API_KEY}/categorize.csv`;
  console.log(`📥 Fetching CSV from hub...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.status}`);
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
  console.log(`✅ Loaded ${items.length} items\n`);
  return items;
}

async function resetBudget(): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.HUB_BASE_URL ?? ""}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: HUB_API_KEY, task: "categorize", answer: { prompt: "reset" } }),
    });
    const data = (await response.json()) as VerifyResponse;
    const message = (data.message as string) || "";
    console.log("Reset response:", message);
    return message.includes("reset") || message.includes("balance");
  } catch (err) { console.error("Reset failed:", err); return false; }
}

async function verifyItem(code: string, description: string, prompt: string): Promise<{ success: boolean; message?: string; budgetExhausted?: boolean; flag?: string }> {
  const fullPrompt = prompt.replace("{code}", code).replace("{description}", description);
  try {
    const response = await fetch(`${process.env.HUB_BASE_URL ?? ""}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: HUB_API_KEY, task: "categorize", answer: { prompt: fullPrompt } }),
    });
    const data = (await response.json()) as VerifyResponse;
    const message = (data.message as string) || "";
    if (message.includes("Insufficient funds")) return { success: false, message, budgetExhausted: true };
    const success = !message.includes("incorrect") && !message.includes("error") && response.ok;
    const flagMatch = message.match(/\{?FLG:[^\s}]+\}?/);
    const flag = flagMatch ? flagMatch[0] : undefined;
    return { success, message, flag };
  } catch (err) { return { success: false, message: String(err) }; }
}

async function testPrompt(items: Item[], prompt: string, iteration: number) {
  console.log(`\n🔄 Iteration ${iteration}`);
  console.log(`📋 Prompt template:\n"${prompt}"\n`);
  const failed: Item[] = [];
  let budgetExhausted = false;
  let flag: string | undefined;
  for (const item of items) {
    const result = await verifyItem(item.code, item.description, prompt);
    if (result.flag) { flag = result.flag; console.log(`  ✓ ${item.code} 🚩 FLAG FOUND!`); }
    else if (result.budgetExhausted) { budgetExhausted = true; failed.push(item); console.log(`  ⚠️  ${item.code}: Budget exhausted`); }
    else if (!result.success) { failed.push(item); console.log(`  ❌ ${item.code}: ${result.message}`); }
    else console.log(`  ✓ ${item.code}`);
  }
  console.log(`\n📊 Results: ${items.length - failed.length}/${items.length} passed`);
  if (flag) console.log(`\n🚩 FLAG RETRIEVED: ${flag}`);
  return { passed: items.length - failed.length, failed, budgetExhausted, flag };
}

async function main() {
  console.log("🚀 Categorize Task - Smart Prompt Engineering\n");
  const items = await fetchCSV();
  console.log("Resetting budget...");
  await resetBudget();

  const engineeredPrompt = `Classify as DNG (weapons, explosives, mines, radioactive) or NEU (safe, industrial). EXCEPTION: "reactor" items = always NEU. Output only: DNG or NEU.

Item [{code}] {description}`;

  const result = await testPrompt(items, engineeredPrompt, 1);
  if (result.passed === items.length) {
    console.log("\n🎉 All items classified correctly!");
    if (result.flag) console.log(`\n🚩 FLAG: ${result.flag}`);
  }
}

main().catch(console.error);
