// v0.3 AI answer checks: ask models the questions a client's customers ask, 3 runs each, and measure
// whether the client is named. Method and model are stored with every result.
import type { User } from "../auth/session.ts";
import type { Env } from "../env.ts";
import { HttpError, body, json, monthKey, newId, rateLimit } from "../lib/http.ts";
import { planOf } from "../plans.ts";
import type { Site } from "../app/siteAudit.ts";
import { analyzeAnswer, type AnswerFacts } from "./analyze.ts";
import { nimProvider, type AiProvider } from "./provider.ts";
import { BusyError, routedChat } from "./router.ts";

export const RUNS_PER_PROMPT = 3;
export const MAX_PROMPTS_PER_BATCH = 5;

const SYSTEM =
  "You are a knowledgeable assistant. Answer the user's question the way you normally would for a member of the public. " +
  "When the question asks for recommendations or comparisons, name specific businesses, products or websites, as a short numbered list with one line on each.";

/** "dental clinic" → "dental clinics", "agency" → "agencies". Leaves already-plural phrases alone. */
export function pluralize(phrase: string): string {
  const p = phrase.trim();
  if (/s$/i.test(p)) return p;
  if (/[^aeiou]y$/i.test(p)) return p.slice(0, -1) + "ies";
  if (/(x|ch|sh)$/i.test(p)) return p + "es";
  return p + "s";
}

export function suggestPrompts(site: { name: string; host: string; category: string; location: string }): string[] {
  const brand = site.name || site.host;
  const cat = site.category.trim();
  const loc = site.location.trim();
  const out: string[] = [];
  if (cat) {
    out.push(`What are the best ${pluralize(cat)}${loc ? ` in ${loc}` : ""}?`);
    out.push(`Which ${cat}${loc ? ` in ${loc}` : ""} would you recommend, and why?`);
  }
  out.push(`What is ${brand} and is it any good?`);
  out.push(`What are the best alternatives to ${brand}?`);
  if (!cat) out.push(`Who are the main competitors of ${site.host}?`);
  return out.slice(0, MAX_PROMPTS_PER_BATCH);
}

async function ownSite(env: Env, user: User, id: string): Promise<Site> {
  const s = await env.DB.prepare("SELECT * FROM sites WHERE id = ?1 AND user_id = ?2").bind(id, user.id).first<Site>();
  if (!s) throw new HttpError(404, "Site not found.");
  return s;
}

async function savedPrompts(env: Env, siteId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT prompt FROM ai_prompts WHERE site_id = ?1 ORDER BY created_at").bind(siteId).all<{ prompt: string }>();
  return results.map((r) => r.prompt);
}

export async function getAi(env: Env, user: User, siteId: string): Promise<Response> {
  const site = await ownSite(env, user, siteId);
  const saved = await savedPrompts(env, siteId);
  const latest = await env.DB.prepare("SELECT batch_id FROM ai_checks WHERE site_id = ?1 ORDER BY created_at DESC LIMIT 1")
    .bind(siteId)
    .first<{ batch_id: string }>();
  const checks = latest
    ? (
        await env.DB.prepare("SELECT * FROM ai_checks WHERE batch_id = ?1 ORDER BY created_at").bind(latest.batch_id).all<Record<string, unknown>>()
      ).results.map(checkOut)
    : [];
  const plan = planOf(user);
  const used = await env.DB.prepare("SELECT ai_prompts FROM usage WHERE user_id = ?1 AND month = ?2").bind(user.id, monthKey()).first<{ ai_prompts: number }>();
  return json({
    prompts: saved.length ? saved : suggestPrompts(site),
    suggested: !saved.length,
    checks,
    quota: { used: used?.ai_prompts ?? 0, limit: plan.aiPromptsPerMonth },
    tier: plan.modelTier,
    method: methodNote(),
    configured: !!env.NVIDIA_API_KEY,
  });
}

export function methodNote(): string {
  return `Each question is asked ${RUNS_PER_PROMPT} times and results are averaged, because AI answers vary between runs. Models are open models hosted on NVIDIA NIM. They answer from what they learned in training and do not search the live web, so this measures how well AI models already know the brand, not live ChatGPT or Perplexity citations.`;
}

function checkOut(r: Record<string, unknown>) {
  return {
    id: r.id,
    prompt: r.prompt,
    provider: r.provider,
    model: r.model,
    runs: r.runs,
    mentioned: r.mentioned,
    avgPosition: r.avg_position,
    competitors: JSON.parse(String(r.competitors || "[]")),
    sources: JSON.parse(String(r.sources || "[]")),
    answers: JSON.parse(String(r.answers || "[]")),
    createdAt: r.created_at,
  };
}

export async function savePrompts(req: Request, env: Env, user: User, siteId: string): Promise<Response> {
  await ownSite(env, user, siteId);
  const b = await body<{ prompts?: string[] }>(req);
  const prompts = (b.prompts || []).map((p) => String(p).trim().slice(0, 300)).filter((p) => p.length >= 5).slice(0, MAX_PROMPTS_PER_BATCH);
  if (!prompts.length) throw new HttpError(400, "Add at least one question (5+ characters).");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ai_prompts WHERE site_id = ?1").bind(siteId),
    ...prompts.map((p, i) => env.DB.prepare("INSERT INTO ai_prompts (id, site_id, prompt, created_at) VALUES (?1, ?2, ?3, ?4)").bind(newId(12), siteId, p, now + i)),
  ]);
  return json({ ok: true, prompts });
}

export interface PromptResult {
  prompt: string;
  model: string;
  runs: number;
  mentioned: number;
  avgPosition: number | null;
  competitors: { name: string; count: number }[];
  sources: string[];
  answers: string[];
}

/** Run one prompt RUNS_PER_PROMPT times and aggregate. Pure apart from the provider call (testable). */
export async function runPrompt(
  ask: (prompt: string) => Promise<{ text: string; model: string }>,
  prompt: string,
  brand: { name: string; host: string },
  competitors: string[],
): Promise<PromptResult> {
  const settled = await Promise.allSettled(Array.from({ length: RUNS_PER_PROMPT }, () => ask(prompt)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<{ text: string; model: string }> => s.status === "fulfilled").map((s) => s.value);
  if (!ok.length) {
    const reason = (settled[0] as PromiseRejectedResult).reason;
    throw reason instanceof Error ? reason : new Error("All runs failed");
  }
  const facts: AnswerFacts[] = ok.map((a) => analyzeAnswer(a.text, brand, competitors));
  const positions = facts.map((f) => f.position).filter((p): p is number => p !== null);
  const counts = new Map<string, number>();
  for (const f of facts) for (const c of f.competitors) counts.set(c, (counts.get(c) || 0) + 1);
  return {
    prompt,
    model: [...new Set(ok.map((a) => a.model))].join(", "),
    runs: ok.length,
    mentioned: facts.filter((f) => f.mentioned).length,
    avgPosition: positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null,
    competitors: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    sources: [...new Set(facts.flatMap((f) => f.sources))].slice(0, 15),
    answers: ok.map((a) => a.text.slice(0, 2500)),
  };
}

export async function runChecks(req: Request, env: Env, user: User, siteId: string, provider: AiProvider = nimProvider(env)): Promise<Response> {
  const site = await ownSite(env, user, siteId);
  if (!env.NVIDIA_API_KEY) throw new HttpError(503, "AI answer checks are coming soon.");
  const b = await body<{ prompts?: string[] }>(req).catch(() => ({ prompts: undefined }));
  let prompts = (b.prompts || []).map((p) => String(p).trim().slice(0, 300)).filter((p) => p.length >= 5);
  if (!prompts.length) prompts = (await savedPrompts(env, siteId)).length ? await savedPrompts(env, siteId) : suggestPrompts(site);
  prompts = prompts.slice(0, MAX_PROMPTS_PER_BATCH);

  const plan = planOf(user);
  const month = monthKey();
  // Run as many questions as the remaining quota allows (the reservation below is the real guard)
  const usedRow = await env.DB.prepare("SELECT ai_prompts FROM usage WHERE user_id = ?1 AND month = ?2").bind(user.id, month).first<{ ai_prompts: number }>();
  const remaining = plan.aiPromptsPerMonth - (usedRow?.ai_prompts ?? 0);
  if (remaining <= 0) throw new HttpError(402, `You've used this month's ${plan.aiPromptsPerMonth} AI questions on the ${plan.name} plan. Upgrade for more.`);
  prompts = prompts.slice(0, remaining);
  // Reserve quota atomically before spending model calls
  const reserved = await env.DB.prepare(
    `INSERT INTO usage (user_id, month, ai_prompts) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, month) DO UPDATE SET ai_prompts = ai_prompts + excluded.ai_prompts
     WHERE usage.ai_prompts + excluded.ai_prompts <= ?4
     RETURNING ai_prompts`,
  )
    .bind(user.id, month, prompts.length, plan.aiPromptsPerMonth)
    .first<{ ai_prompts: number }>();
  if (!reserved || reserved.ai_prompts > plan.aiPromptsPerMonth) {
    if (reserved) await env.DB.prepare("UPDATE usage SET ai_prompts = ai_prompts - ?1 WHERE user_id = ?2 AND month = ?3").bind(prompts.length, user.id, month).run();
    throw new HttpError(402, `You've used this month's ${plan.aiPromptsPerMonth} AI questions on the ${plan.name} plan. Upgrade for more.`);
  }
  const limited = await rateLimit(env, `ai:${user.id}`, 20);
  if (limited) {
    await env.DB.prepare("UPDATE usage SET ai_prompts = ai_prompts - ?1 WHERE user_id = ?2 AND month = ?3").bind(prompts.length, user.id, month).run();
    return limited;
  }

  const brand = { name: site.name, host: site.host };
  const competitors = JSON.parse(site.competitors || "[]") as string[];
  const ask = (p: string) => routedChat(env, provider, plan.modelTier, SYSTEM, p);
  const settled = await Promise.allSettled(prompts.map((p) => runPrompt(ask, p, brand, competitors)));
  const results = settled.filter((s): s is PromiseFulfilledResult<PromptResult> => s.status === "fulfilled").map((s) => s.value);
  const failed = prompts.length - results.length;
  if (failed) {
    await env.DB.prepare("UPDATE usage SET ai_prompts = ai_prompts - ?1 WHERE user_id = ?2 AND month = ?3").bind(failed, user.id, month).run();
  }
  if (!results.length) {
    const reason = (settled[0] as PromiseRejectedResult).reason;
    if (reason instanceof BusyError) throw new HttpError(503, reason.message);
    throw new HttpError(502, "The AI models didn't answer. Your quota wasn't used. Please try again.");
  }

  const batchId = newId(12);
  const now = Date.now();
  const totalRuns = results.reduce((a, r) => a + r.runs, 0);
  const totalMentioned = results.reduce((a, r) => a + r.mentioned, 0);
  const visibility = Math.round((totalMentioned / totalRuns) * 1000) / 10;
  await env.DB.batch([
    ...results.map((r, i) =>
      env.DB.prepare(
        `INSERT INTO ai_checks (id, site_id, user_id, batch_id, prompt, provider, model, runs, mentioned, avg_position, competitors, sources, answers, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      ).bind(
        newId(12),
        siteId,
        user.id,
        batchId,
        r.prompt,
        provider.id,
        r.model,
        r.runs,
        r.mentioned,
        r.avgPosition,
        JSON.stringify(r.competitors),
        JSON.stringify(r.sources),
        JSON.stringify(r.answers),
        now + i,
      ),
    ),
    env.DB.prepare("UPDATE sites SET last_ai_score = ?1 WHERE id = ?2").bind(visibility, siteId),
  ]);
  return json({ batchId, visibility, results, failed, method: methodNote(), liveSearch: provider.liveSearch });
}
