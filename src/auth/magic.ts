// Email magic-link sign-in. Tokens are single-use, valid 15 minutes, stored hashed.
import { emailLayout, sendEmail } from "../email.ts";
import type { Env } from "../env.ts";
import { HttpError, body, clientIp, json, rateLimit, randomToken, redirect, sha256Hex } from "../lib/http.ts";
import { createSession, safeNext, upsertUser } from "./session.ts";

const TOKEN_TTL = 15 * 60_000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function emailStart(req: Request, env: Env): Promise<Response> {
  const b = await body<{ email?: string; next?: string }>(req);
  const email = (b.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "Enter a valid email address.");
  const limited = (await rateLimit(env, `magic-ip:${clientIp(req)}`, 10)) || (await rateLimit(env, `magic-email:${email}`, 5));
  if (limited) return limited;

  const token = randomToken(32);
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, next, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), email, safeNext(b.next), Date.now() + TOKEN_TTL)
    .run();
  const link = `${new URL(req.url).origin}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
  const sent = await sendEmail(env, {
    to: email,
    subject: "Your CiteSeen sign-in link",
    text: `Sign in to CiteSeen: ${link}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    html: emailLayout(
      "Sign in to CiteSeen",
      "Click the button to sign in. The link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.",
      { label: "Sign in", url: link },
    ),
  });
  const host = new URL(req.url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  // Local development without an email key: hand the link back so sign-in can be tested.
  return json({ ok: true, sent, ...(isLocal && !sent ? { devLink: link } : {}) });
}

export async function emailVerify(req: Request, env: Env): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token || token.length > 100) return redirect("/login?error=link_invalid");
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used = 1 WHERE token_hash = ?1 AND used = 0 AND expires_at > ?2 RETURNING email, next",
  )
    .bind(hash, Date.now())
    .first<{ email: string; next: string }>();
  if (!row) return redirect("/login?error=link_expired");
  const user = await upsertUser(env, { email: row.email });
  const session = await createSession(env, req, user.id);
  return redirect(safeNext(row.next), { "set-cookie": session });
}
