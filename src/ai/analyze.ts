// Turn a model's free-text answer into measurable facts: is the brand named, where, who else, which sources.

export interface AnswerFacts {
  mentioned: boolean;
  /** 1-based rank of the brand among the businesses named (null if not mentioned) */
  position: number | null;
  competitors: string[];
  sources: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Brand aliases: the site name and its domain without TLD (e.g. "Acme Plumbing", "acmeplumbing", "acmeplumbing.com"). */
export function brandAliases(name: string, host: string): string[] {
  const h = host.replace(/^www\./, "").toLowerCase();
  const base = h.split(".")[0];
  const out = new Set<string>([h]);
  if (base.length >= 4) out.add(base);
  const n = name.trim();
  if (n.length >= 3 && n.length <= 60) out.add(n.toLowerCase());
  return [...out];
}

function findIndex(text: string, alias: string): number {
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(alias)}([^a-z0-9]|$)`, "i");
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
}

/** Names that lead list items: "1. **Acme** – …", "- Acme: …". */
export function listedNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\d{1,2}[.)]|[-*•])\s+(?:\*\*|__)?([^*_:\n–—(]{2,60}?)(?:\*\*|__)?\s*(?:[:–—(-]|$)/);
    if (m) {
      const n = m[1].trim().replace(/[*_`]/g, "");
      if (n && !/^(pros?|cons?|note|price|pricing|features?|why|best for|summary)$/i.test(n)) names.push(n);
    }
  }
  return names;
}

export function extractSources(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s)\]]*)?/gi)) out.add(m[1].toLowerCase().replace(/^www\./, ""));
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|in|dev|uk|us|ca|au|de))\b/gi)) out.add(m[1].toLowerCase().replace(/^www\./, ""));
  return [...out].slice(0, 20);
}

export function analyzeAnswer(answer: string, brand: { name: string; host: string }, knownCompetitors: string[] = []): AnswerFacts {
  const aliases = brandAliases(brand.name, brand.host);
  const brandIdx = Math.min(...aliases.map((a) => findIndex(answer, a)).filter((i) => i >= 0), Infinity);
  const mentioned = brandIdx !== Infinity;

  const listed = listedNames(answer);
  const isBrand = (n: string) => aliases.some((a) => n.toLowerCase().includes(a) || a.includes(n.toLowerCase()));
  let position: number | null = null;
  if (mentioned) {
    const rank = listed.findIndex(isBrand);
    if (rank >= 0) position = rank + 1;
    else {
      // Not in a list: rank by order of first appearance among named businesses
      const others = listed.map((n) => findIndex(answer, n)).filter((i) => i >= 0 && i < brandIdx).length;
      position = others + 1;
    }
  }

  const competitors = new Set<string>();
  for (const n of listed) if (!isBrand(n)) competitors.add(n);
  for (const c of knownCompetitors) if (c && findIndex(answer, c) >= 0 && !isBrand(c)) competitors.add(c);

  return { mentioned, position, competitors: [...competitors].slice(0, 15), sources: extractSources(answer) };
}
