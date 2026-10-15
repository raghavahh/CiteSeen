// AI providers behind one interface, so NVIDIA NIM can be swapped for a licensed or live-search API
// (OpenAI, Perplexity, Anthropic…) by adding a provider here, without touching the checks.
import type { Env } from "../env.ts";

export interface ChatResult {
  text: string;
  model: string;
  ms: number;
}

export class ProviderError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export interface AiProvider {
  id: string;
  /** Does this provider search the live web? Shown on results so the method stays honest. */
  liveSearch: boolean;
  chat(model: string, system: string, user: string, opts?: { temperature?: number; maxTokens?: number }): Promise<ChatResult>;
}

/** Remove reasoning traces some models emit before their answer. */
export function cleanAnswer(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

export function nimProvider(env: Env): AiProvider {
  return {
    id: "nvidia-nim",
    liveSearch: false,
    async chat(model, system, user, opts = {}) {
      if (!env.NVIDIA_API_KEY) throw new ProviderError("AI checks aren't configured yet.", 503, false);
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: opts.temperature ?? 0.7,
            top_p: 0.95,
            max_tokens: opts.maxTokens ?? 700,
            stream: false,
          }),
          signal: AbortSignal.timeout(28_000),
        });
      } catch (e) {
        throw new ProviderError(`Model ${model} timed out or was unreachable.`, 504, true);
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500 || res.status === 404;
        throw new ProviderError(`Model ${model} returned ${res.status}.`, res.status, retryable);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
      const text = cleanAnswer(data.choices?.[0]?.message?.content || "");
      if (!text) throw new ProviderError(`Model ${model} returned an empty answer.`, 502, true);
      return { text, model, ms: Date.now() - started };
    },
  };
}
