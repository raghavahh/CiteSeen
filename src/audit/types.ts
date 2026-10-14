import type { FetchResult } from "./fetcher.ts";
import type { ParsedHtml, Platform } from "./html.ts";
import type { ParsedRobots } from "./robots.ts";

export type GroupId = "reach" | "understand" | "quote" | "info";
export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface Fix {
  title: string;
  /** Plain-language steps, shown as a numbered list */
  steps?: string[];
  /** Copy-paste code, generated from the site's own data */
  code?: string;
  language?: "html" | "json" | "text" | "robots" | "http" | "markdown";
  /** Where the code goes, e.g. "robots.txt" or "<head>" */
  where?: string;
}

export interface CheckResult {
  id: string;
  group: GroupId;
  title: string;
  points: number;
  earned: number;
  status: CheckStatus;
  /** One-line result */
  summary: string;
  /** What we found: every point links back to evidence (transparent scoring) */
  evidence: string[];
  /** Why this matters for AI search */
  why: string;
  fix?: Fix;
}

export interface GroupScore {
  id: GroupId;
  title: string;
  points: number;
  earned: number;
}

export interface BotFetch {
  token: string;
  status: number;
  words: number;
  bytes: number;
  challenge: boolean;
  error?: string;
}

export interface AuditContext {
  inputUrl: string;
  finalUrl: string;
  origin: string;
  host: string;
  page: FetchResult;
  html: ParsedHtml;
  platform: Platform;
  cdn: string;
  robots: {
    url: string;
    status: number;
    /** robots.txt exists and looks like robots.txt (not an HTML soft-404) */
    present: boolean;
    body: string;
    parsed: ParsedRobots;
    error?: string;
  };
  sitemap: {
    url: string;
    status: number;
    valid: boolean;
    listedInRobots: boolean;
  };
  llms: {
    url: string;
    status: number;
    present: boolean;
    body: string;
  };
  botFetches: BotFetch[];
}

export interface AuditResult {
  id?: string;
  version: string;
  url: string;
  finalUrl: string;
  host: string;
  fetchedAt: string;
  durationMs: number;
  score: number;
  grade: string;
  groups: GroupScore[];
  checks: CheckResult[];
  site: {
    name: string;
    title: string;
    platform: string;
    cdn: string;
    status: number;
    wordCount: number;
  };
}
