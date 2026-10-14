// CiteReady Worker: JSON API + shareable result pages. Static pages are served from ./public.

import { BOTS } from "./audit/bots.ts";
import { UnsafeUrlError, normaliseInputUrl } from "./audit/fetcher.ts";
import { AuditError, runAudit } from "./audit/run.ts";
import type { AuditResult } from "./audit/types.ts";
import { crawlerCheck, fetchRobots, llmsTool, rawView } from "./api/tools.ts";

export interface Env {
  ASSETS: Fetcher;
  KV: KVNamespace;
  SITE_URL: string;
  RATE_LIMIT_PER_HOUR: string;
}

const RESULT_TTL = 60 * 60 * 24 * 30; // shared links live 30 days
const CACHE_TTL = 60 * 10; // identical URL re-audits within 10 minutes return the cached result

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/api/audit" && req.method === "POST") return await handleAudit(req, env, ctx);
      const m = path.match(/^\/api\/audit\/([A-Za-z0-9]{8,16})$/);
      if (m && req.method === "GET") return await getResult(m[1], env);
      if (path === "/api/waitlist" && req.method === "POST") return await handleWaitlist(req, env);
      if (path === "/api/tools/crawlers" && req.method === "POST") return await tool(req, env, "crawlers", crawlerCheck);
      if (path === "/api/tools/robots" && req.method === "POST") return await tool(req, env, "robots", fetchRobots);
      if (path === "/api/tools/llms" && req.method === "POST") return await tool(req, env, "llms", llmsTool);
      if (path === "/api/tools/raw" && req.method === "POST") return await tool(req, env, "raw", rawView);
      if (path === "/api/health") return json({ ok: true });
      if (path === "/api/bots") return json(BOTS.map(({ ua: _ua, ...b }) => b), 200, { "cache-control": "public, max-age=3600" });

      // Shareable result page: /r/<id> serves the report shell, which loads /api/audit/<id>
      if (/^\/r\/[A-Za-z0-9]{8,16}\/?$/.test(path)) {
        const shell = await env.ASSETS.fetch(new Request(new URL("/report", url), req));
        return new Response(shell.body, { status: 200, headers: shell.headers });
      }
      if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ------------------------------------------------------------------ audit

async function handleAudit(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson<{ url?: string; fresh?: boolean }>(req);
  if (!body?.url) return json({ error: "Enter a website address." }, 400);

  let normalised: string;
  try {
    normalised = normaliseInputUrl(body.url).toString();
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Invalid address." }, 400);
  }

  const cacheKey = `cache:${await sha(normalised)}`;
  if (!body.fresh) {
    const cachedId = await env.KV.get(cacheKey);
    if (cachedId) {
      const cached = await env.KV.get(`audit:${cachedId}`);
      if (cached) return new Response(cached, { headers: jsonHeaders({ "x-cache": "hit" }) });
    }
  }

  const limited = await rateLimit(req, env, "audit", Number(env.RATE_LIMIT_PER_HOUR || 30));
  if (limited) return limited;

  let result: AuditResult;
  try {
    result = await runAudit(body.url);
  } catch (e) {
    if (e instanceof AuditError) return json({ error: e.message, code: e.code }, 422);
    if (e instanceof UnsafeUrlError) return json({ error: e.message, code: "bad_url" }, 400);
    throw e;
  }

  result.id = newId();
  const payload = JSON.stringify(result);
  // Store before responding so the share link works immediately
  await env.KV.put(`audit:${result.id}`, payload, { expirationTtl: RESULT_TTL });
  ctx.waitUntil(Promise.all([env.KV.put(cacheKey, result.id, { expirationTtl: CACHE_TTL }), bumpCounter(env, "stats:audits")]));
  return new Response(payload, { headers: jsonHeaders() });
}

async function getResult(id: string, env: Env): Promise<Response> {
  const r = await env.KV.get(`audit:${id}`);
  if (!r) return json({ error: "This report has expired or doesn't exist. Run a new audit." }, 404);
  return new Response(r, { headers: jsonHeaders({ "cache-control": "public, max-age=300" }) });
}

// ------------------------------------------------------------------ waitlist

async function handleWaitlist(req: Request, env: Env): Promise<Response> {
  const b = await readJson<{ email?: string; agency?: string; clients?: string; source?: string; website?: string }>(req);
  // `website` is a honeypot field: real users never see it
  if (b?.website) return json({ ok: true });
  const email = (b?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  const limited = await rateLimit(req, env, "waitlist", 10);
  if (limited) return limited;
  const key = `waitlist:${email}`;
  const existing = await env.KV.get(key);
  if (!existing) {
    await env.KV.put(
      key,
      JSON.stringify({
        email,
        agency: (b?.agency || "").slice(0, 200),
        clients: (b?.clients || "").slice(0, 20),
        source: (b?.source || "").slice(0, 200),
        country: (req as Request & { cf?: { country?: string } }).cf?.country || "",
        at: new Date().toISOString(),
      }),
    );
    await bumpCounter(env, "stats:waitlist");
  }
  return json({ ok: true, already: !!existing });
}

// ------------------------------------------------------------------ tools

async function tool<T>(req: Request, env: Env, name: string, fn: (url: string) => Promise<T>): Promise<Response> {
  const b = await readJson<{ url?: string }>(req);
  if (!b?.url) return json({ error: "Enter a website address." }, 400);
  const limited = await rateLimit(req, env, `tool:${name}`, 60);
  if (limited) return limited;
  try {
    return json(await fn(b.url));
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof AuditError) return json({ error: e.message }, 400);
    return json({ error: e instanceof Error ? e.message : "Couldn't check that site." }, 422);
  }
}

// ------------------------------------------------------------------ helpers

async function rateLimit(req: Request, env: Env, bucket: string, perHour: number): Promise<Response | null> {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `rl:${bucket}:${ip}:${hour}`;
  const n = Number((await env.KV.get(key)) || 0);
  if (n >= perHour) {
    return json({ error: `You've hit the limit of ${perHour} per hour. Please try again a bit later.` }, 429, { "retry-after": "600" });
  }
  await env.KV.put(key, String(n + 1), { expirationTtl: 3700 });
  return null;
}

async function bumpCounter(env: Env, key: string): Promise<void> {
  const n = Number((await env.KV.get(key)) || 0);
  await env.KV.put(key, String(n + 1));
}

function newId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > 10_000) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...extra };
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders(extra) });
}
