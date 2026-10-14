// Single source of truth for AI and search crawlers.
// Crawler rules change often: review this file monthly (see PRD "Risks").
// Last reviewed: 2026-10-14.

export type BotKind = "search" | "training" | "user";

export interface Bot {
  /** robots.txt user-agent token */
  token: string;
  owner: string;
  kind: BotKind;
  /** What the bot is used for, in plain words. */
  purpose: string;
  /** Full user-agent string used for the live firewall test (only for bots we impersonate). */
  ua?: string;
  docs?: string;
}

export const BOTS: Bot[] = [
  // --- Search / answer bots: blocking these removes you from AI answers. Scored.
  {
    token: "OAI-SearchBot",
    owner: "OpenAI",
    kind: "search",
    purpose: "Indexes pages so they can appear and be cited in ChatGPT search answers.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    docs: "https://platform.openai.com/docs/bots",
  },
  {
    token: "ChatGPT-User",
    owner: "OpenAI",
    kind: "user",
    purpose: "Fetches a page live when a ChatGPT user asks about it or clicks a link.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    docs: "https://platform.openai.com/docs/bots",
  },
  {
    token: "PerplexityBot",
    owner: "Perplexity",
    kind: "search",
    purpose: "Indexes pages so they can be surfaced and cited in Perplexity answers.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    docs: "https://docs.perplexity.ai/guides/bots",
  },
  {
    token: "Claude-SearchBot",
    owner: "Anthropic",
    kind: "search",
    purpose: "Indexes pages to improve the quality of Claude's search results.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
    docs: "https://support.claude.com/en/articles/8896518",
  },
  {
    token: "Googlebot",
    owner: "Google",
    kind: "search",
    purpose: "Indexes pages for Google Search, including AI Overviews and AI Mode.",
    docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
  },
  {
    token: "Bingbot",
    owner: "Microsoft",
    kind: "search",
    purpose: "Indexes pages for Bing and Copilot. Many ChatGPT search citations overlap with Bing results.",
    docs: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
  },

  // --- User-triggered fetchers: reported, not scored.
  {
    token: "Perplexity-User",
    owner: "Perplexity",
    kind: "user",
    purpose: "Fetches a page live when a Perplexity user's question needs it.",
  },
  {
    token: "Claude-User",
    owner: "Anthropic",
    kind: "user",
    purpose: "Fetches a page live when a Claude user asks about it.",
  },

  // --- Training bots: blocking is a legitimate business choice. Reported, never penalised.
  {
    token: "GPTBot",
    owner: "OpenAI",
    kind: "training",
    purpose: "Collects pages to train OpenAI models. Blocking it does not remove you from ChatGPT search.",
  },
  {
    token: "ClaudeBot",
    owner: "Anthropic",
    kind: "training",
    purpose: "Collects pages to train Anthropic models. Blocking it does not remove you from Claude search.",
  },
  {
    token: "CCBot",
    owner: "Common Crawl",
    kind: "training",
    purpose: "Builds the open Common Crawl dataset that many AI models are trained on.",
  },
  {
    token: "Google-Extended",
    owner: "Google",
    kind: "training",
    purpose: "Controls whether Google may use your content to train Gemini. Does not affect Google Search or AI Overviews.",
  },
  {
    token: "Applebot-Extended",
    owner: "Apple",
    kind: "training",
    purpose: "Controls whether Apple may use your content to train its AI models.",
  },
  {
    token: "Meta-ExternalAgent",
    owner: "Meta",
    kind: "training",
    purpose: "Collects pages to train Meta AI models.",
  },
  {
    token: "Bytespider",
    owner: "ByteDance",
    kind: "training",
    purpose: "Collects pages to train ByteDance models.",
  },
];

/** The six bots the "Search bots allowed" check scores (PRD: 12 points, 2 each). */
export const SCORED_SEARCH_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Claude-SearchBot",
  "Googlebot",
  "Bingbot",
];

/** Bots impersonated in the live firewall/CDN test. Keep this short: each is one subrequest. */
export const FIREWALL_TEST_BOTS = ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-SearchBot"];

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Identifies our own audit requests honestly (used for robots.txt, sitemap, llms.txt). */
export const CITEREADY_UA = "Mozilla/5.0 (compatible; CiteReadyAudit/0.1; +https://citeready-app.pages.dev/about)";

export function getBot(token: string): Bot | undefined {
  return BOTS.find((b) => b.token.toLowerCase() === token.toLowerCase());
}
