// Model ladders per plan tier, best first. IDs verified against NVIDIA's live /v1/models list on 2026-10-15.
// The router walks down a ladder when a model is busy or failing. Pro's ladder ends at mid-size models,
// so Pro never drops to the small tier.

export type ModelTier = "top" | "mid" | "small";

export const LADDERS: Record<ModelTier, string[]> = {
  top: [
    "nvidia/nemotron-3-ultra-550b-a55b",
    "deepseek-ai/deepseek-v4.1-flash",
    "moonshotai/kimi-k2.6",
    "nvidia/nemotron-3-super-120b-a12b",
    "google/gemma-4-31b-it",
  ],
  mid: [
    "nvidia/nemotron-3-super-120b-a12b",
    "google/gemma-4-31b-it",
    "mistralai/mistral-large-2-instruct",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
  ],
  small: [
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "google/gemma-3-12b-it",
    "openai/gpt-oss-20b",
    "mistralai/mistral-7b-instruct-v0.3",
  ],
};

/**
 * Soft per-model capacity in requests per minute. One AI check is ~3 requests per prompt, so a
 * capacity of 15–30 means a model steps aside after roughly every 5–10 concurrent users.
 */
export const MODEL_RPM: Record<ModelTier, number> = { top: 15, mid: 24, small: 30 };

/** Account-wide ceiling, kept under NVIDIA's free-tier limit (~40 requests/minute). */
export const GLOBAL_RPM = 36;
