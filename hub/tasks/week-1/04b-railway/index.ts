import "dotenv/config";
import { config } from "../../shared/config.js";
import { HUB_API_KEY } from "../../shared/hub.js";

const TASK = "railway";
const ROUTE = "X-01";

type RailwayResponse = {
  ok?: boolean;
  action?: string;
  help?: { actions: Array<{ action: string; requires: string[]; optional: string[]; about: string; allowed_values?: string[] }>; route_format: string; status_values: Record<string, string>; notes: string[] };
  route?: string;
  mode?: string;
  status?: string;
  message?: string;
  error?: string;
  [k: string]: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function railwayCall(answer: Record<string, unknown>): Promise<RailwayResponse> {
  const payload = { apikey: HUB_API_KEY, task: TASK, answer };
  const res = await fetch(config.hub.verify_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (res.status === 503) {
    console.warn(`503, retry after 5s`);
    await sleep(5000);
    return railwayCall(answer);
  }
  if (res.status === 429) {
    const data = body as { retry_after?: number };
    const sec = data?.retry_after ?? 30;
    console.warn(`429 rate limit, retry after ${sec}s`);
    await sleep(sec * 1000);
    return railwayCall(answer);
  }
  if (!res.ok) throw new Error(`Verify failed: ${res.status} ${text}`);
  return body as RailwayResponse;
}

async function main() {
  const responses: Record<string, RailwayResponse> = {};
  responses["help"] = await railwayCall({ action: "help" });

  const activationSequence: Array<{ action: string; payload: Record<string, string> }> = [
    { action: "reconfigure", payload: { route: ROUTE } },
    { action: "setstatus", payload: { route: ROUTE, value: "RTOPEN" } },
    { action: "save", payload: { route: ROUTE } },
  ];

  for (const { action, payload } of activationSequence) {
    const answer = { action, ...payload };
    responses[action] = await railwayCall(answer);
    console.log(action, responses[action]);
  }
}

main().catch(console.error);
