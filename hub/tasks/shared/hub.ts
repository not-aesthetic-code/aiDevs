import { config } from "./config.js";

const HUB_API_KEY = process.env.HUB_API_KEY ?? "";

export { HUB_API_KEY };

export async function hubVerify(task: string, answer: unknown): Promise<unknown> {
  const payload = { apikey: HUB_API_KEY, task, answer };
  const res = await fetch(config.hub.verify_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Verify failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}
