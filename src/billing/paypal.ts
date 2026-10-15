// PayPal (USD): monthly subscriptions for Plus/Pro and one-time $9 report credits.
// Sandbox by default; set PAYPAL_ENV=live only after testing.
import type { User } from "../auth/session.ts";
import type { Env } from "../env.ts";
import { HttpError, body, clientIp, json, newId, rateLimit, redirect } from "../lib/http.ts";
import { LAUNCH_SEATS, REPORT_PRICE, isDowngrade } from "../plans.ts";
import { MONTH_MS, fulfilPayment, revokePayment, setPlanUntilAtLeast } from "./fulfil.ts";

function base(env: Env): string {
  return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function requireConfigured(env: Env): void {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new HttpError(503, "PayPal checkout is coming soon.");
}

async function accessToken(env: Env): Promise<string> {
  const cached = await env.KV.get("paypal:token");
  if (cached) return cached;
  const res = await fetch(`${base(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new HttpError(502, "Couldn't reach PayPal. Please try again.");
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await env.KV.put("paypal:token", t.access_token, { expirationTtl: Math.max(60, t.expires_in - 120) });
  return t.access_token;
}

async function pp<T>(env: Env, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${base(env)}${path}`, {
    method: init.method || "GET",
    headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json", prefer: "return=representation" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    console.error("PayPal error", path, res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "PayPal returned an error. Please try again.");
  }
  return (await res.json()) as T;
}

const approveLink = (links: { rel: string; href: string }[]) => links.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;

async function launchSeatsLeft(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE launch_price = 1").first<{ n: number }>();
  return LAUNCH_SEATS - (r?.n ?? 0);
}

export async function paypalSubscribe(req: Request, env: Env, user: User): Promise<Response> {
  requireConfigured(env);
  const limited = await rateLimit(env, `pp-sub:${user.id}`, 10);
  if (limited) return limited;
  const b = await body<{ plan?: string }>(req);
  const plan = b.plan === "pro" ? "pro" : "plus";
  if (isDowngrade(user, plan)) throw new HttpError(400, "You already have a higher plan. Manage it from your billing page.");
  const launch = plan === "plus" && !!env.PAYPAL_PLAN_PLUS_LAUNCH && (await launchSeatsLeft(env)) > 0;
  const planId = plan === "pro" ? env.PAYPAL_PLAN_PRO : launch ? env.PAYPAL_PLAN_PLUS_LAUNCH : env.PAYPAL_PLAN_PLUS;
  if (!planId) throw new HttpError(503, "This plan isn't available through PayPal yet.");
  const origin = new URL(req.url).origin;
  const sub = await pp<{ id: string; links: { rel: string; href: string }[] }>(env, "/v1/billing/subscriptions", {
    method: "POST",
    body: {
      plan_id: planId,
      custom_id: user.id,
      subscriber: { email_address: user.email },
      application_context: {
        brand_name: "CiteSeen",
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: `${origin}/api/billing/paypal/return`,
        cancel_url: `${origin}/app/billing?status=cancelled`,
      },
    },
  });
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO payments (id, user_id, provider, provider_ref, kind, plan, amount, currency, status, created_at, updated_at) VALUES (?1, ?2, 'paypal', ?3, 'subscription', ?4, ?5, 'USD', 'created', ?6, ?6)",
  )
    .bind(newId(12), user.id, sub.id, launch ? "plus_launch" : plan, (plan === "pro" ? 79 : launch ? 19 : 29) * 100, now)
    .run();
  return json({ approveUrl: approveLink(sub.links) });
}

interface PaypalSubscription {
  id: string;
  status: string;
  custom_id?: string;
  plan_id: string;
}

/** Activate a subscription after confirming its status with PayPal (never trust the redirect alone). */
async function syncSubscription(env: Env, subId: string): Promise<boolean> {
  const sub = await pp<PaypalSubscription>(env, `/v1/billing/subscriptions/${encodeURIComponent(subId)}`);
  const row = await env.DB.prepare("SELECT user_id, plan FROM payments WHERE provider = 'paypal' AND provider_ref = ?1")
    .bind(sub.id)
    .first<{ user_id: string; plan: string }>();
  if (!row || row.user_id !== sub.custom_id) return false;
  if (sub.status === "ACTIVE") {
    const first = await env.DB.prepare("UPDATE payments SET status = 'active', updated_at = ?1 WHERE provider_ref = ?2 AND status IN ('created', 'cancelled') RETURNING id")
      .bind(Date.now(), sub.id)
      .first();
    if (first) await setPlanUntilAtLeast(env, row.user_id, row.plan === "pro" ? "pro" : "plus", Date.now() + MONTH_MS, "paypal_sub", row.plan === "plus_launch");
    return true;
  }
  if (["CANCELLED", "SUSPENDED", "EXPIRED"].includes(sub.status)) {
    // Access continues until plan_until; no early cut-off.
    await env.DB.prepare("UPDATE payments SET status = 'cancelled', updated_at = ?1 WHERE provider_ref = ?2").bind(Date.now(), sub.id).run();
  }
  return false;
}

export async function paypalReturn(req: Request, env: Env): Promise<Response> {
  requireConfigured(env);
  if (await rateLimit(env, `pp-ret:${clientIp(req)}`, 30)) return redirect("/app/billing?status=pending");
  const id = new URL(req.url).searchParams.get("subscription_id") || "";
  if (!/^I-[A-Z0-9]{6,30}$/.test(id)) return redirect("/app/billing?status=error");
  const ok = await syncSubscription(env, id);
  return redirect(`/app/billing?status=${ok ? "success" : "pending"}`);
}

export async function paypalOrder(req: Request, env: Env, user: User): Promise<Response> {
  requireConfigured(env);
  const limited = await rateLimit(env, `pp-order:${user.id}`, 10);
  if (limited) return limited;
  const origin = new URL(req.url).origin;
  const order = await pp<{ id: string; links: { rel: string; href: string }[] }>(env, "/v2/checkout/orders", {
    method: "POST",
    body: {
      intent: "CAPTURE",
      purchase_units: [
        { custom_id: user.id, description: "CiteSeen white-label report credit", amount: { currency_code: "USD", value: REPORT_PRICE.usd.toFixed(2) } },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "CiteSeen",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: `${origin}/api/billing/paypal/capture`,
            cancel_url: `${origin}/app/billing?status=cancelled`,
          },
        },
      },
    },
  });
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO payments (id, user_id, provider, provider_ref, kind, amount, currency, status, created_at, updated_at) VALUES (?1, ?2, 'paypal', ?3, 'report', ?4, 'USD', 'created', ?5, ?5)",
  )
    .bind(newId(12), user.id, order.id, REPORT_PRICE.usd * 100, now)
    .run();
  return json({ approveUrl: approveLink(order.links) });
}

export async function paypalCapture(req: Request, env: Env): Promise<Response> {
  requireConfigured(env);
  if (await rateLimit(env, `pp-cap:${clientIp(req)}`, 30)) return redirect("/app/billing?status=pending");
  const id = new URL(req.url).searchParams.get("token") || "";
  if (!/^[A-Z0-9]{10,30}$/.test(id)) return redirect("/app/billing?status=error");
  const res = await fetch(`${base(env)}/v2/checkout/orders/${id}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as { status?: string; details?: { issue?: string }[] };
  const completed = data.status === "COMPLETED" || data.details?.[0]?.issue === "ORDER_ALREADY_CAPTURED";
  if (completed) await fulfilPayment(env, "paypal", id);
  return redirect(`/app/billing?status=${completed ? "success" : "error"}`);
}

/** PayPal webhooks, verified with PayPal's own verification API before acting. */
export async function paypalWebhook(req: Request, env: Env): Promise<Response> {
  requireConfigured(env);
  if (!env.PAYPAL_WEBHOOK_ID) return json({ error: "Webhook not configured" }, 503);
  const raw = await req.text();
  if (raw.length > 200_000) return json({ error: "Too large" }, 413);
  let event: { event_type: string; resource: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const h = (k: string) => req.headers.get(k) || "";
  const verify = await pp<{ verification_status: string }>(env, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    },
  });
  if (verify.verification_status !== "SUCCESS") return json({ error: "Invalid signature" }, 400);

  const t = event.event_type;
  const r = event.resource as {
    id?: string;
    billing_agreement_id?: string;
    create_time?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
  const orderId = r.supplementary_data?.related_ids?.order_id;
  if (t.startsWith("BILLING.SUBSCRIPTION.") && r.id) {
    await syncSubscription(env, r.id);
  } else if (t === "PAYMENT.SALE.COMPLETED" && r.billing_agreement_id) {
    // A recurring charge succeeded: access runs to at least one month after the charge.
    // "At least" makes activation + first sale (and webhook retries) idempotent.
    const row = await env.DB.prepare("SELECT user_id, plan, status FROM payments WHERE provider = paypal AND provider_ref = ?1")
      .bind(r.billing_agreement_id)
      .first<{ user_id: string; plan: string; status: string }>();
    if (row?.status === "created") await syncSubscription(env, r.billing_agreement_id);
    else if (row?.status === "active") {
      const saleAt = Date.parse(r.create_time || "") || Date.now();
      await setPlanUntilAtLeast(env, row.user_id, row.plan === "pro" ? "pro" : "plus", saleAt + MONTH_MS, "paypal_sub");
    }
  } else if ((t === "PAYMENT.SALE.REFUNDED" || t === "PAYMENT.SALE.REVERSED") && r.billing_agreement_id) {
    await revokePayment(env, "paypal", r.billing_agreement_id);
  } else if (t === "PAYMENT.CAPTURE.COMPLETED" && orderId) {
    // One-time order captured (covers buyers who closed the tab before returning)
    await fulfilPayment(env, "paypal", orderId);
  } else if ((t === "PAYMENT.CAPTURE.REFUNDED" || t === "PAYMENT.CAPTURE.REVERSED") && orderId) {
    await revokePayment(env, "paypal", orderId);
  }
  return json({ ok: true });
}
