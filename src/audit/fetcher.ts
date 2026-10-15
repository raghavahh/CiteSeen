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

/** Expand an IPv6 literal (optionally with a trailing dotted IPv4) into 8 numeric groups. */
export function expandIpv6(ip: string): number[] | null {
  let s = ip.split("%")[0];
  const dotted = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const p = dotted.slice(1).map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[0].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return null;
  return parts.map((x) => parseInt(x, 16));
}

export function isPrivateIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h.includes(":")) {
    const g = expandIpv6(h);
    if (!g) return true; // unparseable: refuse
    if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: and ::1
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // Embedded IPv4: ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::/96 (NAT64), 2002::/16 (6to4)
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIp(v4(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIp(v4(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateIp(v4(g[1], g[2]));
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
      let to: string;
      try {
        to = new URL(res.headers.get("location")!, u).toString();
      } catch {
        return fail(`Invalid redirect from ${u.hostname}`, res.status);
      }
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
