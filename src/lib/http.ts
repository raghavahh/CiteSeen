// Small HTTP helpers shared by every route.
import type { Env } from "../env.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...extra };
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders(extra) });
}

export function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location, ...headers } });
}

export async function readJson<T>(req: Request, maxBytes = 20_000): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function body<T>(req: Request, maxBytes?: number): Promise<T> {
  const b = await readJson<T>(req, maxBytes);
  if (!b || typeof b !== "object") throw new HttpError(400, "Invalid request body.");
  return b;
}

/** Reject cross-site state-changing requests (CSRF). Same-origin fetches always send Origin on POST. */
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const self = new URL(req.url).origin;
  if (origin && origin !== self) throw new HttpError(403, "Cross-site request blocked.");
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAge?: number; secure?: boolean; httpOnly?: boolean } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure !== false) parts.push("Secure");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

export function isSecure(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newId(len = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Fixed-window rate limit in KV. Returns a 429 response when exceeded. */
export async function rateLimit(env: Env, key: string, perHour: number): Promise<Response | null> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const k = `rl:${key}:${hour}`;
  const n = Number((await env.KV.get(k)) || 0);
  if (n >= perHour) {
    return json({ error: `You've hit the limit of ${perHour} per hour. Please try again a bit later.` }, 429, { "retry-after": "600" });
  }
  await env.KV.put(k, String(n + 1), { expirationTtl: 3700 });
  return null;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || "local";
}

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}
