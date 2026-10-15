// "Sign in with Google": OAuth 2.0 authorization-code flow, done server-side.
import type { Env } from "../env.ts";
import { HttpError, cookie, isSecure, parseCookies, randomToken, redirect } from "../lib/http.ts";
import { createSession, safeNext, upsertUser } from "./session.ts";

const STATE_COOKIE = "cr_oauth";

function callbackUrl(req: Request): string {
  return `${new URL(req.url).origin}/api/auth/google/callback`;
}

export async function googleStart(req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect("/login?error=google_not_configured");
  const state = randomToken(24);
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  await env.KV.put(`oauth:${state}`, next, { expirationTtl: 600 });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, {
    "set-cookie": cookie(STATE_COOKIE, state, { maxAge: 600, secure: isSecure(req) }),
  });
}

export interface IdTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  exp: number;
}

export function decodeJwtPayload<T>(jwt: string): T {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("Bad token");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Validate claims of an ID token received directly from Google's token endpoint over TLS (OIDC Core 3.1.3.7). */
export function validateClaims(c: IdTokenClaims, clientId: string, now = Date.now()): void {
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new HttpError(401, "Invalid token issuer.");
  if (c.aud !== clientId) throw new HttpError(401, "Invalid token audience.");
  if (!c.exp || c.exp * 1000 < now) throw new HttpError(401, "Token expired.");
  if (!c.email || c.email_verified !== true) throw new HttpError(401, "Your Google email isn't verified.");
}

export async function googleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const clear = cookie(STATE_COOKIE, "", { maxAge: 0, secure: isSecure(req) });
  const fail = (code: string) => redirect(`/login?error=${code}`, { "set-cookie": clear });
  if (url.searchParams.get("error")) return fail("google_cancelled");
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail("google_not_configured");
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const cookieState = parseCookies(req)[STATE_COOKIE];
  if (!state || !code || state !== cookieState) return fail("google_state");
  const next = await env.KV.get(`oauth:${state}`);
  if (next === null) return fail("google_state");
  await env.KV.delete(`oauth:${state}`);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(req),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("google_exchange");
  const tok = (await tokenRes.json()) as { id_token?: string };
  if (!tok.id_token) return fail("google_exchange");

  let claims: IdTokenClaims;
  try {
    claims = decodeJwtPayload<IdTokenClaims>(tok.id_token);
    validateClaims(claims, env.GOOGLE_CLIENT_ID);
  } catch {
    return fail("google_token");
  }
  const user = await upsertUser(env, { email: claims.email!, name: claims.name, avatar: claims.picture, googleSub: claims.sub });
  const session = await createSession(env, req, user.id);
  const headers = new Headers({ location: safeNext(next) });
  headers.append("set-cookie", session);
  headers.append("set-cookie", clear);
  return new Response(null, { status: 302, headers });
}
