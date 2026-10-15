import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRobotsTxt, toQuestion } from "../src/audit/checks.ts";
import { trimToSentence } from "../src/audit/siteinfo.ts";
import { isPrivateIp, normaliseInputUrl } from "../src/audit/fetcher.ts";
import { parseHtml } from "../src/audit/html.ts";
import { isAllowed, parseRobots } from "../src/audit/robots.ts";
import { buildContext, runAudit } from "../src/audit/run.ts";
import { validateLlmsTxt } from "../src/api/tools.ts";

describe("robots.txt", () => {
  const txt = `
User-agent: *
Disallow: /admin/
Allow: /admin/public$

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: OAI-SearchBot
Disallow: /private
Sitemap: https://ex.com/sitemap.xml
`;
  const p = parseRobots(txt);

  it("parses groups and sitemaps", () => {
    expect(p.groups).toHaveLength(3);
    expect(p.groups[1].agents).toEqual(["gptbot", "ccbot"]);
    expect(p.sitemaps).toEqual(["https://ex.com/sitemap.xml"]);
  });
  it("uses the most specific group, else *", () => {
    expect(isAllowed(p, "GPTBot", "/").allowed).toBe(false);
    expect(isAllowed(p, "OAI-SearchBot", "/admin/").allowed).toBe(true); // own group ignores *
    expect(isAllowed(p, "OAI-SearchBot", "/private/x").allowed).toBe(false);
    expect(isAllowed(p, "PerplexityBot", "/admin/x").allowed).toBe(false);
    expect(isAllowed(p, "PerplexityBot", "/").allowed).toBe(true);
  });
  it("longest match wins, allow wins ties, $ anchors", () => {
    expect(isAllowed(p, "Bingbot", "/admin/public").allowed).toBe(true);
    expect(isAllowed(p, "Bingbot", "/admin/publicx").allowed).toBe(false);
    const q = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /a\nAllow: /a");
    expect(isAllowed(q, "x", "/file.pdf").allowed).toBe(false);
    expect(isAllowed(q, "x", "/file.pdf?x").allowed).toBe(true);
    expect(isAllowed(q, "x", "/a").allowed).toBe(true);
  });
  it("empty Disallow allows everything", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "x", "/").allowed).toBe(true);
  });
});

describe("url safety", () => {
  it("normalises bare domains", () => {
    expect(normaliseInputUrl(" Example.com ").toString()).toBe("https://example.com/");
  });
  it.each(["http://localhost", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://[::1]/", "ftp://example.com", "http://example.com:8080", "http://user:pw@example.com", "http://intranet", "http://printer.local"])(
    "rejects %s",
    (u) => {
      expect(() => normaliseInputUrl(u)).toThrow();
    },
  );
  it("classifies private IPs", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});

describe("html parsing", () => {
  const html = `<!doctype html><html lang="en"><head><title>Acme | Plumbing in Pune</title>
<meta name="description" content="Acme fixes leaks.">
<meta property="og:title" content="Acme">
<link rel="canonical" href="/x">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme","sameAs":["https://x.com/acme"]},{"@type":["WebSite"]}]}</script>
<script type="application/ld+json">{ broken</script>
</head><body><!-- <h1>hidden</h1> --><h1>Plumbing &amp; heating</h1><h2>How much does it cost?</h2>
<ul><li>a</li><li>b</li><li>c</li></ul><table><tr><td>1</td></tr></table>
<a href="/about">About us</a><a href="https://www.linkedin.com/company/acme">in</a>
<script>var x = "<h2>not a heading</h2>";</script><time datetime="2026-01-02">Jan 2</time></body></html>`;
  const p = parseHtml(html);
  it("extracts basics", () => {
    expect(p.lang).toBe("en");
    expect(p.title).toBe("Acme | Plumbing in Pune");
    expect(p.meta["og:title"]).toBe("Acme");
    expect(p.canonical).toBe("/x");
    expect(p.headings.map((h) => h.text)).toEqual(["Plumbing & heating", "How much does it cost?"]);
    expect(p.listCount).toBe(1);
    expect(p.tableCount).toBe(1);
    expect(p.timeElements).toEqual(["2026-01-02"]);
  });
  it("parses JSON-LD types and counts errors", () => {
    expect(p.schemaTypes.sort()).toEqual(["Organization", "WebSite"]);
    expect(p.jsonLdErrors).toBe(1);
  });
});

describe("llms.txt validator", () => {
  it("accepts a well-formed file", () => {
    expect(validateLlmsTxt("# Site\n\n> Summary\n\n## Pages\n\n- [A](https://a.com/x): y\n")[0].level).toBe("ok");
  });
  it("flags missing H1", () => {
    expect(validateLlmsTxt("hello").some((i) => i.level === "error")).toBe(true);
  });
});

describe("fix suggestions", () => {
  it("turns imperative headings into how-to questions", () => {
    expect(toQuestion("Pick your paper", "GATE A–Z")).toBe("How do I pick my paper?");
    expect(toQuestion("Our services", "Acme")).toBe("What services does Acme offer?");
    expect(toQuestion("Machine learning basics", "Acme")).toBe("What is machine learning basics?");
  });
  it("trims descriptions at a sentence end", () => {
    const d =
      "Every GATE 2027 topic in order for all 29 papers, with hand-picked lectures playing on the page, key-point notes and free official previous-year papers. ₹49 per paper for 1 year.";
    expect(trimToSentence(d, 160)).toBe(d.slice(0, d.indexOf(".") + 1));
  });
});

// ---------------------------------------------------------------- full audits with a mocked network

type Route = { status?: number; body: string; headers?: Record<string, string> };

function mockFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: string | URL | Request) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = routes[u];
    if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(r.body, { status: r.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...(r.headers || {}) } });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("full audit", () => {
  it("our own landing page scores 100 except sameAs (no profiles yet)", async () => {
    const pub = (f: string) => readFileSync(join(__dirname, "..", "public", f), "utf8");
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "https://citeseen.pages.dev/": { body: pub("index.html") },
        "https://citeseen.pages.dev/robots.txt": { body: pub("robots.txt"), headers: { "content-type": "text/plain" } },
        "https://citeseen.pages.dev/sitemap.xml": { body: pub("sitemap.xml"), headers: { "content-type": "application/xml" } },
        "https://citeseen.pages.dev/llms.txt": { body: pub("llms.txt"), headers: { "content-type": "text/plain" } },
      }),
    );
    const r = await runAudit("citeseen.pages.dev");
    const lost = r.checks.filter((c) => c.earned < c.points).map((c) => `${c.id}: ${c.summary}`);
    // sameAs needs real social profile URLs, which only the owner can add.
    expect(lost).toEqual([expect.stringMatching(/^same-as/)]);
    expect(r.score).toBe(95);
    expect(r.checks.find((c) => c.id === "llms-txt")!.status).toBe("pass");
  });

  it("flags a blocked, JS-only, noindex site and generates fixes from its data", async () => {
    const html = `<html><head><title>App</title><meta name="robots" content="noindex"></head><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const u = typeof input === "string" ? input : input.toString();
        const ua = new Headers(init?.headers).get("user-agent") || "";
        if (u === "https://shop.example/robots.txt")
          return new Response("User-agent: *\nDisallow: /cart\n\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /", { status: 200 });
        if (u === "https://shop.example/") {
          if (/OAI-SearchBot/.test(ua)) return new Response("<title>Just a moment...</title>", { status: 403, headers: { "cf-ray": "x" } });
          return new Response(html, { status: 200, headers: { "content-type": "text/html", "cf-ray": "abc" } });
        }
        return new Response("", { status: 404 });
      }),
    );
    const ctx = await buildContext("https://shop.example/");
    const r = await runAudit("https://shop.example/");
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));

    expect(byId["robots-search-bots"].earned).toBe(10);
    expect(byId["robots-search-bots"].summary).toContain("PerplexityBot");
    expect(byId["firewall-test"].status).toBe("warn");
    expect(byId["firewall-test"].fix!.steps!.join(" ")).toContain("Cloudflare");
    expect(byId["js-content"].earned).toBe(0);
    expect(byId["noindex"].fix!.code).toContain('content="noindex"');
    expect(byId["training-bots"].evidence.join()).toContain("Blocked: GPTBot");
    expect(r.score).toBeLessThan(40);

    // Corrected robots.txt: allows search bots, keeps /cart private, keeps the GPTBot choice
    const fixed = parseRobots(generateRobotsTxt(ctx));
    expect(isAllowed(fixed, "PerplexityBot", "/").allowed).toBe(true);
    expect(isAllowed(fixed, "OAI-SearchBot", "/cart").allowed).toBe(false);
    expect(isAllowed(fixed, "GPTBot", "/").allowed).toBe(false);
    expect(isAllowed(fixed, "SomeOtherBot", "/cart").allowed).toBe(false);
  });

  it("treats a 5xx robots.txt as a full block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const u = typeof input === "string" ? input : input.toString();
        if (u.endsWith("/robots.txt")) return new Response("err", { status: 503 });
        return new Response("<html><body><p>hello</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
      }),
    );
    const r = await runAudit("down.example", { skipBotTest: true });
    expect(r.checks.find((c) => c.id === "robots-search-bots")!.earned).toBe(0);
  });
});
