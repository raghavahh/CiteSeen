// robots.txt parsing and matching, following RFC 9309 (the Google/Bing interpretation):
// - a crawler obeys the most specific group whose user-agent token matches its own, else the "*" group
// - groups with the same matching token are merged
// - the longest matching rule wins; on a tie, Allow wins
// - "*" wildcards and "$" end anchors are supported

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
  line: number;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  startLine: number;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  const lines = (text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) return;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], startLine: i + 1 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      return; // sitemap lines don't end a group's agent list semantics
    }
    lastWasAgent = false;
    if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ type: key, path: value, line: i + 1 });
    }
  });
  return { groups, sitemaps };
}

/**
 * Returns the rules that apply to a crawler. `null` group means no group matched (everything allowed).
 * Product token matching is case-insensitive; we match exact tokens, plus prefix tokens
 * (e.g. "googlebot" matches the "Googlebot" crawler but "googlebot-image" does not match "Googlebot").
 */
export function rulesFor(parsed: ParsedRobots, botToken: string): { rules: RobotsRule[]; matchedAgent: string | null } {
  const token = botToken.toLowerCase();
  const exact = parsed.groups.filter((g) => g.agents.includes(token));
  if (exact.length) {
    return { rules: exact.flatMap((g) => g.rules), matchedAgent: token };
  }
  const star = parsed.groups.filter((g) => g.agents.includes("*"));
  if (star.length) return { rules: star.flatMap((g) => g.rules), matchedAgent: "*" };
  return { rules: [], matchedAgent: null };
}

function patternToRegex(path: string): RegExp {
  let p = path;
  const anchored = p.endsWith("$");
  if (anchored) p = p.slice(0, -1);
  const escaped = p
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + escaped + (anchored ? "$" : ""));
}

export interface AllowDecision {
  allowed: boolean;
  matchedAgent: string | null;
  rule: RobotsRule | null;
}

export function isAllowed(parsed: ParsedRobots, botToken: string, path: string): AllowDecision {
  const { rules, matchedAgent } = rulesFor(parsed, botToken);
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (r.path === "") continue; // "Disallow:" with no value allows everything
    let target = path;
    try {
      target = decodeURI(path);
    } catch {
      /* keep raw */
    }
    if (!patternToRegex(r.path).test(path) && !patternToRegex(r.path).test(target)) continue;
    if (
      !best ||
      r.path.length > best.path.length ||
      (r.path.length === best.path.length && r.type === "allow" && best.type === "disallow")
    ) {
      best = r;
    }
  }
  return { allowed: !best || best.type === "allow", matchedAgent, rule: best };
}

/** True when a group blocks the whole site ("Disallow: /" and nothing allowing "/"). */
export function blocksEverything(parsed: ParsedRobots, botToken: string): boolean {
  return !isAllowed(parsed, botToken, "/").allowed;
}
