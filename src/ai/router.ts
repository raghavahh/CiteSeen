// Load-aware model routing. Each request goes to the best model on the caller's tier ladder that still
// has capacity this minute; busy or failing models are skipped. Counters live in KV.
import type { Env } from "../env.ts";
import { GLOBAL_RPM, LADDERS, MODEL_RPM, type ModelTier } from "./models.ts";
import { ProviderError, type AiProvider, type ChatResult } from "./provider.ts";

export class BusyError extends Error {}

const minute = () => Math.floor(Date.now() / 60_000);

interface Counter {
  get(key: string): Promise<number>;
  incr(key: string): Promise<void>;
}

/** KV writes to one key are limited (~1/sec), so load counters are best-effort and never fail a request. */
const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

export function kvCounter(env: Env): Counter {
  return {
    async get(key) {
      return Number((await env.KV.get(key)) || 0);
    },
    async incr(key) {
      const n = Number((await env.KV.get(key)) || 0);
      await env.KV.put(key, String(n + 1), { expirationTtl: 120 });
    },
  };
}

/** Pick models in preference order for this tier, skipping ones over capacity this minute. */
export async function rankModels(counter: Counter, tier: ModelTier, cooldown: Set<string> = new Set()): Promise<string[]> {
  const m = minute();
  const ladder = LADDERS[tier];
  const loads = await Promise.all(ladder.map((id) => counter.get(`ai:load:${id}:${m}`)));
  const available = ladder.filter((id, i) => !cooldown.has(id) && loads[i] < MODEL_RPM[tier]);
  // When everything on the ladder is busy, fall back to the least-loaded model rather than refusing.
  if (!available.length) {
    const least = ladder.map((id, i) => ({ id, load: loads[i] })).filter((x) => !cooldown.has(x.id)).sort((a, b) => a.load - b.load)[0];
    return least ? [least.id] : [];
  }
  return available;
}

/** Run one chat request with routing and fallback (up to 3 models). */
export async function routedChat(
  env: Env,
  provider: AiProvider,
  tier: ModelTier,
  system: string,
  user: string,
  counter: Counter = kvCounter(env),
): Promise<ChatResult> {
  const m = minute();
  if ((await counter.get(`ai:load:all:${m}`)) >= GLOBAL_RPM) {
    throw new BusyError("AI checks are busy right now. Please try again in a minute.");
  }
  const parked = await env.KV.get("ai:cooldown");
  const cooldown = new Set<string>(parked ? (JSON.parse(parked) as string[]) : []);

  const candidates = (await rankModels(counter, tier, cooldown)).slice(0, 3);
  let lastError: unknown = null;
  for (const model of candidates) {
    await quiet(Promise.all([counter.incr(`ai:load:${model}:${m}`), counter.incr(`ai:load:all:${m}`)]));
    try {
      return await provider.chat(model, system, user);
    } catch (e) {
      lastError = e;
      if (e instanceof ProviderError && !e.retryable) throw e;
      // Park a failing model for 5 minutes so other users skip it too.
      cooldown.add(model);
      await quiet(env.KV.put("ai:cooldown", JSON.stringify([...cooldown]), { expirationTtl: 300 }));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new BusyError("No AI model is available right now. Please try again shortly.");
}
