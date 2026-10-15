// citeseen-cron: re-audits paid users' saved sites weekly and emails alerts.
// Runs hourly and processes a few due sites per run, keeping each invocation under the
// free plan's 50-subrequest limit (one audit is 10-14 fetches incl. redirects and sitemap fallbacks).
import { auditSite, type Site } from "../src/app/siteAudit.ts";
import type { Env } from "../src/env.ts";

const WEEK_MS = 7 * 86_400_000;
const SITES_PER_RUN = 2; // ~10-14 fetches per audit + alert email, well under 50

export async function dueSites(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT s.*, u.email AS user_email FROM sites s JOIN users u ON u.id = s.user_id
     WHERE s.weekly = 1 AND u.plan IN ('plus', 'pro') AND (u.plan_until IS NULL OR u.plan_until > ?1)
       AND (s.last_audit_at IS NULL OR s.last_audit_at < ?2)
     ORDER BY s.last_audit_at ASC LIMIT ?3`,
  )
    .bind(now, now - WEEK_MS, SITES_PER_RUN)
    .all<Site & { user_email: string }>();
  return results;
}

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    for (const s of await dueSites(env)) {
      try {
        const { result, alerts } = await auditSite(env, s, "weekly", { notify: true, userEmail: s.user_email });
        console.log(`re-audited ${s.host}: ${result.score} (${alerts.length} alerts)`);
      } catch (e) {
        // Mark as attempted so one broken site doesn't block the queue; it's retried next week.
        await env.DB.prepare("UPDATE sites SET last_audit_at = ?1 WHERE id = ?2").bind(Date.now(), s.id).run();
        console.error(`re-audit failed for ${s.host}:`, e instanceof Error ? e.message : e);
      }
    }
  },
} satisfies ExportedHandler<Env>;
