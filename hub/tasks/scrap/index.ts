/**
 * Brave Courses scraper — downloads all lessons from bravecourses.circle.so
 *
 * Prerequisites:
 *   cd hub && npm install playwright
 *   npx playwright install chromium
 *
 * Required env vars (in root .env):
 *   BRAVE_EMAIL    — your Circle.so login email
 *   BRAVE_PASSWORD — your Circle.so login password
 *
 * Optional:
 *   BRAVE_OUTPUT_DIR — directory to save markdown files (default: hub/tasks/scrap/output)
 *   BRAVE_COURSE_URL — course index URL (default: https://bravecourses.circle.so/c/lekcje-programu-ai4/)
 *   BRAVE_HEADLESS    — set to "false" to watch the browser (default: "true")
 */

import "dotenv/config";
import { chromium, type Page, type Browser } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Load root .env
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"));
} catch { /* .env is optional */ }

// ── Config ────────────────────────────────────────────────────────────────────

const EMAIL    = process.env.BRAVE_EMAIL ?? "";
const PASSWORD = process.env.BRAVE_PASSWORD ?? "";
const COURSE_URL = process.env.BRAVE_COURSE_URL ?? "https://bravecourses.circle.so/c/lekcje-programu-ai4/";
const HEADLESS   = process.env.BRAVE_HEADLESS !== "false";

const __dirname_compat = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = process.env.BRAVE_OUTPUT_DIR ?? path.join(__dirname_compat, "output");

const LOGIN_URL  = "https://login.circle.so/sign_in?request_host=bravecourses.circle.so#email";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/** Convert an HTML element's inner text + structure to rough markdown. */
async function extractMarkdown(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "";

    function convert(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const children = Array.from(el.childNodes).map(convert).join("");

      switch (tag) {
        case "h1": return `\n# ${children}\n`;
        case "h2": return `\n## ${children}\n`;
        case "h3": return `\n### ${children}\n`;
        case "h4": return `\n#### ${children}\n`;
        case "h5": return `\n##### ${children}\n`;
        case "h6": return `\n###### ${children}\n`;
        case "p":  return `\n${children}\n`;
        case "br": return "\n";
        case "strong": case "b": return `**${children}**`;
        case "em": case "i":     return `*${children}*`;
        case "code": return `\`${children}\``;
        case "pre":  return `\n\`\`\`\n${el.textContent ?? ""}\n\`\`\`\n`;
        case "a": {
          const href = el.getAttribute("href") ?? "";
          return href ? `[${children}](${href})` : children;
        }
        case "ul": return `\n${children}\n`;
        case "ol": return `\n${children}\n`;
        case "li": return `- ${children}\n`;
        case "blockquote": return `\n> ${children.replace(/\n/g, "\n> ")}\n`;
        case "img": {
          const src = el.getAttribute("src") ?? "";
          const alt = el.getAttribute("alt") ?? "image";
          return src ? `\n![${alt}](${src})\n` : "";
        }
        case "iframe": {
          const src = el.getAttribute("src") ?? "";
          return src ? `\n[embedded: ${src}]\n` : "";
        }
        // skip purely layout tags — just recurse
        case "div": case "section": case "article":
        case "span": case "figure": case "figcaption":
          return children;
        default:
          return children;
      }
    }
    return convert(el);
  }, selector);
}

/** Wait for network idle or a specific selector, tolerating timeouts. */
async function waitForContent(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  // Give JS-rendered content a moment to hydrate
  await page.waitForTimeout(1500);
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  console.log("[Login] Navigating to login page…");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  // Fill email — field is type="text" with name="user[email]" / id="user_email"
  await page.locator('#user_email, input[name="user[email]"]').first().fill(EMAIL);

  // Fill password
  await page.locator('#user_password, input[name="user[password]"]').first().fill(PASSWORD);

  console.log("[Login] Credentials filled, submitting…");

  // Submit
  await page.locator('button:has-text("Sign In"), input[type="submit"][value*="Sign"]').first().click();

  // Wait for either a redirect away from login.circle.so OR up to 10s and report state
  try {
    await page.waitForURL((url) => !url.hostname.includes("login.circle.so"), { timeout: 10_000 });
    console.log("[Login] Logged in. Current URL:", page.url());
    return;
  } catch {
    // Not redirected — check for error message
    const errorText = await page.evaluate(() => {
      const selectors = [
        '[class*="error"]', '[class*="alert"]', '[class*="flash"]',
        '[data-test*="error"]', '.notice', '#error_explanation',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent?.trim()) return el.textContent.trim();
      }
      return null;
    });
    if (errorText) {
      throw new Error(`[Login] Login failed — page error: "${errorText.slice(0, 200)}"`);
    }
    // Dump current URL for debugging
    throw new Error(
      `[Login] No redirect after submit. Still on: ${page.url()}\n` +
      `Check BRAVE_EMAIL / BRAVE_PASSWORD in your .env file.`
    );
  }
}

// ── Discover lessons ──────────────────────────────────────────────────────────

interface LessonLink {
  title: string;
  url: string;
}

async function collectLessonLinks(page: Page): Promise<LessonLink[]> {
  console.log("[Collect] Navigating to course index:", COURSE_URL);
  await page.goto(COURSE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const links: LessonLink[] = [];

  // Scroll down to trigger lazy loading until no new posts appear
  let prevCount = -1;
  let staleRounds = 0;
  while (staleRounds < 3) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);

    const current = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/c/lekcje-programu-ai4/p/"]').length
    );
    if (current === prevCount) {
      staleRounds++;
    } else {
      staleRounds = 0;
      prevCount = current;
    }
  }

  // Collect unique lesson URLs
  const raw = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/lekcje-programu-ai4/p/"]')
    );
    const seen = new Set<string>();
    return anchors
      .filter((a) => {
        if (seen.has(a.href)) return false;
        seen.add(a.href);
        return true;
      })
      .map((a) => ({ title: a.innerText.trim() || a.href, url: a.href }));
  });

  links.push(...raw);
  console.log(`[Collect] Found ${links.length} lesson links.`);
  return links;
}

// ── Scrape a single lesson ────────────────────────────────────────────────────

async function scrapeLesson(page: Page, lesson: LessonLink, index: number): Promise<void> {
  console.log(`[Scrape ${index}] ${lesson.title} — ${lesson.url}`);
  await page.goto(lesson.url, { waitUntil: "domcontentloaded" });
  await waitForContent(page);

  // Try to extract the post/lesson title
  const title = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1?.innerText?.trim() ?? document.title;
  });

  // Try common Circle.so content selectors
  const contentSelectors = [
    ".post-body",
    ".community-post__body",
    '[data-test="post-content"]',
    ".tiptap-content",
    ".ql-editor",
    "article",
    "main",
  ];

  let markdown = "";
  for (const sel of contentSelectors) {
    const found = await page.locator(sel).count();
    if (found > 0) {
      markdown = await extractMarkdown(page, sel);
      if (markdown.trim().length > 50) break;
    }
  }

  if (!markdown.trim()) {
    // Fallback — grab visible text from body
    markdown = await page.evaluate(() => document.body.innerText);
  }

  // Build output file
  const filename = `${String(index).padStart(3, "0")}-${slug(title)}.md`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  const content = [
    `# ${title}`,
    "",
    `> Source: ${lesson.url}`,
    "",
    markdown.trim(),
    "",
  ].join("\n");

  fs.writeFileSync(filepath, content, "utf8");
  console.log(`  → Saved: ${filename} (${content.length} chars)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "BRAVE_EMAIL and BRAVE_PASSWORD must be set in your .env file."
    );
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`[Scrap] Output directory: ${OUTPUT_DIR}`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await login(page);
    const lessons = await collectLessonLinks(page);

    if (lessons.length === 0) {
      console.warn("[Scrap] No lessons found. The URL structure may have changed — run with BRAVE_HEADLESS=false to inspect.");
      return;
    }

    for (let i = 0; i < lessons.length; i++) {
      await scrapeLesson(page, lessons[i], i + 1);
      // polite delay between requests
      await page.waitForTimeout(800);
    }

    console.log(`\n[Scrap] Done! ${lessons.length} lessons saved to ${OUTPUT_DIR}`);
  } finally {
    await browser?.close();
  }
}

main().catch(console.error);
