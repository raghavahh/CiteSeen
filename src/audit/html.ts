// Lightweight, dependency-free HTML extraction.
// We only need what an AI crawler sees in the raw HTML (no JavaScript), so a tolerant
// regex-based scan is enough and runs identically in Workers, Node and tests.

export interface Heading {
  level: number;
  text: string;
}

export interface Link {
  href: string;
  text: string;
  rel: string;
}

export interface ParsedHtml {
  lang: string;
  title: string;
  titleCount: number;
  /** meta name/property (lowercased) -> content. First occurrence wins. */
  meta: Record<string, string>;
  canonical: string;
  headings: Heading[];
  links: Link[];
  jsonLd: unknown[];
  jsonLdErrors: number;
  schemaTypes: string[];
  /** Visible text from raw HTML (scripts, styles, templates removed). */
  text: string;
  wordCount: number;
  /** Lists with at least 3 items */
  listCount: number;
  tableCount: number;
  timeElements: string[];
  scriptCount: number;
  externalScriptCount: number;
  images: { src: string; alt: string; cls: string }[];
  icons: string[];
  hasEmptyAppRoot: boolean;
  generator: string;
  /** Lowercased raw HTML, kept for platform fingerprinting. */
  rawLower: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function* tags(html: string, name: string): Generator<Record<string, string>> {
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) yield parseAttrs(m[1]);
}

export function collectSchemaTypes(nodes: unknown[]): string[] {
  const types = new Set<string>();
  const visit = (n: unknown, depth: number) => {
    if (depth > 12 || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach((x) => visit(x, depth + 1));
      return;
    }
    const o = n as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") types.add(stripSchemaPrefix(t));
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(stripSchemaPrefix(x)));
    for (const v of Object.values(o)) if (typeof v === "object") visit(v, depth + 1);
  };
  nodes.forEach((n) => visit(n, 0));
  return [...types];
}

function stripSchemaPrefix(t: string): string {
  return t.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, "");
}

/** Find all schema.org nodes of the given types (searches @graph and nested objects). */
export function findSchemaNodes(nodes: unknown[], typeNames: string[]): Record<string, unknown>[] {
  const want = new Set(typeNames.map((t) => t.toLowerCase()));
  const found: Record<string, unknown>[] = [];
  const visit = (n: unknown, depth: number) => {
    if (depth > 12 || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach((x) => visit(x, depth + 1));
      return;
    }
    const o = n as Record<string, unknown>;
    const t = o["@type"];
    const ts = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => stripSchemaPrefix(x).toLowerCase());
    if (ts.some((x) => want.has(x))) found.push(o);
    for (const v of Object.values(o)) if (typeof v === "object") visit(v, depth + 1);
  };
  nodes.forEach((n) => visit(n, 0));
  return found;
}

export function parseHtml(rawHtml: string): ParsedHtml {
  const html = (rawHtml || "").replace(/<!--[\s\S]*?-->/g, "");
  const rawLower = html.toLowerCase();

  // JSON-LD before scripts are stripped
  const jsonLd: unknown[] = [];
  let jsonLdErrors = 0;
  let scriptCount = 0;
  let externalScriptCount = 0;
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html))) {
    const attrs = parseAttrs(sm[1]);
    const type = (attrs.type || "").toLowerCase();
    if (type === "application/ld+json") {
      const body = sm[2].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
      try {
        jsonLd.push(JSON.parse(body));
      } catch {
        jsonLdErrors++;
      }
      continue;
    }
    if (!type || type.includes("javascript") || type === "module") {
      scriptCount++;
      if (attrs.src) externalScriptCount++;
    }
  }

  const htmlTag = html.match(/<html\b([^>]*)>/i);
  const lang = htmlTag ? parseAttrs(htmlTag[1]).lang || "" : "";

  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
  // Ignore <title> inside inline SVG
  const title = titles.length ? stripTags(titles[0][1]) : "";

  const meta: Record<string, string> = {};
  for (const a of tags(html, "meta")) {
    const key = (a.name || a.property || a["http-equiv"] || "").toLowerCase();
    if (key && !(key in meta)) meta[key] = (a.content ?? "").trim();
    if (a.charset && !("charset" in meta)) meta.charset = a.charset;
  }

  let canonical = "";
  const icons: string[] = [];
  for (const a of tags(html, "link")) {
    const rel = (a.rel || "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical") && !canonical) canonical = a.href || "";
    if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
      if (a.href) icons.push(a.href);
    }
  }

  // Visible text: remove non-content blocks
  const body = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, " ");

  const headings: Heading[] = [];
  for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = stripTags(m[2]);
    headings.push({ level: Number(m[1]), text });
  }

  const links: Link[] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = parseAttrs(m[1]);
    if (a.href === undefined) continue;
    links.push({ href: a.href.trim(), text: stripTags(m[2]) || a["aria-label"] || a.title || "", rel: (a.rel || "").toLowerCase() });
  }

  const images: ParsedHtml["images"] = [];
  for (const a of tags(body, "img")) {
    images.push({ src: a.src || a["data-src"] || "", alt: a.alt || "", cls: `${a.class || ""} ${a.id || ""}`.toLowerCase() });
    if (images.length >= 200) break;
  }

  let listCount = 0;
  for (const m of body.matchAll(/<(ul|ol|dl)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const items = (m[2].match(/<(li|dt)\b/gi) || []).length;
    if (items >= 3) listCount++;
  }
  const tableCount = (body.match(/<table\b/gi) || []).length;

  const timeElements: string[] = [];
  for (const m of body.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time\s*>/gi)) {
    const a = parseAttrs(m[1]);
    timeElements.push(a.datetime || stripTags(m[2]));
  }

  const text = stripTags(body);
  const wordCount = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

  const hasEmptyAppRoot = /<div\b[^>]*\bid=["']?(root|app|__next|__nuxt|svelte|q-app|___gatsby)["']?[^>]*>\s*<\/div>/i.test(html);

  return {
    lang,
    title,
    titleCount: titles.length,
    meta,
    canonical,
    headings,
    links,
    jsonLd,
    jsonLdErrors,
    schemaTypes: collectSchemaTypes(jsonLd),
    text,
    wordCount,
    listCount,
    tableCount,
    timeElements,
    scriptCount,
    externalScriptCount,
    images,
    icons,
    hasEmptyAppRoot,
    generator: meta.generator || "",
    rawLower,
  };
}

// ---------------------------------------------------------------- fingerprinting

export interface Platform {
  id: string;
  name: string;
}

export function detectPlatform(p: ParsedHtml, headers: Record<string, string>): Platform {
  const h = p.rawLower;
  const gen = p.generator.toLowerCase();
  const server = (headers["server"] || "").toLowerCase();
  const powered = (headers["x-powered-by"] || "").toLowerCase();
  if (h.includes("cdn.shopify.com") || headers["x-shopid"] || headers["x-shopify-stage"]) return { id: "shopify", name: "Shopify" };
  if (gen.includes("wix") || h.includes("static.wixstatic.com") || headers["x-wix-request-id"]) return { id: "wix", name: "Wix" };
  if (gen.includes("squarespace") || h.includes("static1.squarespace.com")) return { id: "squarespace", name: "Squarespace" };
  if (gen.includes("webflow") || h.includes("data-wf-page") || h.includes("webflow.com")) return { id: "webflow", name: "Webflow" };
  if (gen.includes("framer") || h.includes("framerusercontent.com")) return { id: "framer", name: "Framer" };
  if (gen.includes("wordpress") || h.includes("/wp-content/") || h.includes("/wp-includes/")) return { id: "wordpress", name: "WordPress" };
  if (gen.includes("ghost")) return { id: "ghost", name: "Ghost" };
  if (gen.includes("hubspot") || h.includes("hs-scripts.com")) return { id: "hubspot", name: "HubSpot CMS" };
  if (h.includes("__next_data__") || h.includes("/_next/static/") || powered.includes("next.js")) return { id: "nextjs", name: "Next.js" };
  if (h.includes("__nuxt") || h.includes("/_nuxt/")) return { id: "nuxt", name: "Nuxt" };
  if (h.includes("___gatsby")) return { id: "gatsby", name: "Gatsby" };
  if (h.includes("ng-version=")) return { id: "angular", name: "Angular" };
  if (h.includes("data-astro-") || gen.includes("astro")) return { id: "astro", name: "Astro" };
  if (h.includes("data-sveltekit") || h.includes("__sveltekit")) return { id: "sveltekit", name: "SvelteKit" };
  if (h.includes('id="root"') && p.hasEmptyAppRoot) return { id: "react-spa", name: "React (client-side)" };
  if (h.includes('id="app"') && p.hasEmptyAppRoot) return { id: "vue-spa", name: "Vue (client-side)" };
  if (server.includes("vercel")) return { id: "vercel", name: "Vercel-hosted site" };
  return { id: "unknown", name: "" };
}

export function detectCdn(headers: Record<string, string>): string {
  const server = (headers["server"] || "").toLowerCase();
  if (headers["cf-ray"] || server.includes("cloudflare")) return "Cloudflare";
  if (headers["x-vercel-id"] || server.includes("vercel")) return "Vercel";
  if (headers["x-amz-cf-id"] || server.includes("cloudfront")) return "Amazon CloudFront";
  if (server.includes("akamai") || headers["x-akamai-transformed"]) return "Akamai";
  if (headers["x-served-by"]?.includes("cache-") || headers["x-fastly-request-id"]) return "Fastly";
  if (headers["x-sucuri-id"] || server.includes("sucuri")) return "Sucuri";
  if (headers["x-nf-request-id"] || server.includes("netlify")) return "Netlify";
  if (server.includes("imperva") || headers["x-iinfo"]) return "Imperva";
  return "";
}
