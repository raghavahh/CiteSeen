# CiteSeen

Fix-first AI search audits and AI visibility tracking for small agencies. Live at **https://citeseen.pages.dev**.

- **v0.1 (free audit):** paste a URL, get a 0–100 Readiness score with evidence and a copy-paste fix for every problem. Includes shareable reports and 4 free tools.
- **v0.2 (agency plan):** Google and email sign-in, saved client sites with history, white-label PDF reports, weekly re-audits with email alerts, PayPal and Razorpay checkout.
- **v0.3 (AI Visibility):** asks AI models the questions customers ask (3 runs each) and measures whether the brand is named, with competitors and sources. Load-aware model routing by plan tier.

Product plan: [CiteSeen PRD.md](CiteSeen%20PRD.md) · Build plan: [docs/PLAN-v0.2-v0.3.md](docs/PLAN-v0.2-v0.3.md) · Design system: [design-system/citeseen/MASTER.md](design-system/citeseen/MASTER.md)

## Run it

```bash
npm install
npm run dev        # build, apply local D1 migrations, serve http://localhost:8787
npm test           # 46 tests: engine, own-site score, AI routing, auth, billing
npm run typecheck
npm run audit -- example.com
```

Locally, without RESEND_API_KEY, the email sign-in form signs you in directly through a dev link (localhost only).

## Deploy

```bash
npm run db:migrate     # apply D1 migrations to production (once per new migration)
npm run deploy         # Pages site + API (dist/ with _worker.js)
npm run deploy:cron    # citeseen-cron Worker: hourly, re-audits Plus/Pro sites weekly
```

## Secrets (set them yourself; they never go in the repo)

Each feature turns on when its secret exists and shows "coming soon" until then.

```bash
npx wrangler pages secret put NVIDIA_API_KEY --project-name citeseen
```

| Secret | Turns on | Get it from |
| --- | --- | --- |
| `NVIDIA_API_KEY` | AI Visibility checks | build.nvidia.com |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google | Google Cloud Console → Credentials → OAuth client (Web). Redirect URI: `https://citeseen.pages.dev/api/auth/google/callback` |
| `RESEND_API_KEY` | Magic-link and alert emails | resend.com. Also set it on the cron Worker: `npx wrangler secret put RESEND_API_KEY --config cron/wrangler.toml` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_PLUS`, `PAYPAL_PLAN_PLUS_LAUNCH`, `PAYPAL_PLAN_PRO` | PayPal subscriptions and $9 reports | developer.paypal.com (sandbox app, then billing plans). Webhook URL: `/api/billing/paypal/webhook` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay INR payments | Razorpay dashboard (test mode). Webhook URL: `/api/billing/razorpay/webhook` |

PayPal runs in sandbox until you set `PAYPAL_ENV=live`.

## Plans

| | Free | Plus | Pro |
| --- | --- | --- | --- |
| Price | $0 | $29/mo (₹799), launch $19 for life for the first 20 | $79/mo (₹2,499) |
| Saved sites | 1 | 10 | 30 |
| Weekly re-audits + alerts, white-label | – | ✓ | ✓ |
| AI questions/month | 10 | 100 | 500 |
| AI models | small, fast | mid-size | largest |

Limits live in `src/plans.ts`; model ladders in `src/ai/models.ts`.

## How it's built

```
src/index.ts          Router: public audit/tools, auth, dashboard API, billing, /app SPA and /r/<id> pages
src/audit/            Rule-based audit engine (18 checks, fixes generated from site data)
src/auth/             Google OAuth, email magic links, D1 sessions (hashed tokens, HttpOnly cookie)
src/app/              Sites, history, alerts, branding, white-label reports, CSV
src/ai/               NIM provider, load-aware model router, answer analysis, AI checks + quotas
src/billing/          PayPal + Razorpay with verified, idempotent fulfilment
cron/                 citeseen-cron Worker (weekly re-audits + alert emails)
migrations/           D1 schema
public/               Marketing site, tools, report, login, /app dashboard
```

**AI Visibility, honestly:** NIM-hosted open models answer from training data and don't search the web. Results measure how well AI models already know a brand, not live ChatGPT or Perplexity citations, and the UI says so. **NVIDIA's free API access is for prototyping and testing.** Before charging customers for AI checks, buy a NIM licence or add another provider in `src/ai/provider.ts`.

## Before launch: things only you can do

- Set the secrets above, and test PayPal and Razorpay end to end in sandbox mode.
- Replace the `hello@citeseen.app` placeholder email and add your social profile URLs to `sameAs` in `public/index.html`.
- Have the privacy, terms and refund pages reviewed.
- Use your own domain for email sending (Resend needs a verified domain to email anyone besides you).
