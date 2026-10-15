// Razorpay (INR): one-time payments for report credits and monthly plan packs.
// One-time packs avoid India's recurring-mandate rules (PRD "Pricing & payments").
import type { User } from "../auth/session.ts";
import type { Env } from "../env.ts";
import { HttpError, body, hmacHex, json, newId, rateLimit, safeEqual } from "../lib/http.ts";
import { PLANS, REPORT_PRICE, isDowngrade } from "../plans.ts";
import { fulfilPayment, revokePayment, type Kind } from "./fulfil.ts";

const PRICES_INR: Record<"report" | "plus_month" | "pro_month", number> = {
  report: REPORT_PRICE.inr,
  plus_month: PLANS.plus.priceInr,
  pro_month: PLANS.pro.priceInr,
};

function requireConfigured(env: Env): void {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new HttpError(503, "Razorpay checkout is coming soon.");
}

export async function razorpayOrder(req: Request, env: Env, user: User): Promise<Response> {
  requireConfigured(env);
  const limited = await rateLimit(env, `rz-order:${user.id}`, 10);
  if (limited) return limited;
  const b = await body<{ kind?: string }>(req);
  const kind = (["report", "plus_month", "pro_month"].includes(b.kind || "") ? b.kind : "report") as keyof typeof PRICES_INR;
  if (kind !== "report" && isDowngrade(user, kind === "pro_month" ? "pro" : "plus")) throw new HttpError(400, "You already have a higher plan. Manage it from your billing page.");
  const amount = PRICES_INR[kind] * 100;
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`, "content-type": "application/json" },
    body: JSON.stringify({ amount, currency: "INR", receipt: newId(16), notes: { user_id: user.id, kind } }),
  });
  if (!res.ok) {
    console.error("Razorpay order error", res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "Couldn't start Razorpay checkout. Please try again.");
  }
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO payments (id, user_id, provider, provider_ref, kind, plan, amount, currency, status, created_at, updated_at) VALUES (?1, ?2, 'razorpay', ?3, ?4, ?5, ?6, 'INR', 'created', ?7, ?7)",
  )
    .bind(newId(12), user.id, order.id, kind, kind === "report" ? "" : kind.replace("_month", ""), amount, now)
    .run();
  return json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID, name: user.name, email: user.email });
}

/** Razorpay checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function checkoutSignatureValid(secret: string, orderId: string, paymentId: string, signature: string): Promise<boolean> {
  return safeEqual(await hmacHex(secret, `${orderId}|${paymentId}`), signature);
}

export async function razorpayVerify(req: Request, env: Env, user: User): Promise<Response> {
  requireConfigured(env);
  const b = await body<{ razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }>(req);
  const orderId = b.razorpay_order_id || "";
  const paymentId = b.razorpay_payment_id || "";
  const sig = b.razorpay_signature || "";
  if (!orderId || !paymentId || !/^[a-f0-9]{64}$/.test(sig)) throw new HttpError(400, "Invalid payment details.");
  if (!(await checkoutSignatureValid(env.RAZORPAY_KEY_SECRET!, orderId, paymentId, sig))) throw new HttpError(400, "Payment signature didn't match.");
  const row = await env.DB.prepare("SELECT user_id, kind FROM payments WHERE provider = 'razorpay' AND provider_ref = ?1")
    .bind(orderId)
    .first<{ user_id: string; kind: Kind }>();
  if (!row || row.user_id !== user.id) throw new HttpError(404, "Order not found.");
  await fulfilPayment(env, "razorpay", orderId);
  return json({ ok: true, kind: row.kind });
}

/** Webhook backup for payments where the browser closed before verification. */
export async function razorpayWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: "Webhook not configured" }, 503);
  const raw = await req.text();
  if (raw.length > 200_000) return json({ error: "Too large" }, 413);
  const sig = req.headers.get("x-razorpay-signature") || "";
  if (!safeEqual(await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw), sig)) return json({ error: "Invalid signature" }, 400);
  let event: { event: string; payload?: { payment?: { entity?: { order_id?: string } } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const orderId = event.payload?.payment?.entity?.order_id;
  if ((event.event === "payment.captured" || event.event === "order.paid") && orderId) {
    await fulfilPayment(env, "razorpay", orderId);
  } else if ((event.event === "refund.processed" || event.event === "payment.dispute.lost") && orderId) {
    await revokePayment(env, "razorpay", orderId);
  }
  return json({ ok: true });
}
