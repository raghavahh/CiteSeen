// Endpoints for the free single-purpose tools (SEO hub). Each reuses the audit engine's pieces.

import { BOTS, BROWSER_UA, CITEREADY_UA, FIREWALL_TEST_BOTS, getBot } from "../audit/bots.ts";
import { generateLlmsTxt, looksLikeChallenge } from "../audit/checks.ts";
import { normaliseInputUrl, safeFetch } from "../audit/fetcher.ts";
import { parseHtml } from "../audit/html.ts";
import { isAllowed, parseRobots } from "../audit/robots.ts";
import { buildContext } from "../audit/run.ts";

/** AI crawler checker: robots.txt verdict for every known bot + live user-agent test. */
export async function crawlerCheck(input: string) {
  const url = normaliseInputUrl(input);
  const [robotsRes, browser] = await Promise.all([
    safeFetch(`${url.origin}/robots.txt`, { userAgent: CITEREADY_UA, maxBytes: 512_000, timeoutMs: 6000, accept: "text/plain,*/*" }),
    safeFetch(url, { userAgent: BROWSER_UA, maxBytes: 2_500_000, timeoutMs: 8000 }),
  ]);
  const present = robotsRes.status === 200 && !/^\s*<(!doctype|html)/i.test(robotsRes.body);
  const parsed = parseRobots(present ? robotsRes.body : "");
  const finalUrl = browser.finalUrl || url.toString();
  const path = (() => {
    const u = new URL(finalUrl);
    return u.pathname + u.search;
  })();
  const browserWords = browser.body ? parseHtml(browser.body).wordCount : 0;

  const live = await Promise.all(
    FIREWALL_TEST_BOTS.map(async (t) => {
      const r = await safeFetch(finalUrl, { userAgent: getBot(t)!.ua!, maxBytes: 2_500_000, timeoutMs: 8000 });
      const words = r.body ? parseHtml(r.body).wordCount : 0;
      const challenge = looksLikeChallenge(r.body);
      const blocked =
        !!r.error || [401, 403, 406, 429, 451, 503].includes(r.status) || challenge || (browserWords > 100 && words < browserWords * 0.3);
      return { token: t, status: r.status, words, challenge, error: r.error, possibleBlock: blocked };
    }),
  );

  const robotsStatus = robotsRes.status >= 500 || (robotsRes.error && !robotsRes.status) ? "error" : present ? "present" : "missing";
  const bots = BOTS.map((b) => {
    const d = robotsStatus === "error" ? { allowed: false, matchedAgent: null, rule: null } : isAllowed(parsed, b.token, path);
    return {
      token: b.token,
      owner: b.owner,
      kind: b.kind,
      purpose: b.purpose,
      allowed: d.allowed,
      matchedAgent: d.matchedAgent,
      rule: d.rule ? `line ${d.rule.line}: ${d.rule.type === "allow" ? "Allow" : "Disallow"}: ${d.rule.path}` : null,
      live: live.find((l) => l.token === b.token) ?? null,
    };
  });
  return {
    url: finalUrl,
    robots: { url: `${url.origin}/robots.txt`, status: robotsRes.status, state: robotsStatus },
    browser: { status: browser.status, words: browserWords, error: browser.error },
    bots,
  };
}

/** Fetch an existing robots.txt for the generator to start from. */
export async function fetchRobots(input: string) {
  const url = normaliseInputUrl(input);
  const r = await safeFetch(`${url.origin}/robots.txt`, { userAgent: CITEREADY_UA, maxBytes: 512_000, timeoutMs: 6000, accept: "text/plain,*/*" });
  const present = r.status === 200 && !/^\s*<(!doctype|html)/i.test(r.body);
  const parsed = parseRobots(present ? r.body : "");
  return { origin: url.origin, status: r.status, present, body: present ? r.body : "", sitemaps: parsed.sitemaps };
}

/** llms.txt generator + validator. */
export async function llmsTool(input: string) {
  const ctx = await buildContext(input, { skipBotTest: true });
  const draft = generateLlmsTxt(ctx);
  return {
    origin: ctx.origin,
    existing: ctx.llms.present ? { url: ctx.llms.url, body: ctx.llms.body, issues: validateLlmsTxt(ctx.llms.body) } : null,
    draft,
  };
}

/** Validate against the llms.txt proposal (llmstxt.org): H1 title, optional > summary, H2 sections of link lists. */
export function validateLlmsTxt(body: string): { level: "error" | "warning" | "ok"; message: string }[] {
  const issues: { level: "error" | "warning" | "ok"; message: string }[] = [];
  const lines = body.replace(/\r/g, "").split("\n");
  const firstContent = lines.find((l) => l.trim() !== "");
  if (!firstContent || !/^#\s+\S/.test(firstContent)) issues.push({ level: "error", message: "The file must start with an H1 title line, e.g. \"# Your Site Name\"." });
  if (lines.filter((l) => /^#\s/.test(l)).length > 1) issues.push({ level: "warning", message: "Only one H1 (# ) heading is expected. Use ## for sections." });
  if (!lines.some((l) => /^>\s+\S/.test(l))) issues.push({ level: "warning", message: "Add a one-line summary as a blockquote (> ...) under the title." });
  if (!lines.some((l) => /^##\s+\S/.test(l))) issues.push({ level: "warning", message: "Add at least one ## section with a list of links." });
  const links = lines.filter((l) => /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)/.test(l));
  if (!links.length) issues.push({ level: "warning", message: "No links found. Sections should be lists like \"- [Page title](https://...): description\"." });
  const badLinks = lines.filter((l) => /^\s*[-*]\s+\[/.test(l) && !/^\s*[-*]\s+\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(l));
  if (badLinks.length) issues.push({ level: "warning", message: `${badLinks.length} list item(s) don't use a full https:// link.` });
  if (body.length > 100_000) issues.push({ level: "warning", message: "The file is very large. Keep llms.txt concise and put detail in linked pages." });
  if (!issues.length) issues.push({ level: "ok", message: "Follows the llms.txt format." });
  return issues;
}

/** "What AI bots see": the page as raw HTML, no JavaScript. */
export async function rawView(input: string) {
  const url = normaliseInputUrl(input);
  const bot = getBot("OAI-SearchBot")!;
  const r = await safeFetch(url, { userAgent: bot.ua!, maxBytes: 2_500_000, timeoutMs: 9000 });
  if (!r.status) throw new Error(`Couldn't load the page: ${r.error}`);
  const p = parseHtml(r.body);
  return {
    url: r.finalUrl,
    status: r.status,
    userAgent: bot.ua,
    challenge: looksLikeChallenge(r.body),
    title: p.title,
    description: p.meta["description"] || "",
    lang: p.lang,
    headings: p.headings.slice(0, 60),
    wordCount: p.wordCount,
    text: p.text.slice(0, 6000),
    links: p.links.length,
    images: p.images.length,
    imagesWithoutAlt: p.images.filter((i) => !i.alt).length,
    schemaTypes: p.schemaTypes,
    scripts: p.scriptCount,
    emptyAppRoot: p.hasEmptyAppRoot,
  };
}
