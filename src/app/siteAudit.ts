// Audit a saved site, store history, and raise alerts. Shared by the API and the weekly cron Worker.
import { runAudit } from "../audit/run.ts";
import type { AuditResult } from "../audit/types.ts";
import { emailLayout, escapeEmail, sendEmail } from "../email.ts";
import type { Env } from "../env.ts";
import { newId } from "../lib/http.ts";

export interface Site {
  id: string;
  user_id: string;
  url: string;
  host: string;
  name: string;
  category: string;
  location: string;
  competitors: string;
  weekly: number;
  last_score: number | null;
  last_audit_at: number | null;
  last_ai_score: number | null;
  created_at: number;
}

export const SHARE_TTL = 60 * 60 * 24 * 30;

export interface AlertDraft {
  kind: "score_drop" | "new_failure" | "recovered";
  message: string;
}

/** Compare two audits and describe what changed for the client. */
export function diffAudits(prev: AuditResult | null, next: AuditResult): AlertDraft[] {
  if (!prev) return [];
  const out: AlertDraft[] = [];
  const drop = prev.score - next.score;
  if (drop >= 5) out.push({ kind: "score_drop", message: `Score dropped ${drop} points (${prev.score} → ${next.score}).` });
  if (next.score - prev.score >= 5) out.push({ kind: "recovered", message: `Score rose ${next.score - prev.score} points (${prev.score} → ${next.score}).` });
  const before = new Map(prev.checks.map((c) => [c.id, c.status]));
  for (const c of next.checks) {
    if (c.points === 0) continue;
    const was = before.get(c.id);
    if (was === "pass" && (c.status === "fail" || c.status === "warn")) {
      out.push({ kind: "new_failure", message: `"${c.title}" stopped passing: ${c.summary}` });
    }
  }
  return out;
}

export async function auditSite(
  env: Env,
  site: Site,
  trigger: "manual" | "weekly" | "add",
  opts: { notify?: boolean; userEmail?: string } = {},
): Promise<{ result: AuditResult; alerts: AlertDraft[] }> {
  const prevRow = await env.DB.prepare("SELECT result_json FROM audits WHERE site_id = ?1 ORDER BY created_at DESC LIMIT 1")
    .bind(site.id)
    .first<{ result_json: string }>();
  const prev = prevRow ? (JSON.parse(prevRow.result_json) as AuditResult) : null;

  const result = await runAudit(site.url);
  result.id = newId(10);
  const now = Date.now();
  const payload = JSON.stringify(result);
  const alerts = diffAudits(prev, result);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO audits (id, site_id, user_id, score, trigger, result_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(
      result.id,
      site.id,
      site.user_id,
      result.score,
      trigger,
      payload,
      now,
    ),
    env.DB.prepare("UPDATE sites SET last_score = ?1, last_audit_at = ?2 WHERE id = ?3").bind(result.score, now, site.id),
    ...alerts.map((a) =>
      env.DB.prepare("INSERT INTO alerts (id, user_id, site_id, kind, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(
        newId(12),
        site.user_id,
        site.id,
        a.kind,
        a.message,
        now,
      ),
    ),
  ]);
  // Share link works for site audits too
  await env.KV.put(`audit:${result.id}`, payload, { expirationTtl: SHARE_TTL });

  const important = alerts.filter((a) => a.kind !== "recovered");
  if (opts.notify && opts.userEmail && important.length) {
    const link = `${env.SITE_URL}/app/sites/${site.id}`;
    await sendEmail(env, {
      to: opts.userEmail,
      subject: `${site.host}: AI search score ${result.score}/100 (${important.length} change${important.length > 1 ? "s" : ""})`,
      text: `${site.host} weekly re-audit\n\n${important.map((a) => "- " + a.message).join("\n")}\n\nOpen the report: ${link}`,
      html: emailLayout(
        `${site.host} needs attention`,
        `<p>This week's re-audit found:</p><ul>${important.map((a) => `<li>${escapeEmail(a.message)}</li>`).join("")}</ul>`,
        { label: "Open the report", url: link },
      ),
    });
  }
  return { result, alerts };
}
