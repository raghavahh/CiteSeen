import type { FetchResult } from "./fetcher.ts";
import type { ParsedHtml, Platform } from "./html.ts";
import type { ParsedRobots } from "./robots.ts";

export type GroupId = "reach" | "understand" | "quote" | "info";
/** na = not applicable to this page; inconclusive = we couldn't verify (neither counts toward the score). */
export type CheckStatus = "pass" | "warn" | "fail" | "info" | "na" | "inconclusive";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";

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
  /** How bad a failure here is (a crawler blocker is critical; missing OG tags is low). */
  severity: Severity;
  /** How sure we are of the result, given how it was tested. */
  confidence: Confidence;
  /** How this check was performed, in one sentence. */
  method: string;
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
  /** /about and /contact probed directly when the page doesn't link them (URL if it responded 200). */
  trustProbe?: { checked?: boolean; about?: string; contact?: string };
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
  /** Score = earned / applicable points. N/A and inconclusive checks are excluded. */
  scoring?: { earned: number; applicable: number; scored: number; excluded: string[] };
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
