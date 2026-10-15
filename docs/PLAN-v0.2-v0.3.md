# CiteReady v0.2 → v0.3 build plan

Status on 15 Oct 2026: v0.1 is live at https://citeready-app.pages.dev (free audit, share links, 4 tools).
This plan takes CiteReady to v0.3: accounts, paid plans, client dashboard, white-label reports, weekly re-audits, AI answer checks, and a premium redesign with motion.

## Architecture

| Part | Choice | Why |
| --- | --- | --- |
| Web app + API | Cloudflare Pages + `_worker.js` (as today) | Already live, free |
| Database | **Cloudflare D1** `citeready-db` | Users, sessions, sites, audits, AI checks, billing |
| Cache, rate limits, model load | KV `CITEREADY_KV` (existing) | Fast counters |
| Weekly re-audits | Separate tiny Worker `citeready-cron` with a Cron Trigger | Pages has no cron; shares D1 + engine code |
| Email (magic link, alerts) | Resend free tier (3,000/month) behind an interface | Falls back to console logging in dev |
| AI answer checks | NVIDIA NIM (OpenAI-compatible API) behind a provider interface | Swap to OpenAI/Perplexity later without code changes |
| Front end | Static marketing pages + `/app` dashboard written in TypeScript, bundled by esbuild | Marketing must stay readable without JS (we sell that) |
| Motion | GSAP + ScrollTrigger from cdnjs, CSS fallbacks | Content visible with JS off; respects reduced motion |

## Plans and limits

| | Free | Plus | Pro |
| --- | --- | --- | --- |
| Price | $0 | $29/mo (₹799) · launch $19 for life | $79/mo |
| Saved client sites | 1 | 10 | 30 |
| Audits | Unlimited one-off | Unlimited | Unlimited |
| Weekly re-audit + alerts | – | ✓ | ✓ |
| White-label PDF | – | ✓ | ✓ |
| AI answer checks / month | 10 prompts | 100 prompts | 500 prompts |
| AI models | Small, fast | Mid | Best available |
| Competitor view, CSV export | – | – | ✓ |

One-off: $9 / ₹249 white-label report credit (never expires).

## AI answer checks (v0.3)

1. For each saved site we propose prompts from its own content: "best {category} in {city}", "{brand} alternatives", "what is {brand}", and the user can edit them.
2. Each prompt runs **3 times** (PRD) and results are averaged. The method is shown on every result.
3. We extract: whether the brand is mentioned, its position, the competitors named, and URLs cited.
4. Visibility = share of runs that mention the brand. History is charted per site.
5. **Honest labelling:** NIM-hosted open models answer from training data and do **not** search the web, so this measures "AI model recall", not live ChatGPT/Perplexity citations. The provider interface lets us add live-search APIs later.

### Model routing by tier and load

- Each tier has a ladder of models (e.g. Pro: largest → large → mid; Plus: mid → small; Free: small → smallest).
- A KV counter tracks requests per model per minute. When a model's load passes its threshold (tuned so roughly every 5–10 concurrent users step down a rung), new requests go to the next model on that tier's ladder. Pro never drops below "mid".
- Model IDs are verified against NIM's live `/v1/models` list at build time, not hard-coded from memory.

## Accounts and security

- Sign in with **Google** (OAuth 2.0 code flow, server-side) or an **email magic link**.
- Session: random token in an HttpOnly, Secure, SameSite=Lax cookie; only a SHA-256 hash is stored in D1. 30-day expiry.
- Every state-changing request checks the Origin header. Per-IP and per-user rate limits.
- Secrets live only in Cloudflare (`wrangler pages secret put`), never in the repo.

## Payments

- **PayPal** subscriptions (USD) for Plus and Pro, plus one-time orders for $9 reports.
- **Razorpay** one-time payments (INR) for reports and monthly packs. This avoids India's recurring-mandate rules, as the PRD recommends.
- Webhooks verify signatures before changing a plan. Everything is built and tested in sandbox mode first.

## Design

- Design system: `design-system/citeready/MASTER.md` (UI/UX Pro Max). Trust blue #2563EB, CTA orange #EA580C, Plus Jakarta Sans, light glass surfaces, standard motion (staggered reveals 300–450 ms).
- Landing page: animated hero showing a live mock audit (score counting up, bots ticking through, fixes sliding in), a marquee of AI engines, bento feature grid, before/after score demo, pricing with monthly/one-off toggle, FAQ.
- Dashboard: sites table with score sparklines, site detail with score history chart, report, AI visibility, white-label settings, billing.
- Rules: content visible without JS, `prefers-reduced-motion` respected, 4.5:1 contrast, visible focus, works at 375 / 768 / 1024 / 1440 px. The site must still score 95–100 on its own audit.

## Build phases

1. **Foundation:** D1 schema and migrations, Google and magic-link auth, sessions, plan limits.
2. **Dashboard:** saved sites, audit history, re-audit, white-label settings and print-ready white-label report.
3. **Cron Worker:** weekly re-audits, score-drop and newly-failing-check email alerts.
4. **AI answer checks:** prompt builder, NIM provider, load-aware model router, quotas, results UI.
5. **Billing:** PayPal and Razorpay sandbox checkout, webhooks, billing page.
6. **Redesign:** new design system across marketing, tools, report and app; motion.
7. **Hardening:** tests, ECC code and security review agents, own-site audit, deploy, push.

## Needs from you (secrets you set yourself; I never see them)

| What | Where to get it | Command |
| --- | --- | --- |
| NVIDIA NIM key | build.nvidia.com | `npx wrangler pages secret put NVIDIA_API_KEY --project-name citeready-app` |
| Google OAuth client | Google Cloud Console → Credentials → OAuth client (Web). Redirect URI: `https://citeready-app.pages.dev/api/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Resend key (optional) | resend.com | `RESEND_API_KEY` |
| PayPal sandbox app | developer.paypal.com | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` |
| Razorpay test keys | dashboard.razorpay.com (test mode) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |

Features whose secret isn't set yet show "coming soon" instead of breaking.

## Risks

- **NVIDIA NIM licence:** NVIDIA's free API access is for prototyping, research and testing. Serving paying users needs a paid licence (NVIDIA AI Enterprise) or a switch to another provider before charging. The provider interface makes the switch a config change.
- NIM free-tier rate limits (roughly 40 requests/minute) cap how many AI checks run at once. The router and quotas keep within it.
- PayPal subscriptions for India-based sellers and Razorpay Subscriptions are unconfirmed (PRD open questions). One-time payments work either way.
