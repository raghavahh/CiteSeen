// Apply a confirmed payment exactly once, atomically: the grant and the "paid" marker run in one
// D1 batch (a transaction), and every statement is guarded by status = 'created'.
import type { Env } from "../env.ts";

export type Kind = "report" | "plus_month" | "pro_month" | "subscription";
export const MONTH_MS = 31 * 86_400_000;

const OWNER = (kind: string) => `SELECT user_id FROM payments WHERE provider = ?1 AND provider_ref = ?2 AND status = 'created' AND kind = '${kind}'`;

/** Mark a created payment as paid and grant what it bought. Returns false if it was already applied. */
export async function fulfilPayment(env: Env, provider: string, providerRef: string): Promise<boolean> {
  const now = Date.now();
  const planUpdate = (kind: "plus_month" | "pro_month", plan: "plus" | "pro") =>
    env.DB.prepare(
      `UPDATE users SET plan = '${plan}', plan_source = ?1,
         plan_until = (CASE WHEN plan = '${plan}' AND plan_until > ?3 THEN plan_until ELSE ?3 END) + ?4
       WHERE id IN (${OWNER(kind)})`,
    ).bind(provider, providerRef, now, MONTH_MS);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET report_credits = report_credits + 1 WHERE id IN (${OWNER("report")})`).bind(provider, providerRef),
    planUpdate("plus_month", "plus"),
    planUpdate("pro_month", "pro"),
    env.DB.prepare("UPDATE payments SET status = 'paid', updated_at = ?3 WHERE provider = ?1 AND provider_ref = ?2 AND status = 'created' RETURNING id").bind(
      provider,
      providerRef,
      now,
    ),
  ]);
  return (results[3].results?.length ?? 0) > 0;
}

/**
 * Keep a subscription's access running until at least `until`. Using "at least" (not "+1 month")
 * makes activation and the first sale webhook idempotent: both target the same end date.
 */
export async function setPlanUntilAtLeast(env: Env, userId: string, plan: "plus" | "pro", until: number, source: string, launch = false): Promise<void> {
  await env.DB.prepare(
    `UPDATE users SET plan = ?1, plan_source = ?2,
       plan_until = CASE WHEN plan = ?1 AND plan_until > ?3 THEN plan_until ELSE ?3 END,
       launch_price = CASE WHEN ?4 = 1 THEN 1 ELSE launch_price END
     WHERE id = ?5`,
  )
    .bind(plan, source, until, launch ? 1 : 0, userId)
    .run();
}

/** Undo a refunded or charged-back payment. */
export async function revokePayment(env: Env, provider: string, providerRef: string): Promise<void> {
  const row = await env.DB.prepare(
    "UPDATE payments SET status = 'refunded', updated_at = ?3 WHERE provider = ?1 AND provider_ref = ?2 AND status IN ('paid', 'active') RETURNING user_id, kind",
  )
    .bind(provider, providerRef, Date.now())
    .first<{ user_id: string; kind: Kind }>();
  if (!row?.user_id) return;
  if (row.kind === "report") {
    await env.DB.prepare("UPDATE users SET report_credits = MAX(0, report_credits - 1) WHERE id = ?1").bind(row.user_id).run();
  } else {
    await env.DB.prepare("UPDATE users SET plan_until = MIN(COALESCE(plan_until, ?1), ?1) WHERE id = ?2").bind(Date.now(), row.user_id).run();
  }
}
