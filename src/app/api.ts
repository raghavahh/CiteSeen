// Signed-in dashboard API: account, branding, saved sites, history, alerts, exports.
import { normaliseInputUrl } from "../audit/fetcher.ts";
import { AuditError } from "../audit/run.ts";
import type { AuditResult } from "../audit/types.ts";
import type { User } from "../auth/session.ts";
import { features, type Env } from "../env.ts";
import { HttpError, body, json, monthKey, newId, rateLimit } from "../lib/http.ts";
import { LAUNCH_SEATS, PLANS, REPORT_PRICE, planOf } from "../plans.ts";
import { auditSite, type Site } from "./siteAudit.ts";

export function publicUser(u: User) {
  const plan = planOf(u);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    plan: plan.id,
    planUntil: u.plan_until,
    planSource: u.plan_source,
    launchPrice: !!u.launch_price,
    reportCredits: u.report_credits,
    brand: { name: u.brand_name, color: u.brand_color, logo: u.brand_logo, footer: u.brand_footer },
  };
}

export async function getUsage(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT ai_prompts FROM usage WHERE user_id = ?1 AND month = ?2").bind(userId, monthKey()).first<{ ai_prompts: number }>();
  return r?.ai_prompts ?? 0;
}

export async function me(env: Env, user: User): Promise<Response> {
  const plan = planOf(user);
  const [usage, sites, seats, unread] = await Promise.all([
    getUsage(env, user.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM sites WHERE user_id = ?1").bind(user.id).first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE launch_price = 1").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?1 AND read = 0").bind(user.id).first<{ n: number }>(),
  ]);
  return json({
    user: publicUser(user),
    limits: plan,
    usage: { aiPrompts: usage, sites: sites?.n ?? 0 },
    unreadAlerts: unread?.n ?? 0,
    launchSeatsLeft: Math.max(0, LAUNCH_SEATS - (seats?.n ?? 0)),
    plans: PLANS,
    reportPrice: REPORT_PRICE,
    features: features(env),
  });
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function updateBrand(req: Request, env: Env, user: User): Promise<Response> {
  const b = await body<{ name?: string; color?: string; logo?: string; footer?: string }>(req);
  const name = (b.name ?? user.brand_name).slice(0, 80);
  const color = b.color && COLOR_RE.test(b.color) ? b.color : user.brand_color;
  let logo = (b.logo ?? user.brand_logo).trim();
  if (logo && !/^https:\/\/[^\s"'<>]+$/i.test(logo)) throw new HttpError(400, "Logo must be an https:// image URL.");
  logo = logo.slice(0, 500);
  const footer = (b.footer ?? user.brand_footer).slice(0, 200);
  await env.DB.prepare("UPDATE users SET brand_name = ?1, brand_color = ?2, brand_logo = ?3, brand_footer = ?4 WHERE id = ?5")
    .bind(name, color, logo, footer, user.id)
    .run();
  return json({ ok: true, brand: { name, color, logo, footer } });
}

// ------------------------------------------------------------------ sites

async function ownSite(env: Env, user: User, id: string): Promise<Site> {
  const s = await env.DB.prepare("SELECT * FROM sites WHERE id = ?1 AND user_id = ?2").bind(id, user.id).first<Site>();
  if (!s) throw new HttpError(404, "Site not found.");
  return s;
}

export async function listSites(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.*, (SELECT json_group_array(score) FROM (SELECT score FROM audits a WHERE a.site_id = s.id ORDER BY created_at DESC LIMIT 12)) AS spark
     FROM sites s WHERE s.user_id = ?1 ORDER BY s.created_at DESC`,
  )
    .bind(user.id)
    .all<Site & { spark: string }>();
  return json({ sites: results.map((s) => ({ ...siteOut(s), spark: (JSON.parse(s.spark || "[]") as number[]).reverse() })) });
}

function siteOut(s: Site) {
  return {
    id: s.id,
    url: s.url,
    host: s.host,
    name: s.name,
    category: s.category,
    location: s.location,
    competitors: JSON.parse(s.competitors || "[]") as string[],
    weekly: !!s.weekly,
    lastScore: s.last_score,
    lastAuditAt: s.last_audit_at,
    lastAiScore: s.last_ai_score,
    createdAt: s.created_at,
  };
}

export async function addSite(req: Request, env: Env, user: User): Promise<Response> {
  const b = await body<{ url?: string; name?: string; category?: string; location?: string }>(req);
  let url: URL;
  try {
    url = normaliseInputUrl(b.url || "");
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Invalid address.");
  }
  const plan = planOf(user);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM sites WHERE user_id = ?1").bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= plan.sites) {
    throw new HttpError(402, `Your ${plan.name} plan includes ${plan.sites} client site${plan.sites > 1 ? "s" : ""}. Upgrade to add more.`);
  }
  const limited = await rateLimit(env, `site-add:${user.id}`, 30);
  if (limited) return limited;

  const site: Site = {
    id: newId(12),
    user_id: user.id,
    url: url.toString(),
    host: url.hostname,
    name: (b.name || "").slice(0, 120),
    category: (b.category || "").slice(0, 120),
    location: (b.location || "").slice(0, 120),
    competitors: "[]",
    weekly: plan.weekly ? 1 : 0,
    last_score: null,
    last_audit_at: null,
    last_ai_score: null,
    created_at: Date.now(),
  };
  try {
    await env.DB.prepare(
      "INSERT INTO sites (id, user_id, url, host, name, category, location, weekly, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
      .bind(site.id, site.user_id, site.url, site.host, site.name, site.category, site.location, site.weekly, site.created_at)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new HttpError(409, "You've already added this site.");
    throw e;
  }
  let audit: AuditResult | null = null;
  let auditError = "";
  try {
    audit = (await auditSite(env, site, "add")).result;
    if (!site.name) {
      site.name = audit.site.name;
      await env.DB.prepare("UPDATE sites SET name = ?1 WHERE id = ?2").bind(site.name, site.id).run();
    }
  } catch (e) {
    auditError = e instanceof AuditError ? e.message : "The first audit failed. You can re-run it from the site page.";
  }
  return json({ site: siteOut({ ...site, last_score: audit?.score ?? null, last_audit_at: audit ? Date.now() : null }), audit, auditError }, 201);
}

export async function getSite(env: Env, user: User, id: string): Promise<Response> {
  const site = await ownSite(env, user, id);
  const [latest, history, aiHistory] = await Promise.all([
    env.DB.prepare("SELECT id, result_json FROM audits WHERE site_id = ?1 ORDER BY created_at DESC LIMIT 1").bind(id).first<{ id: string; result_json: string }>(),
    env.DB.prepare("SELECT id, score, trigger, created_at FROM audits WHERE site_id = ?1 ORDER BY created_at DESC LIMIT 60").bind(id).all(),
    env.DB.prepare(
      `SELECT batch_id, MIN(created_at) AS at, SUM(mentioned) AS mentioned, SUM(runs) AS runs FROM ai_checks WHERE site_id = ?1 GROUP BY batch_id ORDER BY at DESC LIMIT 30`,
    )
      .bind(id)
      .all(),
  ]);
  return json({
    site: siteOut(site),
    latest: latest ? JSON.parse(latest.result_json) : null,
    history: history.results.reverse(),
    aiHistory: aiHistory.results.reverse(),
  });
}

export async function updateSite(req: Request, env: Env, user: User, id: string): Promise<Response> {
  const site = await ownSite(env, user, id);
  const b = await body<{ name?: string; category?: string; location?: string; competitors?: string[]; weekly?: boolean }>(req);
  const plan = planOf(user);
  const competitors = Array.isArray(b.competitors)
    ? b.competitors.map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 10)
    : (JSON.parse(site.competitors) as string[]);
  await env.DB.prepare("UPDATE sites SET name = ?1, category = ?2, location = ?3, competitors = ?4, weekly = ?5 WHERE id = ?6")
    .bind(
      (b.name ?? site.name).slice(0, 120),
      (b.category ?? site.category).slice(0, 120),
      (b.location ?? site.location).slice(0, 120),
      JSON.stringify(competitors),
      plan.weekly && (b.weekly ?? !!site.weekly) ? 1 : 0,
      id,
    )
    .run();
  return getSite(env, user, id);
}

export async function deleteSite(env: Env, user: User, id: string): Promise<Response> {
  await ownSite(env, user, id);
  await env.DB.prepare("DELETE FROM sites WHERE id = ?1").bind(id).run();
  return json({ ok: true });
}

export async function reauditSite(env: Env, user: User, id: string): Promise<Response> {
  const site = await ownSite(env, user, id);
  const limited = await rateLimit(env, `reaudit:${user.id}`, 60);
  if (limited) return limited;
  try {
    const { result, alerts } = await auditSite(env, site, "manual");
    return json({ audit: result, alerts });
  } catch (e) {
    if (e instanceof AuditError) throw new HttpError(422, e.message);
    throw e;
  }
}

/** Full audit for the owner (white-label print page). */
export async function getOwnAudit(env: Env, user: User, auditId: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT a.result_json, a.site_id, a.id FROM audits a WHERE a.id = ?1 AND a.user_id = ?2",
  )
    .bind(auditId, user.id)
    .first<{ result_json: string; site_id: string; id: string }>();
  if (!row) throw new HttpError(404, "Report not found.");
  const plan = planOf(user);
  const unlocked = plan.whiteLabel || (await env.KV.get(`wl:${row.id}`)) === "1";
  return json({
    audit: JSON.parse(row.result_json),
    whiteLabel: unlocked,
    canUnlock: !unlocked && user.report_credits > 0,
    brand: publicUser(user).brand,
  });
}

/** Spend one report credit to white-label a single audit. */
export async function unlockAudit(env: Env, user: User, auditId: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT id FROM audits WHERE id = ?1 AND user_id = ?2").bind(auditId, user.id).first();
  if (!row) throw new HttpError(404, "Report not found.");
  if ((await env.KV.get(`wl:${auditId}`)) === "1") return json({ ok: true });
  const r = await env.DB.prepare("UPDATE users SET report_credits = report_credits - 1 WHERE id = ?1 AND report_credits > 0 RETURNING report_credits")
    .bind(user.id)
    .first<{ report_credits: number }>();
  if (!r) throw new HttpError(402, "You have no report credits left. Buy one for $9 or upgrade to Plus.");
  await env.KV.put(`wl:${auditId}`, "1");
  return json({ ok: true, credits: r.report_credits });
}

export async function listAlerts(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.kind, a.message, a.read, a.created_at, a.site_id, s.host FROM alerts a LEFT JOIN sites s ON s.id = a.site_id
     WHERE a.user_id = ?1 ORDER BY a.created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all();
  return json({ alerts: results });
}

export async function markAlertsRead(env: Env, user: User): Promise<Response> {
  await env.DB.prepare("UPDATE alerts SET read = 1 WHERE user_id = ?1 AND read = 0").bind(user.id).run();
  return json({ ok: true });
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  // Neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportCsv(env: Env, user: User): Promise<Response> {
  if (!planOf(user).csv) throw new HttpError(402, "CSV export is included in Pro.");
  const { results } = await env.DB.prepare(
    `SELECT s.host, s.name, a.score, a.trigger, a.created_at FROM audits a JOIN sites s ON s.id = a.site_id WHERE a.user_id = ?1 ORDER BY s.host, a.created_at`,
  )
    .bind(user.id)
    .all<{ host: string; name: string; score: number; trigger: string; created_at: number }>();
  const lines = [["site", "name", "score", "trigger", "audited_at"].join(",")];
  for (const r of results) lines.push([r.host, r.name, r.score, r.trigger, new Date(r.created_at).toISOString()].map(csvCell).join(","));
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="citeready-history.csv"' },
  });
}
