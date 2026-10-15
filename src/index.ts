// CiteSeen Worker (runs as Pages _worker.js): JSON API, auth, dashboard API, billing and page routing.
// Static pages are served from ./public through env.ASSETS.

import { crawlerCheck, fetchRobots, llmsTool, rawView } from "./api/tools.ts";
import { getAi, runChecks, savePrompts } from "./ai/checks.ts";
import {
  addSite,
  deleteSite,
  exportCsv,
  getOwnAudit,
  getSite,
  listAlerts,
  listSites,
  markAlertsRead,
  me,
  reauditSite,
  unlockAudit,
  updateBrand,
  updateSite,
} from "./app/api.ts";
import { BOTS } from "./audit/bots.ts";
import { UnsafeUrlError, normaliseInputUrl } from "./audit/fetcher.ts";
import { AuditError, runAudit } from "./audit/run.ts";
import type { AuditResult } from "./audit/types.ts";
import { googleCallback, googleStart } from "./auth/google.ts";
import { EMAIL_RE, emailStart, emailVerify } from "./auth/magic.ts";
import { destroySession, getUser, requireUser, safeNext, type User } from "./auth/session.ts";
import { paypalCapture, paypalOrder, paypalReturn, paypalSubscribe, paypalWebhook } from "./billing/paypal.ts";
import { razorpayOrder, razorpayVerify, razorpayWebhook } from "./billing/razorpay.ts";
import type { Env } from "./env.ts";
import { HttpError, assertSameOrigin, clientIp, json, jsonHeaders, rateLimit, readJson, sha256Hex, newId } from "./lib/http.ts";

export type { Env };

const RESULT_TTL = 60 * 60 * 24 * 30; // shared links live 30 days
const CACHE_TTL = 60 * 10; // identical URL re-audits within 10 minutes return the cached result

type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: string[]) => Promise<Response>;
type Authed = (req: Request, env: Env, user: User, params: string[]) => Promise<Response>;

const authed =
  (fn: Authed): Handler =>
  async (req, env, _ctx, params) =>
    fn(req, env, await requireUser(req, env), params);

const ID = "([A-Za-z0-9]{8,16})";

const ROUTES: [string, RegExp, Handler][] = [
  // Public audit + tools (v0.1)
  ["POST", /^\/api\/audit$/, (req, env, ctx) => handleAudit(req, env, ctx)],
  ["GET", new RegExp(`^/api/audit/${ID}$`), (_req, env, _c, [id]) => getResult(id, env)],
  ["POST", /^\/api\/waitlist$/, (req, env) => handleWaitlist(req, env)],
  ["POST", /^\/api\/tools\/crawlers$/, (req, env) => tool(req, env, "crawlers", crawlerCheck)],
  ["POST", /^\/api\/tools\/robots$/, (req, env) => tool(req, env, "robots", fetchRobots)],
  ["POST", /^\/api\/tools\/llms$/, (req, env) => tool(req, env, "llms", llmsTool)],
  ["POST", /^\/api\/tools\/raw$/, (req, env) => tool(req, env, "raw", rawView)],
  ["GET", /^\/api\/health$/, async () => json({ ok: true })],
  ["GET", /^\/api\/bots$/, async () => json(BOTS.map(({ ua: _ua, ...b }) => b), 200, { "cache-control": "public, max-age=3600" })],

  // Auth
  ["GET", /^\/api\/auth\/google$/, (req, env) => googleStart(req, env)],
  ["GET", /^\/api\/auth\/google\/callback$/, (req, env) => googleCallback(req, env)],
  ["POST", /^\/api\/auth\/email$/, (req, env) => emailStart(req, env)],
  ["GET", /^\/api\/auth\/email\/verify$/, (req, env) => emailVerify(req, env)],
  ["POST", /^\/api\/auth\/logout$/, async (req, env) => json({ ok: true }, 200, { "set-cookie": await destroySession(req, env) })],

  // Account + dashboard
  ["GET", /^\/api\/me$/, authed((_req, env, user) => me(env, user))],
  ["POST", /^\/api\/me\/brand$/, authed((req, env, user) => updateBrand(req, env, user))],
  ["GET", /^\/api\/sites$/, authed((_req, env, user) => listSites(env, user))],
  ["POST", /^\/api\/sites$/, authed((req, env, user) => addSite(req, env, user))],
  ["GET", new RegExp(`^/api/sites/${ID}$`), authed((_req, env, user, [id]) => getSite(env, user, id))],
  ["PATCH", new RegExp(`^/api/sites/${ID}$`), authed((req, env, user, [id]) => updateSite(req, env, user, id))],
  ["DELETE", new RegExp(`^/api/sites/${ID}$`), authed((_req, env, user, [id]) => deleteSite(env, user, id))],
  ["POST", new RegExp(`^/api/sites/${ID}/audit$`), authed((_req, env, user, [id]) => reauditSite(env, user, id))],
  ["GET", new RegExp(`^/api/sites/${ID}/ai$`), authed((_req, env, user, [id]) => getAi(env, user, id))],
  ["PUT", new RegExp(`^/api/sites/${ID}/ai/prompts$`), authed((req, env, user, [id]) => savePrompts(req, env, user, id))],
  ["POST", new RegExp(`^/api/sites/${ID}/ai/run$`), authed((req, env, user, [id]) => runChecks(req, env, user, id))],
  ["GET", new RegExp(`^/api/reports/${ID}$`), authed((_req, env, user, [id]) => getOwnAudit(env, user, id))],
  ["POST", new RegExp(`^/api/reports/${ID}/unlock$`), authed((_req, env, user, [id]) => unlockAudit(env, user, id))],
  ["GET", /^\/api\/alerts$/, authed((_req, env, user) => listAlerts(env, user))],
  ["POST", /^\/api\/alerts\/read$/, authed((_req, env, user) => markAlertsRead(env, user))],
  ["GET", /^\/api\/export\.csv$/, authed((_req, env, user) => exportCsv(env, user))],

  // Billing
  ["POST", /^\/api\/billing\/paypal\/subscribe$/, authed((req, env, user) => paypalSubscribe(req, env, user))],
  ["POST", /^\/api\/billing\/paypal\/order$/, authed((req, env, user) => paypalOrder(req, env, user))],
  ["GET", /^\/api\/billing\/paypal\/return$/, (req, env) => paypalReturn(req, env)],
  ["GET", /^\/api\/billing\/paypal\/capture$/, (req, env) => paypalCapture(req, env)],
  ["POST", /^\/api\/billing\/paypal\/webhook$/, (req, env) => paypalWebhook(req, env)],
  ["POST", /^\/api\/billing\/razorpay\/order$/, authed((req, env, user) => razorpayOrder(req, env, user))],
  ["POST", /^\/api\/billing\/razorpay\/verify$/, authed((req, env, user) => razorpayVerify(req, env, user))],
  ["POST", /^\/api\/billing\/razorpay\/webhook$/, (req, env) => razorpayWebhook(req, env)],
];

/** Webhooks come from payment providers, not browsers, so they skip the same-origin check. */
const CROSS_ORIGIN_OK = /^\/api\/billing\/(paypal|razorpay)\/webhook$/;

export async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (path.startsWith("/api/")) {
      if (!CROSS_ORIGIN_OK.test(path)) assertSameOrigin(req);
      for (const [method, re, handler] of ROUTES) {
        const m = path.match(re);
        if (m && req.method === method) return await handler(req, env, ctx, m.slice(1));
      }
      return json({ error: "Not found" }, 404);
    }

    // Shareable result page: /r/<id> serves the report shell, which loads /api/audit/<id>
    if (/^\/r\/[A-Za-z0-9]{8,16}\/?$/.test(path)) return shell(env, req, "/report");

    // Dashboard SPA: every /app/* path serves the app shell; signed-out visitors go to /login
    if (path === "/app" || path.startsWith("/app/")) {
      if (/\.[a-z0-9]{2,5}$/i.test(path)) return env.ASSETS.fetch(req);
      const user = await getUser(req, env);
      if (!user) return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(path + url.search)}`, 302);
      return shell(env, req, "/app/");
    }
    if (path === "/login" || path === "/login/") {
      if (await getUser(req, env)) return Response.redirect(`${url.origin}${safeNext(url.searchParams.get("next"))}`, 302);
    }
    return env.ASSETS.fetch(req);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://lumberjack.razorpay.com https://api.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Security headers on every response (clickjacking, sniffing, referrer leaks, XSS blast radius). */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  const h = out.headers;
  if ((h.get("content-type") || "").includes("text/html")) h.set("content-security-policy", CSP);
  h.set("x-frame-options", "DENY");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return out;
}

export default {
  async fetch(req, env, ctx) {
    return withSecurityHeaders(await route(req, env, ctx));
  },
} satisfies ExportedHandler<Env>;

async function shell(env: Env, req: Request, asset: string): Promise<Response> {
  const res = await env.ASSETS.fetch(new Request(new URL(asset, req.url), req));
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: 200, headers });
}

// ------------------------------------------------------------------ audit

async function handleAudit(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const b = await readJson<{ url?: string; fresh?: boolean }>(req);
  if (!b?.url) return json({ error: "Enter a website address." }, 400);

  let normalised: string;
  try {
    normalised = normaliseInputUrl(b.url).toString();
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Invalid address." }, 400);
  }

  const cacheKey = `cache:${(await sha256Hex(normalised)).slice(0, 32)}`;
  if (!b.fresh) {
    const cachedId = await env.KV.get(cacheKey);
    if (cachedId) {
      const cached = await env.KV.get(`audit:${cachedId}`);
      if (cached) return new Response(cached, { headers: jsonHeaders({ "x-cache": "hit" }) });
    }
  }

  const limited = await rateLimit(env, `audit:${clientIp(req)}`, Number(env.RATE_LIMIT_PER_HOUR || 30));
  if (limited) return limited;

  let result: AuditResult;
  try {
    result = await runAudit(b.url);
  } catch (e) {
    if (e instanceof AuditError) return json({ error: e.message, code: e.code }, 422);
    if (e instanceof UnsafeUrlError) return json({ error: e.message, code: "bad_url" }, 400);
    throw e;
  }

  result.id = newId(10);
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
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
  const limited = await rateLimit(env, `waitlist:${clientIp(req)}`, 10);
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
  const limited = await rateLimit(env, `tool:${name}:${clientIp(req)}`, 60);
  if (limited) return limited;
  try {
    return json(await fn(b.url));
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof AuditError) return json({ error: e.message }, 400);
    return json({ error: e instanceof Error ? e.message : "Couldn't check that site." }, 422);
  }
}

async function bumpCounter(env: Env, key: string): Promise<void> {
  const n = Number((await env.KV.get(key)) || 0);
  await env.KV.put(key, String(n + 1));
}
