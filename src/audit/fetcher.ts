// Safe outbound fetching for audits.
// PRD safety rules: only public http(s) URLs, cap page size and time per request.

export interface FetchResult {
  ok: boolean;
  /** URL that was requested first */
  url: string;
  /** URL after following redirects */
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Each hop: from -> status */
  redirects: { from: string; status: number; to: string }[];
  truncated: boolean;
  ms: number;
  error?: string;
}

export interface FetchOptions {
  userAgent: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
}

export class UnsafeUrlError extends Error {}

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".test", ".invalid", ".onion"];

/** Normalise user input ("example.com", " https://Example.com/ ") into a URL, or throw. */
export function normaliseInputUrl(input: string): URL {
  let s = (input || "").trim();
  if (!s) throw new UnsafeUrlError("Enter a website address.");
  if (s.length > 2048) throw new UnsafeUrlError("That address is too long.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a website address.");
  }
  assertPublicUrl(u);
  u.hash = "";
  return u;
}

/** Throws UnsafeUrlError unless the URL is a public http(s) address on a standard port. */
export function assertPublicUrl(u: URL): void {
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https addresses can be audited.");
  }
  if (u.username || u.password) throw new UnsafeUrlError("Addresses with login details can't be audited.");
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new UnsafeUrlError("Only standard web ports (80 and 443) can be audited.");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("Only public websites can be audited.");
  }
  if (isIpLiteral(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("Only public websites can be audited.");
  } else if (!host.includes(".")) {
    throw new UnsafeUrlError("Enter a full domain name, like example.com.");
  }
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || /^[0-9a-f:]+$/i.test(host) && host.includes(":");
}

export function isPrivateIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h.includes(":")) {
    // IPv6: loopback, unspecified, unique-local, link-local, IPv4-mapped
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
    const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n) || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Fetch a URL with manual redirect handling (every hop is re-validated),
 * a byte cap and a timeout. Never throws for network errors: returns ok=false with `error`.
 */
export async function safeFetch(input: string | URL, opts: FetchOptions): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const started = Date.now();
  const startUrl = typeof input === "string" ? input : input.toString();
  const redirects: FetchResult["redirects"] = [];
  let current = startUrl;

  const fail = (error: string, status = 0): FetchResult => ({
    ok: false,
    url: startUrl,
    finalUrl: current,
    status,
    headers: {},
    body: "",
    redirects,
    truncated: false,
    ms: Date.now() - started,
    error,
  });

  const deadline = started + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u: URL;
    try {
      u = new URL(current);
      assertPublicUrl(u);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Invalid URL");
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail("Timed out");

    let res: Response;
    try {
      res = await fetch(u.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": opts.userAgent,
          Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(remaining),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(/abort|timeout/i.test(msg) ? "Timed out" : "Could not connect: " + msg);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const to = new URL(res.headers.get("location")!, u).toString();
      redirects.push({ from: u.toString(), status: res.status, to });
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      current = to;
      continue;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    const { text, truncated } = await readCapped(res, maxBytes);
    return {
      ok: res.status >= 200 && res.status < 300,
      url: startUrl,
      finalUrl: u.toString(),
      status: res.status,
      headers,
      body: text,
      redirects,
      truncated,
      ms: Date.now() - started,
    };
  }
  return fail("Too many redirects");
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    truncated = true;
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(all), truncated };
}
