// Transactional email through Resend. Without RESEND_API_KEY, emails are logged instead of sent.
import type { Env } from "./env.ts";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, msg: Email): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email not sent: RESEND_API_KEY missing] to=${msg.to} subject=${msg.subject}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text().catch(() => ""));
  return res.ok;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, client-safe HTML email layout. */
export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#1E293B">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #E2E8F0;border-radius:14px">
<tr><td style="padding:28px 32px">
<div style="font-weight:700;font-size:18px;color:#2563EB;margin-bottom:18px">CiteSeen</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#334155">${bodyHtml}</div>
${cta ? `<p style="margin:24px 0 8px"><a href="${esc(cta.url)}" style="background:#2563EB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:700;display:inline-block">${esc(cta.label)}</a></p>` : ""}
</td></tr></table>
<p style="font-size:12px;color:#64748B;margin-top:16px">You're receiving this because you use CiteSeen.</p>
</td></tr></table></body></html>`;
}

export { esc as escapeEmail };
