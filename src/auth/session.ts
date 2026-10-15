// Cookie sessions backed by D1. The cookie holds a random token; D1 stores only its SHA-256 hash.
import type { Env } from "../env.ts";
import { HttpError, cookie, isSecure, newId, parseCookies, randomToken, sha256Hex } from "../lib/http.ts";

export const SESSION_COOKIE = "cr_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  google_sub: string | null;
  plan: string;
  plan_until: number | null;
  plan_source: string;
  launch_price: number;
  report_credits: number;
  brand_name: string;
  brand_color: string;
  brand_logo: string;
  brand_footer: string;
  created_at: number;
}

export async function upsertUser(env: Env, u: { email: string; name?: string; avatar?: string; googleSub?: string }): Promise<User> {
  const email = u.email.trim().toLowerCase();
  const row = await env.DB.prepare(
    `INSERT INTO users (id, email, name, avatar, google_sub, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(email) DO UPDATE SET
       name = CASE WHEN users.name = '' THEN excluded.name ELSE users.name END,
       avatar = CASE WHEN excluded.avatar <> '' THEN excluded.avatar ELSE users.avatar END,
       google_sub = COALESCE(users.google_sub, excluded.google_sub)
     RETURNING *`,
  )
    .bind(newId(16), email, (u.name || "").slice(0, 120), (u.avatar || "").slice(0, 500), u.googleSub ?? null, Date.now())
    .first<User>();
  if (!row) throw new Error("Could not create user");
  return row;
}

/** Create a session and return the Set-Cookie header value. */
export async function createSession(env: Env, req: Request, userId: string): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), userId, now + SESSION_DAYS * 86_400_000, now)
    .run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86_400, secure: isSecure(req) });
}

export async function getUser(req: Request, env: Env): Promise<User | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.expires_at > ?2`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<User>();
  return row ?? null;
}

export async function requireUser(req: Request, env: Env): Promise<User> {
  const u = await getUser(req, env);
  if (!u) throw new HttpError(401, "Please sign in.");
  return u;
}

export async function destroySession(req: Request, env: Env): Promise<string> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await sha256Hex(token)).run();
  return cookie(SESSION_COOKIE, "", { maxAge: 0, secure: isSecure(req) });
}

/**
 * Only allow same-site relative redirects after login. Rejects backslashes, whitespace and control
 * characters (browsers strip tabs/newlines, turning "/\t/evil.com" into "//evil.com"), then
 * confirms the URL still resolves to our own origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 300 || !next.startsWith("/")) return "/app";
  for (const ch of next) {
    if (ch.charCodeAt(0) <= 0x20 || ch === "\\" || ch.charCodeAt(0) === 0x7f) return "/app";
  }
  try {
    const u = new URL(next, "https://self.invalid");
    if (u.origin !== "https://self.invalid") return "/app";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/app";
  }
}
