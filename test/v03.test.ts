import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeAnswer, brandAliases, extractSources, listedNames } from "../src/ai/analyze.ts";
import { pluralize, runPrompt, suggestPrompts, RUNS_PER_PROMPT } from "../src/ai/checks.ts";
import { LADDERS, MODEL_RPM } from "../src/ai/models.ts";
import { ProviderError, cleanAnswer, type AiProvider } from "../src/ai/provider.ts";
import { BusyError, rankModels, routedChat } from "../src/ai/router.ts";
import { diffAudits } from "../src/app/siteAudit.ts";
import type { AuditResult } from "../src/audit/types.ts";
import { decodeJwtPayload, validateClaims } from "../src/auth/google.ts";
import { safeNext } from "../src/auth/session.ts";
import { checkoutSignatureValid } from "../src/billing/razorpay.ts";
import type { Env } from "../src/env.ts";
import { PLANS, isDowngrade, planOf } from "../src/plans.ts";
import { isPrivateIp } from "../src/audit/fetcher.ts";

function memEnv(): Env {
  const m = new Map<string, string>();
  const KV = {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  } as unknown as KVNamespace;
  return { KV, NVIDIA_API_KEY: "test" } as unknown as Env;
}

describe("answer analysis", () => {
  const answer = `Here are some great options:
1. **Bright Smiles Dental** – known for implants
2. **Acme Dental** – friendly staff, see acmedental.in
3. Pearl Clinic: affordable

Source: https://www.practo.com/pune/dentists`;

  it("finds the brand and its list position", () => {
    const f = analyzeAnswer(answer, { name: "Acme Dental", host: "acmedental.in" });
    expect(f.mentioned).toBe(true);
    expect(f.position).toBe(2);
    expect(f.competitors).toEqual(["Bright Smiles Dental", "Pearl Clinic"]);
    expect(f.sources).toContain("practo.com");
  });
  it("does not match the brand inside other words", () => {
    expect(analyzeAnswer("We recommend Acmeville Clinic.", { name: "Acme", host: "acme.com" }).mentioned).toBe(false);
  });
  it("reports not mentioned with null position", () => {
    const f = analyzeAnswer(answer, { name: "Zeta Dental", host: "zetadental.com" });
    expect(f).toMatchObject({ mentioned: false, position: null });
  });
  it("builds aliases from name and domain", () => {
    expect(brandAliases("Acme Dental", "www.acmedental.in")).toEqual(["acmedental.in", "acmedental", "acme dental"]);
  });
  it("parses list items and skips labels", () => {
    expect(listedNames("1. Foo Ltd - x\n- Pros: fast\n* **Bar Co**: y")).toEqual(["Foo Ltd", "Bar Co"]);
    expect(extractSources("see example.org and https://docs.foo.io/x")).toEqual(["docs.foo.io", "example.org"]);
  });
  it("strips reasoning traces", () => {
    expect(cleanAnswer("<think>hmm</think>\nAnswer")).toBe("Answer");
  });
});

describe("prompts and aggregation", () => {
  it("pluralizes categories", () => {
    expect(pluralize("dental clinic")).toBe("dental clinics");
    expect(pluralize("agency")).toBe("agencies");
    expect(pluralize("coach")).toBe("coaches");
    expect(pluralize("tools")).toBe("tools");
    expect(suggestPrompts({ name: "Acme", host: "acme.in", category: "dental clinic", location: "Pune" })[0]).toBe("What are the best dental clinics in Pune?");
  });
  it("runs each prompt 3 times and averages", async () => {
    let n = 0;
    const answers = ["1. Acme Dental\n2. Other Co", "1. Other Co\n2. Acme Dental", "Nothing relevant."];
    const r = await runPrompt(async () => ({ text: answers[n++], model: "m1" }), "best dentist?", { name: "Acme Dental", host: "acmedental.in" }, []);
    expect(r.runs).toBe(RUNS_PER_PROMPT);
    expect(r.mentioned).toBe(2);
    expect(r.avgPosition).toBe(1.5);
    expect(r.competitors).toEqual([{ name: "Other Co", count: 2 }]);
  });
  it("keeps partial results when some runs fail", async () => {
    let n = 0;
    const r = await runPrompt(async () => { if (n++ === 0) throw new Error("x"); return { text: "Acme Dental is good", model: "m" }; }, "q", { name: "Acme Dental", host: "a.in" }, []);
    expect(r.runs).toBe(2);
  });
});

describe("model routing", () => {
  const counter = (loads: Record<string, number>) => ({
    get: async (k: string) => loads[k.split(":")[2]] ?? 0,
    incr: async () => {},
  });
  it("prefers the best model with capacity", async () => {
    expect((await rankModels(counter({}), "top"))[0]).toBe(LADDERS.top[0]);
  });
  it("steps down when the top model is busy", async () => {
    const r = await rankModels(counter({ [LADDERS.top[0]]: MODEL_RPM.top }), "top");
    expect(r[0]).toBe(LADDERS.top[1]);
  });
  it("Pro never routes to small-only models", () => {
    expect(LADDERS.top.some((m) => LADDERS.small.includes(m) && !LADDERS.mid.includes(m))).toBe(false);
  });
  it("falls back to the next model when one fails, and parks the failing model", async () => {
    const env = memEnv();
    const calls: string[] = [];
    const provider: AiProvider = {
      id: "fake",
      liveSearch: false,
      async chat(model) {
        calls.push(model);
        if (calls.length === 1) throw new ProviderError("down", 503, true);
        return { text: "ok", model, ms: 1 };
      },
    };
    const r = await routedChat(env, provider, "mid", "s", "u");
    expect(calls).toEqual([LADDERS.mid[0], LADDERS.mid[1]]);
    expect(r.model).toBe(LADDERS.mid[1]);
    expect(JSON.parse((await env.KV.get("ai:cooldown"))!)).toContain(LADDERS.mid[0]);
  });
  it("refuses when the account-wide limit is reached", async () => {
    const env = memEnv();
    const busy = { get: async (k: string) => (k.includes(":all:") ? 999 : 0), incr: async () => {} };
    await expect(routedChat(env, {} as AiProvider, "small", "s", "u", busy)).rejects.toBeInstanceOf(BusyError);
  });
  it("does not retry non-retryable errors", async () => {
    const env = memEnv();
    let n = 0;
    const provider: AiProvider = { id: "f", liveSearch: false, chat: async () => { n++; throw new ProviderError("bad key", 401, false); } };
    await expect(routedChat(env, provider, "small", "s", "u")).rejects.toThrow("bad key");
    expect(n).toBe(1);
  });
});

describe("alerts", () => {
  const mk = (score: number, statuses: Record<string, string>) =>
    ({ score, checks: Object.entries(statuses).map(([id, status]) => ({ id, status, points: 4, title: id, summary: "s" })) }) as unknown as AuditResult;
  it("flags score drops and newly failing checks", () => {
    const a = diffAudits(mk(80, { x: "pass", y: "pass" }), mk(70, { x: "fail", y: "pass" }));
    expect(a.map((x) => x.kind)).toEqual(["score_drop", "new_failure"]);
  });
  it("is quiet for small changes and first audits", () => {
    expect(diffAudits(mk(80, { x: "pass" }), mk(78, { x: "pass" }))).toEqual([]);
    expect(diffAudits(null, mk(10, {}))).toEqual([]);
  });
});

describe("auth safety", () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims = { iss: "https://accounts.google.com", aud: "cid", sub: "1", email: "a@b.co", email_verified: true, exp: Math.floor(Date.now() / 1000) + 60 };
  it("decodes and validates Google ID token claims", () => {
    const c = decodeJwtPayload<typeof claims>(`x.${b64(claims)}.y`);
    expect(() => validateClaims(c, "cid")).not.toThrow();
    expect(() => validateClaims({ ...c, aud: "other" }, "cid")).toThrow();
    expect(() => validateClaims({ ...c, email_verified: false }, "cid")).toThrow();
    expect(() => validateClaims({ ...c, iss: "https://evil.com" }, "cid")).toThrow();
    expect(() => validateClaims({ ...c, exp: 1 }, "cid")).toThrow();
  });
  it("only allows same-site relative redirects", () => {
    expect(safeNext("/app/billing")).toBe("/app/billing");
    expect(safeNext("//evil.com")).toBe("/app");
    expect(safeNext("https://evil.com")).toBe("/app");
    expect(safeNext("/\\evil.com")).toBe("/app");
    expect(safeNext("/\t/evil.com")).toBe("/app");
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com"); // stays a same-origin path once encoded
    expect(safeNext("/app?add=https://x.com")).toBe("/app?add=https://x.com");
    expect(safeNext(null)).toBe("/app");
  });
  it("blocks private IPv6 forms that embed IPv4", () => {
    for (const h of ["[::ffff:7f00:1]", "[::ffff:127.0.0.1]", "[::127.0.0.1]", "[64:ff9b::a00:1]", "[2002:c0a8:101::]", "[fe90::1]", "[fd00::1]", "[::1]"]) {
      expect(isPrivateIp(h), h).toBe(true);
    }
    expect(isPrivateIp("[2606:4700::1111]")).toBe(false);
  });
  it("blocks buying a lower plan over an active higher one", () => {
    const pro = { plan: "pro", plan_until: Date.now() + 1e6 };
    expect(isDowngrade(pro, "plus")).toBe(true);
    expect(isDowngrade(pro, "pro")).toBe(false);
    expect(isDowngrade({ plan: "pro", plan_until: Date.now() - 1 }, "plus")).toBe(false);
  });
});

describe("billing", () => {
  it("verifies Razorpay checkout signatures", async () => {
    const sig = createHmac("sha256", "secret").update("order_1|pay_1").digest("hex");
    expect(await checkoutSignatureValid("secret", "order_1", "pay_1", sig)).toBe(true);
    expect(await checkoutSignatureValid("secret", "order_1", "pay_2", sig)).toBe(false);
  });
  it("drops expired paid plans back to Free", () => {
    expect(planOf({ plan: "pro", plan_until: Date.now() + 1000 }).id).toBe("pro");
    expect(planOf({ plan: "pro", plan_until: Date.now() - 1000 }).id).toBe("free");
    expect(planOf({ plan: "bogus", plan_until: null })).toBe(PLANS.free);
  });
});
