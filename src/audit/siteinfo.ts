// Derive facts about the site (name, logo, social profiles, page type) from its own HTML.
// Fix snippets are generated from these, so they are pre-filled with the site's real data.

import type { AuditContext } from "./types.ts";
import { findSchemaNodes } from "./html.ts";

export const ORG_TYPES = [
  "Organization",
  "Corporation",
  "LocalBusiness",
  "OnlineStore",
  "OnlineBusiness",
  "NGO",
  "EducationalOrganization",
  "MedicalOrganization",
  "NewsMediaOrganization",
  "SportsOrganization",
  "GovernmentOrganization",
  "ProfessionalService",
  "Store",
  "Restaurant",
  "Dentist",
  "Physician",
  "LegalService",
  "Attorney",
  "RealEstateAgent",
  "AutomotiveBusiness",
  "HealthAndBeautyBusiness",
  "HomeAndConstructionBusiness",
  "FinancialService",
  "FoodEstablishment",
  "LodgingBusiness",
  "Hotel",
  "MedicalBusiness",
  "Person",
];

export const PAGE_TYPES = [
  "Product",
  "ProductGroup",
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "FAQPage",
  "QAPage",
  "HowTo",
  "LocalBusiness",
  "Restaurant",
  "Dentist",
  "Store",
  "ProfessionalService",
  "LegalService",
  "RealEstateAgent",
  "MedicalBusiness",
  "Service",
  "SoftwareApplication",
  "WebApplication",
  "MobileApplication",
  "Course",
  "Event",
  "Recipe",
  "JobPosting",
  "Book",
  "ItemList",
];

const SOCIAL_HOSTS = [
  "facebook.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "github.com",
  "tiktok.com",
  "pinterest.com",
  "crunchbase.com",
  "wikipedia.org",
  "wikidata.org",
  "threads.net",
  "medium.com",
  "producthunt.com",
  "g2.com",
  "trustpilot.com",
  "yelp.com",
  "bsky.app",
  "mastodon.social",
  "dribbble.com",
  "behance.net",
];

export function absUrl(href: string, base: string): string {
  if (!href || /^(data|javascript|blob):/i.test(href.trim())) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

export function siteName(ctx: AuditContext): string {
  const orgs = findSchemaNodes(ctx.html.jsonLd, ORG_TYPES);
  const fromSchema = orgs.map((o) => o.name).find((n): n is string => typeof n === "string" && n.length > 0);
  if (fromSchema) return fromSchema;
  const m = ctx.html.meta;
  if (m["og:site_name"]) return m["og:site_name"];
  if (m["application-name"]) return m["application-name"];
  const t = ctx.html.title;
  if (t) {
    const parts = t.split(/\s[|–—:·-]\s/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      // Brand is usually the shortest segment (often last)
      return parts.reduce((a, b) => (b.length <= a.length ? b : a));
    }
    if (t.length <= 40) return t;
  }
  const host = ctx.host.replace(/^www\./, "");
  const base = host.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function siteDescription(ctx: AuditContext): string {
  const m = ctx.html.meta;
  const d = m["description"] || m["og:description"] || m["twitter:description"];
  if (d) return d;
  const sentence = ctx.html.text.split(/(?<=[.!?])\s+/).find((s) => s.length > 60 && s.length < 220);
  return sentence || `${siteName(ctx)} website.`;
}

export function logoUrl(ctx: AuditContext): string {
  const orgs = findSchemaNodes(ctx.html.jsonLd, ORG_TYPES);
  for (const o of orgs) {
    const l = o.logo;
    if (typeof l === "string") return absUrl(l, ctx.finalUrl);
    if (l && typeof l === "object" && typeof (l as Record<string, unknown>).url === "string") {
      return absUrl((l as Record<string, string>).url, ctx.finalUrl);
    }
  }
  const icons = ctx.html.icons.filter((i) => !/^data:/i.test(i));
  const candidates = [
    ctx.html.images.find((i) => i.src && (/logo/.test(i.cls) || /logo/i.test(i.src) || /logo/i.test(i.alt)))?.src,
    icons.find((i) => /apple-touch|180|192|512/.test(i)) || icons[0],
    ctx.html.meta["og:image"],
  ];
  for (const c of candidates) {
    const u = c ? absUrl(c, ctx.finalUrl) : "";
    if (u) return u;
  }
  return `${ctx.origin}/logo.png`;
}

/** Social / profile links found on the page, deduplicated by host. */
export function socialLinks(ctx: AuditContext): string[] {
  const seen = new Map<string, string>();
  for (const l of ctx.html.links) {
    const href = absUrl(l.href, ctx.finalUrl);
    if (!href) continue;
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, "");
    const social = SOCIAL_HOSTS.find((s) => host === s || host.endsWith("." + s));
    if (!social) continue;
    if (/share|sharer|intent\/|\/plugins\/|dialog\/|\/embed\//i.test(u.pathname + u.search)) continue;
    if (u.pathname === "/" || u.pathname === "") continue;
    const key = social === "twitter.com" ? "x.com" : social;
    if (!seen.has(key)) seen.set(key, `${u.origin}${u.pathname.replace(/\/$/, "")}`);
  }
  return [...seen.values()];
}

export function schemaSameAs(ctx: AuditContext): string[] {
  const orgs = findSchemaNodes(ctx.html.jsonLd, ORG_TYPES);
  const out: string[] = [];
  for (const o of orgs) {
    const s = o.sameAs;
    if (typeof s === "string") out.push(s);
    else if (Array.isArray(s)) s.forEach((x) => typeof x === "string" && out.push(x));
  }
  return [...new Set(out)];
}

export type PageKind = "product" | "article" | "local" | "software" | "faq" | "generic";

export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.endsWith("?") ||
    /^(what|how|why|when|where|who|which|can|does|do|is|are|should|will|could|would)\b/.test(t)
  );
}

export function guessPageKind(ctx: AuditContext): PageKind {
  const h = ctx.html.rawLower;
  const m = ctx.html.meta;
  const path = new URL(ctx.finalUrl).pathname.toLowerCase();
  if (m["og:type"] === "product" || /add[ -]to[ -](cart|bag|basket)/.test(h) || /itemprop=["']?price/.test(h) || path.includes("/products/")) {
    return "product";
  }
  if (
    m["og:type"] === "article" ||
    m["article:published_time"] ||
    /\/(blog|news|articles?|posts?|insights|guides?)\//.test(path)
  ) {
    return "article";
  }
  const hasTel = ctx.html.links.some((l) => l.href.startsWith("tel:"));
  const hasAddress = /\b(street|st\.|road|rd\.|avenue|ave\.|suite|floor|nagar|marg|lane)\b/.test(h) || /maps\.google|google\.com\/maps|goo\.gl\/maps/.test(h);
  if (hasTel && hasAddress) return "local";
  if (/\b(free trial|start for free|sign up free|pricing|get started free)\b/.test(h) && /\b(app|platform|software|saas|dashboard|api)\b/.test(h)) {
    return "software";
  }
  if (ctx.html.headings.filter((x) => isQuestion(x.text)).length >= 2) return "faq";
  return "generic";
}

export function primaryImage(ctx: AuditContext): string {
  const og = ctx.html.meta["og:image"] || ctx.html.meta["twitter:image"];
  if (og) return absUrl(og, ctx.finalUrl);
  const img = ctx.html.images.find((i) => i.src && !/^data:/i.test(i.src) && !/logo|icon|pixel|spacer|\.svg/i.test(i.src + i.cls));
  return (img && absUrl(img.src, ctx.finalUrl)) || logoUrl(ctx);
}

export function trimTo(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

export function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function json(o: unknown): string {
  return JSON.stringify(o, null, 2);
}
