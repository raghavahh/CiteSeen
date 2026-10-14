// Orchestrates one audit: fetch the page and its supporting files in parallel, then run every check.

import { BROWSER_UA, CITEREADY_UA, FIREWALL_TEST_BOTS, getBot } from "./bots.ts";
import { ALL_CHECKS, looksLikeChallenge } from "./checks.ts";
import { safeFetch, normaliseInputUrl, UnsafeUrlError, type FetchResult } from "./fetcher.ts";
import { detectCdn, detectPlatform, parseHtml } from "./html.ts";
import { parseRobots } from "./robots.ts";
import { siteName } from "./siteinfo.ts";
import type { AuditContext, AuditResult, BotFetch, GroupId, GroupScore } from "./types.ts";

export const ENGINE_VERSION = "0.1.0";

export type AuditErrorCode = "bad_url" | "unreachable" | "not_html" | "blocked";

export class AuditError extends Error {
  code: AuditErrorCode;
  constructor(message: string, code: AuditErrorCode) {
    super(message);
    this.code = code;
  }
}

const GROUP_TITLES: Record<GroupId, string> = {
  reach: "Can AI reach it?",
  understand: "Can AI understand it?",
  quote: "Will AI quote it?",
  info: "Info only",
};

function words(html: string): number {
  return parseHtml(html).wordCount;
}

export async function buildContext(input: string, opts: { skipBotTest?: boolean } = {}): Promise<AuditContext> {
  let url: URL;
  try {
    url = normaliseInputUrl(input);
  } catch (e) {
    throw new AuditError(e instanceof Error ? e.message : "Invalid URL", "bad_url");
  }

  const page = await safeFetch(url, { userAgent: BROWSER_UA, maxBytes: 2_500_000, timeoutMs: 9000 });
  if (page.error && !page.status) {
    // Retry over http if https failed to connect and the user didn't specify a scheme.
    if (url.protocol === "https:" && !/^https:\/\//i.test(input.trim())) {
      const alt = new URL(url.toString());
      alt.protocol = "http:";
      const retry = await safeFetch(alt, { userAgent: BROWSER_UA, maxBytes: 2_500_000, timeoutMs: 6000 });
      if (retry.status) return finishContext(input, retry, opts);
    }
    throw new AuditError(`We couldn't reach ${url.hostname}: ${page.error}.`, "unreachable");
  }
  return finishContext(input, page, opts);
}

async function finishContext(input: string, page: FetchResult, opts: { skipBotTest?: boolean }): Promise<AuditContext> {
  if (page.status >= 400) {
    const challenged = looksLikeChallenge(page.body);
    throw new AuditError(
      challenged || page.status === 403
        ? `The site answered with status ${page.status}${challenged ? " and a bot challenge page" : ""}. It blocks automated requests, which may also block AI crawlers. Check your firewall or CDN bot settings.`
        : `The page returned status ${page.status}. Check the address and try again.`,
      challenged || page.status === 403 ? "blocked" : "unreachable",
    );
  }
  const ctype = page.headers["content-type"] || "";
  if (ctype && !/html|xml/i.test(ctype)) {
    throw new AuditError(`That address returns ${ctype.split(";")[0]}, not a web page.`, "not_html");
  }

  const final = new URL(page.finalUrl);
  const origin = final.origin;
  const html = parseHtml(page.body);

  const robotsUrl = `${origin}/robots.txt`;
  const llmsUrl = `${origin}/llms.txt`;

  const [robotsRes, llmsRes, botFetches] = await Promise.all([
    safeFetch(robotsUrl, { userAgent: CITEREADY_UA, maxBytes: 512_000, timeoutMs: 6000, accept: "text/plain,*/*" }),
    safeFetch(llmsUrl, { userAgent: CITEREADY_UA, maxBytes: 256_000, timeoutMs: 6000, accept: "text/plain,text/markdown,*/*" }),
    opts.skipBotTest ? Promise.resolve([] as BotFetch[]) : runBotFetches(page.finalUrl),
  ]);

  const robotsLooksReal =
    robotsRes.status === 200 &&
    !/^\s*<(!doctype|html)/i.test(robotsRes.body) &&
    (/(user-agent|disallow|allow|sitemap)\s*:/i.test(robotsRes.body) || robotsRes.body.trim() === "");
  const parsed = parseRobots(robotsLooksReal ? robotsRes.body : "");

  // Sitemap: prefer the one robots.txt points to, else /sitemap.xml
  const listed = parsed.sitemaps.find((s) => {
    try {
      new URL(s);
      return true;
    } catch {
      return false;
    }
  });
  const sitemapUrl = listed || `${origin}/sitemap.xml`;
  const sm = await safeFetch(sitemapUrl, {
    userAgent: CITEREADY_UA,
    maxBytes: 64_000,
    timeoutMs: 6000,
    accept: "application/xml,text/xml,*/*",
  });
  const smValid = sm.status === 200 && /<(urlset|sitemapindex)\b/i.test(sm.body);
  let sitemap = { url: sitemapUrl, status: sm.status, valid: smValid, listedInRobots: !!listed };
  if (!smValid && !listed) {
    // Common alternatives (WordPress core, Yoast/Rank Math)
    for (const alt of ["/sitemap_index.xml", "/wp-sitemap.xml"]) {
      const r = await safeFetch(origin + alt, { userAgent: CITEREADY_UA, maxBytes: 64_000, timeoutMs: 4000 });
      if (r.status === 200 && /<(urlset|sitemapindex)\b/i.test(r.body)) {
        sitemap = { url: origin + alt, status: 200, valid: true, listedInRobots: false };
        break;
      }
    }
  }

  return {
    inputUrl: input,
    finalUrl: page.finalUrl,
    origin,
    host: final.hostname,
    page,
    html,
    platform: detectPlatform(html, page.headers),
    cdn: detectCdn(page.headers),
    robots: {
      url: robotsUrl,
      status: robotsRes.status,
      present: robotsLooksReal,
      body: robotsLooksReal ? robotsRes.body : "",
      parsed,
      error: robotsRes.error,
    },
    sitemap,
    llms: {
      url: llmsUrl,
      status: llmsRes.status,
      present: llmsRes.status === 200 && !/^\s*<(!doctype|html)/i.test(llmsRes.body) && llmsRes.body.trim().length > 0,
      body: llmsRes.status === 200 ? llmsRes.body.slice(0, 20000) : "",
    },
    botFetches,
  };
}

async function runBotFetches(url: string): Promise<BotFetch[]> {
  return Promise.all(
    FIREWALL_TEST_BOTS.map(async (token) => {
      const bot = getBot(token)!;
      const r = await safeFetch(url, { userAgent: bot.ua!, maxBytes: 2_500_000, timeoutMs: 8000 });
      return {
        token,
        status: r.status,
        words: r.body ? words(r.body) : 0,
        bytes: r.body.length,
        challenge: looksLikeChallenge(r.body),
        error: r.error,
      };
    }),
  );
}

export function scoreContext(ctx: AuditContext, startedAt = Date.now()): AuditResult {
  const checks = ALL_CHECKS.map((c) => c(ctx));
  const groups: GroupScore[] = (["reach", "understand", "quote"] as GroupId[]).map((id) => {
    const cs = checks.filter((c) => c.group === id);
    return {
      id,
      title: GROUP_TITLES[id],
      points: cs.reduce((a, c) => a + c.points, 0),
      earned: Math.round(cs.reduce((a, c) => a + c.earned, 0) * 10) / 10,
    };
  });
  const score = Math.round(checks.reduce((a, c) => a + c.earned, 0));
  return {
    version: ENGINE_VERSION,
    url: ctx.inputUrl,
    finalUrl: ctx.finalUrl,
    host: ctx.host,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    score,
    grade: gradeFor(score),
    groups,
    checks,
    site: {
      name: siteName(ctx),
      title: ctx.html.title,
      platform: ctx.platform.name,
      cdn: ctx.cdn,
      status: ctx.page.status,
      wordCount: ctx.html.wordCount,
    },
  };
}

export function gradeFor(score: number): string {
  if (score >= 90) return "AI-ready";
  if (score >= 75) return "Good";
  if (score >= 55) return "Needs work";
  if (score >= 35) return "Weak";
  return "Mostly invisible";
}

export async function runAudit(input: string, opts: { skipBotTest?: boolean } = {}): Promise<AuditResult> {
  const started = Date.now();
  const ctx = await buildContext(input, opts);
  return scoreContext(ctx, started);
}

export { UnsafeUrlError };
