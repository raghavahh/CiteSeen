# CiteReady

Fix-first AI search audits for small agencies. Paste a URL and get a 0–100 score in about 10 seconds, with evidence for every point and a copy-paste fix for every problem. See [CiteReady PRD.md](CiteReady%20PRD.md) for the product plan.

This repo is **v0.1 (week 1)**: the free audit, a shareable result link, early-access signup, four free SEO tools, and a site that scores 95/100 on its own audit (100 once real social profiles are added to `sameAs`).

## Run it

```bash
npm install
npm run dev          # builds, then serves http://localhost:8787 (local KV is simulated)
npm test             # 23 engine tests, including our own site's score
npm run typecheck
npm run audit -- example.com   # audit any site from the terminal
```

## Deploy (Cloudflare Pages, free tier)

Live at **https://citeready-app.pages.dev** (Pages project `citeready-app`, KV namespace `CITEREADY_KV`).

```bash
npx wrangler login     # once
npm run deploy         # builds dist/ (static files + _worker.js) and deploys to Pages
```

`npm run build` copies `public/` to `dist/` and bundles `src/index.ts` into `dist/_worker.js`, which Pages runs for every request. To use your own domain later: Cloudflare dashboard → Workers & Pages → citeready-app → Custom domains.

## Before launch: things only you can do

| What | Where |
| --- | --- |
| Own domain (optional). Links currently use `citeready-app.pages.dev` | all files in `public/`, `src/audit/bots.ts` (`CITEREADY_UA`), `wrangler.toml` |
| Contact email. `hello@citeready.app` is a placeholder | `public/contact.html`, `privacy.html`, `terms.html`, `refunds.html`, `llms.txt` |
| Social profile URLs in `sameAs` (worth the last 5 points) | `public/index.html` Organization JSON-LD |
| Have the privacy, terms and refund pages reviewed | `public/privacy.html`, `terms.html`, `refunds.html` |
| Submit to Bing Webmaster Tools and Google Search Console | after deploy |

Read early-access signups with `npx wrangler kv key list --binding KV --prefix waitlist: --remote`.

## How it's built

```
src/
  index.ts            Worker: /api/audit, /api/audit/:id, /api/waitlist, /api/tools/*, /api/bots, /r/:id
  audit/
    bots.ts           The AI-bot list (single data file; review monthly)
    fetcher.ts        Safe fetch: public http(s) only, private IPs blocked, size/time/redirect caps
    robots.ts         RFC 9309 robots.txt parser and matcher
    html.ts           Dependency-free HTML extraction + platform/CDN fingerprinting
    siteinfo.ts       Site name, logo, social links, page type → used to pre-fill fixes
    checks.ts         The 18 checks (16 scored, weights total 100) and fix generators
    run.ts            Orchestration: page + robots + sitemap + llms.txt + 4 bot fetches in parallel
  api/tools.ts        Crawler checker, robots loader, llms.txt generator/validator, raw view
public/               Landing, report shell, 4 tool pages, legal pages, robots/sitemap/llms.txt
test/engine.test.ts   Vitest suite with a mocked network
```

**Storage (KV):** `audit:<id>` holds results (30-day TTL). `cache:<hash>` returns the same result for a URL re-audited within 10 minutes. `waitlist:<email>` holds signups. `rl:*` holds per-IP hourly rate limits (30 audits, 60 tool runs). `stats:audits` and `stats:waitlist` are counters.

**Per audit:** about 8 subrequests (page, robots, sitemap, llms.txt and 4 AI-bot fetches), well within the free plan's 50.

## Next (v0.2, weeks 3–4)

Magic-link login (D1 for users, sites and history), saved client sites, white-label PDF (branded print layout), weekly cron re-audits with email alerts, and PayPal plus Razorpay checkout.
