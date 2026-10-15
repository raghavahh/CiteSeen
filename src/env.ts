// Bindings and secrets. Optional secrets switch features on; missing ones show "coming soon".
export interface Env {
  ASSETS: Fetcher;
  KV: KVNamespace;
  DB: D1Database;
  SITE_URL: string;
  RATE_LIMIT_PER_HOUR: string;
  EMAIL_FROM: string;

  NVIDIA_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;

  PAYPAL_ENV?: string; // "sandbox" (default) | "live"
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_PLAN_PLUS?: string; // P-xxx billing plan ids
  PAYPAL_PLAN_PLUS_LAUNCH?: string;
  PAYPAL_PLAN_PRO?: string;

  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;

  /** Shared secret the cron Worker uses to call internal endpoints. */
  CRON_SECRET?: string;
}

export function features(env: Env) {
  return {
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    email: !!env.RESEND_API_KEY,
    ai: !!env.NVIDIA_API_KEY,
    paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
    razorpay: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  };
}
