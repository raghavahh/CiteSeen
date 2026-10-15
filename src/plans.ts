// Plan limits. Single source of truth for the server, pricing page and app UI.

export type PlanId = "free" | "plus" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceUsd: number;
  launchPriceUsd?: number;
  priceInr: number;
  sites: number;
  weekly: boolean;
  whiteLabel: boolean;
  aiPromptsPerMonth: number;
  /** Model tier used by the AI router */
  modelTier: "small" | "mid" | "top";
  competitors: boolean;
  csv: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    priceInr: 0,
    sites: 1,
    weekly: false,
    whiteLabel: false,
    aiPromptsPerMonth: 10,
    modelTier: "small",
    competitors: false,
    csv: false,
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceUsd: 29,
    launchPriceUsd: 19,
    priceInr: 799,
    sites: 10,
    weekly: true,
    whiteLabel: true,
    aiPromptsPerMonth: 100,
    modelTier: "mid",
    competitors: false,
    csv: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 79,
    priceInr: 2499,
    sites: 30,
    weekly: true,
    whiteLabel: true,
    aiPromptsPerMonth: 500,
    modelTier: "top",
    competitors: true,
    csv: true,
  },
};

export const REPORT_PRICE = { usd: 9, inr: 249 };
/** First N agencies get Plus at the launch price, locked for life. */
export const LAUNCH_SEATS = 20;

const RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2 };

/** True when buying `target` would replace a higher plan the user still has. */
export function isDowngrade(user: { plan: string; plan_until: number | null }, target: PlanId): boolean {
  return RANK[planOf(user).id] > RANK[target];
}

export function planOf(user: { plan: string; plan_until: number | null }): Plan {
  const id = (user.plan in PLANS ? user.plan : "free") as PlanId;
  if (id !== "free" && user.plan_until && user.plan_until < Date.now()) return PLANS.free;
  return PLANS[id];
}
